import {
  abandonAdventure, adventureFor, changeFloor, continueAdventure, moveAdventure, openAdventureChest, patrolAdventure,
  restartAdventure, skipAdventureCooldown, useAdventureItem,
} from "./adventure.ts";
import { accept, invite, leave, setOff, teamFor, type TeamOutcome } from "./teams.ts";
import express from "express";
import { ABILITIES } from "./combat.ts";
import { COINS, TREASURE_RATES } from './treasure.ts';
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { marked } from "marked";
import {
  COURSES, ITEMS, LOCATIONS, MAX_CARE, SCHOOLS, SHIFT_MINUTES, STUDY_COST, STUDY_MINUTES, STUDY_NEEDS,
  WORK_COST_PER_HOUR, buy, findCourse, findItem, findLocation, getOrCreatePet, getPet, isShiftLength, isValidId,
  matchBot, study, upgrade, use, work, BOT_ID, FIGHT_COOLDOWN_MINUTES, FIGHT_COST, FIGHT_NEEDS, LUCK, POWER_WEIGHTS,
  SPOILS, LEADERBOARD_ORDERS, LEADERBOARD_SIZE, fight, isLeaderboardOrder, leaderboard, listPets, recentFights,
  APPEARANCES, isAppearance, setAppearance, STEAL, steal, theftsFor, revenge, equipCoin, FREE_SUPPLIES, collectSupplies,
  ADVENTURE_COST, ADVENTURE_COOLDOWN_MINUTES, type Outcome,
} from "./pets.ts";
import {
  Busy, PASSWORD, type AuthOutcome, clearedCookie, isValidPassword, playerFor, sessionCookie, sessionToken, signIn,
  signOut, signUp,
} from "./auth.ts";
import { TIME_SCALE } from "./clock.ts";
import { recentFeed } from "./feed.ts";
import { followUp } from "./followups.ts";
import { attachRealtime, broadcast } from "./realtime.ts";
import { schedule, scheduleAll } from "./scheduler.ts";
import { TOUCH_KINDS, isTouchKind, touch, touchesOn } from "./touches.ts";

const app = express();
app.use(express.json());

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
  // A new pet joins every open arena.
  if (outcome.created) broadcast({ type: "pet:updated", pet: outcome.pet });
  followUp();
  res.setHeader("Set-Cookie", sessionCookie(outcome.token));
  res.status(okStatus).json(outcome.pet);
}

app.post("/api/signup", (req, res) => authenticate(req, res, signUp, 201));
app.post("/api/signin", (req, res) => authenticate(req, res, signIn, 200));

app.post("/api/signout", (req, res) => {
  const token = sessionToken(req.headers.cookie);
  if (token) signOut(token);
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

// Exploration is private, and every accepted step is saved before returning it.
app.post("/api/adventure", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = playerFor(req.headers.cookie);
  if (!id) return void res.status(401).json({ error: "Sign in first." });
  if (req.body?.direction !== undefined && req.body?.action !== undefined) {
    return void res.status(400).json({ error: "Choose one adventure action at a time." });
  }
  const inventoryAction = ['open-chest', 'use-item', 'restart', 'skip-cooldown'].includes(req.body?.action);
  const before = inventoryAction ? getPet(id) : undefined;
  const result = req.body?.action === 'open-chest' ? openAdventureChest(id, req.body.revision)
    : req.body?.action === 'use-item' ? useAdventureItem(id, req.body.item, req.body.revision)
    : req.body?.action === 'continue' ? continueAdventure(id, req.body.battleId, req.body.revision)
    : req.body?.action === 'abandon' ? abandonAdventure(id, req.body.revision)
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
  respond(res, study(req.params.id, course.id));
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
  respond(res, work(req.params.id, location.id, minutes));
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

app.post("/api/pets/:id/equip-coin/:coin", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  respond(res, equipCoin(req.params.id, req.params.coin === "none" ? null : req.params.coin));
});

app.post("/api/pets/:id/fight/:opponent", (req, res) => {
  if (!isValidId(req.params.id)) return notFound(res, "pet");
  if (!isValidId(req.params.opponent)) return notFound(res, "opponent");
  const outcome = fight(req.params.id, req.params.opponent);
  if ("error" in outcome) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  broadcast({ type: "pet:updated", pet: outcome.attacker });
  broadcast({ type: "pet:updated", pet: outcome.defender });
  broadcast({ type: "fight:finished", fight: outcome.fight });
  followUp();
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
  broadcast({ type: "pet:updated", pet: outcome.thief });
  broadcast({ type: "pet:updated", pet: outcome.victim });
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
  console.log(`player=${outcome.touch.visitor} action=touch pet=${outcome.touch.pet} kind=${outcome.touch.kind}`);
  broadcast({ type: "pet:touched", touch: outcome.touch });
  res.json(outcome.touch);
});

app.post("/api/pets/:id/revenge/:theft", (req, res) => {
  if (!/^[1-9][0-9]*$/.test(req.params.theft) || !Number.isSafeInteger(Number(req.params.theft))) {
    return notFound(res, "theft");
  }
  const outcome = revenge(req.params.id, Number(req.params.theft));
  if ("error" in outcome) return void res.status(outcome.status).json({ error: outcome.error });
  broadcast({ type: "pet:updated", pet: outcome.victim });
  broadcast({ type: "pet:updated", pet: outcome.thief });
  followUp();
  res.json(outcome);
});

// Each fresh game-page visit ends the browser's previous login.
app.get(["/", "/index.html"], (req, res, next) => {
  const token = sessionToken(req.headers.cookie);
  if (token) signOut(token);
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
  console.log(`VirtuePets listening on http://0.0.0.0:${port}`);
});
