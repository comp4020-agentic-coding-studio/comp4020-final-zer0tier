import { expect, it } from "vitest";
import { baseUrl, freshId, getPet, must, post, signUp, workHour } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  expect((await signUp(id)).status).toBe(201);
  return id;
}

const help = (id: string, pet: string, item: unknown, as?: string | null) =>
  post(`/api/pets/${id}/help/${pet}`, { item }, as);

// Collects the free Food and Soap, so the helper has one of each to give.
const stocked = async (id: string) => must(`/api/pets/${id}/collect-supplies`);

it("feeding and cleaning another pet spends the helper's own food or soap and restores that pet, together", async () => {
  const helper = await newPet();
  const owner = await newPet();
  await stocked(helper);
  // A shift tires the owner's pet: −10 stamina and −20 hygiene an hour.
  const tired = await workHour(owner);
  expect(tired).toMatchObject({ stamina: 90, hygiene: 80, food: 0, soap: 0 });

  const fed = await help(helper, owner, "food");
  expect(fed.status).toBe(200);
  const result = await fed.json();
  // Never past 100: only the 10 stamina it was missing.
  expect(result).toMatchObject({ item: "food", amount: 10, helper: { food: 0, soap: 1 }, pet: { stamina: 100, hygiene: 80, food: 0 } });
  expect(await getPet(helper)).toEqual(result.helper);
  expect(await getPet(owner)).toEqual(result.pet);

  const cleaned = await (await help(helper, owner, "soap")).json();
  expect(cleaned).toMatchObject({ item: "soap", amount: 20, helper: { food: 0, soap: 0 }, pet: { hygiene: 100 } });
  // Helping is a gift: nobody's money, stats or record moves.
  for (const field of ["money", "strength", "intelligence", "charisma", "wins", "losses"]) {
    expect(cleaned.pet[field]).toBe(tired[field]);
  }

  const feed = await (await fetch(new URL("/api/feed?limit=50", baseUrl))).json();
  const helped = feed.filter((entry: any) => entry.kind === "helped" && entry.pet === helper);
  expect(helped.map((entry: any) => [entry.other, entry.item])).toEqual([[owner, "soap"], [owner, "food"]]);
});

it("refuses a full need or an empty cupboard without changing either pet", async () => {
  const helper = await newPet();
  const owner = await newPet();
  const before = [await getPet(helper), await getPet(owner)];
  // Nothing to give yet.
  const empty = await help(helper, owner, "food");
  expect(empty.status).toBe(409);
  expect((await empty.json()).error).toMatch(/no food/);
  await stocked(helper);
  // The new pet is already full of stamina and hygiene.
  const full = await help(helper, owner, "soap");
  expect(full.status).toBe(409);
  expect((await full.json()).error).toMatch(/hygiene is already full/);
  expect(await getPet(owner)).toEqual(before[1]);
  expect(await getPet(helper)).toMatchObject({ food: 1, soap: 1, stamina: before[0].stamina, hygiene: before[0].hygiene });
});

it("only the helper's owner can give, and refuses self, the bot, other items and missing pets", async () => {
  const helper = await newPet();
  const owner = await newPet();
  await stocked(helper);
  await workHour(owner);
  expect((await help(helper, owner, "food", null)).status).toBe(401);
  // The owner can't spend the helper's food by helping as them.
  expect((await help(helper, owner, "food", owner)).status).toBe(403);
  expect((await help(helper, helper, "food")).status).toBe(400);
  expect((await help(helper, "0", "food")).status).toBe(400);
  for (const item of ["hourglass", "", undefined, 1]) expect((await help(helper, owner, item)).status).toBe(400);
  expect((await help(helper, freshId(), "food")).status).toBe(404);
  expect((await help(helper, "invalid!id", "food")).status).toBe(404);
  expect(await getPet(helper)).toMatchObject({ food: 1, soap: 1 });
});

it("gives exactly once when the last food is offered to two pets at the same moment", async () => {
  const helper = await newPet();
  const owners = [await newPet(), await newPet()];
  await stocked(helper);
  for (const owner of owners) await workHour(owner);
  const results = await Promise.all(owners.map((owner) => help(helper, owner, "food")));
  expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  expect((await getPet(helper)).food).toBe(0);
  const stamina = await Promise.all(owners.map(async (owner) => (await getPet(owner)).stamina));
  expect(stamina.sort((a, b) => a - b)).toEqual([90, 100]);
});
