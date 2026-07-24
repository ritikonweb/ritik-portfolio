"use client";

import site from "@/content/site.json";

type Post = { text: string; date: string; url: string; tags?: string[] };

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

function Card({ post, ariaHidden }: { post: Post; ariaHidden?: boolean }) {
  return (
    <a className="li-card" href={post.url} target="_blank" rel="noreferrer" aria-hidden={ariaHidden} tabIndex={ariaHidden ? -1 : undefined}>
      <span className="li-meta"><span className="li-badge">LinkedIn</span><time dateTime={post.date}>{formatDate(post.date)}</time></span>
      <p className="li-text">{post.text}</p>
      <span className="li-foot">{post.tags && post.tags.length > 0 ? <span className="li-tags">{post.tags.map((tag) => `#${tag}`).join(" ")}</span> : <span />}<span className="li-read">Read on LinkedIn <span aria-hidden="true">↗</span></span></span>
    </a>
  );
}

export default function LinkedInFeed() {
  const posts = (site.linkedin ?? []) as Post[];
  if (posts.length === 0) return null;
  const ordered = [...posts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return (
    <div className="li-strip section-shell" aria-label="Latest updates from LinkedIn">
      <div className="li-track">
        {ordered.map((post) => <Card key={post.url} post={post} />)}
        {ordered.map((post) => <Card key={`dup-${post.url}`} post={post} ariaHidden />)}
      </div>
    </div>
  );
}
