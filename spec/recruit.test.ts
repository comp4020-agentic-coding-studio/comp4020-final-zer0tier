import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// Recruiting over real HTTP and WebSockets. It runs its own server and
// database so a test can stand the recruiter beside a monster in tall grass.
const password = 'recruit-password';
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
async function connect(cookie?: string): Promise<WebSocket> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws`, cookie ? { headers: { cookie } } : {});
  sockets.add(ws);
  ws.once('close', () => sockets.delete(ws));
  await once(ws, 'open');
  return ws;
}
async function act(cookie: string | null, body: object): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL('/api/adventure', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function ok(cookie: string, body: object): Promise<any> {
  const { status, body: result } = await act(cookie, body);
  if (status !== 200) throw new Error(result.error);
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
// Enters a fresh solo run and stands just left of a guaranteed grass encounter.
async function readyRun(id: string, cookie: string, strength: number) {
  await ok(cookie, { action: 'enter', entryId: `${id}-entry`, revision: (await ok(cookie, {})).revision });
  const db = new DatabaseSync(join(dataDir, 'virtuepets.db'));
  try {
    db.prepare('UPDATE pets SET strength = ? WHERE id = ?').run(strength, id);
    const world = JSON.parse((db.prepare('SELECT world_json FROM adventures WHERE player_id = ?').get(id) as { world_json: string }).world_json);
    world[0].encounter = { seed: 1, steps: 5 };
    world[0].grass[2] = world[0].grass[2].slice(0, 5) + 'g' + world[0].grass[2].slice(6);
    db.prepare('UPDATE adventures SET x = 4, y = 2, world_json = ? WHERE player_id = ?').run(JSON.stringify(world), id);
  } finally { db.close(); }
}
const alive = () => child!.exitCode === null && child!.signalCode === null;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'virtuepets-recruit-http-'));
  child = spawn(process.execPath, ['src/server.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, TIME_SCALE: '36000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', chunk => { stdout += String(chunk); });
  child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const address = () => {
    if (!alive()) throw new Error(`recruit server exited: ${stderr}`);
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

it('recruits only offline friends, validates the ID, and needs a signed-in recruiter', async () => {
  const me = await signUp('leader'), online = await signUp('online-pal');
  await signUp('offline-pal');
  await readyRun('leader', me, 5);
  const revision = (await ok(me, {})).revision;
  expect((await act(null, { action: 'recruit', friend: 'offline-pal', revision })).status).toBe(401);
  expect((await act(me, { action: 'recruit', friend: 'bad id!', revision })).status).toBe(404);
  // Someone playing right now is invited to the team instead.
  await connect(online);
  await vi.waitFor(async () => {
    const refused = await act(me, { action: 'recruit', friend: 'online-pal', revision });
    expect(refused).toEqual({ status: 409, body: { error: 'online-pal is online. Invite them to your team so they can play themselves.' } });
  });
  const recruited = await ok(me, { action: 'recruit', friend: 'offline-pal', revision });
  expect(recruited.ally).toMatchObject({ id: 'offline-pal', away: null, earned: 0 });
  // Sending it home empties the slot.
  expect((await ok(me, { action: 'dismiss-ally', revision: recruited.revision })).ally).toBeNull();
});

it('pet:updated — an ally\'s pay for a win reaches its offline owner\'s other windows and the recruiter within 1s', async () => {
  const me = await signUp('captain');
  await signUp('helper-pal');
  await readyRun('captain', me, 60);
  let state = await ok(me, { action: 'recruit', friend: 'helper-pal', revision: (await ok(me, {})).revision });
  // The pal is offline: only a signed-out window (anyone watching the Arena) and the recruiter listen.
  const windows = [await connect(me), await connect()];
  const paid = windows.map(ws => next(ws, event => event.type === 'pet:updated' && event.pet.id === 'helper-pal' && event.pet.money === 2));
  paid.forEach(p => p.catch(() => {}));
  // Step into the grass encounter, then take my turns until the slime falls.
  state = await ok(me, { direction: 'd', revision: state.revision });
  for (let turn = 0; state.battle?.playback?.status === 'active'; turn++) {
    if (turn > 50) throw new Error('battle did not finish');
    const battle = state.battle.playback;
    state = await ok(me, { action: 'battle-skill', battleId: state.battle.id, turnRevision: battle.revision, ability: 'claw-strike' });
  }
  expect(state.battle).toMatchObject({ won: true, allyPay: { ally: 'helper-pal', money: 2 } });
  for (const event of await Promise.all(paid)) expect(event.pet).toMatchObject({ id: 'helper-pal', money: 2 });
  expect(alive(), stderr).toBe(true);
});
