import { db } from "./db.ts";
import { broadcast } from "./realtime.ts";

// The Arena's "Happening now": moments worth telling everyone about, so each
// player sees the others playing. Entries are data; the page words them.
export type FeedEntry =
  | { id: number; at: string; kind: "joined"; pet: string }
  | { id: number; at: string; kind: "fight"; pet: string; other: string; winner: string; spoils: number }
  | { id: number; at: string; kind: "school"; pet: string; school: string }
  | { id: number; at: string; kind: "promoted"; pet: string; location: string; rank: number };

type Fields<E> = E extends unknown ? Omit<E, "id" | "at"> : never;
export type NewFeedEntry = Fields<FeedEntry>;

// Only the newest entries are worth keeping; older ones are pruned as new ones land.
const KEEP = 500;

const insert = db.prepare("INSERT INTO feed (kind, pet, detail) VALUES (?, ?, ?)");
const prune = db.prepare("DELETE FROM feed WHERE id <= ?");
const COLUMNS = "id, kind, pet, detail, at";
const newest = db.prepare(`SELECT ${COLUMNS} FROM feed ORDER BY id DESC LIMIT ?`);
const after = db.prepare(`SELECT ${COLUMNS} FROM feed WHERE id > ? ORDER BY id`);
const lastId = db.prepare("SELECT coalesce(max(id), 0) AS id FROM feed");

type Row = { id: number; kind: string; pet: string; detail: string; at: string };
const entry = ({ detail, ...row }: Row): FeedEntry => ({ ...row, ...JSON.parse(detail) }) as FeedEntry;

// Saves an entry. It reaches clients at the next `announce`, once the change
// it describes is saved and broadcast too.
export function record(news: NewFeedEntry): void {
  const { kind, pet, ...detail } = news;
  const { lastInsertRowid } = insert.run(kind, pet, JSON.stringify(detail));
  prune.run(Number(lastInsertRowid) - KEEP);
}

export const recentFeed = (limit: number): FeedEntry[] => (newest.all(limit) as Row[]).map(entry);

// The last entry sent to clients. Entries saved but not yet announced when the
// app stopped are still in the feed for anyone who loads it.
let announced = (lastId.get() as { id: number }).id;

// Broadcasts every entry saved since the last announcement, as read back.
export function announce(): void {
  for (const row of after.all(announced) as Row[]) {
    announced = row.id;
    broadcast({ type: "feed:added", entry: entry(row) });
  }
}
