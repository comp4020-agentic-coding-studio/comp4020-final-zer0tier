import { db, transaction } from "./db.ts";
import { BOT_ID, getPet } from "./pets.ts";

// Friends: players a player has starred, so they can see at a glance who is
// online, visit them in one press, and invite them to a team without typing
// an ID. Starring is one-way and private, like a bookmark: the starred player
// isn't told, and only the player who starred can read the list.
// Each player keeps at most this many, so the table can't outgrow the player
// count by more than a small factor.
export const FRIENDS_MAX = 50;

// What a friends list row carries: enough to draw the pet and its name. Online
// status isn't saved; the client reads it from presence:updated.
export type Friend = { id: string; color: string; appearance: string; at: string };
export type FriendsOutcome = { friends: Friend[] } | { status: 400 | 404 | 409; error: string };

const list = db.prepare(
  `SELECT f.friend_id AS id, p.color, p.appearance, f.at FROM friends f JOIN pets p ON p.id = f.friend_id
   WHERE f.player_id = ? ORDER BY f.friend_id`,
);
const count = db.prepare("SELECT COUNT(*) AS n FROM friends WHERE player_id = ?");
const has = db.prepare("SELECT 1 FROM friends WHERE player_id = ? AND friend_id = ?");
const insert = db.prepare("INSERT INTO friends (player_id, friend_id) VALUES (?, ?)");
const remove = db.prepare("DELETE FROM friends WHERE player_id = ? AND friend_id = ?");
const isAccount = db.prepare("SELECT 1 FROM accounts WHERE id = ?");

// A player's friends, alphabetical, as saved.
export const friendsOf = (id: string): Friend[] => list.all(id) as Friend[];

// Starring someone already starred changes nothing and isn't an error, so a
// double press or a second window can't fail.
export function star(id: string, friend: string): FriendsOutcome {
  if (friend === id) return { status: 400, error: "You can't star yourself." };
  if (friend === BOT_ID) return { status: 400, error: "The bot isn't a player you can befriend." };
  return transaction(() => {
    if (!getPet(id)) return { status: 404, error: "no such pet" };
    if (!getPet(friend) || !isAccount.get(friend)) return { status: 404, error: `No player called ${friend}.` };
    if (!has.get(id, friend)) {
      if ((count.get(id) as { n: number }).n >= FRIENDS_MAX) {
        return { status: 409, error: `You can star up to ${FRIENDS_MAX} friends. Unstar someone first.` };
      }
      insert.run(id, friend);
    }
    return { friends: friendsOf(id) };
  });
}

// Unstarring someone not starred changes nothing either.
export function unstar(id: string, friend: string): FriendsOutcome {
  return transaction(() => {
    remove.run(id, friend);
    return { friends: friendsOf(id) };
  });
}
