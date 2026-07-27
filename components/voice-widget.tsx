"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { AgentMicrophone, AgentPlayer, AgentSession } from "@deepgram/agents";

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

// Cost guards: stop streaming audio when nobody is actually talking.
const IDLE_STOP_MS = 15000;
const MAX_SESSION_MS = 240000;

// Audio formats. These must match what the server is told, which the SDK handles from
// the same config object.
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Backstop for the end_conversation function call. The model normally ends the call
// itself, but a farewell that it fails to act on should still close the session.
const FAREWELL = new RegExp(
  [
    "\\bbye\\b",
    "\\bgood ?bye\\b",
    "\\bsee you\\b",
    "\\btalk (to you )?later\\b",
    "\\bcut the call\\b",
    "\\bend the call\\b",
    "\\bhang up\\b",
    "\\bthat(')?s all\\b",
    "\\bno more questions\\b",
    "\\bi(')?m done\\b",
    "\\balvida\\b",
    "\\bphir milenge\\b",
  ].join("|"),
  "i",
);
// Grace period so the closing line is heard in full before the socket drops.
const CLOSE_GRACE_MS = 1200;

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

type AgentConfig = {
  token: string;
  agent: Record<string, unknown>;
  accountIndex: number;
  accountCount: number;
};

export default function VoiceWidget() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const sessionRef = useRef<AgentSession | null>(null);
  const micRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const activeRef = useRef(false);
  const lastActivityRef = useRef(0);
  const startedAtRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  // Accounts this visitor already found to be out of credit, so a retry skips them.
  const deadAccounts = useRef<Set<number>>(new Set());
  const transcriptRef = useRef<Array<{ role: "visitor" | "ritik"; text: string }>>([]);
  const startedIsoRef = useRef<string | null>(null);

  // Ships the finished conversation to the server. Fire and forget with keepalive so it
  // still goes out if the visitor closes the tab mid session.
  const saveTranscript = useCallback(() => {
    const turns = transcriptRef.current;
    transcriptRef.current = [];
    const startedAt = startedIsoRef.current;
    startedIsoRef.current = null;
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
    if (watchdogRef.current !== null) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }

    saveTranscript();

    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.dispose();
    playerRef.current = null;
    sessionRef.current?.disconnect();
    sessionRef.current = null;

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

  // Ends the call once the agent has finished its closing line.
  const closeAfterGoodbye = useCallback(() => {
    if (closeTimerRef.current !== null) return;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      teardown("Thanks for stopping by. Tap to talk again any time.");
    }, CLOSE_GRACE_MS);
  }, [teardown]);

  const start = useCallback(async (accountIndex = 0) => {
    setMessage(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMessage("This browser can't run live voice. Try latest Chrome or Safari.");
      return;
    }

    setPhase("connecting");
    activeRef.current = true;

    let config: AgentConfig;
    const skip = Array.from(deadAccounts.current).join(",");
    const url = `/api/voice/agent/?account=${accountIndex}${skip ? `&skip=${skip}` : ""}`;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; accountsTried?: number };
        console.error("[voice] session request failed", {
          status: response.status,
          code: body.code ?? null,
          accountsTried: body.accountsTried ?? null,
        });
        teardown(body.error || "Voice isn't available right now.");
        return;
      }
      config = (await response.json()) as AgentConfig;
    } catch {
      teardown("Network problem. Check your connection and try again.");
      return;
    }

    // Loaded on demand so the SDK is not in the initial page bundle.
    const { AgentSession, AgentMicrophone, AgentPlayer } = await import("@deepgram/agents");

    const hasSpare = config.accountIndex + 1 < config.accountCount;
    const failover = (reason: string) => {
      if (!hasSpare) {
        teardown(reason);
        return;
      }
      // The visitor should not notice the switch, so no message and straight back to
      // connecting on the next key.
      teardown(null);
      setPhase("connecting");
      void start(config.accountIndex + 1);
    };

    try {
      const player = new AgentPlayer({ sampleRate: OUTPUT_SAMPLE_RATE });
      playerRef.current = player;

      const session = new AgentSession({
        auth: {
          // Called again before every reconnect, so each attempt gets a fresh token.
          tokenFactory: async () => {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`token request failed (${res.status})`);
            const next = (await res.json()) as AgentConfig;
            return next.token;
          },
        },
        agent: config.agent as never,
        audio: {
          input: { encoding: "linear16", sampleRate: INPUT_SAMPLE_RATE },
          output: { encoding: "linear16", sampleRate: OUTPUT_SAMPLE_RATE },
        },
        keepAliveInterval: 8000,
        reconnect: { enabled: true, maxAttempts: 3, baseDelay: 400 },
      });
      sessionRef.current = session;

      session.on("audio", (chunk) => player.queue(chunk));

      session.on("user-started-speaking", () => {
        // Barge-in: drop whatever is still queued so the agent stops mid sentence.
        player.interrupt();
        lastActivityRef.current = Date.now();
        // They kept talking, so they did not actually mean goodbye.
        if (closingRef.current && closeTimerRef.current === null) closingRef.current = false;
        if (activeRef.current) setPhase("listening");
      });

      session.on("agent-thinking", () => {
        lastActivityRef.current = Date.now();
        if (activeRef.current) setPhase("thinking");
      });

      session.on("agent-started-speaking", () => {
        lastActivityRef.current = Date.now();
        if (activeRef.current) setPhase("speaking");
      });

      session.on("agent-audio-done", () => {
        lastActivityRef.current = Date.now();
        if (closingRef.current && activeRef.current) {
          closeAfterGoodbye();
          return;
        }
        if (activeRef.current) setPhase("listening");
      });

      session.on("conversation-text", (msg) => {
        const said = String((msg as { content?: string }).content ?? "").trim();
        const role = (msg as { role?: string }).role;
        if (!said) return;
        lastActivityRef.current = Date.now();
        transcriptRef.current.push({ role: role === "assistant" ? "ritik" : "visitor", text: said });
        if (role !== "assistant" && FAREWELL.test(said)) closingRef.current = true;
      });

      // The agent decides when the conversation is over and calls this.
      session.on("function-call-request", (msg) => {
        const functions = (msg as { functions?: Array<{ id?: string; name?: string }> }).functions ?? [];
        for (const fn of functions) {
          const name = fn.name ?? "";
          session.sendFunctionCallResponse(fn.id, name, JSON.stringify({ ok: true }));
          if (name === "end_conversation") closingRef.current = true;
        }
      });

      session.on("error", (msg) => {
        console.error("[voice] agent error", msg);
        failover("Voice session ended. Try again.");
      });

      session.on("sdk-error", (err) => {
        console.error("[voice] sdk error", err);
        const detail = String(err?.message ?? "");
        // 402 or a quota-shaped failure means this key is spent, so mark it and move on.
        if (/402|payment|credit|quota|balance/i.test(detail)) {
          deadAccounts.current.add(config.accountIndex);
          failover("Voice is out of credit right now. Try again later.");
          return;
        }
        failover("Couldn't start the conversation. Try again.");
      });

      session.on("settings-applied", () => {
        if (!activeRef.current) return;
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
      });

      await session.connect();

      const mic = new AgentMicrophone((data) => session.sendAudio(data), {
        sampleRate: INPUT_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      micRef.current = mic;
      mic.on("error", (err) => {
        console.error("[voice] microphone error", err);
        teardown("Microphone access was blocked. Allow it in your browser's site settings, then try again.");
      });
      await mic.start();
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        teardown("Microphone access was blocked. Allow it in your browser's site settings, then try again.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        teardown("No microphone found. Connect one and try again.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        teardown("Your microphone is in use by another app.");
      } else if (!window.isSecureContext) {
        teardown("Voice needs a secure https connection.");
      } else {
        console.error("[voice] start failed", error);
        teardown("Couldn't start the conversation. Try again.");
      }
    }
  }, [closeAfterGoodbye, teardown]);

  const toggle = useCallback(() => {
    if (phase === "idle") void start(0);
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
