import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// The Slime King lives five floors down behind rare keys, so this test runs
// its own server and database: it can stand a pet beside the king, then play
// the battle over real HTTP and watch the prize reach other players' windows.
const password = 'woodland-password';
let child: ChildProcess | undefined;
let dataDir: string;
let baseUrl: string;
let stdout = '';
let stderr = '';
const sockets = new Set<WebSocket>();

async function signUp(id: string): Promise<string> {
  const response = await fetch(new URL('/api/signup', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, password }),
  });
  expect(response.status).toBe(201);
  return response.headers.getSetCookie().find(cookie => cookie.startsWith('session='))!.split(';')[0];
}
async function connect(cookie: string): Promise<WebSocket> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws`, { headers: { cookie } });
  sockets.add(ws);
  ws.once('close', () => sockets.delete(ws));
  await once(ws, 'open');
  return ws;
}
async function act(cookie: string, body: object): Promise<any> {
  const response = await fetch(new URL('/api/adventure', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
// Resolves with the first event `matches` accepts; fails past the 1 s budget.
function next(ws: WebSocket, matches: (event: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no matching event within 1s')), 1000);
    ws.on('message', data => {
      const event = JSON.parse(String(data));
      if (!matches(event)) return;
      clearTimeout(timer);
      resolve(event);
    });
  });
}
const alive = () => child!.exitCode === null && child!.signalCode === null;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'virtuepets-woodland-'));
  child = spawn(process.execPath, ['src/server.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, TIME_SCALE: '36000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', chunk => { stdout += String(chunk); });
  child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const address = () => {
    if (!alive()) throw new Error(`woodland server exited: ${stderr}`);
    return stdout.match(/VirtuePets listening on http:\/\/0\.0\.0\.0:(\d+)/)?.[1];
  };
  await vi.waitFor(() => expect(address()).toBeDefined(), { timeout: 5000 });
  baseUrl = `http://127.0.0.1:${address()}`;
});

afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  if (child && alive()) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child!.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(force); }
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it('feed:added and pet:updated — clearing the woodland pays once and reaches every open window within 1s', async () => {
  const hero = await signUp('hero'), watcher = await signUp('watcher');
  // Enter a fresh solo run, then stand beside the Slime King with a pet strong enough to win.
  const entry = await act(hero, { action: 'enter', entryId: 'woodland-entry', revision: (await act(hero, {})).revision });
  const db = new DatabaseSync(join(dataDir, 'virtuepets.db'));
  try {
    db.prepare('UPDATE pets SET strength = 100, intelligence = 100, charisma = 100 WHERE id = ?').run('hero');
    const saved = db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get('hero') as { world_json: string | null };
    expect(saved.world_json, JSON.stringify(entry)).not.toBeNull();
    const world = JSON.parse(saved.world_json!);
    const king = world[4].enemies.find((enemy: any) => enemy.kind === 'slime-king');
    db.prepare('UPDATE adventures SET floor = 5, x = ?, y = ?, hp = NULL, mp = NULL WHERE player_id = ?').run(king.x - 1, king.y, 'hero');
  } finally { db.close(); }

  const windows = [await connect(hero), await connect(watcher)];
  let state = await act(hero, {});
  // Walk into the king, then choose the strongest affordable move each turn.
  // Collect every pet:updated and feed:added for the hero until it ends.
  const seen = windows.map(() => ({ pets: [] as any[], feed: [] as any[] }));
  windows.forEach((ws, i) => ws.on('message', data => {
    const event = JSON.parse(String(data));
    if (event.type === 'pet:updated' && event.pet.id === 'hero') seen[i].pets.push(event.pet);
    if (event.type === 'feed:added' && event.entry.kind === 'cleared') seen[i].feed.push(event.entry);
  }));
  state = await act(hero, { direction: 'd', revision: state.revision });
  let finalTurn: Promise<any[]> | undefined;
  for (let turn = 0; state.battle?.playback?.status === 'active'; turn++) {
    if (turn > 200) throw new Error('The Slime King battle did not finish.');
    const battle = state.battle.playback, actor = battle.actor;
    const skill = battle.attacks[actor].filter((move: any) => move.mpCost <= battle.mp[actor])
      .sort((a: any, b: any) => b.damage - a.damage || a.mpCost - b.mpCost)[0];
    // Listen before each move; the winning one must reach both windows in time.
    finalTurn = Promise.all(windows.map(ws => next(ws, event => event.type === 'feed:added' && event.entry.kind === 'cleared')));
    finalTurn.catch(() => {}); // only the winning turn's wait is checked
    state =await act(hero, { action: 'battle-skill', battleId: state.battle.id, turnRevision: battle.revision, ability: skill.id });
  }
  expect(state.battle).toMatchObject({ won: true, enemyId: 'slime-king', cleared: { money: 150, clears: 1 } });
  const news = await finalTurn!;
  for (const event of news) expect(event.entry).toMatchObject({ kind: 'cleared', pet: 'hero', team: ['hero'] });
  // Each window saw the paid pet, with its crown, before the announcement.
  for (const view of seen) {
    expect(view.pets.at(-1)).toMatchObject({ money: 150, woodlandClears: 1 });
    expect(view.feed).toHaveLength(1);
  }
  // Acknowledging the win and rereading never pay again.
  await act(hero, { action: 'continue', battleId: state.battle.id, revision: state.revision });
  const me = await (await fetch(new URL('/api/me', baseUrl), { headers: { cookie: hero } })).json();
  expect(me).toMatchObject({ money: 150, woodlandClears: 1 });
  expect(Object.values(me.coins).reduce((sum: number, n: any) => sum + n, 0)).toBe(1);
  const feed = await (await fetch(new URL('/api/feed?limit=15', baseUrl))).json();
  expect(feed.filter((item: any) => item.kind === 'cleared')).toHaveLength(1);
  expect(alive(), stderr).toBe(true);
});
