#!/usr/bin/env node
// A crowd walking around town at once, as at the capstone showcase. Each
// player signs up, opens the live connection a browser would, and walks the
// way public/world.js does: one save in flight, at most one every 50 ms. It
// reports how long saves take, how long each step takes to reach every other
// player (the README promises within a second), and what the server spent.
//
//   node scripts/load-test.ts [--players 10,30,50] [--seconds 20] [--url URL]
//
// Without --url it starts its own server on a throwaway database, pinned to
// one CPU core (the Fly machine has one shared core), so neither the spec's
// database nor the deployed game is touched. --url aims it at a server you
// started yourself instead, and signs up real accounts there, all named
// `loadtest-<run>-<n>` so they can be found and removed afterwards.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

const { values: args } = parseArgs({
  options: {
    players: { type: 'string', default: '10,30,50' },
    seconds: { type: 'string', default: '20' },
    url: { type: 'string' },
  },
});
const stages = args.players.split(',').map(Number);
const seconds = Number(args.seconds);
if (!stages.every(n => Number.isInteger(n) && n > 1) || !(seconds > 0)) {
  console.error('usage: node scripts/load-test.ts [--players 10,30,50] [--seconds 20] [--url URL]');
  process.exit(2);
}

// Matches public/world.js (send interval, walk speed) and src/world.ts (town bounds).
const MOVE_INTERVAL_MS = 50;
const STEP = 190 * MOVE_INTERVAL_MS / 1000;
const TOWN = { left: 44, top: 30, right: 870, bottom: 614 };
const PASSWORD = 'load-test-password';
const PROMISE_MS = 1000;

interface Player { id: string; cookie: string; socket?: WebSocket; revision: number; x: number; y: number; heading: number }

// ---- the server under test -------------------------------------------------

let child: ChildProcess | undefined;
let dataDir: string | undefined;
let logBytes = 0;
let logLines = 0;
let serverErrors = '';

async function startServer(): Promise<string> {
  dataDir = await mkdtemp(join(tmpdir(), 'virtuepets-load-'));
  const node = [process.execPath, 'src/server.ts'];
  const [command, ...rest] = process.platform === 'linux' ? ['taskset', '-c', '0', ...node] : node;
  child = spawn(command, rest, {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', chunk => { serverErrors += String(chunk); });
  const port = await new Promise<string>((resolve, reject) => {
    let head: string | null = '';
    child!.stdout!.on('data', (chunk: Buffer) => {
      // The server logs every action and broadcast; count it, as Fly would ship it.
      logBytes += chunk.length;
      for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, i + 1)) logLines++;
      if (head === null) return;
      head += String(chunk);
      const found = head.match(/VirtuePets listening on http:\/\/0\.0\.0\.0:(\d+)/)?.[1];
      if (found) { head = null; resolve(found); }
    });
    child!.once('exit', code => reject(new Error(`server exited (${code}): ${serverErrors}`)));
  });
  return `http://127.0.0.1:${port}`;
}

async function stopServer(): Promise<void> {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child!.once('exit', resolve));
    child.kill('SIGTERM');
    const force = setTimeout(() => child!.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(force);
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}

// Memory and CPU time of the private server, from /proc (Linux only).
function sampleServer(): { rssMb: number; cpuSeconds: number } | undefined {
  if (!child?.pid || process.platform !== 'linux') return undefined;
  try {
    const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
    const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {
      rssMb: Number(status.match(/VmRSS:\s+(\d+)/)![1]) / 1024,
      cpuSeconds: (Number(fields[11]) + Number(fields[12])) / 100,
    };
  } catch {
    return undefined;
  }
}

// ---- players -----------------------------------------------------------------

async function signUp(base: string, id: string): Promise<Player> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(new URL('/api/signup', base), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, password: PASSWORD }),
    });
    // Sign-ups queue behind a bounded password-hashing pool and may ask us to wait.
    if (response.status === 503 && attempt < 20) { await sleep(250); continue; }
    if (response.status !== 201) throw new Error(`sign-up ${id}: ${response.status} ${await response.text()}`);
    const cookie = response.headers.getSetCookie().find(c => c.startsWith('session='))!.split(';')[0];
    return { id, cookie, revision: 0, x: 480, y: 585, heading: Math.random() * 2 * Math.PI };
  }
}

async function request(base: string, player: Player, method: string, body?: unknown): Promise<Response> {
  return fetch(new URL('/api/world', base), {
    method,
    headers: { cookie: player.cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// The next step of a wandering walk that turns back at the town's edges.
function step(player: Player): { x: number; y: number; facing: string } {
  player.heading += (Math.random() - 0.5) * 0.6;
  let x = player.x + Math.cos(player.heading) * STEP, y = player.y + Math.sin(player.heading) * STEP;
  if (x < TOWN.left || x > TOWN.right || y < TOWN.top || y > TOWN.bottom) {
    player.heading += Math.PI;
    x = Math.min(TOWN.right, Math.max(TOWN.left, x));
    y = Math.min(TOWN.bottom, Math.max(TOWN.top, y));
  }
  const dx = x - player.x, dy = y - player.y;
  player.x = x; player.y = y;
  return { x, y, facing: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up') };
}

// ---- one stage: n players connected and walking at once ------------------------

interface Stage {
  players: number; moves: number; refused: Map<number, number>; saves: number[];
  delays: number[]; expected: number; idleRssMb?: number; peakRssMb?: number; cpu?: number;
  logLinesPerSecond: number; logKbPerSecond: number; generatorLagMs: number;
}

async function runStage(base: string, players: Player[]): Promise<Stage> {
  const sent = new Map<string, number>(); // `${id}:${revision}` -> when that move was sent
  const delays: number[] = [];
  const saves: number[] = [];
  const refused = new Map<number, number>();
  let moves = 0;

  for (const player of players) {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, { headers: { cookie: player.cookie } });
    socket.on('message', data => {
      const at = performance.now();
      const event = JSON.parse(String(data));
      if (event.type !== 'world:updated' || event.player.id === player.id) return;
      const started = sent.get(`${event.player.id}:${event.player.revision}`);
      if (started !== undefined) delays.push(at - started);
    });
    player.socket = socket;
  }
  await Promise.all(players.map(p => new Promise((resolve, reject) => {
    p.socket!.once('open', resolve);
    p.socket!.once('error', reject);
  })));

  // Everyone walks out of their front door into town.
  await Promise.all(players.map(async player => {
    const world = await (await request(base, player, 'GET')).json();
    player.revision = world.players.find((p: { id: string }) => p.id === player.id).revision;
    player.x = 480; player.y = 585;
    const entered = await request(base, player, 'POST', {
      scene: 'town', home: null, x: player.x, y: player.y, facing: 'down', moving: false, revision: player.revision,
    });
    if (!entered.ok) throw new Error(`${player.id} could not enter town: ${entered.status} ${await entered.text()}`);
    player.revision = (await entered.json()).revision;
  }));

  const idle = sampleServer();
  const logStart = { bytes: logBytes, lines: logLines };
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let peakRssMb = idle?.rssMb;
  const sampler = setInterval(() => {
    const now = sampleServer();
    if (now && peakRssMb !== undefined) peakRssMb = Math.max(peakRssMb, now.rssMb);
  }, 200);
  const started = performance.now();
  const until = started + seconds * 1000;

  await Promise.all(players.map(async player => {
    while (performance.now() < until) {
      const at = performance.now();
      const { x, y, facing } = step(player);
      const key = `${player.id}:${player.revision + 1}`;
      sent.set(key, at);
      try {
        const response = await request(base, player, 'POST', {
          scene: 'town', home: null, x, y, facing, moving: true, revision: player.revision,
        });
        const body = await response.json();
        if (response.ok) {
          moves++;
          saves.push(performance.now() - at);
          player.revision = body.revision;
        } else {
          sent.delete(key);
          refused.set(response.status, (refused.get(response.status) ?? 0) + 1);
          if (body.player) player.revision = body.player.revision;
        }
      } catch {
        sent.delete(key);
        refused.set(0, (refused.get(0) ?? 0) + 1);
      }
      await sleep(Math.max(0, MOVE_INTERVAL_MS - (performance.now() - at)));
    }
  }));

  const walked = (performance.now() - started) / 1000;
  const busy = sampleServer();
  const logEnd = { bytes: logBytes, lines: logLines };
  // Give the last steps time to arrive before counting what reached everyone.
  await sleep(2000);
  clearInterval(sampler);
  lag.disable();

  await Promise.all(players.map(p => new Promise(resolve => {
    p.socket!.once('close', resolve);
    p.socket!.close();
  })));
  await sleep(500);

  return {
    players: players.length, moves, refused, saves, delays,
    expected: moves * (players.length - 1),
    idleRssMb: idle?.rssMb, peakRssMb,
    cpu: idle && busy ? (busy.cpuSeconds - idle.cpuSeconds) / walked : undefined,
    logLinesPerSecond: (logEnd.lines - logStart.lines) / walked,
    logKbPerSecond: (logEnd.bytes - logStart.bytes) / 1024 / walked,
    generatorLagMs: lag.percentile(99) / 1e6,
  };
}

// ---- report --------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN;
}
const ms = (n: number): string => `${Math.round(n)} ms`;
const count = (n: number): string => n.toLocaleString('en-AU');

function report(stage: Stage): string[] {
  const saves = stage.saves.toSorted((a, b) => a - b);
  const delays = stage.delays.toSorted((a, b) => a - b);
  const late = delays.filter(d => d > PROMISE_MS).length;
  const missing = stage.expected - delays.length;
  const refused = [...stage.refused.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${stage.players} players walking around town for ${seconds} s`);
  console.log(`  moves saved      ${count(stage.moves)} (${(stage.moves / stage.players / seconds).toFixed(1)} per player per second)` +
    (refused ? `, ${count(refused)} refused (${[...stage.refused].map(([s, n]) => `${s || 'network'}: ${n}`).join(', ')})` : ', none refused'));
  console.log(`  save time        p50 ${ms(percentile(saves, 0.5))}  p95 ${ms(percentile(saves, 0.95))}  p99 ${ms(percentile(saves, 0.99))}  max ${ms(saves.at(-1) ?? NaN)}`);
  console.log(`  reached others   ${count(delays.length)} of ${count(stage.expected)} expected`);
  console.log(`  delivery delay   p50 ${ms(percentile(delays, 0.5))}  p95 ${ms(percentile(delays, 0.95))}  p99 ${ms(percentile(delays, 0.99))}  max ${ms(delays.at(-1) ?? NaN)}; ${count(late)} over 1 s`);
  if (stage.cpu !== undefined) console.log(`  server CPU       ${Math.round(stage.cpu * 100)}% of one core`);
  if (stage.peakRssMb !== undefined) console.log(`  server memory    ${Math.round(stage.idleRssMb!)} MB idle, ${Math.round(stage.peakRssMb)} MB peak (machine has 256 MB)`);
  if (child) console.log(`  server log       ${count(Math.round(stage.logLinesPerSecond))} lines/s (${count(Math.round(stage.logKbPerSecond))} KB/s)`);
  console.log(`  load generator   event loop p99 delay ${ms(stage.generatorLagMs)}`);

  const problems: string[] = [];
  if (late) problems.push(`${stage.players} players: ${count(late)} steps (${(late / delays.length * 100).toFixed(1)}%) took over 1 s to reach another player`);
  if (missing > 0) problems.push(`${stage.players} players: ${count(missing)} steps never reached another player`);
  if (refused) problems.push(`${stage.players} players: ${count(refused)} moves were refused`);
  if (stage.peakRssMb !== undefined && stage.peakRssMb > 200) problems.push(`${stage.players} players: server memory peaked at ${Math.round(stage.peakRssMb)} MB`);
  if (stage.generatorLagMs > 100) problems.push(`${stage.players} players: the load generator itself lagged ${ms(stage.generatorLagMs)}, so these delays may be overstated`);
  return problems;
}

// ---- main ----------------------------------------------------------------------

process.once('SIGINT', () => { void stopServer().then(() => process.exit(130)); });

let problems: string[] = [];
try {
  const base = args.url ?? await startServer();
  console.log(`Load testing ${base}${child ? ' (private server on a throwaway database, pinned to one core)' : ''}`);
  const run = Date.now().toString(36);
  const crowd: Player[] = [];
  const most = Math.max(...stages);
  for (let i = 0; i < most; i += 4) {
    crowd.push(...await Promise.all(Array.from({ length: Math.min(4, most - i) }, (_, j) => signUp(base, `loadtest-${run}-${i + j}`))));
  }
  console.log(`Signed up ${crowd.length} players as loadtest-${run}-0 … loadtest-${run}-${crowd.length - 1}`);
  for (const n of stages) problems.push(...report(await runStage(base, crowd.slice(0, n))));
  if (serverErrors.trim()) problems.push(`the server wrote to stderr:\n${serverErrors.trim().slice(0, 2000)}`);
} finally {
  await stopServer();
}

if (problems.length) {
  console.log('\nProblems:');
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nNo problems: every step reached every other player within 1 s.');
}
