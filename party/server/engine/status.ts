export type StatusEffect = "COLD" | "HEAT" | "DIZZY" | "SLOWED" | "DISORIENTED" | "INJURED";

export interface StatusState {
  effect: StatusEffect;
  intensity: number;
  remaining: number;
}

export class StatusTracker {
  private readonly statuses = new Map<StatusEffect, StatusState>();

  apply(effect: StatusEffect, intensity: number, duration: number): StatusState {
    const next: StatusState = {
      effect,
      intensity: Math.max(0, Math.min(1, intensity)),
      remaining: Math.max(0, duration),
    };
    this.statuses.set(effect, next);
    return { ...next };
  }

  tick(dt: number): StatusState[] {
    const elapsed = Math.max(0, dt);
    for (const [effect, status] of this.statuses) {
      status.remaining = Math.max(0, status.remaining - elapsed);
      if (status.remaining === 0) this.statuses.delete(effect);
    }
    return this.list();
  }

  clear(effect: StatusEffect): boolean {
    return this.statuses.delete(effect);
  }

  has(effect: StatusEffect): boolean {
    return this.statuses.has(effect);
  }

  get(effect: StatusEffect): StatusState | null {
    const status = this.statuses.get(effect);
    return status ? { ...status } : null;
  }

  list(): StatusState[] {
    return [...this.statuses.values()].map(status => ({ ...status }));
  }
}

export interface HealthState {
  health: number;
  maxHealth: number;
  downed: boolean;
}

export function createHealth(maxHealth = 100): HealthState {
  const safeMax = Math.max(1, maxHealth);
  return { health: safeMax, maxHealth: safeMax, downed: false };
}

export function applyDamage(health: HealthState, amount: number): number {
  if (health.downed) return 0;
  const damage = Math.max(0, amount);
  health.health = Math.max(0, health.health - damage);
  if (health.health === 0) health.downed = true;
  return damage;
}

export function heal(health: HealthState, amount: number): number {
  if (health.downed) return 0;
  const before = health.health;
  health.health = Math.min(health.maxHealth, health.health + Math.max(0, amount));
  return health.health - before;
}

export function revive(health: HealthState, value = 25): boolean {
  if (!health.downed) return false;
  health.health = Math.max(1, Math.min(health.maxHealth, value));
  health.downed = false;
  return true;
}
