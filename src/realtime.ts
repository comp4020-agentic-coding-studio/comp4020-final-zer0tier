import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Fight, Pet } from "./pets.ts";

// Server -> client events. Clients act over HTTP; the socket only carries news.
export type ServerEvent =
  | { type: "pet:updated"; pet: Pet }
  // Sent after both fighters' pet:updated, so clients can tell the story.
  | { type: "fight:finished"; fight: Fight };

let wss: WebSocketServer | undefined;

export function attachRealtime(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });
  // A malformed frame makes ws emit "error"; unheard, that would crash the app.
  wss.on("error", (err) => console.error("websocket server error", err));
  wss.on("connection", (ws) => ws.on("error", () => ws.terminate()));
}

// Every client hears every pet change: other players' pets matter once
// recruiting and fights arrive, and each client ignores what it isn't showing.
export function broadcast(event: ServerEvent): void {
  const message = JSON.stringify(event);
  for (const client of wss?.clients ?? []) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
