import express from "express";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { marked } from "marked";
import {
  COURSES, ITEMS, LOCATIONS, MAX_CARE, SCHOOLS, SHIFT_MINUTES, STUDY_COST, STUDY_MINUTES, STUDY_NEEDS,
  WORK_COST_PER_HOUR, buy, findCourse, findItem, findLocation, getOrCreatePet, getPet, isShiftLength, isValidId,
  study, upgrade, use, work, BOT_ID, FIGHT_COOLDOWN_MINUTES, FIGHT_COST, FIGHT_NEEDS, LUCK, POWER_WEIGHTS, SPOILS,
  fight, listPets, recentFights, type Outcome,
} from "./pets.ts";
import {
  Busy, PASSWORD, type AuthOutcome, clearedCookie, isValidPassword, playerFor, sessionCookie, sessionToken, signIn,
  signOut, signUp,
} from "./auth.ts";
import { TIME_SCALE } from "./clock.ts";
import { attachRealtime, broadcast } from "./realtime.ts";
import { schedule, scheduleAll } from "./scheduler.ts";

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

// Anyone can look at any pet, but only its owner can act for it.
app.post("/api/pets/:id/*action", (req, res, next) => {
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

app.get("/api/pets/:id/fights", (req, res) => {
  if (!isValidId(req.params.id) || !getPet(req.params.id)) return notFound(res, "pet");
  res.json(recentFights(req.params.id, 10));
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
    locations: LOCATIONS,
    maxCare: MAX_CARE,
    study: { cost: STUDY_COST, needs: STUDY_NEEDS, minutes: STUDY_MINUTES },
    work: { costPerHour: WORK_COST_PER_HOUR, shiftMinutes: SHIFT_MINUTES },
    timeScale: TIME_SCALE,
    fight: {
      cost: FIGHT_COST, needs: FIGHT_NEEDS, luck: LUCK, powerWeights: POWER_WEIGHTS, spoils: SPOILS,
      cooldownMinutes: FIGHT_COOLDOWN_MINUTES,
    },
    botId: BOT_ID,
  });
});

// Every action answers with the pet as saved, and tells every client.
function respond(res: express.Response, outcome: Outcome): void {
  if ("error" in outcome) {
    if (outcome.settled) broadcast({ type: "pet:updated", pet: outcome.settled });
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  // A lesson or shift just started: finish it on time.
  if (outcome.pet.busyUntil !== null) schedule(outcome.pet.id, outcome.pet.busyUntil);
  broadcast({ type: "pet:updated", pet: outcome.pet });
  res.json(outcome.pet);
}

const notFound = (res: express.Response, what: string): void => void res.status(404).json({ error: `no such ${what}` });

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
  res.json(outcome);
});

app.use(express.static("public"));

const server = createServer(app);
attachRealtime(server);
scheduleAll(); // lessons and shifts that were running when the app last stopped
getOrCreatePet(BOT_ID);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, "0.0.0.0", () => {
  console.log(`VirtuePets listening on http://0.0.0.0:${port}`);
});
