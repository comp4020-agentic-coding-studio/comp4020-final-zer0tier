import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

// Isolated storage and time for midnight boundaries and rollback failures;
// the public action, ownership and live events are covered over HTTP too.
const directory = mkdtempSync(join(tmpdir(), "virtuepets-steal-state-"));
let pets: typeof import("../src/pets.ts");
let db: DatabaseSync;
beforeAll(async () => {
  const legacy = new DatabaseSync(join(directory, "virtuepets.db"));
  legacy.exec(`CREATE TABLE pets (
    id TEXT PRIMARY KEY, strength INTEGER DEFAULT 5, intelligence INTEGER DEFAULT 5,
    charisma INTEGER DEFAULT 5, money INTEGER DEFAULT 0, activity TEXT DEFAULT 'idle'
  ); INSERT INTO pets (id, money) VALUES ('legacy', 100)`);
  legacy.close();
  vi.stubEnv("DATA_DIR", directory);
  pets = await import("../src/pets.ts");
  ({ db } = await import("../src/db.ts"));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  db?.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function pair(suffix: string, money = 100) {
  const thief = `thief-${suffix}`;
  const victim = `victim-${suffix}`;
  pets.getOrCreatePet(thief);
  pets.getOrCreatePet(victim);
  db.prepare("UPDATE pets SET money = ? WHERE id = ?").run(money, victim);
  return { thief, victim };
}

it("migrates an existing pet without changing its money", () => {
  expect(pets.getPet("legacy")).toMatchObject({ money: 100, stealAvailableAt: null });
});

it.each([[0, 100, 10], [0.999999, 100, 30], [0.999999, 17, 17], [0, 10, 10]])(
  "keeps random roll %s within the available $%s balance (takes $%s)", (roll, money, amount) => {
    const { thief, victim } = pair(`${roll}-${money}`, money);
    vi.spyOn(Math, "random").mockReturnValue(roll);
    expect(pets.steal(thief, victim)).toMatchObject({ amount, victim: { money: money - amount }, thief: { money: amount } });
  },
);

it.each(["2026-10-09", "2026-12-31", "2028-02-29"])("protects until exactly the next UTC day after %s", (day) => {
  const { thief, victim } = pair(day);
  const now = Date.parse(`${day}T23:59:59.999Z`);
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const first = pets.steal(thief, victim);
  expect(first).toMatchObject({ victim: { stealAvailableAt: now + 1 } });
  expect(pets.steal(thief, victim)).toMatchObject({ status: 429 });
  clock.mockReturnValue(now + 1);
  expect(pets.steal(thief, victim)).toMatchObject({ victim: { stealAvailableAt: now + 1 + 86_400_000 } });
});

it("keeps protection through other pet changes and a new server process", () => {
  const { thief, victim } = pair("persist");
  expect(pets.steal(thief, victim)).toHaveProperty("amount");
  const protectedPet = pets.getPet(victim)!;
  pets.setAppearance(victim, "#123456", "cat");
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { getPet, steal } from './src/pets.ts';
    console.log(JSON.stringify({ pet: getPet('${victim}'), outcome: steal('${thief}', '${victim}') }));
  `], { env: { ...process.env, DATA_DIR: directory }, encoding: "utf8" });
  const restarted = JSON.parse(output);
  expect(restarted.pet).toMatchObject({ money: protectedPet.money, stealAvailableAt: protectedPet.stealAvailableAt });
  expect(restarted.outcome.status).toBe(429);
});

it("rolls back both balances, the protection and the feed if recording fails", () => {
  const { thief, victim } = pair("rollback");
  const before = [pets.getPet(thief), pets.getPet(victim)];
  const feed = db.prepare("SELECT count(*) AS n FROM feed").get();
  db.exec("CREATE TRIGGER fail_theft BEFORE INSERT ON feed WHEN NEW.kind = 'stole' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    expect(() => pets.steal(thief, victim)).toThrow("test failure");
    expect([pets.getPet(thief), pets.getPet(victim)]).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM feed").get()).toEqual(feed);
  } finally {
    db.exec("DROP TRIGGER fail_theft");
  }
  expect(pets.steal(thief, victim)).toHaveProperty("amount");
});
