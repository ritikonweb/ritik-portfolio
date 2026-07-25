"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

const LABELS: Record<Phase, string> = {
  idle: "Let's Talk",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const HINTS: Record<Phase, string> = {
  idle: "Ask me anything",
  connecting: "One moment",
  listening: "Go ahead, I'm listening",
  thinking: "Working on it",
  speaking: "Tap to interrupt",
};

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5a2.6 2.6 0 0 0-2.6 2.6v4.6a2.6 2.6 0 0 0 5.2 0V6.1A2.6 2.6 0 0 0 12 3.5Z" />
      <path d="M6 10.7a6 6 0 0 0 12 0M12 16.7V20" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

function Bars() {
  return (
    <span className="voice-bars" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export default function VoiceWidget() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef(false);

  const teardown = useCallback((note?: string | null) => {
    activeRef.current = false;
    channelRef.current?.close();
    channelRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
    setPhase("idle");
    if (note !== undefined) setMessage(note);
  }, []);

  // Never leave a dangling connection on reload, navigation, or unmount.
  useEffect(() => {
    const onLeave = () => teardown();
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      teardown();
    };
  }, [teardown]);

  const handleEvent = useCallback((raw: string) => {
    let event: { type?: string };
    try {
      event = JSON.parse(raw) as { type?: string };
    } catch {
      return;
    }
    const type = event.type ?? "";
    if (type === "input_audio_buffer.speech_started") setPhase("listening");
    else if (type === "input_audio_buffer.speech_stopped" || type === "response.created") setPhase("thinking");
    else if (type === "response.output_audio.delta" || type === "output_audio_buffer.started") setPhase("speaking");
    else if (type === "response.done" || type === "output_audio_buffer.stopped") {
      if (activeRef.current) setPhase("listening");
    } else if (type === "error") {
      teardown("Voice session ended. Try again.");
    }
  }, [teardown]);

  const start = useCallback(async () => {
    setMessage(null);

    if (typeof window === "undefined" || !window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      setMessage("This browser can't run live voice. Try latest Chrome or Safari.");
      return;
    }

    setPhase("connecting");
    activeRef.current = true;

    // Ask for the mic first, while we are still inside the click gesture.
    // Safari refuses the permission prompt if an await (like fetch) happens first.
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
        teardown("No microphone found. Connect one and try again.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        teardown("Your microphone is in use by another app.");
      } else if (name === "SecurityError" || !window.isSecureContext) {
        teardown("Voice needs a secure https connection.");
      } else {
        teardown("Microphone access was blocked. Allow it in your browser's site settings, then try again.");
      }
      return;
    }

    let config: {
      token: string;
      callsUrl: string;
      iceServers: RTCIceServer[];
      model: string;
      voice: string;
      instructions: string;
    };

    try {
      const response = await fetch("/api/voice/session/", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        teardown(body.error || "Voice isn't available right now.");
        return;
      }
      config = await response.json();
    } catch {
      teardown("Network problem. Check your connection and try again.");
      return;
    }

    try {
      const peer = new RTCPeerConnection({ iceServers: config.iceServers ?? [] });
      peerRef.current = peer;

      peer.oniceconnectionstatechange = () => {
        if (activeRef.current && (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected")) {
          teardown("Connection dropped. Try again.");
        }
      };

      peer.ontrack = (event) => {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = new MediaStream([event.track]);
        audio.style.display = "none";
        document.body.appendChild(audio);
        audioRef.current = audio;
        void audio.play().catch(() => setMessage("Tap the button once more to allow audio."));
      };

      const channel = peer.createDataChannel("oai-events", { ordered: true });
      channelRef.current = channel;
      channel.onmessage = (event) => handleEvent(String(event.data));
      channel.onopen = () => {
        setPhase("listening");
        channel.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              model: config.model,
              instructions: config.instructions,
              output_modalities: ["audio", "text"],
              audio: {
                input: {
                  turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true },
                },
                output: { model: "inworld-tts-2", voice: config.voice },
              },
            },
          }),
        );
        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: "Say a short hello and ask what they want to know. One sentence." }] },
          }),
        );
        channel.send(JSON.stringify({ type: "response.create" }));
      };

      streamRef.current.getAudioTracks().forEach((track) => peer.addTrack(track, streamRef.current as MediaStream));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await new Promise<void>((resolve) => {
        if (peer.iceGatheringState === "complete") return resolve();
        let timer: ReturnType<typeof setTimeout>;
        const done = () => { clearTimeout(timer); resolve(); };
        peer.onicecandidate = (event) => { if (event.candidate) { clearTimeout(timer); timer = setTimeout(done, 500); } };
        peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === "complete") done(); };
        timer = setTimeout(done, 3000);
      });

      const answer = await fetch(config.callsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${config.token}` },
        body: peer.localDescription?.sdp ?? "",
      });
      if (!answer.ok) {
        teardown("Voice service didn't accept the call. Try again.");
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    } catch {
      teardown("Couldn't start the conversation. Try again.");
    }
  }, [handleEvent, teardown]);

  const toggle = useCallback(() => {
    if (phase === "idle") void start();
    else teardown(null);
  }, [phase, start, teardown]);

  const busy = phase !== "idle";

  return (
    <span className="voice-widget">
      <button type="button" className="voice-cta" data-phase={phase} onClick={toggle} aria-pressed={busy} title={HINTS[phase]} aria-label={busy ? `${LABELS[phase]}. Tap to stop.` : "Let's talk, start a voice conversation"}>
        <span className="voice-glyph" aria-hidden="true">
          {phase === "listening" || phase === "speaking" ? <Bars /> : phase === "thinking" ? <StopIcon /> : <MicIcon />}
        </span>
        <span className="voice-label">{LABELS[phase]}</span>
      </button>
      <span className="voice-status" role="status" aria-live="polite">{message}</span>
    </span>
  );
}
