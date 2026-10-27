// Run ON the Fly machine before a load test against the deployed app.
// Copies the live database to /data/pre-loadtest.db (a consistent snapshot,
// safe while the app is running) and prints row counts to check the cleanup
// against. Refuses to overwrite an earlier backup.
//
//   node /tmp/backup.cjs [database]     (default /data/virtuepets.db)
const { DatabaseSync } = require('node:sqlite');
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

const source = process.argv[2] ?? '/data/virtuepets.db';
const backup = join(dirname(source), 'pre-loadtest.db');
if (existsSync(backup)) {
  console.error(`${backup} already exists; move it aside first so an older backup isn't lost.`);
  process.exit(1);
}
const db = new DatabaseSync(source, { readOnly: true });
db.prepare('VACUUM INTO ?').run(backup);

const counts = {
  pets: db.prepare('SELECT count(*) AS n FROM pets').get().n,
  accounts: db.prepare('SELECT count(*) AS n FROM accounts').get().n,
  sessions: db.prepare('SELECT count(*) AS n FROM sessions').get().n,
  world_positions: db.prepare('SELECT count(*) AS n FROM world_positions').get().n,
  feed: db.prepare('SELECT count(*) AS n FROM feed').get().n,
  fights: db.prepare('SELECT count(*) AS n FROM fights').get().n,
  loadtest_pets: db.prepare("SELECT count(*) AS n FROM pets WHERE id LIKE 'loadtest-%'").get().n,
};
console.log(`Backed up ${source} to ${backup}`);
console.log(JSON.stringify(counts));
