import {
  abandonAdventure, adventureFor, changeFloor, continueAdventure, enterAdventure, leaveAdventure, moveAdventure, openAdventureChest, patrolAdventure,
  restartAdventure, skipAdventureCooldown, useAdventureItem, adventureBattleSkill, forfeitAdventureBattle,
} from "./adventure.ts";
import { accept, invite, leave, setOff, teamFor, type TeamOutcome } from "./teams.ts";
import express from "express";
import { ABILITIES, MONSTER_TYPES, TYPE_CHART } from "./combat.ts";
import { COINS, TREASURE_RATES } from './treasure.ts';
import { readFileSync } from "node:fs";
import { createServer, STATUS_CODES } from "node:http";
import { marked } from "marked";
import {
  COURSES, ITEMS, LOCATIONS, MAX_CARE, SCHOOLS, SHIFT_MINUTES, STUDY_COST, STUDY_MINUTES, STUDY_NEEDS,
  WORK_COST_PER_HOUR, buy, findCourse, findItem, findLocation, getOrCreatePet, getPet, isShiftLength, isValidId,
  matchBot, study, upgrade, use, work, BOT_ID, FIGHT_COOLDOWN_MINUTES, FIGHT_COST, FIGHT_NEEDS, LUCK, POWER_WEIGHTS,
  SPOILS, LEADERBOARD_ORDERS, LEADERBOARD_SIZE, fight, isLeaderboardOrder, leaderboard, listPets, recentFights,
  APPEARANCES, isAppearance, setAppearance, STEAL, steal, help, theftsFor, revenge, equipCoin, FREE_SUPPLIES, collectSupplies,
  ADVENTURE_COST, ADVENTURE_COOLDOWN_MINUTES, equipSkills, battleSessionsFor, battleSessionFor, actInBattle, type BattleSessionOutcome, type Outcome,
} from "./pets.ts";
import {
  Busy, PASSWORD, type AuthOutcome, clearedCookie, isValidPassword, playerFor, sessionCookie, sessionToken, signIn,
  signOut, signUp,
} from "./auth.ts";
import { TIME_SCALE } from "./clock.ts";
import { recentFeed } from "./feed.ts";
import { followUp } from "./followups.ts";
import { attachRealtime, broadcast, cancelStop, clientsInRoom, isOnline, refreshPresence } from "./realtime.ts";
import { moveWorld, worldPosition } from './world.ts';
import { logEvent, ROOM } from "./logging.ts";
import { logRequest } from "./request-logging.ts";
import { schedule, scheduleAll } from "./scheduler.ts";
import { TOUCH_KINDS, isTouchKind, touch, touchesOn } from "./touches.ts";

const app = express();
app.use((req, res, next) => {
  if (/^\/api(?:\/|$)/i.test(req.path)) return logRequest(req, res, next);
  next();
});
app.use(express.json());
// Parser errors can contain the raw request body. Return a safe reason so a
// malformed password submission cannot spill into Express's default error log.
app.use(((err, _req, res, next) => {
  if (err?.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: STATUS_CODES[err.status] ?? "Invalid request body" });
    return;
  }
  next(err);
}) as express.ErrorRequestHandler);

// Rendered on each request so the page never lags behind README.md.
app.get("/readme/", (_req, res) => {
  const body = marked.parse(readFileSync("README.md", "utf8"), { async: false });
  res.type("html").send(`<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VirtuePets — README</title>
  </head>
  <body><main>${body}</main></body>
</html>`);
});

// On Fly, its proxy names the real client in Fly-Client-IP (and overwrites
// any the client sent). Anywhere else that header could be forged, so the
// socket's peer is the client.
const onFly = process.env.FLY_APP_NAME !== undefined;
const clientAddress = (req: express.Request): string =>
  (onFly ? req.get("fly-client-ip") : undefined) ?? req.socket.remoteAddress ?? "unknown";

// Sign up and sign in both take { id, password } and start a session.
async function authenticate(
  req: express.Request,
  res: express.Response,
  how: (id: string, password: string, address: string) => Promise<AuthOutcome>,
  okStatus: number,
  action: "signup" | "signin",
): Promise<void> {
  const { id, password } = req.body ?? {};
  if (!isValidId(id)) {
    res.status(400).json({ error: "Player ID must be 1–32 letters, digits, - or _." });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: `Password must be ${PASSWORD.min}–${PASSWORD.max} characters.` });
    return;
  }
  let outcome: AuthOutcome;
  try {
    outcome = await how(id, password, clientAddress(req));
  } catch (err) {
    if (!(err instanceof Busy)) throw err;
    res.status(503).json({ error: "Lots of people are signing in right now. Try again in a moment." });
    return;
  }
  if ("error" in outcome) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  res.locals.logUser = outcome.pet.id;
  logEvent("action_result", {
    user: outcome.pet.id, room: ROOM, client_in_room: clientsInRoom(), action, created: outcome.created,
  });
  // A new pet joins every open arena.
  if (outcome.created) broadcast({ type: "pet:updated", pet: outcome.pet });
  followUp();
  res.setHeader("Set-Cookie", sessionCookie(outcome.token));
  res.status(okStatus).json(outcome.pet);
}

app.post("/api/signup", (req, res) => authenticate(req, res, signUp, 201, "signup"));
app.post("/api/signin", (req, res) => authenticate(req, res, signIn, 200, "signin"));

app.post("/api/signout", (req, res) => {
  const token = sessionToken(req.headers.cookie);
  if (token) signOut(token);
  refreshPresence();
  res.setHeader("Set-Cookie", clearedCookie());
  res.status(204).end();
});

// The signed-in player's pet, so a returning visitor skips the sign-in form.
app.get("/api/me", (req, res) => {
  const id = playerFor(req.headers.cookie);
  const pet = id ? getPet(id) : undefined;
  if (!pet) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  res.json(pet);
});

app.get('/api/world', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: 'Sign in first.' });
  const online = refreshPresence();
  res.json({ online, players: [...new Set([...online, id])].map(worldPosition) });
});
app.post('/api/world', (req, res) => {
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: 'Sign in first.' });
  const outcome = moveWorld(id, req.body);
  if ('error' in outcome) return void res.status(outcome.status).json(outcome);
  cancelStop(id);
  broadcast({ type: 'world:updated', player: outcome });
  res.json(outcome);
});

// Live battles are private to their participants and survive reconnects.
app.get('/api/battles', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: 'Sign in first.' });
  res.json(battleSessionsFor(id));
});
app.get('/api/battles/:battle', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: 'Sign in first.' });
  const session = battleSessionFor(id, req.params.battle);
  if (!session) return void res.status(404).json({ error: 'No such battle for your pet.' });
  res.json({ session });
});
function announceBattle(outcome: Exclude<BattleSessionOutcome, { error: string }>, finished: boolean, petsChanged = true): void {
  if (petsChanged) {
    broadcast({ type: 'pet:updated', pet: outcome.attacker });
    broadcast({ type: 'pet:updated', pet: outcome.defender });
  }
  broadcast({ type: 'battle:updated', session: outcome.session });
  if (finished && outcome.fight) {
    logEvent('action_result', { user: outcome.attacker.id, room: ROOM, client_in_room: clientsInRoom(),
      action: 'fight', opponent: outcome.defender.id, winner: outcome.fight.winner, spoils: outcome.fight.spoils });
    broadcast({ type: 'fight:finished', fight: outcome.fight });
  }
  if (finished && outcome.session.kind === 'revenge') {
    logEvent('action_result', { user: outcome.attacker.id, room: ROOM, client_in_room: clientsInRoom(),
      action: 'revenge', thief: outcome.defender.id, won: outcome.won ?? false, reward: outcome.reward ?? 0 });
  }
  followUp();
}
app.post('/api/battles/:battle/:action', (req, res) => {
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: 'Sign in first.' });
  const action = req.params.action;
  if (action !== 'turn' && action !== 'forfeit') return void res.status(400).json({ error: 'Unknown battle action.' });
  const before = battleSessionFor(id, req.params.battle);
  const outcome = actInBattle(id, req.params.battle, action, req.body?.ability, req.body?.revision);
  if ('error' in outcome) return void res.status(outcome.status).json({ error: outcome.error });
  const changed = before?.battle.revision !== outcome.session.battle.revision;
  if (changed) announceBattle(outcome, before?.battle.status !== 'finished' && outcome.session.battle.status === 'finished', outcome.session.battle.status === 'finished');
  res.json(outcome);
});

// Exploration is private, and every accepted step is saved before returning it.
app.post("/api/adventure", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: "Sign in first." });
  if (req.body?.direction !== undefined && req.body?.action !== undefined) {
    return void res.status(400).json({ error: "Choose one adventure action at a time." });
  }
  const inventoryAction = ['open-chest', 'use-item', 'restart', 'enter', 'skip-cooldown'].includes(req.body?.action);
  const before = inventoryAction ? getPet(id) : undefined;
  const result = req.body?.action === 'open-chest' ? openAdventureChest(id, req.body.revision)
    : req.body?.action === 'use-item' ? useAdventureItem(id, req.body.item, req.body.revision)
    : req.body?.action === 'battle-skill' ? adventureBattleSkill(id, req.body.battleId, req.body.turnRevision, req.body.ability)
    : req.body?.action === 'battle-forfeit' ? forfeitAdventureBattle(id, req.body.battleId, req.body.turnRevision)
    : req.body?.action === 'continue' ? continueAdventure(id, req.body.battleId, req.body.revision)
    : req.body?.action === 'abandon' ? abandonAdventure(id, req.body.revision)
    : req.body?.action === 'enter' ? enterAdventure(id, req.body.revision, req.body.entryId)
    : req.body?.action === 'leave' ? leaveAdventure(id, req.body.revision)
    : req.body?.action === 'restart' ? restartAdventure(id, req.body.revision)
    : req.body?.action === 'skip-cooldown' ? skipAdventureCooldown(id, req.body.revision)
    : req.body?.action === 'patrol' ? patrolAdventure(id)
    : req.body?.action !== undefined ? changeFloor(id, req.body.action, req.body.revision)
    : req.body?.direction !== undefined ? moveAdventure(id, req.body.direction, req.body.revision) : adventureFor(id);
  if (before) {
    const pet = getPet(id)!;
    if (JSON.stringify(before) !== JSON.stringify(pet)) {
      if (pet.busyUntil !== null) schedule(id, pet.busyUntil);
      broadcast({ type: 'pet:updated', pet });
      followUp();
    }
  }
  if ("error" in result) return void res.status(result.status).json({ error: result.error });
  res.json(result);
});

// The Team up window. Each change is saved, then broadcast as team:updated.
app.get("/api/team", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: "Sign in first." });
  res.json(teamFor(id));
});

app.post("/api/team", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: "Sign in first." });
  const { action, player, team } = req.body ?? {};
  const teamId = Number.isSafeInteger(team) && team > 0 ? team as number : undefined;
  let outcome: TeamOutcome;
  if (action === "invite") {
    if (!isValidId(player)) return void res.status(400).json({ error: "Player ID must be 1–32 letters, digits, - or _." });
    outcome = invite(id, player);
  } else if (action === "accept" || action === "leave") {
    if (teamId === undefined) return void res.status(400).json({ error: "Choose a team." });
    outcome = action === "accept" ? accept(id, teamId) : leave(id, teamId);
  } else if (action === "set-off") {
    outcome = setOff(id);
  } else {
    return void res.status(400).json({ error: "Choose invite, accept, leave or set-off." });
  }
  if ("error" in outcome) return void res.status(outcome.status).json({ error: outcome.error });
  logEvent("action_result", {
    user: id, room: ROOM, client_in_room: clientsInRoom(), action: `team_${action}`, team: outcome.team.id,
    ...(action === "invite" ? { player } : {}),
  });
  // Setting off spends stamina and hygiene, so those pets go out first.
  if (action === "set-off") {
    for (const member of outcome.team.members) broadcast({ type: "pet:updated", pet: getPet(member.id)! });
  }
  broadcast({ type: "team:updated", team: outcome.team });
  followUp();
  res.json(teamFor(id));
});

// Theft reports are private to the signed-in victim.
app.get("/api/thefts", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: "Sign in first." });
  res.json(theftsFor(id));
});

// Anyone can look at any pet, but only its owner can act for it.
app.post("/api/pets/:id/*action", (req, res, next) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  const player = playerFor(req.headers.cookie);
  if (!player) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  if (player !== req.params.id) {
    res.status(403).json({ error: "That's not your pet." });
    return;
  }
  next();
});

// Every player can look at every pet: the bot first, then the newest.
app.get("/api/pets", (req, res) => {
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 20, 1), 50);
  res.json(listPets(limit));
});

// The top players, by fights won (the default) or by power.
app.get("/api/leaderboard", (req, res) => {
  const by = req.query.by ?? "wins";
  if (!isLeaderboardOrder(by)) {
    res.status(400).json({ error: `Sort the leaderboard by ${LEADERBOARD_ORDERS.join(" or ")}.` });
    return;
  }
  res.json(leaderboard(by));
});

// What's been happening across the game, newest first.
app.get("/api/feed", (req, res) => {
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 20, 1), 50);
  res.json(recentFeed(limit));
});

app.get("/api/pets/:id/fights", (req, res) => {
  if (!isValidId(req.params.id) || !getPet(req.params.id)) return notFound(res, "pet");
  res.json(recentFights(req.params.id, 10));
});

// Who has played with a pet lately, newest first. Touches are broadcast to
// every window anyway, so like fights they're open to read.
app.get("/api/pets/:id/touches", (req, res) => {
  if (!isValidId(req.params.id) || !getPet(req.params.id)) return notFound(res, "pet");
  res.json(touchesOn(req.params.id));
});

app.get("/api/pets/:id", (req, res) => {
  const pet = isValidId(req.params.id) ? getPet(req.params.id) : undefined;
  if (!pet) {
    res.status(404).json({ error: "no such pet" });
    return;
  }
  res.json(pet);
});

// The rules the client draws its buttons, costs and limits from.
app.get("/api/rules", (_req, res) => {
  res.json({
    schools: SCHOOLS,
    courses: COURSES,
    items: ITEMS,
    freeSupplies: FREE_SUPPLIES,
    treasure: { rates: TREASURE_RATES, coins: COINS },
    locations: LOCATIONS,
    maxCare: MAX_CARE,
    study: { cost: STUDY_COST, needs: STUDY_NEEDS, minutes: STUDY_MINUTES },
    work: { costPerHour: WORK_COST_PER_HOUR, shiftMinutes: SHIFT_MINUTES },
    timeScale: TIME_SCALE,
    fight: {
      cost: FIGHT_COST, needs: FIGHT_NEEDS, luck: LUCK, powerWeights: POWER_WEIGHTS, spoils: SPOILS,
      cooldownMinutes: FIGHT_COOLDOWN_MINUTES,
      abilities: ABILITIES,
      types: { chart: TYPE_CHART, monsters: MONSTER_TYPES },
    },
    adventure: { cost: ADVENTURE_COST, cooldownMinutes: ADVENTURE_COOLDOWN_MINUTES },
    botId: BOT_ID,
    steal: STEAL,
    leaderboardSize: LEADERBOARD_SIZE,
  });
});

// Every action answers with the pet as saved, and tells every client.
function respond(res: express.Response, outcome: Outcome): void {
  if ("error" in outcome) {
    if (outcome.settled) broadcast({ type: "pet:updated", pet: outcome.settled });
    followUp();
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  // A lesson or shift just started: finish it on time.
  if (outcome.pet.busyUntil !== null) schedule(outcome.pet.id, outcome.pet.busyUntil);
  broadcast({ type: "pet:updated", pet: outcome.pet });
  followUp();
  res.json(outcome.pet);
}

const notFound = (res: express.Response, what: string): void => void res.status(404).json({ error: `no such ${what}` });

app.post("/api/pets/:id/appearance", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  const { color, appearance } = req.body ?? {};
  if (typeof color !== "string" || color.length !== 7 || !/^#[0-9a-f]{6}$/i.test(color)) {
    res.status(400).json({ error: "Color must be a six-digit hex string, e.g. #f59e0b." });
    return;
  }
  if (!isAppearance(appearance)) {
    res.status(400).json({ error: `Appearance must be one of ${APPEARANCES.join(", ")}.` });
    return;
  }
  respond(res, setAppearance(req.params.id, color, appearance));
});

app.post("/api/pets/:id/study/:course", (req, res) => {
  const course = findCourse(req.params.course);
  if (!course) return notFound(res, "course");
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  const outcome = study(req.params.id, course.id);
  if ("pet" in outcome) {
    logEvent("action_result", {
      user: req.params.id, room: ROOM, client_in_room: clientsInRoom(), action: "study", course: course.id,
    });
  }
  respond(res, outcome);
});

app.post("/api/pets/:id/work/:location", (req, res) => {
  const location = findLocation(req.params.location);
  if (!location) return notFound(res, "location");
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  const minutes = req.body?.minutes;
  if (!isShiftLength(minutes)) {
    res.status(400).json({ error: `minutes must be one of ${SHIFT_MINUTES.join(", ")}` });
    return;
  }
  const outcome = work(req.params.id, location.id, minutes);
  if ("pet" in outcome) {
    logEvent("action_result", {
      user: req.params.id, room: ROOM, client_in_room: clientsInRoom(), action: "work", location: location.id, minutes,
    });
  }
  respond(res, outcome);
});

app.post("/api/pets/:id/upgrade/:location", (req, res) => {
  const location = findLocation(req.params.location);
  if (!location) return notFound(res, "location");
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  respond(res, upgrade(req.params.id, location.id));
});

app.post("/api/pets/:id/buy/:item", (req, res) => {
  const item = findItem(req.params.item);
  if (!item) return notFound(res, "item");
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  respond(res, buy(req.params.id, item.id));
});

app.post("/api/pets/:id/use/:item", (req, res) => {
  const item = findItem(req.params.item);
  if (!item) return notFound(res, "item");
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  respond(res, use(req.params.id, item.id));
});

app.post("/api/pets/:id/collect-supplies", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  respond(res, collectSupplies(req.params.id));
});

app.post('/api/pets/:id/equip-skills', (req, res) => {
  respond(res, equipSkills(req.params.id, req.body?.abilities));
});

app.post("/api/pets/:id/equip-coin/:coin", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  respond(res, equipCoin(req.params.id, req.params.coin === "none" ? null : req.params.coin));
});

app.post("/api/pets/:id/fight/:opponent", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  if (!isValidId(req.params.opponent)) return notFound(res, "opponent");
  if (!getPet(req.params.opponent)) return notFound(res, 'opponent');
  if (req.params.opponent !== BOT_ID && !isOnline(req.params.opponent)) {
    return void res.status(409).json({ error: 'This player is offline. You can still visit their home.' });
  }
  const outcome = fight(req.params.id, req.params.opponent);
  if ("error" in outcome) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  announceBattle({ ...outcome, ...outcome.session.result }, outcome.session.battle.status === 'finished');
  res.json(outcome);
});

app.post("/api/pets/:id/steal/:opponent", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  if (!isValidId(req.params.opponent)) return notFound(res, "opponent");
  const outcome = steal(req.params.id, req.params.opponent);
  if ("error" in outcome) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  logEvent("action_result", {
    user: outcome.thief.id, room: ROOM, client_in_room: clientsInRoom(),
    action: "steal", victim: outcome.victim.id, amount: outcome.amount,
  });
  broadcast({ type: "pet:updated", pet: outcome.thief });
  broadcast({ type: "pet:updated", pet: outcome.victim });
  followUp();
  res.json(outcome);
});

// Feeding or cleaning someone else's pet with your own Food or Soap. Both
// pets are saved together, then broadcast; the feed entry follows them.
app.post("/api/pets/:id/help/:pet", (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.pet)) return notFound(res, "pet");
  const item = req.body?.item;
  if (item !== "food" && item !== "soap") return void res.status(400).json({ error: "item must be food or soap" });
  const outcome = help(req.params.id, req.params.pet, item);
  if ("error" in outcome) return void res.status(outcome.status).json({ error: outcome.error });
  logEvent("action_result", {
    user: outcome.helper.id, room: ROOM, client_in_room: clientsInRoom(),
    action: "help", pet: outcome.pet.id, item: outcome.item, amount: outcome.amount,
  });
  broadcast({ type: "pet:updated", pet: outcome.helper });
  broadcast({ type: "pet:updated", pet: outcome.pet });
  followUp();
  res.json(outcome);
});

// Playing with someone else's pet, as your own: saved, logged, then broadcast
// so it reacts in every window showing it, its owner's included.
app.post("/api/pets/:id/touch/:pet", (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.pet)) return notFound(res, "pet");
  const kind = req.body?.kind;
  if (!isTouchKind(kind)) return void res.status(400).json({ error: `kind must be one of ${TOUCH_KINDS.join(", ")}` });
  const outcome = touch(req.params.id, req.params.pet, kind);
  if ("error" in outcome) return void res.status(outcome.status).json({ error: outcome.error });
  logEvent("action_result", {
    user: outcome.touch.visitor, room: ROOM, client_in_room: clientsInRoom(),
    action: "touch", pet: outcome.touch.pet, kind: outcome.touch.kind,
  });
  broadcast({ type: "pet:touched", touch: outcome.touch });
  res.json(outcome.touch);
});

app.post("/api/pets/:id/revenge/:theft", (req, res) => {
  if (!/^[1-9][0-9]*$/.test(req.params.theft) || !Number.isSafeInteger(Number(req.params.theft))) {
    return notFound(res, "theft");
  }
  const theft = theftsFor(req.params.id).find(theft => theft.id === Number(req.params.theft));
  if (theft && !isOnline(theft.thief)) return void res.status(409).json({ error: 'The thief is offline. Try again when they are online.' });
  const outcome = revenge(req.params.id, Number(req.params.theft));
  if ("error" in outcome) return void res.status(outcome.status).json({ error: outcome.error });
  announceBattle({ ...outcome, attacker: outcome.victim, defender: outcome.thief, ...outcome.session.result }, outcome.session.battle.status === 'finished');
  res.json(outcome);
});

// Each fresh game-page visit ends the browser's previous login.
app.get(["/", "/index.html"], (req, res, next) => {
  const token = sessionToken(req.headers.cookie);
  if (token) signOut(token);
  refreshPresence();
  res.setHeader("Set-Cookie", clearedCookie());
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.static("public"));

const server = createServer(app);
attachRealtime(server);
scheduleAll(); // lessons and shifts that were running when the app last stopped
getOrCreatePet(BOT_ID);
matchBot(); // players may have trained since the bot last kept up

const port = Number(process.env.PORT ?? 8080);
server.listen(port, "0.0.0.0", () => {
  const address = server.address();
  console.log(`VirtuePets listening on http://0.0.0.0:${typeof address === "object" && address ? address.port : port}`);
});
