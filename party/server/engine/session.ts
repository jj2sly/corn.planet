export type SessionPhase = "BRIEFING" | "ACTIVE" | "EXTRACTION" | "COMPLETE" | "FAILED";

export interface SessionState {
  phase: SessionPhase;
  startedAt: number | null;
  elapsed: number;
}

export class MissionSession {
  private state: SessionState = { phase: "BRIEFING", startedAt: null, elapsed: 0 };

  read(): SessionState { return { ...this.state }; }

  start(now = Date.now()): boolean {
    if (this.state.phase !== "BRIEFING") return false;
    this.state = { phase: "ACTIVE", startedAt: now, elapsed: 0 };
    return true;
  }

  beginExtraction(): boolean {
    if (this.state.phase !== "ACTIVE") return false;
    this.state.phase = "EXTRACTION";
    return true;
  }

  complete(): boolean {
    if (this.state.phase !== "EXTRACTION") return false;
    this.state.phase = "COMPLETE";
    return true;
  }

  fail(): boolean {
    if (this.state.phase === "COMPLETE" || this.state.phase === "FAILED") return false;
    this.state.phase = "FAILED";
    return true;
  }

  tick(dt: number): void {
    if (this.state.phase === "ACTIVE" || this.state.phase === "EXTRACTION") this.state.elapsed += Math.max(0, dt);
  }
}
