import { expect, it } from "vitest";
import { baseUrl, finish, freshId, post } from "./helpers.ts";

it("creates a pet with base stats for an unknown ID", async () => {
  const id = freshId();
  const res = await post("/api/login", { id });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({
    id,
    strength: 5,
    intelligence: 5,
    charisma: 5,
    money: 0,
    activity: "idle",
    school: "primary",
    credits: 0,
    stamina: 100,
    hygiene: 100,
    food: 0,
    soap: 0,
    jobs: { construction: 0, office: 0, theatre: 0 },
    task: null,
    busySince: null,
    busyUntil: null,
    reward: null,
    wins: 0,
    losses: 0,
  });
});

it("returns the existing pet, not a new one, for a known ID", async () => {
  const id = freshId();
  await post("/api/login", { id });
  await post(`/api/pets/${id}/study/math`);
  await finish(id);

  const res = await post("/api/login", { id });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, intelligence: 6 });
});

it.each([["", "empty"], ["a".repeat(33), "too long"], ["x'; DROP TABLE pets;--", "SQL"]])(
  "rejects the ID %j (%s)",
  async (id) => {
    expect((await post("/api/login", { id })).status).toBe(400);
  },
);

it("404s for a pet that doesn't exist", async () => {
  expect((await fetch(new URL(`/api/pets/${freshId()}`, baseUrl))).status).toBe(404);
  expect((await post(`/api/pets/${freshId()}/study/math`)).status).toBe(404);
});
