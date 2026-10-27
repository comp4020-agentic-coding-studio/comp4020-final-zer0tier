import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// DATA_DIR is the Fly volume (/data) in the image; ./data when run locally.
const dataDir = process.env.DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "virtuepets.db"));

// Where characters stand changes up to 20 times a second per walking player,
// and waiting for the disk to confirm each step capped the whole server near
// 130-500 saved steps a second (scripts/load-test.ts). This second connection
// skips that wait. A crash of the app still loses nothing; a power cut may
// lose the last moment of walking, never a pet, money or a fight, which stay
// on `db` with the default full sync. Only src/world.ts uses it.
export const worldDb = new DatabaseSync(join(dataDir, "virtuepets.db"));
worldDb.exec("PRAGMA synchronous = NORMAL");

// Runs `action` as one transaction, or as part of the one already open, and
// rolls it back if `action` throws.
export function transaction<T>(action: () => T): T {
  if (db.isTransaction) return action();
  db.prepare("BEGIN IMMEDIATE").run();
  try {
    const result = action();
    db.prepare("COMMIT").run();
    return result;
  } catch (error) {
    db.prepare("ROLLBACK").run();
    throw error;
  }
}

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS pets (
    id           TEXT PRIMARY KEY,
    strength     INTEGER NOT NULL DEFAULT 5,
    intelligence INTEGER NOT NULL DEFAULT 5,
    charisma     INTEGER NOT NULL DEFAULT 5,
    money        INTEGER NOT NULL DEFAULT 0,
    steal_available_at INTEGER,
    supplies_available_at INTEGER,
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
    color        TEXT    NOT NULL DEFAULT '#f59e0b',
    appearance   TEXT    NOT NULL DEFAULT 'blob',
    task         TEXT,
    busy_since   INTEGER,
    busy_until   INTEGER,
    reward       TEXT,
    wins         INTEGER NOT NULL DEFAULT 0,
    losses       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS adventures (
    player_id TEXT PRIMARY KEY REFERENCES pets (id),
    x INTEGER NOT NULL,
    y INTEGER NOT NULL
  );
  -- A team forms in the Team up window, then shares one map once it sets off.
  -- A disbanded team never set off; its members are gone.
  CREATE TABLE IF NOT EXISTS teams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    leader     TEXT    NOT NULL REFERENCES pets (id),
    status     TEXT    NOT NULL DEFAULT 'forming' CHECK (status IN ('forming', 'exploring', 'disbanded')),
    world_json TEXT
  );
  -- Who is forming each team: joined = 0 is a pending invitation, and a pet
  -- joins at most one. Setting off moves the members onto adventures.team_id.
  CREATE TABLE IF NOT EXISTS team_members (
    team_id   INTEGER NOT NULL REFERENCES teams (id),
    player_id TEXT    NOT NULL REFERENCES pets (id),
    joined    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, player_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_team_per_pet ON team_members (player_id) WHERE joined = 1;
  CREATE INDEX IF NOT EXISTS team_members_by_player ON team_members (player_id);
  CREATE TABLE IF NOT EXISTS inventory (
    player_id TEXT NOT NULL REFERENCES pets (id),
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (player_id, item_id)
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
    spoils         INTEGER NOT NULL DEFAULT 0,
    fought_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS manual_battles (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('arena', 'revenge')),
    player_a TEXT NOT NULL REFERENCES pets (id),
    player_b TEXT NOT NULL REFERENCES pets (id),
    source_id INTEGER,
    status TEXT NOT NULL CHECK (status IN ('active', 'finished')),
    state_json TEXT NOT NULL,
    meta_json TEXT NOT NULL,
    result_json TEXT
  );
  CREATE INDEX IF NOT EXISTS manual_battles_by_a ON manual_battles (player_a, status);
  CREATE INDEX IF NOT EXISTS manual_battles_by_b ON manual_battles (player_b, status);
  CREATE TABLE IF NOT EXISTS feed (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    kind   TEXT    NOT NULL,
    pet    TEXT    NOT NULL REFERENCES pets (id),
    detail TEXT    NOT NULL DEFAULT '{}',
    at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS thefts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thief TEXT NOT NULL REFERENCES pets (id),
    victim TEXT NOT NULL REFERENCES pets (id),
    amount INTEGER NOT NULL,
    stolen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    result TEXT CHECK (result IN ('won', 'lost')),
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS thefts_by_victim ON thefts (victim, id);
  -- Visitors patting, tickling, stroking or shaking paws with someone else's
  -- pet. Only each pet's newest few are kept, for its owner's visitors list.
  CREATE TABLE IF NOT EXISTS touches (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor TEXT NOT NULL REFERENCES pets (id),
    pet     TEXT NOT NULL REFERENCES pets (id),
    kind    TEXT NOT NULL,
    at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS touches_by_pet ON touches (pet, id);
  CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY REFERENCES pets (id),
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    player_id  TEXT    NOT NULL REFERENCES accounts (id),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);
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
if (!columns.has("color")) db.exec("ALTER TABLE pets ADD COLUMN color TEXT NOT NULL DEFAULT '#f59e0b'");
if (!columns.has("appearance")) db.exec("ALTER TABLE pets ADD COLUMN appearance TEXT NOT NULL DEFAULT 'blob'");
if (!columns.has("steal_available_at")) db.exec("ALTER TABLE pets ADD COLUMN steal_available_at INTEGER");
if (!columns.has("supplies_available_at")) db.exec("ALTER TABLE pets ADD COLUMN supplies_available_at INTEGER");
if (!columns.has("equipped_coin")) db.exec("ALTER TABLE pets ADD COLUMN equipped_coin TEXT");
if (!columns.has("equipped_abilities")) db.exec("ALTER TABLE pets ADD COLUMN equipped_abilities TEXT NOT NULL DEFAULT '[\"claw-strike\"]'");
if (!columns.has("skill_jobs")) db.exec("ALTER TABLE pets ADD COLUMN skill_jobs TEXT NOT NULL DEFAULT '{}'");
const fightColumns = new Set(
  (db.prepare("SELECT name FROM pragma_table_info('fights')").all() as { name: string }[]).map((c) => c.name),
);
if (!fightColumns.has("spoils")) db.exec("ALTER TABLE fights ADD COLUMN spoils INTEGER NOT NULL DEFAULT 0");

// Older fights remain readable without a battle replay.
if (!fightColumns.has("battle_json")) db.exec("ALTER TABLE fights ADD COLUMN battle_json TEXT");
const theftColumns = new Set(
  (db.prepare("SELECT name FROM pragma_table_info('thefts')").all() as { name: string }[]).map((c) => c.name),
);
if (!theftColumns.has("battle_json")) db.exec("ALTER TABLE thefts ADD COLUMN battle_json TEXT");

// Preserve existing clearing coordinates while adding the saved five-floor map.
const adventureColumns = new Set(
  (db.prepare("SELECT name FROM pragma_table_info('adventures')").all() as { name: string }[]).map(c => c.name),
);
if (!adventureColumns.has("floor")) db.exec("ALTER TABLE adventures ADD COLUMN floor INTEGER NOT NULL DEFAULT 1");
if (!adventureColumns.has("world_json")) db.exec("ALTER TABLE adventures ADD COLUMN world_json TEXT");
if (!adventureColumns.has("revision")) db.exec("ALTER TABLE adventures ADD COLUMN revision TEXT");
if (!adventureColumns.has("battle_json")) db.exec("ALTER TABLE adventures ADD COLUMN battle_json TEXT");
if (!adventureColumns.has("records_json")) db.exec("ALTER TABLE adventures ADD COLUMN records_json TEXT");
if (!adventureColumns.has("entry_id")) db.exec("ALTER TABLE adventures ADD COLUMN entry_id TEXT");
if (!adventureColumns.has("awaiting_entry")) db.exec("ALTER TABLE adventures ADD COLUMN awaiting_entry INTEGER NOT NULL DEFAULT 0");
if (!adventureColumns.has("hp")) db.exec("ALTER TABLE adventures ADD COLUMN hp INTEGER");
if (!adventureColumns.has("mp")) db.exec("ALTER TABLE adventures ADD COLUMN mp INTEGER");
if (!adventureColumns.has("cooldown_until")) db.exec("ALTER TABLE adventures ADD COLUMN cooldown_until INTEGER");
if (!adventureColumns.has("abandoned")) db.exec("ALTER TABLE adventures ADD COLUMN abandoned INTEGER NOT NULL DEFAULT 0");
if (!adventureColumns.has("patrolled_at")) db.exec("ALTER TABLE adventures ADD COLUMN patrolled_at INTEGER");
// A team run's shared map lives on its team; solo runs keep team_id NULL.
if (!adventureColumns.has("team_id")) db.exec("ALTER TABLE adventures ADD COLUMN team_id INTEGER");
// A pet that has never set off yet chooses solo or a team first. Runs saved
// before teams existed were already under way.
if (!adventureColumns.has("started")) {
  db.exec("ALTER TABLE adventures ADD COLUMN started INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE adventures SET started = 1");
}
db.exec("CREATE INDEX IF NOT EXISTS adventures_by_team ON adventures (team_id)");
