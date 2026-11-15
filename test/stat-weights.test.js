import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Worker } from "node:worker_threads";

import { k } from "../data/constants.js";
import { normalizeConfig } from "../js/sim-config.js";
import { BatchClient } from "../js/batch-client.js";
import { runBatch } from "../js/batch-runner.js";
import { referenceBuild } from "../js/preset-reference-builds.js";
import {
  pairedDpsPerPoint,
  statWeightFightCount,
  statWeightVariants,
  statWeights,
} from "../js/stat-weights.js";

const threads = new Set();
after(() => Promise.all([...threads].map((thread) => thread.terminate())));

function threadWorker() {
  const worker = new Worker(
    new URL("./batch-worker-thread.js", import.meta.url),
  );
  threads.add(worker);
  worker.once("exit", () => threads.delete(worker));
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer),
    addEventListener: (type, listener) => {
      if (type === "message") {
        worker.on("message", (data) => listener({ data }));
      } else if (type === "error") {
        worker.on("error", (error) => listener({ message: error.message }));
      }
    },
    terminate: () => worker.terminate(),
  };
}

function job(jobs, id, sign) {
  return jobs.find((entry) => entry.id === id && entry.sign === sign);
}

const tiny = { seed: 1, iterations: 3, duration: 20 };

describe("stat weight variants", () => {
  it("applies the exact deltas and does not mutate the input", () => {
    const input = normalizeConfig({});
    const snapshot = structuredClone(input);
    const jobs = statWeightVariants(input);
    assert.deepEqual(input, snapshot);
    const base = job(jobs, "base", 0).config;
    assert.equal(
      job(jobs, "attackPower", 1).config.character.attackPower,
      base.character.attackPower + k("statWeights.attackPower"),
    );
    assert.equal(
      job(jobs, "crit", 1).config.character.critChance,
      base.character.critChance + k("statWeights.crit"),
    );
    assert.equal(
      job(jobs, "crit", -1).config.character.critChance,
      base.character.critChance - k("statWeights.crit"),
    );
    assert.equal(
      job(jobs, "hit", 1).config.character.bonusHitChance,
      base.character.bonusHitChance + k("statWeights.hit"),
    );
    assert.equal(
      job(jobs, "hit", -1).config.character.bonusHitChance,
      base.character.bonusHitChance - k("statWeights.hit"),
    );
    for (const hand of ["mainHand", "offHand"]) {
      const speed = base.weapons[hand].speed;
      const variant = job(jobs, hand, 1).config.weapons[hand];
      const add = k("statWeights.weaponDps") * speed;
      assert.equal(variant.min, base.weapons[hand].min + add);
      assert.equal(variant.max, base.weapons[hand].max + add);
    }
  });

  it("reads a config that omits the new fields as the defaults", () => {
    assert.deepEqual(
      statWeightVariants({}),
      statWeightVariants(normalizeConfig({})),
    );
    assert.deepEqual(statWeightVariants(undefined), statWeightVariants({}));
  });

  it("drops haste below 0 and above 1", () => {
    const atZero = statWeightVariants({});
    assert.notEqual(job(atZero, "haste", 1), undefined);
    assert.equal(job(atZero, "haste", -1), undefined);
    assert.equal(atZero.length, 9);
    const atCap = statWeightVariants({ character: { haste: 1 } });
    assert.equal(job(atCap, "haste", 1), undefined);
    assert.notEqual(job(atCap, "haste", -1), undefined);
    assert.equal(atCap.length, 9);
    const mid = statWeightVariants({ character: { haste: 0.5 } });
    assert.notEqual(job(mid, "haste", 1), undefined);
    assert.notEqual(job(mid, "haste", -1), undefined);
    assert.equal(mid.length, 10);
  });

  it("uses the default and Precise fight counts", () => {
    assert.equal(statWeightFightCount({}), k("statWeights.iterations"));
    assert.equal(k("statWeights.iterations"), 1000);
    assert.equal(statWeightFightCount({ precise: true }), 4000);
    assert.equal(statWeightFightCount({ iterations: 7, precise: true }), 7);
  });
});

describe("paired DPS per point", () => {
  it("matches a hand-computed 95% half-width", () => {
    const low = [10, 12, 11, 13];
    const high = [14, 15, 16, 17];
    // diffs 4, 3, 5, 4. mean 4. sample variance 2/3.
    const delta = 2;
    const mean = 4;
    const sd = Math.sqrt(2 / 3);
    const expected = {
      dpsPerPoint: mean / delta,
      ci: (1.96 * sd) / Math.sqrt(4) / delta,
    };
    const got = pairedDpsPerPoint(low, high, delta);
    assert.equal(got.dpsPerPoint, expected.dpsPerPoint);
    assert.ok(Math.abs(got.ci - expected.ci) < 1e-12);
  });
});

describe("statWeights", () => {
  it("is identical on two runs", async () => {
    const first = await statWeights(tiny);
    const second = await statWeights(tiny);
    assert.deepEqual(first, second);
    assert.equal(first.rows.attackPower.apEquivalent, 1);
    assert.equal(Object.hasOwn(first.rows.attackPower, "apCi"), false);
    assert.equal(first.variants, 9);
  });

  it("is identical across slice sizes", async () => {
    const whole = await statWeights({ ...tiny, slice: Infinity });
    const one = await statWeights({ ...tiny, slice: 1 });
    const n = await statWeights({ ...tiny, slice: tiny.iterations });
    assert.deepEqual(one, whole);
    assert.deepEqual(n, whole);
  });

  it("is identical on the worker path and the main-thread path", async () => {
    const options = { seed: 2, iterations: 2, duration: 15 };
    const main = new BatchClient({ mode: "main" });
    const worker = new BatchClient({ createWorker: threadWorker });
    const [fromMain, fromWorker, fromRun] = await Promise.all([
      statWeights({ ...options, client: main }),
      statWeights({ ...options, client: worker }),
      statWeights(options),
    ]);
    assert.deepEqual(fromMain, fromRun);
    assert.deepEqual(fromWorker, fromRun);
    worker.terminate();
  });

  it("reports one-sided haste in the progress total", async () => {
    const seen = [];
    const result = await statWeights({
      ...tiny,
      onProgress: (progress) => seen.push(progress),
    });
    assert.equal(result.variants, 9);
    assert.deepEqual(seen.at(-1), { completed: 9, total: 9 });
    const capped = [];
    await statWeights({
      ...tiny,
      config: { character: { haste: 1 } },
      onProgress: (progress) => capped.push(progress),
    });
    assert.deepEqual(capped.at(-1), { completed: 9, total: 9 });
  });

  it("returns no result when cancelled", async () => {
    const signal = globalThis.AbortSignal.abort();
    assert.equal(await statWeights({ ...tiny, signal }), null);
    const controller = new globalThis.AbortController();
    let ticks = 0;
    const dropped = await statWeights({
      ...tiny,
      signal: controller.signal,
      onProgress: () => {
        ticks += 1;
        controller.abort();
      },
    });
    assert.equal(dropped, null);
    assert.equal(ticks, 1);
  });

  it("matches the paired formula on the reference build", async () => {
    const config = referenceBuild("combat-swords-temp");
    delete config.name;
    config.poisons = { mainHand: "instant", offHand: "instant" };
    const run = {
      seed: 107,
      iterations: 200,
      duration: 300,
      config,
    };
    const first = await statWeights(run);
    const second = await statWeights(run);
    assert.deepEqual(first, second);
    const jobs = statWeightVariants(config);
    const plus = runBatch({
      seed: 107,
      iterations: 200,
      duration: 300,
      config: job(jobs, "hit", 1).config,
    });
    const minus = runBatch({
      seed: 107,
      iterations: 200,
      duration: 300,
      config: job(jobs, "hit", -1).config,
    });
    const expected = pairedDpsPerPoint(
      minus.dps,
      plus.dps,
      (k("statWeights.hit") / k("statWeights.onePercent")) * 2,
    );
    assert.equal(first.rows.hit.dpsPerPoint, expected.dpsPerPoint);
    assert.equal(first.rows.hit.ci, expected.ci);
    assert.equal(typeof first.rows.hit.apEquivalent, "number");
    assert.equal(Object.hasOwn(first.rows.hit, "apCi"), false);
  });
});
