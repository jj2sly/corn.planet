export interface TriggerContext {
  playerId?: string;
  entityId?: string;
  values: Record<string, unknown>;
}

export interface Trigger {
  id: string;
  once: boolean;
  fired: boolean;
  condition: (context: TriggerContext) => boolean;
  action: (context: TriggerContext) => void;
}

export class TriggerRegistry {
  private readonly triggers = new Map<string, Trigger>();

  add(trigger: Trigger): boolean {
    if (this.triggers.has(trigger.id)) return false;
    this.triggers.set(trigger.id, trigger);
    return true;
  }

  evaluate(context: TriggerContext): string[] {
    const fired: string[] = [];
    for (const trigger of this.triggers.values()) {
      if (trigger.once && trigger.fired) continue;
      if (!trigger.condition(context)) continue;
      trigger.action(context);
      trigger.fired = true;
      fired.push(trigger.id);
    }
    return fired;
  }
}
