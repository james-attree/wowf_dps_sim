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

    const runs = [...workflow.matchAll(/^\s*run:\s*(\S.*)$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(runs, [
      "npm ci",
      "npm run lint",
      "npm test",
      "npm run provenance",
    ]);

    assert.equal(workflow.includes("deploy"), false);
    assert.equal(/pages/i.test(workflow), false);
  });
});
