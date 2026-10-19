const adventure = document.createElement('dialog');
adventure.id = 'adventure-dialog';
adventure.setAttribute('aria-labelledby', 'adventure-title');
adventure.innerHTML = `
  <header><div><p class="section-label" id="adventure-floor">ADVENTURE · FLOOR 1 / 5</p><h2 id="adventure-title">Woodland clearing</h2></div>
    <div class="adventure-header-actions">
      <button type="button" id="adventure-tutorial-toggle" class="chip-btn chip-buy">How to play</button>
      <button type="button" id="adventure-close" class="chip-btn">Leave</button>
    </div></header>
  <p class="help adventure-tutorial-line" id="adventure-intro">Move: WASD or arrows. Space: act on your tile (open, climb).</p>
  <div class="adventure-layout"><div class="adventure-map-area">
  <div id="adventure-grid" role="img" aria-label="Woodland map" tabindex="0"></div>
  <p id="adventure-status" role="status">Opening the clearing…</p>
  <p id="adventure-resources" aria-live="polite"></p>
  <p id="adventure-failure" role="status" hidden>Adventure failed. Start a new adventure to try again.</p>
  <p id="adventure-cooldown" role="status" hidden></p>
  <button type="button" id="adventure-skip-cooldown" class="chip-btn" hidden>Skip wait (use Hourglass)</button>
  <div class="adventure-next">
    <button type="button" id="adventure-restart" class="chip-btn" hidden>Start new adventure</button>
    <button type="button" id="adventure-team-up" class="chip-btn chip-buy" hidden>Team up</button>
  </div>
  <button type="button" id="adventure-abandon" class="chip-btn" hidden>Abandon run</button>
  <section id="adventure-battle-summary" aria-label="Last monster battle" hidden>
    <p id="adventure-result" role="status"></p>
    <div class="adventure-battle-actions">
      <button type="button" id="adventure-replay" class="chip-btn">Watch last battle</button>
      <button type="button" id="adventure-continue" class="chip-btn" hidden>Continue exploring</button>
    </div>
  </section>
  <div class="adventure-controls" aria-label="Movement controls">
    <button type="button" data-direction="w" aria-label="Move up">↑</button>
    <button type="button" data-direction="a" aria-label="Move left">←</button>
    <button type="button" data-direction="s" aria-label="Move down">↓</button>
    <button type="button" data-direction="d" aria-label="Move right">→</button>
  </div>
  <div class="adventure-stairs">
    <button type="button" id="adventure-ascend" class="chip-btn" disabled>↑ Ascend</button>
    <button type="button" id="adventure-descend" class="chip-btn" disabled>↓ Descend</button>
  </div>
  <button type="button" id="adventure-open-chest" class="chip-btn" disabled>Open chest</button>
  <p id="adventure-treasure" role="status"></p>
  <p id="adventure-notice" role="status"></p>
  </div><aside class="adventure-guide" aria-label="Floor guide">
    <section id="adventure-team" aria-labelledby="adventure-team-heading" hidden>
      <h3 id="adventure-team-heading">Your team</h3>
      <ul id="adventure-team-list"></ul>
      <p class="help adventure-tutorial-line">Nearby teammates join your battles. One reward per chest, team-wide.</p>
    </section>
    <h3>On this floor</h3>
    <p class="help" id="adventure-stair-hint"></p>
    <div class="adventure-legend" aria-label="Map legend"></div>
    <p class="help adventure-tutorial-line">HP/MP carry over. Win = +20% back.</p>
    <details><summary>Monster attributes</summary>
      <p class="help adventure-tutorial-line">A monster within 3 blocks (!) chases, then attacks once beside you.</p>
      <ul id="adventure-enemies"></ul>
    </details>
    <p class="help" id="adventure-restart-cost"></p>
    <p id="adventure-completion" class="help" role="status" hidden>Slime King defeated! Keep exploring if you like.</p>
    <details><summary>Treasure odds</summary><p class="help">Food 30% · Soap 30% · Ability 20% · Hourglass 15% · Coin 5%.</p></details>
    <details class="adventure-backpack">
      <summary id="adventure-backpack-title">Your backpack</summary>
      <p class="help" id="adventure-care"></p>
      <ul id="adventure-items"></ul>
      <h4>Learned abilities</h4><ul id="adventure-abilities"></ul>
      <h4>Unfair coins</h4><ul id="adventure-coins"></ul>
      <p class="help adventure-tutorial-line">A coin toss decides who strikes first.</p>
    </details>
  </aside></div>`;
document.body.append(adventure);
const grid = adventure.querySelector('#adventure-grid');
const status = adventure.querySelector('#adventure-status');
let pending = false, generation = 0, state = null, pet = null, shownBattle = null;
// Order of map requests sent and of the last one shown, so an older answer
// never replaces a newer one.
let sent = 0, shown = 0, patrolling = false;
// Shown automatically only for a pet that has never adventured before
// (state.started), then stays out of the way; How to play brings it back.
let tutorialSeen = false, tutorialKnown = false;
function renderTutorial() {
  adventure.querySelectorAll('.adventure-tutorial-line').forEach(line => { line.hidden = tutorialSeen; });
}
adventure.querySelector('#adventure-tutorial-toggle').addEventListener('click', () => {
  tutorialSeen = false;
  renderTutorial();
});
const icons = {
  slime: '<use href="#monster-slime"/>',
  goblin: '<use href="#monster-goblin"/>',
  'slime-king': '<use href="#monster-slime-king"/>',
  chest: '<rect x="3" y="7" width="18" height="14" rx="2" fill="currentColor"/><path d="M3 13h18m-11-3h4v6h-4Z"/>',
  'open-chest': '<path d="M3 13h18v8H3Z" fill="currentColor"/><path d="M3 10 6 3h15v7Zm7 3h4v4h-4Z"/>',
  up: '<path d="M3 21h6v-6h6V9h6M5 10V2m-3 3 3-3 3 3"/>',
  down: '<path d="M3 21h6v-6h6V9h6M5 2v8m-3-3 3 3 3-3"/>',
};
const mapIcon = kind => `<svg viewBox="0 0 24 24" aria-hidden="true" class="adventure-icon">${icons[kind]}</svg>`;
const legend = adventure.querySelector('.adventure-legend');
for (const [kind, label] of [['slime', 'Slime'], ['goblin', 'Goblin'], ['slime-king', 'Slime King'], ['chest', 'Chest'], ['up', 'Stairs up'], ['down', 'Stairs down']]) {
  const entry = document.createElement('span');
  entry.className = `adventure-marker-${kind}`;
  entry.innerHTML = mapIcon(kind);
  entry.append(document.createTextNode(label));
  legend.append(entry);
}
const at = point => state && point && point.x === state.x && point.y === state.y;
// From the latest broadcast pet; the server refuses exploring while busy anyway.
const busyText = () => pet?.activity === 'studying' ? `Your pet is busy studying ${pet.task}. Explore once it's done.`
  : pet?.activity === 'working' ? `Your pet is busy working at the ${pet.task}. Explore once it's done.` : '';
function syncControls() {
  const busy = Boolean(busyText());
  const blocked = pending || Boolean(state?.battle?.pending) || Boolean(state?.failed || state?.abandoned) || busy;
  function disable(button, value) {
    // Keep keyboard input inside the map when the active control is disabled.
    if (value && document.activeElement === button) grid.focus({ preventScroll: true });
    button.disabled = value;
  }
  for (const [action, stair] of [['ascend', state?.up], ['descend', state?.down]]) {
    const button = adventure.querySelector(`#adventure-${action}`);
    disable(button, blocked || !at(stair));
  }
  adventure.querySelectorAll('[data-direction]').forEach(button => disable(button, blocked));
  disable(adventure.querySelector('#adventure-continue'), pending);
  disable(adventure.querySelector('#adventure-replay'), pending);
  disable(adventure.querySelector('#adventure-restart'), pending || Boolean(state?.battle?.pending) || busy);
  disable(adventure.querySelector('#adventure-team-up'), pending || Boolean(state?.battle?.pending));
  disable(adventure.querySelector('#adventure-abandon'), pending || Boolean(state?.battle?.pending) || busy);
  const hourglasses = state?.inventory?.items.find(item => item.id === 'hourglass')?.quantity ?? 0;
  disable(adventure.querySelector('#adventure-skip-cooldown'), pending || hourglasses < 1);
  const chest = state?.chests.find(at);
  const open = adventure.querySelector('#adventure-open-chest');
  open.textContent = chest?.reward ? 'Chest opened' : 'Open chest';
  disable(open, blocked || !chest || Boolean(chest.reward));
  adventure.querySelectorAll('[data-use-item]').forEach(button => disable(button,
    pending || Boolean(state?.battle?.pending) || !state?.inventory?.items.find(item => item.id === button.dataset.useItem)?.usable));
}
function clearMap() {
  state = null; shownBattle = null; tutorialKnown = false;
  grid.replaceChildren();
  grid.setAttribute('aria-label', 'Woodland map');
  grid.setAttribute('aria-busy', 'false');
  adventure.querySelector('#adventure-title').textContent = 'Woodland adventure';
  adventure.querySelector('#adventure-floor').textContent = 'ADVENTURE';
  adventure.querySelector('#adventure-stair-hint').textContent = '';
  adventure.querySelector('#adventure-enemies').replaceChildren();
  adventure.querySelector('#adventure-team').hidden = true;
  adventure.querySelector('#adventure-team-list').replaceChildren();
  adventure.querySelector('#adventure-notice').textContent = '';
  adventure.querySelector('#adventure-battle-summary').hidden = true;
  adventure.querySelector('#adventure-result').textContent = '';
  adventure.querySelector('#adventure-continue').hidden = true;
  adventure.querySelector('#adventure-completion').hidden = true;
  adventure.querySelector('#adventure-failure').hidden = true;
  adventure.querySelector('#adventure-restart').hidden = true;
  adventure.querySelector('#adventure-team-up').hidden = true;
  adventure.querySelector('#adventure-abandon').hidden = true;
  adventure.querySelector('#adventure-cooldown').hidden = true;
  adventure.querySelector('#adventure-skip-cooldown').hidden = true;
  adventure.querySelector('#adventure-restart-cost').textContent = '';
  adventure.querySelector('#adventure-resources').textContent = '';
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
  const minutes = Math.max(1, Math.ceil(((state.cooldownUntil - Date.now()) * state.timeScale) / 60_000));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const wait = [h && `${h} h`, (m || !h) && `${m} min`].filter(Boolean).join(' ');
  return ended ? `Your pet needs to rest. Next adventure in ${wait}.` : `If you abandon this run, the next adventure opens in ${wait}.`;
}
// Only the cooldown message/buttons, so the 1 s tick doesn't rebuild the map.
// The wait only gates starting over, so a run in progress plays on as normal,
// and abandoning (which is free) stays available.
function renderCooldown() {
  if (!state) return;
  const active = cooldownActive(), ended = state.failed || state.completed || state.abandoned;
  adventure.querySelector('#adventure-cooldown').hidden = !active;
  if (active) adventure.querySelector('#adventure-cooldown').textContent = cooldownText(ended);
  adventure.querySelector('#adventure-skip-cooldown').hidden = !active || !ended;
  adventure.querySelector('#adventure-restart').hidden = active || !ended;
  adventure.querySelector('#adventure-team-up').hidden = active || !ended;
  adventure.querySelector('#adventure-abandon').hidden = ended || Boolean(state.battle?.pending);
  syncControls();
}
setInterval(() => { if (adventure.open) renderCooldown(); }, 1000);

function renderMap() {
  if (!state) return;
  // Shown by default only before the pet's very first move; later refreshes
  // (patrols, battles) leave a player's own How to play toggle alone.
  if (!tutorialKnown) { tutorialSeen = state.started; tutorialKnown = true; }
  renderTutorial();
  adventure.querySelector('#adventure-title').textContent = state.name;
  adventure.querySelector('#adventure-floor').textContent = `ADVENTURE · FLOOR ${state.floor} / ${state.floorCount}`;
  adventure.querySelector('#adventure-stair-hint').textContent = state.down
    ? '↓ stairs: column 14, row 14.'
    : state.completed ? 'Final floor. Slime King defeated.' : 'Final floor: the Slime King.';
  adventure.querySelector('#adventure-completion').hidden = !state.completed;
  adventure.querySelector('#adventure-failure').hidden = !state.failed && !state.abandoned;
  adventure.querySelector('#adventure-failure').textContent =
    `Adventure ${state.abandoned ? 'abandoned' : 'failed'}. Start a new adventure to try again.`;
  adventure.querySelector('#adventure-restart-cost').textContent =
    `New run: ${state.restartCost.stamina} stamina, ${state.restartCost.hygiene} hygiene, ${state.cooldownMinutes / 60}h cooldown.`;
  renderCooldown();
  adventure.querySelector('#adventure-resources').textContent = `HP ${state.hp} / ${state.maxHp} · MP ${state.mp} / ${state.maxMp}`;
  adventure.querySelector('#adventure-battle-summary').hidden = !state.battle;
  adventure.querySelector('#adventure-result').textContent = state.battle ? battleResult(state.battle) : '';
  adventure.querySelector('#adventure-continue').hidden = !state.battle?.pending;
  const opened = state.chests.find(chest => chest.reward);
  adventure.querySelector('#adventure-treasure').textContent = opened ? rewardText(opened.reward) : '';
  renderInventory();
  renderMonsters();
  status.textContent = `Column ${state.x + 1} · Row ${state.y + 1}`;
  syncControls();
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
// What a monster's step can change, so a patrol leaves the rest of the
// window, its focus, and its announcements alone.
function renderMonsters() {
  renderTeam();
  const roster = adventure.querySelector('#adventure-enemies');
  roster.replaceChildren();
  for (const enemy of state.enemies) {
    const item = document.createElement('li');
    const moves = (enemy.moves ?? []).map(move => ` · ${move.name} (${move.mpCost} MP): ${move.description}`).join('');
    item.textContent = `${enemy.name} · column ${enemy.x + 1}, row ${enemy.y + 1} · HP ${enemy.strength + enemy.intelligence + enemy.charisma} · MP ${enemy.intelligence} · STR ${enemy.strength} / INT ${enemy.intelligence} / CHA ${enemy.charisma}${moves}`;
    roster.append(item);
  }
  grid.replaceChildren();
  state.tiles.forEach((row, y) => [...row].forEach((tile, x) => {
    const cell = document.createElement('span');
    cell.className = tile === '#' ? 'adventure-tree' : 'adventure-path';
    const enemy = state.enemies.find(e => e.x === x && e.y === y);
    const chest = state.chests.find(c => c.x === x && c.y === y);
    const stair = [state.up && { ...state.up, kind: 'up' }, state.down && { ...state.down, kind: 'down' }].find(s => s && s.x === x && s.y === y);
    const kind = enemy?.kind || (chest ? 'chest' : stair?.kind);
    if (kind) {
      cell.classList.add(`adventure-marker-${kind}`);
      cell.innerHTML = mapIcon(chest?.reward ? 'open-chest' : kind);
      if (chest?.reward) cell.classList.add('adventure-chest-opened');
      cell.title = enemy ? `${enemy.name} · HP ${enemy.strength + enemy.intelligence + enemy.charisma} · MP ${enemy.intelligence}` : chest ? (chest.reward ? `Opened chest · ${chest.reward.name}` : 'Unopened treasure chest') : `Stairs ${stair.kind}`;
      if (enemy?.alerted) cell.classList.add('adventure-alerted');
    }
    const mate = teammatesHere().find(m => m.x === x && m.y === y);
    if (mate && !(x === state.x && y === state.y)) {
      cell.classList.add('adventure-teammate');
      cell.title = `${mate.id} · HP ${mate.hp} / ${mate.maxHp}`;
      cell.innerHTML = avatarFor(mate);
    }
    if (x === state.x && y === state.y) {
      cell.classList.add('adventure-player');
      // Teammates can share a tile (they all set off from the same one).
      if (mate) {
        cell.classList.add('adventure-shared');
        cell.dataset.shared = String(teammatesHere().filter(m => m.x === x && m.y === y).length + 1);
      }
      const shape = ['blob', 'cat', 'dog', 'bird', 'dragon'].includes(pet?.appearance) ? pet.appearance : 'blob';
      cell.innerHTML = `<svg class="pet-avatar" viewBox="0 0 120 110" aria-hidden="true"><use href="#pet-${shape}" /></svg>`;
      if (pet?.color) cell.style.setProperty('--pet-color', pet.color);
    }
    grid.append(cell);
  }));
  const mates = teammatesHere(), sharing = mates.filter(m => m.x === state.x && m.y === state.y).map(m => m.id);
  grid.setAttribute('aria-label', `Floor ${state.floor} of ${state.floorCount}, 16 by 16 woodland map. Your pet is at column ${state.x + 1}, row ${state.y + 1}${sharing.length ? `, with ${sharing.join(', ')}` : ''}. ${state.enemies.length} monsters and ${state.chests.length} chest.${mates.length ? ` ${mates.length} ${mates.length > 1 ? 'teammates' : 'teammate'} here; positions are in Your team.` : ''} Monster locations are in Monster attributes. Trees block movement; stepping into a monster starts battle, and so does a monster stepping into your pet. Space opens a chest or takes the stairs your pet stands on.`);
  const nearby = state.enemies.filter(e => state.encounters.includes(e.id));
  const spotted = state.enemies.filter(e => e.alerted && !state.encounters.includes(e.id));
  const notice = busyText() || (nearby.length
    ? `${nearby.map(e => e.name).join(', ')} nearby! Step into ${nearby.length > 1 ? 'one' : 'it'} to battle, or move away before ${nearby.length > 1 ? 'they attack' : 'it attacks'}.`
    : spotted.length ? `${spotted.map(e => e.name).join(', ')} spotted you! Move more than 3 blocks away to lose ${spotted.length > 1 ? 'them' : 'it'}.`
    : state.chests.some(at) ? (state.chests.find(at).reward ? 'Chest already opened.' : 'You found a treasure chest. Press Space or choose Open chest to collect its reward.')
    : at(state.up) ? 'Stairs up: Space or Ascend.'
    : at(state.down) ? 'Stairs down: press Space or choose Descend to explore deeper.' : '');
  // Only a new message is announced again.
  const noticeText = adventure.querySelector('#adventure-notice');
  if (noticeText.textContent !== notice) noticeText.textContent = notice;
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
  const items = adventure.querySelector('#adventure-items');
  items.replaceChildren();
  for (const item of inventory.items) {
    const row = document.createElement('li'), label = document.createElement('strong'), effect = document.createElement('span'), button = document.createElement('button');
    label.textContent = `${item.name} × ${item.quantity}`;
    effect.textContent = item.effect === 'skip' ? 'Finish the current lesson or shift.' : `Restore ${item.amount} ${item.restores}.`;
    button.type = 'button'; button.className = 'chip-btn'; button.dataset.useItem = item.id;
    button.textContent = { food: 'Feed', soap: 'Clean', hourglass: 'Skip activity' }[item.id];
    button.setAttribute('aria-label', `Use ${item.name}`);
    button.disabled = pending || Boolean(state.battle?.pending) || !item.usable;
    button.addEventListener('click', () => request({ action: 'use-item', item: item.id }));
    row.append(label, effect, button); items.append(row);
    if (focused === item.id) (button.disabled ? grid : button).focus({ preventScroll: true });
  }
  const abilities = adventure.querySelector('#adventure-abilities');
  abilities.replaceChildren();
  for (const ability of inventory.abilities.filter(a => a.learned)) {
    const row = document.createElement('li');
    row.textContent = `${ability.name} · ${ability.mpCost} MP. ${ability.description}`;
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
    button.disabled = coin.quantity < 1 && !coin.equipped;
    button.addEventListener('click', () => { button.disabled = true; equipCoin(button, coin.equipped ? null : coin.id); });
    row.append(label, effect, button); coins.append(row);
  }
}
async function equipCoin(button, coinId) {
  if (!pet) return;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(pet.id)}/equip-coin/${encodeURIComponent(coinId ?? 'none')}`, { method: 'POST' });
    if (!res.ok) button.disabled = false;
  } catch {
    button.disabled = false;
  }
}
// In a team battle the team can win while this pet is knocked out.
function battleResult(battle) {
  const knockedOut = battle.after?.hp === 0;
  const team = battle.playback.fighters.length > 2 ? 'Your team' : 'You';
  if (battle.won && knockedOut) return `${team} defeated ${battle.enemyName} on floor ${battle.floor}, but your pet was knocked out. Its adventure is over; your teammates explore on.`;
  return battle.won
    ? `${team} defeated ${battle.enemyName} on floor ${battle.floor}. Recovered ${battle.recovery.hp} HP and ${battle.recovery.mp} MP.${battle.enemyId === 'slime-king' ? ' Woodland complete!' : ''}`
    : `${battle.enemyName} defeated ${team === 'You' ? 'you' : 'your team'}. Adventure failed. Start a new adventure to try again.`;
}
function showBattle(replay = false) {
  const battle = state?.battle;
  if (!battle || (!replay && shownBattle === battle.id)) return;
  shownBattle = battle.id;
  const last = battle.playback.turns.at(-1), mine = battle.fighter ?? 0;
  // What the pet carries back to the map (a Copper shield's leftover is gone).
  const hp = [...last.hp], mp = [...last.mp];
  hp[mine] = battle.after?.hp ?? last.hp[mine] + battle.recovery.hp;
  mp[mine] = battle.after?.mp ?? last.mp[mine] + battle.recovery.mp;
  document.dispatchEvent(new CustomEvent('battle:show', { detail: {
    key: `adventure:${battle.id}`, battle: battle.playback, viewer: battle.playback.fighters[mine].id,
    title: `Floor ${battle.floor} · ${battle.enemyName}${battle.attacked ? ' attacks!' : ''}`, result: battleResult(battle), won: battle.won,
    replay: true, returnLabel: 'Return to map', resultResources: { hp, mp },
  } }));
}
async function request(payload = {}) {
  if (pending) return;
  if (payload.direction || payload.action) payload = { ...payload, revision: state?.revision };
  const version = generation, order = ++sent;
  pending = true;
  grid.setAttribute('aria-busy', 'true');
  syncControls();
  try {
    const response = await fetch('/api/adventure', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (version !== generation) return;
    if (!response.ok) throw new Error(result.error || 'Could not explore. Try again.');
    state = result; shown = order;
    renderMap();
    if (state.battle?.pending) showBattle();
  } catch (error) {
    if (version === generation) status.textContent = error.message || 'Connection lost. Try again.';
  } finally {
    if (version === generation) {
      pending = false;
      grid.setAttribute('aria-busy', 'false');
      syncControls();
    }
  }
}
// Monsters move in real time while the map is open and on screen: the page
// asks for each step, and the server decides where they go and how often.
async function patrol() {
  if (!adventure.open || document.hidden || patrolling || pending || !state || state.battle?.pending
    || state.failed || state.abandoned || busyText()) return;
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
  const shape = ['blob', 'cat', 'dog', 'bird', 'dragon'].includes(member.appearance) ? member.appearance : 'blob';
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
    if (lobby.run.state === 'exploring' && lobby.run.team) return openMap();
  } catch (error) {
    teamUp.querySelector('#team-error').textContent = error.message || 'Connection lost. Try again.';
  } finally {
    lobbyPending = false;
    renderLobby();
  }
}
function openMap(payload) {
  if (teamUp.open) teamUp.close();
  if (adventure.open) return request(payload);
  clearMap();
  adventure.showModal();
  // The map takes focus, so the keyboard plays at once and Space never
  // presses Leave by accident.
  grid.focus({ preventScroll: true });
  return request(payload);
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
  if (adventure.open || teamUp.open) return;
  await openMap();
  // A pet that hasn't set off yet chooses: alone, or with a team.
  if (adventure.open && state?.started === false) await chooseTeam();
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
// Going solo opens the pet's own map: a first run starts with its first
// move, and after a run has ended, solo starts a fresh one.
teamUp.querySelector('#team-solo').addEventListener('click', async () => {
  const ended = lobby?.run.state === 'ended';
  await openMap();
  if (ended && adventure.open && (state?.failed || state?.abandoned || state?.completed)) {
    await request({ action: 'restart' });
    if (adventure.open) grid.focus({ preventScroll: true });
  }
});
teamUp.querySelector('#team-close').addEventListener('click', () => teamUp.close());
teamUp.addEventListener('close', () => {
  if (!adventure.open) document.getElementById('adventure-open').focus({ preventScroll: true });
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
adventure.querySelector('#adventure-close').addEventListener('click', () => adventure.close());
adventure.addEventListener('close', () => { generation++; pending = false; state = null; });
adventure.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  if (state) request({ direction: button.dataset.direction });
  else request();
}));
// Space acts on what the pet stands on: it opens the chest, or takes the
// stairs. On a focused button or summary, Space presses that instead.
function interact() {
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
  if (!event.repeat && state && !state.battle?.pending && !state.failed && !state.abandoned && !busyText()) request({ direction });
});
for (const action of ['ascend', 'descend']) {
  adventure.querySelector(`#adventure-${action}`).addEventListener('click', () => request({ action }));
}
adventure.querySelector('#adventure-replay').addEventListener('click', () => showBattle(true));
adventure.querySelector('#adventure-open-chest').addEventListener('click', () => request({ action: 'open-chest' }));
adventure.querySelector('#adventure-restart').addEventListener('click', async () => {
  await request({ action: 'restart' });
  if (adventure.open) grid.focus({ preventScroll: true });
});
// Once a run is over, the next can be a team's instead.
adventure.querySelector('#adventure-team-up').addEventListener('click', chooseTeam);
// Asks Yes or No in the game's confirmation window (public/confirm.js).
const ask = (title, message) => new Promise(answer =>
  document.dispatchEvent(new CustomEvent('confirm:ask', { detail: { title, message, answer } })));
// Abandoning ends the mini-game at once: the run is over and the map closes.
adventure.querySelector('#adventure-abandon').addEventListener('click', async () => {
  const cost = state?.restartCost;
  if (!await ask('Abandon this adventure?', `It ends now${cost ? `, and starting a new one costs ${cost.stamina} stamina and ${cost.hygiene} hygiene` : ''}.`)) return;
  await request({ action: 'abandon' });
  if (adventure.open && state?.abandoned) {
    adventure.close();
    document.getElementById('adventure-open').focus({ preventScroll: true });
  }
});
adventure.querySelector('#adventure-skip-cooldown').addEventListener('click', () => request({ action: 'skip-cooldown' }));
async function continueExploring() {
  if (!state?.battle?.pending) return;
  await request({ action: 'continue', battleId: state.battle.id });
  if (!adventure.open || document.querySelector('#battle-dialog')?.open) return;
  if (!state?.failed) return grid.focus({ preventScroll: true });
  // The way on: Start new adventure, or Skip wait while the pet rests.
  const next = [...adventure.querySelectorAll('#adventure-restart, #adventure-skip-cooldown')].find(button => !button.hidden && !button.disabled);
  (next ?? grid).focus({ preventScroll: true });
  offerFreshStart();
}
// After a defeat, ask whether to go again. While the pet still rests, first
// ask whether to spend an Hourglass on the wait, then whether to start. No
// leaves the failed run on screen, with its buttons, to decide later.
async function offerFreshStart() {
  const cost = state.restartCost, hourglasses = state.inventory?.items.find(item => item.id === 'hourglass')?.quantity ?? 0;
  const resting = cooldownActive();
  if (resting && hourglasses < 1) return;
  const yes = await ask('Your pet was defeated', resting
    ? `${cooldownText(true)} Use an Hourglass to skip the wait?`
    : `Start a new adventure? It costs ${cost.stamina} stamina and ${cost.hygiene} hygiene, and opens a ${state.cooldownMinutes / 60}-hour wait before the next one.`);
  if (!yes || !adventure.open || !state?.failed) return;
  await request({ action: resting ? 'skip-cooldown' : 'restart' });
  if (!adventure.open) return;
  if (!state?.failed) return grid.focus({ preventScroll: true });
  adventure.querySelector('#adventure-restart').focus({ preventScroll: true });
  if (resting && !cooldownActive()) offerFreshStart();
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
  generation++; pending = false; state = null; pet = null;
  lobbyGeneration++; lobbyPending = false; lobby = null;
  if (adventure.open) adventure.close();
  if (teamUp.open) teamUp.close();
  clearMap();
});
