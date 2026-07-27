import type { MetadataRoute } from "next";

const base = "https://ritik.co.in";

/**
 * One page, one entry.
 *
 * Fragment URLs like /#about were listed here previously. Google strips the fragment when
 * it reads a sitemap, so those five lines were submitted as the homepage five extra times.
 * At best it is noise, at worst it looks like a sitemap full of duplicates. Anchors are
 * discovered from the page's own navigation anyway.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
