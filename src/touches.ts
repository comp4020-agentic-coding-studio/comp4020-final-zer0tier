import { db, transaction } from "./db.ts";
import { getPet } from "./pets.ts";

// A visitor can pat, tickle, stroke or shake paws with someone else's pet. A
// touch changes nothing in the game: it's saved so the pet reacts in every
// window showing it, and so its owner can see who came by.
export const TOUCH_KINDS = ["pat", "tickle", "stroke", "paw"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
export const isTouchKind = (value: unknown): value is TouchKind => TOUCH_KINDS.includes(value as TouchKind);

// One touch a second from each visitor to each pet, so mashing a button
// doesn't flood every open window.
export const TOUCH_COOLDOWN_MS = 1000;
// The owner's visitors list: each visitor's latest touch, for the newest few
// visitors. Older touches on each pet are pruned.
export const VISITORS_KEPT = 5;

export type Touch = { id: number; visitor: string; pet: string; kind: TouchKind; at: string };
export type TouchOutcome = { touch: Touch } | { status: 400 | 404 | 429; error: string };

const COLUMNS = "id, visitor, pet, kind, at";
const insert = db.prepare("INSERT INTO touches (visitor, pet, kind) VALUES (?, ?, ?)");
const select = db.prepare(`SELECT ${COLUMNS} FROM touches WHERE id = ?`);
const lastBy = db.prepare("SELECT at FROM touches WHERE pet = ? AND visitor = ? ORDER BY id DESC LIMIT 1");
const newest = db.prepare(`SELECT ${COLUMNS} FROM touches WHERE pet = ? ORDER BY id DESC LIMIT ?`);
const forget = db.prepare("DELETE FROM touches WHERE pet = ? AND visitor = ? AND id < ?");
const prune = db.prepare(
  "DELETE FROM touches WHERE pet = ? AND id NOT IN (SELECT id FROM touches WHERE pet = ? ORDER BY id DESC LIMIT ?)",
);

export function touch(visitorId: string, petId: string, kind: TouchKind): TouchOutcome {
  if (visitorId === petId) return { status: 400, error: "Play with your own pet from your dashboard." };
  return transaction(() => {
    if (!getPet(visitorId)) return { status: 404, error: "no such pet" };
    if (!getPet(petId)) return { status: 404, error: `There's no pet called ${petId}.` };
    const last = lastBy.get(petId, visitorId) as { at: string } | undefined;
    if (last && Date.now() - Date.parse(last.at) < TOUCH_COOLDOWN_MS) {
      return { status: 429, error: `Give ${petId} a moment between touches.` };
    }
    const { lastInsertRowid } = insert.run(visitorId, petId, kind);
    forget.run(petId, visitorId, lastInsertRowid);
    prune.run(petId, petId, VISITORS_KEPT);
    return { touch: select.get(lastInsertRowid) as Touch };
  });
}

// A pet's recent visitors, newest first, each with their latest touch.
export const touchesOn = (petId: string): Touch[] => newest.all(petId, VISITORS_KEPT) as Touch[];
