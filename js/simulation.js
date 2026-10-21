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
    }

    update(currentTime){
        let dt = Math.max(0, (currentTime - this.lastFrameTime) / 1000); // Convert to seconds
        this.lastFrameTime = currentTime;
        this.currentTime += dt;

        this.rogue.regenerateEnergy(dt);
        this.tickGcd(dt);

        this.rogue.rotation(this, dt);
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

    resolveAttack(name, attackType, baseDamage){
        const result = resolveAttack({
            attackType,
            baseDamage,
            bonusHitChance: this.rogue.bonusHitChance,
            critChance: this.rogue.critChance
        });
        if(result.damage > 0){
            this.updateDamage(result.damage);
        }
        this.addCombatEvent(name, attackType, result.damage, result.status, result.outcome);
        return result;
    }

    addCombatEvent(name, type, damage, status = "Hit", outcome = "hit"){
        this.combatLog.unshift({
            id: this.nextCombatEventId++,
            time: this.currentTime,
            name,
            type,
            damage,
            status,
            outcome
        });
        if(this.combatLog.length > 100){
            this.combatLog.pop();
        }
    }
}