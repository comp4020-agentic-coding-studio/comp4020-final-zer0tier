import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, freshId, post, sessionFor, signIn, signUp, workHour } from "./helpers.ts";

async function setup() {
  const victim = freshId(), thief = freshId();
  await signUp(victim); await signUp(thief);
  await workHour(victim); await workHour(thief); await workHour(thief);
  const res = await post(`/api/pets/${thief}/steal/${victim}`);
  expect(res.status).toBe(200);
  return { victim, thief, amount: (await res.json()).amount };
}
const reports = (id?: string) => fetch(new URL("/api/thefts", baseUrl), {
  headers: id ? { cookie: sessionFor(id)! } : {},
});

it("shows the thief and amount at the next login and keeps reports private", async () => {
  const { victim, thief, amount } = await setup();
  await post("/api/signout", undefined, victim);
  expect((await reports(victim)).status).toBe(401);
  await signIn(victim);
  const res = await reports(victim);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const [theft] = await res.json();
  expect(theft).toMatchObject({ victim, thief, amount, result: null });
  expect(await (await reports(thief)).json()).toEqual([]);
  const path = `/api/pets/${victim}/revenge/${theft.id}`;
  expect((await post(path, undefined, null)).status).toBe(401);
  expect((await post(path, undefined, thief)).status).toBe(403);
  expect((await post(`/api/pets/${thief}/revenge/${theft.id}`)).status).toBe(404);
  expect((await post(`/api/pets/${victim}/revenge/1e2`)).status).toBe(404);
  expect((await post(`/api/pets/${thief}/steal/${victim}`)).status).toBe(429);
});

it("pet:updated and feed:added reach both windows within 1s; simultaneous revenge pays only once", async () => {
  const { victim, thief } = await setup();
  const [theft] = await (await reports(victim)).json();
  const windows = await Promise.all([0, 1].map(() => new Promise<WebSocket>((resolve) => {
    const ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
    ws.once("open", () => resolve(ws));
  })));
  try {
    const events = windows.map((ws) => new Promise<any[]>((resolve, reject) => {
      const messages: any[] = [];
      const timer = setTimeout(() => reject(new Error("No revenge updates within 1s")), 1000);
      ws.on("message", (data) => {
        const event = JSON.parse(String(data));
        if (event.type === "pet:updated" && [victim, thief].includes(event.pet.id)) messages.push(event);
        if (event.type === "feed:added" && event.entry.kind === "revenge" && event.entry.pet === victim) {
          messages.push(event); clearTimeout(timer); resolve(messages);
        }
      });
    }));
    const responses = await Promise.all([0, 1].map(() => post(`/api/pets/${victim}/revenge/${theft.id}`)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const outcome = await responses.find((r) => r.ok)!.json();
    for (const messages of await Promise.all(events)) {
      expect(messages).toHaveLength(3);
      expect(messages[0].pet).toEqual(outcome.victim);
      expect(messages[1].pet).toEqual(outcome.thief);
      expect(messages[2].entry).toMatchObject({ kind: "revenge", won: outcome.won, amount: outcome.reward });
    }
    expect(await (await reports(victim)).json()).toEqual([]);
  } finally { windows.forEach((ws) => ws.close()); }
});
