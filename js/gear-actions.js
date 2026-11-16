// Host actions for the gear screen. The view may not import engine or
// store modules, so js/main.js hands this object to the view.

import {
  FORM_ERROR,
  formFromConfig,
  fromBehind,
  pageDefaultGear,
} from "./config-form.js";
import {
  CURRENT_DEFAULT,
  PAGE_DEFAULT_ID,
  PAGE_DEFAULT_NAME,
  guardedRemove,
  guardedRename,
  guardedSave,
  listGearBuilds,
  loadGearBuild,
  slotsEqual,
} from "./gear-builds.js";
import { configWithGear, gearViewModel, setSlot } from "./gear-model.js";
import {
  CREDIT_AFTER,
  CREDIT_BEFORE,
  CREDIT_HREF,
  CREDIT_LABEL,
  LEGACY_BANNER,
  NOT_MODELLED_HELP,
  START_EMPTY,
  START_P1,
  TALENT_NOTE,
} from "./gear-model.js";
import {
  LEAVE_EMPTY,
  LEAVE_EMPTY_META,
  NO_ENCHANT,
  NO_SUFFIX,
  SEARCH_HINT,
  enchantsForSlot,
  indexTables,
  itemInitials,
  qualityClass,
  qualityName,
  resultMeta,
  searchSlotItems,
  slotLabel,
  suffixesForItem,
} from "./gear-search.js";
import enchants from "../data/items/enchants.json" with { type: "json" };
import items from "../data/items/rogue-items.json" with { type: "json" };
import suffixes from "../data/items/suffixes.json" with { type: "json" };
import { normalizeConfig } from "./sim-config.js";

const TABLES = indexTables({ items, enchants, suffixes });
const FIRST = 0;
const STEP = 1;

function commitConfig(store, config, extra = {}) {
  const now = store.get();
  const form = formFromConfig(config, (now.form?.revision ?? FIRST) + STEP);
  store.set({
    config,
    form: { ...form, canUndo: false, ...extra.form },
    gearMessage: extra.gearMessage ?? "",
  });
}

function writeSlots(store, slots) {
  const now = store.get();
  const drafted = fromBehind(configWithGear(now.config, slots));
  let config;
  try {
    config = normalizeConfig(drafted);
  } catch (error) {
    // Empty main hand: persist the doll and a null hand so a run cannot
    // still swing the weapon the user cleared. Run is blocked with the
    // engine's reason. coordinator call 16 Nov (James delegated).
    config = drafted;
    commitConfig(store, config, {
      form: {
        errors: {
          [FORM_ERROR]: `This setup can't run: ${error instanceof Error ? error.message : String(error)}`,
        },
      },
    });
    return;
  }
  commitConfig(store, config);
}

export function createGearActions(
  store,
  { searchStart, resultCap, now = () => 0 },
) {
  const model = () => gearViewModel(store.get().config, TABLES);
  const currentSlots = () => store.get().config.gear?.slots ?? {};
  const defaultSlots = () => pageDefaultGear().slots ?? {};

  const listedBuilds = () => {
    const current = currentSlots();
    const defaults = defaultSlots();
    const equippedDefault = slotsEqual(current, defaults);
    const saved = listGearBuilds();
    const page = {
      id: PAGE_DEFAULT_ID,
      name: PAGE_DEFAULT_NAME,
      slots: defaults,
      builtin: true,
      current: equippedDefault,
      currentLabel: equippedDefault ? CURRENT_DEFAULT : "",
    };
    const rows = saved.map((build) => {
      const currentSaved = slotsEqual(current, build.slots);
      return {
        ...build,
        builtin: false,
        current: currentSaved,
        currentLabel: currentSaved ? "Current" : "",
      };
    });
    return [page, ...rows];
  };

  return {
    copy: {
      CREDIT_AFTER,
      CREDIT_BEFORE,
      CREDIT_HREF,
      CREDIT_LABEL,
      CURRENT_DEFAULT,
      LEAVE_EMPTY,
      LEAVE_EMPTY_META,
      LEGACY_BANNER,
      NO_ENCHANT,
      NO_SUFFIX,
      NOT_MODELLED_HELP,
      PAGE_DEFAULT_NAME,
      SEARCH_HINT,
      START_EMPTY,
      START_P1,
      TALENT_NOTE,
    },
    searchStart,
    resultCap,
    model,
    currentSlots,
    listedBuilds,
    gearMessage: () => store.get().gearMessage ?? "",
    search(query, slot) {
      return searchSlotItems(
        query,
        slot,
        TABLES,
        currentSlots(),
        searchStart,
        resultCap,
      );
    },
    applySlots(nextSlots) {
      writeSlots(store, nextSlots);
    },
    startP1() {
      writeSlots(store, defaultSlots());
    },
    startEmpty() {
      writeSlots(store, {});
    },
    loadBuild(id) {
      if (id === PAGE_DEFAULT_ID) {
        writeSlots(store, defaultSlots());
        return { ok: true };
      }
      const build = loadGearBuild(id);
      if (build == null) {
        return {
          ok: false,
          reason: "missing",
          message: "That gear build is not saved.",
        };
      }
      writeSlots(store, build.slots);
      return { ok: true };
    },
    saveBuild(name) {
      const result = guardedSave(
        { name, slots: currentSlots() },
        undefined,
        now(),
      );
      store.set({
        gearMessage: result.message ?? (result.ok ? "Gear build saved." : ""),
      });
      return result;
    },
    renameBuild(id, name) {
      const result = guardedRename(id, name, undefined, now());
      store.set({
        gearMessage: result.message ?? (result.ok ? "Gear build renamed." : ""),
      });
      return result;
    },
    removeBuild(id) {
      const result = guardedRemove(id);
      store.set({
        gearMessage: result.message ?? (result.ok ? "Gear build deleted." : ""),
      });
      return result;
    },
    setSlot,
    enchantsForSlot: (slot) => enchantsForSlot(slot, TABLES),
    suffixesForItem: (item) => suffixesForItem(item, TABLES),
    itemInitials,
    qualityClass,
    qualityName,
    resultMeta,
    slotLabel,
  };
}
