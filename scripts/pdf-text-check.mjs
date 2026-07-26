// Rough ATS readability check: can plain text be pulled out of the PDF?
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const buf = readFileSync(process.argv[2]);
let pos = 0;
let text = "";
while (true) {
  const start = buf.indexOf("stream", pos);
  if (start === -1) break;
  let d = start + 6;
  if (buf[d] === 0x0d) d++;
  if (buf[d] === 0x0a) d++;
  const end = buf.indexOf("endstream", d);
  if (end === -1) break;
  try {
    const s = inflateSync(buf.subarray(d, end)).toString("latin1");
    if (/\(|TJ|Tj/.test(s)) {
      for (const m of s.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) text += m[1] + " ";
    }
  } catch {}
  pos = end + 9;
}
const clean = text.replace(/\\[0-7]{3}/g, "").replace(/\s+/g, " ");
const must = ["RITIK", "YADAV", "Flow", "Realty", "Rustomjee", "Ozonetel", "Zoho", "Revenue", "Operations", "NLSIU", "Tableau", "Salesforce"];
console.log("extracted chars:", clean.length);
console.log("keyword check:");
for (const k of must) console.log(`  ${k}: ${clean.includes(k) ? "found" : "MISSING"}`);
console.log("\nsample:", clean.slice(0, 220));
