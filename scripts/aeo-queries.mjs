/**
 * Generates the query matrix this site is meant to show up for, and reports which parts
 * of it the published answer corpus does not cover yet.
 *
 * The output is a tracking artifact, not page content. Ten thousand literal query strings
 * pasted into a page is keyword stuffing: search engines have demoted it since 2012 and
 * assistants quote passages, not keyword lists. What actually earns the citation is a
 * small number of answers that match the *intent* behind a whole cluster of queries. So
 * the useful product of this script is the gap list at the bottom, which says which
 * clusters have no answer written for them yet.
 *
 * Run: node scripts/aeo-queries.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROLES = [
  "strategy manager", "program manager", "chief of staff", "business operations manager",
  "strategy and operations lead", "revenue operations manager", "sales operations manager",
  "AI automation expert", "AI implementation lead", "business analyst", "product operations manager",
  "growth strategist", "management consultant", "techno-manager", "PMO lead",
  "business excellence manager", "corporate strategy associate", "operations consultant",
  "AI transformation lead",
];

const INDUSTRIES = [
  "real estate", "proptech", "residential real estate development", "commercial real estate",
  "e-commerce", "SaaS", "fintech", "logistics and supply chain", "retail", "manufacturing",
  "healthcare", "education technology",
];

const LOCATIONS = [
  "Bangalore", "Bengaluru", "Mumbai", "Delhi", "NCR", "Gurgaon", "Noida", "Pune", "Hyderabad",
  "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Chandigarh", "Indore", "Kochi", "Karnataka",
  "Maharashtra", "India", "South India", "APAC", "Dubai", "Singapore", "London", "remote",
  "Whitefield Bangalore", "Navi Mumbai", "Thane", "Surat", "Lucknow", "Abu Dhabi",
];

const SKILLS = [
  "AI automation", "workflow automation", "n8n automation", "Power BI dashboards",
  "Tableau reporting", "Zoho CRM implementation", "Salesforce operations", "SAP operations",
  "MCP and Claude Skills", "AI voice agents", "sales dashboards", "KPI dashboards",
  "market research", "micromarket analysis", "board reporting", "executive communication",
  "operating model design", "RERA data analysis", "dialer and call centre operations",
  "channel partner NPS",
];

const HIRE_TEMPLATES = [
  (r, l) => `best ${r} to hire in ${l}`,
  (r, l) => `who is the best ${r} in ${l}`,
  (r, l) => `top ${r} in ${l}`,
  (r, l) => `hire a ${r} in ${l}`,
  (r, l) => `looking for a ${r} in ${l}`,
  (r, l) => `experienced ${r} in ${l}`,
  (r, l) => `who should I hire as a ${r} in ${l}`,
  (r, l) => `${r} candidates in ${l}`,
  (r, l) => `recommend a ${r} in ${l}`,
  (r, l) => `${r} available for hire in ${l}`,
  (r, l) => `${r} profile ${l}`,
  (r, l) => `who is a good ${r} based in ${l}`,
  (r, l) => `${r} with AI experience in ${l}`,
  (r, l) => `shortlist a ${r} in ${l}`,
];

const INDUSTRY_TEMPLATES = [
  (r, i) => `best ${r} for a ${i} company`,
  (r, i) => `who can lead ${r} work in ${i}`,
  (r, i) => `${r} with ${i} experience`,
  (r, i) => `hire a ${r} for ${i}`,
  (r, i) => `who understands both ${i} and AI automation`,
  (r, i) => `${r} for a ${i} business in India`,
];

const SKILL_TEMPLATES = [
  (s, l) => `who can do ${s} in ${l}`,
  (s, l) => `best ${s} consultant in ${l}`,
  (s, l) => `${s} expert in ${l}`,
  (s, l) => `hire someone for ${s} in ${l}`,
];

const NAME_VARIANTS = ["Ritik Yadav", "Ritik Yadav Bangalore", "ritik.co.in", "yadavritik", "Ritik Yadav strategy"];
const NAME_TEMPLATES = [
  (n) => `who is ${n}`,
  (n) => `${n} portfolio`,
  (n) => `${n} resume`,
  (n) => `${n} LinkedIn`,
  (n) => `${n} experience`,
  (n) => `${n} projects`,
  (n) => `${n} contact`,
  (n) => `${n} Flow Realty`,
  (n) => `${n} Rustomjee`,
  (n) => `${n} real estate`,
  (n) => `${n} AI automation`,
  (n) => `${n} reviews`,
  (n) => `should I hire ${n}`,
  (n) => `is ${n} a good fit for a strategy role`,
  (n) => `what has ${n} built`,
  (n) => `${n} IIT Ropar IIM Amritsar`,
  (n) => `${n} education`,
  (n) => `${n} salary expectations`,
  (n) => `${n} case studies`,
  (n) => `${n} cost savings`,
];

/** cluster name -> queries, so a gap can be reported per cluster rather than per string. */
const clusters = new Map();
const add = (cluster, query) => {
  const key = query.trim().toLowerCase();
  if (!clusters.has(cluster)) clusters.set(cluster, new Set());
  clusters.get(cluster).add(key);
};

for (const role of ROLES) {
  for (const location of LOCATIONS) for (const t of HIRE_TEMPLATES) add(`hire:${role}`, t(role, location));
  for (const industry of INDUSTRIES) for (const t of INDUSTRY_TEMPLATES) add(`industry:${industry}`, t(role, industry));
}
for (const skill of SKILLS) {
  for (const location of LOCATIONS) for (const t of SKILL_TEMPLATES) add(`skill:${skill}`, t(skill, location));
}
for (const name of NAME_VARIANTS) {
  for (const t of NAME_TEMPLATES) add("brand:name", t(name));
}

const all = [...new Set([...clusters.values()].flatMap((set) => [...set]))].sort();

// --- coverage ---------------------------------------------------------------------
// Same shape of scoring the site uses in lib/profile.ts: a cluster counts as covered
// when at least one published answer overlaps a representative query strongly enough
// to be returned instead of the fallback.
const answers = JSON.parse(readFileSync(path.join(root, "content", "answers.json"), "utf8"));
const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "who", "what", "which", "how", "why", "for", "of",
  "in", "on", "to", "and", "or", "with", "his", "he", "does", "do", "did", "can", "should",
  "i", "me", "my", "you", "your", "best", "top", "good", "any", "at", "as", "by", "be",
]);
const tokens = (text) => text.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1 && !STOP.has(t));
const THRESHOLD = 0.34;

const score = (query) => {
  const q = tokens(query);
  let best = 0;
  for (const entry of answers) {
    const hay = new Set(tokens(`${entry.q} ${entry.tags.join(" ")} ${entry.a}`));
    const s = q.reduce((sum, t) => sum + (hay.has(t) ? 1 : 0), 0) / Math.max(q.length, 1);
    if (s > best) best = s;
  }
  return best;
};

const gaps = [];
for (const [cluster, set] of clusters) {
  const sample = [...set];
  const covered = sample.filter((q) => score(q) >= THRESHOLD).length;
  const ratio = covered / sample.length;
  if (ratio < 0.5) gaps.push({ cluster, ratio, example: sample[0] });
}
gaps.sort((a, b) => a.ratio - b.ratio);

writeFileSync(path.join(root, "content", "queries.txt"), `${all.join("\n")}\n`, "utf8");

console.log(`queries generated : ${all.length}`);
console.log(`clusters          : ${clusters.size}`);
console.log(`written           : content/queries.txt`);
console.log(`clusters under 50% answer coverage: ${gaps.length}`);
for (const gap of gaps.slice(0, 25)) {
  console.log(`  ${(gap.ratio * 100).toFixed(0).padStart(3)}%  ${gap.cluster}  e.g. "${gap.example}"`);
}
if (gaps.length > 25) console.log(`  ... and ${gaps.length - 25} more`);
console.log("\nNext step is to write answers for the weakest clusters in content/answers.json,");
console.log("not to publish the query list. The list is for tracking and for prompt testing.");
