import { expect, it } from "vitest";
import { finish, freshId, getPet, post } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  await post("/api/login", { id });
  return id;
}

const act = async (id: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await post(`/api/pets/${id}/${path}`, body);
  return { status: res.status, body: await res.json() };
};

const HOUR = { minutes: 60 };

// Does `path` `times` times, letting each lesson or shift finish.
const repeat = async (id: string, path: string, times: number, body?: unknown): Promise<void> => {
  for (let i = 0; i < times; i++) {
    expect((await act(id, path, body)).status).toBe(200);
    await finish(id);
  }
};

it("studying costs 20 stamina and 10 hygiene up front", async () => {
  const id = await newPet();
  expect((await act(id, "study/math")).body).toMatchObject({ stamina: 80, hygiene: 90 });
});

it("an hour's work costs 10 stamina and 20 hygiene up front", async () => {
  const id = await newPet();
  const { status, body } = await act(id, "work/construction", HOUR);
  expect(status).toBe(200);
  expect(body).toMatchObject({ stamina: 90, hygiene: 80, credits: 0, intelligence: 5 });
});

it("refuses to study when too tired, keeping enough stamina to work, and changes nothing", async () => {
  const id = await newPet();
  await repeat(id, "study/math", 4);
  const before = await getPet(id);
  expect(before.stamina).toBe(20);
  const { status, body } = await act(id, "study/math");
  expect(status).toBe(409);
  expect(body.error).toMatch(/tired/i);
  expect(await getPet(id)).toEqual(before);
  expect((await act(id, "work/construction", HOUR)).status).toBe(200);
});

it("refuses to study, then to work, when too dirty", async () => {
  const id = await newPet();
  await repeat(id, "work/construction", 4, HOUR);
  expect((await getPet(id)).hygiene).toBe(20);
  const study = await act(id, "study/drama");
  expect(study.status).toBe(409);
  expect(study.body.error).toMatch(/dirty/i);
  await repeat(id, "work/construction", 1, HOUR);
  const work = await act(id, "work/construction", { minutes: 15 });
  expect(work.status).toBe(409);
  expect(work.body.error).toMatch(/dirty/i);
});

it("food costs $15 and restores 40 stamina", async () => {
  const id = await newPet();
  await repeat(id, "study/math", 3);
  await repeat(id, "work/construction", 1, HOUR);
  expect((await act(id, "buy/food")).body).toMatchObject({ money: 10, food: 1 });
  expect((await act(id, "use/food")).body).toMatchObject({ food: 0, stamina: 70 });
});

it("soap costs $10 and restores hygiene, up to 100", async () => {
  const id = await newPet();
  await repeat(id, "work/construction", 1, HOUR);
  expect((await act(id, "buy/soap")).body).toMatchObject({ money: 15, soap: 1, hygiene: 80 });
  expect((await act(id, "use/soap")).body).toMatchObject({ soap: 0, hygiene: 100 });
});

it("refuses to sell without the money, or to use an item the pet doesn't have", async () => {
  const id = await newPet();
  const broke = await act(id, "buy/food");
  expect(broke.status).toBe(409);
  expect(broke.body.error).toMatch(/not enough money/i);
  const empty = await act(id, "use/soap");
  expect(empty.status).toBe(409);
  expect(empty.body.error).toMatch(/no soap/i);
});

it("refuses to use an item when that need is already full", async () => {
  const id = await newPet();
  await repeat(id, "work/construction", 2, HOUR);
  await repeat(id, "buy/food", 2);
  expect((await act(id, "use/food")).body).toMatchObject({ stamina: 100, food: 1 });
  const full = await act(id, "use/food");
  expect(full.status).toBe(409);
  expect(full.body.error).toMatch(/already full/i);
  expect((await getPet(id)).food).toBe(1);
});

it("404s for an item or pet that doesn't exist", async () => {
  const id = await newPet();
  expect((await post(`/api/pets/${id}/buy/caviar`)).status).toBe(404);
  expect((await post(`/api/pets/${id}/use/caviar`)).status).toBe(404);
  expect((await post(`/api/pets/${freshId()}/work/construction`, HOUR)).status).toBe(404);
});
