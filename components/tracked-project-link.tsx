"use client";

import posthog from "posthog-js";
import { useSound } from "@/components/sound-provider";

interface Props {
  href: string;
  name: string;
  description: string;
  index: string;
}

export default function TrackedProjectLink({ href, name, description, index }: Props) {
  const { play } = useSound();

  const handleClick = () => {
    play("open", { isUserGesture: true });
    posthog.capture("project_link_clicked", { project_name: name, project_index: index });
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="project-row"
      onClick={handleClick}
    >
      <span>{index}</span>
      <span className="project-copy">
        <h3>{name}</h3>
        <p>{description}</p>
      </span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}
