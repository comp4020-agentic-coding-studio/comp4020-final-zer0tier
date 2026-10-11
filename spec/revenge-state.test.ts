import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "virtuepets-revenge-"));
let pets: typeof import("../src/pets.ts");
let db: typeof import("../src/db.ts").db;
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", directory);
  pets = await import("../src/pets.ts");
  ({ db } = await import("../src/db.ts"));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => { db.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
function setup() {
  const victim = `victim-${++sequence}`, thief = `thief-${sequence}`;
  pets.getOrCreatePet(victim); pets.getOrCreatePet(thief);
  db.prepare("UPDATE pets SET money = ? WHERE id IN (?, ?)").run(100, victim, thief);
  pets.steal(thief, victim);
  return { victim, thief, theft: pets.theftsFor(victim)[0] };
}

it("pays double and increases all attributes once, without removing daily protection", () => {
  const { victim, thief, theft } = setup();
  const before = pets.getPet(victim)!;
  const balance = pets.getPet(thief)!.money;
  vi.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0);
  expect(pets.revenge(victim, theft.id)).toMatchObject({ won: true, reward: theft.amount * 2,
    victim: { money: before.money + theft.amount * 2, strength: 6, intelligence: 6, charisma: 6,
      stealAvailableAt: before.stealAvailableAt, stamina: 90, hygiene: 95 },
    thief: { money: balance - theft.amount * 2 } });
  const after = pets.getPet(victim);
  expect(pets.revenge(victim, theft.id)).toMatchObject({ status: 409 });
  expect(pets.getPet(victim)).toEqual(after);
  expect(pets.theftsFor(victim)).toEqual([]);
  expect(pets.steal(thief, victim)).toMatchObject({ status: 429 });
});

it("a loss consumes exactly one attempt without money or attribute rewards", () => {
  const { victim, thief, theft } = setup();
  const before = pets.getPet(victim)!;
  const balance = pets.getPet(thief)!.money;
  vi.spyOn(Math, "random").mockReturnValue(0.5); // a tie belongs to the defender
  expect(pets.revenge(victim, theft.id)).toMatchObject({ won: false, reward: 0,
    victim: { money: before.money, strength: 5, intelligence: 5, charisma: 5, stamina: 90 },
    thief: { money: balance } });
  expect(pets.revenge(victim, theft.id)).toMatchObject({ status: 409 });
});

it("keeps the attempt and energy when the thief cannot pay or the victim is unfit", () => {
  const { victim, thief, theft } = setup();
  db.prepare("UPDATE pets SET money = ? WHERE id = ?").run(0, thief);
  expect(pets.revenge(victim, theft.id)).toMatchObject({ status: 409 });
  expect(pets.getPet(victim)!.stamina).toBe(100);
  db.prepare("UPDATE pets SET money = ? WHERE id = ?").run(100, thief);
  db.prepare("UPDATE pets SET stamina = ? WHERE id = ?").run(0, victim);
  expect(pets.revenge(victim, theft.id)).toMatchObject({ status: 409 });
  expect(pets.theftsFor(victim)).toHaveLength(1);
  expect(pets.revenge(thief, theft.id)).toMatchObject({ status: 404 });
});

it("persists private reports through feed pruning and process restart", () => {
  const { victim, theft } = setup();
  db.prepare("DELETE FROM feed WHERE kind = ?").run("stole");
  const output = execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { theftsFor } from './src/pets.ts'; console.log(JSON.stringify(theftsFor('${victim}')));`],
    { env: { ...process.env, DATA_DIR: directory }, encoding: "utf8" });
  expect(JSON.parse(output)).toEqual([theft]);
});

it("rolls back rewards and the attempt when recording the result fails", () => {
  const { victim, thief, theft } = setup();
  const before = [pets.getPet(victim), pets.getPet(thief)];
  vi.spyOn(Math, "random").mockReturnValueOnce(0.99).mockReturnValueOnce(0);
  db.exec("CREATE TRIGGER fail_revenge BEFORE INSERT ON feed WHEN NEW.kind = 'revenge' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    expect(() => pets.revenge(victim, theft.id)).toThrow("test failure");
    expect([pets.getPet(victim), pets.getPet(thief)]).toEqual(before);
    expect(pets.theftsFor(victim)).toEqual([theft]);
  } finally { db.exec("DROP TRIGGER fail_revenge"); }
});


it("enforces one theft across all thieves until exactly midnight UTC", () => {
  const now = Date.parse("2026-12-31T23:59:59.999Z");
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const { victim, thief } = setup();
  pets.getOrCreatePet("another-thief");
  expect(pets.steal("another-thief", victim)).toMatchObject({ status: 429 });
  expect(pets.getPet(victim)!.stealAvailableAt).toBe(now + 1);
  clock.mockReturnValue(now + 1);
  expect(pets.steal("another-thief", victim)).toHaveProperty("amount");
  expect(pets.steal(thief, victim)).toMatchObject({ status: 429 });
  expect(pets.theftsFor(victim)).toHaveLength(2);
});
