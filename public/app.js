const $ = (id) => document.getElementById(id);
let current = null; // the pet this window is showing
let broadcasts = 0; // pet:updated events rendered; a resync older than one is stale
let rules = null; // schools, courses, items and costs, as the server publishes them
const busy = new Set(); // buttons whose request is still in flight
const LABELS = { strength: "Strength", intelligence: "Intelligence", charisma: "Charisma", stamina: "stamina", hygiene: "hygiene" };
const VERBS = { food: "Feed", soap: "Clean" };

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
    card.className = `item item-${item.restores}`;
    card.dataset.item = item.id;
    card.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${item.id}" /></svg>
      <span><span class="item-name"></span> × <span class="item-count"></span></span>
      <span class="item-effect"></span>
      <div class="item-actions">
        <button type="button" class="chip-btn chip-use"></button>
        <button type="button" class="chip-btn chip-buy"></button>
      </div>`;
    card.querySelector(".item-name").textContent = item.name;
    card.querySelector(".item-effect").textContent = `+${item.amount} ${LABELS[item.restores]}`;
    const use = card.querySelector(".chip-use");
    const buy = card.querySelector(".chip-buy");
    use.textContent = VERBS[item.id] ?? "Use";
    buy.textContent = `Buy $${item.price}`;
    use.addEventListener("click", () => perform(use, `use/${item.id}`, "care-error"));
    buy.addEventListener("click", () => perform(buy, `buy/${item.id}`, "care-error"));
    $("items").append(card);
  }
  $("study-cost").textContent = `${lengthText(rules.study.minutes)} · ${costText(rules.study.cost)}`;
  $("fight-cost").textContent = costText(rules.fight.cost);
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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $(errorId).textContent = body.error ?? `Something went wrong (server error ${res.status}). Try again.`;
    }
  } catch {
    $(errorId).textContent = "Couldn't reach the server, so nothing happened. Try again.";
  } finally {
    busy.delete(button);
    if (current) renderControls(current);
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
    use.disabled = busy.has(use) || pet[item.id] < 1 || pet[item.restores] >= rules.maxCare;
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
const fightLog = [];

const powerOf = (pet) =>
  Object.entries(rules.fight.powerWeights).reduce((sum, [attribute, weight]) => sum + weight * pet[attribute], 0);

async function loadArena() {
  if (!current || !rules) return;
  const { id } = current;
  try {
    const [list, fights] = await Promise.all([
      fetch("/api/pets?limit=20").then((res) => res.json()),
      fetch(`/api/pets/${encodeURIComponent(id)}/fights`).then((res) => res.json()),
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
}

async function startFight(opponent) {
  if (!current) return;
  fighting = true;
  renderFightButtons();
  $("arena-error").textContent = "";
  try {
    // No local update: the fight:finished and pet:updated broadcasts tell the story.
    const res = await fetch(`/api/pets/${encodeURIComponent(current.id)}/fight/${encodeURIComponent(opponent)}`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      $("arena-error").textContent = body.error ?? `Something went wrong (server error ${res.status}). Try again.`;
    }
  } catch {
    $("arena-error").textContent = "Couldn't reach the server, so the fight didn't happen. Try again.";
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
  if (fight.attacker === me) {
    return { won, rolls, text: won ? `You beat ${fight.defender}!` : `${fight.defender} beat you.` };
  }
  return { won, rolls, text: `${fight.attacker} attacked you and ${won ? "lost!" : "won."}` };
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
}

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
      loadArena();
    }
  }
  $("login").hidden = true;
  $("dashboard").hidden = false;
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("player-id").value.trim();
  const button = e.submitter ?? $("login").querySelector("button");
  button.disabled = true;
  $("login-error").textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await res.json();
    if (!res.ok) return void ($("login-error").textContent = body.error);
    render(body);
  } catch {
    $("login-error").textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    button.disabled = false;
  }
});

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
    }
  });
  ws.addEventListener("close", () => {
    $("live").textContent = "Reconnecting…";
    $("live").dataset.state = "reconnecting";
    setTimeout(connect, 1000);
  });
}
connect();
