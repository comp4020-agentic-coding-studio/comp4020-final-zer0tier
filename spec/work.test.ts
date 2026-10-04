import { expect, it } from "vitest";
import { finish, freshId, getPet, getRules, post, readyToStudy, studyTimes, signUp } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  await signUp(id);
  return id;
}

const act = async (id: string, path: string): Promise<{ status: number; body: any }> => {
  const res = await post(`/api/pets/${id}/${path}`);
  return { status: res.status, body: await res.json() };
};

// Money earned by an hour's shift, from a pet fit enough to work.
async function shift(id: string, location: string): Promise<number> {
  await readyToStudy(id);
  const before = (await getPet(id)).money;
  expect((await post(`/api/pets/${id}/work/${location}`, { minutes: 60 })).status).toBe(200);
  return (await finish(id)).money - before;
}

it("publishes three work locations, one per attribute", async () => {
  const { locations } = await getRules();
  expect(locations.map((l: any) => [l.id, l.attribute])).toEqual([
    ["construction", "strength"],
    ["office", "intelligence"],
    ["theatre", "charisma"],
  ]);
});

it("pays the first rank's $20 plus $1 per point of the location's attribute, per hour", async () => {
  const id = await newPet();
  await studyTimes(id, "pe", 2); // strength 7
  expect(await shift(id, "construction")).toBe(27);
  expect(await shift(id, "office")).toBe(25);
  expect(await shift(id, "theatre")).toBe(25);
});

it("refuses an upgrade until the attribute is high enough, and changes nothing", async () => {
  const id = await newPet();
  const before = await getPet(id);
  const { status, body } = await act(id, "upgrade/office");
  expect(status).toBe(409);
  expect(body.error).toMatch(/needs 20 intelligence/i);
  expect(await getPet(id)).toEqual(before);
});

it("upgrades through every rank as the attribute grows, each paying more", async () => {
  const id = await newPet();
  await studyTimes(id, "pe", 10); // strength 5 + 5×1 + 5×2 = 20
  expect((await act(id, "upgrade/construction")).body.jobs).toEqual({ construction: 1, office: 0, theatre: 0 });
  expect(await shift(id, "construction")).toBe(40 + 20);
  expect((await act(id, "upgrade/construction")).status).toBe(409);

  await studyTimes(id, "pe", 12); // + 5×2 at middle, then 7×3 at high = 51
  expect((await act(id, "upgrade/construction")).body.jobs.construction).toBe(2);
  expect(await shift(id, "construction")).toBe(70 + 51);
  const top = await act(id, "upgrade/construction");
  expect(top.status).toBe(409);
  expect(top.body.error).toMatch(/already at the top/i);
});

it("404s for a location that doesn't exist", async () => {
  const id = await newPet();
  expect((await post(`/api/pets/${id}/work/moon`)).status).toBe(404);
  expect((await post(`/api/pets/${id}/upgrade/moon`)).status).toBe(404);
});
