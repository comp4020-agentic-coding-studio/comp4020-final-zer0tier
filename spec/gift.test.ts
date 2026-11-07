import { expect, it } from "vitest";
import { baseUrl, buyHourglass, freshId, getPet, must, post, signUp, workHour } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  expect((await signUp(id)).status).toBe(201);
  return id;
}

const gift = (id: string, pet: string, item: unknown, as?: string | null) =>
  post(`/api/pets/${id}/gift/${pet}`, { item }, as);

// Collects the free Food and Soap, so the giver has one of each to give.
const stocked = async (id: string) => must(`/api/pets/${id}/collect-supplies`);

it("giving moves one food, soap, or hourglass from the giver's cupboard to the other pet's, together", async () => {
  const giver = await newPet();
  const friend = await newPet();
  // Buying works shifts and uses supplies, so stock the cupboard afterwards.
  await buyHourglass(giver);
  await stocked(giver);
  const before = { giver: await getPet(giver), friend: await getPet(friend) };
  expect(before.giver).toMatchObject({ food: 1, soap: 1, hourglass: 1 });

  for (const item of ["food", "soap", "hourglass"]) {
    const res = await gift(giver, friend, item);
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.item).toBe(item);
    expect(result.giver[item]).toBe(before.giver[item] - 1);
    expect(result.pet[item]).toBe(before.friend[item] + 1);
    expect(await getPet(giver)).toEqual(result.giver);
    expect(await getPet(friend)).toEqual(result.pet);
  }
  // A gift is just the item: nobody's money, stats, needs or record moves.
  const after = { giver: await getPet(giver), friend: await getPet(friend) };
  for (const field of ["money", "strength", "intelligence", "charisma", "stamina", "hygiene", "wins", "losses"]) {
    expect(after.giver[field]).toBe(before.giver[field]);
    expect(after.friend[field]).toBe(before.friend[field]);
  }

  const feed = await (await fetch(new URL("/api/feed?limit=50", baseUrl))).json();
  const gifts = feed.filter((entry: any) => entry.kind === "gifted" && entry.pet === giver);
  expect(gifts.map((entry: any) => [entry.other, entry.item])).toEqual([[friend, "hourglass"], [friend, "soap"], [friend, "food"]]);
});

it("refuses an empty cupboard without changing either pet", async () => {
  const giver = await newPet();
  const friend = await newPet();
  const before = [await getPet(giver), await getPet(friend)];
  for (const item of ["food", "hourglass", "gold-coin"]) {
    const res = await gift(giver, friend, item);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/You have no .* to give/);
  }
  expect([await getPet(giver), await getPet(friend)]).toEqual(before);
});

it("only the giver's owner can give, and refuses self, the bot, unknown items and missing pets", async () => {
  const giver = await newPet();
  const friend = await newPet();
  await stocked(giver);
  expect((await gift(giver, friend, "food", null)).status).toBe(401);
  // The friend can't spend the giver's food by giving as them.
  expect((await gift(giver, friend, "food", friend)).status).toBe(403);
  expect((await gift(giver, giver, "food")).status).toBe(400);
  expect((await gift(giver, "0", "food")).status).toBe(400);
  for (const item of ["money", "claw-strike", "", undefined, 1]) expect((await gift(giver, friend, item)).status).toBe(400);
  expect((await gift(giver, freshId(), "food")).status).toBe(404);
  expect((await gift(giver, "invalid!id", "food")).status).toBe(404);
  expect(await getPet(giver)).toMatchObject({ food: 1, soap: 1 });
});

it("gives exactly once when the last food is offered to two pets at the same moment", async () => {
  const giver = await newPet();
  const friends = [await newPet(), await newPet()];
  await stocked(giver);
  const results = await Promise.all(friends.map((friend) => gift(giver, friend, "food")));
  expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  expect((await getPet(giver)).food).toBe(0);
  const food = await Promise.all(friends.map(async (friend) => (await getPet(friend)).food));
  expect(food.sort()).toEqual([0, 1]);
});

it("works while the other pet is busy, without cutting its shift short", async () => {
  const giver = await newPet();
  const friend = await newPet();
  await stocked(giver);
  // A four-hour shift (1.44 s on the test clock) is still running when the gift lands.
  const working = await must(`/api/pets/${friend}/work/construction`, { minutes: 240 });
  expect(working.activity).toBe("working");
  const res = await gift(giver, friend, "soap");
  expect(res.status).toBe(200);
  expect((await res.json()).pet).toMatchObject({ soap: 1, activity: "working", busyUntil: working.busyUntil });
});
