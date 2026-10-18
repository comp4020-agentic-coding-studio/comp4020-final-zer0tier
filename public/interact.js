// Playing with the pet: pat its head, tickle its belly, stroke its cheek, or
// shake its paw. Reactions are only for fun: nothing is sent to the server,
// saved, or shown to other players. Click or tap the pet where you want to
// touch it, or use the buttons, which work from the keyboard too.
const $ = (id) => document.getElementById(id);
const touch = $('pet-touch');
const avatar = $('pet-avatar');
const said = $('pet-reaction');
let current = null; // the signed-in pet, from app.js
let timer;
let turn = 0; // cycles through each touch's lines

// What each touch is, the effect it plays, and what the pet does. `{name}` is
// the pet's player ID; a busy pet still reacts, distractedly.
const TOUCHES = {
  pat: {
    label: 'Pat head', effect: 'hearts',
    lines: ['{name} leans into your hand and closes its eyes.', '{name} wiggles happily under the head pats.', '{name} pushes its head up for more pats.'],
  },
  tickle: {
    label: 'Tickle belly', effect: 'giggles',
    lines: ['{name} giggles and squirms!', '{name} rolls over, laughing.', '{name} wriggles away, then comes back for more.'],
  },
  stroke: {
    label: 'Stroke cheek', effect: 'sparkles',
    lines: ['{name} nuzzles into your palm.', '{name} purrs softly.', '{name} blinks slowly at you.'],
  },
  paw: {
    label: 'Shake paw', effect: 'stars',
    lines: ['{name} offers a paw and shakes your hand.', '{name} high-fives you!', '{name} holds your hand a little longer than needed.'],
  },
};
const BUSY = {
  studying: '{name} gives a quick happy wiggle, then gets back to studying.',
  working: '{name} smiles at you between tasks, then gets back to work.',
};
const EFFECTS = { hearts: '♥', giggles: 'ha', sparkles: '✦', stars: '★' };

// Where on the 120 × 110 drawing a touch lands. Every shape shares the same
// face: eyes around y 53, belly centred at (60, 76), feet at the bottom.
function zoneAt(x, y) {
  if (y >= 88 || (y >= 76 && (x < 30 || x > 90))) return 'paw';
  if (y >= 44 && y < 70 && (x < 40 || x > 80)) return 'stroke';
  if (y >= 62) return 'tickle';
  return 'pat';
}

function react(kind) {
  if (!current) return;
  const touchKind = TOUCHES[kind];
  const name = current.id;
  const line = (BUSY[current.activity] ?? touchKind.lines[turn++ % touchKind.lines.length]).replaceAll('{name}', name);
  // A fresh announcement each time, even for the same line twice in a row.
  said.textContent = '';
  said.textContent = line;
  clearTimeout(timer);
  touch.dataset.reaction = '';
  void touch.offsetWidth; // restart the animation on quick repeat touches
  touch.dataset.reaction = kind;
  const effect = document.createElement('span');
  effect.className = `pet-effect pet-effect-${touchKind.effect}`;
  effect.setAttribute('aria-hidden', 'true');
  effect.textContent = EFFECTS[touchKind.effect];
  touch.querySelector('.pet-effects').append(effect);
  setTimeout(() => effect.remove(), 1200);
  timer = setTimeout(() => { touch.dataset.reaction = ''; }, 900);
}

avatar.addEventListener('click', (event) => {
  const box = avatar.getBoundingClientRect();
  if (!box.width || !box.height) return react('pat');
  react(zoneAt((event.clientX - box.left) * 120 / box.width, (event.clientY - box.top) * 110 / box.height));
});
for (const button of document.querySelectorAll('[data-touch]')) {
  button.addEventListener('click', () => react(button.dataset.touch));
}
document.addEventListener('adventure:pet', ({ detail }) => {
  // A different pet signed in: forget the last reaction.
  if (current?.id !== detail.id) {
    said.textContent = '';
    turn = 0;
  }
  current = detail;
});
document.addEventListener('adventure:reset', () => {
  current = null;
  clearTimeout(timer);
  said.textContent = '';
  touch.dataset.reaction = '';
  touch.querySelector('.pet-effects').replaceChildren();
});
