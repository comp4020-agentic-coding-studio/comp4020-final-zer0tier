import { expect, it } from "vitest";
import { baseUrl, freshId, post, signUp, studyTimes } from "./helpers.ts";

const feed = async (limit = 50): Promise<any[]> =>
  (await fetch(new URL(`/api/feed?limit=${limit}`, baseUrl))).json();

// Specs share one app, so look for this test's entries among the newest.
const entriesFor = async (id: string): Promise<any[]> => (await feed()).filter((e) => e.pet === id);

it("the feed lists what's happening, newest first, for any limit clamped to 1–50", async () => {
  for (const limit of ["1.5", "abc", "-3", "1000"]) {
    const res = await fetch(new URL(`/api/feed?limit=${limit}`, baseUrl));
    expect(res.status).toBe(200);
    const entries = await res.json();
    expect(entries.length).toBeLessThanOrEqual(50);
  }
  const id = freshId();
  await signUp(id);
  const entries = await feed();
  expect(entries.length).toBeGreaterThanOrEqual(1);
  expect(entries.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort((a, b) => b - a));
  expect(entries.find((e) => e.pet === id)).toMatchObject({ kind: "joined", at: expect.any(String) });
});

it("a fight goes in the feed with its winner and the money taken", async () => {
  const attacker = freshId();
  const defender = freshId();
  await signUp(attacker);
  await signUp(defender);
  const { fight } = await (await post(`/api/pets/${attacker}/fight/${defender}`)).json();
  expect((await entriesFor(attacker))[0]).toMatchObject({
    kind: "fight", other: defender, winner: fight.winner, spoils: fight.spoils,
  });
});

it("moving up a school and a promotion go in the feed; ordinary lessons don't", async () => {
  const id = freshId();
  await signUp(id);
  await studyTimes(id, "drama", 10); // primary to middle school, then Charisma 20
  expect((await post(`/api/pets/${id}/upgrade/theatre`)).status).toBe(200);
  const kinds = (await entriesFor(id)).map(({ kind, school, location, rank }) => ({ kind, school, location, rank }));
  expect(kinds).toEqual([
    { kind: "promoted", location: "theatre", rank: 1, school: undefined },
    { kind: "school", school: "middle", location: undefined, rank: undefined },
    { kind: "joined", school: undefined, location: undefined, rank: undefined },
  ]);
});
