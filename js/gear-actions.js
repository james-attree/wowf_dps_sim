// Host actions for the #297 PR6 gear screen. The view may not import these
// modules, so js/main.js hands this object to js/views/gear-screen.js.

import { FORM_ERROR, formFromConfig, fromBehind } from "./config-form.js";
import { configWithGear, gearViewModel, setSlot } from "./gear-model.js";
import {
  CREDIT_AFTER,
  CREDIT_BEFORE,
  CREDIT_HREF,
  CREDIT_LABEL,
  NOT_MODELLED_HELP,
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

export function createGearActions(store, { searchStart, resultCap }) {
  const model = () => gearViewModel(store.get().config, TABLES);
  const currentSlots = () => store.get().config.gear?.slots ?? {};

  return {
    copy: {
      CREDIT_AFTER,
      CREDIT_BEFORE,
      CREDIT_HREF,
      CREDIT_LABEL,
      LEAVE_EMPTY,
      LEAVE_EMPTY_META,
      NO_ENCHANT,
      NO_SUFFIX,
      NOT_MODELLED_HELP,
      SEARCH_HINT,
      TALENT_NOTE,
    },
    searchStart,
    resultCap,
    model,
    currentSlots,
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
      const now = store.get();
      const drafted = fromBehind(configWithGear(now.config, nextSlots));
      const errors = {};
      let config;
      try {
        config = normalizeConfig(drafted);
      } catch (error) {
        // Empty main hand: persist the doll and a null hand so a run cannot
        // still swing the weapon the user cleared. Run is blocked with the
        // engine's reason. coordinator call 16 Nov (James delegated).
        config = drafted;
        errors[FORM_ERROR] =
          `This setup can't run: ${error instanceof Error ? error.message : String(error)}`;
      }
      store.set({
        config,
        form: {
          ...formFromConfig(config, (now.form?.revision ?? FIRST) + STEP),
          errors,
          canUndo: false,
        },
      });
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
