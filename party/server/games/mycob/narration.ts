// The narration layer: INCIDENT DIRECTOR -> NARRATION -> TEXT (and, later, a voice).
//
// Every line the narrator says is a typed event with a stable id. Screens render the text; a
// future voice/TTS provider on the host screen (public/js/games/mycob-voice.js) can speak the same
// events by id. Text is authoritative and nothing ever waits for audio.

export const NARRATION_TYPES = [
  "incident_alert",
  "stage_transition",
  "consequence",
  "life_loss",
  "discovery",
  "objective_update",
  "special_event",
  "ending",
  "award",
] as const;
export type NarrationType = (typeof NARRATION_TYPES)[number];

export interface NarrationEvent {
  id: string;
  /** Events are grouped into beats; a screen shows the current beat. */
  beat: number;
  type: NarrationType;
  stage: number;
  text: string;
  /** null: everyone. Otherwise only this agent's phone sees it (e.g. "you lost a life"). */
  playerId: string | null;
}

export class NarrationLog {
  private readonly events: NarrationEvent[] = [];
  private beat = 0;

  /** Starts a new beat: the next events replace what screens are showing. */
  newBeat(): void {
    this.beat += 1;
  }

  add(type: NarrationType, stage: number, text: string, playerId: string | null = null): NarrationEvent {
    const event: NarrationEvent = { id: `n${this.events.length + 1}`, beat: this.beat, type, stage, text, playerId };
    this.events.push(event);
    return event;
  }

  /** The current beat as one viewer may see it. The host passes null and gets public events only. */
  current(playerId: string | null): NarrationEvent[] {
    return this.events.filter((e) => e.beat === this.beat && (e.playerId === null || e.playerId === playerId));
  }

  all(): readonly NarrationEvent[] {
    return this.events;
  }
}
