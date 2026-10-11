const adventure = document.createElement('dialog');
adventure.id = 'adventure-dialog';
adventure.setAttribute('aria-labelledby', 'adventure-title');
adventure.innerHTML = `
  <header><div><p class="section-label">ADVENTURE · EXPLORATION</p><h2 id="adventure-title">Woodland clearing</h2></div>
    <button type="button" id="adventure-close" class="chip-btn" autofocus>Leave</button></header>
  <p class="help">W/A/S/D or arrow keys to move one block. Your position is saved.</p>
  <div id="adventure-grid" role="img" aria-label="Woodland map" tabindex="0"></div>
  <p id="adventure-status" role="status">Opening the clearing…</p>
  <div class="adventure-controls" aria-label="Movement controls">
    <button type="button" data-direction="w" aria-label="Move up">↑</button>
    <button type="button" data-direction="a" aria-label="Move left">←</button>
    <button type="button" data-direction="s" aria-label="Move down">↓</button>
    <button type="button" data-direction="d" aria-label="Move right">→</button>
  </div>
  <p class="help">Explore the paths. Monsters, treasures, and deeper floors are coming later.</p>`;
document.body.append(adventure);
const grid = adventure.querySelector('#adventure-grid');
const status = adventure.querySelector('#adventure-status');
let pending = false, generation = 0, state = null, pet = null;
function renderMap() {
  if (!state) return;
  grid.replaceChildren();
  state.tiles.forEach((row, y) => [...row].forEach((tile, x) => {
    const cell = document.createElement('span');
    cell.className = tile === '#' ? 'adventure-tree' : 'adventure-path';
    if (x === state.x && y === state.y) {
      cell.classList.add('adventure-player');
      const shape = ['blob', 'cat', 'dog', 'bird', 'dragon'].includes(pet?.appearance) ? pet.appearance : 'blob';
      cell.innerHTML = `<svg class="pet-avatar" viewBox="0 0 120 110" aria-hidden="true"><use href="#pet-${shape}" /></svg>`;
      if (pet?.color) cell.style.setProperty('--pet-color', pet.color);
    }
    grid.append(cell);
  }));
  grid.setAttribute('aria-label', `16 by 16 woodland map. Your pet is at column ${state.x + 1}, row ${state.y + 1}. Trees block movement.`);
  status.textContent = `Column ${state.x + 1} · Row ${state.y + 1}`;
}
async function request(direction) {
  if (pending) return;
  const version = generation;
  pending = true;
  grid.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/adventure', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(direction ? { direction } : {}),
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
    }
  }
}
document.getElementById('adventure-open').addEventListener('click', () => {
  if (adventure.open) return;
  state = null;
  grid.replaceChildren();
  status.textContent = 'Opening the clearing…';
  adventure.showModal();
  request();
});
adventure.querySelector('#adventure-close').addEventListener('click', () => adventure.close());
adventure.addEventListener('close', () => { generation++; pending = false; state = null; });
adventure.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  if (state) request(button.dataset.direction);
  else request();
}));
adventure.addEventListener('keydown', event => {
  if (!adventure.open || event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  const direction = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' }[key] || key;
  if (!['w', 'a', 's', 'd'].includes(direction)) return;
  event.preventDefault();
  if (!event.repeat && state) request(direction);
});
document.addEventListener('adventure:pet', event => { pet = event.detail; if (adventure.open) renderMap(); });
document.addEventListener('adventure:reset', () => {
  generation++; pending = false; state = null; pet = null;
  if (adventure.open) adventure.close();
});
