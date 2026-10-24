const adventure = document.createElement('dialog');
adventure.id = 'adventure-dialog';
adventure.setAttribute('aria-labelledby', 'adventure-title');
// The Adventure fills the screen: a slim top bar, the map, and a bottom bar
// with the HP/MP rings on the left and the movement pad on the right. Every
// explanation and reference table lives in the Game guide window instead.
adventure.innerHTML = `
  <header class="adventure-top"><div><p class="section-label" id="adventure-floor">ADVENTURE · FLOOR 1 / 5</p><h2 id="adventure-title">Woodland clearing</h2></div>
    <div class="adventure-header-actions">
      <button type="button" id="adventure-pack-toggle" class="chip-btn chip-buy" aria-expanded="false" aria-controls="adventure-pack-panel">Menu</button>
    </div></header>
  <div class="adventure-stage">
    <div class="adventure-side" id="adventure-pack-panel" hidden>
      <div class="adventure-menu-actions">
        <button type="button" id="adventure-guide-open" class="chip-btn chip-buy" aria-haspopup="dialog">Game guide</button>
        <button type="button" id="adventure-close" class="chip-btn">End adventure</button>
      </div>
      <section id="adventure-team" aria-labelledby="adventure-team-heading" hidden>
        <h3 id="adventure-team-heading">Your team</h3>
        <ul id="adventure-team-list"></ul>
      </section>
      <details class="adventure-backpack">
        <summary id="adventure-backpack-title">Your backpack</summary>
        <p class="help" id="adventure-care"></p>
        <p id="adventure-floor-key" role="status"></p>
        <ul id="adventure-items"></ul>
        <h4>Learned abilities</h4><ul id="adventure-abilities"></ul>
        <h4>Unfair coins</h4><ul id="adventure-coins"></ul>
      </details>
      <button type="button" id="adventure-abandon" class="chip-btn chip-buy" hidden>End adventure</button>
      <div id="adventure-menu-cooldown"></div>
    </div>
    <div class="adventure-board">
      <div id="adventure-grid" role="img" aria-label="Woodland map" aria-describedby="adventure-movement-tip" tabindex="0"></div>
      <p id="adventure-movement-tip"><kbd>W/A/S/D</kbd> move · <kbd>Space</kbd> interact<br><span>Tap a path to walk. Tall grass may hide a surprise.</span></p>
      <p id="adventure-status" role="status" class="visually-hidden">Opening the clearing…</p>
      <div class="adventure-messages">
        <p id="adventure-notice" role="status"></p>
        <p id="adventure-treasure" role="status"></p>
      </div>
      <section id="adventure-battle-summary" class="adventure-run-summary" aria-labelledby="adventure-summary-title" hidden>
        <p class="section-label">RUN FINISHED</p>
        <h2 id="adventure-summary-title">Adventure over</h2>
        <p id="adventure-completion" role="status" hidden>The Slime King is defeated!</p>
        <p id="adventure-failure" role="status" hidden></p>
        <p id="adventure-result" role="status"></p>
        <button type="button" id="adventure-replay" class="chip-btn chip-buy" aria-expanded="false" aria-controls="adventure-records">Battle records</button>
        <ol id="adventure-records" hidden></ol>
        <div id="adventure-finish-cooldown">
        <div id="adventure-cooldown-panel" hidden>
          <div class="adventure-cooldown-heading"><span id="adventure-cooldown-label">Next adventure</span><span id="adventure-cooldown-percent">0%</span></div>
          <div id="adventure-cooldown-progress" class="progress" role="progressbar" aria-labelledby="adventure-cooldown-label" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div id="adventure-cooldown-fill" class="progress-fill"></div>
          </div>
          <p id="adventure-cooldown" role="status" hidden></p>
        </div>
        </div>
        <div class="adventure-buttons">
          <button type="button" id="adventure-skip-cooldown" class="chip-btn" hidden>Skip wait (use Hourglass)</button>
          <button type="button" id="adventure-restart" class="chip-btn" hidden>Start new adventure</button>
          <button type="button" id="adventure-team-up" class="chip-btn chip-buy" hidden>Team up</button>
          <button type="button" id="adventure-return-town" class="chip-btn chip-buy">Return to town</button>
        </div>
      </section>
      <button type="button" id="adventure-continue" class="chip-btn adventure-continue" hidden>Return to exploration</button>
    </div>
  </div>
  <footer class="adventure-hud">
    <div class="adventure-gauges">
      <div class="adventure-gauge adventure-gauge-hp" id="adventure-hp-ring" role="meter" aria-label="HP" aria-valuemin="0">
        <span class="adventure-gauge-value"><b>HP</b><span id="adventure-hp-text"></span></span>
      </div>
      <div class="adventure-gauge adventure-gauge-mp" id="adventure-mp-ring" role="meter" aria-label="MP" aria-valuemin="0">
        <span class="adventure-gauge-value"><b>MP</b><span id="adventure-mp-text"></span></span>
      </div>
      <p id="adventure-resources" class="visually-hidden" aria-live="polite"></p>
    </div>
    <div class="adventure-actions">
      <button type="button" id="adventure-open-chest" class="chip-btn" disabled>Open chest</button>
      <button type="button" id="adventure-ascend" class="chip-btn" disabled>↑ Ascend</button>
      <button type="button" id="adventure-descend" class="chip-btn" disabled>↓ Descend</button>
    </div>
    <div class="adventure-controls" aria-label="Movement controls">
      <button type="button" data-direction="w" aria-label="Move up">↑</button>
      <button type="button" data-direction="a" aria-label="Move left">←</button>
      <button type="button" data-direction="s" aria-label="Move down">↓</button>
      <button type="button" data-direction="d" aria-label="Move right">→</button>
    </div>
  </footer>`;
document.body.append(adventure);
// Everything a player might look up, kept off the map: how to play, the map
// key, this floor's monsters, treasure odds, and what a new run costs. It
// opens on its own for a pet's first adventure, and from Game guide after.
const guide = document.createElement('dialog');
guide.id = 'adventure-guide';
guide.setAttribute('aria-labelledby', 'adventure-guide-title');
guide.innerHTML = `
  <header><div><p class="section-label">ADVENTURE</p><h2 id="adventure-guide-title">Game guide</h2></div>
    <button type="button" id="adventure-guide-close" class="chip-btn">Close</button></header>
  <section aria-labelledby="adventure-guide-play">
    <h3 id="adventure-guide-play">How to play</h3>
    <ul class="adventure-guide-list">
      <li>Move with W/A/S/D, the arrow keys, or the arrow pad.</li>
      <li>Space opens a chest or takes the stairs you stand on.</li>
      <li>Walk through tall grass for a chance of a surprise battle.</li>
      <li>Defeated monsters have a 5% chance to drop a Floor Key. Use it at the locked stairs to unlock the next floor.</li>
      <li>Monsters keep appearing while the key is missing. A team's key and unlocked exit are shared.</li>
      <li>Clear paths are safe. Standing still never starts an encounter.</li>
      <li>The Slime King guards the final grove. Walk up to it to battle.</li>
      <li>HP and MP carry between battles. A win gives back 20%.</li>
      <li>Each win trains your pet: +1 to the attribute behind your final hit (Strength for Claw Strike, Heavy Strike and Tide Crash, Intelligence for Firebolt, Charisma for Vine Lash). Beating the Slime King gives +1 to all three.</li>
      <li>A coin toss decides who strikes first.</li>
      <li>Choose an equipped skill on your turn. Equip learned skills at your storage chest at home.</li>
      <li>Monsters have types: Fire beats Grass, Water beats Earth, and Grass beats Water for double damage. Other elemental hits on a monster do half. Normal skills always hit evenly.</li>
      <li>Your coin always applies in solo battles. In a team, the pet with the highest total attributes supplies the coin.</li>
      <li>Teammates beside you join your battles.</li>
      <li>On a team, each chest opens once, for whoever gets there first.</li>
    </ul>
  </section>
  <section aria-labelledby="adventure-guide-map">
    <h3 id="adventure-guide-map">Map key</h3>
    <div class="adventure-legend"></div>
    <p class="help" id="adventure-stair-hint"></p>
  </section>
  <section aria-labelledby="adventure-guide-monsters">
    <h3 id="adventure-guide-monsters">Monster attributes</h3>
    <ul id="adventure-enemies"></ul>
  </section>
  <section aria-labelledby="adventure-guide-treasure">
    <h3 id="adventure-guide-treasure">Treasure odds</h3>
    <p class="help">Each chest gives one reward: Food 30% · Soap 30% · Ability 20% · Hourglass 15% · Coin 5%.</p>
  </section>
  <section aria-labelledby="adventure-guide-runs">
    <h3 id="adventure-guide-runs">New runs</h3>
    <p class="help" id="adventure-restart-cost"></p>
  </section>`;
document.body.append(guide);
const grid = adventure.querySelector('#adventure-grid');
const status = adventure.querySelector('#adventure-status');
const cooldownPanel = adventure.querySelector('#adventure-cooldown-panel');
const cooldownProgress = adventure.querySelector('#adventure-cooldown-progress');
const cooldownFill = adventure.querySelector('#adventure-cooldown-fill');
const cooldownPercent = adventure.querySelector('#adventure-cooldown-percent');
let pending = false, generation = 0, state = null, pet = null, shownBattle = null;
let entryReady = false, acceptedEntryId = null, openingAdventure = false, openingVersion = 0;
const runEnded = () => Boolean(state?.failed || state?.completed || state?.abandoned);
const recordsAvailable = () => runEnded() && !state?.battle?.pending;
const newEntryId = () => globalThis.crypto?.randomUUID?.() ?? `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
// Order of map requests sent and of the last one shown, so an older answer
// never replaces a newer one.
let sent = 0, shown = 0, patrolling = false;
function openGuide() {
  if (guide.open || !adventure.open) return;
  stopWalking();
  packPanel.hidden = true;
  packToggle.hidden = false;
  packToggle.setAttribute('aria-expanded', 'false');
  guide.showModal();
  guide.querySelector('#adventure-guide-close').focus({ preventScroll: true });
}
adventure.querySelector('#adventure-guide-open').addEventListener('click', openGuide);
guide.querySelector('#adventure-guide-close').addEventListener('click', () => guide.close());
// Closing the guide hands the keyboard straight back to the map.
guide.addEventListener('close', () => { if (adventure.open) grid.focus({ preventScroll: true }); });
// A battle that starts while the guide is open takes over the screen.
document.addEventListener('battle:show', () => { if (guide.open) guide.close(); });
// Draws one HP or MP ring: the coloured arc shows how much is left.
function gauge(kind, value, max) {
  const ring = adventure.querySelector(`#adventure-${kind}-ring`);
  ring.style.setProperty('--gauge', String(max > 0 ? Math.max(0, Math.min(1, value / max)) : 0));
  ring.setAttribute('aria-valuemax', String(max));
  ring.setAttribute('aria-valuenow', String(value));
  ring.setAttribute('aria-valuetext', `${value} of ${max}`);
  adventure.querySelector(`#adventure-${kind}-text`).textContent = `${value}/${max}`;
}
const icons = {
  slime: '<use href="#monster-slime"/>',
  goblin: '<use href="#monster-goblin"/>',
  'slime-king': '<use href="#monster-slime-king"/>',
};
const mapIcon = kind => `<svg viewBox="0 0 ${icons[kind] ? '24 24' : '96 96'}" aria-hidden="true" class="adventure-icon">${icons[kind] || `<use href="/scenes/adventure-atlas.svg#${kind}"/>`}</svg>`;
const legend = guide.querySelector('.adventure-legend');
for (const [kind, label] of [['grass', 'Tall grass'], ['slime', 'Wild slime'], ['goblin', 'Wild goblin'], ['slime-king', 'Slime King'], ['chest', 'Chest'], ['up', 'Stairs up'], ['down', 'Stairs down'], ['lock', 'Locked exit'], ['key', 'Floor Key']]) {
  const entry = document.createElement('span');
  entry.className = `adventure-marker-${kind}`;
  entry.innerHTML = mapIcon(kind);
  entry.append(document.createTextNode(label));
  legend.append(entry);
}
const at = point => state && point && point.x === state.x && point.y === state.y;
const exitLocked = () => Boolean(state?.down && state.exit && !state.exit.unlocked);
const exitReady = () => !exitLocked() || state.exit.keyFound;
const keyOdds = () => `${Math.round((state?.exit?.dropRate ?? .05) * 100)}%`;
function exitHint() {
  return !exitLocked() ? 'Exit unlocked. Press Space or choose Descend to explore deeper.'
    : state.exit.keyFound ? 'Floor Key found! Press Space or choose Unlock & descend.'
    : `Exit locked. Defeat monsters in tall grass for a Floor Key (${keyOdds()} drop chance per victory).`;
}
// From the latest broadcast pet; the server refuses exploring while busy anyway.
const busyText = () => pet?.activity === 'studying' ? `Your pet is busy studying ${pet.task}. Explore once it's done.`
  : pet?.activity === 'working' ? `Your pet is busy working at the ${pet.task}. Explore once it's done.` : '';
function syncControls() {
  const busy = Boolean(busyText());
  const blocked = !entryReady || pending || Boolean(state?.battle?.pending) || runEnded() || busy || !packPanel.hidden;
  function disable(button, value) {
    // Keep keyboard input inside the map when the active control is disabled.
    if (value && document.activeElement === button) grid.focus({ preventScroll: true });
    button.disabled = value;
  }
  for (const [action, stair] of [['ascend', state?.up], ['descend', state?.down]]) {
    const button = adventure.querySelector(`#adventure-${action}`);
    if (action === 'descend') button.textContent = exitLocked() && state.exit.keyFound ? 'Unlock & descend' : '↓ Descend';
    disable(button, blocked || !at(stair) || (action === 'descend' && !exitReady()));
  }
  adventure.querySelectorAll('[data-direction]').forEach(button => disable(button, blocked));
  disable(adventure.querySelector('#adventure-continue'), pending);
  disable(adventure.querySelector('#adventure-replay'), pending);
  disable(adventure.querySelector('#adventure-restart'), pending || Boolean(state?.battle?.pending) || busy);
  disable(adventure.querySelector('#adventure-team-up'), pending || Boolean(state?.battle?.pending));
  disable(adventure.querySelector('#adventure-abandon'), pending || Boolean(state?.battle?.pending) || busy);
  disable(adventure.querySelector('#adventure-close'), pending);
  const hourglasses = state?.inventory?.items.find(item => item.id === 'hourglass')?.quantity ?? 0;
  disable(adventure.querySelector('#adventure-skip-cooldown'), pending || hourglasses < 1);
  const chest = state?.chests.find(at);
  const open = adventure.querySelector('#adventure-open-chest');
  open.textContent = chest?.reward ? 'Chest opened' : 'Open chest';
  disable(open, blocked || !chest || Boolean(chest.reward));
  adventure.querySelectorAll('[data-use-item]').forEach(button => disable(button,
    !entryReady || pending || Boolean(state?.battle?.pending) || !state?.inventory?.items.find(item => item.id === button.dataset.useItem)?.usable));
  if (terrain) for (const cell of terrain.querySelectorAll('.adventure-marker-chest, .adventure-marker-up, .adventure-marker-down')) {
    const here = state && Number(cell.dataset.x) === state.x && Number(cell.dataset.y) === state.y;
    cell.classList.toggle('is-interactable', Boolean(here && !blocked && cell.dataset.opened !== 'true' &&
      (!cell.classList.contains('adventure-marker-down') || exitReady())));
  }
}
function clearMap() {
  resetScene();
  entryReady = false; acceptedEntryId = null;
  state = null; shownBattle = null;
  packPanel.hidden = true;
  packToggle.hidden = false;
  packToggle.setAttribute('aria-expanded', 'false');
  if (guide.open) guide.close();
  grid.replaceChildren();
  grid.setAttribute('aria-label', 'Woodland map');
  grid.setAttribute('aria-busy', 'false');
  adventure.querySelector('#adventure-title').textContent = 'Woodland adventure';
  adventure.querySelector('#adventure-floor').textContent = 'ADVENTURE';
  guide.querySelector('#adventure-stair-hint').textContent = '';
  guide.querySelector('#adventure-enemies').replaceChildren();
  adventure.querySelector('#adventure-team').hidden = true;
  adventure.querySelector('#adventure-team-list').replaceChildren();
  adventure.querySelector('#adventure-floor-key').replaceChildren();
  adventure.querySelector('#adventure-notice').textContent = '';
  adventure.querySelector('#adventure-battle-summary').hidden = true;
  adventure.querySelector('#adventure-records').replaceChildren();
  delete adventure.querySelector('#adventure-records').dataset.records;
  adventure.querySelector('#adventure-records').hidden = true;
  adventure.querySelector('#adventure-replay').setAttribute('aria-expanded', 'false');
  adventure.querySelector('#adventure-result').textContent = '';
  adventure.querySelector('#adventure-continue').hidden = true;
  adventure.querySelector('#adventure-completion').hidden = true;
  adventure.querySelector('#adventure-failure').hidden = true;
  adventure.querySelector('#adventure-restart').hidden = true;
  adventure.querySelector('#adventure-team-up').hidden = true;
  adventure.querySelector('#adventure-abandon').hidden = true;
  adventure.querySelector('#adventure-cooldown').hidden = true;
  cooldownPanel.hidden = true;
  cooldownFill.style.setProperty('--fill', '0');
  cooldownProgress.setAttribute('aria-valuenow', '0');
  cooldownProgress.removeAttribute('aria-valuetext');
  cooldownPercent.textContent = '0%';
  adventure.querySelector('#adventure-skip-cooldown').hidden = true;
  guide.querySelector('#adventure-restart-cost').textContent = '';
  adventure.querySelector('#adventure-resources').textContent = '';
  gauge('hp', 0, 0);
  gauge('mp', 0, 0);
  for (const id of ['adventure-treasure', 'adventure-care', 'adventure-items', 'adventure-abilities', 'adventure-coins']) {
    adventure.querySelector(`#${id}`).replaceChildren();
  }
  status.textContent = 'Opening the woodland…';
  syncControls();
}

function cooldownActive() {
  return Boolean(state?.cooldownUntil) && state.cooldownUntil > Date.now();
}
function cooldownText(ended) {
  const seconds = Math.max(1, Math.ceil(((state.cooldownUntil - Date.now()) * state.timeScale) / 1000));
  const minutes = Math.ceil(seconds / 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const wait = seconds < 60 ? `${seconds} s` : [h && `${h} h`, (m || !h) && `${m} min`].filter(Boolean).join(' ');
  return ended ? `Your pet needs to rest. Next adventure in ${wait}.` : `If you abandon this run, the next adventure opens in ${wait}.`;
}
// Only the cooldown indicator/buttons, so the 1 s tick doesn't rebuild the map.
// The wait only gates starting over, so a run in progress plays on as normal,
// and abandoning (which is free) stays available.
function renderCooldown() {
  if (!state) return;
  const active = cooldownActive(), ended = state.failed || state.completed || state.abandoned;
  cooldownPanel.hidden = !active;
  const cooldownHost = adventure.querySelector(ended ? '#adventure-finish-cooldown' : '#adventure-menu-cooldown');
  if (cooldownPanel.parentElement !== cooldownHost) cooldownHost.append(cooldownPanel);
  const message = adventure.querySelector('#adventure-cooldown');
  message.hidden = !active;
  if (active) {
    // Match the server's scaled duration; reopening must not restart the bar.
    const total = Math.max(1, Math.round(state.cooldownMinutes * 60_000 / state.timeScale));
    const done = Math.max(0, Math.min(1, 1 - (state.cooldownUntil - Date.now()) / total));
    const percent = Math.floor(done * 100), text = cooldownText(ended);
    cooldownFill.style.setProperty('--fill', String(done));
    cooldownProgress.setAttribute('aria-valuenow', String(percent));
    cooldownProgress.setAttribute('aria-valuetext', `${percent}% complete. ${text}`);
    cooldownPercent.textContent = `${percent}%`;
    // Keep the changing percentage out of the live region, and only announce
    // the remaining time when its readable value actually changes.
    if (message.textContent !== text) message.textContent = text;
  }
  adventure.querySelector('#adventure-skip-cooldown').hidden = !active || !ended;
  adventure.querySelector('#adventure-restart').hidden = active || !ended;
  adventure.querySelector('#adventure-team-up').hidden = active || !ended;
  adventure.querySelector('#adventure-abandon').hidden = true;
  adventure.querySelector('#adventure-close').textContent = ended ? 'Return to town' : 'End adventure';
  syncControls();
}
setInterval(() => { if (adventure.open) renderCooldown(); }, 1000);

function renderMap() {
  if (!state) return;
  if (!entryReady && !runEnded()) return;
  adventure.classList.toggle('adventure-ended', recordsAvailable());
  adventure.classList.toggle('adventure-abandoned', Boolean(state.abandoned));
  packToggle.hidden = recordsAvailable();
  if (recordsAvailable()) {
    packPanel.hidden = true;
    packToggle.setAttribute('aria-expanded', 'false');
  }
  adventure.querySelector('#adventure-title').textContent = state.name;
  adventure.querySelector('#adventure-floor').textContent = `ADVENTURE · FLOOR ${state.floor} / ${state.floorCount}`;
  guide.querySelector('#adventure-stair-hint').textContent = state.down
    ? `The ↓ stairs are at column 14, row 14. ${exitHint()}`
    : state.completed ? 'Final floor. The Slime King is defeated.' : 'Final floor. The Slime King lives here.';
  adventure.querySelector('#adventure-completion').hidden = !state.completed;
  adventure.querySelector('#adventure-failure').hidden = !state.failed && !state.abandoned;
  adventure.querySelector('#adventure-failure').textContent =
    state.abandoned ? 'You left the woodland. Your next visit starts a fresh adventure.' : 'Your pet was defeated. Your next adventure starts fresh.';
  guide.querySelector('#adventure-restart-cost').textContent =
    `A new run costs ${state.restartCost.stamina} stamina and ${state.restartCost.hygiene} hygiene. The next one opens ${state.cooldownMinutes / 60} hours later.`;
  renderCooldown();
  adventure.querySelector('#adventure-resources').textContent = `HP ${state.hp} / ${state.maxHp} · MP ${state.mp} / ${state.maxMp}`;
  gauge('hp', state.hp, state.maxHp);
  gauge('mp', state.mp, state.maxMp);
  const records = state.records ?? [];
  adventure.querySelector('#adventure-battle-summary').hidden = !recordsAvailable();
  adventure.querySelector('#adventure-summary-title').textContent = state.completed ? 'Adventure complete' : 'Adventure over';
  const total = state.battleCount ?? records.length;
  adventure.querySelector('#adventure-result').textContent = `${total} ${total === 1 ? 'battle' : 'battles'} · Reached floor ${state.floor}${total > records.length ? ` · Showing the latest ${records.length} records` : ''}`;
  adventure.querySelector('#adventure-replay').hidden = !recordsAvailable() || records.length === 0;
  renderRecords();
  adventure.querySelector('#adventure-continue').hidden = !state.battle?.pending;
  const opened = state.chests.find(chest => chest.reward);
  adventure.querySelector('#adventure-treasure').textContent = opened && at(opened) ? rewardText(opened.reward) : '';
  renderInventory();
  renderMonsters();
  status.textContent = `Column ${state.x + 1} · Row ${state.y + 1}`;
  syncControls();
  syncAdventureMotion();
}
// Teammates still exploring this floor stand on the map with your pet.
const teammatesHere = () => (state?.team?.members ?? []).filter(m => m.floor === state.floor && m.status === 'exploring');
function renderTeam() {
  const roster = adventure.querySelector('#adventure-team');
  roster.hidden = !state?.team;
  const list = adventure.querySelector('#adventure-team-list');
  list.replaceChildren();
  for (const mate of state?.team?.members ?? []) {
    const row = document.createElement('li');
    const where = mate.status === 'exploring' ? `floor ${mate.floor}, column ${mate.x + 1}, row ${mate.y + 1} · HP ${mate.hp} / ${mate.maxHp}`
      : mate.status === 'defeated' ? 'defeated' : 'abandoned the run';
    row.textContent = `${mate.id} · ${where}`;
    list.append(row);
  }
}
// A persistent scene: saved moves translate the same actors. Refreshing the
// team or cooldown never tears down terrain, focus, or an animation in flight.
const TILE = 64, MAP_SIZE = TILE * 16, FOREST_MARGIN = TILE * 2;
let sceneSignature = '', mapScene = null, terrain = null, actors = null;
const actorNodes = new Map();
let walkingPath = [], walkingTimer = 0, walkingGeneration = 0;
const hiddenEnemy = enemy => enemy.hidden ?? enemy.kind !== 'slime-king';
const typeName = type => type[0].toUpperCase() + type.slice(1);
const onGrass = (x, y) => state?.grass?.[y]?.[x] === 'g';
function stopWalking() { walkingGeneration++; walkingPath = []; clearTimeout(walkingTimer); }
function resetScene() {
  stopWalking();
  for (const actor of actorNodes.values()) clearTimeout(actor.walkTimer);
  actorNodes.clear();
  sceneSignature = ''; mapScene = null; terrain = null; actors = null;
}
function drawCamera(immediate = false) {
  if (!state || !mapScene) return;
  const width = grid.clientWidth || window.innerWidth || 960;
  const height = grid.clientHeight || window.innerHeight || 640;
  const extent = MAP_SIZE + FOREST_MARGIN * 2;
  const zoom = Math.max(.85, width / extent, height / extent);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  // The surrounding forest gives edge tiles room beneath the floating controls.
  const x = clamp(width / 2 - (state.x + .5) * TILE * zoom, width - (MAP_SIZE + FOREST_MARGIN) * zoom, FOREST_MARGIN * zoom);
  const y = clamp(height / 2 - (state.y + .5) * TILE * zoom, height - (MAP_SIZE + FOREST_MARGIN) * zoom, FOREST_MARGIN * zoom);
  mapScene.style.transitionDuration = immediate ? '0s' : '';
  mapScene.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
}
function makeTerrain() {
  const signature = JSON.stringify([state.floor, state.tiles, state.grass, state.chests.map(c => [c.id, c.x, c.y]), state.up, state.down]);
  if (signature === sceneSignature && mapScene) return false;
  resetScene();
  sceneSignature = signature;
  const forest = [];
  for (let y = -2; y < 18; y++) for (let x = -2; x < 18; x++) {
    if (x >= 0 && x < 16 && y >= 0 && y < 16) continue;
    forest.push(`<use href="/scenes/adventure-atlas.svg#tree" x="${x * TILE - 8}" y="${y * TILE - 20}" width="80" height="84"/>`);
  }
  grid.innerHTML = `<div id="adventure-map-scene" aria-hidden="true">
    <svg class="adventure-edge-scenery" viewBox="-128 -128 1280 1280">
      <path fill="#7e9a6c" d="M-128-128H1152V1152H-128Z"/>${forest.join('')}
    </svg>
    <svg class="adventure-landscape" viewBox="0 0 1024 1024">
      <defs>
        <radialGradient id="adventure-meadow"><stop stop-color="#d1d49c"/><stop offset=".65" stop-color="#a8bb7f"/><stop offset="1" stop-color="#8fa573"/></radialGradient>
        <pattern id="adventure-grain" width="57" height="43" patternUnits="userSpaceOnUse"><path d="m12 17 2-3 2 3m25 18 1-3 2 3" fill="none" stroke="#526e45" stroke-width="1" opacity=".17"/><path d="M32 8h2M9 35h3" stroke="#eff0c8" stroke-width="1.4" opacity=".4"/></pattern>
        <path id="adventure-trail" d="M96 96H928V928H96ZM160 96V160M736 96V224M928 864H864"/>
      </defs>
      <path fill="url(#adventure-meadow)" d="M0 0h1024v1024H0z"/>
      <g fill="none" stroke-linejoin="round" stroke-linecap="round">
        <use href="#adventure-trail" stroke="#829361" stroke-opacity=".35" stroke-width="52"/>
        <use href="#adventure-trail" stroke="#decea0" stroke-width="43"/>
        <use href="#adventure-trail" stroke="#eddeb5" stroke-opacity=".5" stroke-width="25"/>
      </g>
      <path fill="url(#adventure-grain)" d="M0 0h1024v1024H0z"/>
      <ellipse cx="520" cy="500" rx="285" ry="225" fill="#e8dfa6" opacity=".09"/>
    </svg>
    <div id="adventure-terrain"></div><div id="adventure-actors"></div>
    <div class="adventure-air"><i></i><i></i><i></i><i></i></div>
  </div>`;
  mapScene = grid.querySelector('#adventure-map-scene');
  terrain = grid.querySelector('#adventure-terrain');
  actors = grid.querySelector('#adventure-actors');
  state.tiles.forEach((row, y) => [...row].forEach((tile, x) => {
    const cell = document.createElement('span');
    const water = tile === '#' && ((x === 15 && y > 2) || (y === 15 && x > 8));
    cell.className = `adventure-tile ${tile === '#' ? water ? 'adventure-water' : 'adventure-tree' : 'adventure-path'}${onGrass(x, y) ? ' adventure-grass' : ''}`;
    cell.dataset.x = String(x); cell.dataset.y = String(y);
    cell.style.setProperty('--tile-x', x);
    cell.style.setProperty('--tile-y', y);
    cell.style.setProperty('--sway-delay', `${-((x * 7 + y * 3) % 17) / 4}s`);
    const chest = state.chests.find(c => c.x === x && c.y === y);
    const stair = [state.up && { ...state.up, kind: 'up' }, state.down && { ...state.down, kind: 'down' }].find(s => s && s.x === x && s.y === y);
    if (tile === '#' && !water) cell.innerHTML = mapIcon('tree');
    else if (onGrass(x, y)) cell.innerHTML = `<span class="adventure-grass-blades">${mapIcon('grass')}</span>`;
    else if (tile === '.' && !chest && !stair && ![1, 14].includes(x) && ![1, 14].includes(y) && (x * 7 + y * 11 + state.floor) % 9 === 0) {
      cell.innerHTML = `<span class="adventure-ground-detail">${mapIcon((x + y) % 3 ? 'flowers' : 'fern')}</span>`;
    }
    if (chest || stair) {
      cell.classList.add(`adventure-marker-${chest ? 'chest' : stair.kind}`);
      cell.innerHTML = mapIcon(chest?.reward ? 'open-chest' : chest ? 'chest' : stair.kind);
      if (chest) cell.dataset.opened = String(Boolean(chest.reward));
    }
    terrain.append(cell);
  }));
  return true;
}
function placeActor(key, position, className, art, label) {
  let entry = actorNodes.get(key);
  if (!entry) {
    const node = document.createElement('span');
    node.className = `adventure-actor ${className}`;
    node.dataset.actor = key;
    if (key === 'player') node.id = 'adventure-player';
    actors.append(node);
    entry = { node, art: '', x: position.x, y: position.y, walkTimer: 0 };
    actorNodes.set(key, entry);
  }
  const { node } = entry;
  if (entry.art !== art) { node.innerHTML = art; entry.art = art; }
  node.title = label;
  if (position.color && /^#[0-9a-f]{6}$/i.test(position.color)) node.style.setProperty('--pet-color', position.color);
  if (entry.x !== position.x || entry.y !== position.y) {
    node.dataset.facing = position.x < entry.x ? 'left' : position.x > entry.x ? 'right' : position.y < entry.y ? 'up' : 'down';
    node.classList.add('is-walking');
    clearTimeout(entry.walkTimer);
    entry.walkTimer = setTimeout(() => node.classList.remove('is-walking'), 220);
  }
  node.style.transform = `translate3d(${position.x * TILE}px, ${position.y * TILE}px, 0)`;
  node.style.zIndex = String(position.y * 2 + 2);
  entry.x = position.x; entry.y = position.y;
  return node;
}
function renderMonsters() {
  renderTeam();
  const roster = guide.querySelector('#adventure-enemies');
  roster.replaceChildren();
  for (const enemy of state.enemies) {
    const item = document.createElement('li');
    const moves = (enemy.moves ?? []).map(move => ` · ${move.name} (${move.mpCost} MP): ${move.description}`).join('');
    const where = hiddenEnemy(enemy) ? 'Hidden in tall grass' : `column ${enemy.x + 1}, row ${enemy.y + 1}`;
    const type = enemy.type ? ` · ${typeName(enemy.type)} type, weak to ${(enemy.weakness ?? []).map(typeName).join(' and ')}` : '';
    item.textContent = `${enemy.name}${type} · ${where} · HP ${enemy.strength + enemy.intelligence + enemy.charisma} · MP ${enemy.intelligence} · STR ${enemy.strength} / INT ${enemy.intelligence} / CHA ${enemy.charisma}${moves}`;
    roster.append(item);
  }
  const rebuilt = makeTerrain();
  const active = new Set(['player']);
  const player = placeActor('player', { ...state, color: pet?.color }, 'adventure-player', avatarFor(pet || {}), 'Your companion');
  for (const mate of teammatesHere()) {
    const key = `pet:${mate.id}`;
    active.add(key);
    const node = placeActor(key, mate, 'adventure-teammate', avatarFor(mate), `${mate.id} · HP ${mate.hp} / ${mate.maxHp}`);
    node.dataset.player = mate.id;
    node.hidden = at(mate);
  }
  for (const enemy of state.enemies.filter(enemy => !hiddenEnemy(enemy))) {
    const key = `enemy:${enemy.id}`;
    active.add(key);
    const node = placeActor(key, enemy, `adventure-marker-${enemy.kind}`, mapIcon(enemy.kind), `${enemy.name} · HP ${enemy.strength + enemy.intelligence + enemy.charisma}`);
    node.dataset.enemy = enemy.id;
  }
  for (const [key, entry] of actorNodes) {
    if (active.has(key)) continue;
    clearTimeout(entry.walkTimer);
    entry.node.remove(); actorNodes.delete(key);
  }
  for (const cell of terrain.children) {
    const point = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    const chest = state.chests.find(c => c.x === point.x && c.y === point.y);
    if (chest) {
      const opened = Boolean(chest.reward);
      if (cell.dataset.opened !== String(opened)) {
        cell.innerHTML = mapIcon(opened ? 'open-chest' : 'chest');
        cell.dataset.opened = String(opened);
      }
      cell.classList.toggle('adventure-chest-opened', opened);
      cell.title = opened ? `Opened chest · ${chest.reward.name}` : 'Unopened treasure chest';
    }
    if (cell.classList.contains('adventure-marker-down')) {
      cell.classList.toggle('is-locked', exitLocked());
      cell.classList.toggle('has-floor-key', exitLocked() && state.exit.keyFound);
      cell.title = exitHint();
      const badgeKind = exitLocked() ? state.exit.keyFound ? 'key' : 'lock' : '';
      if (cell.dataset.exitBadge !== badgeKind) {
        cell.querySelector('.adventure-lock')?.remove();
        if (badgeKind) {
          const badge = document.createElement('span');
          badge.className = 'adventure-lock';
          badge.innerHTML = mapIcon(badgeKind);
          cell.append(badge);
        }
        cell.dataset.exitBadge = badgeKind;
      }
    }
    const interactable = at(point) && ((chest && !chest.reward) || cell.classList.contains('adventure-marker-up') ||
      (cell.classList.contains('adventure-marker-down') && exitReady()));
    cell.classList.toggle('is-interactable', Boolean(interactable) && entryReady && packPanel.hidden && !runEnded() && !state.battle?.pending && !pending && !busyText());
    cell.classList.toggle('is-rustling', onGrass(point.x, point.y) && Math.abs(point.x - state.x) <= 1 && Math.abs(point.y - state.y) <= 1);
  }
  const mates = teammatesHere(), sharing = mates.filter(m => m.x === state.x && m.y === state.y).map(m => m.id);
  player.classList.toggle('adventure-shared', sharing.length > 0);
  player.dataset.shared = String(sharing.length + 1);
  player.classList.toggle('in-grass', onGrass(state.x, state.y));
  grid.setAttribute('aria-label', `Floor ${state.floor} of ${state.floorCount}, 16 by 16 woodland map. Your pet is at column ${state.x + 1}, row ${state.y + 1}${sharing.length ? `, with ${sharing.join(', ')}` : ''}. ${state.enemies.length} monsters and ${state.chests.length} chest.${mates.length ? ` ${mates.length} ${mates.length > 1 ? 'teammates' : 'teammate'} here; positions are in Your team.` : ''} Tall grass can hide surprise encounters. Clear paths are safe. Trees and water block movement. Space opens a chest or takes the stairs your pet stands on.${state.down ? ` ${exitHint()}` : ''}`);
  const nearby = state.enemies.filter(e => !hiddenEnemy(e) && state.encounters.includes(e.id));
  const notice = busyText() || (nearby.length
    ? `${nearby.map(e => e.name).join(', ')} guards this grove. Walk up to challenge it.`
    : state.chests.some(at) ? (state.chests.find(at).reward ? 'Chest already opened.' : 'You found a treasure chest. Press Space or choose Open chest to collect its reward.')
    : at(state.up) ? 'Stairs up: Space or Ascend.'
    : at(state.down) ? exitHint()
    : onGrass(state.x, state.y) && (state.enemies.some(hiddenEnemy) || !exitReady()) ? 'Tall grass… something might be hiding here.' : '');
  // Only a new message is announced again.
  const noticeText = adventure.querySelector('#adventure-notice');
  if (noticeText.textContent !== notice) noticeText.textContent = notice;
  drawCamera(rebuilt);
}
function rewardText(reward) {
  return reward.category === 'ability'
    ? (reward.learned ? `Learned ${reward.name}!` : `${reward.name} found — already learned.`)
    : `Found ${reward.quantity} ${reward.name}. Added to your backpack.`;
}
function renderInventory() {
  const inventory = state?.inventory;
  if (!inventory) return;
  const focused = document.activeElement?.dataset.useItem;
  adventure.querySelector('#adventure-care').textContent = `Stamina ${inventory.stamina} / 100 · Hygiene ${inventory.hygiene} / 100`;
  const floorKey = adventure.querySelector('#adventure-floor-key');
  floorKey.hidden = !state.down;
  if (state.down) {
    floorKey.innerHTML = mapIcon(exitLocked() && !state.exit.keyFound ? 'lock' : 'key');
    const text = document.createElement('span');
    text.textContent = !exitLocked() ? `Floor ${state.floor} exit unlocked.`
      : state.exit.keyFound ? `Floor Key · ready to unlock floor ${state.floor}'s stairs.`
      : `Floor Key not found · ${keyOdds()} drop chance per monster victory on floor ${state.floor}.`;
    floorKey.append(text);
  }
  const items = adventure.querySelector('#adventure-items');
  items.replaceChildren();
  for (const item of inventory.items) {
    const row = document.createElement('li'), label = document.createElement('strong'), effect = document.createElement('span'), button = document.createElement('button');
    label.textContent = `${item.name} × ${item.quantity}`;
    effect.textContent = item.effect === 'skip' ? 'Finish the current lesson or shift.' : `Restore ${item.amount} ${item.restores}.`;
    button.type = 'button'; button.className = 'chip-btn'; button.dataset.useItem = item.id;
    button.textContent = { food: 'Feed', soap: 'Clean', hourglass: 'Skip activity' }[item.id];
    button.setAttribute('aria-label', `Use ${item.name}`);
    button.disabled = !entryReady || pending || Boolean(state.battle?.pending) || !item.usable;
    button.addEventListener('click', () => request({ action: 'use-item', item: item.id }));
    row.append(label, effect, button); items.append(row);
    if (focused === item.id) (button.disabled ? grid : button).focus({ preventScroll: true });
  }
  const abilities = adventure.querySelector('#adventure-abilities');
  abilities.replaceChildren();
  for (const ability of inventory.abilities.filter(a => a.learned)) {
    const row = document.createElement('li');
    const type = ability.type && ability.type !== 'normal' ? `${typeName(ability.type)} · ` : '';
    row.textContent = `${ability.name} · ${type}${ability.mpCost} MP${ability.equipped ? ' · Equipped' : ''}. ${ability.description}`;
    abilities.append(row);
  }
  const coins = adventure.querySelector('#adventure-coins');
  coins.replaceChildren();
  for (const coin of inventory.coins) {
    const row = document.createElement('li'), label = document.createElement('strong'), effect = document.createElement('span'), button = document.createElement('button');
    label.textContent = `${coin.name} × ${coin.quantity}`;
    effect.textContent = coin.effect;
    button.type = 'button'; button.className = 'chip-btn'; button.setAttribute('aria-pressed', String(Boolean(coin.equipped)));
    button.textContent = coin.equipped ? 'Unequip' : 'Equip';
    button.disabled = !entryReady || (coin.quantity < 1 && !coin.equipped);
    button.addEventListener('click', () => { button.disabled = true; equipCoin(button, coin.equipped ? null : coin.id); });
    row.append(label, effect, button); coins.append(row);
  }
}
async function equipCoin(button, coinId) {
  if (!pet || !entryReady) return;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(pet.id)}/equip-coin/${encodeURIComponent(coinId ?? 'none')}`, { method: 'POST' });
    if (!res.ok) button.disabled = false;
  } catch {
    button.disabled = false;
  }
}
// What this pet's victory trained, from the saved battle: "+1 Strength".
function trainedText(trained) {
  const gains = Object.entries(trained ?? {}).filter(([, amount]) => amount > 0);
  if (gains.length === 3 && gains.every(([, amount]) => amount === gains[0][1])) return ` +${gains[0][1]} to each attribute.`;
  return gains.map(([attribute, amount]) => ` +${amount} ${attribute[0].toUpperCase()}${attribute.slice(1)}.`).join('');
}
// In a team battle the team can win while this pet is knocked out.
function battleResult(battle) {
  const knockedOut = battle.after?.hp === 0;
  const team = (battle.playback?.fighters.length ?? 0) > 2 ? 'Your team' : 'You';
  const keyDrop = battle.keyDrop ? ` Found a Floor Key! The stairs on floor ${battle.keyDrop.floor} can now be unlocked.` : '';
  if (battle.won && knockedOut) return `${team} defeated ${battle.enemyName} on floor ${battle.floor}, but your pet was knocked out. Its adventure is over; your teammates explore on.${keyDrop}`;
  return battle.won
    ? `${team} defeated ${battle.enemyName} on floor ${battle.floor}. Recovered ${battle.recovery.hp} HP and ${battle.recovery.mp} MP.${trainedText(battle.trained)}${keyDrop}${battle.enemyId === 'slime-king' ? ' Woodland complete!' : ''}`
    : `${battle.enemyName} defeated ${team === 'You' ? 'you' : 'your team'}. Adventure failed. Start a new adventure to try again.`;
}
function renderRecords() {
  const list = adventure.querySelector('#adventure-records');
  const records = recordsAvailable() ? state.records ?? [] : [];
  const signature = records.map(battle => battle.id).join(',');
  if (list.dataset.records === signature) return;
  list.dataset.records = signature;
  list.replaceChildren();
  for (const battle of records) {
    const row = document.createElement('li'), text = document.createElement('span'), button = document.createElement('button');
    text.textContent = `Floor ${battle.floor} · ${battle.enemyName} · ${battle.won ? 'Victory' : 'Defeat'}${battle.keyDrop ? ' · Floor Key' : ''}`;
    button.type = 'button'; button.className = 'chip-btn chip-buy'; button.dataset.recordId = battle.id;
    button.textContent = 'Replay';
    button.setAttribute('aria-label', `Replay ${battle.enemyName} battle on floor ${battle.floor}`);
    button.addEventListener('click', () => showBattle(true, battle));
    row.append(text, button); list.append(row);
  }
}
function showBattle(replay = false, battle = state?.battle) {
  const manual = Boolean(battle?.playback?.status) && !replay;
  if (!battle?.playback || (replay && !recordsAvailable()) || (!replay && (!entryReady || (!manual && shownBattle === battle.id)))) return;
  if (!replay) shownBattle = battle.id;
  packPanel.hidden = true;
  packToggle.setAttribute('aria-expanded', 'false');
  const last = battle.playback.turns.at(-1), mine = battle.fighter ?? 0;
  // What the pet carries back to the map (a Copper shield's leftover is gone).
  const hp = [...(battle.playback.hp ?? last?.hp ?? battle.playback.initialHp)];
  const mp = [...(battle.playback.mp ?? last?.mp ?? battle.playback.initialMp)];
  hp[mine] = battle.after?.hp ?? hp[mine] + battle.recovery.hp;
  mp[mine] = battle.after?.mp ?? mp[mine] + battle.recovery.mp;
  document.dispatchEvent(new CustomEvent('battle:show', { detail: {
    key: `adventure:${battle.id}`, battle: battle.playback, viewer: battle.playback.fighters[mine].id,
    title: battle.surprise ? manual ? `A wild ${battle.enemyName}!` : `Surprise in the grass! · ${battle.enemyName}` : `Floor ${battle.floor} · ${battle.enemyName}${battle.attacked ? ' attacks!' : ''}`,
    encounter: battle.surprise ? 'grass' : 'woodland', result: battleResult(battle), won: battle.won,
    replay: !manual, manual, allowReplay: replay, showLog: replay,
    onChoose: async (ability, turnRevision) => {
      if (!await request({ action: 'battle-skill', battleId: battle.id, ability, turnRevision })) {
        throw new Error(status.textContent || 'Could not save your move. Try again.');
      }
    },
    onForfeit: async turnRevision => {
      if (!await request({ action: 'battle-forfeit', battleId: battle.id, turnRevision })) {
        throw new Error(status.textContent || 'Could not withdraw. Try again.');
      }
      // A stale turn returns the current battle without withdrawing this pet.
      // Keep its controls (or a newly finished result) until the server confirms.
      if (state?.battle?.id !== battle.id) return;
      if (state.abandoned && !state.battle.pending) {
        document.dispatchEvent(new CustomEvent('battle:dismiss', { detail: { key: `adventure:${battle.id}` } }));
      } else if (state.battle.playback?.status === 'active') {
        throw new Error('The battle moved on before your pet could withdraw. Choose Forfeit again to leave.');
      }
    },
    returnLabel: replay ? 'Back to records' : 'Return to map', resultResources: { hp, mp },
  } }));
}
function matchesCurrentEntry(result) {
  if (!acceptedEntryId || result.entryId === acceptedEntryId) return true;
  entryReady = false;
  stopWalking();
  if (state?.battle) document.dispatchEvent(new CustomEvent('battle:dismiss', { detail: { key: `adventure:${state.battle.id}` } }));
  shownBattle = null;
  adventure.classList.add('adventure-entering');
  status.textContent = 'This adventure was restarted in another window. Return to town and enter again.';
  status.classList.remove('visually-hidden');
  syncControls();
  return false;
}
async function request(payload = {}) {
  if (pending) return false;
  if (payload.direction || payload.action) payload = { ...payload, revision: state?.revision };
  const version = generation, order = ++sent;
  pending = true;
  status.classList.add('visually-hidden');
  grid.setAttribute('aria-busy', 'true');
  syncControls();
  try {
    const response = await fetch('/api/adventure', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (version !== generation) return false;
    if (!response.ok) throw new Error(result.error || 'Could not explore. Try again.');
    if (payload.action !== 'enter' && !matchesCurrentEntry(result)) return false;
    state = result; shown = order;
    if (payload.action === 'enter') {
      entryReady = state.entryId === payload.entryId;
      if (!entryReady) throw new Error('The adventure changed in another window. Enter again to start fresh.');
      acceptedEntryId = state.entryId;
      adventure.querySelector('#adventure-records').hidden = true;
      adventure.querySelector('#adventure-replay').setAttribute('aria-expanded', 'false');
      packPanel.hidden = true;
      packToggle.setAttribute('aria-expanded', 'false');
    }
    renderMap();
    if (entryReady && state.battle?.pending) showBattle();
    return true;
  } catch (error) {
    if (version === generation) {
      status.textContent = error.message || 'Connection lost. Try again.';
      status.classList.remove('visually-hidden');
    }
    return false;
  } finally {
    if (version === generation) {
      pending = false;
      grid.setAttribute('aria-busy', 'false');
      syncControls();
    }
  }
}
// Refresh shared progress while exploring. This legacy action name now reads
// the saved map only; standing still never rolls an encounter.
async function patrol() {
  const live = state?.battle?.playback?.status === 'active';
  if (!entryReady || !adventure.open || document.hidden || patrolling || pending || !state || (state.battle?.pending && !live)
    || (runEnded() && !live) || busyText()) return;
  const version = generation, order = ++sent;
  patrolling = true;
  try {
    const response = await fetch('/api/adventure', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'patrol' }),
    });
    const result = await response.json();
    // A move sent since then answers with fresher news; this step shows next time.
    if (!response.ok || version !== generation || pending || order < shown) return;
    if (!matchesCurrentEntry(result)) return;
    const changed = result.revision !== state.revision;
    state = result; shown = order;
    if (!changed) return renderMonsters();
    renderMap();
    if (state.battle?.pending) showBattle();
  } catch {
    // The next step tries again.
  } finally {
    patrolling = false;
  }
}
(function tick() {
  patrol();
  setTimeout(tick, state?.patrolMs ?? 1000);
})();
// Before an adventure starts, a small window lets the player set off alone or
// team up: invite other players by ID, accept invitations, and (as leader) set
// off together on one shared map. The server decides everything; the window
// shows what it last said, refreshed by team:updated broadcasts.
const teamUp = document.createElement('dialog');
teamUp.id = 'team-dialog';
teamUp.setAttribute('aria-labelledby', 'team-title');
teamUp.innerHTML = `
  <header><div><p class="section-label">ADVENTURE</p><h2 id="team-title">Team up?</h2></div>
    <button type="button" id="team-close" class="chip-btn chip-buy">Close</button></header>
  <p class="help" id="team-help"></p>
  <section id="team-invitations" aria-labelledby="team-invitations-heading" hidden>
    <h3 id="team-invitations-heading">Invitations</h3><ul id="team-invitation-list"></ul>
  </section>
  <section aria-labelledby="team-members-heading">
    <h3 id="team-members-heading">Your team</h3><ul id="team-members"></ul>
  </section>
  <form id="team-invite">
    <label for="team-invite-id">Invite a player by ID</label>
    <div class="team-invite-row">
      <input id="team-invite-id" name="player" required maxlength="32" pattern="[A-Za-z0-9_\\-]+" spellcheck="false" autocomplete="off" />
      <button type="submit" class="chip-btn">Invite</button>
    </div>
  </form>
  <p id="team-error" class="error" role="alert"></p>
  <p id="team-status" role="status"></p>
  <div class="team-actions">
    <button type="button" id="team-set-off" class="chip-btn" hidden>Set off together</button>
    <button type="button" id="team-leave" class="chip-btn chip-buy" hidden>Leave team</button>
    <button type="button" id="team-solo" class="chip-btn chip-buy">Go solo</button>
  </div>`;
document.body.append(teamUp);
let lobby = null, lobbyGeneration = 0, lobbyPending = false;
const avatarFor = member => {
  const shape = ['cat', 'dog', 'hedgehog', 'lizard', 'panda', 'bird', 'dragon', 'blob'].includes(member.appearance) ? member.appearance : 'blob';
  const color = /^#[0-9a-f]{6}$/i.test(member.color) ? member.color : '#f59e0b';
  return `<svg class="pet-avatar team-avatar" viewBox="0 0 120 110" aria-hidden="true" style="--pet-color: ${color}"><use href="#pet-${shape}" /></svg>`;
};
function renderLobby() {
  if (!lobby) return;
  const me = pet?.id, team = lobby.team, leader = team?.leader === me;
  const cost = state?.restartCost ?? { stamina: 40, hygiene: 20 };
  teamUp.querySelector('#team-help').textContent = `Go solo, or invite up to ${lobby.size - 1} players to share a map. Setting off costs each pet ${cost.stamina} stamina and ${cost.hygiene} hygiene.`;
  const invitations = teamUp.querySelector('#team-invitation-list');
  invitations.replaceChildren();
  teamUp.querySelector('#team-invitations').hidden = lobby.invitations.length === 0 || Boolean(team);
  for (const invitation of lobby.invitations) {
    const row = document.createElement('li'), text = document.createElement('span');
    text.textContent = `${invitation.leader} invited you (${invitation.members.filter(m => m.joined).length} joined)`;
    const join = document.createElement('button'), decline = document.createElement('button');
    join.type = decline.type = 'button';
    join.className = 'chip-btn'; decline.className = 'chip-btn chip-buy';
    join.textContent = 'Join'; decline.textContent = 'Decline';
    join.setAttribute('aria-label', `Join ${invitation.leader}'s team`);
    decline.setAttribute('aria-label', `Decline ${invitation.leader}'s invitation`);
    join.addEventListener('click', () => teamRequest({ action: 'accept', team: invitation.id }));
    decline.addEventListener('click', () => teamRequest({ action: 'leave', team: invitation.id }));
    row.append(text, join, decline);
    invitations.append(row);
  }
  const members = teamUp.querySelector('#team-members');
  members.replaceChildren();
  for (const member of team?.members ?? [{ id: me, color: pet?.color, appearance: pet?.appearance, joined: true, waiting: null }]) {
    const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span');
    row.innerHTML = avatarFor(member);
    name.textContent = member.id === me ? `${member.id} (you)` : member.id;
    detail.textContent = [member.id === team?.leader ? 'Leader' : '', !member.joined ? 'Invited' : member.waiting ? `Not ready: ${member.waiting}` : team ? 'Ready' : '']
      .filter(Boolean).join(' · ');
    row.append(name, detail);
    members.append(row);
  }
  teamUp.querySelector('#team-invite').hidden = Boolean(team) && !leader;
  const full = (team?.members.length ?? 1) >= lobby.size;
  teamUp.querySelector('#team-invite button').disabled = lobbyPending || full;
  teamUp.querySelector('#team-invite-id').disabled = lobbyPending || full;
  const setOff = teamUp.querySelector('#team-set-off');
  setOff.hidden = !leader;
  setOff.disabled = lobbyPending || !team || team.members.filter(m => m.joined).length < 2 || team.members.some(m => m.waiting);
  const leaving = teamUp.querySelector('#team-leave');
  leaving.hidden = !team;
  leaving.textContent = leader ? 'Disband team' : 'Leave team';
  const solo = teamUp.querySelector('#team-solo');
  solo.hidden = Boolean(team);
  solo.disabled = lobbyPending;
  teamUp.querySelector('#team-status').textContent = !team ? ''
    : leader ? (team.members.length < 2 ? 'Invite a player to team up.' : setOff.disabled ? 'Waiting for every teammate to join and be ready.' : 'Everyone is ready. Set off together!')
    : `Waiting for ${team.leader} to set off.`;
}
// A run under way (solo or a team's) reopens on the map; otherwise the
// player chooses how to start.
async function loadLobby() {
  const version = ++lobbyGeneration;
  const response = await fetch('/api/team');
  const result = await response.json();
  if (version !== lobbyGeneration) return null;
  if (!response.ok) throw new Error(result.error || 'Could not open the Team up window.');
  if (!result?.run) throw new Error('Could not open the Team up window.');
  lobby = result;
  return lobby;
}
async function teamRequest(body) {
  if (lobbyPending) return;
  lobbyPending = true;
  teamUp.querySelector('#team-error').textContent = '';
  renderLobby();
  try {
    const response = await fetch('/api/team', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update the team. Try again.');
    ++lobbyGeneration;
    lobby = result;
    if (body.action === 'invite') teamUp.querySelector('#team-invite-id').value = '';
    // The set-off broadcast may already have opened this run. Both paths
    // consume the open lobby so a late response cannot enter a second time.
    if (teamUp.open && lobby.run.state === 'exploring' && lobby.run.team) return openMap();
  } catch (error) {
    teamUp.querySelector('#team-error').textContent = error.message || 'Connection lost. Try again.';
  } finally {
    lobbyPending = false;
    renderLobby();
  }
}
// Every actual entry uses a new ID. Reads and retries never create extra runs.
async function enterMap() {
  if (!adventure.open || !state || pending) return;
  entryReady = false; acceptedEntryId = null;
  adventure.classList.add('adventure-entering');
  adventure.querySelector('#adventure-battle-summary').hidden = true;
  const version = generation;
  const entryId = newEntryId();
  const accepted = await request({ action: 'enter', entryId });
  if (!accepted && version === generation && adventure.open) {
    const error = status.textContent;
    // Entry can end the previous run even when the next entry needs rest.
    // Read its final result, never resume movement or an old pending replay.
    const refreshed = await request();
    if (version !== generation) return;
    if (refreshed && state?.entryId === entryId) {
      // The server may have accepted entry before its response was lost.
      // Recover that same entry instead of charging for another fresh run.
      entryReady = true; acceptedEntryId = entryId;
      renderMap();
      if (state.battle?.pending) showBattle();
    } else {
      status.textContent = error;
      status.classList.remove('visually-hidden');
    }
  }
  if (version === generation && adventure.open) {
    adventure.classList.toggle('adventure-entering', !entryReady && !runEnded());
    syncControls();
    (recordsAvailable() ? adventure.querySelector('#adventure-return-town') : grid).focus({ preventScroll: true });
  }
}
async function openMap(payload, { prepareOnly = false } = {}) {
  if (teamUp.open) teamUp.close();
  if (!adventure.open) {
    clearMap();
    adventure.classList.remove('adventure-ended');
    adventure.showModal();
  }
  entryReady = false;
  adventure.classList.add('adventure-entering');
  // The map takes focus, so the keyboard plays at once and Space never
  // presses Leave by accident.
  grid.focus({ preventScroll: true });
  const version = generation;
  const read = await request(payload);
  if (version !== generation || !adventure.open) return;
  if (read && !prepareOnly) await enterMap();
  if (!read) adventure.classList.remove('adventure-entering');
}
function openLobby() {
  teamUp.querySelector('#team-error').textContent = '';
  renderLobby();
  if (!teamUp.open) teamUp.showModal();
  // An invitation waiting to be answered comes first.
  const invitation = !lobby.team && lobby.invitations.length > 0;
  teamUp.querySelector(invitation ? '#team-invitation-list button'
    : lobby.team?.leader === pet?.id || !lobby.team ? '#team-invite-id' : '#team-leave').focus({ preventScroll: true });
}
document.getElementById('adventure-open').addEventListener('click', async () => {
  if (openingAdventure || adventure.open || teamUp.open) return;
  openingAdventure = true;
  const opening = ++openingVersion;
  try {
    await openMap(undefined, { prepareOnly: true });
    if (opening !== openingVersion) return;
    // A pet that hasn't set off yet chooses: alone, or with a team.
    if (adventure.open && state?.started === false) await chooseTeam();
    if (opening !== openingVersion) return;
    if (adventure.open && state) await enterMap();
  } finally { if (opening === openingVersion) openingAdventure = false; }
});
// Swaps the map for the Team up window, if the server can show it.
async function chooseTeam() {
  try {
    if (!await loadLobby()) return;
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  if (adventure.open) adventure.close();
  openLobby();
}
teamUp.querySelector('#team-invite').addEventListener('submit', event => {
  event.preventDefault();
  const player = teamUp.querySelector('#team-invite-id').value.trim();
  if (player) teamRequest({ action: 'invite', player });
});
teamUp.querySelector('#team-set-off').addEventListener('click', () => teamRequest({ action: 'set-off' }));
teamUp.querySelector('#team-leave').addEventListener('click', () => {
  if (lobby?.team) teamRequest({ action: 'leave', team: lobby.team.id });
});
// Going solo always enters a fresh run.
teamUp.querySelector('#team-solo').addEventListener('click', async () => {
  await openMap();
});
teamUp.querySelector('#team-close').addEventListener('click', () => teamUp.close());
teamUp.addEventListener('close', () => {
  // Native close restores focus before queuing this event. The player may
  // already be walking or in another window when it arrives; keep that focus.
  const focused = document.activeElement;
  if (!adventure.open && (focused === document.body || teamUp.contains(focused))) {
    document.getElementById('adventure-open').focus({ preventScroll: true });
  }
});
// Another player's change to a team this player is on, or invited to.
document.addEventListener('team:updated', async ({ detail: team }) => {
  if (!lobby || !pet) return;
  const mine = lobby.team?.id === team.id || lobby.invitations.some(i => i.id === team.id) || team.members.some(m => m.id === pet.id);
  if (!mine) return;
  try { await loadLobby(); } catch { return; }
  if (teamUp.open && lobby.run.state === 'exploring' && lobby.run.team) return openMap();
  if (teamUp.open) renderLobby();
});
function returnToTown() {
  adventure.close();
  document.getElementById('adventure-open').focus({ preventScroll: true });
}
async function endAdventure() {
  if (pending) return;
  if (runEnded() || !entryReady) return returnToTown();
  stopWalking();
  if (!await ask('End this adventure?', 'Leaving ends this run. Your next visit starts from floor 1, with the usual entry cost and wait.')) return;
  if (!adventure.open || !entryReady || state?.battle?.pending) return;
  const saved = await request({ action: 'leave' });
  if (saved && runEnded()) {
    packPanel.hidden = true;
    packToggle.setAttribute('aria-expanded', 'false');
    adventure.querySelector('#adventure-return-town').focus({ preventScroll: true });
  }
}
adventure.querySelector('#adventure-close').addEventListener('click', endAdventure);
adventure.querySelector('#adventure-return-town').addEventListener('click', returnToTown);
adventure.addEventListener('cancel', event => {
  event.preventDefault();
  if (pending) return;
  if (recordsAvailable()) return returnToTown();
  packToggle.click();
});
adventure.addEventListener('close', () => {
  stopWalking();
  generation++; pending = false; state = null; entryReady = false;
  if (guide.open) guide.close();
});
adventure.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  stopWalking();
  if (entryReady && state) request({ direction: button.dataset.direction });
}));
// Space acts on what the pet stands on: it opens the chest, or takes the
// stairs. On a focused button or summary, Space presses that instead.
function interact() {
  stopWalking();
  if (!entryReady || !packPanel.hidden || runEnded()) return;
  const chest = state?.chests.find(at);
  const control = chest && !chest.reward ? '#adventure-open-chest'
    : at(state?.down) ? '#adventure-descend' : at(state?.up) ? '#adventure-ascend' : null;
  const button = control && adventure.querySelector(control);
  if (button && !button.disabled) button.click();
}
adventure.addEventListener('keydown', event => {
  if (!adventure.open || event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input, textarea, select, [contenteditable]')) return;
  if (event.key === ' ') {
    if (event.target.matches('button, summary, a[href]')) return;
    event.preventDefault();
    if (!event.repeat) interact();
    return;
  }
  const key = event.key.toLowerCase();
  const direction = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' }[key] || key;
  if (!['w', 'a', 's', 'd'].includes(direction)) return;
  event.preventDefault();
  stopWalking();
  if (entryReady && state && !state.battle?.pending && !runEnded() && !busyText() && packPanel.hidden &&
    (!event.repeat || performance.now() - lastWalkKey > 170)) {
    lastWalkKey = performance.now();
    request({ direction });
  }
});
let lastWalkKey = 0;
const packToggle = adventure.querySelector('#adventure-pack-toggle');
const packPanel = adventure.querySelector('#adventure-pack-panel');
packToggle.addEventListener('click', () => {
  stopWalking();
  packPanel.hidden = !packPanel.hidden;
  packToggle.setAttribute('aria-expanded', String(!packPanel.hidden));
  if (!packPanel.hidden) packPanel.querySelector('details').open = true;
  syncControls();
  syncAdventureMotion();
});
window.addEventListener('resize', () => drawCamera(true));
function syncAdventureMotion() {
  const paused = !adventure.open || document.hidden || !packPanel.hidden || recordsAvailable() || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== adventure);
  adventure.classList.toggle('adventure-motion-paused', paused);
  if (paused) stopWalking();
}
new MutationObserver(syncAdventureMotion).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
document.addEventListener('visibilitychange', syncAdventureMotion);
window.addEventListener('blur', () => { stopWalking(); adventure.classList.add('adventure-motion-paused'); });
window.addEventListener('focus', syncAdventureMotion);
// Tap routing follows only confirmed server positions. A battle, window, wall,
// failed request, or floor change cancels the remaining route.
grid.addEventListener('click', event => {
  const cell = event.target.closest('.adventure-tile');
  if (!cell || !entryReady || !packPanel.hidden || !state || pending || state.battle?.pending || runEnded() || busyText()) return;
  const goal = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
  stopWalking();
  if (at(goal)) return interact();
  if (state.tiles[goal.y]?.[goal.x] !== '.') return;
  const key = point => `${point.x},${point.y}`, queue = [{ x: state.x, y: state.y, path: [] }], seen = new Set([key(state)]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.x === goal.x && current.y === goal.y) { walkingPath = current.path; break; }
    for (const [direction, dx, dy] of [['w', 0, -1], ['a', -1, 0], ['s', 0, 1], ['d', 1, 0]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (seen.has(key(next)) || state.tiles[next.y]?.[next.x] !== '.') continue;
      seen.add(key(next));
      queue.push({ ...next, path: [...current.path, direction] });
    }
  }
  grid.focus({ preventScroll: true });
  const routeGeneration = walkingGeneration;
  async function step() {
    if (routeGeneration !== walkingGeneration) return;
    if (!walkingPath.length || !entryReady || !state || pending || runEnded() || busyText() ||
      !adventure.open || document.hidden || state.battle?.pending ||
      [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== adventure)) return stopWalking();
    const before = `${state.floor}:${state.x},${state.y}`, floor = state.floor;
    await request({ direction: walkingPath.shift() });
    if (routeGeneration !== walkingGeneration) return;
    if (!state || state.floor !== floor || `${state.floor}:${state.x},${state.y}` === before || state.battle?.pending) return stopWalking();
    walkingTimer = setTimeout(step, 180);
  }
  step();
});
for (const action of ['ascend', 'descend']) {
  adventure.querySelector(`#adventure-${action}`).addEventListener('click', () => request({ action }));
}
adventure.querySelector('#adventure-replay').addEventListener('click', () => {
  if (!recordsAvailable()) return;
  const list = adventure.querySelector('#adventure-records');
  list.hidden = !list.hidden;
  adventure.querySelector('#adventure-replay').setAttribute('aria-expanded', String(!list.hidden));
});
adventure.querySelector('#adventure-open-chest').addEventListener('click', () => request({ action: 'open-chest' }));
adventure.querySelector('#adventure-restart').addEventListener('click', async () => {
  await enterMap();
});
// Once a run is over, the next can be a team's instead.
adventure.querySelector('#adventure-team-up').addEventListener('click', chooseTeam);
// Asks Yes or No in the game's confirmation window (public/confirm.js).
const ask = (title, message) => new Promise(answer =>
  document.dispatchEvent(new CustomEvent('confirm:ask', { detail: { title, message, answer } })));
// The old action ID shares the same end-of-run flow for keyboard shortcuts.
adventure.querySelector('#adventure-abandon').addEventListener('click', endAdventure);
adventure.querySelector('#adventure-skip-cooldown').addEventListener('click', () => request({ action: 'skip-cooldown' }));
async function continueExploring() {
  if (!state?.battle?.pending || state.battle?.playback?.status === 'active') return;
  await request({ action: 'continue', battleId: state.battle.id });
  if (!adventure.open || document.querySelector('#battle-dialog')?.open) return;
  if (!runEnded()) return grid.focus({ preventScroll: true });
  // The way on: Start new adventure, or Skip wait while the pet rests.
  const next = [...adventure.querySelectorAll('#adventure-restart, #adventure-skip-cooldown')].find(button => !button.hidden && !button.disabled);
  (next ?? grid).focus({ preventScroll: true });
}
adventure.querySelector('#adventure-continue').addEventListener('click', continueExploring);
document.addEventListener('battle:closed', ({ detail }) => {
  if (adventure.open && detail.key === `adventure:${state?.battle?.id}`) continueExploring();
});
document.addEventListener('adventure:pet', event => {
  pet = event.detail;
  const inventory = state?.inventory;
  if (inventory) {
    inventory.stamina = pet.stamina; inventory.hygiene = pet.hygiene;
    for (const item of inventory.items) {
      item.quantity = pet[item.id];
      item.usable = item.quantity > 0 && (item.effect === 'skip' ? pet.activity !== 'idle' : pet[item.restores] < 100);
    }
    for (const ability of inventory.abilities) ability.learned = pet.abilities?.includes(ability.id) ?? ability.id === 'claw-strike';
    for (const coin of inventory.coins) {
      coin.quantity = pet.coins?.[coin.id] ?? 0;
      coin.equipped = pet.equippedCoin === coin.id;
    }
  }
  if (adventure.open) renderMap();
});
document.addEventListener('adventure:reset', () => {
  openingVersion++; openingAdventure = false;
  generation++; pending = false; state = null; pet = null;
  lobbyGeneration++; lobbyPending = false; lobby = null;
  if (adventure.open) adventure.close();
  if (teamUp.open) teamUp.close();
  clearMap();
});
