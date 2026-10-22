import js from "@eslint/js";
import { defineConfig } from "eslint/config";

// Engine purity and no-magic-numbers are F4 (#3), after values move into
// data/constants.js (#7). js/main.js stays exempt from both.

const readonly = (names) =>
  Object.fromEntries(names.map((name) => [name, "readonly"]));

export default defineConfig([
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    files: ["js/main.js"],
    languageOptions: {
      globals: readonly([
        "cancelAnimationFrame",
        "document",
        "performance",
        "requestAnimationFrame",
        "window",
      ]),
    },
  },
  {
    files: ["js/simulation.js"],
    languageOptions: {
      globals: readonly(["console", "performance"]),
    },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.js"],
    languageOptions: {
      globals: readonly([
        "Buffer",
        "clearTimeout",
        "console",
        "fetch",
        "process",
        "setTimeout",
        "URL",
      ]),
    },
  },
]);
