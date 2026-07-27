"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

// Cost guards: stop streaming audio when nobody is actually talking.
const IDLE_STOP_MS = 15000;
const MAX_SESSION_MS = 240000;

// Visitor said goodbye. Matched against the finished transcript of a turn, so the bot
// gets to deliver its sign off first and the session closes after it stops speaking.
// Deliberately conservative: "thanks" or "ok" alone must not end a conversation.
const FAREWELL = new RegExp(
  [
    "\\bbye\\b",
    "\\bbye bye\\b",
    "\\bgood ?bye\\b",
    "\\bsee you\\b",
    "\\bsee ya\\b",
    "\\btalk (to you )?later\\b",
    "\\bcatch you later\\b",
    "\\bgood night\\b",
    "\\bcut the call\\b",
    "\\bend the call\\b",
    "\\bhang up\\b",
    "\\bdisconnect\\b",
    "\\bthat(')?s all\\b",
    "\\bthat(')?s it (for now)?\\b",
    "\\bnothing else\\b",
    "\\bno more questions\\b",
    "\\bi(')?m done\\b",
    "\\balvida\\b",
    "\\bphir milenge\\b",
    "\\bchalte hai(n)?\\b",
    "\\bbas itna\\b",
  ].join("|"),
  "i",
);
// Grace period after the bot stops speaking, so the sign off is fully heard.
const FAREWELL_CLOSE_MS = 900;

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
  const lastActivityRef = useRef(0);
  const startedAtRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failoverRef = useRef<((reason: string) => void) | null>(null);
  // Set when the visitor says goodbye. The session closes once the bot finishes its
  // reply rather than cutting it off mid sentence.
  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Running transcript of the conversation, posted once at the end.
  const transcriptRef = useRef<Array<{ role: "visitor" | "ritik"; text: string }>>([]);
  const startedIsoRef = useRef<string | null>(null);

  // Ships the finished conversation to the server, which stores it. Fire and forget with
  // keepalive so it still goes out if the visitor closes the tab mid session.
  const saveTranscript = useCallback(() => {
    const turns = transcriptRef.current;
    transcriptRef.current = [];
    const startedAt = startedIsoRef.current;
    startedIsoRef.current = null;
    // One-sided or empty conversations are not worth storing.
    if (turns.length < 2) return;
    try {
      void fetch("/api/voice/transcript/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedAt, endedAt: new Date().toISOString(), turns }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Storing a transcript must never affect the visitor.
    }
  }, []);

  const teardown = useCallback((note?: string | null) => {
    const wasActive = activeRef.current;
    const sessionDurationMs = wasActive && startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;
    activeRef.current = false;
    closingRef.current = false;
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    saveTranscript();
    if (watchdogRef.current !== null) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
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
    if (wasActive && note !== null) {
      if (note) {
        posthog.capture("voice_session_error", { error_message: note, session_duration_ms: sessionDurationMs });
      } else {
        posthog.capture("voice_session_ended", { session_duration_ms: sessionDurationMs });
      }
    }
  }, [saveTranscript]);

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
    let event: { type?: string; transcript?: string };
    try {
      event = JSON.parse(raw) as { type?: string; transcript?: string };
    } catch {
      return;
    }
    const type = event.type ?? "";
    // Any real speech or model output counts as activity and resets the idle timer.
    if (type.startsWith("input_audio_buffer.") || type.startsWith("response.")) lastActivityRef.current = Date.now();

    // Finished transcript of what the visitor said.
    if (type === "conversation.item.input_audio_transcription.completed") {
      const said = (event.transcript ?? "").trim();
      if (said) {
        transcriptRef.current.push({ role: "visitor", text: said });
        // Arm the close. The bot still gets to answer, and the persona tells it to sign
        // off warmly, so the call ends on a sentence rather than a hang up.
        if (FAREWELL.test(said)) closingRef.current = true;
      }
      return;
    }

    // Finished transcript of what the bot said.
    if (type === "response.output_audio_transcript.done") {
      const spoken = (event.transcript ?? "").trim();
      if (spoken) transcriptRef.current.push({ role: "ritik", text: spoken });
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      // They started talking again, so they did not actually mean goodbye.
      if (closingRef.current && closeTimerRef.current === null) closingRef.current = false;
      setPhase("listening");
    }
    else if (type === "input_audio_buffer.speech_stopped" || type === "response.created") setPhase("thinking");
    else if (type === "response.output_audio.delta" || type === "output_audio_buffer.started") {
      // Audio arrived, so this account works. Disarm failover from here on, otherwise a
      // late error would silently open a second paid session the visitor never asked for.
      failoverRef.current = null;
      setPhase("speaking");
    }
    else if (type === "response.done" || type === "output_audio_buffer.stopped") {
      if (closingRef.current && activeRef.current && closeTimerRef.current === null) {
        setPhase("speaking");
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null;
          teardown("Thanks for stopping by. Tap to talk again any time.");
        }, FAREWELL_CLOSE_MS);
        return;
      }
      if (activeRef.current) setPhase("listening");
    } else if (type === "error") {
      // Often means the account ran out of credit, so try the next one.
      if (failoverRef.current) failoverRef.current("Voice session ended. Try again.");
      else teardown("Voice session ended. Try again.");
    }
  }, [teardown]);

  const start = useCallback(async (accountIndex = 0) => {
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
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          // Levels out a quiet or distant speaker, which is half the reason words get
          // misheard. Mono avoids the browser downmixing for us.
          autoGainControl: true,
          channelCount: 1,
        },
      });
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
      ttsModel: string;
      ttsSpeed: number;
      sttModel: string;
      languageHints: string[];
      segmenter: string;
      voice: string;
      instructions: string;
      accountIndex: number;
      accountCount: number;
    };

    try {
      const response = await fetch(`/api/voice/session/?account=${accountIndex}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; accountsTried?: number };
        // Visitors see a plain message; the diagnostic detail goes to the console only.
        console.error("[voice] session request failed", {
          status: response.status,
          code: body.code ?? null,
          accountsTried: body.accountsTried ?? null,
        });
        teardown(body.error || "Voice isn't available right now.");
        return;
      }
      config = await response.json();
    } catch {
      teardown("Network problem. Check your connection and try again.");
      return;
    }

    // If this account fails, silently move to the next configured one.
    const hasSpare = config.accountIndex + 1 < config.accountCount;
    failoverRef.current = (reason: string) => {
      failoverRef.current = null;
      if (!hasSpare) {
        teardown(reason);
        return;
      }
      teardown(null);
      void start(config.accountIndex + 1);
    };

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
        // Transcripts are stored, so say so. Delete this line if you drop transcripts.
        setMessage("Connected. This conversation is transcribed.");
        lastActivityRef.current = Date.now();
        startedAtRef.current = Date.now();
        startedIsoRef.current = new Date().toISOString();
        transcriptRef.current = [];
        posthog.capture("voice_session_started");
        watchdogRef.current = setInterval(() => {
          if (!activeRef.current) return;
          const now = Date.now();
          if (now - lastActivityRef.current >= IDLE_STOP_MS) {
            teardown("Paused after a quiet moment. Tap to talk again.");
          } else if (now - startedAtRef.current >= MAX_SESSION_MS) {
            teardown("Session ended. Tap to start a new one.");
          }
        }, 1000);
        channel.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              model: config.model,
              instructions: config.instructions,
              output_modalities: ["audio", "text"],
              // Two or three sentences is the target, so a lower ceiling shortens the
              // tail of every reply and cuts token spend at the same time.
              max_output_tokens: 180,
              // Warmer, less deterministic phrasing so answers do not sound recited.
              temperature: 0.9,
              audio: {
                input: {
                  transcription: { model: config.sttModel },
                  // "low" eagerness tolerates the pauses people leave mid sentence
                  // instead of ending the turn on them.
                  turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true },
                },
                output: { model: config.ttsModel, voice: config.voice, speed: config.ttsSpeed },
              },
              providerData: {
                stt: {
                  // Names the model would otherwise mishear, plus explicit overrides of
                  // the eagerness preset.
                  prompt: "Conversation with Ritik Yadav, in Indian English and sometimes Hindi. Names: Flow Realty, Rustomjee, Keystone Realtors, Ozonetel, Gallabox, Double Tick, Zoho, Salesforce, InterVuex, BrowseMind, Aura Meetings, DeepFilterNet, NLSIU, IIT Ropar, IIM Amritsar, Flipkart, SysMind, Bangalore, crore, lakh.",
                  // Biases recognition toward Indian English and Hindi without locking
                  // to one language. Soniox only.
                  language_hints: config.languageHints,
                  // Documented default is 0.5. Pushing this up rejects noise but also
                  // swallows the first word of normal speech, which reads as the bot
                  // mishearing you. 0.55 is a light touch either side.
                  vad_threshold: 0.55,
                  // Strong end-of-turn confidence so a half sentence is not sent to the
                  // model as a complete thought.
                  end_of_turn_confidence_threshold: 0.85,
                  // Long enough not to clip a mid sentence pause, short enough that the
                  // reply does not feel delayed.
                  min_end_of_turn_silence: 400,
                  max_turn_silence: 3200,
                },
                tts: {
                  // CREATIVE is the expressive preset. The segmenter is configurable
                  // because it trades intonation quality against time to first audio.
                  delivery_mode: "CREATIVE",
                  segmenter_strategy: config.segmenter,
                  steering_handling: "emit_once",
                },
                // Short "mm-hm" while the visitor is still talking, which is most of what
                // makes a listener feel human. Quiet and capped so it never talks over.
                backchannel: { enabled: true, volume_gain: 0.5, max_per_turn: 2, min_gap_ms: 5000, min_speech_ms: 1200 },
                // Speaks a short filler if the model is slow, instead of dead air. Firing
                // it earlier is the cheapest way to cut *perceived* latency, since the
                // gap gets filled while the real answer is still being generated.
                responsiveness: { enabled: true, max_initial_per_turn: 1, initial_wait_timeout_ms: 700 },
              },
            },
          }),
        );
        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: "Greet them briefly and warmly, introduce yourself by name in a few words, and invite their question. One sentence, no questions about them." }] },
          }),
        );
        channel.send(JSON.stringify({ type: "response.create" }));
      };

      streamRef.current.getAudioTracks().forEach((track) => peer.addTrack(track, streamRef.current as MediaStream));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      // Wait for ICE candidates, but do not wait for the long tail of them. A host and
      // one server-reflexive candidate is enough to connect, so a short debounce and a
      // hard ceiling cut a second or more off the time before the first hello.
      await new Promise<void>((resolve) => {
        if (peer.iceGatheringState === "complete") return resolve();
        let timer: ReturnType<typeof setTimeout>;
        const done = () => { clearTimeout(timer); resolve(); };
        peer.onicecandidate = (event) => { if (event.candidate) { clearTimeout(timer); timer = setTimeout(done, 250); } };
        peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === "complete") done(); };
        timer = setTimeout(done, 1500);
      });

      const answer = await fetch(config.callsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${config.token}` },
        body: peer.localDescription?.sdp ?? "",
      });
      if (!answer.ok) {
        failoverRef.current?.("Voice service didn't accept the call. Try again.");
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    } catch {
      teardown("Couldn't start the conversation. Try again.");
    }
  }, [handleEvent, teardown]);

  const toggle = useCallback(() => {
    if (phase === "idle") void start(0);
    else {
      failoverRef.current = null;
      teardown(null);
    }
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
