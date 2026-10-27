// Run ON the Fly machine after a load test against the deployed app. Deletes
// every pet whose ID starts with "loadtest-" (the IDs scripts/load-test.ts
// signs up) and every row that names one, in a single transaction. Without
// --apply it only reports what it would delete and changes nothing.
//
//   node /tmp/cleanup.cjs [--apply] [database]   (default /data/virtuepets.db)
const { DatabaseSync } = require('node:sqlite');

const apply = process.argv.includes('--apply');
const source = process.argv.slice(2).find(arg => arg !== '--apply') ?? '/data/virtuepets.db';
const db = new DatabaseSync(source);
db.exec('PRAGMA busy_timeout = 5000');

const PREFIX = 'loadtest-%';
// Every column that names a pet (src/db.ts, src/world.ts), children first.
const DELETES = [
  ['sessions', db.prepare('DELETE FROM sessions WHERE player_id LIKE ?'), 1],
  ['world_positions', db.prepare('DELETE FROM world_positions WHERE player_id LIKE ? OR home LIKE ?'), 2],
  ['feed', db.prepare('DELETE FROM feed WHERE pet LIKE ?'), 1],
  ['fights', db.prepare('DELETE FROM fights WHERE attacker LIKE ? OR defender LIKE ? OR winner LIKE ?'), 3],
  ['manual_battles', db.prepare('DELETE FROM manual_battles WHERE player_a LIKE ? OR player_b LIKE ?'), 2],
  ['thefts', db.prepare('DELETE FROM thefts WHERE thief LIKE ? OR victim LIKE ?'), 2],
  ['touches', db.prepare('DELETE FROM touches WHERE visitor LIKE ? OR pet LIKE ?'), 2],
  ['inventory', db.prepare('DELETE FROM inventory WHERE player_id LIKE ?'), 1],
  ['adventures', db.prepare('DELETE FROM adventures WHERE player_id LIKE ?'), 1],
  ['team_members', db.prepare('DELETE FROM team_members WHERE player_id LIKE ? OR team_id IN (SELECT id FROM teams WHERE leader LIKE ?)'), 2],
  ['teams', db.prepare('DELETE FROM teams WHERE leader LIKE ?'), 1],
  ['accounts', db.prepare('DELETE FROM accounts WHERE id LIKE ?'), 1],
  ['pets', db.prepare('DELETE FROM pets WHERE id LIKE ?'), 1],
];

const pets = db.prepare('SELECT id FROM pets WHERE id LIKE ? ORDER BY id').all(PREFIX).map(row => row.id);
console.log(`${pets.length} load-test pet(s) in ${source}${pets.length ? `: ${pets[0]} … ${pets.at(-1)}` : ''}`);

db.exec('BEGIN IMMEDIATE');
try {
  for (const [table, statement, uses] of DELETES) {
    const { changes } = statement.run(...Array(uses).fill(PREFIX));
    console.log(`  ${table.padEnd(16)} ${changes} row(s)`);
  }
  db.exec(apply ? 'COMMIT' : 'ROLLBACK');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
const left = db.prepare('SELECT count(*) AS n FROM pets WHERE id LIKE ?').get(PREFIX).n;
console.log(apply ? `Deleted. ${left} load-test pet(s) left.` : 'Dry run: nothing changed. Run again with --apply to delete.');
