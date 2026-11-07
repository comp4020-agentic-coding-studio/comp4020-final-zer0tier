import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, freshId, getRules, post, sessionFor, signUp } from "./helpers.ts";

// The guestbook: visitors leave fixed phrases; only the owner reads or clears them.
async function players(count: number) {
  const ids = Array.from({ length: count }, () => freshId());
  for (const id of ids) await signUp(id);
  return ids;
}
const note = (visitor: string, pet: string, phrase: unknown, as?: string | null) =>
  post(`/api/pets/${visitor}/note/${pet}`, { phrase }, as);
const read = (pet: string, as?: string | null) => fetch(new URL(`/api/pets/${pet}/notes`, baseUrl), {
  headers: as === null ? {} : { cookie: sessionFor(as ?? pet)! },
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

it("leaves a fixed phrase as your own pet, saved for the owner's guestbook alone", async () => {
  const [visitor, owner] = await players(2);
  const { guestbook } = await getRules();
  expect(guestbook.phrases.map((p: any) => p.text)).toEqual([
    "Your pet is adorable!", "Thanks for the food!", "Thanks for the gift!", "Rematch?",
    "Good fight!", "Come visit me!", "Want to team up?", "Sorry about that…",
  ]);
  const res = await note(visitor, owner, "adorable");
  expect(res.status).toBe(200);
  const saved = await res.json();
  expect(saved).toMatchObject({ visitor, pet: owner, phrase: "adorable" });
  expect(await (await read(owner)).json()).toEqual([saved]);
  // Only the owner can read their guestbook.
  expect((await read(owner, null)).status).toBe(401);
  expect((await read(owner, visitor)).status).toBe(403);
});

it("refuses notes as someone else, to yourself or the bot, unknown phrases, and missing pets", async () => {
  const [visitor, owner] = await players(2);
  expect((await note(visitor, owner, "adorable", null)).status).toBe(401);
  expect((await note(visitor, owner, "adorable", owner)).status).toBe(403);
  expect((await note(visitor, visitor, "adorable")).status).toBe(400);
  expect((await note(visitor, "0", "adorable")).status).toBe(400);
  for (const phrase of ["hello", "", undefined, 1, "Your pet is adorable!"]) expect((await note(visitor, owner, phrase)).status).toBe(400);
  expect((await note(visitor, freshId(), "adorable")).status).toBe(404);
  expect((await note(visitor, "bad id!", "adorable")).status).toBe(404);
  expect(await (await read(owner)).json()).toEqual([]);
});

it("takes one note every 10 seconds from each visitor, and keeps each guestbook's newest 10", async () => {
  const visitors = await players(12);
  const [owner, ...rest] = visitors;
  expect((await note(rest[0], owner, "rematch")).status).toBe(200);
  const again = await note(rest[0], owner, "good-fight");
  expect(again.status).toBe(429);
  expect((await again.json()).error).toMatch(/Wait a few seconds/);
  // Another visitor isn't held up.
  for (const visitor of rest.slice(1)) expect((await note(visitor, owner, "visit-me")).status).toBe(200);
  const book = await (await read(owner)).json();
  expect(book).toHaveLength(10);
  // Newest first; the very first note has rolled off.
  expect(book[0].visitor).toBe(rest.at(-1));
  expect(book.some((n: any) => n.visitor === rest[0])).toBe(false);
});

it("only the owner can clear their guestbook", async () => {
  const [visitor, owner] = await players(2);
  await note(visitor, owner, "food");
  expect((await post(`/api/pets/${owner}/notes/clear`, undefined, null)).status).toBe(401);
  expect((await post(`/api/pets/${owner}/notes/clear`, undefined, visitor)).status).toBe(403);
  expect(await (await read(owner)).json()).toHaveLength(1);
  const cleared = await post(`/api/pets/${owner}/notes/clear`);
  expect(await cleared.json()).toEqual({ cleared: 1 });
  expect(await (await read(owner)).json()).toEqual([]);
});

it("pet:noted reaches the owner's and the visitor's windows within 1s, and nobody else's", async () => {
  const [visitor, owner, stranger] = await players(3);
  const sockets = [await open(owner), await open(visitor), await open(stranger), await open()];
  const overheard: any[] = [];
  for (const socket of sockets.slice(2)) socket.on("message", data => { const event = JSON.parse(String(data)); if (event.type === "pet:noted") overheard.push(event); });
  try {
    const arriving = sockets.slice(0, 2).map(socket => next(socket, event => event.type === "pet:noted" && event.note.pet === owner));
    const saved = await (await note(visitor, owner, "team-up")).json();
    for (const event of await Promise.all(arriving)) expect(event.note).toEqual(saved);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(overheard).toEqual([]);
  } finally { sockets.forEach(socket => socket.close()); }
});

it("notes:cleared reaches the owner's windows within 1s, and nobody else's", async () => {
  const [visitor, owner] = await players(2);
  await note(visitor, owner, "sorry");
  const sockets = [await open(owner), await open(owner), await open(visitor)];
  const overheard: any[] = [];
  sockets[2].on("message", data => { const event = JSON.parse(String(data)); if (event.type === "notes:cleared") overheard.push(event); });
  try {
    const clearing = sockets.slice(0, 2).map(socket => next(socket, event => event.type === "notes:cleared" && event.pet === owner));
    await post(`/api/pets/${owner}/notes/clear`);
    await Promise.all(clearing);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(overheard).toEqual([]);
  } finally { sockets.forEach(socket => socket.close()); }
});
