const $ = (id) => document.getElementById(id);
let current = null; // the pet this window is showing
let broadcasts = 0; // pet:updated events rendered; a resync older than one is stale
let rules = null; // schools, courses, items and costs, as the server publishes them
const busy = new Set(); // buttons whose request is still in flight
const LABELS = { strength: "Strength", intelligence: "Intelligence", charisma: "Charisma", stamina: "stamina", hygiene: "hygiene" };
const VERBS = { food: "Feed", soap: "Clean", hourglass: "Skip" };
// Keep this literal list identical to src/pets.ts: this unbundled browser
// cannot import the server module (which opens SQLite).
const APPEARANCES = ["cat", "dog", "hedgehog", "lizard", "panda", "bird", "dragon", "blob"];
const SVG_NS = "http://www.w3.org/2000/svg";
let pendingAppearance = null;
let atHome = true;
let savingSkills = false;
let activeSocket = null;
const sessionRefreshSockets = new WeakSet();
let onlinePlayers = new Set();
function updatePresence(players) {
  onlinePlayers = new Set(players);
  renderFightButtons();
  for (const status of document.querySelectorAll('[data-online-player]')) {
    status.textContent = onlinePlayers.has(status.dataset.onlinePlayer) ? 'Online' : 'Offline';
  }
  for (const button of $('theft-list').querySelectorAll('[data-thief]')) {
    button.disabled = revengePending || !onlinePlayers.has(button.dataset.thief);
    button.title = onlinePlayers.has(button.dataset.thief) ? '' : 'This player is offline.';
  }
}
document.addEventListener('presence:updated', event => updatePresence(event.detail));
document.addEventListener("world:scene", event => {
  atHome = event.detail.home;
  renderSkills();
});

function renderSkills() {
  if (!current || !rules) return;
  const selected = current.equippedAbilities || ["claw-strike"];
  $("home-skills-hint").textContent = atHome
    ? "Equip up to four skills before heading out. Claw Strike is always ready."
    : "Return to your storage chest at home to change battle skills.";
  const focus = document.activeElement?.dataset.equipSkill;
  $("home-skill-list").replaceChildren(...rules.fight.abilities.map(ability => {
    const learned = (current.abilities || ["claw-strike"]).includes(ability.id);
    const equipped = selected.includes(ability.id);
    const row = document.createElement("div"), content = document.createElement("div");
    row.className = "home-skill";
    row.dataset.equipped = String(equipped);
    const title = document.createElement("strong"), hint = document.createElement("small");
    title.textContent = `${ability.name} · ${ability.mpCost} MP`;
    hint.textContent = learned ? ability.description : "Find this skill in a woodland treasure chest.";
    content.append(title, hint);
    const button = document.createElement("button");
    button.type = "button"; button.className = "chip-btn chip-buy"; button.dataset.equipSkill = ability.id;
    button.textContent = ability.id === "claw-strike" ? "Always ready" : !learned ? "Not learned" : equipped ? "Unequip" : "Equip";
    button.setAttribute("aria-pressed", String(equipped));
    button.disabled = savingSkills || !atHome || !learned || ability.id === "claw-strike" || (!equipped && selected.length >= 4);
    button.addEventListener("click", () => saveSkills(equipped ? selected.filter(id => id !== ability.id) : [...selected, ability.id]));
    row.append(content, button);
    return row;
  }));
  $("home-skill-list").setAttribute("aria-busy", String(savingSkills));
  if (focus) [...$("home-skill-list").querySelectorAll("button")].find(button => button.dataset.equipSkill === focus && !button.disabled)?.focus();
}
async function saveSkills(abilities) {
  if (!current || savingSkills || !atHome) return;
  const owner = current.id, session = theftSession, before = current;
  savingSkills = true;
  $("home-skills-error").textContent = "";
  $("home-skills-status").textContent = "Saving skills…";
  renderSkills();
  try {
    const response = await fetch(`/api/pets/${encodeURIComponent(owner)}/equip-skills`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ abilities }),
    });
    const result = await response.json();
    if (current?.id !== owner || theftSession !== session) return;
    if (!response.ok) throw new Error(result.error || "Could not equip skills.");
    // HTTP is also server-confirmed, so a disconnected socket cannot leave
    // an old loadout on screen after a successful save.
    if (result.id === owner && current === before) render(result);
    $("home-skills-status").textContent = "Battle skills saved.";
  } catch (error) {
    if (current?.id === owner && theftSession === session) {
      $("home-skills-status").textContent = "";
      $("home-skills-error").textContent = error.message || "Could not save skills. Try again.";
    }
  } finally {
    savingSkills = false;
    renderSkills();
  }
}

// One renderer for the dashboard, rivals, leaderboard and feed. Only saved
// pet rows reach here; form drafts never change an avatar.
function renderPetAvatar(svg, pet) {
  const appearance = APPEARANCES.includes(pet.appearance) ? pet.appearance : "blob";
  const color = /^#[0-9a-f]{6}$/i.test(pet.color) ? pet.color : "#f59e0b";
  svg.setAttribute("viewBox", "0 0 120 110");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${pet.id}'s ${appearance}, color ${color}`);
  svg.dataset.appearance = appearance;
  svg.style.setProperty("--pet-color", color);
  svg.innerHTML = '<ellipse class="pet-shadow" cx="60" cy="102" rx="34" ry="6" /><g class="pet-body"><use /></g>';
  svg.querySelector("use").setAttribute("href", `#pet-${appearance}`);
}

function petAvatar(pet, inline = false) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `pet pet-small${inline ? " pet-inline" : ""}`);
  renderPetAvatar(svg, pet);
  return svg;
}

for (const appearance of APPEARANCES) {
  const option = document.createElement("option");
  option.value = appearance;
  option.textContent = appearance[0].toUpperCase() + appearance.slice(1);
  $("pet-appearance").append(option);
}

$("appearance-settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current || busy.has($("appearance-save"))) return;
  const change = { color: $("pet-color").value, appearance: $("pet-appearance").value };
  const pending = { id: current.id, ...change };
  pendingAppearance = pending;
  $("appearance-status").textContent = "Saving…";
  const saved = await perform($("appearance-save"), "appearance", "appearance-error", change);
  if (pendingAppearance !== pending) return; // already broadcast, or signed out
  if (saved) $("appearance-status").textContent = "Waiting for live update…";
  else {
    pendingAppearance = null;
    $("appearance-status").textContent = "";
  }
});
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
  const seconds = Math.ceil(((busyUntil - Date.now()) * rules.timeScale) / 1000);
  if (seconds <= 0) return "finishing…";
  if (seconds < 60) return `${seconds} s left`;
  const minutes = Math.ceil(seconds / 60);
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
  for (const coin of rules.treasure?.coins ?? []) {
    const card = document.createElement("div");
    card.className = "item item-coin";
    card.dataset.coin = coin.id;
    card.innerHTML = `<span><span class="coin-name"></span> × <span class="coin-count"></span></span>
      <span class="item-effect"></span>
      <button type="button" class="chip-btn coin-equip"></button>`;
    card.querySelector(".coin-name").textContent = coin.name;
    card.querySelector(".item-effect").textContent = coin.effect;
    const equip = card.querySelector(".coin-equip");
    equip.addEventListener("click", () =>
      perform(equip, `equip-coin/${current?.equippedCoin === coin.id ? "none" : coin.id}`, "care-error"));
    $("coins").append(card);
  }
  $("study-cost").textContent = `${lengthText(rules.study.minutes)} · ${costText(rules.study.cost)}`;
  $("skip").addEventListener("click", () => perform($("skip"), "use/hourglass", "care-error"));
  $("collect-supplies").addEventListener("click", () => perform($("collect-supplies"), "collect-supplies", "care-error"));
  $("fight-cost").textContent =
    `${costText(rules.fight.cost)} · winner takes ${rules.fight.spoils.share * 100}% of the loser's money`;
  $("visit-rules").textContent =
    `Visit a pet to steal $${rules.steal.min}–$${rules.steal.max}. Each pet can be robbed once per day across all players; resets at midnight ${rules.steal.resetTimezone}.`;
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
    return res.ok;
  } catch {
    $(errorId).textContent = "Couldn't reach the server, so nothing happened. Try again.";
  } finally {
    busy.delete(button);
    if (current) {
      if (rules) renderBusy(current);
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

function resetTownActivity() {
  $("town-activity").hidden = true;
  $("town-activity-label").textContent = "";
  $("town-activity-left").textContent = "";
  $("town-activity-percent").textContent = "";
  $("town-activity-fill").style.setProperty("--fill", "0");
  $("town-activity-progress").setAttribute("aria-valuenow", "0");
  $("town-activity-progress").removeAttribute("aria-valuetext");
}

function renderBusy(pet) {
  $("busy").hidden = pet.activity === "idle";
  if (pet.activity === "idle") return resetTownActivity();
  $("town-activity").hidden = false;
  $("town-activity-label").textContent = busyText(pet);
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
  const now = Date.now();
  const done = total > 0 ? Math.min(1, Math.max(0, (now - pet.busySince) / total)) : Number(now >= pet.busyUntil);
  const left = timeLeftText(pet.busyUntil), percent = Math.floor(done * 100);
  $("busy-progress-fill").style.setProperty("--fill", done);
  $("busy-progress").setAttribute("aria-valuenow", Math.round(done * 100));
  $("busy-left").textContent = left;
  // The town indicator shares this clock and the saved activity deadline.
  // At zero, wait for the server's idle update before hiding it.
  $("town-activity-fill").style.setProperty("--fill", done);
  $("town-activity-progress").setAttribute("aria-valuenow", percent);
  $("town-activity-progress").setAttribute("aria-valuetext", `${percent}% complete · ${left}`);
  $("town-activity-left").textContent = left;
  $("town-activity-percent").textContent = `${percent}%`;
}

// Free daily supplies, collectable again from the next UTC midnight. Checked
// each second too, so the button wakes up at midnight without a reload.
function renderSupplies(pet) {
  const free = rules.freeSupplies;
  const button = $("collect-supplies");
  const waiting = pet.suppliesAvailableAt !== null && Date.now() < pet.suppliesAvailableAt;
  button.disabled = busy.has(button) || waiting;
  button.textContent = waiting ? "Collected today" : `Collect ${free.food} Food + ${free.soap} Soap`;
  const at = waiting && new Date(pet.suppliesAvailableAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const text = waiting
    ? `More at midnight ${free.resetTimezone} (${at} your time).`
    : `Free once a day: ${free.food} Food and ${free.soap} Soap for your stock.`;
  if ($("free-supplies-text").textContent !== text) $("free-supplies-text").textContent = text;
}

// The clock ticks locally; the finish itself arrives as a broadcast.
setInterval(() => {
  if (rules && current?.busyUntil) renderBusyClock(current);
  if (rules && current?.suppliesAvailableAt) renderSupplies(current);
  if (rules && current && visiting) renderStealControls();
}, 1000);

function renderControls(pet) {
  $("appearance-save").disabled = busy.has($("appearance-save"));
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

  renderSupplies(pet);
  arenaBlock = occupied || blocker(pet, rules.fight.needs, "fight");
  $("arena-hint").textContent = arenaBlock;
  // A studying or working pet can't go exploring until it's done.
  $("adventure-hint").textContent = occupied;
  $("adventure-open").disabled = occupied !== "";
  renderFightButtons();

  for (const card of $("items").children) {
    const item = rules.items.find((i) => i.id === card.dataset.item);
    const use = card.querySelector(".chip-use");
    const buy = card.querySelector(".chip-buy");
    card.querySelector(".item-count").textContent = pet[item.id];
    use.disabled = busy.has(use) || pet[item.id] < 1 || !usable(item, pet);
    buy.disabled = busy.has(buy) || pet.money < item.price;
  }
  for (const card of $("coins").children) {
    const coin = rules.treasure.coins.find((c) => c.id === card.dataset.coin);
    const quantity = pet.coins?.[coin.id] ?? 0;
    const equipped = pet.equippedCoin === coin.id;
    card.querySelector(".coin-count").textContent = quantity;
    const equip = card.querySelector(".coin-equip");
    equip.textContent = equipped ? "Unequip" : "Equip";
    equip.setAttribute("aria-pressed", String(equipped));
    equip.disabled = busy.has(equip) || (quantity < 1 && !equipped);
  }
}

// Arena ---------------------------------------------------------------------

let rivals = new Map(); // pets shown in the arena, by ID
const arrival = new Map(); // when this page first saw each pet, newest highest
let arrivals = 0;
let pinned = null; // the pet the player looked up, shown first
let visiting = null; // the opponent whose pet is open in the visit panel
let visitLoads = 0;
let visitLoading = false;
let visitReady = false;
let stealing = false;
let helping = null; // "food" or "soap" while a help request is in flight
let fighting = false; // a fight request is in flight
let arenaBlock = ""; // why this pet can't fight right now, or ""
let avenging = null; // the pet that last attacked this one, for the Revenge button
const fightLog = [];
let feed = new Map(); // "Happening now" entries, by ID
let feedPets = new Map(); // only pets mentioned in the visible feed; null while loading

const powerOf = (pet) =>
  Object.entries(rules.fight.powerWeights).reduce((sum, [attribute, weight]) => sum + weight * pet[attribute], 0);

async function loadArena() {
  if (!current || !rules) return;
  const { id } = current;
  const previousRivals = new Map(rivals);
  feedPets = new Map(); // reconnects must refresh older pets outside the arena list
  try {
    const [list, fights, news] = await Promise.all([
      fetch("/api/pets?limit=20").then((res) => res.json()),
      fetch(`/api/pets/${encodeURIComponent(id)}/fights`).then((res) => res.json()),
      fetch(`/api/feed?limit=${FEED_SIZE}`).then((res) => res.json()),
    ]);
    if (current?.id !== id) return; // switched pets meanwhile
    const pin = pinned && rivals.get(pinned);
    const updated = [...rivals.values()].filter((pet) => previousRivals.get(pet.id) !== pet);
    rivals = new Map(list.filter((pet) => pet.id !== id).map((pet) => [pet.id, pet]));
    // The server lists newest first, so the first pet arrived last.
    arrival.clear();
    list.forEach((pet, i) => arrival.set(pet.id, -i));
    if (pin && !rivals.has(pin.id)) rivals.set(pin.id, pin);
    // Broadcasts are newer than the request, including newly joined players.
    for (const pet of updated) rivals.set(pet.id, pet);
    for (const pet of rivals.values()) if (!arrival.has(pet.id)) arrival.set(pet.id, ++arrivals);
    trimRivals();
    renderRivals();
    if (visiting) openVisit(visiting, false); // refresh a pinned pet after reconnecting
    fightLog.length = 0;
    fightLog.push(...fights);
    renderFightLog();
    // Merge, don't replace: an entry broadcast while this loaded is newer.
    for (const entry of news) feed.set(entry.id, entry);
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
  li.innerHTML = `<div class="rival-identity"><span class="rival-name"></span></div>
    <div class="rival-meta"></div>
    <div class="rival-stats"></div>
    <div class="rival-actions">
      <button type="button" class="chip-btn chip-buy visit-btn">Visit</button>
      <button type="button" class="chip-btn fight-btn">Fight</button>
    </div>`;
  li.querySelector(".rival-name").textContent = pet.id;
  li.querySelector(".rival-identity").prepend(petAvatar(pet));
  if (pet.id === rules.botId) li.querySelector(".rival-name").insertAdjacentHTML("afterend", '<span class="tag">bot</span>');
  li.querySelector(".rival-meta").textContent = `${school} · ${doing} · ${pet.wins}W ${pet.losses}L`;
  if (pet.id !== rules.botId) {
    const status = document.createElement('span');
    status.dataset.onlinePlayer = pet.id;
    status.textContent = onlinePlayers.has(pet.id) ? 'Online' : 'Offline';
    li.querySelector('.rival-meta').append(' · ', status);
  }
  li.querySelector(".rival-stats").innerHTML =
    `Power <b></b> · Str ${pet.strength} · Int ${pet.intelligence} · Cha ${pet.charisma}`;
  li.querySelector(".rival-stats b").textContent = powerOf(pet);
  const button = li.querySelector(".fight-btn");
  button.dataset.opponent = pet.id;
  button.setAttribute("aria-label", `Fight ${pet.id}`);
  button.addEventListener("click", () => startFight(pet.id));
  const visit = li.querySelector(".visit-btn");
  visit.dataset.pet = pet.id;
  visit.setAttribute("aria-label", `Visit ${pet.id}`);
  visit.setAttribute("aria-controls", "visit");
  visit.addEventListener("click", () => openVisit(pet.id));
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
  renderVisit();
}

function renderVisit() {
  const pet = rivals.get(visiting);
  $("visit").hidden = !pet || !current;
  // Playing with the visited pet lives in interact.js.
  if (!pet || !current) {
    document.dispatchEvent(new CustomEvent('visit:pet', { detail: null }));
    return;
  }
  $("visit-heading").textContent = `Visiting ${pet.id}`;
  renderPetAvatar($("visit-avatar"), pet);
  $("visit-activity").textContent = pet.activity === "idle" ? '' : busyText(pet);
  $("visit-money").textContent = `$${pet.money} saved`;
  for (const need of ["stamina", "hygiene"]) {
    const track = $(`visit-${need}`);
    track.setAttribute("aria-valuenow", pet[need]);
    track.querySelector(".meter-fill").style.setProperty("--fill", pet[need] / (rules?.maxCare ?? 100));
    $(`visit-${need}-value`).textContent = pet[need];
  }
  renderStealControls();
  renderHelpControls();
  document.dispatchEvent(new CustomEvent('visit:pet', { detail: pet }));
}

document.addEventListener('home:arrived', event => {
  if (current && visiting !== event.detail) openVisit(event.detail, false);
});

// Feeding or cleaning the visited pet spends one of your own Food or Soap.
function renderHelpControls() {
  const pet = rivals.get(visiting);
  if (!pet || !rules || !current) return;
  const items = rules.items.filter((i) => i.effect === "restore");
  const loading = visitLoading || !visitReady;
  // Why giving each item is off, or "" if you can give it.
  const why = (item) => {
    if (pet.id === rules.botId) return "The bot looks after itself.";
    if (current[item.id] < 1) return `You have no ${item.name.toLowerCase()} to give.`;
    if (pet[item.restores] >= rules.maxCare) return `${pet.id}'s ${item.restores} is full.`;
    return "";
  };
  for (const item of items) {
    const button = $(`help-${item.id}`);
    const verb = item.id === "food" ? "Feed" : "Clean";
    button.disabled = helping !== null || loading || why(item) !== "";
    button.textContent = helping === item.id ? `${verb}ing…` : `${verb} (+${item.amount} ${item.restores})`;
    button.setAttribute("aria-busy", String(helping === item.id));
  }
  const empty = items.filter((item) => current[item.id] < 1);
  let hint = [...new Set(items.map(why).filter(Boolean))].join(" ");
  if (pet.id !== rules.botId && empty.length === items.length) hint = "You have no food or soap to give.";
  if (pet.id !== rules.botId && empty.length) hint += " Buy some at the shop.";
  $("help-hint").textContent = loading ? ""
    : hint || `Uses your own food or soap. You have ${current.food} food and ${current.soap} soap.`;
}

function renderStealControls() {
  const pet = rivals.get(visiting);
  if (!pet || !rules) return;
  let reason = "";
  if (visitLoading) reason = "Loading pet…";
  else if (!visitReady) reason = "Couldn't load this pet. Leave and visit again to retry.";
  else if (pet.id === rules.botId) reason = "The bot doesn't take part in stealing.";
  else if (pet.stealAvailableAt > Date.now()) {
    reason = `Already robbed today. Protected until ${new Date(pet.stealAvailableAt).toLocaleString()} (midnight UTC).`;
  } else if (pet.money < rules.steal.min) reason = `This pet needs at least $${rules.steal.min} before you can steal.`;
  $("steal-hint").textContent = reason || "Take some money, then this pet is protected from everyone until midnight UTC.";
  $("steal").disabled = stealing || Boolean(reason);
  $("steal").textContent = stealing ? "Stealing…" : `Steal $${rules.steal.min}–$${Math.max(rules.steal.min, Math.min(rules.steal.max, pet.money))}`;
  $("steal").setAttribute("aria-busy", String(stealing));
}

async function openVisit(id, focus = true) {
  if (!current || id === current.id) return;
  const owner = current.id;
  const request = ++visitLoads;
  visiting = pinned = id;
  visitLoading = true;
  visitReady = false;
  $("steal-news").textContent = "";
  $("steal-error").textContent = "";
  $("help-news").textContent = "";
  $("help-error").textContent = "";
  renderVisit();
  if (focus) $("visit-heading").focus();
  const before = rivals.get(id);
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("pet unavailable");
    const pet = await res.json();
    if (request !== visitLoads || current?.id !== owner) return;
    // A broadcast received during this fetch already has fresher data.
    if (rivals.get(id) === before) rivals.set(id, pet);
    visitReady = true;
  } catch {
    if (request === visitLoads && current?.id === owner) {
      $("steal-error").textContent = "Couldn't load this pet. Leave and visit again to retry.";
    }
  } finally {
    if (request === visitLoads && current?.id === owner) {
      visitLoading = false;
      renderVisit();
      if (focus && visitReady) document.dispatchEvent(new CustomEvent('home:visit', { detail: rivals.get(visiting) }));
    }
  }
}

function closeVisit() {
  visiting = null;
  visitLoads++;
  visitReady = false;
  $("visit").hidden = true;
  document.dispatchEvent(new CustomEvent("visit:pet", { detail: null }));
  $("steal-news").textContent = "";
  $("steal-error").textContent = "";
  $("help-news").textContent = "";
  $("help-error").textContent = "";
}

$("visit-close").addEventListener("click", () => {
  const id = visiting;
  closeVisit();
  document.dispatchEvent(new CustomEvent('home:leave'));
  [...$("rivals").querySelectorAll(".visit-btn")].find((button) => button.dataset.pet === id)?.focus();
});

$("steal").addEventListener("click", async () => {
  if (!current || !visiting || $("steal").disabled || stealing) return;
  const owner = current.id;
  const target = visiting;
  const visit = visitLoads;
  stealing = true;
  $("steal-error").textContent = "";
  $("steal-news").textContent = "";
  renderStealControls();
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/steal/${encodeURIComponent(target)}`, { method: "POST" });
    if (current?.id !== owner) return;
    if (res.status === 401) return sessionEnded();
    if (res.status === 403) return sessionChanged();
    const body = await res.json();
    if (current?.id !== owner || visit !== visitLoads) return;
    if (!res.ok) $("steal-error").textContent = body.error ?? "Couldn't steal. Try again.";
    else $("steal-news").textContent = `You stole $${body.amount} from ${target}!`;
    // Balances and protection arrive through pet:updated in every window.
  } catch {
    if (current?.id === owner && visit === visitLoads) {
      $("steal-error").textContent = "Couldn't confirm the theft. Check your balance before trying again.";
    }
  } finally {
    stealing = false;
    renderStealControls();
  }
});

for (const button of document.querySelectorAll("[data-help]")) {
  button.addEventListener("click", async () => {
    if (!current || !visiting || button.disabled || helping) return;
    const owner = current.id;
    const target = visiting;
    const visit = visitLoads;
    const item = button.dataset.help;
    helping = item;
    $("help-error").textContent = "";
    $("help-news").textContent = "";
    renderHelpControls();
    try {
      const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/help/${encodeURIComponent(target)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item }),
      });
      if (current?.id !== owner) return;
      if (res.status === 401) return sessionEnded();
      if (res.status === 403) return sessionChanged();
      const body = await res.json();
      if (visit !== visitLoads) return;
      if (!res.ok) $("help-error").textContent = body.error ?? "Couldn't help. Try again.";
      else $("help-news").textContent = item === "food"
        ? `You fed ${target}: +${body.amount} stamina.`
        : `You cleaned ${target}: +${body.amount} hygiene.`;
      // Both pets' new counts arrive through pet:updated in every window.
    } catch {
      if (current?.id === owner && visit === visitLoads) {
        $("help-error").textContent = "Couldn't confirm that. Check your cupboard before trying again.";
      }
    } finally {
      helping = null;
      renderHelpControls();
    }
  });
}

function renderFightButtons() {
  for (const button of $("rivals").querySelectorAll(".fight-btn")) {
    const offline = button.dataset.opponent !== rules?.botId && !onlinePlayers.has(button.dataset.opponent);
    button.disabled = fighting || arenaBlock !== "" || offline;
    button.title = offline ? 'This player is offline. You can still visit their home.' : arenaBlock;
  }
  const offline = avenging && avenging !== rules?.botId && !onlinePlayers.has(avenging);
  $("revenge").disabled = fighting || arenaBlock !== "" || Boolean(offline);
  $("revenge").title = offline ? 'This player is offline.' : arenaBlock;
}

// Resolves true if the fight happened; otherwise says why in `errorId`.
async function startFight(opponent, errorId = "arena-error") {
  if (!current || fighting) return false;
  const owner = current.id;
  const session = theftSession;
  const active = () => current?.id === owner && theftSession === session;
  fighting = true;
  renderFightButtons();
  $(errorId).textContent = "";
  try {
    // No local update: the fight:finished and pet:updated broadcasts tell the story.
    const res = await fetch(`/api/pets/${encodeURIComponent(current.id)}/fight/${encodeURIComponent(opponent)}`, {
      method: "POST",
    });
    if (!active()) return false;
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
    if (res.ok) {
      const body = await res.json();
      if (active()) body.session ? showLiveBattle(body.session) : onFight(body.fight);
    }
    return res.ok;
  } catch {
    if (active()) $(errorId).textContent = "Couldn't confirm the fight. Check recent fights before trying again.";
    return false;
  } finally {
    if (active()) {
      fighting = false;
      renderFightButtons();
    }
  }
}

// How a fight went, from this player's side.
function describeFight(fight) {
  const me = current.id;
  const won = fight.winner === me;
  const rolls = fight.battle
    ? `${fight.battle.turns.reduce((count, step) => count + step.hits, 0)} claw strikes`
    : `${fight.attackerRoll} vs ${fight.defenderRoll}`;
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
      if (fight.battle) {
        const replay = document.createElement("button");
        replay.type = "button";
        replay.className = "chip-btn chip-buy";
        replay.textContent = "Watch battle";
        replay.addEventListener("click", () => showFightScene(fight, true));
        li.append(replay);
      }
      return li;
    }),
  );
}

function showFightScene(fight, replay = false) {
  if (!current || !fight.battle) return;
  document.dispatchEvent(new CustomEvent("battle:show", { detail: {
    key: `fight:${fight.id}`, battle: fight.battle, viewer: current.id,
    title: "Arena battle", result: describeFight(fight).text, replay,
  } }));
}

const liveBattles = new Map();
let refreshingBattles = false;
let battleRefreshTimer = null;
function showLiveBattle(session) {
  if (!current || !session?.battle?.fighters.some(fighter => fighter.id === current.id)) return;
  const prior = liveBattles.get(session.id);
  if (prior && prior.battle.revision > session.battle.revision) return;
  liveBattles.set(session.id, session);
  if (session.battle.status === "active" && battleRefreshTimer === null) {
    battleRefreshTimer = setInterval(() => { if (!document.hidden && current) loadLiveBattles(); }, 1000);
  } else if (![...liveBattles.values()].some(saved => saved.battle.status === "active")) {
    clearInterval(battleRefreshTimer);
    battleRefreshTimer = null;
  }
  const owner = current.id;
  const result = session.result;
  let text = result?.fight ? describeFight(result.fight).text : "The battle is over.";
  if (session.kind === "revenge" && result) {
    text = session.attacker === owner
      ? result.won ? `Recovered $${result.reward} and gained +1 to each attribute.` : "The revenge attempt is used. No extra money was lost."
      : result.won ? `Revenge succeeded. You paid back $${result.reward}.` : "You defended against revenge.";
  }
  document.dispatchEvent(new CustomEvent("battle:show", { detail: {
    key: `session:${session.id}`, battle: session.battle, viewer: owner,
    title: session.kind === "revenge" ? "Revenge battle" : "Arena battle",
    manual: true, result: text, showLog: false, allowReplay: false,
    onChoose: (ability, revision) => actInBattle(session.id, "turn", { ability, revision }),
    onForfeit: revision => actInBattle(session.id, "forfeit", { revision }),
  } }));
  if (result?.fight) onFight(result.fight);
  if (session.kind === "revenge" && session.battle.status === "finished" && prior?.battle.status !== "finished") loadThefts();
}
async function actInBattle(id, action, payload) {
  const owner = current?.id, login = theftSession;
  if (!owner) return;
  const response = await fetch(`/api/battles/${encodeURIComponent(id)}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (current?.id !== owner || theftSession !== login) return;
  if (!response.ok) {
    // Read after a rejected/stale choice so the displayed turn can recover.
    await loadLiveBattles();
    throw new Error(result.error || "Could not save this move. Try again.");
  }
  showLiveBattle(result.session);
}
async function loadLiveBattles() {
  if (!current || refreshingBattles) return;
  const owner = current.id, login = theftSession;
  refreshingBattles = true;
  try {
    const [response, ...known] = await Promise.all([
      fetch("/api/battles", { cache: "no-store" }),
      ...[...liveBattles.values()].filter(session => session.battle.status === "active")
        .map(session => fetch(`/api/battles/${encodeURIComponent(session.id)}`, { cache: "no-store" })),
    ]);
    const data = await response.json();
    const recent = await Promise.all(known.map(async res => res.ok ? (await res.json()).session : null));
    if (current?.id !== owner || theftSession !== login || !response.ok) return;
    for (const session of [...(Array.isArray(data) ? data : data.sessions || []), ...recent.filter(Boolean)]) {
      const before = liveBattles.get(session.id);
      if (!before || before.battle.revision !== session.battle.revision || before.battle.status !== session.battle.status) showLiveBattle(session);
    }
  } catch {
    // The next refresh recovers the saved turn; no move is resubmitted.
  } finally {
    refreshingBattles = false;
  }
}
function onFight(fight) {
  if (!current || (fight.attacker !== current.id && fight.defender !== current.id)) return;
  // The live session already shows its final turn. Saved fights remain
  // available in the journal without opening a second playback.
  if (fight.battle?.status === undefined) showFightScene(fight);
  if (fightLog.some((entry) => entry.id === fight.id)) return;
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
    case "revenge":
      return [entry.pet, entry.won ? ` won revenge and recovered $${entry.amount} from ` : " failed revenge against ", entry.other, "."];
    case "stole":
      return [entry.pet, ` stole $${entry.amount} from `, entry.other, "."];
    case "helped":
      return [entry.pet, entry.item === "food" ? " fed " : " cleaned ", entry.other, "."];
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
  const ids = new Set(entries.flatMap((entry) => (feedText(entry) ?? []).filter((_, i) => i % 2 === 0)));
  for (const id of feedPets.keys()) if (!ids.has(id)) feedPets.delete(id);
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
        const identity = document.createElement("span");
        identity.className = "feed-pet";
        const pet = part === current?.id ? current : rivals.get(part) ?? feedPets.get(part);
        if (pet) identity.append(petAvatar(pet, true));
        else loadFeedPet(part);
        identity.append(b);
        text.append(identity);
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

// Feed entries store IDs, including older players outside /api/pets' limit.
// Load those rows once, and let broadcasts win if one arrives during the fetch.
async function loadFeedPet(id) {
  if (feedPets.has(id)) return;
  const cache = feedPets;
  cache.set(id, null);
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`server error ${res.status}`);
    const pet = await res.json();
    if (feedPets !== cache || cache.get(id) !== null) return;
    cache.set(id, pet);
    renderFeed();
  } catch {
    // Keep the name visible; another feed render or reconnect can retry.
    if (cache.get(id) === null) cache.delete(id);
  }
}

// Leaderboard ---------------------------------------------------------------

let boardBy = "wins"; // or "power"
let board = []; // the top pets, as the server last ranked them
let boardLoaded = false; // false: fetch it when the tab is next shown
let boardTimer = null;
let boardRequests = 0; // only the newest request's answer is shown
const boardOpen = () => !$("arena-board").hidden;

// Positive if `a` ranks above `b` on the current board (ties broken by the server).
const outranks = (a, b) =>
  boardBy === "wins" ? a.wins - b.wins || b.losses - a.losses : powerOf(a) - powerOf(b);

async function loadBoard() {
  const request = ++boardRequests;
  const seen = broadcasts;
  clearTimeout(boardTimer);
  try {
    const res = await fetch(`/api/leaderboard?by=${boardBy}`);
    if (!res.ok) throw new Error(`server error ${res.status}`);
    const pets = await res.json();
    if (request !== boardRequests) return; // a newer request (or order) is on its way
    if (seen !== broadcasts) return reloadBoard(); // keep newer broadcast appearances
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
      li.innerHTML = '<span class="board-identity"><span class="board-name"></span></span><span class="board-score"><b></b> <span></span></span>';
      li.querySelector(".board-name").textContent = mine ? `${pet.id} (you)` : pet.id;
      li.querySelector(".board-identity").prepend(petAvatar(pet));
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

// A pet changed. If that could change the board, ask the server to re-rank it;
// a row whose score didn't move just shows the pet as broadcast.
function boardSaw(pet) {
  if (pet.id === rules.botId) return;
  // Still loading (or failed): this change may be newer than the answer, so ask again.
  if (!boardLoaded) return void (boardOpen() && reloadBoard());
  const shown = board.findIndex((p) => p.id === pet.id);
  if (shown >= 0 && outranks(pet, board[shown]) === 0) {
    board[shown] = pet;
    return renderBoard();
  }
  const last = board[board.length - 1];
  if (shown < 0 && board.length >= rules.leaderboardSize && outranks(pet, last) < 0) return;
  if (!boardOpen()) return void (boardLoaded = false);
  reloadBoard();
}

// One fetch for a burst of changes.
function reloadBoard() {
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
    boardLoaded = false;
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
    openVisit(pet.id);
  } catch {
    $("arena-error").textContent = "Couldn't reach the server. Try again.";
  }
});

function render(pet) {
  const previous = current;
  current = pet;
  if (previous?.id !== pet.id) {
    clearThefts();
    loadThefts();
    loadLiveBattles();
  }
  document.dispatchEvent(new CustomEvent("adventure:pet", { detail: pet }));
  renderPetAvatar($("pet-avatar"), pet);
  const confirmed = pendingAppearance?.id === pet.id && pendingAppearance.appearance === pet.appearance &&
    pendingAppearance.color.toLowerCase() === pet.color.toLowerCase();
  if (previous?.id !== pet.id || previous.color !== pet.color || previous.appearance !== pet.appearance || confirmed) {
    $("pet-color").value = pet.color;
    $("pet-appearance").value = pet.appearance;
  }
  if (previous?.id !== pet.id) {
    pendingAppearance = null;
    $("appearance-status").textContent = "";
    $("appearance-error").textContent = "";
  } else if (confirmed) {
    pendingAppearance = null;
    $("appearance-status").textContent = "Appearance saved.";
  }
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
    $("learned-abilities").textContent = rules.fight.abilities.filter(a => (pet.abilities || ['claw-strike']).includes(a.id))
      .map(a => `${a.name} (${a.mpCost} MP)`).join(' · ');
    renderSkills();
    renderBusy(pet);
    renderSchool(pet, previous);
    renderControls(pet);
    if (visiting) renderHelpControls(); // your own food and soap decide what you can give
    if (previous?.id !== pet.id) {
      closeVisit();
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

// Saved theft reports are separate from the short public activity feed.
let theftRequest = 0;
let revengePending = false;
let theftSession = 0; // late actions belong only to the login that started them
function clearThefts() {
  fighting = false;
  updatePresence([]);
  document.dispatchEvent(new CustomEvent("battle:reset"));
  document.dispatchEvent(new CustomEvent("adventure:reset"));
  theftSession++;
  liveBattles.clear();
  clearInterval(battleRefreshTimer);
  battleRefreshTimer = null;
  savingSkills = false;
  if (activeSocket) {
    sessionRefreshSockets.add(activeSocket);
    activeSocket.close?.(4000, 'Session changed');
  }
  revengePending = false;
  $("theft-list").setAttribute("aria-busy", "false");
  theftRequest++;
  $("theft-notifications").hidden = true;
  $("theft-list").replaceChildren();
  $("theft-status").textContent = "";
  $("theft-error").textContent = "";
  $("theft-retry").hidden = true;
}

async function loadThefts() {
  if (!current) return;
  const owner = current.id;
  const request = ++theftRequest;
  try {
    const res = await fetch("/api/thefts", { cache: "no-store" });
    if (current?.id !== owner || request !== theftRequest) return;
    if (res.status === 401) return sessionEnded();
    if (!res.ok) throw new Error("Could not load thefts");
    const thefts = await res.json();
    if (current?.id !== owner || request !== theftRequest) return;
    $("theft-list").replaceChildren();
    $("theft-error").textContent = "";
    $("theft-retry").hidden = true;
    for (const theft of thefts) {
      const row = document.createElement("div");
      row.className = "theft-report";
      const text = document.createElement("p");
      text.textContent = `${theft.thief} stole $${theft.amount} from you on ${new Date(theft.stolenAt).toLocaleString()}. Win revenge for $${theft.amount * 2}.`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip-btn chip-fight";
      button.textContent = `Take revenge on ${theft.thief}`;
      button.dataset.thief = theft.thief;
      button.disabled = revengePending || !onlinePlayers.has(theft.thief);
      button.title = onlinePlayers.has(theft.thief) ? '' : 'This player is offline.';
      button.addEventListener("click", () => takeRevenge(theft.id, owner));
      row.append(text, button);
      $("theft-list").append(row);
    }
    $("theft-notifications").hidden = !thefts.length && !$("theft-status").textContent;
  } catch {
    if (current?.id !== owner || request !== theftRequest) return;
    $("theft-notifications").hidden = false;
    $("theft-error").textContent = "Couldn't load theft notifications. Try again.";
    $("theft-retry").hidden = false;
  }
}

async function takeRevenge(id, owner) {
  if (revengePending || current?.id !== owner) return;
  const session = theftSession;
  const active = () => current?.id === owner && theftSession === session;
  revengePending = true;
  $("theft-list").setAttribute("aria-busy", "true");
  for (const button of $("theft-list").querySelectorAll("button")) button.disabled = true;
  $("theft-error").textContent = "";
  $("theft-status").textContent = "Taking revenge…";
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/revenge/${id}`, { method: "POST" });
    if (!active()) return;
    if (res.status === 401) return sessionEnded();
    if (res.status === 403) return sessionChanged();
    const body = await res.json();
    if (!active()) return;
    if (!res.ok) {
      $("theft-status").textContent = "";
      $("theft-error").textContent = body.error ?? "Couldn't take revenge. Try again.";
      return;
    }
    if (body.session) {
      $("theft-status").textContent = "Revenge battle started. Choose your pet's moves in the battle window.";
      showLiveBattle(body.session);
      return;
    }
    $("theft-status").textContent = body.won
      ? `Revenge succeeded! You recovered $${body.reward} and gained +1 Strength, Intelligence and Charisma.`
      : "Revenge failed. No extra money was lost. This theft's revenge attempt is used.";
    document.dispatchEvent(new CustomEvent("battle:show", { detail: {
      key: `revenge:${body.theft?.id}`, battle: body.battle, viewer: owner,
      title: "Theft revenge", result: $("theft-status").textContent,
    } }));
    await loadThefts();
  } catch {
    if (active()) {
      $("theft-status").textContent = "";
      $("theft-error").textContent = "Couldn't confirm revenge. Reload notifications before retrying.";
      $("theft-retry").hidden = false;
    }
  } finally {
    if (active()) {
      revengePending = false;
      $("theft-list").setAttribute("aria-busy", "false");
      updatePresence([...onlinePlayers]);
    }
  }
}
$("theft-retry").addEventListener("click", loadThefts);

// Accounts --------------------------------------------------------------------

let authMode = "signin"; // or "signup"
const AUTH = {
  signin: {
    submit: "Sign in",
    autocomplete: "current-password",
  },
  signup: {
    submit: "Create account",
    autocomplete: "new-password",
  },
};

function setAuthMode(mode) {
  authMode = mode;
  for (const tab of ["signin", "signup"]) $(`tab-${tab}`).hidden = tab === mode;
  for (const field of ["player-id", "password"]) {
    $(`${field}-help`).hidden = mode !== "signup";
    $(field).setAttribute("aria-describedby", mode === "signup" ? `${field}-help login-error` : "login-error");
  }
  $("auth-heading").textContent = AUTH[mode].submit;
  $("auth-submit").textContent = AUTH[mode].submit;
  $("password").autocomplete = AUTH[mode].autocomplete;
  $("login-error").textContent = "";
}
for (const mode of ["signin", "signup"]) {
  $(`tab-${mode}`).addEventListener("click", () => {
    setAuthMode(mode);
    $("player-id").focus();
  });
}

// Back to the sign-in form, e.g. after signing out or when a session ends.
function showSignIn(message = "") {
  clearThefts();
  $("notice").textContent = "";
  hideAttacked();
  closeVisit();
  current = null;
  resetTownActivity();
  pendingAppearance = null;
  feedPets = new Map();
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
  activeSocket = ws;
  ws.addEventListener("open", async () => {
    if (activeSocket !== ws) return;
    $("live").textContent = "Live";
    $("live").dataset.state = "live";
    if (!current) return;
    loadThefts();
    loadLiveBattles();
    document.dispatchEvent(new CustomEvent("realtime:resync")); // touches missed while disconnected
    const { id } = current;
    const before = current;
    try {
      const res = await fetch(`/api/pets/${encodeURIComponent(id)}`);
      const pet = res.ok ? await res.json() : null;
      // Keep anything newer: a broadcast that landed meanwhile, or another pet
      // the player logged in as while this was in flight.
      if (pet && current?.id === id && current === before) render(pet);
      loadArena(); // catch up on fights and rivals missed while disconnected
    } catch {
      ws.close(); // couldn't resync, so don't claim to be live; reconnect retries it
    }
  });
  ws.addEventListener("message", (msg) => {
    if (activeSocket !== ws) return;
    const event = JSON.parse(msg.data);
    if (event.type === 'presence:updated') document.dispatchEvent(new CustomEvent('presence:updated', { detail: event.players }));
    if (event.type === 'world:updated') document.dispatchEvent(new CustomEvent('world:updated', { detail: event.player }));
    if (event.type === "pet:updated") {
      broadcasts++;
      if (feedPets.has(event.pet.id)) feedPets.set(event.pet.id, event.pet);
    }
    if (event.type === "pet:updated" && rules) boardSaw(event.pet);
    if (event.type === "pet:updated" && event.pet.id === current?.id) {
      render(event.pet);
    } else if (event.type === "pet:updated" && current && rules) {
      // Known rivals update in place; a pet we haven't seen (a new player)
      // joins the arena too.
      if (!arrival.has(event.pet.id)) arrival.set(event.pet.id, ++arrivals);
      rivals.set(event.pet.id, event.pet);
      trimRivals();
      renderRivals();
    } else if (event.type === "team:updated") {
      document.dispatchEvent(new CustomEvent("team:updated", { detail: event.team }));
    } else if (event.type === "pet:touched") {
      document.dispatchEvent(new CustomEvent("pet:touched", { detail: event.touch }));
    } else if (event.type === "fight:finished") {
      onFight(event.fight);
    } else if (event.type === "battle:updated") {
      showLiveBattle(event.session);
    } else if (event.type === "feed:added" && current && rules) {
      feed.set(event.entry.id, event.entry);
      renderFeed();
      if (event.entry.kind === "revenge" && event.entry.pet === current.id) loadThefts();
      if (event.entry.kind === "helped" && event.entry.other === current.id) {
        $("notice").textContent = event.entry.item === "food"
          ? `${event.entry.pet} fed your pet with their own food.`
          : `${event.entry.pet} cleaned your pet with their own soap.`;
      }
      if (event.entry.kind === "stole" && event.entry.other === current.id) {
        loadThefts();
        $("notice").textContent = `${event.entry.pet} stole $${event.entry.amount} from your pet. Your pet is protected from theft until midnight UTC.`;
      }
    }
    if (event.type === "pet:updated" && current && rules) renderFeed();
  });
  ws.addEventListener("close", (event) => {
    if (activeSocket !== ws) return;
    document.dispatchEvent(new CustomEvent('presence:updated', { detail: [] }));
    document.dispatchEvent(new CustomEvent('realtime:offline'));
    $("live").textContent = "Reconnecting…";
    $("live").dataset.state = "reconnecting";
    // A connecting socket or proxy may report a different close code. Our
    // own session refresh still needs to reconnect without the retry delay.
    setTimeout(connect, sessionRefreshSockets.has(ws) ? 0 : 1000);
  });
}
connect();
