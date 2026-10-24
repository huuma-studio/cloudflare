import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/*.test.ts"],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    // Prose: formatting it would bury content changes in blame.
    ignorePatterns: ["**/*.md"],
  },
  run: {
    tasks: {
      // Runs every check JSR publish runs, including slow types.
      "jsr:dry-run": { command: "jsr publish --dry-run", cache: false },
    },
  },
});
