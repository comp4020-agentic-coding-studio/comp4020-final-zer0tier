import { db, transaction } from "./db.ts";

// Watching live Arena and revenge fights from the stands. The database holds
// who watches what; realtime.ts reads it to decide who hears each turn, and
// broadcasts each battle's count as read back from it.
import { BOT_ID } from "./bot.ts";

// Live player-versus-player fights anyone else may watch: Arena and revenge,
// never practice against the bot. (Adventure battles live elsewhere entirely.)
const watchable = db.prepare(
  "SELECT id, player_a, player_b FROM manual_battles WHERE status = 'active' AND player_a != ? AND player_b != ? ORDER BY rowid DESC LIMIT ?",
);
const oneWatchable = db.prepare(
  "SELECT id, player_a, player_b FROM manual_battles WHERE id = ? AND status = 'active' AND player_a != ? AND player_b != ?",
);
const countFor = db.prepare("SELECT count(*) AS count FROM battle_watchers WHERE battle_id = ?");
const watching = db.prepare("SELECT battle_id FROM battle_watchers WHERE player_id = ?");
const watchersOf = db.prepare("SELECT player_id FROM battle_watchers WHERE battle_id = ?");
const upsert = db.prepare(
  "INSERT INTO battle_watchers (player_id, battle_id) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET battle_id = excluded.battle_id",
);
const removePlayer = db.prepare("DELETE FROM battle_watchers WHERE player_id = ?");
const removeBattle = db.prepare("DELETE FROM battle_watchers WHERE battle_id = ?");
const removeAll = db.prepare("DELETE FROM battle_watchers");

type Row = { id: string; player_a: string; player_b: string };
export type LiveBattle = { id: string; attacker: string; defender: string; watchers: number };
// A watchable fight's crowd, as saved, and whether it's still live: every
// window's Arena list adds a fight when it starts and drops it when it ends.
export type WatcherCount = { battle: string; count: number; live: boolean; attacker?: string; defender?: string };
const isWatchable = (attacker: string, defender: string) => attacker !== BOT_ID && defender !== BOT_ID;

// The news to send when a fight starts or ends, if anyone else may watch it.
export function standsNews(battle: string, attacker: string, defender: string, live: boolean): WatcherCount | undefined {
  if (!isWatchable(attacker, defender)) return undefined;
  return { battle, count: live ? watchersCount(battle) : 0, live, ...(live ? { attacker, defender } : {}) };
}

export const LIVE_LIMIT = 20;
const watchersCount = (battle: string) => (countFor.get(battle) as { count: number }).count;

export function liveBattles(): LiveBattle[] {
  return (watchable.all(BOT_ID, BOT_ID, LIVE_LIMIT) as Row[])
    .map(row => ({ id: row.id, attacker: row.player_a, defender: row.player_b, watchers: watchersCount(row.id) }));
}

// The watchers who should hear this battle's turns, as saved.
export const audienceOf = (battle: string): string[] =>
  (watchersOf.all(battle) as { player_id: string }[]).map(row => row.player_id);

export type WatchOutcome =
  | { battle: LiveBattle; counts: WatcherCount[] }
  | { status: 403 | 404 | 409; error: string };

// Takes a seat at one live fight, leaving any other. Returns the saved count of
// every battle that changed, for the caller to broadcast.
export function watch(player: string, battleId: string): WatchOutcome {
  return transaction(() => {
    const row = oneWatchable.get(battleId, BOT_ID, BOT_ID) as Row | undefined;
    if (!row) return { status: 404, error: "That fight has finished, or isn't one you can watch." };
    if (row.player_a === player || row.player_b === player) return { status: 409, error: "You're in this fight. Play it from your battle window." };
    const before = (watching.get(player) as { battle_id: string } | undefined)?.battle_id;
    // Already in these stands: a retry changes nothing and announces nothing.
    const changed = before === battleId ? [] : before ? [before, battleId] : [battleId];
    if (changed.length) upsert.run(player, battleId);
    return {
      battle: { id: row.id, attacker: row.player_a, defender: row.player_b, watchers: watchersCount(row.id) },
      counts: changed.map(crowdOf),
    };
  });
}

// Leaving the stands: closing the window, signing out, or going offline.
export function unwatch(player: string): WatcherCount[] {
  return transaction(() => {
    const before = (watching.get(player) as { battle_id: string } | undefined)?.battle_id;
    if (!before) return [];
    removePlayer.run(player);
    return [crowdOf(before)];
  });
}

// A fight's crowd as saved. While it's live, the news names its fighters, so
// any window can list a fight it hasn't seen start.
const fightersOf = db.prepare("SELECT player_a, player_b, status FROM manual_battles WHERE id = ?");
function crowdOf(battle: string): WatcherCount {
  const row = fightersOf.get(battle) as { player_a: string; player_b: string; status: string } | undefined;
  const live = row?.status === 'active';
  return { battle, count: live ? watchersCount(battle) : 0, live, ...(live ? { attacker: row.player_a, defender: row.player_b } : {}) };
}

// Once a fight ends, everyone in the stands has seen the final turn; clear them.
export function closeStands(battle: string): WatcherCount | undefined {
  return transaction(() => {
    if (watchersCount(battle) === 0) return undefined;
    removeBattle.run(battle);
    return { battle, count: 0, live: false };
  });
}

// On start, nobody is connected yet, so nobody is watching anything. Each
// spectator's window takes its seat again once it reconnects.
export function emptyStands(): void {
  removeAll.run();
}
