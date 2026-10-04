import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// DATA_DIR is the Fly volume (/data) in the image; ./data when run locally.
const dataDir = process.env.DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "virtuepets.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS pets (
    id           TEXT PRIMARY KEY,
    strength     INTEGER NOT NULL DEFAULT 5,
    intelligence INTEGER NOT NULL DEFAULT 5,
    charisma     INTEGER NOT NULL DEFAULT 5,
    money        INTEGER NOT NULL DEFAULT 0,
    activity     TEXT    NOT NULL DEFAULT 'idle',
    school       TEXT    NOT NULL DEFAULT 'primary',
    credits      INTEGER NOT NULL DEFAULT 0,
    stamina      INTEGER NOT NULL DEFAULT 100,
    hygiene      INTEGER NOT NULL DEFAULT 100,
    food         INTEGER NOT NULL DEFAULT 0,
    soap         INTEGER NOT NULL DEFAULT 0,
    hourglass    INTEGER NOT NULL DEFAULT 0,
    construction_rank INTEGER NOT NULL DEFAULT 0,
    office_rank       INTEGER NOT NULL DEFAULT 0,
    theatre_rank      INTEGER NOT NULL DEFAULT 0,
    task         TEXT,
    busy_since   INTEGER,
    busy_until   INTEGER,
    reward       TEXT,
    wins         INTEGER NOT NULL DEFAULT 0,
    losses       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fights (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    attacker       TEXT    NOT NULL REFERENCES pets (id),
    defender       TEXT    NOT NULL REFERENCES pets (id),
    winner         TEXT    NOT NULL REFERENCES pets (id),
    attacker_power INTEGER NOT NULL,
    defender_power INTEGER NOT NULL,
    attacker_roll  REAL    NOT NULL,
    defender_roll  REAL    NOT NULL,
    fought_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS fights_by_attacker ON fights (attacker, id);
  CREATE INDEX IF NOT EXISTS fights_by_defender ON fights (defender, id);
`);

// Databases made before a feature existed lack its columns; add them in place.
const columns = new Set(
  (db.prepare("SELECT name FROM pragma_table_info('pets')").all() as { name: string }[]).map((c) => c.name),
);
if (!columns.has("school")) db.exec("ALTER TABLE pets ADD COLUMN school TEXT NOT NULL DEFAULT 'primary'");
if (!columns.has("credits")) db.exec("ALTER TABLE pets ADD COLUMN credits INTEGER NOT NULL DEFAULT 0");
if (!columns.has("stamina")) db.exec("ALTER TABLE pets ADD COLUMN stamina INTEGER NOT NULL DEFAULT 100");
if (!columns.has("hygiene")) db.exec("ALTER TABLE pets ADD COLUMN hygiene INTEGER NOT NULL DEFAULT 100");
if (!columns.has("food")) db.exec("ALTER TABLE pets ADD COLUMN food INTEGER NOT NULL DEFAULT 0");
if (!columns.has("soap")) db.exec("ALTER TABLE pets ADD COLUMN soap INTEGER NOT NULL DEFAULT 0");
if (!columns.has("hourglass")) db.exec("ALTER TABLE pets ADD COLUMN hourglass INTEGER NOT NULL DEFAULT 0");
if (!columns.has("construction_rank")) db.exec("ALTER TABLE pets ADD COLUMN construction_rank INTEGER NOT NULL DEFAULT 0");
if (!columns.has("office_rank")) db.exec("ALTER TABLE pets ADD COLUMN office_rank INTEGER NOT NULL DEFAULT 0");
if (!columns.has("task")) db.exec("ALTER TABLE pets ADD COLUMN task TEXT");
if (!columns.has("busy_since")) db.exec("ALTER TABLE pets ADD COLUMN busy_since INTEGER");
if (!columns.has("busy_until")) db.exec("ALTER TABLE pets ADD COLUMN busy_until INTEGER");
if (!columns.has("reward")) db.exec("ALTER TABLE pets ADD COLUMN reward TEXT");
if (!columns.has("wins")) db.exec("ALTER TABLE pets ADD COLUMN wins INTEGER NOT NULL DEFAULT 0");
if (!columns.has("losses")) db.exec("ALTER TABLE pets ADD COLUMN losses INTEGER NOT NULL DEFAULT 0");
if (!columns.has("theatre_rank")) db.exec("ALTER TABLE pets ADD COLUMN theatre_rank INTEGER NOT NULL DEFAULT 0");
