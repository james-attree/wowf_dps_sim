import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import enginePurity from "./eslint/engine-purity.js";

// Engine modules (everything under js/ except the UI entry) must stay free of
// document/window and of game-number literals. js/main.js is the UI exception.
// data/constants.js is where those numbers live, so it is not an engine file.

const readonly = (names) =>
  Object.fromEntries(names.map((name) => [name, "readonly"]));

const engineDomMessage =
  "Engine modules must not touch this global so they can run in Node, the browser, and a Web Worker.";

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
    files: ["js/**/*.js"],
    ignores: ["js/main.js"],
    plugins: {
      "engine-purity": enginePurity,
    },
    languageOptions: {
      // Present in Node, browsers, and workers. Property access such as
      // globalThis.document is still rejected by no-restricted-globals.
      globals: readonly(["global", "globalThis", "self"]),
    },
    rules: {
      "no-restricted-globals": [
        "error",
        {
          checkGlobalObject: true,
          globalObjects: ["global"],
          globals: [
            { name: "document", message: engineDomMessage },
            { name: "window", message: engineDomMessage },
          ],
        },
      ],
      // detectObjects so property values and `this.x = 0.065` count.
      // Variable initializers are the remaining hole; the local rule covers them.
      "no-magic-numbers": [
        "error",
        { ignore: [0, 1, -1], detectObjects: true },
      ],
      "engine-purity/no-numeric-literal": "error",
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
