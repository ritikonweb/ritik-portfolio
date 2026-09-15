"use client";

import posthog from "posthog-js";
import { useSound } from "@/components/sound-provider";

interface Props {
  href: string;
  method: string;
  children: React.ReactNode;
  external?: boolean;
}

export default function TrackedContactLink({ href, method, children, external }: Props) {
  const { play } = useSound();
  const extra = external ? { target: "_blank" as const, rel: "noreferrer" } : {};

  const handleClick = () => {
    play("select", { isUserGesture: true });
    posthog.capture("contact_link_clicked", { contact_method: method });
  };

  return (
    <a
      href={href}
      {...extra}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
