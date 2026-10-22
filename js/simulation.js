import { k } from "../data/constants.js";
import { resolveAttack, rollCrit } from "./attack-resolver.js";

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
    this.activeBuffs = {}; // Track active buffs
    this.activeDots = {}; // Track active damage over time effects
  }

  update(currentTime) {
    let dt = Math.max(
      0,
      (currentTime - this.lastFrameTime) / k("sim.msPerSecond"),
    ); // Convert to seconds
    this.lastFrameTime = currentTime;
    this.currentTime += dt;

    // Timers already running lose this frame. A buff or cooldown applied
    // during rotation keeps its full duration until the next one.
    this.activeBuffs = Object.fromEntries(
      Object.entries(this.activeBuffs).filter(([, buff]) => {
        buff.duration -= dt;
        return buff.duration > k("sim.tickEpsilon");
      }),
    );
    this.cooldowns = Object.fromEntries(
      Object.entries(this.cooldowns).map(([key, value]) => {
        const remaining = value - dt;
        return [key, remaining <= k("sim.tickEpsilon") ? 0 : remaining];
      }),
    );

    if (
      this.activeBuffs["Adrenaline Rush"] &&
      this.activeBuffs["Adrenaline Rush"].duration > 0
    ) {
      this.rogue.regenerateEnergy(
        dt,
        k("energy.regenPerSecond") * k("adrenalineRush").regenMultiplier,
      );
    } else {
      this.rogue.regenerateEnergy(dt, k("energy.regenPerSecond"));
    }
    this.tickGcd(dt);

    // Handle existing DoTs before rotation so newly cast DoTs start ticking next update.
    for (const [dotName, dot] of Object.entries(this.activeDots)) {
      const elapsed = Math.min(dt, dot.duration);
      dot.duration -= dt;
      dot.timeUntilNextTick -= elapsed;

      while (dot.timeUntilNextTick <= k("sim.tickEpsilon")) {
        let dotTickDamage = dot.tickDamage;

        if (this.activeBuffs["Hemorrhage"]) {
          dotTickDamage *= 1 + k("hemorrhage.ruptureBonus").bonus;
        }

        let dotHitCrit = "Hit";
        // roll crit for each tick
        if (k("dot.canCrit") && rollCrit(this.rogue.critChance)) {
          dotTickDamage *= k("dot.critMultiplier");
          dotHitCrit = "Crit";
        }
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
      bonusHitChance: this.rogue.bonusHitChance,
      critChance: this.rogue.critChance,
    });
    if (result.landed && result.damage > 0) {
      this.updateDamage(result.damage);
    }
    this.addCombatEvent(
      name,
      attackType,
      result.damage,
      result.status,
      result.outcome,
      icon,
    );
    return result;
  }

  resolveDotAttack(name, attackType, baseDamage, duration, icon = null) {
    const result = resolveAttack({
      attackType,
      baseDamage,
      bonusHitChance: this.rogue.bonusHitChance,
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
