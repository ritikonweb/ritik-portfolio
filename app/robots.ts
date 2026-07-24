import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/cms/", "/cms"] },
    sitemap: "https://ritik.co.in/sitemap.xml",
    host: "https://ritik.co.in",
  };
}
