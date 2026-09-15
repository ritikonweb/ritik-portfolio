"use client";

import { useEffect, useRef } from "react";
import site from "@/content/site.json";
import { useSound } from "@/components/sound-provider";

type Post = { text: string; date: string; url: string; tags?: string[] };

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

function Card({ post, ariaHidden }: { post: Post; ariaHidden?: boolean }) {
  const { play } = useSound();

  return (
    <a
      className="li-card"
      href={post.url}
      target="_blank"
      rel="noreferrer"
      aria-hidden={ariaHidden}
      tabIndex={ariaHidden ? -1 : undefined}
      onClick={() => {
        if (!ariaHidden) {
          play("open", { isUserGesture: true });
        }
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse" && !ariaHidden) {
          play("hover", { isUserGesture: true, cooldownMs: 120 });
        }
      }}
    >
      <span className="li-meta"><span className="li-badge">LinkedIn</span><time dateTime={post.date}>{formatDate(post.date)}</time></span>
      <p className="li-text">{post.text}</p>
      <span className="li-foot">{post.tags && post.tags.length > 0 ? <span className="li-tags">{post.tags.map((tag) => `#${tag}`).join(" ")}</span> : <span />}<span className="li-read">Read on LinkedIn <span aria-hidden="true">↗</span></span></span>
    </a>
  );
}

export default function LinkedInFeed() {
  const stripRef = useRef<HTMLDivElement>(null);

  // Only animate while the strip is on screen, so it never burns CPU or battery in the background.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => strip.classList.toggle("is-running", entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const posts = (site.linkedin ?? []) as Post[];
  if (posts.length === 0) return null;
  const ordered = [...posts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return (
    <div ref={stripRef} className="li-strip section-shell" aria-label="Latest updates from LinkedIn">
      <div className="li-track">
        {ordered.map((post, index) => <Card key={`post-${index}-${post.date}`} post={post} />)}
        {ordered.map((post, index) => <Card key={`dup-${index}-${post.date}`} post={post} ariaHidden />)}
      </div>
    </div>
  );
}
