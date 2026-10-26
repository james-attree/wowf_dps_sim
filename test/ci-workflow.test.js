import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const EXPECTED_RUNS = [
  "npm ci",
  "npm run lint",
  "npm test",
  "npm run provenance",
  "npm run talents:coverage",
];

// Single-line `run:` values at any indent. A block scalar (`run: |` or
// `run: >`) is not one of those commands; its body is checked separately.
function singleLineRuns(workflow) {
  const commands = [];
  for (const line of workflow.split("\n")) {
    const match = line.match(/^\s*run:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }
    const value = match[1];
    if (value === "" || value.startsWith("|") || value.startsWith(">")) {
      continue;
    }
    commands.push(value);
  }
  return commands;
}

function withIndentUnit(workflow, unit) {
  return workflow
    .split("\n")
    .map((line) => {
      const match = /^( *)(.*)$/.exec(line);
      const width = match[1].length;
      if (width % 2 !== 0) {
        throw new Error(`unexpected indent: ${JSON.stringify(line)}`);
      }
      return `${" ".repeat((width / 2) * unit)}${match[2]}`;
    })
    .join("\n");
}

describe("CI workflow", () => {
  it("runs lint, test, and provenance on push and pull request", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/ci.yml"),
      "utf8",
    );

    assert.match(workflow, /^name: CI$/m);
    assert.match(workflow, /^"on":$/m);
    assert.match(workflow, /^ {2}push:$/m);
    assert.match(workflow, /^ {2}pull_request:$/m);
    assert.match(workflow, /^permissions:\n {2}contents: read$/m);
    assert.match(workflow, /runs-on: ubuntu-latest/);
    assert.match(workflow, /node-version: "22"/);
    assert.match(workflow, /cache: npm/);

    const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(uses, ["actions/checkout@v7", "actions/setup-node@v7"]);

    assert.deepEqual(singleLineRuns(workflow), EXPECTED_RUNS);
    assert.equal(
      singleLineRuns(workflow).some((command) => command.includes("git diff")),
      false,
    );

    const provenance = workflow.indexOf("- name: Provenance\n");
    const committed = workflow.indexOf("- name: Provenance is committed\n");
    assert.ok(provenance !== -1 && committed > provenance);
    // The coverage step fails the job on a failure, so it must not be allowed
    // to; its warnings do not fail it (exit 0) and need no such flag.
    const coverage = workflow.indexOf("- name: Talent coverage\n");
    assert.ok(coverage > committed);
    assert.equal(workflow.includes("continue-on-error"), false);
    assert.match(workflow, /run: \|/);
    assert.match(workflow, /git diff --exit-code -- docs\/provenance\.md/);
    assert.match(
      workflow,
      /::error file=docs\/provenance\.md::docs\/provenance\.md is out of date with data\/constants\.js\. Run 'npm run provenance' and commit the result\./,
    );

    assert.equal(workflow.includes("deploy"), false);
    assert.equal(/pages/i.test(workflow), false);
  });

  it("finds run commands at 4-space and 6-space indents", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    // The committed file indents with 2 spaces, so `run:` sits at 8. One
    // space per level puts those steps at 4; the inline fixture uses 6.
    assert.deepEqual(
      singleLineRuns(withIndentUnit(workflow, 1)),
      EXPECTED_RUNS,
    );
    assert.deepEqual(
      singleLineRuns(withIndentUnit(workflow, 4)),
      EXPECTED_RUNS,
    );

    const sixSpace = [
      "steps:",
      "      - name: Install",
      "      run: npm ci",
      "      - name: Lint",
      "      run: npm run lint",
      "      - name: Test",
      "      run: npm test",
      "      - name: Provenance",
      "      run: npm run provenance",
      "      - name: Provenance is committed",
      "      run: |",
      "        git diff --exit-code -- docs/provenance.md || {",
      "          exit 1",
      "        }",
      "      - name: Talent coverage",
      "      run: npm run talents:coverage",
    ].join("\n");
    const fourSpace = sixSpace.replaceAll("\n      ", "\n    ");
    assert.deepEqual(singleLineRuns(sixSpace), EXPECTED_RUNS);
    assert.deepEqual(singleLineRuns(fourSpace), EXPECTED_RUNS);
    assert.equal(sixSpace.includes("run: |"), true);
    assert.equal(
      singleLineRuns(sixSpace).some((command) => command.includes("git diff")),
      false,
    );
  });

  it("fails when a run step is removed or reordered", () => {
    const fixture = [
      "    - name: Install",
      "      run: npm ci",
      "    - name: Lint",
      "      run: npm run lint",
      "    - name: Test",
      "      run: npm test",
      "    - name: Provenance",
      "      run: npm run provenance",
      "    - name: Provenance is committed",
      "      run: |",
      "        git diff --exit-code -- docs/provenance.md",
      "    - name: Talent coverage",
      "      run: npm run talents:coverage",
    ].join("\n");
    assert.deepEqual(singleLineRuns(fixture), EXPECTED_RUNS);

    const removed = fixture.replace("      run: npm test\n", "");
    assert.notDeepEqual(singleLineRuns(removed), EXPECTED_RUNS);

    const reordered = fixture.replace(
      "      run: npm run lint\n    - name: Test\n      run: npm test",
      "      run: npm test\n    - name: Lint\n      run: npm run lint",
    );
    assert.deepEqual(singleLineRuns(reordered), [
      "npm ci",
      "npm test",
      "npm run lint",
      "npm run provenance",
      "npm run talents:coverage",
    ]);
    assert.notDeepEqual(singleLineRuns(reordered), EXPECTED_RUNS);
  });
});
