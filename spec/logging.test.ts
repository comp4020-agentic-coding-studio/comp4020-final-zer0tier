import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

type Log = Record<string, string>;
const password = "logging-private-password";
const querySecret = "private-query-value";
const bodySecret = "private-body-value";
const cookies = new Map<string, string>();
const sockets = new Set<WebSocket>();
let child: ChildProcess | undefined;
let dataDir: string;
let baseUrl: string;
let stdout = "";
let stderr = "";

function logs(): Log[] {
  return stdout.split("\n").filter((line) => line.startsWith("event = ")).map((line) =>
    Object.fromEntries([...line.matchAll(/(\w+) = ("(?:\\.|[^"\\])*"|\S+)/g)].map(([, key, value]) =>
      [key, value.startsWith('"') ? JSON.parse(value) : value])),
  );
}

async function logged(fields: Log, since = 0): Promise<Log> {
  const find = () => logs().slice(since).find((entry) =>
    Object.entries(fields).every(([key, value]) => entry[key] === value));
  await expect.poll(find, { timeout: 2000 }).toBeDefined();
  return find()!;
}

async function post(path: string, body: unknown, user?: string): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { cookie: cookies.get(user)! } : {}) },
    body: JSON.stringify(body),
  });
}

async function open(user?: string): Promise<WebSocket> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws?user=log-spoof`, {
    headers: { cookie: user ? cookies.get(user)! : "session=invalid-session-token", "x-user-id": "log-spoof" },
  });
  sockets.add(ws);
  ws.once("close", () => sockets.delete(ws));
  await once(ws, "open");
  return ws;
}

async function close(ws: WebSocket, abruptly = false): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = once(ws, "close");
  if (abruptly) ws.terminate();
  else ws.close();
  await closed;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "virtuepets-logging-"));
  child = spawn(process.execPath, ["src/server.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: "0", DATA_DIR: dataDir, TIME_SCALE: "36000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const address = () => {
    if (child!.exitCode !== null) throw new Error(`logging server exited: ${stderr}`);
    return stdout.match(/VirtuePets listening on http:\/\/0\.0\.0\.0:(\d+)/)?.[1];
  };
  await vi.waitFor(() => expect(address()).toBeDefined(), { timeout: 5000 });
  expect(Number(address())).toBeGreaterThan(0);
  baseUrl = `http://127.0.0.1:${address()}`;
  for (const id of ["log-alpha", "log-beta"]) {
    const response = await post("/api/signup", { id, password });
    expect(response.status).toBe(201);
    cookies.set(id, response.headers.getSetCookie().find((cookie) => cookie.startsWith("session="))!.split(";")[0]);
    await response.json();
  }
});

afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const force = setTimeout(() => child!.kill("SIGKILL"), 2000);
    try { await exited; } finally { clearTimeout(force); }
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it("logs authenticated and guest joins and leaves with stable connection IDs and remaining room counts", async () => {
  for (const id of ["log-alpha", "log-beta"]) {
    const snapshot = await logged({ event: "snapshot", user: id, action: "/api/signup", status: "201" });
    expect(await logged({ event: "action", request: snapshot.request })).toMatchObject({ user: "anonymous" });
  }
  const signedIn = await post("/api/signin", { id: "log-alpha", password });
  expect(signedIn.status).toBe(200);
  await signedIn.json();
  const signin = await logged({ event: "snapshot", user: "log-alpha", action: "/api/signin", status: "200" });
  expect(await logged({ event: "action", request: signin.request })).toMatchObject({ user: "anonymous" });

  const since = logs().length;
  const first = await open("log-alpha");
  const second = await open("log-beta");
  try {
    const a = await logged({ event: "join", user: "log-alpha", room: "arena", client_in_room: "1" }, since);
    const b = await logged({ event: "join", user: "log-beta", room: "arena", client_in_room: "2" }, since);
    expect(a.connection).toMatch(/^c_[\da-f-]+$/);
    expect(b.connection).not.toBe(a.connection);
    await close(first);
    await logged({ event: "leave", user: "log-alpha", connection: a.connection, room: "arena", client_in_room: "1" }, since);
    await close(second, true);
    await logged({ event: "leave", user: "log-beta", connection: b.connection, room: "arena", client_in_room: "0" }, since);
    expect(logs().slice(since).filter((entry) => entry.event === "leave")).toHaveLength(2);
  } finally {
    await close(first, true);
    await close(second, true);
  }

  const guestSince = logs().length;
  const guest = await open();
  try {
    const joined = await logged({ event: "join", room: "arena", client_in_room: "1" }, guestSince);
    expect(joined.user).toMatch(/^guest_[\da-f-]+$/);
    await close(guest);
    await logged({ event: "leave", user: joined.user, connection: joined.connection, client_in_room: "0" }, guestSince);
  } finally { await close(guest, true); }
});

it("logs accepted actions, pet:updated broadcasts to both sockets, and HTTP snapshots to one requester", async () => {
  const windows = [await open("log-alpha"), await open("log-beta")];
  const messages: { type: string; pet?: { id: string } }[][] = [[], []];
  windows.forEach((ws, index) => ws.on("message", (data) => messages[index].push(JSON.parse(String(data)))));
  try {
    const since = logs().length;
    const action = "/api/pets/log-alpha/appearance";
    const response = await post(`${action}?password=${querySecret}`, {
      color: "#12abef", appearance: "dragon", user: "log-beta", password: bodySecret,
    }, "log-alpha");
    expect(response.status).toBe(200);
    const saved = await response.json();
    await expect.poll(() => messages.every((received) =>
      received.some((event) => event.type === "pet:updated" && event.pet?.id === "log-alpha")), { timeout: 1000 }).toBe(true);
    for (const received of messages) {
      expect(received.find((event) => event.type === "pet:updated" && event.pet?.id === "log-alpha")?.pet).toEqual(saved);
    }
    const receipt = await logged({ event: "action", user: "log-alpha", room: "arena", client_in_room: "2", action, method: "POST" }, since);
    expect(receipt.request).toMatch(/^req_[\da-f-]+$/);
    await logged({ event: "broadcast", user: "server", room: "arena", client_in_room: "2", message: "pet:updated", recipients: "2" }, since);
    await logged({ event: "snapshot", user: "log-alpha", request: receipt.request, status: "200", recipients: "1", transport: "http" }, since);

    const beforeGet = logs().length;
    const messageCounts = messages.map((received) => received.length);
    const snapshot = await fetch(`${baseUrl}/api/pets/log-beta?password=${querySecret}`, { headers: { cookie: cookies.get("log-alpha")! } });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ id: "log-beta" });
    await logged({ event: "snapshot", user: "log-alpha", action: "/api/pets/log-beta", method: "GET", status: "200", recipients: "1", transport: "http", client_in_room: "2" }, beforeGet);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(messages.map((received) => received.length)).toEqual(messageCounts);
    expect(logs().slice(beforeGet).map((entry) => entry.event)).toEqual(["snapshot"]);
  } finally {
    const beforeClose = logs().length;
    await Promise.all(windows.map((ws) => close(ws, true)));
    await logged({ event: "leave", client_in_room: "0" }, beforeClose);
  }
});

it("logs authentication, ownership, gameplay, parser and unknown-route rejections without leaking credentials or bodies", async () => {
  const cases = [
    { path: "/api/pets/log-alpha/buy/food", status: 401, user: undefined, reason: "Sign in first." },
    { path: "/api/pets/log-beta/buy/food", status: 403, user: "log-alpha", reason: "That's not your pet." },
    { path: "/api/pets/log-alpha/buy/food", status: 409, user: "log-alpha", reason: "Not enough money: food costs $15." },
    { path: "/api/signin", status: 400, user: "log-alpha", reason: "Bad Request", malformed: true },
    { path: "/api/no-such-route", status: 404, user: "log-alpha", reason: "Not Found" },
    { path: "/API/pets/log-beta/buy/food", status: 403, user: "log-alpha", reason: "That's not your pet." },
  ];
  const requests = new Set<string>();
  for (const test of cases) {
    const since = logs().length;
    const response = await fetch(`${baseUrl}${test.path}?user=log-beta&password=${querySecret}`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-user-id": "log-beta",
        ...(test.user ? { cookie: cookies.get(test.user)! } : {}),
      },
      body: test.malformed ? `{"password":"${bodySecret}",` : JSON.stringify({ user: "log-beta", password: bodySecret }),
    });
    expect(response.status).toBe(test.status);
    await response.text();
    const receipt = await logged({ event: "action", user: test.user ?? "anonymous", action: test.path, method: "POST" }, since);
    expect(requests.has(receipt.request)).toBe(false);
    requests.add(receipt.request);
    await logged({ event: "reject", user: test.user ?? "anonymous", action: test.path, request: receipt.request, status: String(test.status), reason: test.reason }, since);
    expect(logs().slice(since).map((entry) => entry.event)).toEqual(["action", "reject"]);
  }
  const output = stdout + stderr;
  for (const secret of [password, querySecret, bodySecret, "invalid-session-token", ...[...cookies.values()].map((cookie) => cookie.slice("session=".length))]) {
    expect(output).not.toContain(secret);
  }
  expect(output).not.toContain("log-spoof");
});

it("logs an action_result naming who did what for sign-in, fights, theft, revenge, lessons, shifts and team changes", async () => {
  const alice = `log-alice-${Date.now().toString(36)}`;
  const bob = `log-bob-${Date.now().toString(36)}`;
  const since = logs().length;
  const signedUp = await post("/api/signup", { id: alice, password });
  expect(signedUp.status).toBe(201);
  await signedUp.json();
  cookies.set(alice, signedUp.headers.getSetCookie().find((cookie) => cookie.startsWith("session="))!.split(";")[0]);
  await logged({ event: "action_result", user: alice, action: "signup", created: "true" }, since);

  const signedIn = await post("/api/signin", { id: alice, password });
  expect(signedIn.status).toBe(200);
  await signedIn.json();
  await logged({ event: "action_result", user: alice, action: "signin", created: "false" }, since);

  const bobUp = await post("/api/signup", { id: bob, password });
  expect(bobUp.status).toBe(201);
  await bobUp.json();
  cookies.set(bob, bobUp.headers.getSetCookie().find((cookie) => cookie.startsWith("session="))!.split(";")[0]);

  // Alice studies, then works, so her finished lesson and shift both log.
  // A two-hour shift funds Bob's double-theft reward for every theft amount,
  // even if Alice loses money in the fight below.
  const studySince = logs().length;
  const studied = await post(`/api/pets/${alice}/study/math`, undefined, alice);
  expect(studied.status).toBe(200);
  await studied.json();
  await logged({ event: "action_result", user: alice, action: "studying_finished", task: "Math" }, studySince);

  const aliceWorkSince = logs().length;
  const aliceWorked = await post(`/api/pets/${alice}/work/office`, { minutes: 120 }, alice);
  expect(aliceWorked.status).toBe(200);
  await aliceWorked.json();
  await logged({ event: "action_result", user: alice, action: "working_finished", task: "Office" }, aliceWorkSince);

  const bobWorkSince = logs().length;
  const bobWorked = await post(`/api/pets/${bob}/work/construction`, { minutes: 60 }, bob);
  expect(bobWorked.status).toBe(200);
  await bobWorked.json();
  await logged({ event: "action_result", user: bob, action: "working_finished", task: "Construction site" }, bobWorkSince);

  const fightSince = logs().length;
  const fought = await post(`/api/pets/${alice}/fight/${bob}`, undefined, alice);
  expect(fought.status).toBe(200);
  const fightResult = await fought.json();
  await logged({ event: "action_result", user: alice, action: "fight", opponent: bob, winner: fightResult.fight.winner }, fightSince);

  const stealSince = logs().length;
  const stole = await post(`/api/pets/${alice}/steal/${bob}`, undefined, alice);
  expect(stole.status).toBe(200);
  const stealResult = await stole.json();
  await logged({ event: "action_result", user: alice, action: "steal", victim: bob, amount: String(stealResult.amount) }, stealSince);

  const theft = (await (await fetch(`${baseUrl}/api/thefts`, { headers: { cookie: cookies.get(bob)! } })).json())[0];
  const revengeSince = logs().length;
  const avenged = await post(`/api/pets/${bob}/revenge/${theft.id}`, undefined, bob);
  expect(avenged.status).toBe(200);
  const revengeResult = await avenged.json();
  await logged({ event: "action_result", user: bob, action: "revenge", thief: alice, won: String(revengeResult.won) }, revengeSince);

  const teamSince = logs().length;
  const invited = await post("/api/team", { action: "invite", player: bob }, alice);
  expect(invited.status).toBe(200);
  const team = await invited.json();
  await logged({ event: "action_result", user: alice, action: "team_invite", team: String(team.team.id), player: bob }, teamSince);

  const accepted = await post("/api/team", { action: "accept", team: team.team.id }, bob);
  expect(accepted.status).toBe(200);
  await accepted.json();
  await logged({ event: "action_result", user: bob, action: "team_accept", team: String(team.team.id) }, teamSince);

  const left = await post("/api/team", { action: "leave", team: team.team.id }, bob);
  expect(left.status).toBe(200);
  await left.json();
  await logged({ event: "action_result", user: bob, action: "team_leave", team: String(team.team.id) }, teamSince);
});
