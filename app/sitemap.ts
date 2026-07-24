import type { MetadataRoute } from "next";

const base = "https://ritik.co.in";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${base}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/#about`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/#experience`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/#projects`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/#education`, lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/#contact`, lastModified, changeFrequency: "yearly", priority: 0.6 },
  ];
}
