import type { Metadata } from "next";
import { ANSWERS, NAME, SITE_URL } from "@/lib/profile";

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
  description: `Direct answers about ${NAME}: what he has delivered in strategy, program management, business operations and AI automation, where he has worked, what he has built, and how to reach him.`,
  alternates: { canonical: "/answers/" },
  // Deliberately kept out of search results. The corpus is meant for agents, and a human
  // arriving on 52 self-authored Q&As about why to hire the author reads badly. It is
  // noindex rather than robots.txt Disallow on purpose: Disallow would stop AI crawlers
  // reading the page at all, which is the opposite of what this page is for. noindex lets
  // them read and quote it while keeping it out of the listings.
  robots: { index: false, follow: true },
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
          <header className="section-heading">
            <p className="eyebrow">Reference / Answers</p>
            <h2 id="answers-title">Questions about my work, answered.</h2>
          </header>

          <div className="about-lead">
            <p>
              Every answer below is the same text served to AI assistants at{" "}
              <a href="/answers.json">/answers.json</a> and{" "}
              <a href="/index.md">/index.md</a>, so a quoted answer and a spoken one say
              the same thing. If something is missing,{" "}
              <a href="https://cal.com/ritikyadav/30min">book thirty minutes</a>.
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
            <a href="/">Back to the portfolio</a>
          </p>
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </main>
  );
}
