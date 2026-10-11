const adventure = document.createElement('dialog');
adventure.id = 'adventure-dialog';
adventure.setAttribute('aria-labelledby', 'adventure-title');
adventure.innerHTML = `
  <header><div><p class="section-label" id="adventure-floor">ADVENTURE · FLOOR 1 / 5</p><h2 id="adventure-title">Woodland clearing</h2></div>
    <button type="button" id="adventure-close" class="chip-btn" autofocus>Leave</button></header>
  <p class="help">W/A/S/D or arrow keys to move one block. Your position is saved.</p>
  <div class="adventure-layout"><div class="adventure-map-area">
  <div id="adventure-grid" role="img" aria-label="Woodland map" tabindex="0"></div>
  <p id="adventure-status" role="status">Opening the clearing…</p>
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
  <p id="adventure-notice" role="status"></p>
  </div><aside class="adventure-guide" aria-label="Floor guide">
    <h3>On this floor</h3>
    <p class="help" id="adventure-stair-hint"></p>
    <div class="adventure-legend" aria-label="Map legend"></div>
    <details><summary>Monster attributes</summary><ul id="adventure-enemies"></ul></details>
    <p class="help">Monsters notice the eight blocks around them and move after you. Step out of range to escape.</p>
    <p class="help">Chest rewards and monster battles are coming next.</p>
  </aside></div>`;
document.body.append(adventure);
const grid = adventure.querySelector('#adventure-grid');
const status = adventure.querySelector('#adventure-status');
let pending = false, generation = 0, state = null, pet = null;
const icons = {
  slime: '<path d="M3 18C2 7 8 5 12 7c6-4 10 4 9 11Z" fill="currentColor"/><path d="M8 13v2m8-2v2m-6 3h4"/>',
  goblin: '<path d="m5 9-3-5 7 3h6l7-3-3 5v8l-7 4-7-4Z" fill="currentColor"/><path d="m7 11 3 2m7-2-3 2m-4 4h4"/>',
  'slime-king': '<path d="M3 20C2 11 7 9 12 10c5-3 10 3 9 10Z" fill="currentColor"/><path d="m6 9-1-6 5 3 2-4 2 4 5-3-1 6Z" fill="var(--money)"/><path d="M8 14v2m8-2v2m-6 3h4"/>',
  chest: '<rect x="3" y="7" width="18" height="14" rx="2" fill="currentColor"/><path d="M3 13h18m-11-3h4v6h-4Z"/>',
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
function syncControls() {
  for (const [action, stair] of [['ascend', state?.up], ['descend', state?.down]]) {
    const button = adventure.querySelector(`#adventure-${action}`);
    const disabled = pending || !at(stair);
    // Disabling the focused stair button otherwise sends keyboard input to
    // the page behind the dialog, stopping W/A/S/D after changing floors.
    if (disabled && document.activeElement === button) grid.focus({ preventScroll: true });
    button.disabled = disabled;
  }
}
function clearMap() {
  state = null;
  grid.replaceChildren();
  grid.setAttribute('aria-label', 'Woodland map');
  grid.setAttribute('aria-busy', 'false');
  adventure.querySelector('#adventure-title').textContent = 'Woodland adventure';
  adventure.querySelector('#adventure-floor').textContent = 'ADVENTURE';
  adventure.querySelector('#adventure-stair-hint').textContent = '';
  adventure.querySelector('#adventure-enemies').replaceChildren();
  adventure.querySelector('#adventure-notice').textContent = '';
  status.textContent = 'Opening the woodland…';
  syncControls();
}

function renderMap() {
  if (!state) return;
  grid.replaceChildren();
  adventure.querySelector('#adventure-title').textContent = state.name;
  adventure.querySelector('#adventure-floor').textContent = `ADVENTURE · FLOOR ${state.floor} / ${state.floorCount}`;
  adventure.querySelector('#adventure-stair-hint').textContent = state.down
    ? 'Find the ↓ stairs at column 14, row 14. Stand there and choose Descend.'
    : 'Final floor. The Slime King guards this grove.';
  const roster = adventure.querySelector('#adventure-enemies');
  roster.replaceChildren();
  for (const enemy of state.enemies) {
    const item = document.createElement('li');
    item.textContent = `${enemy.name} · column ${enemy.x + 1}, row ${enemy.y + 1} · HP ${enemy.strength + enemy.intelligence + enemy.charisma} · MP ${enemy.intelligence} · STR ${enemy.strength} / INT ${enemy.intelligence} / CHA ${enemy.charisma}`;
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
      cell.innerHTML = mapIcon(kind);
      cell.title = enemy ? `${enemy.name} · HP ${enemy.strength + enemy.intelligence + enemy.charisma} · MP ${enemy.intelligence}` : chest ? 'Treasure chest (rewards coming later)' : `Stairs ${stair.kind}`;
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
  grid.setAttribute('aria-label', `Floor ${state.floor} of ${state.floorCount}, 16 by 16 woodland map. Your pet is at column ${state.x + 1}, row ${state.y + 1}. ${state.enemies.length} monsters and ${state.chests.length} chest. Monster locations are in Monster attributes. Trees and monsters block movement.`);
  status.textContent = `Column ${state.x + 1} · Row ${state.y + 1}`;
  const nearby = state.enemies.filter(e => state.encounters.includes(e.id));
  adventure.querySelector('#adventure-notice').textContent = nearby.length
    ? `${nearby.map(e => e.name).join(', ')} nearby! Move away to avoid them. Battles are coming next.`
    : state.chests.some(at) ? 'You found a treasure chest. Rewards arrive in the treasure update.'
    : at(state.up) ? 'Stairs up: choose Ascend to return to the previous floor.'
    : at(state.down) ? 'Stairs down: choose Descend to explore deeper.' : '';
  syncControls();
}
async function request(payload = {}) {
  if (pending) return;
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
  if (!event.repeat && state) request({ direction });
});
for (const action of ['ascend', 'descend']) {
  adventure.querySelector(`#adventure-${action}`).addEventListener('click', () => request({ action }));
}
document.addEventListener('adventure:pet', event => { pet = event.detail; if (adventure.open) renderMap(); });
document.addEventListener('adventure:reset', () => {
  generation++; pending = false; state = null; pet = null;
  if (adventure.open) adventure.close();
  clearMap();
});
