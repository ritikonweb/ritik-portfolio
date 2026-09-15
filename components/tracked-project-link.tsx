"use client";

import posthog from "posthog-js";

interface Props {
  href: string;
  name: string;
  description: string;
  index: string;
}

export default function TrackedProjectLink({ href, name, description, index }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="project-row"
      onClick={() => posthog.capture("project_link_clicked", { project_name: name, project_index: index })}
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
