"use client";

import posthog from "posthog-js";

interface Props {
  href: string;
  method: string;
  children: React.ReactNode;
  external?: boolean;
}

export default function TrackedContactLink({ href, method, children, external }: Props) {
  const extra = external ? { target: "_blank" as const, rel: "noreferrer" } : {};
  return (
    <a
      href={href}
      {...extra}
      onClick={() => posthog.capture("contact_link_clicked", { contact_method: method })}
    >
      {children}
    </a>
  );
}
