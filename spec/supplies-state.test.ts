import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

// Isolated storage and time for the UTC midnight boundary; the public action,
// ownership and live events are covered over HTTP in supplies.test.ts.
const directory = mkdtempSync(join(tmpdir(), "virtuepets-supplies-state-"));
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

it("migrates an existing pet so it can collect straight away", () => {
  expect(pets.getPet("legacy")).toMatchObject({ suppliesAvailableAt: null, food: 0, soap: 0 });
  expect(pets.collectSupplies("legacy")).toMatchObject({ pet: { food: 1, soap: 1, money: 100 } });
});

it.each(["2026-10-09", "2026-12-31", "2028-02-29"])("refreshes at exactly the next UTC midnight after %s", (day) => {
  const id = `collector-${day}`;
  pets.getOrCreatePet(id);
  const now = Date.parse(`${day}T23:59:59.999Z`);
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  expect(pets.collectSupplies(id)).toMatchObject({ pet: { food: 1, soap: 1, suppliesAvailableAt: now + 1 } });
  expect(pets.collectSupplies(id)).toMatchObject({ status: 429 });
  clock.mockReturnValue(now + 1);
  expect(pets.collectSupplies(id)).toMatchObject({ pet: { food: 2, soap: 2, suppliesAvailableAt: now + 1 + 86_400_000 } });
});

it("doesn't add up missed days, and other actions keep the day's collection", () => {
  const id = "collector-later";
  pets.getOrCreatePet(id);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T08:00:00Z"));
  pets.collectSupplies(id);
  clock.mockReturnValue(Date.parse("2026-10-09T08:00:00Z")); // a week away
  expect(pets.collectSupplies(id)).toMatchObject({ pet: { food: 2, soap: 2 } });
  db.prepare("UPDATE pets SET stamina = 50, hygiene = 50 WHERE id = ?").run(id);
  expect(pets.use(id, "food")).toMatchObject({ pet: { food: 1, stamina: 90 } });
  pets.setAppearance(id, "#123456", "cat");
  expect(pets.getPet(id)!.suppliesAvailableAt).toBe(Date.parse("2026-10-10T00:00:00Z"));
  expect(pets.collectSupplies(id)).toMatchObject({ status: 429 });
  expect(pets.collectSupplies("nobody")).toMatchObject({ status: 404 });
});
