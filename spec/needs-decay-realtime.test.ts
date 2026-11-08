import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// A private server with NEEDS_DECAY on, since the shared app keeps it off as
// production does. Real time can't be hurried, so the test winds a pet's
// needs_at back in the private database, as if its owner had been away.
const HOUR = 60 * 60 * 1000;
const password = 'needs-decay-password';
let child: ChildProcess | undefined;
let dataDir: string;
let baseUrl: string;
let stdout = '';
let stderr = '';
const sockets = new Set<WebSocket>();
const alive = () => child!.exitCode === null && child!.signalCode === null;

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
function next(socket: WebSocket, matches: (event: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no matching event within 1s')), 1000);
    const listener = (data: Buffer) => {
      const event = JSON.parse(String(data));
      if (!matches(event)) return;
      clearTimeout(timer); socket.off('message', listener); resolve(event);
    };
    socket.on('message', listener);
  });
}
const pet = async (id: string) => (await fetch(new URL(`/api/pets/${id}`, baseUrl))).json();
// Winds the pet's away clock back, as if its owner had left that long ago.
function awayFor(id: string, ms: number): void {
  // Wait out the server's own write if a connection just made one.
  const other = new DatabaseSync(join(dataDir, 'virtuepets.db'), { timeout: 2000 });
  try { other.prepare('UPDATE pets SET needs_at = ? WHERE id = ?').run(Date.now() - ms, id); }
  finally { other.close(); }
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'virtuepets-needs-rt-'));
  child = spawn(process.execPath, ['src/server.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, TIME_SCALE: '36000', NEEDS_DECAY: 'on' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', chunk => { stdout += String(chunk); });
  child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const address = () => {
    if (!alive()) throw new Error(`needs-decay server exited: ${stderr}`);
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

it('publishes the decay rules: on here, 2 points an hour to a floor of 30', async () => {
  const rules = await (await fetch(new URL('/api/rules', baseUrl))).json();
  expect(rules.needsDecay).toEqual({ enabled: true, perHour: { stamina: 2, hygiene: 2 }, floor: { stamina: 30, hygiene: 30 } });
});

it("pet:updated — a returning owner's pet, hungrier and grubbier for the time away, reaches every open window within 1s", async () => {
  const owner = await signUp('returning-owner');
  const watcher = await signUp('watching-neighbour');
  // Signing up opened no socket, so the owner's away. Their clock starts on first connecting.
  const first = await connect(owner);
  first.close();
  await once(first, 'close');
  await vi.waitFor(async () => expect((await pet('returning-owner')).stamina).toBe(100));
  awayFor('returning-owner', 10 * HOUR);
  const watching = await connect(watcher);
  const anonymous = await connect();
  const arriving = [watching, anonymous].map(ws => next(ws, event => event.type === 'pet:updated' && event.pet.id === 'returning-owner'));
  await connect(owner);
  for (const event of await Promise.all(arriving)) expect(event.pet).toMatchObject({ stamina: 80, hygiene: 80 });
  // Saved, and not taken again while they stay.
  expect(await pet('returning-owner')).toMatchObject({ stamina: 80, hygiene: 80 });
  expect(stderr).toBe('');
});

it("costs a pet nothing while its owner stays connected", async () => {
  const owner = await signUp('stays-online');
  await connect(owner);
  // Even an old away clock is forgotten once they're here: online time is free.
  awayFor('stays-online', 10 * HOUR);
  const cookie = owner;
  const res = await fetch(new URL('/api/pets/stays-online/appearance', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ color: '#112233', appearance: 'bird' }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ stamina: 100, hygiene: 100 });
});
