import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, freshId, post, sessionFor, signUp } from "./helpers.ts";

// Asking to join from a host's home reaches the host at once, wherever they
// are, and the asker; nobody else hears it.
async function open(owner?: string): Promise<WebSocket> {
  const socket = new WebSocket(new URL("/ws", baseUrl).href.replace(/^http/, "ws"), owner ? { headers: { cookie: sessionFor(owner)! } } : {});
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return socket;
}
function next(socket: WebSocket, matches: (event: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no matching event within 1s")), 1000);
    const listener = (data: Buffer) => {
      const event = JSON.parse(String(data));
      if (!matches(event)) return;
      clearTimeout(timer); socket.off("message", listener); resolve(event);
    };
    socket.on("message", listener);
  });
}

it("team:requested reaches the host's and the asker's windows within 1s, and nobody else's", async () => {
  const host = freshId(), invited = freshId(), visitor = freshId(), stranger = freshId();
  for (const id of [host, invited, visitor, stranger]) await signUp(id);
  const { team } = await (await post("/api/team", { action: "invite", player: invited }, host)).json();
  const sockets = [await open(host), await open(visitor), await open(stranger), await open()];
  const overheard: any[] = [];
  for (const socket of sockets.slice(2)) {
    socket.on("message", data => { const event = JSON.parse(String(data)); if (event.type === "team:requested") overheard.push(event); });
  }
  try {
    const arriving = sockets.slice(0, 2).map(socket => next(socket, event => event.type === "team:requested" && event.request.player === visitor));
    // The host's Team up window refreshes from the team as saved, too.
    const updated = next(sockets[0], event => event.type === "team:updated" && event.team.members.some((m: any) => m.id === visitor && m.requested));
    expect((await post("/api/team", { action: "ask", player: host }, visitor)).status).toBe(200);
    for (const event of await Promise.all(arriving)) expect(event.request).toEqual({ team: team.id, leader: host, player: visitor });
    await updated;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(overheard).toEqual([]);
  } finally { sockets.forEach(socket => socket.close()); }
});
