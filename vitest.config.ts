import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { DATA_DIR: "./data", GEMINI_API_KEY: "test", TELEGRAM_BOT_TOKEN: "test", LEARN_TTS: "off" },
  },
});
