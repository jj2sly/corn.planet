// Every failure a client can see is one of these codes. Messages are written for players,
// never include internals, and are the only error text that leaves the server.

export const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: "No active session with that code. Check the code on the host screen.",
  ROOM_FULL: "That session is at maximum capacity.",
  GAME_IN_PROGRESS: "That session is mid-game. Wait for the round to end, then join.",
  NAME_TAKEN: "Another agent in this session already uses that name.",
  INVALID_NAME: "Names must be 1–16 characters.",
  INVALID_CODE: "Session codes are 4 letters.",
  SESSION_ENDED: "Your seat in that session is no longer available.",
  SESSION_REPLACED: "This session was opened on another screen.",
  NOT_IN_ROOM: "You are not connected to a session.",
  NOT_ALLOWED: "Only the host screen or the session leader can do that.",
  NOT_ENOUGH_PLAYERS: "Not enough connected agents to start this game.",
  TOO_MANY_PLAYERS: "Too many agents for this game.",
  UNKNOWN_GAME: "That game is not installed.",
  INVALID_ACTION: "That action isn't available right now.",
  PHASE_CLOSED: "Too late — that window has closed.",
  NOT_YOUR_PROMPT: "That incident wasn't assigned to you.",
  ANSWER_EMPTY: "Your report is empty.",
  ANSWER_TOO_LONG: "Your report is too long.",
  INVALID_VOTE: "That vote isn't valid.",
  CANNOT_VOTE_OWN: "You can't vote for your own report.",
  NOT_ELIGIBLE: "You can't vote on your own incident.",
  ALREADY_VOTED: "Your vote is already locked in.",
  RATE_LIMITED: "Slow down, agent. Try again in a moment.",
  AUTH_REQUIRED: "Log in to do that.",
  AUTH_FAILED: "Your login could not be verified. Log in again.",
  AUTH_DISABLED: "Accounts are not enabled on this server.",
  FORBIDDEN: "Your clearance level doesn't allow that.",
  NOT_FOUND: "Not found.",
  INVALID_INPUT: "Some of that input isn't valid.",
  SERVER_ERROR: "Something went wrong on our side. Try again.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class PartyError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function toClientError(err: unknown): { ok: false; error: ErrorCode; message: string } {
  if (err instanceof PartyError) {
    return { ok: false, error: err.code, message: err.detail ?? ERROR_MESSAGES[err.code] };
  }
  console.error("[cpst-party] unexpected error:", err);
  return { ok: false, error: "SERVER_ERROR", message: ERROR_MESSAGES.SERVER_ERROR };
}
