import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

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

    const runs = workflow
      .split("\n")
      .map((line) => line.match(/^ {8}run: (.*)$/))
      .filter((match) => match && match[1] !== "|")
      .map((match) => match[1]);
    assert.deepEqual(runs, [
      "npm ci",
      "npm run lint",
      "npm test",
      "npm run provenance",
    ]);

    const provenance = workflow.indexOf("- name: Provenance\n");
    const committed = workflow.indexOf("- name: Provenance is committed\n");
    assert.ok(provenance !== -1 && committed > provenance);
    assert.match(workflow, /git diff --exit-code -- docs\/provenance\.md/);
    assert.match(
      workflow,
      /::error file=docs\/provenance\.md::docs\/provenance\.md is out of date with data\/constants\.js\. Run 'npm run provenance' and commit the result\./,
    );

    assert.equal(workflow.includes("deploy"), false);
    assert.equal(/pages/i.test(workflow), false);
  });
});
