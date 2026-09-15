import type { Metadata } from "next";
import { ANSWERS, NAME, SITE_URL } from "@/lib/profile";
import BackLink from "@/components/back-link";

/**
 * The answer page. Assistants quote passages that already read like an answer to the
 * question asked, so the same corpus that backs /answers.json, the MCP `ask` tool and the
 * A2A endpoint is rendered here as visible text. Visible is the point: FAQPage markup is
 * only allowed to describe content a human can actually see on the page.
 *
 * Existing section classes are reused so this needs no new CSS.
 */

export const metadata: Metadata = {
  title: "Questions about Ritik Yadav, answered",
  // Kept under 160 characters. Crawlers flag anything longer and truncate the display.
  description: `Direct answers about ${NAME}: what he delivered in strategy, program management and AI automation, what he has built, and how to reach him.`,
  alternates: { canonical: "/answers/" },
  // Indexable on purpose. This was noindex for a while, on the reasoning that a human
  // landing cold on 52 self-authored answers reads badly. That was a tone problem, and it
  // is now handled by the note in the intro rather than by hiding the page. Most AI
  // citation is retrieved from a search index, so noindex removed the corpus from the
  // route that carries the majority of it, which is the whole reason the corpus exists.
  openGraph: {
    title: `Questions about ${NAME}, answered`,
    description: `Direct answers about the experience, measured results and availability of ${NAME}.`,
    url: "/answers/",
    type: "website",
  },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${SITE_URL}/answers/#faq`,
  url: `${SITE_URL}/answers/`,
  about: { "@id": `${SITE_URL}/#person` },
  mainEntity: ANSWERS.map((entry) => ({
    "@type": "Question",
    name: entry.q,
    acceptedAnswer: { "@type": "Answer", text: entry.a },
  })),
};

export default function AnswersPage() {
  return (
    <main id="main-content">
      <section className="content-section about-section" aria-labelledby="answers-title">
        <div className="section-shell">
          {/* h1, not h2. The homepage pattern this markup was copied from puts the h1 in
              the hero, so a standalone page inheriting it had no h1 at all. Styling is
              unchanged: globals.css matches .section-heading h1 alongside h2. */}
          <header className="section-heading">
            <p className="eyebrow">Reference / Answers</p>
            <h1 id="answers-title">Questions about my work, answered.</h1>
          </header>

          {/* The third person reads oddly to a human, so say why up front. It is the
              reason the page works when an assistant lifts a passage, and explaining it
              costs one paragraph. */}
          <div className="about-lead">
            <p>
              These answers are written in the third person on purpose. AI assistants quote
              them when someone asks about my work, so each one has to say who it is about
              and carry its own evidence. If you are a person reading this, you are getting
              exactly what an assistant gets.
            </p>
            <p>
              It is the same text served at <a href="/answers.json">/answers.json</a> and{" "}
              <a href="/index.md">/index.md</a>, so a quoted answer and a spoken one never
              disagree. If something is missing,{" "}
              <a href="https://cal.com/ritikyadav/30min">book thirty minutes</a> and ask me
              directly.
            </p>
          </div>

          <div className="compact-list">
            {/* Two cells per row, matching the education list: the topic tag sits in the
                narrow first column, the question and answer in the wide one. */}
            {ANSWERS.map((entry) => (
              <article key={entry.q}>
                <p className="organization">{entry.tags[0]}</p>
                <div>
                  <h3>{entry.q}</h3>
                  <p>{entry.a}</p>
                </div>
              </article>
            ))}
          </div>

          <p className="footer-line" style={{ borderTop: "1px solid var(--line)", color: "var(--muted)" }}>
            <BackLink href="/">Back to the portfolio</BackLink>
          </p>
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </main>
  );
}
