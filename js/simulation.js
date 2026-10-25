import { k } from "../data/constants.js";
import { resolveAttack, rollCrit } from "./attack-resolver.js";
import { createRng, normalizeSeed } from "./rng.js";

// Auras already running lose this step. One applied during rotation is not
// in the map yet, so it keeps the duration it was given.
function tickAuras(auras, dt) {
  return Object.fromEntries(
    Object.entries(auras).filter(([, aura]) => {
      aura.duration -= dt;
      return aura.duration > k("sim.tickEpsilon");
    }),
  );
}

// Physical periodic damage and nature damage ignore armor. Other ticks and
// direct hits use armor.mitigation. Spell resistance is not applied.
function isBleedTick(name, dot) {
  return dot.bleed === true || k("bleed.spells").includes(name);
}

function tickSkipsArmor(name, dot) {
  if (isBleedTick(name, dot) && k("bleed.ignoresArmor")) {
    return true;
  }
  return k("nature.spells").includes(name) && k("nature.ignoresArmor");
}

function armorMultiplier() {
  const armor = Math.max(0, k("target.armor"));
  const mitigation = k("armor.mitigation");
  const denominator =
    armor + mitigation.constant + mitigation.perLevel * k("character.level");
  if (denominator <= 0) {
    return 1;
  }
  let reduction = armor / denominator;
  if (reduction > mitigation.cap) {
    reduction = mitigation.cap;
  }
  if (reduction < 0) {
    reduction = 0;
  }
  return 1 - reduction;
}

function applyArmor(damage, skipArmor) {
  if (skipArmor) {
    return damage;
  }
  return damage * armorMultiplier();
}

export class Simulation {
  // The simulation owns the one rng. Pass a seed for a repeatable fight, or an
  // rng function (returns [0, 1)) to script the rolls. Without either it uses
  // rng.defaultSeed. The rogue draws from the same rng.
  constructor(rogue, { seed = k("rng.defaultSeed"), rng } = {}) {
    this.rogue = rogue;
    this.seed = normalizeSeed(seed);
    this.rng = rng ?? createRng(this.seed);
    rogue.rng = this.rng;
    this.currentTime = 0;
    this.damageDone = 0;
    this.gcd = 0; // Global Cooldown
    this.gcdDuration = k("gcd.duration");
    this.combatLog = [];
    this.nextCombatEventId = 0;
    this.cooldowns = {}; // Track cooldowns for skills
    this.activeBuffs = {}; // Self buffs: Slice and Dice, Adrenaline Rush, Blade Flurry, Ghostly Strike
    this.activeDebuffs = {}; // Target debuffs and DoTs
    this.activeDots = {}; // Track active damage over time effects
  }

  // Advance the fight by dt seconds. The engine reads no clock: the host
  // (js/main.js live, a test or a batch runner headless) decides the step.
  step(dt) {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(
        `Simulation.step needs a finite time step in seconds, 0 or more. Got ${dt}.`,
      );
    }
    this.currentTime += dt;

    // This step covers the interval that just ended. Read Adrenaline Rush
    // before its countdown so the part of the step still inside the buff
    // regenerates at the bonus rate, including the step it runs out.
    const arLeft = this.activeBuffs["Adrenaline Rush"]?.duration ?? 0;
    const base = k("energy.regenPerSecond");
    const arDt = Math.min(dt, Math.max(0, arLeft));
    this.rogue.regenerateEnergy(dt - arDt, base);
    this.rogue.regenerateEnergy(
      arDt,
      base * k("adrenalineRush").regenMultiplier,
    );

    // Timers already running lose this step. A buff, debuff, or cooldown
    // applied during rotation keeps its full duration until the next one.
    this.activeBuffs = tickAuras(this.activeBuffs, dt);
    this.activeDebuffs = tickAuras(this.activeDebuffs, dt);
    this.cooldowns = Object.fromEntries(
      Object.entries(this.cooldowns).map(([key, value]) => {
        const remaining = value - dt;
        return [key, remaining <= k("sim.tickEpsilon") ? 0 : remaining];
      }),
    );

    this.tickGcd(dt);

    // Handle existing DoTs before rotation so newly cast DoTs start ticking next update.
    for (const [dotName, dot] of Object.entries(this.activeDots)) {
      const elapsed = Math.min(dt, dot.duration);
      dot.duration -= dt;
      dot.timeUntilNextTick -= elapsed;

      while (dot.timeUntilNextTick <= k("sim.tickEpsilon")) {
        let dotTickDamage = dot.tickDamage;

        // hemorrhage.ruptureBonus.bonus applies to Rupture ticks only.
        if (dotName === "Rupture" && this.activeDebuffs["Hemorrhage"]) {
          dotTickDamage *= 1 + k("hemorrhage.ruptureBonus").bonus;
        }

        let dotHitCrit = "Hit";
        // roll crit for each tick
        if (
          k("dot.canCrit") &&
          rollCrit(this.rogue.getCritChance(), this.rng)
        ) {
          dotTickDamage *= k("dot.critMultiplier");
          dotHitCrit = "Crit";
        }
        dotTickDamage = applyArmor(dotTickDamage, tickSkipsArmor(dotName, dot));
        this.updateDamage(dotTickDamage);
        this.addCombatEvent(
          dotName,
          "skill",
          dotTickDamage,
          dotHitCrit,
          dotHitCrit,
          dot.icon,
        );
        dot.timeUntilNextTick += dot.tickInterval;
      }

      if (dot.duration <= k("sim.tickEpsilon")) {
        delete this.activeDots[dotName];
      }
    }

    // Points already counting down lose this step. A Premeditation cast
    // during rotation keeps the full premeditation.cpExpiry until the next one.
    this.rogue.tickPremeditation(dt);

    this.rogue.rotation(this, dt);
  }

  // Run the fight for `duration` seconds in fixed steps of k("sim.fixedStep"),
  // then one shorter step for what is left, so the fight ends exactly
  // `duration` after it started. This is the headless entry point: the same
  // seed and the same calls give the same fight. A split that lands on a step
  // boundary gives the same fight as one long call. A split inside a step
  // does not, because the short step at the end of the call is a step of its
  // own.
  run(duration) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError(
        `Simulation.run needs a finite duration in seconds, 0 or more. Got ${duration}.`,
      );
    }
    const stepSize = k("sim.fixedStep");
    // The step is a power of two, so this division is exact and `leftover`
    // is the exact remainder, never a rounding artefact.
    const wholeSteps = Math.floor(duration / stepSize);
    for (let index = 0; index < wholeSteps; index++) {
      this.step(stepSize);
    }
    const leftover = duration - wholeSteps * stepSize;
    if (leftover > 0) {
      this.step(leftover);
    }
  }

  setGcd() {
    this.gcd = this.gcdDuration;
  }

  tickGcd(dt) {
    if (this.gcd > 0) {
      this.gcd = Math.max(0, this.gcd - dt);
    }
  }

  updateDamage(d) {
    this.damageDone += d;
  }

  resolveAttack(name, attackType, baseDamage, icon = null) {
    const result = resolveAttack({
      attackType,
      baseDamage,
      bonusHitChance: this.rogue.getBonusHitChance(),
      critChance: this.rogue.getCritChance(),
      rng: this.rng,
    });
    const damage = applyArmor(result.damage, false);
    if (result.landed && damage > 0) {
      this.updateDamage(damage);
    }
    this.addCombatEvent(
      name,
      attackType,
      damage,
      result.status,
      result.outcome,
      icon,
    );
    return { ...result, damage };
  }

  resolveDotAttack(
    name,
    attackType,
    baseDamage,
    duration,
    icon = null,
    bleed = false,
  ) {
    const result = resolveAttack({
      attackType,
      baseDamage,
      bonusHitChance: this.rogue.getBonusHitChance(),
      // The application roll does not crit. Ticks read getCritChance().
      // tickDamage stays before armor; the tick loop applies it.
      critChance: 0,
      rng: this.rng,
    });
    const tickInterval = k("rupture.tickInterval");
    const tickCount = Math.floor(duration / tickInterval);
    if (result.landed && result.damage > 0 && tickCount > 0) {
      this.activeDots[name] = {
        duration,
        tickInterval,
        timeUntilNextTick: tickInterval,
        tickDamage: result.damage / tickCount,
        icon: icon,
        bleed: bleed || k("bleed.spells").includes(name),
      };
    }
    this.addCombatEvent(
      name,
      attackType,
      0,
      result.status,
      result.outcome,
      icon,
    );
    return result;
  }

  addCombatEvent(
    name,
    type,
    damage,
    status = "Hit",
    outcome = "hit",
    icon = null,
  ) {
    this.combatLog.unshift({
      id: this.nextCombatEventId++,
      time: this.currentTime,
      name,
      type,
      damage,
      status,
      outcome,
      icon,
    });
    if (this.combatLog.length > k("log.maxEvents")) {
      this.combatLog.pop();
    }
  }
}
