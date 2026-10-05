const $ = (id) => document.getElementById(id);
let current = null; // the pet this window is showing
let broadcasts = 0; // pet:updated events rendered; a resync older than one is stale
let rules = null; // schools, courses, items and costs, as the server publishes them
const busy = new Set(); // buttons whose request is still in flight
const LABELS = { strength: "Strength", intelligence: "Intelligence", charisma: "Charisma", stamina: "stamina", hygiene: "hygiene" };
const VERBS = { food: "Feed", soap: "Clean", hourglass: "Skip" };
const effectText = (item) =>
  item.effect === "skip" ? "Finishes a lesson or shift now" : `+${item.amount} ${LABELS[item.restores]}`;
// Whether using the item right now would do anything.
const usable = (item, pet) =>
  item.effect === "skip" ? pet.activity !== "idle" : pet[item.restores] < rules.maxCare;

let shiftMinutes = 60; // the shift length picked for work
const costText = (cost) => `−${cost.stamina} stamina · −${cost.hygiene} hygiene`;

// Same arithmetic as the server's shiftCost and pay, for the chosen length.
const shiftCost = (minutes) => ({
  stamina: Math.ceil((rules.work.costPerHour.stamina * minutes) / 60),
  hygiene: Math.ceil((rules.work.costPerHour.hygiene * minutes) / 60),
});
const shiftPay = (hourly, minutes) => Math.round((hourly * minutes) / 60);

const lengthText = (minutes) => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`);

// Game time left, from real time left and the app's clock speed.
function timeLeftText(busyUntil) {
  const minutes = Math.ceil(((busyUntil - Date.now()) * rules.timeScale) / 60_000);
  if (minutes <= 0) return "finishing…";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h} h ` : ""}${m || !h ? `${m} min ` : ""}left`;
}

// The game's rules live on the server; the page only draws them. Without them
// there are no buttons, so keep trying until they arrive.
async function loadRules() {
  for (let delay = 500; ; delay = Math.min(delay * 2, 10000)) {
    try {
      const res = await fetch("/api/rules");
      if (res.ok) return await res.json();
    } catch {
      // offline or the machine is waking up; try again
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

loadRules().then((loaded) => {
  rules = loaded;
  for (const course of rules.courses) {
    const kind = course.attribute ?? "random";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `course course-${kind}`;
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${kind}" /></svg>
      <span class="course-name"></span><span class="course-gain"></span>`;
    button.querySelector(".course-name").textContent = course.name;
    button.dataset.attribute = course.attribute ?? "";
    button.addEventListener("click", () => perform(button, `study/${course.id}`, "study-error"));
    $("courses").append(button);
  }
  for (const item of rules.items) {
    const card = document.createElement("div");
    card.className = `item item-${item.effect === "skip" ? "skip" : item.restores}`;
    card.dataset.item = item.id;
    card.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${item.id}" /></svg>
      <span><span class="item-name"></span> × <span class="item-count"></span></span>
      <span class="item-effect"></span>
      <div class="item-actions">
        <button type="button" class="chip-btn chip-use"></button>
        <button type="button" class="chip-btn chip-buy"></button>
      </div>`;
    card.querySelector(".item-name").textContent = item.name;
    card.querySelector(".item-effect").textContent = effectText(item);
    const use = card.querySelector(".chip-use");
    const buy = card.querySelector(".chip-buy");
    use.textContent = VERBS[item.id] ?? "Use";
    buy.textContent = `Buy $${item.price}`;
    use.addEventListener("click", () => perform(use, `use/${item.id}`, "care-error"));
    buy.addEventListener("click", () => perform(buy, `buy/${item.id}`, "care-error"));
    $("items").append(card);
  }
  $("study-cost").textContent = `${lengthText(rules.study.minutes)} · ${costText(rules.study.cost)}`;
  $("skip").addEventListener("click", () => perform($("skip"), "use/hourglass", "care-error"));
  $("fight-cost").textContent =
    `${costText(rules.fight.cost)} · winner takes ${rules.fight.spoils.share * 100}% of the loser's money`;
  for (const minutes of rules.work.shiftMinutes) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "shift";
    input.id = `shift-${minutes}`;
    input.value = minutes;
    input.checked = minutes === shiftMinutes;
    input.addEventListener("change", () => {
      shiftMinutes = minutes;
      if (current) renderControls(current);
    });
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.textContent = lengthText(minutes);
    $("shift-options").append(input, label);
  }
  for (const location of rules.locations) {
    const card = document.createElement("div");
    card.className = `location location-${location.attribute}`;
    card.dataset.location = location.id;
    card.innerHTML = `<div class="location-head">
        <svg class="icon" aria-hidden="true"><use href="#i-${location.attribute}" /></svg>
        <div><div class="location-name"></div><div class="location-rank"></div></div>
      </div>
      <div class="location-pay"><span class="pay"></span> <small class="pay-length"></small></div>
      <button type="button" class="btn work-btn">Work here</button>
      <div class="location-next">
        <span class="location-next-text"></span>
        <button type="button" class="chip-btn upgrade-btn">Upgrade</button>
      </div>`;
    card.querySelector(".location-name").textContent = location.name;
    const work = card.querySelector(".work-btn");
    const upgrade = card.querySelector(".upgrade-btn");
    work.setAttribute("aria-label", `Work a shift at the ${location.name}`);
    work.addEventListener("click", () =>
      perform(work, `work/${location.id}`, "work-error", { minutes: shiftMinutes }),
    );
    upgrade.addEventListener("click", () => perform(upgrade, `upgrade/${location.id}`, "work-error"));
    $("locations").append(card);
  }
  if (current) {
    render(current);
    loadArena();
  }
});

// Why the pet can't do something right now, or "" if it can. The server
// checks the same rules; this only keeps the buttons honest.
function blocker(pet, needs, doing) {
  if (pet.stamina < needs.stamina) return `Too tired to ${doing}: needs ${needs.stamina} stamina. Feed your pet.`;
  if (pet.hygiene < needs.hygiene) return `Too dirty to ${doing}: needs ${needs.hygiene} hygiene. Clean your pet.`;
  return "";
}

async function perform(button, path, errorId, body) {
  if (!current) return;
  busy.add(button);
  button.disabled = true;
  $(errorId).textContent = "";
  try {
    // No local update: the broadcast is what every window, this one included, renders.
    const res = await fetch(`/api/pets/${encodeURIComponent(current.id)}/${path}`, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) return sessionEnded();
    if (res.status === 403) return sessionChanged();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $(errorId).textContent = body.error ?? `Something went wrong (server error ${res.status}). Try again.`;
    }
  } catch {
    $(errorId).textContent = "Couldn't reach the server, so nothing happened. Try again.";
  } finally {
    busy.delete(button);
    if (current && rules) {
      renderBusy(current);
      renderControls(current);
    }
  }
}

function renderMeters(pet) {
  for (const need of ["stamina", "hygiene"]) {
    const track = $(`meter-${need}`);
    track.setAttribute("aria-valuenow", pet[need]);
    track.querySelector(".meter-fill").style.setProperty("--fill", pet[need] / (rules?.maxCare ?? 100));
    track.parentElement.toggleAttribute("data-low", rules ? pet[need] < rules.study.needs[need] : false);
    $(`meter-${need}-value`).textContent = pet[need];
  }
}

function renderSchool(pet, previous) {
  const level = rules.schools.findIndex((s) => s.id === pet.school);
  const school = rules.schools[level];
  $("school-name").textContent = school.name;
  $("school-level").textContent = `Level ${level + 1} of ${rules.schools.length} · lessons worth +${school.gain}`;
  const bar = $("school-progress");
  if (school.creditsToAdvance) {
    const next = rules.schools[level + 1];
    bar.hidden = false;
    bar.setAttribute("aria-valuemax", school.creditsToAdvance);
    bar.setAttribute("aria-valuenow", pet.credits);
    $("school-progress-fill").style.setProperty("--fill", pet.credits / school.creditsToAdvance);
    $("school-credits").textContent = `${pet.credits} / ${school.creditsToAdvance} credits to ${next.name}`;
  } else {
    bar.hidden = true;
    $("school-credits").textContent = `Top of the school · ${pet.credits} credits earned`;
  }
  if (previous && previous.id === pet.id && previous.school !== pet.school) {
    $("level-up").textContent = `Moved up to ${school.name}!`;
  } else if (previous?.id !== pet.id) {
    $("level-up").textContent = "";
  }
  for (const button of $("courses").children) {
    const attribute = button.dataset.attribute;
    button.querySelector(".course-gain").textContent = `+${school.gain} ${attribute ? LABELS[attribute] : "random"}`;
  }
}

const busyText = (pet) =>
  pet.activity === "studying" ? `Studying ${pet.task}` : `Working at the ${pet.task}`;

function renderBusy(pet) {
  $("busy").hidden = pet.activity === "idle";
  if (pet.activity === "idle") return;
  const reward = pet.reward;
  const gains = ["strength", "intelligence", "charisma"]
    .filter((a) => reward[a] > 0)
    .map((a) => `+${reward[a]} ${LABELS[a]}`);
  if (reward.money) gains.push(`+$${reward.money}`);
  if (reward.credits) gains.push(`+${reward.credits} credit`);
  $("busy-what").textContent = `${busyText(pet)} · ${gains.join(", ")} when done`;
  const hourglasses = pet.hourglass;
  $("skip-label").textContent = hourglasses ? `Skip (${hourglasses} left)` : "Skip: buy an hourglass";
  $("skip").disabled = busy.has($("skip")) || hourglasses < 1;
  renderBusyClock(pet);
}

// How far through its activity the pet is: the bar and the time left.
function renderBusyClock(pet) {
  const total = pet.busyUntil - pet.busySince;
  const done = Math.min(1, Math.max(0, (Date.now() - pet.busySince) / total));
  $("busy-progress-fill").style.setProperty("--fill", done);
  $("busy-progress").setAttribute("aria-valuenow", Math.round(done * 100));
  $("busy-left").textContent = timeLeftText(pet.busyUntil);
}

// The clock ticks locally; the finish itself arrives as a broadcast.
setInterval(() => {
  if (rules && current?.busyUntil) renderBusyClock(current);
}, 1000);

function renderControls(pet) {
  if (!rules) return;
  const occupied = pet.activity === "idle" ? "" : `${busyText(pet)}. Wait until it's done.`;
  const studyBlock = occupied || blocker(pet, rules.study.needs, "study");
  $("study-hint").textContent = studyBlock;
  for (const button of $("courses").children) button.disabled = busy.has(button) || studyBlock !== "";

  const cost = shiftCost(shiftMinutes);
  $("work-cost").textContent = `${lengthText(shiftMinutes)} · ${costText(cost)}`;
  const workBlock = occupied || blocker(pet, cost, "work");
  $("work-hint").textContent = workBlock;
  for (const card of $("locations").children) {
    const location = rules.locations.find((l) => l.id === card.dataset.location);
    const rank = pet.jobs[location.id];
    const attribute = pet[location.attribute];
    const next = location.ranks[rank + 1];
    card.querySelector(".location-rank").textContent = location.ranks[rank].title;
    card.querySelector(".pay").textContent = `+$${shiftPay(location.ranks[rank].wage + attribute, shiftMinutes)}`;
    const work = card.querySelector(".work-btn");
    work.textContent = `Work ${lengthText(shiftMinutes)}`;
    card.querySelector(".pay-length").textContent = `for ${lengthText(shiftMinutes)}`;
    work.disabled = busy.has(work) || workBlock !== "";

    const text = card.querySelector(".location-next-text");
    const upgrade = card.querySelector(".upgrade-btn");
    if (next) {
      text.innerHTML = "Next: <b></b> · needs <span></span>";
      text.querySelector("b").textContent = next.title;
      text.querySelector("span").textContent = `${attribute}/${next.requires} ${LABELS[location.attribute]}`;
      upgrade.hidden = false;
      upgrade.textContent = `Upgrade to ${next.title}`;
      upgrade.disabled = busy.has(upgrade) || attribute < next.requires;
    } else {
      text.textContent = "Top rank reached.";
      upgrade.hidden = true;
    }
  }

  arenaBlock = occupied || blocker(pet, rules.fight.needs, "fight");
  $("arena-hint").textContent = arenaBlock;
  renderFightButtons();

  for (const card of $("items").children) {
    const item = rules.items.find((i) => i.id === card.dataset.item);
    const use = card.querySelector(".chip-use");
    const buy = card.querySelector(".chip-buy");
    card.querySelector(".item-count").textContent = pet[item.id];
    use.disabled = busy.has(use) || pet[item.id] < 1 || !usable(item, pet);
    buy.disabled = busy.has(buy) || pet.money < item.price;
  }
}

// Arena ---------------------------------------------------------------------

let rivals = new Map(); // pets shown in the arena, by ID
const arrival = new Map(); // when this page first saw each pet, newest highest
let arrivals = 0;
let pinned = null; // the pet the player looked up, shown first
let fighting = false; // a fight request is in flight
let arenaBlock = ""; // why this pet can't fight right now, or ""
let avenging = null; // the pet that last attacked this one, for the Revenge button
const fightLog = [];
let feed = new Map(); // "Happening now" entries, by ID

const powerOf = (pet) =>
  Object.entries(rules.fight.powerWeights).reduce((sum, [attribute, weight]) => sum + weight * pet[attribute], 0);

async function loadArena() {
  if (!current || !rules) return;
  const { id } = current;
  try {
    const [list, fights, news] = await Promise.all([
      fetch("/api/pets?limit=20").then((res) => res.json()),
      fetch(`/api/pets/${encodeURIComponent(id)}/fights`).then((res) => res.json()),
      fetch(`/api/feed?limit=${FEED_SIZE}`).then((res) => res.json()),
    ]);
    if (current?.id !== id) return; // switched pets meanwhile
    const pin = pinned && rivals.get(pinned);
    rivals = new Map(list.filter((pet) => pet.id !== id).map((pet) => [pet.id, pet]));
    // The server lists newest first, so the first pet arrived last.
    arrival.clear();
    list.forEach((pet, i) => arrival.set(pet.id, -i));
    if (pin) rivals.set(pin.id, pin);
    renderRivals();
    fightLog.length = 0;
    fightLog.push(...fights);
    renderFightLog();
    feed = new Map(news.map((entry) => [entry.id, entry]));
    renderFeed();
    if (boardOpen()) loadBoard();
    else boardLoaded = false;
  } catch {
    $("arena-error").textContent = "Couldn't load the other pets. They'll show up when the connection is back.";
  }
}

function rivalRow(pet) {
  const li = document.createElement("li");
  li.className = "rival";
  li.toggleAttribute("data-pinned", pet.id === pinned);
  const school = rules.schools.find((s) => s.id === pet.school)?.name ?? pet.school;
  const doing = pet.activity === "idle" ? "Idle" : pet.activity === "studying" ? "Studying" : "Working";
  li.innerHTML = `<div><span class="rival-name"></span></div>
    <div class="rival-meta"></div>
    <div class="rival-stats"></div>
    <button type="button" class="chip-btn fight-btn">Fight</button>`;
  li.querySelector(".rival-name").textContent = pet.id;
  if (pet.id === rules.botId) li.querySelector(".rival-name").insertAdjacentHTML("afterend", '<span class="tag">bot</span>');
  li.querySelector(".rival-meta").textContent = `${school} · ${doing} · ${pet.wins}W ${pet.losses}L`;
  li.querySelector(".rival-stats").innerHTML =
    `Power <b></b> · Str ${pet.strength} · Int ${pet.intelligence} · Cha ${pet.charisma}`;
  li.querySelector(".rival-stats b").textContent = powerOf(pet);
  const button = li.querySelector(".fight-btn");
  button.setAttribute("aria-label", `Fight ${pet.id}`);
  button.addEventListener("click", () => startFight(pet.id));
  return li;
}

// Keeps the arena to the 30 pets seen most recently (plus the bot and the
// looked-up pet), so a busy server doesn't grow it without end.
function trimRivals() {
  const spare = [...rivals.keys()]
    .filter((id) => id !== pinned && id !== rules.botId)
    .sort((a, b) => arrival.get(a) - arrival.get(b));
  for (const id of spare.slice(0, Math.max(0, spare.length - 30))) rivals.delete(id);
}

// Looked-up pet first, then the bot, then the newest pets.
function renderRivals() {
  const rank = (pet) => (pet.id === pinned ? 2 : pet.id === rules.botId ? 1 : 0);
  const order = [...rivals.values()].sort((a, b) => rank(b) - rank(a) || arrival.get(b.id) - arrival.get(a.id));
  $("rivals").replaceChildren(...order.map(rivalRow));
  renderFightButtons();
}

function renderFightButtons() {
  for (const button of $("rivals").querySelectorAll(".fight-btn")) button.disabled = fighting || arenaBlock !== "";
  $("revenge").disabled = fighting || arenaBlock !== "";
  $("revenge").title = arenaBlock;
}

// Resolves true if the fight happened; otherwise says why in `errorId`.
async function startFight(opponent, errorId = "arena-error") {
  if (!current) return false;
  fighting = true;
  renderFightButtons();
  $(errorId).textContent = "";
  try {
    // No local update: the fight:finished and pet:updated broadcasts tell the story.
    const res = await fetch(`/api/pets/${encodeURIComponent(current.id)}/fight/${encodeURIComponent(opponent)}`, {
      method: "POST",
    });
    if (res.status === 401) {
      sessionEnded();
      return false;
    }
    if (res.status === 403) {
      sessionChanged();
      return false;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $(errorId).textContent = body.error ?? `Something went wrong (server error ${res.status}). Try again.`;
    }
    return res.ok;
  } catch {
    $(errorId).textContent = "Couldn't reach the server, so the fight didn't happen. Try again.";
    return false;
  } finally {
    fighting = false;
    renderFightButtons();
  }
}

// How a fight went, from this player's side.
function describeFight(fight) {
  const me = current.id;
  const won = fight.winner === me;
  const rolls = `${fight.attackerRoll} vs ${fight.defenderRoll}`;
  const money = fight.spoils ? (won ? ` You took $${fight.spoils}.` : ` They took $${fight.spoils}.`) : "";
  if (fight.attacker === me) {
    return { won, rolls, text: (won ? `You beat ${fight.defender}!` : `${fight.defender} beat you.`) + money };
  }
  return { won, rolls, text: `${fight.attacker} attacked you and ${won ? "lost!" : "won."}` + money };
}

function renderFightLog() {
  $("fight-log").replaceChildren(
    ...fightLog.map((fight) => {
      const { won, text, rolls } = describeFight(fight);
      const li = document.createElement("li");
      li.dataset.result = won ? "won" : "lost";
      const at = new Date(fight.foughtAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      li.innerHTML = '<span class="text"></span> <span class="rolls"></span> · <time></time>';
      li.querySelector(".text").textContent = text;
      li.querySelector(".rolls").textContent = `(${rolls})`;
      li.querySelector("time").textContent = at;
      li.querySelector("time").dateTime = fight.foughtAt;
      return li;
    }),
  );
}

function onFight(fight) {
  if (!current || (fight.attacker !== current.id && fight.defender !== current.id)) return;
  const { won, text, rolls } = describeFight(fight);
  $("fight-news").textContent = `${text} (${rolls})`;
  $("fight-news").dataset.result = won ? "won" : "lost";
  fightLog.unshift(fight);
  fightLog.length = Math.min(fightLog.length, 10);
  renderFightLog();
  if (fight.defender === current.id) showAttacked(fight, text, won);
}

// "Happening now": what everyone's pets have been up to, newest first.
const FEED_SIZE = 15;

function feedText(entry) {
  switch (entry.kind) {
    case "joined":
      return [entry.pet, " joined the game."];
    case "fight": {
      const loser = entry.winner === entry.pet ? entry.other : entry.pet;
      return [entry.winner, " beat ", loser, entry.spoils ? ` and took $${entry.spoils}.` : "."];
    }
    case "school": {
      const school = rules.schools.find((s) => s.id === entry.school)?.name ?? entry.school;
      return [entry.pet, ` moved up to ${school.toLowerCase()}.`];
    }
    case "promoted": {
      const place = rules.locations.find((l) => l.id === entry.location);
      return [entry.pet, ` became ${place?.ranks[entry.rank]?.title ?? "promoted"} at the ${place?.name.toLowerCase()}.`];
    }
    default:
      return null; // a kind this page doesn't know yet
  }
}

function renderFeed() {
  const entries = [...feed.values()].sort((a, b) => b.id - a.id).slice(0, FEED_SIZE);
  feed = new Map(entries.map((entry) => [entry.id, entry]));
  $("feed").replaceChildren(
    ...entries.flatMap((entry) => {
      const parts = feedText(entry);
      if (!parts) return [];
      const li = document.createElement("li");
      // Odd parts are plain text, even ones pet IDs, which go in bold.
      const text = document.createElement("span");
      parts.forEach((part, i) => {
        if (i % 2) return void text.append(part);
        const b = document.createElement("b");
        b.textContent = part !== current?.id ? part : i === 0 ? "You" : "you";
        text.append(b);
      });
      li.toggleAttribute("data-mine", entry.pet === current?.id || entry.other === current?.id);
      const time = document.createElement("time");
      time.dateTime = entry.at;
      time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      li.append(text, time);
      return [li];
    }),
  );
}

// Leaderboard ---------------------------------------------------------------

let boardBy = "wins"; // or "power"
let board = []; // the top pets, as the server last ranked them
let boardLoaded = false; // false: fetch it when the tab is next shown
let boardTimer = null;
const boardOpen = () => !$("arena-board").hidden;

// Positive if `a` ranks above `b` on the current board (ties broken by the server).
const outranks = (a, b) =>
  boardBy === "wins" ? a.wins - b.wins || b.losses - a.losses : powerOf(a) - powerOf(b);

async function loadBoard() {
  const by = boardBy;
  clearTimeout(boardTimer);
  try {
    const res = await fetch(`/api/leaderboard?by=${by}`);
    if (!res.ok) throw new Error(`server error ${res.status}`);
    const pets = await res.json();
    if (by !== boardBy) return; // switched order meanwhile
    board = pets;
    boardLoaded = true;
    renderBoard();
  } catch {
    $("arena-error").textContent = "Couldn't load the leaderboard. It'll catch up when the connection is back.";
  }
}

function renderBoard() {
  $("board").replaceChildren(
    ...board.map((pet) => {
      const li = document.createElement("li");
      const mine = pet.id === current?.id;
      li.toggleAttribute("data-mine", mine);
      li.innerHTML = '<span class="board-name"></span><span class="board-score"><b></b> <span></span></span>';
      li.querySelector(".board-name").textContent = mine ? `${pet.id} (you)` : pet.id;
      const [headline, rest] =
        boardBy === "wins"
          ? [`${pet.wins} ${pet.wins === 1 ? "win" : "wins"}`, `· ${pet.losses}L · power ${powerOf(pet)}`]
          : [`Power ${powerOf(pet)}`, `· ${pet.wins}W ${pet.losses}L`];
      li.querySelector(".board-score b").textContent = headline;
      li.querySelector(".board-score span").textContent = rest;
      return li;
    }),
  );
}

// A pet changed. If that could change the board, ask the server to re-rank it
// (in one fetch for a burst of changes); a row whose score didn't move just
// shows the pet as broadcast.
function boardSaw(pet) {
  if (!boardLoaded || pet.id === rules.botId) return;
  const shown = board.findIndex((p) => p.id === pet.id);
  if (shown >= 0 && outranks(pet, board[shown]) === 0) {
    board[shown] = pet;
    return renderBoard();
  }
  const last = board[board.length - 1];
  if (shown < 0 && board.length >= rules.leaderboardSize && outranks(pet, last) < 0) return;
  if (!boardOpen()) return void (boardLoaded = false);
  clearTimeout(boardTimer);
  boardTimer = setTimeout(loadBoard, 250);
}

function showArenaTab(tab) {
  for (const name of ["pets", "board"]) {
    $(`tab-${name}`).setAttribute("aria-selected", String(name === tab));
    $(`arena-${name}`).hidden = name !== tab;
  }
  if (tab === "board" && !boardLoaded) loadBoard();
}
$("tab-pets").addEventListener("click", () => showArenaTab("pets"));
$("tab-board").addEventListener("click", () => showArenaTab("board"));

for (const by of ["wins", "power"]) {
  $(`board-${by}`).addEventListener("click", () => {
    if (boardBy === by) return;
    boardBy = by;
    for (const other of ["wins", "power"]) $(`board-${other}`).setAttribute("aria-pressed", String(other === by));
    board = [];
    renderBoard();
    loadBoard();
  });
}

// Being attacked is news wherever the player is on the page, with a way to
// hit straight back (the attacker's own cooldown doesn't stop the defender).
function showAttacked(fight, text, won) {
  avenging = fight.attacker;
  $("attacked-text").textContent = text;
  $("attacked-error").textContent = "";
  $("attacked").dataset.result = won ? "won" : "lost";
  $("revenge").textContent = won ? `Attack ${fight.attacker}` : "Revenge";
  $("revenge").setAttribute("aria-label", `Fight ${fight.attacker}`);
  $("attacked").hidden = false;
  renderFightButtons();
}

function hideAttacked() {
  avenging = null;
  $("attacked").hidden = true;
}

$("revenge").addEventListener("click", async () => {
  if (avenging && (await startFight(avenging, "attacked-error"))) hideAttacked();
});
$("attacked-close").addEventListener("click", hideAttacked);

$("lookup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("lookup-id").value.trim();
  $("arena-error").textContent = "";
  if (id === current?.id) return void ($("arena-error").textContent = "That's your own pet.");
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(id)}`);
    if (!res.ok) return void ($("arena-error").textContent = `There's no pet called ${id}.`);
    const pet = await res.json();
    pinned = pet.id;
    if (!arrival.has(pet.id)) arrival.set(pet.id, ++arrivals);
    rivals.set(pet.id, pet);
    renderRivals();
  } catch {
    $("arena-error").textContent = "Couldn't reach the server. Try again.";
  }
});

function render(pet) {
  const previous = current;
  current = pet;
  $("pet-name").textContent = pet.id;
  $("activity").textContent = pet.activity;
  for (const stat of ["strength", "intelligence", "charisma", "money"]) {
    const el = $(`stat-${stat}`);
    const value = String(pet[stat]);
    if (el.textContent !== "" && el.textContent !== value) {
      el.classList.remove("bump");
      void el.offsetWidth; // restart the animation on rapid changes
      el.classList.add("bump");
    }
    el.textContent = value;
  }
  renderMeters(pet);
  if (rules) {
    renderBusy(pet);
    renderSchool(pet, previous);
    renderControls(pet);
    if (previous?.id !== pet.id) {
      pinned = null;
      $("fight-news").textContent = "";
      hideAttacked();
      loadArena();
    }
  }
  $("login").hidden = true;
  $("dashboard").hidden = false;
  $("signout").hidden = false;
}

// Accounts --------------------------------------------------------------------

let authMode = "signin"; // or "signup"
const AUTH = {
  signin: {
    lede: "Welcome back. Sign in to see your pet.",
    submit: "Sign in",
    autocomplete: "current-password",
  },
  signup: {
    lede: "Pick a player ID and a password. Each ID has one pet, and it's yours.",
    submit: "Create account",
    autocomplete: "new-password",
  },
};

function setAuthMode(mode) {
  authMode = mode;
  for (const tab of ["signin", "signup"]) $(`tab-${tab}`).setAttribute("aria-selected", String(tab === mode));
  $("auth-lede").textContent = AUTH[mode].lede;
  $("auth-submit").textContent = AUTH[mode].submit;
  $("password").autocomplete = AUTH[mode].autocomplete;
  $("login-error").textContent = "";
}
$("tab-signin").addEventListener("click", () => setAuthMode("signin"));
$("tab-signup").addEventListener("click", () => setAuthMode("signup"));

// Back to the sign-in form, e.g. after signing out or when a session ends.
function showSignIn(message = "") {
  $("notice").textContent = "";
  hideAttacked();
  current = null;
  rivals = new Map();
  pinned = null;
  $("dashboard").hidden = true;
  $("signout").hidden = true;
  $("login").hidden = false;
  setAuthMode("signin");
  $("login-error").textContent = message;
}

const sessionEnded = () => showSignIn("Your session has ended. Sign in again to carry on.");

// "Not your pet": this browser's session now belongs to someone else, e.g.
// another tab signed in to a different account. Follow it, or ask to sign in.
async function sessionChanged() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return sessionEnded();
    const pet = await res.json();
    render(pet);
    $("notice").textContent = `This browser is now signed in as ${pet.id} (from another tab), so you're seeing ${pet.id}'s pet.`;
  } catch {
    sessionEnded();
  }
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("player-id").value.trim();
  const button = $("auth-submit");
  button.disabled = true;
  $("login-error").textContent = "";
  try {
    const res = await fetch(`/api/${authMode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, password: $("password").value }),
    });
    const body = await res.json();
    if (!res.ok) return void ($("login-error").textContent = body.error);
    $("password").value = "";
    render(body);
  } catch {
    $("login-error").textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});

// Only leave the pet once the server has really ended the session; otherwise
// the cookie would still be live behind a sign-in form.
$("signout").addEventListener("click", async () => {
  $("notice").textContent = "";
  try {
    const res = await fetch("/api/signout", { method: "POST" });
    if (!res.ok) throw new Error(`sign-out failed: ${res.status}`);
    showSignIn();
  } catch {
    $("notice").textContent = "Couldn't sign out, so you're still signed in. Check your connection and try again.";
  }
});

// A returning player with a live session goes straight to their pet.
fetch("/api/me")
  .then((res) => (res.ok ? res.json() : null))
  .then((pet) => (pet ? render(pet) : showSignIn()))
  .catch(() => showSignIn());

// Reconnects after a drop (e.g. the Fly machine waking up) and resyncs.
function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.addEventListener("open", async () => {
    $("live").textContent = "Live";
    $("live").dataset.state = "live";
    if (!current) return;
    const { id } = current;
    const seen = broadcasts;
    try {
      const res = await fetch(`/api/pets/${encodeURIComponent(id)}`);
      const pet = res.ok ? await res.json() : null;
      // Keep anything newer: a broadcast that landed meanwhile, or another pet
      // the player logged in as while this was in flight.
      if (pet && current?.id === id && broadcasts === seen) render(pet);
      loadArena(); // catch up on fights and rivals missed while disconnected
    } catch {
      ws.close(); // couldn't resync, so don't claim to be live; reconnect retries it
    }
  });
  ws.addEventListener("message", (msg) => {
    const event = JSON.parse(msg.data);
    if (event.type === "pet:updated" && rules) boardSaw(event.pet);
    if (event.type === "pet:updated" && event.pet.id === current?.id) {
      broadcasts++;
      render(event.pet);
    } else if (event.type === "pet:updated" && current && rules) {
      // Known rivals update in place; a pet we haven't seen (a new player)
      // joins the arena too.
      if (!arrival.has(event.pet.id)) arrival.set(event.pet.id, ++arrivals);
      rivals.set(event.pet.id, event.pet);
      trimRivals();
      renderRivals();
    } else if (event.type === "fight:finished") {
      onFight(event.fight);
    } else if (event.type === "feed:added" && current && rules) {
      feed.set(event.entry.id, event.entry);
      renderFeed();
    }
  });
  ws.addEventListener("close", () => {
    $("live").textContent = "Reconnecting…";
    $("live").dataset.state = "reconnecting";
    setTimeout(connect, 1000);
  });
}
connect();
