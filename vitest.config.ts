import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
