import { expect, it } from "vitest";
import { baseUrl, freshId, getPet, getRules, post, signIn, signUp, workHour } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  expect((await signUp(id)).status).toBe(201);
  return id;
}

const steal = (id: string, target: string, as?: string | null) => post(`/api/pets/${id}/steal/${target}`, undefined, as);

it("steals $10–$30, transfers exactly that money, persists protection and records the visit in the feed", async () => {
  expect((await getRules()).steal).toEqual({ min: 10, max: 30, resetTimezone: "UTC" });
  const thief = await newPet();
  const victim = await newPet();
  const before = await workHour(victim);
  expect(before.stealAvailableAt).toBeNull();
  const res = await steal(thief, victim);
  expect(res.status).toBe(200);
  const result = await res.json();
  expect(Number.isInteger(result.amount)).toBe(true);
  expect(result.amount).toBeGreaterThanOrEqual(10);
  expect(result.amount).toBeLessThanOrEqual(Math.min(30, before.money));
  expect(result.thief.money).toBe(result.amount);
  expect(result.victim.money).toBe(before.money - result.amount);
  expect(new Date(result.victim.stealAvailableAt).toISOString()).toMatch(/T00:00:00.000Z$/);
  expect(result.victim.stealAvailableAt).toBeGreaterThan(Date.now());
  expect(await getPet(thief)).toEqual(result.thief);
  expect(await getPet(victim)).toEqual(result.victim);
  expect(await (await signIn(victim)).json()).toEqual(result.victim);
  const feed = await (await fetch(new URL("/api/feed?limit=50", baseUrl))).json();
  expect(feed.find((entry: any) => entry.kind === "stole" && entry.pet === thief)).toMatchObject({
    other: victim, amount: result.amount,
  });
});

it("permits only one of simultaneous visitors, rejects repeat thefts, and lets the winner visit another pet", async () => {
  const thieves = [await newPet(), await newPet(), await newPet()];
  const victim = await newPet();
  const before = await workHour(victim);
  const results = await Promise.all(thieves.map(async (thief) => {
    const res = await steal(thief, victim);
    return { thief, status: res.status, body: await res.json() };
  }));
  expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
  const winner = results.find((r) => r.status === 200)!;
  expect((await getPet(victim)).money).toBe(before.money - winner.body.amount);
  for (const result of results) {
    expect((await getPet(result.thief)).money).toBe(result.status === 200 ? winner.body.amount : 0);
  }
  expect((await steal(winner.thief, victim)).status).toBe(429);
  const next = await newPet();
  await workHour(next);
  expect((await steal(winner.thief, next)).status).toBe(200);
});

it("a poor pet can't be robbed and a failed attempt doesn't use its daily protection", async () => {
  const thief = await newPet();
  const victim = await newPet();
  const before = await getPet(victim);
  expect((await steal(thief, victim)).status).toBe(409);
  expect(await getPet(victim)).toEqual(before);
  await workHour(victim);
  expect((await post(`/api/pets/${victim}/buy/food`)).status).toBe(200); // $10 left
  const res = await steal(thief, victim);
  expect(res.status).toBe(200);
  const result = await res.json();
  expect(result.amount).toBe(10);
  expect(result.victim.money).toBe(0);
});

it("requires the acting pet's owner and refuses self, bot, invalid and missing targets without changing money", async () => {
  const thief = await newPet();
  const victim = await newPet();
  const before = await workHour(victim);
  expect((await steal(thief, victim, null)).status).toBe(401);
  expect((await steal(thief, victim, victim)).status).toBe(403);
  expect((await steal(thief, thief)).status).toBe(400);
  expect((await steal(thief, "0")).status).toBe(400);
  expect((await steal(thief, freshId())).status).toBe(404);
  expect((await steal(thief, "invalid!id")).status).toBe(404);
  expect(await getPet(victim)).toEqual(before);
  expect((await getPet(thief)).money).toBe(0);
});
