import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { playerFor } from "./auth.ts";
import { logEvent, ROOM } from "./logging.ts";
import type { FeedEntry } from "./feed.ts";
import type { BattleSession, Fight, Pet } from "./pets.ts";
import type { Team } from "./teams.ts";
import type { Touch } from "./touches.ts";
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
  | { type: "pet:touched"; touch: Touch };

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
  // A live fight's turns reach its two fighters and its saved audience.
  const audience = event.type === "battle:updated"
    ? new Set([event.session.attacker, event.session.defender, ...audienceOf(event.session.id)]) : null;
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
