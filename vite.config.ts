import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const baseUrl = process.env.BASE_URL ?? "/";

export default defineConfig({
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
  build: { outDir: "../dist", emptyOutDir: true },
  test: { include: ["src/**/*.test.ts", "convex/**/*.test.ts"], root: "." },
});
