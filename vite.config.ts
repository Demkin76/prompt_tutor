import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "app",
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
