// CPI shared wallet: one pool of currency a whole team earns into and spends from, with a ledger of
// who earned and spent what (for stats and awards). The game decides prices and rewards; this only
// keeps the books and refuses to go below zero.

export interface LedgerEntry {
  amount: number;
  reason: string;
  playerId: string | null;
}

export interface SharedWallet {
  readonly balance: number;
  readonly earned: number;
  readonly spent: number;
  canAfford(amount: number): boolean;
  /** Adds to the pool. `playerId`: whose action earned it (null: nobody's, e.g. a refund). */
  earn(amount: number, reason: string, playerId?: string | null): void;
  /** Takes from the pool; false (and nothing taken) if there isn't enough. */
  spend(amount: number, reason: string, playerId: string | null): boolean;
  byPlayer(playerId: string): { earned: number; spent: number };
  ledger(): readonly LedgerEntry[];
}

export function createWallet(start: number): SharedWallet {
  let balance = Math.max(0, Math.round(start));
  let earned = 0;
  let spent = 0;
  const entries: LedgerEntry[] = [];
  const players = new Map<string, { earned: number; spent: number }>();
  const row = (id: string) => players.get(id) ?? players.set(id, { earned: 0, spent: 0 }).get(id)!;
  return {
    get balance() {
      return balance;
    },
    get earned() {
      return earned;
    },
    get spent() {
      return spent;
    },
    canAfford: (amount) => balance >= amount,
    earn(amount, reason, playerId = null) {
      const n = Math.round(amount);
      if (n <= 0) return;
      balance += n;
      earned += n;
      entries.push({ amount: n, reason, playerId });
      if (playerId) row(playerId).earned += n;
    },
    spend(amount, reason, playerId) {
      const n = Math.round(amount);
      if (n < 0 || n > balance) return false;
      balance -= n;
      spent += n;
      entries.push({ amount: -n, reason, playerId });
      if (playerId) row(playerId).spent += n;
      return true;
    },
    byPlayer: (id) => ({ ...(players.get(id) ?? { earned: 0, spent: 0 }) }),
    ledger: () => entries,
  };
}
