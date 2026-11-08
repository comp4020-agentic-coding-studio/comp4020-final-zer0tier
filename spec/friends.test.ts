import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, disconnectPlayer, freshId, getRules, post, sessionFor, signUp } from "./helpers.ts";

// Friends: players you star. Only you read or change your list, and only your
// own windows hear about it; who is online comes from presence:updated.
async function players(count: number) {
  const ids = Array.from({ length: count }, () => freshId());
  for (const id of ids) await signUp(id);
  return ids;
}
const star = (player: string, friend: string, as?: string | null) => post(`/api/pets/${player}/star/${friend}`, undefined, as);
const unstar = (player: string, friend: string, as?: string | null) => post(`/api/pets/${player}/unstar/${friend}`, undefined, as);
const read = (player: string, as?: string | null) => fetch(new URL(`/api/pets/${player}/friends`, baseUrl), {
  headers: as === null ? {} : { cookie: sessionFor(as ?? player)! },
});
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

it("stars and unstars players as your own pet, saved for your eyes alone", async () => {
  const [me, zed, amy] = await players(3);
  const res = await star(me, zed);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([expect.objectContaining({ id: zed, color: expect.any(String), appearance: expect.any(String), at: expect.any(String) })]);
  // The list is alphabetical, and every row carries what's needed to draw the pet.
  const both = await (await star(me, amy)).json();
  expect(both.map((f: any) => f.id)).toEqual([amy, zed].sort());
  expect((await (await read(me)).json()).map((f: any) => f.id)).toEqual([amy, zed].sort());
  // Starring is one-way: the starred player's list doesn't change.
  expect(await (await read(zed)).json()).toEqual([]);
  // Only the owner can read it.
  expect((await read(me, null)).status).toBe(401);
  expect((await read(me, zed)).status).toBe(403);
  const after = await (await unstar(me, zed)).json();
  expect(after.map((f: any) => f.id)).toEqual([amy]);
  expect((await (await read(me)).json()).map((f: any) => f.id)).toEqual([amy]);
});

it("treats starring twice, or unstarring someone not starred, as no change", async () => {
  const [me, pal] = await players(2);
  await star(me, pal);
  const again = await star(me, pal);
  expect(again.status).toBe(200);
  expect((await again.json()).map((f: any) => f.id)).toEqual([pal]);
  const stranger = await unstar(me, freshId());
  expect(stranger.status).toBe(200);
  expect((await stranger.json()).map((f: any) => f.id)).toEqual([pal]);
});

it("refuses starring as someone else, yourself, the bot, or a player who doesn't exist", async () => {
  const [me, pal] = await players(2);
  const { botId } = await getRules();
  expect((await star(me, pal, null)).status).toBe(401);
  expect((await star(me, pal, pal)).status).toBe(403);
  expect((await unstar(me, pal, pal)).status).toBe(403);
  expect((await star(me, me)).status).toBe(400);
  expect((await star(me, botId)).status).toBe(400);
  expect((await star(me, freshId())).status).toBe(404);
  expect((await star(me, "bad id!")).status).toBe(404);
  expect((await unstar(me, "bad id!")).status).toBe(404);
  expect((await read("bad id!")).status).toBe(404);
  expect((await read(freshId(), me)).status).toBe(404);
  expect(await (await read(me)).json()).toEqual([]);
});

it("keeps each list to the published maximum", async () => {
  const { friends } = await getRules();
  expect(friends.max).toBe(50);
  const [me] = await players(1);
  const others = await players(friends.max + 1);
  for (const other of others.slice(0, friends.max)) expect((await star(me, other)).status).toBe(200);
  const full = await star(me, others.at(-1)!);
  expect(full.status).toBe(409);
  expect((await full.json()).error).toMatch(/up to 50 friends/);
  // Starring one already on the list still answers; unstarring makes room.
  expect((await star(me, others[0])).status).toBe(200);
  await unstar(me, others[0]);
  expect((await star(me, others.at(-1)!)).status).toBe(200);
  expect(await (await read(me)).json()).toHaveLength(friends.max);
});

it("friends:updated reaches the player's own windows within 1s, and nobody else's", async () => {
  const [me, pal, stranger] = await players(3);
  const sockets = [await open(me), await open(me), await open(pal), await open(stranger), await open()];
  const overheard: any[] = [];
  for (const socket of sockets.slice(2)) socket.on("message", data => { const event = JSON.parse(String(data)); if (event.type === "friends:updated") overheard.push(event); });
  try {
    const starring = sockets.slice(0, 2).map(socket => next(socket, event => event.type === "friends:updated" && event.player === me));
    const saved = await (await star(me, pal)).json();
    for (const event of await Promise.all(starring)) expect(event.friends).toEqual(saved);
    const unstarring = sockets.slice(0, 2).map(socket => next(socket, event => event.type === "friends:updated" && event.player === me));
    await unstar(me, pal);
    for (const event of await Promise.all(unstarring)) expect(event.friends).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(overheard).toEqual([]);
  } finally { sockets.forEach(socket => socket.close()); }
});

it("presence:updated tells a player within 1s when a starred friend comes online and goes offline", async () => {
  const [me, pal] = await players(2);
  await star(me, pal);
  await disconnectPlayer(pal);
  const socket = await open(me);
  try {
    // A friend's status is presence, not a saved field: the list carries none.
    expect(Object.keys((await (await read(me)).json())[0]).sort()).toEqual(["appearance", "at", "color", "id"]);
    const arriving = next(socket, event => event.type === "presence:updated" && event.players.includes(pal));
    const palSocket = await open(pal);
    await arriving;
    const leaving = next(socket, event => event.type === "presence:updated" && !event.players.includes(pal));
    palSocket.close();
    await leaving;
  } finally { socket.close(); }
});
