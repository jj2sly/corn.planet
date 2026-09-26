// CPI destructibles: how much health a block of a material gets and how much a hit takes off it.
// Pairs with rigid.ts (whose onImpact reports closing speed and effective mass). A game keeps its own
// material table (physics, health, what a break is worth) and passes the part this needs.

export interface MaterialHealth {
  /** Health of a block of `refArea` square units. */
  hp: number;
}

/** Bigger blocks are tougher, but not linearly: a slab twice the size is ~1.4× as tough. */
export function blockHealth(material: MaterialHealth, area: number, refArea = 2400): number {
  return Math.round(material.hp * Math.max(0.5, Math.min(2.5, Math.sqrt(area / refArea))));
}

export interface DamageRule {
  /** Impulses below this (resting, nudges) do nothing. */
  threshold: number;
  perImpulse: number;
}

/** Damage from a hit of `mass` (effective) closing at `speed`. */
export function impactDamage(mass: number, speed: number, rule: DamageRule): number {
  return Math.max(0, mass * speed - rule.threshold) * rule.perImpulse;
}

/** 0..1 → how cracked something looks, in steps, so screens don't redraw for every scratch. */
export function crackStage(hp: number, maxHp: number, stages = 4): number {
  if (maxHp <= 0) return 0;
  const lost = 1 - Math.max(0, hp) / maxHp;
  return Math.min(stages, Math.floor(lost * (stages + 1)));
}
