// Writes .env.production from the deployment URLs that `convex deploy --cmd`
// injects into the environment. The frontend workflow consumes this file (via
// the convex-generated artifact) so it never needs a Convex deploy key.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.VITE_CONVEX_URL;

if (!url) {
  console.error("VITE_CONVEX_URL is not set; run this via `convex deploy --cmd`.");
  process.exit(1);
}

const lines = [`VITE_CONVEX_URL=${url}`];
if (process.env.VITE_CONVEX_SITE_URL) {
  lines.push(`VITE_CONVEX_SITE_URL=${process.env.VITE_CONVEX_SITE_URL}`);
}

const out = path.join(root, ".env.production");
await writeFile(out, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${path.relative(root, out)} (${url})`);
