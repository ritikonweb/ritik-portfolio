/**
 * Pushes URLs to IndexNow so Bing, Yandex, Naver and Seznam crawl on demand instead of
 * whenever they get round to it.
 *
 * Bing is the reason this exists: ChatGPT's search grounding reads Bing's index, so a
 * page Bing has not recrawled is a page ChatGPT cannot cite. Google does not participate
 * in IndexNow, so Google still needs Search Console.
 *
 * The key is public by design. IndexNow proves domain ownership by fetching
 * https://ritik.co.in/<key>.txt and checking it contains the same key, so committing both
 * is correct, not a leak. Both come from the constant below, so they cannot drift apart.
 *
 * Run: npm run indexnow            (submits the canonical URL set)
 *      npm run indexnow -- <url>   (submits specific URLs)
 */

const KEY = "348cd8aff311ac5502d7846f287836f2";
const HOST = "ritik.co.in";

// Only pages, and only pages meant to be indexed. Keep this in step with app/sitemap.ts.
const DEFAULT_URLS = [`https://${HOST}/`, `https://${HOST}/answers/`];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

for (const url of urls) {
  if (!url.startsWith(`https://${HOST}/`)) {
    console.error(`refusing ${url}: IndexNow rejects URLs outside the submitting host`);
    process.exit(1);
  }
}

// Verify the key file is actually reachable first. A 404 here is the single most common
// reason IndexNow silently rejects everything, and it is invisible from the 200 the
// submission endpoint returns.
const keyUrl = `https://${HOST}/${KEY}.txt`;
const keyCheck = await fetch(keyUrl, { cache: "no-store" });
if (!keyCheck.ok || (await keyCheck.text()).trim() !== KEY) {
  console.error(`key file not serving correctly at ${keyUrl} (status ${keyCheck.status})`);
  console.error("Deploy first: IndexNow fetches this to verify you own the domain.");
  process.exit(1);
}
console.log(`key file ok at ${keyUrl}`);

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: keyUrl, urlList: urls }),
});

// 200 accepted, 202 accepted but key still validating. Anything else is worth reading.
const body = await response.text();
console.log(`IndexNow: ${response.status} ${response.statusText} ${body.slice(0, 200)}`);
for (const url of urls) console.log("  submitted", url);

if (response.status !== 200 && response.status !== 202) process.exit(1);
console.log("\nGoogle does not use IndexNow. Request indexing in Search Console separately.");
