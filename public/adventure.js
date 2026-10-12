const adventure = document.createElement('dialog');
adventure.id = 'adventure-dialog';
adventure.setAttribute('aria-labelledby', 'adventure-title');
adventure.innerHTML = `
  <header><div><p class="section-label" id="adventure-floor">ADVENTURE · FLOOR 1 / 5</p><h2 id="adventure-title">Woodland clearing</h2></div>
    <button type="button" id="adventure-close" class="chip-btn" autofocus>Leave</button></header>
  <p class="help">W/A/S/D or arrow keys to move one block. Step into a monster to battle.</p>
  <div class="adventure-layout"><div class="adventure-map-area">
  <div id="adventure-grid" role="img" aria-label="Woodland map" tabindex="0"></div>
  <p id="adventure-status" role="status">Opening the clearing…</p>
  <p id="adventure-resources" aria-live="polite"></p>
  <p id="adventure-failure" role="status" hidden>Adventure failed. Start a new adventure to try again.</p>
  <p id="adventure-cooldown" role="status" hidden></p>
  <button type="button" id="adventure-skip-cooldown" class="chip-btn" hidden>Skip wait (use Hourglass)</button>
  <button type="button" id="adventure-restart" class="chip-btn" hidden>Start new adventure</button>
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
    <h3>On this floor</h3>
    <p class="help" id="adventure-stair-hint"></p>
    <div class="adventure-legend" aria-label="Map legend"></div>
    <details><summary>Monster attributes</summary><ul id="adventure-enemies"></ul></details>
    <p class="help">Monsters notice the eight blocks around them and move after you. Go around them to avoid battle.</p>
    <p class="help">HP and MP carry between battles. Each victory restores 20% of their maximums, rounded up. Defeat ends the adventure.</p>
    <p class="help" id="adventure-restart-cost"></p>
    <p id="adventure-completion" class="help" role="status" hidden>Slime King defeated! The woodland is complete. You can keep exploring.</p>
    <p class="help">Stand on a chest and choose Open chest. Each chest holds one reward per adventure.</p>
    <details><summary>Treasure chances</summary><p class="help">Food 30% · Soap 30% · Ability 20% · Hourglass 15% · Unfair coin 5%. Abilities and coin types have equal chances within their category.</p></details>
    <details class="adventure-backpack">
      <summary id="adventure-backpack-title">Your backpack</summary>
      <p class="help" id="adventure-care"></p>
      <ul id="adventure-items"></ul>
      <h4>Learned abilities</h4><ul id="adventure-abilities"></ul>
      <p class="help">Your pet uses its strongest affordable attack automatically. Items and learned abilities stay with your pet.</p>
      <h4>Unfair coins</h4><ul id="adventure-coins"></ul>
      <p class="help">A coin toss decides who attacks first; an equipped coin applies in Adventure, Arena, and revenge.</p>
    </details>
  </aside></div>`;
document.body.append(adventure);
const grid = adventure.querySelector('#adventure-grid');
const status = adventure.querySelector('#adventure-status');
let pending = false, generation = 0, state = null, pet = null, shownBattle = null;
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
  const blocked = pending || Boolean(state?.battle?.pending) || Boolean(state?.failed) || busy;
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
  state = null; shownBattle = null;
  grid.replaceChildren();
  grid.setAttribute('aria-label', 'Woodland map');
  grid.setAttribute('aria-busy', 'false');
  adventure.querySelector('#adventure-title').textContent = 'Woodland adventure';
  adventure.querySelector('#adventure-floor').textContent = 'ADVENTURE';
  adventure.querySelector('#adventure-stair-hint').textContent = '';
  adventure.querySelector('#adventure-enemies').replaceChildren();
  adventure.querySelector('#adventure-notice').textContent = '';
  adventure.querySelector('#adventure-battle-summary').hidden = true;
  adventure.querySelector('#adventure-result').textContent = '';
  adventure.querySelector('#adventure-continue').hidden = true;
  adventure.querySelector('#adventure-completion').hidden = true;
  adventure.querySelector('#adventure-failure').hidden = true;
  adventure.querySelector('#adventure-restart').hidden = true;
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
  return ended ? `Your pet needs to rest. Next adventure in ${wait}.` : `You can abandon this run and start over in ${wait}.`;
}
// Only the cooldown message/buttons, so the 1 s tick doesn't rebuild the map.
// The wait only gates starting over, so a run in progress plays on as normal.
function renderCooldown() {
  if (!state) return;
  const active = cooldownActive(), ended = state.failed || state.completed;
  adventure.querySelector('#adventure-cooldown').hidden = !active;
  if (active) adventure.querySelector('#adventure-cooldown').textContent = cooldownText(ended);
  adventure.querySelector('#adventure-skip-cooldown').hidden = !active || !ended;
  adventure.querySelector('#adventure-restart').hidden = active || !ended;
  adventure.querySelector('#adventure-abandon').hidden = active || ended || Boolean(state.battle?.pending);
  syncControls();
}
setInterval(() => { if (adventure.open) renderCooldown(); }, 1000);

function renderMap() {
  if (!state) return;
  grid.replaceChildren();
  adventure.querySelector('#adventure-title').textContent = state.name;
  adventure.querySelector('#adventure-floor').textContent = `ADVENTURE · FLOOR ${state.floor} / ${state.floorCount}`;
  adventure.querySelector('#adventure-stair-hint').textContent = state.down
    ? 'Find the ↓ stairs at column 14, row 14. Stand there and choose Descend.'
    : state.completed ? 'Final floor. The Slime King has been defeated.' : 'Final floor. The Slime King guards this grove.';
  adventure.querySelector('#adventure-completion').hidden = !state.completed;
  adventure.querySelector('#adventure-failure').hidden = !state.failed;
  adventure.querySelector('#adventure-restart-cost').textContent =
    `Starting a fresh adventure — after winning, failing, or abandoning one — costs ${state.restartCost.stamina} stamina and ${state.restartCost.hygiene} hygiene and opens a ${state.cooldownMinutes / 60}-hour wait, skippable with an Hourglass.`;
  renderCooldown();
  adventure.querySelector('#adventure-resources').textContent = `HP ${state.hp} / ${state.maxHp} · MP ${state.mp} / ${state.maxMp}`;
  adventure.querySelector('#adventure-battle-summary').hidden = !state.battle;
  adventure.querySelector('#adventure-result').textContent = state.battle ? battleResult(state.battle) : '';
  adventure.querySelector('#adventure-continue').hidden = !state.battle?.pending;
  const opened = state.chests.find(chest => chest.reward);
  adventure.querySelector('#adventure-treasure').textContent = opened ? rewardText(opened.reward) : '';
  renderInventory();
  const roster = adventure.querySelector('#adventure-enemies');
  roster.replaceChildren();
  for (const enemy of state.enemies) {
    const item = document.createElement('li');
    const moves = (enemy.moves ?? []).map(move => ` · ${move.name} (${move.mpCost} MP): ${move.description}`).join('');
    item.textContent = `${enemy.name} · column ${enemy.x + 1}, row ${enemy.y + 1} · HP ${enemy.strength + enemy.intelligence + enemy.charisma} · MP ${enemy.intelligence} · STR ${enemy.strength} / INT ${enemy.intelligence} / CHA ${enemy.charisma}${moves}`;
    roster.append(item);
  }
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
    if (x === state.x && y === state.y) {
      cell.classList.add('adventure-player');
      const shape = ['blob', 'cat', 'dog', 'bird', 'dragon'].includes(pet?.appearance) ? pet.appearance : 'blob';
      cell.innerHTML = `<svg class="pet-avatar" viewBox="0 0 120 110" aria-hidden="true"><use href="#pet-${shape}" /></svg>`;
      if (pet?.color) cell.style.setProperty('--pet-color', pet.color);
    }
    grid.append(cell);
  }));
  grid.setAttribute('aria-label', `Floor ${state.floor} of ${state.floorCount}, 16 by 16 woodland map. Your pet is at column ${state.x + 1}, row ${state.y + 1}. ${state.enemies.length} monsters and ${state.chests.length} chest. Monster locations are in Monster attributes. Trees block movement; stepping into a monster starts battle.`);
  status.textContent = `Column ${state.x + 1} · Row ${state.y + 1}`;
  const nearby = state.enemies.filter(e => state.encounters.includes(e.id));
  adventure.querySelector('#adventure-notice').textContent = busyText() || (nearby.length
    ? `${nearby.map(e => e.name).join(', ')} nearby! Step into their tile to battle, or move away.`
    : state.chests.some(at) ? (state.chests.find(at).reward ? 'This chest is empty. Your reward is saved.' : 'You found a treasure chest. Choose Open chest to collect its reward.')
    : at(state.up) ? 'Stairs up: choose Ascend to return to the previous floor.'
    : at(state.down) ? 'Stairs down: choose Descend to explore deeper.' : '');
  syncControls();
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
function battleResult(battle) {
  return battle.won
    ? `You defeated ${battle.enemyName} on floor ${battle.floor}. Recovered ${battle.recovery.hp} HP and ${battle.recovery.mp} MP.${battle.enemyId === 'slime-king' ? ' Woodland complete!' : ''}`
    : `${battle.enemyName} defeated you. Adventure failed. Start a new adventure to try again.`;
}
function showBattle(replay = false) {
  const battle = state?.battle;
  if (!battle || (!replay && shownBattle === battle.id)) return;
  shownBattle = battle.id;
  const last = battle.playback.turns.at(-1);
  document.dispatchEvent(new CustomEvent('battle:show', { detail: {
    key: `adventure:${battle.id}`, battle: battle.playback, viewer: battle.playback.fighters[0].id,
    title: `Floor ${battle.floor} · ${battle.enemyName}`, result: battleResult(battle),
    replay: true, returnLabel: 'Return to map',
    // What the pet carries back to the map (a Copper shield's leftover is gone).
    resultResources: {
      hp: [battle.after?.hp ?? last.hp[0] + battle.recovery.hp, last.hp[1]],
      mp: [battle.after?.mp ?? last.mp[0] + battle.recovery.mp, last.mp[1]],
    },
  } }));
}
async function request(payload = {}) {
  if (pending) return;
  if (payload.direction || payload.action) payload = { ...payload, revision: state?.revision };
  const version = generation;
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
    state = result;
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
document.getElementById('adventure-open').addEventListener('click', () => {
  if (adventure.open) return;
  clearMap();
  adventure.showModal();
  request();
});
adventure.querySelector('#adventure-close').addEventListener('click', () => adventure.close());
adventure.addEventListener('close', () => { generation++; pending = false; state = null; });
adventure.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  if (state) request({ direction: button.dataset.direction });
  else request();
}));
adventure.addEventListener('keydown', event => {
  if (!adventure.open || event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  const direction = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' }[key] || key;
  if (!['w', 'a', 's', 'd'].includes(direction)) return;
  event.preventDefault();
  if (!event.repeat && state && !state.battle?.pending && !state.failed && !busyText()) request({ direction });
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
adventure.querySelector('#adventure-abandon').addEventListener('click', async () => {
  const cost = state?.restartCost;
  if (!window.confirm(`Abandon this run and start a new adventure? This resets your floor${cost ? ` and costs ${cost.stamina} stamina and ${cost.hygiene} hygiene` : ''}.`)) return;
  await request({ action: 'restart' });
  if (adventure.open) grid.focus({ preventScroll: true });
});
adventure.querySelector('#adventure-skip-cooldown').addEventListener('click', () => request({ action: 'skip-cooldown' }));
async function continueExploring() {
  if (!state?.battle?.pending) return;
  await request({ action: 'continue', battleId: state.battle.id });
  if (adventure.open && !document.querySelector('#battle-dialog')?.open) {
    (state?.failed ? adventure.querySelector('#adventure-restart') : grid).focus({ preventScroll: true });
  }
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
  if (adventure.open) adventure.close();
  clearMap();
});
