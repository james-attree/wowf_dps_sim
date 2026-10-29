import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { abilityCatalogue } from "./js/abilities.js";
import enginePurity from "./eslint/engine-purity.js";

// Engine modules (everything under js/ except the UI entry) must stay free of
// document/window, wall clocks (performance, Date), Math.random and
// game-number literals. js/main.js and the views it loads (js/views/, #149)
// are the UI exception.
// data/constants.js is where those numbers live, so it is not an engine file.

const readonly = (names) =>
  Object.fromEntries(names.map((name) => [name, "readonly"]));

// Display names the engine must not key on (issue #94). Every ability the
// catalogue builds, the two weapon labels, and the poisons, which the catalogue
// does not parse. A name belongs in a definition site only (see the block below).
const DISPLAY_NAMES = [
  ...abilityCatalogue.abilities.map((ability) => ability.name),
  "Main-hand",
  "Off-hand",
  "Deadly Poison",
  "Instant Poison",
  "Wound Poison",
  "Crippling Poison",
];

const engineDomMessage =
  "Engine modules must not touch this global so they can run in Node, the browser, and a Web Worker.";
const engineRandomMessage =
  "Engine modules must not use Math.random. Draw from the simulation's seeded rng (js/rng.js) so a fight repeats for the same seed.";
const engineClockMessage =
  "Engine modules must not read a wall clock. Advance time with Simulation.step(dt), and let the host supply dt.";

// The page: its bootstrap and its view modules (issue #149). They touch the
// DOM and draw, so the engine rules do not apply; the display-name rule does.
const UI_FILES = ["js/main.js", "js/views/**/*.js"];

const viewImportMessage =
  "A view draws the store's plain slices (#150): it may import other views, js/gcd-meter.js, js/icons.js, the #148 markup and chart helpers (js/svg.js, js/charts.js; #154) and data/constants.js, never the engine. Put what it needs in the store through js/live-feed.js, or have js/main.js hand it in.";

// Host modules under js/ (issue #147): see their block below.
const WORKER_HOSTS = ["js/batch-worker.js", "js/batch-client.js"];

// The engine rules, shared by engine modules and the batch worker hosts.
// `clock` false leaves out the wall-clock globals (a host may read a clock).
const restrictedGlobals = ({ clock }) => [
  "error",
  {
    checkGlobalObject: true,
    globalObjects: ["global"],
    globals: [
      { name: "document", message: engineDomMessage },
      { name: "window", message: engineDomMessage },
      ...(clock
        ? [
            { name: "performance", message: engineClockMessage },
            { name: "Date", message: engineClockMessage },
          ]
        : []),
    ],
  },
];

const engineRules = {
  // Math.random, however it is reached: Math.random, Math["random"],
  // globalThis.Math.random, self.Math["random"], or { random } = Math.
  "no-restricted-syntax": [
    "error",
    ...[
      // Math.random and Math["random"]
      "MemberExpression[object.name='Math'][property.name='random'][computed=false]",
      "MemberExpression[object.name='Math'][computed=true][property.value='random']",
      // globalThis.Math.random, self.Math["random"], and so on
      "MemberExpression[object.type='MemberExpression'][object.property.name='Math'][property.name='random'][computed=false]",
      "MemberExpression[object.type='MemberExpression'][object.property.name='Math'][computed=true][property.value='random']",
      "MemberExpression[object.type='MemberExpression'][object.property.value='Math'][property.name='random'][computed=false]",
      "MemberExpression[object.type='MemberExpression'][object.property.value='Math'][computed=true][property.value='random']",
      // const { random } = Math
      "VariableDeclarator[init.name='Math'] > ObjectPattern > Property[key.name='random']",
    ].map((selector) => ({ selector, message: engineRandomMessage })),
  ],
  // detectObjects so property values and `this.x = 0.065` count.
  // Variable initializers are the remaining hole; the local rule covers them.
  "no-magic-numbers": ["error", { ignore: [0, 1, -1], detectObjects: true }],
  "engine-purity/no-numeric-literal": "error",
  // The DoT loop used to log every Hemorrhage tick. A simulation stays silent.
  "no-console": "error",
};

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
    files: UI_FILES,
    languageOptions: {
      globals: readonly([
        "cancelAnimationFrame",
        "crypto",
        "document",
        "performance",
        "requestAnimationFrame",
        "window",
      ]),
    },
  },
  {
    // The view modules (#150) draw the store's plain slices and nothing else:
    // no Rogue, Simulation or other engine module. What they may import is
    // listed here; the live feed (js/live-feed.js) is what reads the fight.
    files: ["js/views/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^(?!(\\./[\\w-]+|\\.\\./(gcd-meter|icons|svg|charts)|\\.\\./\\.\\./data/constants)\\.js$)",
              message: viewImportMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["js/**/*.js"],
    ignores: [...UI_FILES, ...WORKER_HOSTS],
    plugins: {
      "engine-purity": enginePurity,
    },
    languageOptions: {
      // Present in Node, browsers, and workers. Property access such as
      // globalThis.document is still rejected by no-restricted-globals.
      globals: readonly(["global", "globalThis", "self"]),
    },
    rules: {
      "no-restricted-globals": restrictedGlobals({ clock: true }),
      ...engineRules,
    },
  },
  {
    // The batch worker and its client (#147) are hosts, not engine code: they
    // read a clock (for slices and the progress throttle) and create or are a
    // Worker. Every other engine rule holds: no DOM, no Math.random, no
    // literals, no console.
    files: WORKER_HOSTS,
    plugins: {
      "engine-purity": enginePurity,
    },
    languageOptions: {
      globals: readonly([
        "global",
        "globalThis",
        "self",
        "performance",
        "queueMicrotask",
        "URL",
      ]),
    },
    rules: {
      "no-restricted-globals": restrictedGlobals({ clock: false }),
      ...engineRules,
    },
  },
  {
    // js/main.js and js/views/ are scanned too: the page reads ids as well. The definition
    // sites are where a display name is written once.
    files: ["js/**/*.js"],
    ignores: ["js/auras.js", "js/weapon.js"],
    plugins: {
      "engine-purity": enginePurity,
    },
    rules: {
      "engine-purity/no-display-name": [
        "error",
        { names: DISPLAY_NAMES, namespaces: ["Skills"] },
      ],
    },
  },
  {
    // The charts demo harness (#148): a page script, like js/main.js. It is
    // not deployed (the Pages workflow copies index.html, styles.css, js, data
    // and img).
    files: ["demo/**/*.js"],
    languageOptions: {
      globals: readonly(["document", "performance"]),
    },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.js", "browser-tests/**/*.mjs"],
    languageOptions: {
      globals: readonly([
        "Buffer",
        "clearTimeout",
        "console",
        "fetch",
        "performance",
        "process",
        "queueMicrotask",
        "setImmediate",
        "setTimeout",
        "structuredClone",
        "URL",
      ]),
    },
  },
  {
    // The browser tests (#204): their page.evaluate callbacks run in Chrome.
    files: ["browser-tests/**/*.mjs"],
    languageOptions: {
      globals: readonly(["document", "getComputedStyle"]),
    },
  },
]);
