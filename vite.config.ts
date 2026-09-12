import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const baseUrl = process.env.BASE_URL ?? "/";

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  if (command === "build" && mode === "production" && !env.VITE_CONVEX_URL && env.VITE_DEMO_MODE !== "true") {
    throw new Error("Production requires VITE_CONVEX_URL. For an explicitly labeled offline demo use npm run build:demo.");
  }
  if (env.VITE_CONVEX_URL) {
    const url = new URL(env.VITE_CONVEX_URL);
    if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/" || url.hostname.endsWith(".convex.site")) {
      throw new Error("VITE_CONVEX_URL must be the Convex client deployment URL (https://<deployment>.convex.cloud), not an HTTP actions URL.");
    }
  }
  return {
  root: "app",
  base: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  // .env / .env.local live in the project root (next to convex/), not in app/.
  envDir: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@runtime": path.resolve(__dirname, "src/runtime"),
      "@convex": path.resolve(__dirname, "convex"),
    },
  },
  build: {
    outDir: "../dist", emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(["index", "levels", "technology", "world", "play"].map(page => [page, path.resolve(__dirname, `app/${page}.html`)])) },
  },
  test: { include: ["src/**/*.test.ts", "convex/**/*.test.ts"], root: "." },
  };
});
