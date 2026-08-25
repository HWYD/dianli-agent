import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const launchOptions = existsSync(systemChromePath) ? { executablePath: systemChromePath } : undefined;
const externallyManagedBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externallyManagedBaseUrl ?? "http://127.0.0.1:3001";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL,
    launchOptions,
    trace: "retain-on-failure",
  },
  webServer: externallyManagedBaseUrl
    ? undefined
    : {
        command: "pnpm dev --port 3001",
        url: "http://127.0.0.1:3001",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
