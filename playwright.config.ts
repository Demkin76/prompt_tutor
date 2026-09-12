import { defineConfig } from "@playwright/test";
const basePath = (process.env.BASE_URL ?? "/").replace(/\/?$/, "/");
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:4180${basePath}`, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  webServer: { command: "npm run preview -- --host 127.0.0.1 --port 4180", url: `http://127.0.0.1:4180${basePath}`, reuseExistingServer: !process.env.CI },
});
