// Builds the social share card from the hero portrait.
// Run after changing the hero image:  node scripts/make-og.mjs
//
// Why this exists: metadata pointed at the raw hero PNG, 1672x941 and 1.65 MB. LinkedIn,
// WhatsApp and X all want roughly 1.91:1 at a modest file size, and some scrapers give up
// on a slow fetch, which shows as a link with no preview.
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "public", "images", "Base_image_desktop.png");
const target = path.join(root, "public", "images", "og-cover.jpg");

const WIDTH = 1200;
const HEIGHT = 630;

const image = sharp(source);
const { width = 0, height = 0 } = await image.metadata();

// Crop to the share ratio from the top, because the hero's subject sits high in frame.
const cropHeight = Math.min(height, Math.round(width / (WIDTH / HEIGHT)));

await image
  .extract({ left: 0, top: 0, width, height: cropHeight })
  .resize(WIDTH, HEIGHT, { fit: "cover" })
  // Progressive JPEG so slow connections show something early. mozjpeg for the size win.
  .jpeg({ quality: 82, progressive: true, mozjpeg: true })
  .toFile(target);

const out = await sharp(target).metadata();
console.log(`wrote public/images/og-cover.jpg ${out.width}x${out.height}, ${(out.size / 1024).toFixed(1)} KB`);
console.log(`source was ${width}x${height}`);
