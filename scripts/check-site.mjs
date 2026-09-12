import { readFile, access } from "node:fs/promises";
import path from "node:path";
const base = (process.env.BASE_URL ?? "/").replace(/\/?$/, "/");
const pages = ["index", "levels", "technology", "world", "play"];
const missing = [];
for (const page of pages) {
  const html = await readFile(`dist/${page}.html`, "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:https?:|data:|mailto:|#)/.test(ref)) continue;
    const resource = ref.split(/[?#]/)[0];
    const file = resource.startsWith(base) ? resource.slice(base.length) : resource.replace(/^\//, "");
    try { await access(path.join("dist", decodeURIComponent(file))); }
    catch { missing.push(`${page}.html → ${ref}`); }
  }
}
if (missing.length) throw new Error(`Broken build references:\n${missing.join("\n")}`);
console.log(`All ${pages.length} pages and their local links/assets exist (base ${base}).`);
