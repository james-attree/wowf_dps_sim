import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { k } from "../data/constants.js";
import iconCheck from "../data/icons.json" with { type: "json" };
import { abilityCatalogue } from "../js/abilities.js";
import { runFight } from "../js/fight.js";
import {
  attachIconFallback,
  collectIconNames,
  iconUrl,
  spellIconUrl,
  talentIconUrl,
} from "../js/icons.js";
import { poisonCatalogue } from "../js/poisons.js";
import { Rogue } from "../js/rogue.js";
import { snapshot } from "../js/snapshot.js";
import { talentCatalogue } from "../js/talents.js";
import {
  checkIcons,
  findMissing,
  formatManifest,
  formatReport,
} from "../scripts/check-icons.mjs";

// D10 (#107): icons by hot-link. Every talent, ability and poison icon
// resolves to a CDN URL or to the fallback, with no download and no network.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { base, size, extension } = k("icons.cdn");
const FALLBACK = `${base}${size}/${k("icons.fallback")}${extension}`;
const HAND_MADE = [
  "adrenaline_rush.jpg",
  "ambush.jpg",
  "backstab.jpg",
  "blade_flurry.jpg",
  "eviscerate.jpg",
  "garotte.jpg",
  "ghostly_strike.jpg",
  "hemorrhage.jpg",
  "premeditation.jpg",
  "rupture.jpg",
  "sinister_strike.jpg",
  "slice_and_dice.jpg",
  "stealth.jpg",
];
const NEVER_BLIZZARD = /blizzard|battle\.net|worldofwarcraft|blzmedia/i;

// A page that cannot be reached: any fetch or request in these tests fails.
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => {
    throw new Error("an icon test reached for the network");
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

function isCdnUrlFor(url, name) {
  return url === `${base}${size}/${name}${extension}`;
}

describe("iconUrl", () => {
  it("builds the CDN URL from the name and the constants", () => {
    assert.equal(
      iconUrl("ability_rogue_eviscerate"),
      "https://wow.zamimg.com/images/wow/icons/large/ability_rogue_eviscerate.jpg",
    );
  });

  it("gives the fallback for a name it cannot use", () => {
    for (const bad of [
      undefined,
      null,
      "",
      42,
      "Has Capitals",
      "../escape",
      "a/b",
      "a b",
      "x.jpg",
      {},
    ]) {
      assert.equal(iconUrl(bad), FALLBACK, String(bad));
    }
  });

  it("gives the fallback for a name on the missing list", () => {
    assert.equal(iconUrl("gone_icon", k, ["gone_icon"]), FALLBACK);
    assert.equal(
      iconUrl("other_icon", k, ["gone_icon"]),
      `${base}${size}/other_icon${extension}`,
    );
  });

  it("reads the pattern from the constants it is given", () => {
    const read = (id) =>
      id === "icons.cdn"
        ? { base: "https://example.test/i/", size: "s", extension: ".png" }
        : "none";
    assert.equal(iconUrl("a_b", read, []), "https://example.test/i/s/a_b.png");
    assert.equal(iconUrl("", read, []), "https://example.test/i/s/none.png");
  });

  it("uses a CDN that is not hosted by Blizzard", () => {
    assert.equal(new URL(FALLBACK).protocol, "https:");
    assert.equal(new URL(FALLBACK).hostname, "wow.zamimg.com");
    assert.doesNotMatch(FALLBACK, NEVER_BLIZZARD);
    assert.equal(k("icons.fallback"), "inv_misc_questionmark");
  });
});

describe("every icon in the snapshot", () => {
  const names = collectIconNames();

  it("collects the trees, talents, spells and tabs", () => {
    assert.ok(names.length > 60, `${names.length} names`);
    assert.deepEqual(names, [...names].sort());
    assert.equal(new Set(names).size, names.length);
    for (const tree of snapshot.talents.trees) {
      assert.ok(names.includes(tree.icon), tree.icon);
    }
    for (const name of Object.values(snapshot.spellbook.icons)) {
      assert.ok(names.includes(name), name);
    }
    assert.ok(names.includes("trade_brewpoison"));
    assert.equal(iconCheck.checked.names, names.length);
  });

  it("resolves every name to a CDN URL, or to the fallback if listed missing", () => {
    for (const name of names) {
      const url = iconUrl(name);
      const expected = iconCheck.missing.includes(name) ? FALLBACK : null;
      assert.ok(
        expected === null ? isCdnUrlFor(url, name) : url === expected,
        `${name} -> ${url}`,
      );
    }
  });

  it("resolves every talent and every tree icon", () => {
    assert.ok(talentCatalogue.talents.length > 0);
    for (const talent of talentCatalogue.talents) {
      assert.equal(typeof talent.icon, "string", talent.id);
      assert.ok(names.includes(talent.icon), talent.id);
      assert.equal(talentIconUrl(talent), iconUrl(talent.icon), talent.id);
      assert.match(talentIconUrl(talent), /^https:\/\/wow\.zamimg\.com\//);
    }
    for (const tree of talentCatalogue.trees) {
      assert.match(iconUrl(tree.icon), /^https:\/\/wow\.zamimg\.com\//);
    }
    assert.equal(talentIconUrl(undefined), FALLBACK);
  });

  it("resolves every ability and every poison from its spell name", () => {
    for (const ability of abilityCatalogue.abilities) {
      const named = snapshot.spellbook.icons[ability.name];
      assert.equal(
        spellIconUrl(ability.name),
        iconUrl(named),
        `${ability.id} (${named})`,
      );
    }
    assert.equal(poisonCatalogue.poisons.length, 5);
    for (const poison of poisonCatalogue.poisons) {
      const named = snapshot.spellbook.icons[poison.name];
      assert.equal(typeof named, "string", poison.id);
      assert.ok(isCdnUrlFor(spellIconUrl(poison.name), named), poison.id);
    }
    assert.equal(spellIconUrl("Not a spell"), FALLBACK);
    assert.equal(spellIconUrl("x", {}), FALLBACK);
  });

  it("has no icon file in the repo beyond the hand-made ones", () => {
    assert.deepEqual(readdirSync(join(root, "img")).sort(), HAND_MADE);
    // docs/screenshots holds screenshots of the page, not icons.
    const stray = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          ["node_modules", ".git", "img", "screenshots"].includes(entry.name)
        ) {
          continue;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (
          /\.(jpe?g|png|gif|webp|svg|ico|blp|tga)$/i.test(entry.name)
        ) {
          stray.push(path.slice(root.length + 1));
        }
      }
    };
    walk(root);
    assert.deepEqual(stray, []);
  });
});

describe("icons in the engine", () => {
  it("keeps the hand-made file for an ability that has one", () => {
    const rogue = new Rogue();
    assert.equal(
      rogue.abilities.sinisterStrike.icon,
      "./img/sinister_strike.jpg",
    );
    assert.equal(rogue.abilities.eviscerate.icon, "./img/eviscerate.jpg");
  });

  it("gives Cold Blood, which has no file in img/, its CDN icon", () => {
    const rogue = new Rogue();
    assert.equal(
      rogue.abilities.coldBlood.icon,
      spellIconUrl(rogue.abilities.coldBlood.name),
    );
    assert.ok(isCdnUrlFor(rogue.abilities.coldBlood.icon, "spell_ice_lament"));
  });

  it("puts the poison's icon on its log rows, its DoT and its debuff", () => {
    const result = runFight({
      seed: 7,
      duration: 60,
      config: { poisons: { mainHand: "instant", offHand: "deadly" } },
    });
    const instant = spellIconUrl(poisonCatalogue.get("instant-poison").name);
    const deadly = spellIconUrl(poisonCatalogue.get("deadly-poison").name);
    const byName = (name) => result.log.filter((event) => event.name === name);
    const instantRows = byName(poisonCatalogue.get("instant-poison").name);
    const deadlyRows = byName(poisonCatalogue.get("deadly-poison").name);
    assert.ok(instantRows.length > 0 && deadlyRows.length > 0);
    assert.ok(instantRows.every((event) => event.icon === instant));
    assert.ok(deadlyRows.every((event) => event.icon === deadly));
    for (const event of result.log) {
      assert.ok(
        event.icon === null ||
          /^(\.\/img\/|https:\/\/wow\.zamimg\.com\/)/.test(event.icon),
        `${event.name}: ${event.icon}`,
      );
    }
  });

  it("changes nothing in a fight without poisons or Cold Blood", () => {
    const result = runFight({ seed: 1, duration: 10 });
    for (const event of result.log) {
      assert.ok(event.icon === null || event.icon.startsWith("./img/"));
    }
  });
});

describe("attachIconFallback", () => {
  function fakeImage() {
    const listeners = [];
    return {
      src: "https://wow.zamimg.com/images/wow/icons/large/real.jpg",
      hidden: false,
      addEventListener(type, listener) {
        assert.equal(type, "error");
        listeners.push(listener);
      },
      fail() {
        for (const listener of listeners) {
          listener();
        }
      },
    };
  }

  it("swaps in the fallback on the first load error", () => {
    const image = attachIconFallback(fakeImage());
    image.fail();
    assert.equal(image.src, FALLBACK);
    assert.equal(image.hidden, false);
  });

  it("hides the image when the fallback fails too, and never loops", () => {
    const image = attachIconFallback(fakeImage());
    image.fail();
    image.fail();
    assert.equal(image.src, FALLBACK);
    assert.equal(image.hidden, true);
    image.src = "kept";
    image.fail();
    assert.equal(image.src, "kept");
  });

  it("takes its own fallback URL", () => {
    const image = attachIconFallback(fakeImage(), "https://example.test/x.jpg");
    image.fail();
    assert.equal(image.src, "https://example.test/x.jpg");
  });
});

describe("scripts/check-icons.mjs", () => {
  const respond = (statuses) => async (url) => {
    const name = url.split("/").pop().replace(extension, "");
    const status = statuses[name] ?? 200;
    return { status, ok: status >= 200 && status < 300 };
  };

  it("lists the names the CDN answers 404 for, with HEAD requests only", async () => {
    const methods = new Set();
    const fetchImpl = async (url, options) => {
      methods.add(options.method);
      return respond({ gone: 404, also_gone: 410 })(url);
    };
    const missing = await findMissing(["here", "gone", "also_gone"], fetchImpl);
    assert.deepEqual(missing, ["gone", "also_gone"]);
    assert.deepEqual([...methods], ["HEAD"]);
  });

  it("stops on any other failure, so a flaky run marks nothing missing", async () => {
    await assert.rejects(
      findMissing(["a", "b"], respond({ b: 503 })),
      /HTTP 503/,
    );
    await assert.rejects(
      findMissing(["a"], async () => {
        throw new TypeError("offline");
      }),
      /offline/,
    );
  });

  it("checks the fallback icon too, and fails if it is missing", async () => {
    const urls = [];
    await checkIcons({
      names: ["a"],
      fetchImpl: async (url) => {
        urls.push(url);
        return { status: 200, ok: true };
      },
    });
    assert.ok(urls.some((url) => url === FALLBACK));
    await assert.rejects(
      checkIcons({
        names: ["a"],
        fetchImpl: respond({ [k("icons.fallback")]: 404 }),
      }),
      /fallback icon/,
    );
  });

  it("writes names only, and matches the committed manifest for the real names", async () => {
    const names = collectIconNames();
    const text = formatManifest({ names, missing: iconCheck.missing });
    assert.deepEqual(JSON.parse(text), iconCheck);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["checked", "missing"]);
    const report = await checkIcons({ fetchImpl: respond({}) });
    assert.equal(report.names, names.length);
    assert.equal(report.written, false);
    assert.equal(report.changed, iconCheck.missing.length !== 0);
  });

  it("reports in plain words", () => {
    assert.equal(
      formatReport({ names: 3, missing: ["x"], changed: true, written: true }),
      "3 icon names checked.\nMissing from the CDN (1): x\nWrote data/icons.json.",
    );
    assert.match(
      formatReport({ names: 3, missing: [], changed: true, written: false }),
      /None are missing from the CDN\.\ndata\/icons\.json is out of date\. Run npm run icons:check -- --write\./,
    );
    assert.match(
      formatReport({ names: 3, missing: [], changed: false, written: false }),
      /up to date/,
    );
  });

  it("prints help and rejects an unknown argument without touching the network", () => {
    const run = (...args) =>
      spawnSync("node", ["scripts/check-icons.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const help = run("--help");
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: npm run icons:check/);
    const bad = run("--nope");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Unknown argument: --nope/);
  });
});
