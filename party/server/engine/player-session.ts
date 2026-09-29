export interface PlayerSession {
  playerId: string;
  connected: boolean;
  zoneId: string;
  joinedAt: number;
  lastSeenAt: number;
}

export class PlayerSessionRegistry {
  private readonly players = new Map<string, PlayerSession>();

  join(playerId: string, zoneId: string, now = Date.now()): PlayerSession {
    const existing = this.players.get(playerId);
    const session = existing
      ? { ...existing, connected: true, zoneId, lastSeenAt: now }
      : { playerId, connected: true, zoneId, joinedAt: now, lastSeenAt: now };
    this.players.set(playerId, session);
    return { ...session };
  }

  heartbeat(playerId: string, now = Date.now()): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.lastSeenAt = now;
    player.connected = true;
    return true;
  }

  leave(playerId: string, now = Date.now()): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.connected = false;
    player.lastSeenAt = now;
    return true;
  }

  connected(): PlayerSession[] {
    return [...this.players.values()].filter(player => player.connected).map(player => ({ ...player }));
  }
}
