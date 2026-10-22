import { k } from "../data/constants.js";
import { resolveAttack, rollCrit } from "./attack-resolver.js";

// Auras already running lose this frame. One applied during rotation is not
// in the map yet, so it keeps the duration it was given.
function tickAuras(auras, dt) {
  return Object.fromEntries(
    Object.entries(auras).filter(([, aura]) => {
      aura.duration -= dt;
      return aura.duration > k("sim.tickEpsilon");
    }),
  );
}

// Classic physical periodic damage ignores armor. Forever keeps that for the
// bleed spell list. Direct hits and any other tick use armor.mitigation.
function isBleedTick(name, dot) {
  return dot.bleed === true || k("bleed.spells").includes(name);
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

function applyArmor(damage, bleed) {
  if (bleed && k("bleed.ignoresArmor")) {
    return damage;
  }
  return damage * armorMultiplier();
}

export class Simulation {
  constructor(rogue) {
    this.rogue = rogue;
    this.currentTime = 0;
    this.damageDone = 0;
    this.gcd = 0; // Global Cooldown
    this.gcdDuration = k("gcd.duration");
    this.combatLog = [];
    this.nextCombatEventId = 0;
    this.lastFrameTime = performance.now();
    this.cooldowns = {}; // Track cooldowns for skills
    this.activeBuffs = {}; // Self buffs: Slice and Dice, Adrenaline Rush, Blade Flurry, Ghostly Strike
    this.activeDebuffs = {}; // Target debuffs and DoTs
    this.activeDots = {}; // Track active damage over time effects
  }

  update(currentTime) {
    let dt = Math.max(
      0,
      (currentTime - this.lastFrameTime) / k("sim.msPerSecond"),
    ); // Convert to seconds
    this.lastFrameTime = currentTime;
    this.currentTime += dt;

    // This frame covers the interval that just ended. Read Adrenaline Rush
    // before its countdown so the part of the frame still inside the buff
    // regenerates at the bonus rate, including the frame it runs out.
    const arLeft = this.activeBuffs["Adrenaline Rush"]?.duration ?? 0;
    const base = k("energy.regenPerSecond");
    const arDt = Math.min(dt, Math.max(0, arLeft));
    this.rogue.regenerateEnergy(dt - arDt, base);
    this.rogue.regenerateEnergy(
      arDt,
      base * k("adrenalineRush").regenMultiplier,
    );

    // Timers already running lose this frame. A buff, debuff, or cooldown
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

        // hemorrhage.ruptureBonus.bonus applies to every active DoT tick.
        if (this.activeDebuffs["Hemorrhage"]) {
          dotTickDamage *= 1 + k("hemorrhage.ruptureBonus").bonus;
        }

        let dotHitCrit = "Hit";
        // roll crit for each tick
        if (k("dot.canCrit") && rollCrit(this.rogue.getCritChance())) {
          dotTickDamage *= k("dot.critMultiplier");
          dotHitCrit = "Crit";
        }
        dotTickDamage = applyArmor(dotTickDamage, isBleedTick(dotName, dot));
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

    // Points already counting down lose this frame. A Premeditation cast
    // during rotation keeps the full premeditation.cpExpiry until the next one.
    this.rogue.tickPremeditation(dt);

    this.rogue.rotation(this, dt);
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
