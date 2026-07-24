// Zero-dependency LinkedIn updates sync.
// Reads a free feed (JSON array or RSS) from env LINKEDIN_FEED_URL and writes
// the latest posts into content/site.json -> "linkedin". Commits only on change
// (the GitHub Action handles the commit). If no feed URL is set, it exits cleanly.
//
// JSON feed shape (recommended): [{ "text": "...", "date": "YYYY-MM-DD", "url": "https://...", "tags": ["A","B"] }]
// RSS feed: standard <item><title>/<link>/<pubDate>/<category> elements.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_PATH = resolve(__dirname, "..", "content", "site.json");
const MAX_POSTS = 6;

const feedUrl = process.env.LINKEDIN_FEED_URL;
if (!feedUrl) {
  console.log("LINKEDIN_FEED_URL not set. Nothing to sync (posts stay CMS-managed).");
  process.exit(0);
}

const toIsoDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const decode = (s) =>
  s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();

const parseRss = (xml) => {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)].map((m) => m[0]);
  return items.map((item) => {
    const pick = (tag) => {
      const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return match ? decode(match[1]) : "";
    };
    const tags = [...item.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => decode(c[1])).slice(0, 3);
    return { text: pick("title") || pick("description"), date: toIsoDate(pick("pubDate")) || new Date().toISOString().slice(0, 10), url: pick("link"), tags };
  });
};

const normalize = (raw) =>
  raw
    .filter((p) => p && p.text && p.url)
    .map((p) => ({ text: String(p.text).slice(0, 240), date: toIsoDate(p.date) || new Date().toISOString().slice(0, 10), url: String(p.url), ...(Array.isArray(p.tags) && p.tags.length ? { tags: p.tags.slice(0, 3).map(String) } : {}) }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter((p, i, arr) => arr.findIndex((x) => x.url === p.url) === i)
    .slice(0, MAX_POSTS);

async function main() {
  const res = await fetch(feedUrl, { headers: { "user-agent": "ritik-portfolio-sync" } });
  if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  const raw = contentType.includes("json") || body.trim().startsWith("[") ? JSON.parse(body) : parseRss(body);
  const posts = normalize(raw);
  if (posts.length === 0) {
    console.log("Feed returned no usable posts. Skipping.");
    return;
  }
  const site = JSON.parse(readFileSync(SITE_PATH, "utf8"));
  if (JSON.stringify(site.linkedin) === JSON.stringify(posts)) {
    console.log("No change in LinkedIn posts.");
    return;
  }
  site.linkedin = posts;
  writeFileSync(SITE_PATH, `${JSON.stringify(site, null, 2)}\n`);
  console.log(`Updated content/site.json with ${posts.length} posts.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
