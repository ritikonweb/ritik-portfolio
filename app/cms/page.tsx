import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Content Studio - Ritik Yadav",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function CmsPage() {
  return (
    <main id="nc-root" aria-label="Ritik Yadav content studio">
      <noscript>JavaScript is required to use the content editor.</noscript>
      <Script src="https://unpkg.com/decap-cms@3.15.0/dist/decap-cms.js" strategy="afterInteractive" />
    </main>
  );
}
