// Shared phase/timer-friendly state machine helper for CPI Party games.
//
// This is intentionally small. It owns no timers or networking; the game still decides when a
// transition happens. The helper exists so future games can represent legal phases consistently
// without depending on Room or another game's implementation.

export class GameStateMachine<State extends string> {
  private current: State;

  constructor(initial: State) {
    this.current = initial;
  }

  get state(): State {
    return this.current;
  }

  is(...states: State[]): boolean {
    return states.includes(this.current);
  }

  transition(next: State): void {
    this.current = next;
  }
}
