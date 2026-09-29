export interface RepairEffect {
  id: string;
  description: string;
  apply: (context: Record<string, unknown>) => void;
}

export class RepairEffectRegistry {
  private readonly effects = new Map<string, RepairEffect>();

  add(effect: RepairEffect): boolean {
    if (this.effects.has(effect.id)) return false;
    this.effects.set(effect.id, effect);
    return true;
  }

  apply(id: string, context: Record<string, unknown>): boolean {
    const effect = this.effects.get(id);
    if (!effect) return false;
    effect.apply(context);
    return true;
  }

  get(id: string): RepairEffect | null {
    return this.effects.get(id) ?? null;
  }
}
