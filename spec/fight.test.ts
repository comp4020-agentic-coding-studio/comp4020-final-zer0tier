import { expect, it } from "vitest";
import {
  baseUrl, finish, freshId, getPet, getRules, post, readyToStudy, studyTimes, signUp, workHour,
} from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  await signUp(id);
  return id;
}

const fight = async (id: string, opponent: string): Promise<{ status: number; body: any }> => {
  const res = await post(`/api/pets/${id}/fight/${opponent}`);
  return { status: res.status, body: await res.json() };
};

const getJson = async (path: string): Promise<any> => (await fetch(new URL(path, baseUrl))).json();

// Strength 14 makes power 2×14 + 5 + 5 = 38, more than 1.5× a new pet's 20.
async function strongPet(): Promise<string> {
  const id = await newPet();
  await studyTimes(id, "pe", 7);
  await readyToStudy(id);
  return id;
}

it("the bot, pet 0, always exists and heads the list of pets", async () => {
  expect(await getJson("/api/pets/0")).toMatchObject({ id: "0" });
  const id = await newPet();
  const pets = await getJson("/api/pets?limit=50");
  expect(pets[0].id).toBe("0");
  expect(pets.length).toBeLessThanOrEqual(50);
  expect(pets.every((p: any) => typeof p.strength === "number" && typeof p.wins === "number")).toBe(true);
  expect((await getJson(`/api/pets/${id}`)).id).toBe(id); // any pet can be looked up by ID
});

it("lists pets for any limit it's given, clamped to 1–50", async () => {
  for (const limit of ["1.5", "abc", "-3", "1000"]) {
    const res = await fetch(new URL(`/api/pets?limit=${limit}`, baseUrl));
    expect(res.status).toBe(200);
    const pets = await res.json();
    expect(pets.length).toBeGreaterThanOrEqual(1);
    expect(pets.length).toBeLessThanOrEqual(50);
  }
});

it("a pet that just joined is listed right after the bot, however many pets have wins", async () => {
  const id = await newPet();
  const pets = await getJson("/api/pets?limit=5");
  expect(pets.map((p: any) => p.id).slice(0, 2)).toEqual(["0", id]);
});

it("a pet with 1.5× the power always wins, and the fight is recorded for both", async () => {
  const strong = await strongPet();
  const weak = await newPet();
  const before = await getPet(strong);
  const { status, body } = await fight(strong, weak);
  expect(status).toBe(200);
  expect(body.fight).toMatchObject({ attacker: strong, defender: weak, winner: strong, attackerPower: 38, defenderPower: 20 });
  expect(body.attacker).toMatchObject({
    wins: 1, losses: 0, stamina: before.stamina - 10, hygiene: before.hygiene - 5,
  });
  expect(body.defender).toMatchObject({ wins: 0, losses: 1, stamina: 100, hygiene: 100 });
  for (const id of [strong, weak]) {
    expect((await getJson(`/api/pets/${id}/fights`))[0]).toEqual(body.fight);
  }
});

it("a much weaker attacker always loses", async () => {
  const strong = await strongPet();
  const weak = await newPet();
  const { body } = await fight(weak, strong);
  expect(body.fight.winner).toBe(strong);
  expect(body.attacker).toMatchObject({ wins: 0, losses: 1 });
  expect(body.defender.wins).toBe(1);
});

it("anyone can fight the bot", async () => {
  const id = await newPet();
  const { status, body } = await fight(id, "0");
  expect(status).toBe(200);
  expect([id, "0"]).toContain(body.fight.winner);
});

it("refuses to fight itself, a pet that doesn't exist, while busy, or when too dirty", async () => {
  const id = await newPet();
  expect((await fight(id, id)).status).toBe(400);
  expect((await fight(id, freshId())).status).toBe(404);
  expect((await fight(freshId(), "0")).status).toBe(401); // nobody's signed in as it

  expect((await post(`/api/pets/${id}/work/office`, { minutes: 240 })).status).toBe(200);
  const busy = await fight(id, "0");
  expect(busy.status).toBe(409);
  expect(busy.body.error).toMatch(/busy/i);

  await finish(id); // hygiene 100 − 80 = 20, short of the 25 a fight needs
  const before = await getPet(id);
  const dirty = await fight(id, "0");
  expect(dirty.status).toBe(409);
  expect(dirty.body.error).toMatch(/dirty/i);
  expect(await getPet(id)).toEqual(before);
});

it("the winner takes 10% of the loser's money (rounded down, at most $50)", async () => {
  const { fight: rules } = await getRules();
  expect(rules.spoils).toEqual({ share: 0.1, max: 50 });
  const strong = await strongPet();
  const weak = await newPet();
  const loser = await workHour(weak);
  const winner = await getPet(strong);
  const spoils = Math.min(50, Math.floor(loser.money * 0.1));
  expect(spoils).toBeGreaterThan(0);

  const { body } = await fight(strong, weak);
  expect(body.fight).toMatchObject({ winner: strong, spoils });
  expect(body.attacker.money).toBe(winner.money + spoils);
  expect(body.defender.money).toBe(loser.money - spoils);
  expect((await getJson(`/api/pets/${weak}/fights`))[0].spoils).toBe(spoils);
});

it("an attacker who loses pays the defender", async () => {
  const strong = await strongPet();
  const weak = await newPet();
  const loser = await workHour(weak);
  const winner = await getPet(strong);
  const spoils = Math.floor(loser.money * 0.1);
  const { body } = await fight(weak, strong);
  expect(body.fight).toMatchObject({ winner: strong, spoils });
  expect(body.attacker.money).toBe(loser.money - spoils);
  expect(body.defender.money).toBe(winner.money + spoils);
});

it("nothing changes hands in a fight with the bot", async () => {
  const id = await newPet();
  const before = await workHour(id);
  const bot = await getPet("0");
  const { body } = await fight(id, "0");
  expect(body.fight.spoils).toBe(0);
  expect(body.attacker.money).toBe(before.money);
  expect(body.defender.money).toBe(bot.money);
});

it("an attacker waits an hour to attack the same pet again, but the defender can hit back at once", async () => {
  const { fight: rules, timeScale } = await getRules();
  expect(rules.cooldownMinutes).toBe(60);
  const attacker = await newPet();
  const defender = await newPet();
  const started = Date.now();
  expect((await fight(attacker, defender)).status).toBe(200);
  const again = await fight(attacker, defender);
  // On the test clock the hour is 0.1 s; only judge the refusal inside it.
  if (Date.now() - started < (60 * 60_000) / timeScale) {
    expect(again.status).toBe(429);
    expect(again.body.error).toMatch(new RegExp(`attacked ${defender} recently`));
  }

  expect((await fight(defender, attacker)).status).toBe(200); // revenge isn't held up
  expect((await fight(attacker, "0")).status).toBe(200); // nor is anyone else

  await new Promise((resolve) => setTimeout(resolve, (60 * 60_000) / timeScale + 20));
  expect((await fight(attacker, defender)).status).toBe(200);
});
