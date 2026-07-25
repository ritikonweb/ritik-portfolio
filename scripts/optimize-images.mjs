// One-off image optimizer for the hero portraits.
// Encodes the two aligned PNG sources to WebP at identical dimensions so the
// reveal mask stays pixel-perfect. Run with: node scripts/optimize-images.mjs
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const DIR = path.join(process.cwd(), "public", "images");
const TARGETS = [
  { file: "Base_image_desktop.png", quality: 86 },
  { file: "Reveal_image_desktop.png", quality: 78 },
];

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

for (const { file, quality } of TARGETS) {
  const input = path.join(DIR, file);
  const output = input.replace(/\.png$/i, ".webp");
  const before = (await stat(input)).size;
  const meta = await sharp(input).metadata();
  await sharp(input).webp({ quality, effort: 6 }).toFile(output);
  const after = (await stat(output)).size;
  console.log(`${file}: ${kb(before)} -> ${kb(after)} (${meta.width}x${meta.height})`);
}

const files = await readdir(DIR);
console.log("\nimages dir:", files.join(", "));
