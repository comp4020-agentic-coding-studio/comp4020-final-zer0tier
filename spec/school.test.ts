import { expect, it } from "vitest";
import { finish, freshId, getRules, post, studyTimes, signUp } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  await signUp(id);
  return id;
}


const total = (pet: any): number => pet.strength + pet.intelligence + pet.charisma;

it("publishes the schools and courses", async () => {
  const body = await getRules();
  expect(body.schools.map((s: any) => s.id)).toEqual(["primary", "middle", "high"]);
  expect(body.courses.map((c: any) => c.id)).toEqual(["math", "pe", "drama", "electives"]);
});

it.each([
  ["math", "intelligence"],
  ["pe", "strength"],
  ["drama", "charisma"],
])("%s at primary school raises %s by 1 and earns a credit", async (course, attribute) => {
  const id = await newPet();
  const res = await post(`/api/pets/${id}/study/${course}`);
  expect(res.status).toBe(200);
  const pet = await finish(id);
  expect(pet).toMatchObject({ [attribute]: 6, school: "primary", credits: 1 });
  expect(total(pet)).toBe(16);
});

it("electives raises a random attribute by 1 at primary school", async () => {
  const id = await newPet();
  const pet = await studyTimes(id, "electives", 1);
  expect(total(pet)).toBe(16);
  expect(pet.credits).toBe(1);
});

it("5 credits move a pet up to middle school, where lessons are worth 2", async () => {
  const id = await newPet();
  expect(await studyTimes(id, "math", 4)).toMatchObject({ school: "primary", credits: 4 });
  expect(await studyTimes(id, "math", 1)).toMatchObject({ school: "middle", credits: 0, intelligence: 10 });
  expect(await studyTimes(id, "pe", 1)).toMatchObject({ school: "middle", credits: 1, strength: 7 });
});

it("10 more credits move a pet up to high school, the top, where lessons are worth 3", async () => {
  const id = await newPet();
  await studyTimes(id, "math", 5);
  expect(await studyTimes(id, "drama", 9)).toMatchObject({ school: "middle", credits: 9 });
  expect(await studyTimes(id, "drama", 1)).toMatchObject({ school: "high", credits: 0, charisma: 25 });
  const pet = await studyTimes(id, "electives", 20);
  expect(pet).toMatchObject({ school: "high", credits: 20 });
  // 15 to start, then 5 lessons at +1, 10 at +2 and 20 at +3.
  expect(total(pet)).toBe(15 + 5 + 20 + 60);
});

it("404s for a course that doesn't exist", async () => {
  const id = await newPet();
  expect((await post(`/api/pets/${id}/study/alchemy`)).status).toBe(404);
});
