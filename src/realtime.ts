import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { playerFor } from "./auth.ts";
import { logEvent, ROOM } from "./logging.ts";
import type { FeedEntry } from "./feed.ts";
import type { BattleSession, Fight, Pet } from "./pets.ts";
import type { Team } from "./teams.ts";
import type { Touch } from "./touches.ts";

// Server -> client events. Clients act over HTTP; the socket only carries news.
export type ServerEvent =
  | { type: "pet:updated"; pet: Pet }
  // Sent after both fighters' pet:updated, so clients can tell the story.
  | { type: "fight:finished"; fight: Fight }
  | { type: "battle:updated"; session: BattleSession }
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
    const user = playerFor(req.headers.cookie) ?? `guest_${id}`;
    logEvent("join", { user, room: ROOM, client_in_room: clientsInRoom(), connection });
    ws.once("close", (code) => {
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
  let recipients = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (event.type === "battle:updated") {
        const player = playerFor(credentials.get(client));
        if (player !== event.session.attacker && player !== event.session.defender) continue;
      }
      client.send(message);
      recipients++;
    }
  }
  logEvent("broadcast", { user: "server", room: ROOM, client_in_room: clientsInRoom(), message: event.type, recipients });
}
