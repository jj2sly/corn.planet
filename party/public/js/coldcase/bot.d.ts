// Types for bot.js, the scripted agent the tests play the mission with.

import type { GameState, Input } from "./sim.js";

export interface Bot {
  next(state: GameState): Input;
  goal(state: GameState): { x: number; y: number; station?: string; hold?: boolean } | null;
}

export declare function createBot(options?: { setpoint?: number }): Bot;
