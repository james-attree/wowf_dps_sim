import { resolveAttack } from "./attack-resolver.js";

export class Simulation {
    constructor(rogue) {
        this.rogue = rogue;
        this.currentTime = 0;
        this.damageDone = 0;
        this.gcd = 0; // Global Cooldown
        this.gcdDuration = 1.5;
        this.combatLog = [];
        this.nextCombatEventId = 0;
        this.lastFrameTime = performance.now();
        this.cooldowns = {}; // Track cooldowns for skills
        this.activeBuffs = {}; // Track active buffs
    }

    update(currentTime){
        let dt = Math.max(0, (currentTime - this.lastFrameTime) / 1000); // Convert to seconds
        this.lastFrameTime = currentTime;
        this.currentTime += dt;

        if (this.activeBuffs["Adrenaline Rush"] && this.activeBuffs["Adrenaline Rush"].duration > 0) {
            this.rogue.regenerateEnergy(dt, 20);
        } else {
            this.rogue.regenerateEnergy(dt, 10);
        }
        this.tickGcd(dt);

        this.rogue.rotation(this, dt);

        this.activeBuffs = Object.fromEntries(
            Object.entries(this.activeBuffs).filter(([key, buff]) => {
                buff.duration -= dt;
                return buff.duration > 0;
            })
        );

        this.cooldowns = Object.fromEntries(
            Object.entries(this.cooldowns).map(([key, value]) => [key, Math.max(0, value - dt)])
        );
    }

    setGcd(){
        this.gcd = this.gcdDuration;
    }

    tickGcd(dt){
        if(this.gcd > 0){
            this.gcd = Math.max(0, this.gcd - dt);
        }
    }

    updateDamage(d){
        this.damageDone += d;
    }

    resolveAttack(name, attackType, baseDamage, icon = null){
        const result = resolveAttack({
            attackType,
            baseDamage,
            bonusHitChance: this.rogue.bonusHitChance,
            critChance: this.rogue.critChance
        });
        if(result.damage > 0){
            this.updateDamage(result.damage);
        }
        this.addCombatEvent(name, attackType, result.damage, result.status, result.outcome, icon);
        return result;
    }

    addCombatEvent(name, type, damage, status = "Hit", outcome = "hit", icon = null){
        this.combatLog.unshift({
            id: this.nextCombatEventId++,
            time: this.currentTime,
            name,
            type,
            damage,
            status,
            outcome,
            icon
        });
        if(this.combatLog.length > 100){
            this.combatLog.pop();
        }
    }
}