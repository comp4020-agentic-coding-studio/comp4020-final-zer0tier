import { db, transaction } from "./db.ts";
import { BOT_ID, getPet } from "./pets.ts";

// The guestbook: a visitor leaves one of a fixed set of friendly phrases for
// a pet's owner. Fixed phrases mean there's nothing to moderate. Only the
// owner reads them, in the Journal.
export const PHRASES = [
  { id: "adorable", text: "Your pet is adorable!" },
  { id: "food", text: "Thanks for the food!" },
  { id: "gift", text: "Thanks for the gift!" },
  { id: "rematch", text: "Rematch?" },
  { id: "good-fight", text: "Good fight!" },
  { id: "visit-me", text: "Come visit me!" },
  { id: "team-up", text: "Want to team up?" },
  { id: "sorry", text: "Sorry about that…" },
] as const;
export type PhraseId = (typeof PHRASES)[number]["id"];
export const isPhraseId = (value: unknown): value is PhraseId => PHRASES.some((phrase) => phrase.id === value);

// One note every 10 seconds from each visitor to each pet, and each pet keeps
// only its newest 10, so a guestbook can't flood or fill the disk.
export const NOTE_COOLDOWN_MS = 10_000;
export const NOTES_KEPT = 10;

export type Note = { id: number; visitor: string; pet: string; phrase: PhraseId; at: string };
export type NoteOutcome = { note: Note } | { status: 400 | 404 | 429; error: string };

const COLUMNS = "id, visitor, pet, phrase, at";
const insert = db.prepare("INSERT INTO notes (visitor, pet, phrase) VALUES (?, ?, ?)");
const select = db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`);
const lastBy = db.prepare("SELECT at FROM notes WHERE pet = ? AND visitor = ? ORDER BY id DESC LIMIT 1");
const newest = db.prepare(`SELECT ${COLUMNS} FROM notes WHERE pet = ? ORDER BY id DESC LIMIT ?`);
const prune = db.prepare(
  "DELETE FROM notes WHERE pet = ? AND id NOT IN (SELECT id FROM notes WHERE pet = ? ORDER BY id DESC LIMIT ?)",
);
const clearAll = db.prepare("DELETE FROM notes WHERE pet = ?");

export function leaveNote(visitorId: string, petId: string, phrase: PhraseId): NoteOutcome {
  if (visitorId === petId) return { status: 400, error: "Your guestbook is for visitors' notes." };
  if (petId === BOT_ID) return { status: 400, error: "The bot doesn't keep a guestbook." };
  return transaction(() => {
    if (!getPet(visitorId)) return { status: 404, error: "no such pet" };
    if (!getPet(petId)) return { status: 404, error: `There's no pet called ${petId}.` };
    const last = lastBy.get(petId, visitorId) as { at: string } | undefined;
    if (last && Date.now() - Date.parse(last.at) < NOTE_COOLDOWN_MS) {
      return { status: 429, error: `You just left ${petId} a note. Wait a few seconds before the next.` };
    }
    const { lastInsertRowid } = insert.run(visitorId, petId, phrase);
    prune.run(petId, petId, NOTES_KEPT);
    return { note: select.get(lastInsertRowid) as Note };
  });
}

// A pet's guestbook, newest first.
export const notesFor = (petId: string): Note[] => newest.all(petId, NOTES_KEPT) as Note[];

// The owner tears out every page. Returns how many notes went.
export function clearNotes(petId: string): number {
  return Number(clearAll.run(petId).changes);
}
