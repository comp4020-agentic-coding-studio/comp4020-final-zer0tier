import { connect } from "node:net";
import { expect, it } from "vitest";
import { baseUrl, buyHourglass, freshId, getPet, post, readyToStudy, studyTimes, workHour, signUp } from "./helpers.ts";

const wsUrl = (): string => new URL("/ws", baseUrl).href.replace(/^http/, "ws");

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });
}

// Resolves with the first event about `id` (that `matches`, if given); fails
// past the 1 s real-time budget.
function nextUpdate(ws: WebSocket, id: string, matches: (pet: any) => boolean = () => true): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no pet:updated within 1s")), 1000);
    ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "pet:updated" && event.pet.id === id && matches(event.pet)) {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
}

it("pet:updated — changing appearance/color and starting Study Math reach every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  const windows = [await open(), await open()];
  try {
    const appearance = { color: "#12abEF", appearance: "panda" };
    const changed = windows.map((ws) => nextUpdate(ws, id, (pet) => pet.appearance === "panda"));
    const res = await post(`/api/pets/${id}/appearance`, appearance);
    expect(res.status).toBe(200);
    const saved = await res.json();
    for (const event of await Promise.all(changed)) {
      expect(event.pet).toEqual(saved);
      expect(event.pet).toMatchObject({ id, ...appearance });
    }
    const updates = windows.map((ws) => nextUpdate(ws, id));
    expect((await post(`/api/pets/${id}/study/math`)).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, activity: "studying", task: "Math", ...appearance });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — moving up a school level reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  await studyTimes(id, "pe", 4);
  await readyToStudy(id);
  const windows = [await open(), await open()];
  try {
    // The level-up comes when the lesson ends, not when it starts.
    const updates = windows.map((ws) => nextUpdate(ws, id, (pet) => pet.school === "middle"));
    expect((await post(`/api/pets/${id}/study/pe`)).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, school: "middle", credits: 0, strength: 10 });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("survives a malformed WebSocket frame", async () => {
  const url = new URL(baseUrl);
  await new Promise<void>((resolve) => {
    const socket = connect(Number(url.port || 80), url.hostname, () => {
      socket.write(
        "GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
      // Clients must mask their frames; an unmasked one is a protocol error.
      socket.once("data", () => socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69])));
    });
    socket.on("close", () => resolve());
    socket.on("error", () => resolve());
  });
  expect((await fetch(baseUrl)).status).toBe(200);
});

it("pet:updated — a shift ending reaches every open window within 1s of the end", async () => {
  const id = freshId();
  await signUp(id);
  // Windows open first, so a slow connection can't miss a short shift's end.
  const windows = [await open(), await open()];
  try {
    const res = await post(`/api/pets/${id}/work/theatre`, { minutes: 240 });
    expect(res.status).toBe(200);
    const { busyUntil } = await res.json();
    const updates = windows.map((ws) => nextUpdate(ws, id, (pet) => pet.activity === "idle"));
    for (const event of await Promise.all(updates)) {
      expect(Date.now() - busyUntil).toBeLessThan(1000);
      expect(event.pet).toMatchObject({ id, activity: "idle", money: 100, busyUntil: null });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — starting a shift, shopping and feeding reach every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  await workHour(id);
  const windows = [await open(), await open()];
  try {
    for (const [path, expected] of [
      ["buy/food", { money: 10, food: 1 }],
      ["use/food", { food: 0, stamina: 100 }],
    ] as const) {
      const updates = windows.map((ws) => nextUpdate(ws, id));
      expect((await post(`/api/pets/${id}/${path}`)).status).toBe(200);
      for (const event of await Promise.all(updates)) expect(event.pet).toMatchObject({ id, ...expected });
    }
    const updates = windows.map((ws) => nextUpdate(ws, id));
    expect((await post(`/api/pets/${id}/work/office`, { minutes: 30 })).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, activity: "working", task: "Office", stamina: 95, hygiene: 70 });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — equipping (and unequipping) a coin reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  const windows = [await open(), await open()];
  try {
    const updates = windows.map((ws) => nextUpdate(ws, id, (pet) => pet.equippedCoin === null));
    expect((await post(`/api/pets/${id}/equip-coin/none`)).status).toBe(200);
    for (const event of await Promise.all(updates)) expect(event.pet).toMatchObject({ id, equippedCoin: null });
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — starting a new adventure after abandoning one (which spends stamina/hygiene) reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  const opened = await (await post("/api/adventure", {}, id)).json();
  expect((await post("/api/adventure", { action: "restart", revision: opened.revision }, id)).status).toBe(409); // still in progress
  const abandoned = await (await post("/api/adventure", { action: "abandon", revision: opened.revision }, id)).json();
  expect(abandoned).toMatchObject({ abandoned: true });
  expect(await getPet(id)).toMatchObject({ stamina: 100, hygiene: 100 }); // abandoning is free
  const { revision } = abandoned;
  const windows = [await open(), await open()];
  try {
    const updates = windows.map((ws) => nextUpdate(ws, id, (pet) => pet.stamina === 60));
    const res = await post("/api/adventure", { action: "restart", revision }, id);
    expect(res.status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, stamina: 60, hygiene: 80 });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — collecting the free daily supplies reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  const windows = [await open(), await open()];
  try {
    const updates = windows.map((ws) => nextUpdate(ws, id, (pet) => pet.food === 1));
    expect((await post(`/api/pets/${id}/collect-supplies`)).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, food: 1, soap: 1, suppliesAvailableAt: expect.any(Number) });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — a job upgrade reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  await studyTimes(id, "drama", 10);
  const windows = [await open(), await open()];
  try {
    const updates = windows.map((ws) => nextUpdate(ws, id));
    expect((await post(`/api/pets/${id}/upgrade/theatre`)).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, charisma: 20, jobs: { theatre: 1 } });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

// Resolves with the first fight:finished event; fails past the 1 s budget.
function nextFight(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no fight:finished within 1s")), 1000);
    ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "fight:finished") {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
}

it("fight:finished — a fight reaches the attacker's and the defender's windows within 1s", async () => {
  const attacker = freshId();
  const defender = freshId();
  await signUp(attacker);
  await signUp(defender);
  const windows = [await open(), await open()]; // one each
  try {
    const fights = windows.map(nextFight);
    const attackerUpdate = nextUpdate(windows[0], attacker);
    const defenderUpdate = nextUpdate(windows[1], defender);
    const res = await post(`/api/pets/${attacker}/fight/${defender}`);
    expect(res.status).toBe(200);
    const { fight } = await res.json();
    for (const event of await Promise.all(fights)) expect(event.fight).toEqual(fight);
    const loser = fight.winner === attacker ? defender : attacker;
    for (const event of [await attackerUpdate, await defenderUpdate]) {
      expect(event.pet[event.pet.id === loser ? "losses" : "wins"]).toBe(1);
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — a new player's pet reaches every open window within 1s, so it joins their arenas", async () => {
  const id = freshId();
  const windows = [await open(), await open()];
  try {
    const updates = windows.map((ws) => nextUpdate(ws, id));
    expect((await signUp(id)).status).toBe(201);
    for (const event of await Promise.all(updates)) expect(event.pet).toMatchObject({ id, wins: 0, losses: 0 });
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated — skipping a shift with an hourglass reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  await buyHourglass(id);
  await readyToStudy(id, { stamina: 40, hygiene: 80 });
  // Windows open first, and the shift is 4 hours (400 ms on the test clock),
  // so it's still running when the hourglass is used.
  const windows = [await open(), await open()];
  try {
    const res = await post(`/api/pets/${id}/work/office`, { minutes: 240 });
    expect(res.status).toBe(200);
    const { money } = await res.json();
    const updates = windows.map((ws) => nextUpdate(ws, id));
    expect((await post(`/api/pets/${id}/use/hourglass`)).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, activity: "idle", hourglass: 0, money: money + 100 });
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("fight:finished — the money the winner took reaches both windows within 1s", async () => {
  const attacker = freshId();
  const defender = freshId();
  await signUp(attacker);
  await signUp(defender);
  const before = new Map([[attacker, await workHour(attacker)], [defender, await workHour(defender)]]);
  const windows = [await open(), await open()];
  try {
    const fights = windows.map(nextFight);
    const updates = [nextUpdate(windows[0], attacker), nextUpdate(windows[1], defender)];
    const res = await post(`/api/pets/${attacker}/fight/${defender}`);
    expect(res.status).toBe(200);
    const { fight } = await res.json();
    expect(fight.spoils).toBeGreaterThan(0);
    for (const event of await Promise.all(fights)) expect(event.fight.spoils).toBe(fight.spoils);
    for (const { pet } of await Promise.all(updates)) {
      const change = pet.id === fight.winner ? fight.spoils : -fight.spoils;
      expect(pet.money).toBe(before.get(pet.id).money + change);
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

// Resolves with the first feed:added event that `matches`; fails past the 1 s budget.
function nextFeed(ws: WebSocket, matches: (entry: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no feed:added within 1s")), 1000);
    ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "feed:added" && matches(event.entry)) {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
}

it("stealing updates both balances and daily protection in every window before announcing the theft", async () => {
  const thief = freshId();
  const victim = freshId();
  await signUp(thief);
  await signUp(victim);
  const before = await workHour(victim);
  const windows = [await open(), await open()];
  try {
    const orders: string[][] = windows.map(() => []);
    windows.forEach((ws, i) => ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "pet:updated") orders[i].push(event.pet.id);
      if (event.type === "feed:added" && event.entry.kind === "stole") orders[i].push("theft");
    }));
    const updates = windows.map((ws) => Promise.all([
      nextUpdate(ws, thief), nextUpdate(ws, victim), nextFeed(ws, (entry) => entry.kind === "stole" && entry.pet === thief),
    ]));
    const res = await post(`/api/pets/${thief}/steal/${victim}`);
    expect(res.status).toBe(200);
    const result = await res.json();
    for (const [a, b, news] of await Promise.all(updates)) {
      expect(a.pet).toEqual(result.thief);
      expect(b.pet).toEqual(result.victim);
      expect(a.pet.money + b.pet.money).toBe(before.money);
      expect(b.pet.stealAvailableAt).toBeGreaterThan(Date.now());
      expect(news.entry).toMatchObject({ pet: thief, other: victim, amount: result.amount });
    }
    for (const order of orders) {
      expect(order.indexOf(thief)).toBeLessThan(order.indexOf("theft"));
      expect(order.indexOf(victim)).toBeLessThan(order.indexOf("theft"));
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("feed:added — a player joining reaches every open window within 1s", async () => {
  const id = freshId();
  const windows = [await open(), await open()];
  try {
    const news = windows.map((ws) => nextFeed(ws, (entry) => entry.pet === id));
    expect((await signUp(id)).status).toBe(201);
    for (const { entry } of await Promise.all(news)) expect(entry).toMatchObject({ kind: "joined", pet: id });
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("feed:added — a fight reaches every open window within 1s, after fight:finished", async () => {
  const attacker = freshId();
  const defender = freshId();
  await signUp(attacker);
  await signUp(defender);
  const windows = [await open(), await open()];
  try {
    const order: string[] = [];
    windows[0].addEventListener("message", (msg) => order.push(JSON.parse(String(msg.data)).type));
    const news = windows.map((ws) => nextFeed(ws, (entry) => entry.kind === "fight" && entry.pet === attacker));
    const res = await post(`/api/pets/${attacker}/fight/${defender}`);
    const { fight } = await res.json();
    for (const { entry } of await Promise.all(news)) {
      expect(entry).toMatchObject({ pet: attacker, other: defender, winner: fight.winner, spoils: fight.spoils });
    }
    expect(order.indexOf("fight:finished")).toBeLessThan(order.indexOf("feed:added"));
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("feed:added — moving up a school, when the lesson ends on its own, reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  await studyTimes(id, "math", 4);
  await readyToStudy(id);
  const windows = [await open(), await open()];
  try {
    const news = windows.map((ws) => nextFeed(ws, (entry) => entry.pet === id && entry.kind === "school"));
    expect((await post(`/api/pets/${id}/study/math`)).status).toBe(200);
    for (const { entry } of await Promise.all(news)) expect(entry).toMatchObject({ school: "middle" });
  } finally {
    for (const ws of windows) ws.close();
  }
});

// Resolves with the first team:updated that `matches`; fails past 1 s.
function nextTeam(ws: WebSocket, matches: (team: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no team:updated within 1s")), 1000);
    ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "team:updated" && matches(event.team)) {
        clearTimeout(timer);
        resolve(event.team);
      }
    });
  });
}

it("team:updated — inviting, joining, and setting off together reach both players' windows within 1s", async () => {
  const leader = freshId(), mate = freshId();
  await signUp(leader); await signUp(mate);
  const act = async (as: string, body: unknown) => {
    const res = await post("/api/team", body, as);
    expect(res.status).toBe(200);
    return res.json();
  };
  const windows = [await open(), await open()];
  try {
    const invited = windows.map((ws) => nextTeam(ws, (team) => team.leader === leader && team.members.some((m: any) => m.id === mate)));
    const { team } = await act(leader, { action: "invite", player: mate });
    for (const event of await Promise.all(invited)) expect(event).toEqual(team);
    expect(team.members).toMatchObject([{ id: leader, joined: true }, { id: mate, joined: false }]);

    const joined = windows.map((ws) => nextTeam(ws, (t) => t.id === team.id && t.members.every((m: any) => m.joined)));
    expect((await act(mate, { action: "accept", team: team.id })).team).toMatchObject({ id: team.id, leader });
    for (const event of await Promise.all(joined)) expect(event.members).toMatchObject([{ id: leader, waiting: null }, { id: mate, waiting: null }]);

    // Setting off spends both pets' stamina/hygiene, broadcast before the team.
    const order: string[] = [];
    windows[0].addEventListener("message", (msg) => order.push(JSON.parse(String(msg.data)).type));
    const spent = windows.map((ws) => nextUpdate(ws, mate, (pet) => pet.stamina === 60));
    const set = windows.map((ws) => nextTeam(ws, (t) => t.id === team.id && t.status === "exploring"));
    const after = await act(leader, { action: "set-off" });
    expect(after).toMatchObject({ team: null, run: { team: team.id, state: "exploring" } });
    for (const event of await Promise.all(set)) expect(event.members.map((m: any) => m.id)).toEqual([leader, mate]);
    for (const event of await Promise.all(spent)) expect(event.pet).toMatchObject({ stamina: 60, hygiene: 80 });
    expect(order.indexOf("pet:updated")).toBeLessThan(order.indexOf("team:updated"));
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("team:updated — declining an invitation reaches the leader's window within 1s", async () => {
  const leader = freshId(), mate = freshId();
  await signUp(leader); await signUp(mate);
  const { team } = await (await post("/api/team", { action: "invite", player: mate }, leader)).json();
  const ws = await open();
  try {
    const declined = nextTeam(ws, (t) => t.id === team.id && t.members.length === 1);
    expect((await post("/api/team", { action: "leave", team: team.id }, mate)).status).toBe(200);
    expect((await declined).members).toMatchObject([{ id: leader }]);
  } finally {
    ws.close();
  }
});

function nextTouch(ws: WebSocket, matches: (touch: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no pet:touched within 1s")), 1000);
    ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "pet:touched" && matches(event.touch)) {
        clearTimeout(timer);
        resolve(event.touch);
      }
    });
  });
}

it("pet:touched — playing with someone else's pet reaches the visitor's and the owner's windows within 1s", async () => {
  const visitor = freshId(), owner = freshId();
  await signUp(visitor); await signUp(owner);
  const windows = [await open(), await open()];
  try {
    const touched = windows.map((ws) => nextTouch(ws, (t) => t.visitor === visitor && t.pet === owner));
    const res = await post(`/api/pets/${visitor}/touch/${owner}`, { kind: "paw" });
    expect(res.status).toBe(200);
    const saved = await res.json();
    for (const event of await Promise.all(touched)) expect(event).toEqual(saved);
    expect(saved).toMatchObject({ visitor, pet: owner, kind: "paw" });
  } finally {
    for (const ws of windows) ws.close();
  }
});

it("pet:updated and feed:added — feeding someone else's pet reaches the helper's and the owner's windows within 1s, both pets before the news", async () => {
  const helper = freshId(), owner = freshId();
  await signUp(helper); await signUp(owner);
  await post(`/api/pets/${helper}/collect-supplies`);
  await workHour(owner);
  const windows = [await open(), await open()];
  try {
    const orders: string[][] = windows.map(() => []);
    windows.forEach((ws, i) => ws.addEventListener("message", (msg) => {
      const event = JSON.parse(String(msg.data));
      if (event.type === "pet:updated" && [helper, owner].includes(event.pet.id)) orders[i].push(event.pet.id);
      if (event.type === "feed:added" && event.entry.kind === "helped" && event.entry.pet === helper) orders[i].push("news");
    }));
    const updates = windows.map((ws) => Promise.all([
      nextUpdate(ws, helper, (pet) => pet.food === 0),
      nextUpdate(ws, owner, (pet) => pet.stamina === 100),
      nextFeed(ws, (entry) => entry.kind === "helped" && entry.pet === helper),
    ]));
    const res = await post(`/api/pets/${helper}/help/${owner}`, { item: "food" });
    expect(res.status).toBe(200);
    const result = await res.json();
    for (const [mine, theirs, news] of await Promise.all(updates)) {
      expect(mine.pet).toEqual(result.helper);
      expect(theirs.pet).toEqual(result.pet);
      expect(news.entry).toMatchObject({ pet: helper, other: owner, item: "food" });
    }
    for (const order of orders) {
      expect(order.indexOf(helper)).toBeLessThan(order.indexOf("news"));
      expect(order.indexOf(owner)).toBeLessThan(order.indexOf("news"));
    }
  } finally {
    for (const ws of windows) ws.close();
  }
});
