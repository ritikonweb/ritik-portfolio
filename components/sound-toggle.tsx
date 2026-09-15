"use client";

import { useSound } from "@/components/sound-provider";

export default function SoundToggle({ className = "" }: { className?: string }) {
  const { soundEnabled, toggleSound, play } = useSound();

  const handlePointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      play("hover", { isUserGesture: true, cooldownMs: 120 });
    }
  };

  return (
    <button
      type="button"
      className={`sound-toggle ${className}`.trim()}
      onClick={toggleSound}
      onPointerEnter={handlePointerEnter}
      aria-label={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
      aria-pressed={soundEnabled}
      title={soundEnabled ? "Sound effects enabled (click to mute)" : "Sound effects muted (click to enable)"}
    >
      {soundEnabled ? (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      )}
    </button>
  );
}
