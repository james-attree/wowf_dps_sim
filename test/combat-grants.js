// The two talent abilities the default rotation casts, as a host grant
// (js/rogue.js, options.abilities). Since #199 no talents picked is truly
// untalented: the default fight casts neither Blade Flurry nor Adrenaline
// Rush. A test about either in the default rotation is given them this way,
// and its fight is the one the default config ran before #199 (abilityGranted
// on Cold Blood still fails, so Cold Blood stays uncast).
export const COMBAT_GRANTS = Object.freeze({
  abilities: Object.freeze(["blade-flurry", "adrenaline-rush"]),
});
