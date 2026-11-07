import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, connectPlayer, disconnectPlayer, freshId, post, sessionFor, signUp } from "./helpers.ts";

// Watching live Arena and revenge fights from the stands.
async function players(count: number) {
  const ids = Array.from({ length: count }, () => freshId());
  for (const id of ids) await signUp(id);
  return ids;
}
const live = async () => (await (await fetch(new URL("/api/arena/live", baseUrl))).json()) as any[];
const watch = (battle: string, as: string | null) => post(`/api/arena/live/${battle}/watch`, undefined, as);
const leave = (as: string | null) => post("/api/arena/live/leave", undefined, as);
async function open(owner?: string): Promise<WebSocket> {
  const socket = new WebSocket(new URL("/ws", baseUrl).href.replace(/^http/, "ws"), owner ? { headers: { cookie: sessionFor(owner)! } } : {});
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return socket;
}
// The first event `matches` accepts, within the 1 s budget.
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
const crowd = (battle: string, count: number, live = true) => (event: any) =>
  event.type === "battle:watchers" && event.watchers.battle === battle && event.watchers.count === count && event.watchers.live === live;

it("lists live player fights for the stands, newest first, but never practice against the bot", async () => {
  const [a, b, c] = await players(3);
  const fight = await (await post(`/api/pets/${a}/fight/${b}`)).json();
  const practice = await (await post(`/api/pets/${c}/fight/0`)).json();
  const listed = await live();
  const entry = listed.find(item => item.id === fight.session.id);
  expect(entry).toMatchObject({ id: fight.session.id, watchers: 0, attacker: { id: a }, defender: { id: b } });
  expect(listed.some(item => item.id === practice.session?.id)).toBe(false);
  await post(`/api/battles/${fight.session.id}/forfeit`, { revision: fight.session.battle.revision }, a);
  expect((await live()).some(item => item.id === fight.session.id)).toBe(false);
});

it("only a signed-in player who isn't fighting may watch, and only a live fight", async () => {
  const [a, b, fan] = await players(3);
  const { session } = await (await post(`/api/pets/${a}/fight/${b}`)).json();
  expect((await watch(session.id, null)).status).toBe(401);
  expect((await watch(session.id, a)).status).toBe(409);
  expect((await watch("no-such-fight", fan)).status).toBe(404);
  const seated = await watch(session.id, fan);
  expect(seated.status).toBe(200);
  const body = await seated.json();
  // The seat comes with the fight as saved, so a late arrival starts where it is.
  expect(body).toMatchObject({ watching: { id: session.id, attacker: a, defender: b, watchers: 1 }, session: { id: session.id, battle: session.battle } });
  // A retry keeps the one seat.
  expect((await (await watch(session.id, fan)).json()).watching.watchers).toBe(1);
  await post(`/api/battles/${session.id}/forfeit`, { revision: session.battle.revision }, b);
  expect((await watch(session.id, fan)).status).toBe(404);
});

it("battle:updated reaches the stands within 1s, while players who aren't watching hear nothing", async () => {
  const [a, b, fan, other] = await players(4);
  const { session } = await (await post(`/api/pets/${a}/fight/${b}`)).json();
  await watch(session.id, fan);
  const [fanSocket, otherSocket] = [await open(fan), await open(other)];
  const overheard: any[] = [];
  otherSocket.on("message", data => { const event = JSON.parse(String(data)); if (event.type === "battle:updated") overheard.push(event); });
  try {
    const battle = session.battle, actor = battle.fighters[battle.actor].id;
    const seen = next(fanSocket, event => event.type === "battle:updated" && event.session.id === session.id && event.session.battle.revision === battle.revision + 1);
    const played = await (await post(`/api/battles/${session.id}/turn`, { ability: "claw-strike", revision: battle.revision }, actor)).json();
    expect((await seen).session).toEqual(played.session);
    expect(overheard).toEqual([]);
    // Leaving the stands stops the turns arriving.
    await leave(fan);
    const later: any[] = [];
    fanSocket.on("message", data => { const event = JSON.parse(String(data)); if (event.type === "battle:updated") later.push(event); });
    await post(`/api/battles/${session.id}/forfeit`, { revision: played.session.battle.revision }, a);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(later).toEqual([]);
  } finally { fanSocket.close(); otherSocket.close(); }
});

it("battle:watchers reaches every window within 1s as a fight starts, gains and loses watchers, and ends", async () => {
  const [a, b, fan, other] = await players(4);
  const sockets = [await open(a), await open(), await open(other)];
  try {
    // A new fight joins everyone's live list.
    const starting = sockets.map(socket => next(socket, event => event.type === "battle:watchers" && event.watchers.live
      && event.watchers.attacker === a && event.watchers.defender === b && event.watchers.count === 0));
    const { session } = await (await post(`/api/pets/${a}/fight/${b}`)).json();
    for (const event of await Promise.all(starting)) expect(event.watchers.battle).toBe(session.id);
    // A seat, then leaving it.
    const seated = sockets.map(socket => next(socket, crowd(session.id, 1)));
    await watch(session.id, fan);
    await Promise.all(seated);
    const left = sockets.map(socket => next(socket, crowd(session.id, 0)));
    await leave(fan);
    await Promise.all(left);
    // Closing your last window leaves the stands too.
    await watch(session.id, fan);
    const gone = sockets.map(socket => next(socket, crowd(session.id, 0)));
    await disconnectPlayer(fan);
    await Promise.all(gone);
    await connectPlayer(fan);
    // The fight's end empties the stands and drops it from every live list.
    await watch(session.id, fan);
    const ended = sockets.map(socket => next(socket, crowd(session.id, 0, false)));
    await post(`/api/battles/${session.id}/forfeit`, { revision: session.battle.revision }, a);
    await Promise.all(ended);
    expect((await (await post("/api/arena/live/leave", undefined, fan)).json()).left).toEqual([]);
  } finally { sockets.forEach(socket => socket.close()); }
});

it("moving to another fight's stands frees the first seat", async () => {
  const [a, b, c, d, fan] = await players(5);
  const first = (await (await post(`/api/pets/${a}/fight/${b}`)).json()).session;
  const second = (await (await post(`/api/pets/${c}/fight/${d}`)).json()).session;
  await watch(first.id, fan);
  const socket = await open();
  try {
    const moved = Promise.all([next(socket, crowd(first.id, 0)), next(socket, crowd(second.id, 1))]);
    await watch(second.id, fan);
    await moved;
    const counts = Object.fromEntries((await live()).map(item => [item.id, item.watchers]));
    expect([counts[first.id], counts[second.id]]).toEqual([0, 1]);
  } finally {
    socket.close();
    await post(`/api/battles/${first.id}/forfeit`, { revision: first.battle.revision }, a);
    await post(`/api/battles/${second.id}/forfeit`, { revision: second.battle.revision }, c);
  }
});
