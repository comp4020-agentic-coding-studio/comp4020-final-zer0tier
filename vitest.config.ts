import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    // Lessons and shifts run on the app's clock, so specs time real activities.
    // One file at a time keeps that timing honest, and the longest specs play
    // dozens of lessons and shifts through.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
