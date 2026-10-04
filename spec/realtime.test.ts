import { connect } from "node:net";
import { expect, it } from "vitest";
import { baseUrl, buyHourglass, freshId, post, readyToStudy, studyTimes, workHour, signUp } from "./helpers.ts";

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

it("pet:updated — starting Study Math reaches every open window within 1s", async () => {
  const id = freshId();
  await signUp(id);
  const windows = [await open(), await open()];
  try {
    const updates = windows.map((ws) => nextUpdate(ws, id));
    expect((await post(`/api/pets/${id}/study/math`)).status).toBe(200);
    for (const event of await Promise.all(updates)) {
      expect(event.pet).toMatchObject({ id, activity: "studying", task: "Math" });
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
