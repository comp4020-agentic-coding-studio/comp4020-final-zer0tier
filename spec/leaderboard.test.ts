import { expect, it } from "vitest";
import { baseUrl, freshId, getRules, post, signUp, studyTimes } from "./helpers.ts";

const board = async (query = ""): Promise<{ status: number; body: any }> => {
  const res = await fetch(new URL(`/api/leaderboard${query}`, baseUrl));
  return { status: res.status, body: await res.json() };
};

const power = (pet: any): number => 2 * pet.strength + pet.intelligence + pet.charisma;

it("ranks the top 10 players by wins, fewer losses breaking ties, without the bot", async () => {
  expect((await getRules()).leaderboardSize).toBe(10);
  const id = freshId();
  await signUp(id);
  for (const query of ["", "?by=wins"]) {
    const { status, body } = await board(query);
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.length).toBeLessThanOrEqual(10);
    expect(body.map((p: any) => p.id)).not.toContain("0");
    for (let i = 1; i < body.length; i++) {
      const [above, below] = [body[i - 1], body[i]];
      expect(above.wins > below.wins || (above.wins === below.wins && above.losses <= below.losses)).toBe(true);
    }
  }
});

it("ranks the top 10 players by power", async () => {
  const { status, body } = await board("?by=power");
  expect(status).toBe(200);
  expect(body.length).toBeLessThanOrEqual(10);
  expect(body.map((p: any) => p.id)).not.toContain("0");
  const powers = body.map(power);
  expect(powers).toEqual([...powers].sort((a, b) => b - a));
});

it("no player's pet outside the board outranks the last pet on it", async () => {
  const id = freshId();
  await signUp(id);
  await studyTimes(id, "pe", 1); // something to rank
  const pets = (await (await fetch(new URL("/api/pets?limit=50", baseUrl))).json()).filter((p: any) => p.id !== "0");
  const byWins = (await board()).body;
  const byPower = (await board("?by=power")).body;
  for (const [top, beats] of [
    [byWins, (a: any, b: any) => a.wins > b.wins || (a.wins === b.wins && a.losses < b.losses)],
    [byPower, (a: any, b: any) => power(a) > power(b)],
  ] as const) {
    const listed = new Set(top.map((p: any) => p.id));
    const last = top[top.length - 1];
    for (const pet of pets) {
      if (top.length === 10 && !listed.has(pet.id)) expect(beats(pet, last)).toBe(false);
      if (top.length < 10) expect(listed.has(pet.id)).toBe(true); // a part-full board has everyone
    }
  }
});

it("refuses an unknown ranking", async () => {
  const { status, body } = await board("?by=money");
  expect(status).toBe(400);
  expect(body.error).toMatch(/wins or power/);
});

it("a fight's winner climbs the wins board", async () => {
  const attacker = freshId();
  const defender = freshId();
  await signUp(attacker);
  await signUp(defender);
  const { fight } = await (await post(`/api/pets/${attacker}/fight/${defender}`)).json();
  const top = (await board()).body;
  const last = top[top.length - 1];
  // One win puts a pet on the board unless ten players already have more.
  if (top.length < 10 || last.wins < 1 || (last.wins === 1 && last.losses > 0)) {
    expect(top.map((p: any) => p.id)).toContain(fight.winner);
  }
});
