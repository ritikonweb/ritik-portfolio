// Renders the PNG icons from app/icon.svg so every platform gets a raster fallback.
// Run after editing the SVG:  node scripts/make-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = await readFile(path.join(root, "app", "icon.svg"));

const targets = [
  // Next serves these automatically from the app directory.
  { file: path.join(root, "app", "apple-icon.png"), size: 180, padding: 0 },
  { file: path.join(root, "app", "icon.png"), size: 64, padding: 0 },
];

for (const { file, size } of targets) {
  await sharp(source, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`wrote ${path.relative(root, file)} at ${size}x${size}`);
}

// A .ico is still the most compatible favicon for older browsers and some crawlers.
// sharp cannot write .ico, so pack a single 32x32 PNG into a minimal ICO container.
const png = await sharp(source, { density: 512 }).resize(32, 32).png({ compressionLevel: 9 }).toBuffer();
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0); // width
entry.writeUInt8(32, 1); // height
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // colour planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);
await writeFile(path.join(root, "app", "favicon.ico"), Buffer.concat([header, entry, png]));
console.log("wrote app/favicon.ico at 32x32");
