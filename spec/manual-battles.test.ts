import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, finishBattle, freshId, getPet, post, sessionFor, signIn, signUp } from "./helpers.ts";

async function pair() {
  const attacker = freshId(), defender = freshId();
  await signUp(attacker); await signUp(defender);
  return { attacker, defender };
}
const read = (path: string, owner?: string) => fetch(new URL(path, baseUrl), {
  headers: owner ? { cookie: sessionFor(owner)! } : {},
});

it("keeps human attacks pending until the current owner chooses a skill; validates turns and retries", async () => {
  const { attacker, defender } = await pair(), stranger = freshId();
  await signUp(stranger);
  const response = await post(`/api/pets/${attacker}/fight/${defender}`);
  expect(response.status).toBe(200);
  const started = await response.json(), { session } = started;
  expect(session.battle).toMatchObject({ status: "active", turns: [], winner: "" });
  expect(await (await read(`/api/pets/${attacker}/fights`)).json()).toEqual([]);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect((await (await read(`/api/battles/${session.id}`, attacker)).json()).session).toEqual(session);
  const actor = session.battle.fighters[session.battle.actor].id;
  const other = actor === attacker ? defender : attacker;
  const path = `/api/battles/${session.id}/turn`, action = { ability: "claw-strike", revision: session.battle.revision };
  expect((await post(path, action, null)).status).toBe(401);
  expect((await post(path, action, stranger)).status).toBe(404);
  expect((await read(`/api/battles/${session.id}`, stranger)).status).toBe(404);
  expect((await post(path, action, other)).status).toBe(403);
  expect((await post(path, { ...action, ability: "firebolt" }, actor)).status).toBe(400);
  expect((await post(`/api/pets/${actor}/equip-skills`, { abilities: ["claw-strike"] })).status).toBe(409);
  expect((await post(`/api/pets/${actor}/study/math`)).status).toBe(409);
  expect((await post(`/api/pets/${stranger}/fight/${actor}`)).status).toBe(409);
  const played = await (await post(path, action, actor)).json();
  expect(played.session.battle.turns).toHaveLength(1);
  expect((await (await post(path, action, actor)).json()).session).toEqual(played.session);
  expect((await getPet(attacker)).stamina).toBe(90);
  await signIn(actor);
  expect(await (await read("/api/battles", actor)).json()).toEqual([played.session]);
  const finished = await finishBattle(played);
  expect(finished.session.battle.status).toBe("finished");
  expect(finished.fight).toEqual(finished.session.result.fight);
  expect(await (await read("/api/battles", actor)).json()).toEqual([]);
  const saved = await (await read(`/api/battles/${session.id}`, other)).json();
  expect(saved.session).toEqual(finished.session);
  const finalPet = await getPet(attacker);
  expect((await (await post(path, action, actor)).json()).session).toEqual(finished.session);
  expect(await getPet(attacker)).toEqual(finalPet);
  expect(await (await read(`/api/pets/${attacker}/fights`)).json()).toEqual([finished.fight]);
});

it("lets either participant forfeit a waiting battle exactly once", async () => {
  const { attacker, defender } = await pair();
  const { session } = await (await post(`/api/pets/${attacker}/fight/${defender}`)).json();
  const path = `/api/battles/${session.id}/forfeit`, action = { revision: session.battle.revision };
  const ended = await (await post(path, action, defender)).json();
  expect(ended.session.battle).toMatchObject({ status: "finished", winner: attacker, turns: [] });
  expect((await getPet(attacker)).wins).toBe(1);
  expect((await (await post(path, action, defender)).json()).session).toEqual(ended.session);
  expect((await getPet(attacker)).wins).toBe(1);
});

it("equips only owned skills in the owner's loadout and keeps Claw Strike available", async () => {
  const { attacker, defender } = await pair();
  const path = `/api/pets/${attacker}/equip-skills`;
  expect((await getPet(attacker)).equippedAbilities).toEqual(["claw-strike"]);
  expect((await post(path, { abilities: ["claw-strike"] }, null)).status).toBe(401);
  expect((await post(path, { abilities: ["claw-strike"] }, defender)).status).toBe(403);
  for (const abilities of [[], ["firebolt"], ["claw-strike", "firebolt"], ["claw-strike", "bump"], ["claw-strike", "claw-strike"]]) {
    expect((await post(path, { abilities })).status).toBe(409);
  }
  const saved = await post(path, { abilities: ["claw-strike"] });
  expect(saved.status).toBe(200);
  expect((await saved.json()).equippedAbilities).toEqual(["claw-strike"]);
});

it("battle:updated reaches both authenticated participants within 1s without exposing live battles to guests", async () => {
  const { attacker, defender } = await pair();
  const sockets = await Promise.all([attacker, defender, undefined].map(owner => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(new URL("/ws", baseUrl).href.replace(/^http/, "ws"), {
      headers: owner ? { cookie: sessionFor(owner)! } : {},
    });
    socket.once("open", () => resolve(socket)); socket.once("error", reject);
  })));
  const news: any[] = [];
  sockets[2].on("message", data => { const event = JSON.parse(String(data)); if (event.type === "battle:updated") news.push(event); });
  const wait = (socket: WebSocket, revision?: number) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No battle:updated within 1s")), 1000);
    const listener = (data: Buffer) => {
      const event = JSON.parse(String(data));
      if (event.type === "battle:updated" && event.session.attacker === attacker
        && (revision === undefined || event.session.battle.revision === revision)) {
        clearTimeout(timer); socket.off("message", listener); resolve(event.session);
      }
    };
    socket.on("message", listener);
  });
  try {
    const initial = sockets.slice(0, 2).map(socket => wait(socket));
    const started = await (await post(`/api/pets/${attacker}/fight/${defender}`)).json();
    for (const session of await Promise.all(initial)) expect(session).toEqual(started.session);
    const { session } = started, battle = session.battle, actor = battle.fighters[battle.actor].id;
    const turns = sockets.slice(0, 2).map(socket => wait(socket, battle.revision + 1));
    const played = await (await post(`/api/battles/${session.id}/turn`, { ability: "claw-strike", revision: battle.revision }, actor)).json();
    for (const state of await Promise.all(turns)) expect(state).toEqual(played.session);
    expect(news).toEqual([]);
    await post(`/api/battles/${session.id}/forfeit`, { revision: played.session.battle.revision }, attacker);
  } finally { sockets.forEach(socket => socket.close()); }
});
