"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { AgentMicrophone, AgentPlayer, AgentSession } from "@deepgram/agents";
import { ParticlesOrb } from "@/registry/orbe/particles-orb/particles-orb";
import type { OrbState } from "@/registry/lib/orb-state";

type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

// Cost guards: stop streaming audio when nobody is actually talking.
const IDLE_STOP_MS = 15000;
const MAX_SESSION_MS = 240000;

// Audio formats. These must match what the server is told, which the SDK handles from
// the same config object.
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Backstop for the end_conversation function. The model normally ends the call itself,
// but a goodbye it fails to act on must still close the session.
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
// The agent's own sign off is an independent signal that the call is over, and it works
// even if the visitor's transcript never arrives.
const AGENT_FAREWELL = new RegExp(
  [
    "thank you for your time",
    "thanks for your time",
    "good talking to you",
    "great talking to you",
    "good to talk to you",
    "nice talking to you",
    "appreciate you stopping by",
    "thanks for stopping by",
    "thanks for listening",
    "take care",
    "have a good (day|one|evening)",
    "all the best",
  ].join("|"),
  "i",
);
// After a goodbye, wait at least this long so the agent can start its sign off, then
// close as soon as playback has drained.
const CLOSE_MIN_MS = 1500;
// Absolute backstop. The session never stays open longer than this after a goodbye,
// even if no closing audio ever arrives.
const CLOSE_BACKSTOP_MS = 9000;
// Status strings are kept short on purpose: the line sits under the hero buttons and is
// pinned to a single line, so anything long gets clipped rather than wrapping.
const GOODBYE_NOTE = "Thanks for stopping by.";

const LABELS: Record<Phase, string> = {
  idle: "Tap to ask",
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

// Rolls after the idle label. These answer the real reason people do not tap a mic on a
// personal site, which is not knowing what they are allowed to ask. The last entry repeats
// the first so the loop has no visible jump.
const PROMPTS = ["anything", "about my work", "why hire me", "anything"];

// ponytail: MicIcon, StopIcon, Bars removed — ParticlesOrb replaces all three glyphs.

/** Maps the widget's Phase to the orb's OrbState (1:1 today, adapter in case they diverge). */
const phaseToOrb = (p: Phase): OrbState => p;

type AgentConfig = {
  token: string;
  agent: Record<string, unknown>;
  accountIndex: number;
  accountCount: number;
};

/**
 * Minimal shape of the Screen Wake Lock API, declared locally because it is not in every
 * TypeScript DOM lib yet.
 */
type WakeLockSentinel = {
  readonly released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

export default function VoiceWidget() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const sessionRef = useRef<AgentSession | null>(null);
  const micRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  // Live audio level (0..1) fed to the orb. -1 means "no live signal, fall back to the
  // state's synthetic energy". Driven from the SDK's own volume meters: the visitor's
  // mic while listening, the agent's playback while speaking. Display only — reads
  // volumes off the existing mic/player, never touches the session or its config.
  const levelRef = useRef<number>(-1);
  const activeRef = useRef(false);
  const lastActivityRef = useRef(0);
  const startedAtRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closingRef = useRef(false);
  const closingAtRef = useRef(0);
  /**
   * Epoch counter for the current attempt. Incremented on every start and every teardown.
   *
   * start() awaits several things: the config fetch, the SDK import, the socket, then the
   * microphone. If the visitor stops the session during any of those, teardown runs but
   * the in-flight continuation carries on and reattaches a live session behind an idle
   * looking button. Tapping again then produces two agents talking over each other.
   * Every await is followed by an epoch check so a superseded attempt disposes of its own
   * objects and exits instead.
   */
  const runIdRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
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

  /**
   * Keeps the screen awake for the duration of a call, so a phone does not lock mid
   * sentence and kill the microphone. Entirely best effort: unsupported browsers, denied
   * requests and an already-hidden page all just carry on without it.
   */
  const requestWakeLock = useCallback(async () => {
    const lock = (navigator as WakeLockNavigator).wakeLock;
    if (!lock || wakeLockRef.current) return;
    // The request is only granted while the page is visible.
    if (document.visibilityState !== "visible") return;
    try {
      const sentinel = await lock.request("screen");
      wakeLockRef.current = sentinel;
      // The browser releases it on its own when the page is hidden, so keep the ref honest.
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
      console.info("[voice] screen wake lock held");
    } catch {
      // Denied or unsupported. Nothing to do, the call still works.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel || sentinel.released) return;
    void sentinel.release().catch(() => undefined);
  }, []);

  const teardown = useCallback((note?: string | null) => {
    const wasActive = activeRef.current;
    const sessionDurationMs = wasActive && startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;
    // Invalidates any start() still waiting on an await, so it cannot resurrect a session
    // after this point.
    runIdRef.current += 1;
    activeRef.current = false;
    closingRef.current = false;
    closingAtRef.current = 0;

    if (watchdogRef.current !== null) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }

    releaseWakeLock();
    saveTranscript();

    micRef.current?.stop();
    micRef.current = null;
    // Interrupt before dispose so anything already buffered stops immediately rather than
    // finishing its sentence after the button has gone back to idle.
    playerRef.current?.interrupt();
    playerRef.current?.dispose();
    playerRef.current = null;
    // Closing the socket is what finalises the request on Deepgram's side, which is what
    // makes the session show up in the console logs and usage.
    sessionRef.current?.disconnect();
    sessionRef.current = null;

    setPhase("idle");
    if (note !== undefined) setMessage(note);
    if (wasActive) {
      console.info(`[voice] session ended after ${Math.round(sessionDurationMs / 1000)}s`);
      if (note !== null) {
        if (note) {
          posthog.capture("voice_session_error", { error_message: note, session_duration_ms: sessionDurationMs });
        } else {
          posthog.capture("voice_session_ended", { session_duration_ms: sessionDurationMs });
        }
      }
    }
  }, [releaseWakeLock, saveTranscript]);

  // The browser drops the wake lock whenever the page is hidden, so take it again on
  // return if a call is still running.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && activeRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [requestWakeLock]);

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

  // Feeds the orb a real audio level so it visibly reacts to sound: the visitor's mic
  // while listening, the agent's playback while speaking. This is what makes the two
  // modes look different — listening pulses with your voice, speaking pulses with the
  // reply. Idle/connecting/thinking leave it at -1 so the orb uses its synthetic energy.
  useEffect(() => {
    if (phase !== "listening" && phase !== "speaking") {
      levelRef.current = -1;
      return;
    }
    let raf = 0;
    const tick = () => {
      const live =
        phase === "speaking"
          ? playerRef.current?.getOutputVolume()
          : micRef.current?.getInputVolume();
      // Gentle floor + gain so quiet speech still moves the orb without clipping.
      levelRef.current = typeof live === "number" ? Math.min(1, live * 1.6 + 0.12) : -1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      levelRef.current = -1;
    };
  }, [phase]);

  /**
   * Arms the end of the conversation. Deliberately not tied to one event, because the
   * goodbye can be detected before, during or after the closing line depending on whether
   * it came from the transcript or from the end_conversation function call. The watchdog
   * then closes as soon as playback drains, with a hard backstop.
   */
  const armClose = useCallback((source: string) => {
    if (closingRef.current || !activeRef.current) return;
    closingRef.current = true;
    closingAtRef.current = Date.now();
    console.info(`[voice] goodbye detected via ${source}, closing once the sign off finishes`);
  }, []);

  const cancelClose = useCallback(() => {
    if (!closingRef.current) return;
    closingRef.current = false;
    closingAtRef.current = 0;
    console.info("[voice] close cancelled, visitor asked something else");
  }, []);

  const start = useCallback(async (accountIndex = 0) => {
    // Guard against a second session being opened before React has re-rendered the
    // button out of its idle state. Two taps in quick succession used to start two
    // agents at once, which is heard as an echo. A ref is checked because state updates
    // are async and the click handler can see a stale phase.
    if (activeRef.current) {
      console.warn("[voice] start ignored, a session is already active");
      return;
    }

    setMessage(null);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMessage("Try latest Chrome or Safari.");
      return;
    }

    setPhase("connecting");
    activeRef.current = true;
    const runId = (runIdRef.current += 1);
    // True only while this attempt is still the current one.
    const isCurrent = () => runIdRef.current === runId && activeRef.current;

    let config: AgentConfig;
    const skip = Array.from(deadAccounts.current).join(",");
    const url = `/api/voice/agent/?account=${accountIndex}${skip ? `&skip=${skip}` : ""}`;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string; code?: string; accountsTried?: number; upstreamStatus?: number[]; reasons?: string[];
        };
        console.error("[voice] session request failed", {
          status: response.status,
          code: body.code ?? null,
          upstreamStatus: body.upstreamStatus ?? null,
          reasons: body.reasons ?? null,
        });
        teardown(body.error || "Voice isn't available right now.");
        return;
      }
      config = (await response.json()) as AgentConfig;
    } catch {
      teardown("Network problem. Try again.");
      return;
    }

    // Stopped while the config was in flight, so do not open anything.
    if (!isCurrent()) return;

    // Loaded on demand so the SDK is not in the initial page bundle.
    const { AgentSession, AgentMicrophone, AgentPlayer } = await import("@deepgram/agents");
    if (!isCurrent()) return;

    const hasSpare = config.accountIndex + 1 < config.accountCount;
    const failover = (reason: string) => {
      if (!isCurrent()) return;
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

    // One timer owns every time-based decision: idle stop, hard cap, and closing after a
    // goodbye. A single loop is far easier to reason about than nested timeouts.
    const startWatchdog = () => {
      if (watchdogRef.current !== null) return;
      watchdogRef.current = setInterval(() => {
        if (!activeRef.current) return;
        const now = Date.now();

        if (closingRef.current) {
          const sinceGoodbye = now - closingAtRef.current;
          const remaining = playerRef.current?.getRemainingPlaybackTime() ?? 0;
          if (sinceGoodbye >= CLOSE_BACKSTOP_MS || (sinceGoodbye >= CLOSE_MIN_MS && remaining <= 0.05)) {
            teardown(GOODBYE_NOTE);
          }
          return;
        }

        if (now - lastActivityRef.current >= IDLE_STOP_MS) {
          teardown("Paused. Tap to talk again.");
        } else if (now - startedAtRef.current >= MAX_SESSION_MS) {
          teardown("Session ended.");
        }
      }, 500);
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

      // Every handler is gated on the epoch, so a superseded session that has not finished
      // closing yet cannot produce audio or drive the UI.
      session.on("audio", (chunk) => {
        if (!isCurrent()) return;
        player.queue(chunk);
        // The agent-started-speaking event is not guaranteed by all agent configs, so
        // detect speaking from the audio stream itself: every audio chunk means the
        // agent is speaking. React bails if the value is already "speaking".
        lastActivityRef.current = Date.now();
        if (activeRef.current) setPhase("speaking");
      });

      session.on("user-started-speaking", () => {
        // Barge-in: drop whatever is still queued so the agent stops mid sentence.
        player.interrupt();
        lastActivityRef.current = Date.now();
        if (activeRef.current && !closingRef.current) setPhase("listening");
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
        if (activeRef.current && !closingRef.current) setPhase("listening");
      });

      session.on("conversation-text", (msg) => {
        const said = String((msg as { content?: string }).content ?? "").trim();
        const role = (msg as { role?: string }).role;
        if (!said) return;
        // Logged so it is obvious which roles actually arrive, which is the one thing
        // needed to tell a missed farewell from a missing transcript event.
        console.info(`[voice] ${role ?? "unknown"}: ${said.slice(0, 120)}`);
        lastActivityRef.current = Date.now();
        const isAgent = role === "assistant";
        transcriptRef.current.push({ role: isAgent ? "ritik" : "visitor", text: said });

        if (isAgent) {
          // If it just delivered a sign off, the conversation is over regardless of
          // whether the function call or the visitor's transcript reached us.
          if (AGENT_FAREWELL.test(said)) armClose("agent sign off");
          return;
        }

        if (FAREWELL.test(said)) {
          armClose("transcript");
          return;
        }
        // A real follow up question means they did not mean goodbye after all. Judging
        // this from the transcript rather than raw voice activity avoids the agent's own
        // audio, or a cough, keeping the session open forever.
        if (closingRef.current && said.split(/\s+/).length >= 3) cancelClose();
      });

      // The agent decides the conversation is over and calls this.
      session.on("function-call-request", (msg) => {
        const functions = (msg as { functions?: Array<{ id?: string; name?: string }> }).functions ?? [];
        for (const fn of functions) {
          const name = fn.name ?? "";
          console.info(`[voice] function call ${name}`);
          session.sendFunctionCallResponse(fn.id, name, JSON.stringify({ ok: true }));
          if (name === "end_conversation") armClose("function call");
        }
      });

      session.on("error", (msg) => {
        console.error("[voice] agent error", msg);
        failover("Session ended. Try again.");
      });

      session.on("warning", (msg) => console.warn("[voice] agent warning", msg));

      session.on("disconnected", (reason) => {
        console.info(`[voice] disconnected: ${reason}`);
        if (!isCurrent()) return;
        // The SDK gives up after its reconnect attempts, so make sure the UI does not sit
        // on "Listening" with a dead socket behind it.
        if (activeRef.current && !closingRef.current) teardown("Connection dropped.");
      });

      session.on("sdk-error", (err) => {
        console.error("[voice] sdk error", err);
        const detail = String(err?.message ?? "");
        // 402 or a quota-shaped failure means this key is spent, so mark it and move on.
        if (/402|payment|credit|quota|balance/i.test(detail)) {
          deadAccounts.current.add(config.accountIndex);
          failover("Out of credit. Try again later.");
          return;
        }
        failover("Couldn't connect. Try again.");
      });

      session.on("settings-applied", () => {
        if (!isCurrent()) return;
        console.info("[voice] settings applied, agent ready");
        setPhase("listening");
        setMessage("Connected");
      });

      await session.connect();

      // Stopped while the socket was opening. Dispose of this attempt's own objects, since
      // teardown has already cleared the refs and cannot see them.
      if (!isCurrent()) {
        console.info("[voice] connect completed after stop, discarding session");
        session.disconnect();
        player.interrupt();
        player.dispose();
        return;
      }
      console.info("[voice] connected");
      void requestWakeLock();

      // Started here rather than on settings-applied, so the cost guards are armed even
      // if that acknowledgement never arrives.
      lastActivityRef.current = Date.now();
      startedAtRef.current = Date.now();
      startedIsoRef.current = new Date().toISOString();
      transcriptRef.current = [];
      posthog.capture("voice_session_started");
      startWatchdog();

      const mic = new AgentMicrophone((data) => session.sendAudio(data), {
        sampleRate: INPUT_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      micRef.current = mic;
      mic.on("error", (err) => {
        console.error("[voice] microphone error", err);
        if (isCurrent()) teardown("Mic blocked. Allow it in site settings.");
      });
      await mic.start();

      // Stopped while the microphone was being acquired.
      if (!isCurrent()) {
        console.info("[voice] mic started after stop, discarding session");
        mic.stop();
        session.disconnect();
        player.interrupt();
        player.dispose();
        return;
      }
    } catch (error) {
      // A failure on a superseded attempt is not worth showing to the visitor.
      if (!isCurrent()) return;
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        teardown("Mic blocked. Allow it in site settings.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        teardown("No microphone found.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        teardown("Mic in use by another app.");
      } else if (!window.isSecureContext) {
        teardown("Voice needs a secure connection.");
      } else {
        console.error("[voice] start failed", error);
        teardown("Couldn't connect. Try again.");
      }
    }
  }, [armClose, cancelClose, requestWakeLock, teardown]);

  const toggle = useCallback(() => {
    if (phase === "idle") void start(0);
    else teardown(null);
  }, [phase, start, teardown]);

  const busy = phase !== "idle";

  return (
    <span className="voice-widget">
      <button type="button" className="voice-cta" data-phase={phase} onClick={toggle} aria-pressed={busy} title={HINTS[phase]} aria-label={busy ? `${LABELS[phase]}. Tap to stop.` : "Tap to ask, start a voice conversation with my AI"}>
        <span className="voice-orb-wrap" aria-hidden="true">
          <ParticlesOrb
            state={phaseToOrb(phase)}
            size={52}
            speed={1}
            colorFrom="#4f46e5"
            colorTo="#a78bfa"
            levelRef={levelRef}
          />
        </span>
        <span className="voice-text">
          {phase === "idle" ? (
            <>
              <span className="voice-label">Tap to ask</span>
              <span className="voice-cycle" aria-hidden="true">
                <span>
                  {PROMPTS.map((prompt, index) => (
                    <b key={`${prompt}-${index}`}>{prompt}</b>
                  ))}
                </span>
              </span>
            </>
          ) : (
            <span className="voice-label">{LABELS[phase]}</span>
          )}
        </span>
      </button>
      <span className="voice-status" role="status" aria-live="polite">{message}</span>
    </span>
  );
}
