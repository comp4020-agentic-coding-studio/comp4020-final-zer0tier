import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { playerFor } from "./auth.ts";
import { logEvent, ROOM } from "./logging.ts";
import type { FeedEntry } from "./feed.ts";
import type { BattleSession, Fight, Pet } from "./pets.ts";
import type { Team } from "./teams.ts";
import type { Touch } from "./touches.ts";
import type { Note } from "./notes.ts";
import type { Friend } from "./friends.ts";
import type { TownGoal } from "./town-goal.ts";
import { stopWorld, type WorldEmote, type WorldPosition } from './world.ts';
import { audienceOf, unwatch, type WatcherCount } from './watch.ts';

// Server -> client events. Clients act over HTTP; the socket only carries news.
export type ServerEvent =
  | { type: 'presence:updated'; players: string[] }
  | { type: 'world:updated'; player: WorldPosition }
  // A player showed a quick emote where they stand, for everyone in that room.
  | { type: 'world:emoted'; emote: WorldEmote }
  | { type: "pet:updated"; pet: Pet }
  // Sent after both fighters' pet:updated, so clients can tell the story.
  | { type: "fight:finished"; fight: Fight }
  // Reaches both fighters, and every player watching that fight from the stands.
  | { type: "battle:updated"; session: BattleSession }
  // How many players watch a live fight, as saved. Everyone hears it: the
  // Arena's live list shows the crowd, and the fighters see their audience.
  | { type: "battle:watchers"; watchers: WatcherCount }
  // Sent last, after the change it describes, for the Arena's "Happening now".
  | { type: "feed:added"; entry: FeedEntry }
  // A team forming in the Team up window changed or set off. Players it no
  // longer lists (who left, declined, or were disbanded) recognise its id.
  | { type: "team:updated"; team: Team }
  // A visitor touched someone else's pet. It reacts in every window showing
  // it, and its owner's visitors list gains the touch.
  | { type: "pet:touched"; touch: Touch }
  // A visitor left a guestbook note. Only the pet's owner and that visitor hear it.
  | { type: "pet:noted"; note: Note }
  // An owner cleared their guestbook. Only the owner's own windows hear it.
  | { type: "notes:cleared"; pet: string }
  // A player starred or unstarred a friend: their whole list, as saved. Only
  // that player's own windows hear it; the starred player isn't told.
  | { type: "friends:updated"; player: string; friends: Friend[] }
  // The town's weekly meal total changed (someone fed a pet) or a new week
  // began. Everyone hears it: the town map's progress bar is shared.
  | { type: "town:goal"; goal: TownGoal }
  // A visitor asked to join the team its host is getting together. Only the
  // host (leader) and the asker hear it; team:updated follows for the window.
  | { type: "team:requested"; request: { team: number; leader: string; player: string } };

let wss: WebSocketServer | undefined;
const credentials = new WeakMap<WebSocket, string | undefined>();
let online = new Set<string>();
// Players whose saved walking must stop because they arrived or their last
// window closed. Each stays listed until the write succeeds, since another
// process may briefly hold the database; every presence check retries.
const stopping = new Set<string>();

function stopPending(): void {
  for (const id of stopping) {
    try {
      const player = stopWorld(id);
      stopping.delete(id);
      // Arrivals share where they stand; presence already hides departures.
      if (online.has(id)) broadcast({ type: 'world:updated', player });
    } catch (error) {
      console.error('could not stop saved walking; retrying at the next presence check', error);
      return;
    }
  }
}
// A player's own newer position replaces a stop still waiting to be saved.
export const cancelStop = (id: string): void => { stopping.delete(id); };

// Socket callbacks run outside any request, so a failed database call there
// would stop the whole server. Log it instead and let presence catch up.
function guarded(action: () => unknown): void {
  try { action(); } catch (error) { console.error('realtime presence update failed', error); }
}

// Presence is a live connection, never a saved login cookie or pet activity.
export function refreshPresence(): string[] {
  const next = new Set<string>();
  for (const client of wss?.clients ?? []) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const id = playerFor(credentials.get(client));
    if (id) next.add(id);
  }
  const changed = next.size !== online.size || [...next].some(id => !online.has(id));
  for (const id of online) if (!next.has(id)) { stopping.add(id); leavingStands.add(id); }
  // The away time ends for arrivals and begins for departures. Both are
  // brought up to date before `online` changes: an arrival still counts as
  // away, so it loses what it missed; a departure still counts as here, so the
  // time it spent online costs nothing and its away time starts now.
  for (const id of next) if (!online.has(id)) freshening.set(id, true);
  for (const id of online) if (!next.has(id)) freshening.set(id, false);
  freshenPending();
  online = next;
  if (changed) broadcast({ type: 'presence:updated', players: [...online] });
  stopPending();
  leaveStandsPending();
  return [...online];
}

// Players whose last window closed, still to be taken out of the stands. Like
// `stopping`, each stays listed until the write succeeds.
const leavingStands = new Set<string>();
function leaveStandsPending(): void {
  for (const id of leavingStands) {
    if (online.has(id)) { leavingStands.delete(id); continue; } // came straight back
    try {
      const counts = unwatch(id);
      leavingStands.delete(id);
      for (const watchers of counts) broadcast({ type: 'battle:watchers', watchers });
    } catch (error) {
      console.error('could not leave the stands; retrying at the next presence check', error);
      return;
    }
  }
}
export const isOnline = (id: string): boolean => refreshPresence().includes(id);
// Whether `id` was online at the last presence check, without checking again:
// cheap enough to ask while bringing any pet up to date (src/needs.ts).
export const onlineNow = (id: string): boolean => online.has(id);

// Players whose pets' needs must be brought up to date because they just
// arrived (the away time ends) or just left (the away time starts). Like
// `stopping`, each stays listed until the write succeeds. Arrivals hear their
// pet's new needs; departures change nothing anyone sees yet.
const freshening = new Map<string, boolean>(); // id -> arrived
let freshen: ((id: string) => Pet | undefined) | undefined;
// src/server.ts hands this over, since this module can't import pets.ts's code.
export function onNeedsChange(update: (id: string) => Pet | undefined): void { freshen = update; }
// A retry after `online` has moved on counts the player as here, so a failed
// arrival loses nothing rather than too much: the game errs toward the pet.
function freshenPending(): void {
  if (!freshen) return;
  for (const [id, arrived] of freshening) {
    try {
      const pet = freshen(id);
      freshening.delete(id);
      if (arrived && pet) broadcast({ type: "pet:updated", pet });
    } catch (error) {
      console.error("could not bring a pet's needs up to date; retrying at the next presence check", error);
      return;
    }
  }
}

export function clientsInRoom(): number {
  let count = 0;
  for (const client of wss?.clients ?? []) if (client.readyState === WebSocket.OPEN) count++;
  return count;
}

export function attachRealtime(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });
  // A malformed frame makes ws emit "error"; unheard, that would crash the app.
  wss.on("error", (err) => console.error("websocket server error", err));
  wss.on("connection", (ws, req) => {
    credentials.set(ws, req.headers.cookie);
    const id = randomUUID();
    const connection = `c_${id}`;
    // The socket may be opened before sign-in. Give those connections a
    // stable guest identity; never infer a player from an untrusted URL.
    let user = `guest_${id}`;
    guarded(() => {
      const player = playerFor(req.headers.cookie);
      if (player) { user = player; stopping.add(player); }
    });
    logEvent("join", { user, room: ROOM, client_in_room: clientsInRoom(), connection });
    guarded(refreshPresence);
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
      guarded(refreshPresence);
    }, 10_000);
    heartbeat.unref();
    ws.once("close", (code) => {
      clearInterval(heartbeat);
      guarded(refreshPresence);
      logEvent("leave", { user, room: ROOM, client_in_room: clientsInRoom(), connection, code });
    });
    ws.on("error", () => ws.terminate());
  });
}

// Every client hears every pet change: other players' pets matter once
// recruiting and fights arrive, and each client ignores what it isn't showing.
export function broadcast(event: ServerEvent): void {
  if (!wss) return;
  const message = JSON.stringify(event);
  // A live fight's turns reach its two fighters and its saved audience; a
  // guestbook note, only the owner and the visitor who wrote it; a friends
  // list, only the player who keeps it.
  const audience = event.type === "battle:updated"
    ? new Set([event.session.attacker, event.session.defender, ...audienceOf(event.session.id)])
    : event.type === "pet:noted" ? new Set([event.note.pet, event.note.visitor])
    : event.type === "notes:cleared" ? new Set([event.pet])
    : event.type === "friends:updated" ? new Set([event.player])
    : event.type === "team:requested" ? new Set([event.request.leader, event.request.player])
    : null;
  let recipients = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (audience && !audience.has(playerFor(credentials.get(client)) ?? "")) continue;
      client.send(message);
      recipients++;
    }
  }
  logEvent("broadcast", { user: "server", room: ROOM, client_in_room: clientsInRoom(), message: event.type, recipients });
}
