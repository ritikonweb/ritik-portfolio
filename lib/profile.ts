import site from "@/content/site.json";
import answers from "@/content/answers.json";

/**
 * One derivation of the profile, shared by every agent-facing surface: the markdown
 * representation served under content negotiation, the MCP tools, the A2A endpoint and
 * the answer corpus. content/site.json stays the single source of truth, so a CMS edit
 * updates all of them at once and nothing can drift.
 */

export const SITE_URL = site.metadata.siteUrl;
export const NAME = site.identity.name;

export type Answer = { q: string; a: string; tags: string[] };
export const ANSWERS = answers as Answer[];

/** Full profile as markdown. This is what an agent gets instead of scraping the page. */
export function profileMarkdown(): string {
  const s = site;
  const lines: string[] = [
    `# ${s.identity.name}`,
    "",
    `> ${s.metadata.description}`,
    "",
    `- Location: ${s.identity.location}`,
    `- Canonical URL: ${SITE_URL}`,
    `- LinkedIn: ${s.contact.linkedin}`,
    `- Email: ${s.contact.email}`,
    `- Phone: +91 ${s.contact.phone}`,
    `- Book a call: ${s.contact.calendar}`,
    `- CV (PDF): ${s.contact.resume}`,
    "",
    "## Summary",
    "",
    ...s.about.paragraphs,
    "",
    "## Measured impact",
    "",
    ...s.impact.items.map((i) => `- ${i.value} ${i.label}, ${i.context}`),
    "",
    "## Experience",
    "",
  ];

  for (const job of s.journey.items) {
    const focus = "focus" in job && job.focus ? ` (${job.focus})` : "";
    lines.push(`### ${job.role}${focus} — ${job.organization}`, `${job.period}`, "");
    lines.push(...job.points.map((p) => `- ${p}`), "");
  }

  lines.push("## Projects", "");
  for (const p of s.projects.items) {
    lines.push(`- **[${p.name}](${p.url})** — ${p.description}`);
  }

  lines.push("", "## Skills", "");
  for (const group of s.skills.groups) {
    lines.push(`- **${group.name}**: ${group.items.join(", ")}`);
  }

  lines.push("", "## Education", "");
  for (const e of s.education.items) {
    lines.push(`- ${e.degree}, ${e.institution} (${e.period})`);
  }

  lines.push(
    "",
    "## Frequently asked",
    "",
    ...ANSWERS.flatMap((entry) => [`**${entry.q}**`, "", entry.a, ""]),
    "## Machine-readable resources",
    "",
    `- Markdown profile: ${SITE_URL}/index.md`,
    `- Answer corpus: ${SITE_URL}/answers.json`,
    `- OpenAPI: ${SITE_URL}/openapi.json`,
    `- API catalog: ${SITE_URL}/.well-known/api-catalog`,
    `- MCP endpoint: ${SITE_URL}/api/mcp`,
    `- A2A agent card: ${SITE_URL}/.well-known/agent-card.json`,
    "",
  );

  return lines.join("\n");
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "who", "what", "which", "how", "why", "for", "of",
  "in", "on", "to", "and", "or", "with", "his", "he", "does", "do", "did", "can", "should",
  "i", "me", "my", "you", "your", "best", "top", "good", "any", "at", "as", "by", "be",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Answers a natural-language question from the corpus.
 *
 * ponytail: token-overlap scoring, not embeddings. Ceiling is vocabulary mismatch, e.g.
 * "PM" will not match "program manager". Upgrade path is to precompute embeddings for
 * content/answers.json and swap the scorer, keeping this signature.
 */
export function ask(question: string): { question: string; answer: string; matched: string | null } {
  const q = tokens(question);
  let best: Answer | null = null;
  let bestScore = 0;

  for (const entry of ANSWERS) {
    const haystack = new Set(tokens(`${entry.q} ${entry.tags.join(" ")} ${entry.a}`));
    const score = q.reduce((sum, t) => sum + (haystack.has(t) ? 1 : 0), 0) / Math.max(q.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // Below this the "match" is one incidental word, and a wrong confident answer is worse
  // than handing the agent the whole profile.
  if (!best || bestScore < 0.34) {
    return {
      question,
      answer: `No direct match in the answer corpus. Full profile: ${SITE_URL}/index.md. Contact ${site.contact.email} or ${site.contact.calendar}.`,
      matched: null,
    };
  }
  return { question, answer: best.a, matched: best.q };
}
