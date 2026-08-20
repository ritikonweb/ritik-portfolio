import type { Metadata, Viewport } from "next";
import { Albert_Sans, Fragment_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { PHProvider } from "@/app/providers";
import site from "@/content/site.json";
import "./globals.css";

const albert = Albert_Sans({ subsets: ["latin"], variable: "--font-albert", display: "swap" });
const fragment = Fragment_Mono({ weight: "400", subsets: ["latin"], variable: "--font-fragment", display: "swap" });

// 1200x630 is the ratio LinkedIn, WhatsApp and X all expect, and 43 KB fetches fast enough
// that no scraper gives up and renders a preview with no image. Regenerate with
// scripts/make-og.mjs after changing the hero. The full resolution hero is still used for
// the Person schema image, where file size does not matter.
const ogImage = { url: "/images/og-cover.jpg", width: 1200, height: 630, alt: `${site.identity.name}, ${site.identity.location}` };
const portrait = "/images/Base_image_desktop.png";

export const metadata: Metadata = {
  metadataBase: new URL(site.metadata.siteUrl),
  title: { default: site.metadata.title, template: `%s | ${site.identity.name}` },
  description: site.metadata.description,
  // Google treats application-name as a site name candidate. It used to read
  // "Ritik Yadav Portfolio" while the manifest, og:site_name and the WebSite schema all
  // said "Ritik Yadav", and a disagreeing set of signals is why Google fell back to
  // showing the bare domain. Every signal now says the same three words.
  applicationName: site.identity.name,
  authors: [{ name: site.identity.name, url: site.metadata.siteUrl }],
  creator: site.identity.name,
  publisher: site.identity.name,
  keywords: ["Ritik Yadav", "Ritik Yadav portfolio", "Ritik Yadav Bangalore", "Ritik Yadav strategy", "program management", "business operations", "chief of staff", "strategy and operations", "Flow Realty", "Rustomjee"],
  category: "Business",
  // The markdown alternate is the same content an agent gets from GET / with
  // Accept: text/markdown. Advertised here too, for anything that only parses HTML.
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/index.md", "text/plain": "/llms.txt" },
  },
  openGraph: {
    title: site.metadata.title,
    description: site.metadata.description,
    url: "/",
    siteName: site.identity.name,
    locale: "en_IN",
    type: "profile",
    images: [ogImage],
  },
  twitter: { card: "summary_large_image", title: site.metadata.title, description: site.metadata.description, images: [ogImage.url] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#e7f4fb" };

const personSchema = {
  "@type": "Person",
  "@id": `${site.metadata.siteUrl}/#person`,
  name: site.identity.name,
  url: site.metadata.siteUrl,
  image: `${site.metadata.siteUrl}${portrait}`,
  email: `mailto:${site.contact.email}`,
  telephone: `+91${site.contact.phone}`,
  jobTitle: "Program Management, Strategy and Business Operations",
  description: site.metadata.description,
  address: { "@type": "PostalAddress", addressLocality: "Bangalore", addressRegion: "Karnataka", addressCountry: "IN" },
  worksFor: { "@type": "Organization", name: site.journey.items[0].organization },
  alumniOf: site.education.items.map((item) => ({ "@type": "CollegeOrUniversity", name: item.institution })),
  // Every profile listed here helps Google tie the same person together.
  sameAs: [site.contact.linkedin, ...(("profiles" in site.identity ? (site.identity as { profiles?: string[] }).profiles : []) ?? [])].filter(Boolean),
  // Points an assistant at the documents written to be quoted, rather than leaving it to
  // reconstruct answers from the page layout.
  subjectOf: [
    { "@type": "DigitalDocument", name: "Machine-readable profile", url: `${site.metadata.siteUrl}/index.md`, encodingFormat: "text/markdown" },
    { "@type": "DigitalDocument", name: "Answer corpus", url: `${site.metadata.siteUrl}/answers.json`, encodingFormat: "application/json" },
  ],
  knowsLanguage: ["en", "hi"],
  nationality: { "@type": "Country", name: "India" },
  knowsAbout: site.skills.groups.flatMap((group) => group.items),
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${site.metadata.siteUrl}/#website`,
      url: site.metadata.siteUrl,
      // Google uses these for the site name shown above the search result. Keep
      // alternateName short: listing "Ritik Yadav Portfolio" gave Google licence to
      // display that instead of the name actually wanted.
      name: site.identity.name,
      alternateName: ["Ritik"],
      inLanguage: "en",
      publisher: { "@id": `${site.metadata.siteUrl}/#person` },
    },
    { "@type": "ProfilePage", "@id": `${site.metadata.siteUrl}/#profile`, url: site.metadata.siteUrl, name: site.metadata.title, isPartOf: { "@id": `${site.metadata.siteUrl}/#website` }, about: { "@id": `${site.metadata.siteUrl}/#person` }, mainEntity: { "@id": `${site.metadata.siteUrl}/#person` } },
    personSchema,
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={site.metadata.language} className={`${albert.variable} ${fragment.variable}`}>
      <body>
        <PHProvider>
          {children}
        </PHProvider>
        <Analytics />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </body>
    </html>
  );
}
