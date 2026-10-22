import { resolveAttack, rollCrit } from "./attack-resolver.js";

export class Simulation {
  constructor(rogue) {
    this.rogue = rogue;
    this.currentTime = 0;
    this.damageDone = 0;
    this.gcd = 0; // Global Cooldown
    this.gcdDuration = 1.0;
    this.combatLog = [];
    this.nextCombatEventId = 0;
    this.lastFrameTime = performance.now();
    this.cooldowns = {}; // Track cooldowns for skills
    this.activeBuffs = {}; // Track active buffs
    this.activeDots = {}; // Track active damage over time effects
  }

  update(currentTime) {
    let dt = Math.max(0, (currentTime - this.lastFrameTime) / 1000); // Convert to seconds
    this.lastFrameTime = currentTime;
    this.currentTime += dt;

    if (
      this.activeBuffs["Adrenaline Rush"] &&
      this.activeBuffs["Adrenaline Rush"].duration > 0
    ) {
      this.rogue.regenerateEnergy(dt, 20);
    } else {
      this.rogue.regenerateEnergy(dt, 10);
    }
    this.tickGcd(dt);

    // Handle existing DoTs before rotation so newly cast DoTs start ticking next update.
    for (const [dotName, dot] of Object.entries(this.activeDots)) {
      const elapsed = Math.min(dt, dot.duration);
      dot.duration -= dt;
      dot.timeUntilNextTick -= elapsed;

      while (dot.timeUntilNextTick <= 1e-9) {
        let dotTickDamage = dot.tickDamage;

        if (this.activeBuffs["Hemorrhage"]) {
          dotTickDamage *= 1.15;
          console.log(dotTickDamage);
        }

        let dotHitCrit = "Hit";
        // roll crit for each tick
        if (rollCrit(this.rogue.critChance)) {
          dotTickDamage *= 2;
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

      if (dot.duration <= 0) {
        delete this.activeDots[dotName];
      }
    }

    this.rogue.rotation(this, dt);

    this.activeBuffs = Object.fromEntries(
      Object.entries(this.activeBuffs).filter(([, buff]) => {
        buff.duration -= dt;
        return buff.duration > 0;
      }),
    );

    this.cooldowns = Object.fromEntries(
      Object.entries(this.cooldowns).map(([key, value]) => [
        key,
        Math.max(0, value - dt),
      ]),
    );
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
    const tickCount = Math.floor(duration / 2);
    if (result.landed && result.damage > 0 && tickCount > 0) {
      this.activeDots[name] = {
        duration,
        tickInterval: 2,
        timeUntilNextTick: 2,
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
    if (this.combatLog.length > 100) {
      this.combatLog.pop();
    }
  }
}
