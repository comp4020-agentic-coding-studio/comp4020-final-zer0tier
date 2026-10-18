import { expect, it } from "vitest";
import { baseUrl, freshId, getPet, post, signUp } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  expect((await signUp(id)).status).toBe(201);
  return id;
}

const touch = (id: string, pet: string, kind: unknown, as?: string | null) =>
  post(`/api/pets/${id}/touch/${pet}`, { kind }, as);
const visitors = async (pet: string) => (await fetch(new URL(`/api/pets/${pet}/touches`, baseUrl))).json();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("playing with someone else's pet saves who touched it and how, and changes nothing else", async () => {
  const visitor = await newPet();
  const owner = await newPet();
  const before = [await getPet(visitor), await getPet(owner)];
  expect(await visitors(owner)).toEqual([]);
  const res = await touch(visitor, owner, "tickle");
  expect(res.status).toBe(200);
  const saved = await res.json();
  expect(saved).toMatchObject({ visitor, pet: owner, kind: "tickle" });
  expect(Number.isInteger(saved.id)).toBe(true);
  expect(Date.parse(saved.at)).toBeGreaterThan(Date.now() - 60_000);
  expect(await visitors(owner)).toEqual([saved]);
  expect(await visitors(visitor)).toEqual([]);
  // Just for fun: neither pet's money, stats, stamina or activity moves.
  expect([await getPet(visitor), await getPet(owner)]).toEqual(before);
});

it("only the visitor's own owner can touch as them, and refuses self, unknown kinds and missing pets", async () => {
  const visitor = await newPet();
  const owner = await newPet();
  expect((await touch(visitor, owner, "pat", null)).status).toBe(401);
  // The owner can't put words in the visitor's mouth by touching as them.
  expect((await touch(visitor, owner, "pat", owner)).status).toBe(403);
  expect((await touch(visitor, visitor, "pat")).status).toBe(400);
  for (const kind of ["poke", "", undefined, 1, ["pat"]]) expect((await touch(visitor, owner, kind)).status).toBe(400);
  expect((await touch(visitor, freshId(), "pat")).status).toBe(404);
  expect((await touch(visitor, "invalid!id", "pat")).status).toBe(404);
  expect((await fetch(new URL("/api/pets/invalid!id/touches", baseUrl))).status).toBe(404);
  expect((await fetch(new URL(`/api/pets/${freshId()}/touches`, baseUrl))).status).toBe(404);
  expect(await visitors(owner)).toEqual([]);
});

it("takes one touch a second from each visitor, keeps their latest, and lists the newest five visitors", async () => {
  const owner = await newPet();
  const first = await newPet();
  expect((await touch(first, owner, "pat")).status).toBe(200);
  const refused = await touch(first, owner, "paw");
  expect(refused.status).toBe(429);
  expect((await refused.json()).error).toMatch(/moment/);
  // A different visitor isn't held up by the first one.
  const others = [await newPet(), await newPet(), await newPet(), await newPet(), await newPet()];
  for (const other of others) expect((await touch(other, owner, "stroke")).status).toBe(200);
  await pause(1100);
  const again = await (await touch(first, owner, "paw")).json();
  const list = await visitors(owner);
  expect(list).toHaveLength(5);
  expect(list[0]).toEqual(again);
  // One row per visitor: the first visitor's earlier pat was replaced, and the
  // oldest of the others fell off the end.
  expect(list.map((t: any) => t.visitor)).toEqual([first, ...others.slice(1).reverse()]);
  expect(list.filter((t: any) => t.visitor === first)).toHaveLength(1);
});
