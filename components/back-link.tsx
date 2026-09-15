"use client";

import { useSound } from "@/components/sound-provider";
import type { CueName } from "uisfx";

export default function BackLink({
  href,
  children,
  className = "",
  cue = "back",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  cue?: CueName;
}) {
  const { play } = useSound();

  return (
    <a
      href={href}
      className={className}
      onClick={() => play(cue, { isUserGesture: true })}
    >
      {children}
    </a>
  );
}
