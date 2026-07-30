import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    exclude: ["node_modules", "build", "tests/e2e"],
    env: {
      REDIS_URL: "redis://localhost:6379",
      SHOPIFY_APP_URL: "https://test-app.up.railway.app",
      NODE_ENV: "test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["app/**/*.ts", "app/**/*.tsx"],
      exclude: ["app/**/*.test.ts", "app/**/*.test.tsx"],
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
});
