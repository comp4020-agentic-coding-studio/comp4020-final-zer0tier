import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

// A private server with its own database, so the test can hold that file's
// write lock (as a backup or a slow writer might) without disturbing the app
// the rest of the spec runs against.
const password = 'resilience-password';
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
async function world(cookie: string): Promise<any> {
  const response = await fetch(new URL('/api/world', baseUrl), { headers: { cookie } });
  expect(response.status).toBe(200);
  return response.json();
}
// Holds the database's write lock, as another writer would, until released.
function lockDatabase(): () => void {
  const other = new DatabaseSync(join(dataDir, 'virtuepets.db'));
  other.exec('BEGIN IMMEDIATE');
  return () => { other.exec('ROLLBACK'); other.close(); };
}
const alive = () => child!.exitCode === null && child!.signalCode === null;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'virtuepets-resilience-'));
  child = spawn(process.execPath, ['src/server.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, TIME_SCALE: '36000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', chunk => { stdout += String(chunk); });
  child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const address = () => {
    if (!alive()) throw new Error(`resilience server exited: ${stderr}`);
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

it('keeps serving when the database is locked as a player connects or disconnects, and stops their walking afterwards', async () => {
  const walker = await signUp('walker'), watcher = await signUp('watcher');
  const watching = await connect(watcher);
  const first = await connect(walker);
  // Save the walker mid-stride, so connecting and leaving both have to write.
  const saved = (await world(walker)).players.find((p: any) => p.id === 'walker');
  const moved = await fetch(new URL('/api/world', baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: walker },
    body: JSON.stringify({ ...saved, x: 520, facing: 'right', moving: true }),
  });
  expect(moved.status).toBe(200);

  // Leaving while the database is locked must not crash the server.
  let release = lockDatabase();
  const gone = once(first, 'close');
  first.close();
  await gone;
  await new Promise(resolve => setTimeout(resolve, 100));
  release();
  expect(alive(), stderr).toBe(true);

  // Neither must connecting again while it is locked.
  release = lockDatabase();
  const second = await connect(walker);
  await new Promise(resolve => setTimeout(resolve, 100));
  release();
  expect(alive(), stderr).toBe(true);
  expect((await fetch(baseUrl)).status).toBe(200);

  // Once the lock clears, presence catches up: the walker is online again and
  // the saved stride from the missed disconnect is stopped, not left walking.
  await vi.waitFor(async () => {
    const snapshot = await world(watcher);
    expect(snapshot.online).toEqual(expect.arrayContaining(['walker', 'watcher']));
    expect(snapshot.players.find((p: any) => p.id === 'walker')).toMatchObject({ x: 520, moving: false });
  }, { timeout: 2000 });
  // The skipped write is reported rather than silently lost.
  expect(stderr).toMatch(/database is locked/);
  second.terminate();
  watching.terminate();
});

it('pet:updated still announces a lesson that ends while the database is locked, without stopping the server', async () => {
  const student = await signUp('student');
  const ws = await connect(student);
  const finished = new Promise<any>(resolve => ws.on('message', data => {
    const event = JSON.parse(String(data));
    if (event.type === 'pet:updated' && event.pet.id === 'student' && event.pet.activity === 'idle' && event.pet.credits > 0) resolve(event.pet);
  }));
  const started = await fetch(new URL('/api/pets/student/study/math', baseUrl), { method: 'POST', headers: { cookie: student } });
  expect(started.status).toBe(200);
  expect((await started.json()).activity).toBe('studying');
  // On the fast clock the 30-minute lesson ends 50 ms in, while this lock is held.
  const release = lockDatabase();
  await new Promise(resolve => setTimeout(resolve, 300));
  release();
  expect(alive(), stderr).toBe(true);
  // The timer retries once the lock clears, and the finish reaches the socket.
  const pet = await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error('no finished lesson within 2.5s')), 2500))]);
  expect(pet).toMatchObject({ id: 'student', activity: 'idle', credits: 1, intelligence: 6 });
  expect(stderr).toMatch(/could not settle a finished activity/);
  ws.terminate();
});
