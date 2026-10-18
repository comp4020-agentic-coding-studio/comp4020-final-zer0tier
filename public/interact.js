// Playing with pets: pat a head, tickle a belly, stroke a cheek, or shake a
// paw. Click or tap the pet where you want to touch it, or use the buttons,
// which work from the keyboard too.
//
// Your own pet reacts straight away, and nothing is sent to the server, saved,
// or shown to other players. Playing with a pet you're visiting is a visit:
// the server saves it and tells every window, so that pet reacts wherever it's
// shown, its owner's dashboard included, once the broadcast arrives.
const $ = (id) => document.getElementById(id);
const avatar = $('pet-avatar');
const said = $('pet-reaction');
const visitAvatar = $('visit-avatar');
const visitSaid = $('visit-reaction');
const visitError = $('visit-touch-error');
let current = null; // the signed-in pet, from app.js
let visited = null; // the pet open in the visit panel, from app.js
let touching = false; // a touch on the visited pet is on its way, or just landed
let turn = 0; // cycles through each touch's lines
let visitors = new Map(); // each visitor's latest touch on the signed-in pet, by visitor
let visitorLoads = 0;
const VISITORS = 5; // as many as the server keeps for each pet
const TOUCH_GAP = 1000; // the server takes one touch a second from each visitor

// What each touch is, the effect it plays, and what the pet does. `{name}` is
// the pet's player ID; a busy pet still reacts, distractedly.
const TOUCHES = {
  pat: {
    does: 'pats', did: 'patted', part: 'head', effect: 'hearts',
    lines: ['{name} leans into your hand and closes its eyes.', '{name} wiggles happily under the head pats.', '{name} pushes its head up for more pats.'],
  },
  tickle: {
    does: 'tickles', did: 'tickled', part: 'belly', effect: 'giggles',
    lines: ['{name} giggles and squirms!', '{name} rolls over, laughing.', '{name} wriggles away, then comes back for more.'],
  },
  stroke: {
    does: 'strokes', did: 'stroked', part: 'cheek', effect: 'sparkles',
    lines: ['{name} nuzzles into your palm.', '{name} purrs softly.', '{name} blinks slowly at you.'],
  },
  paw: {
    does: 'shakes', did: 'shook', part: 'paw', effect: 'stars',
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

function touchedZone(svg, event) {
  const box = svg.getBoundingClientRect();
  if (!box.width || !box.height) return 'pat';
  return zoneAt((event.clientX - box.left) * 120 / box.width, (event.clientY - box.top) * 110 / box.height);
}

// A pet's avatar wrapper, which re-renders never replace: plays a touch's
// short animation there and floats its effect up.
function stage(wrapper) {
  let timer;
  return {
    play(kind) {
      clearTimeout(timer);
      wrapper.dataset.reaction = '';
      void wrapper.offsetWidth; // restart the animation on quick repeat touches
      wrapper.dataset.reaction = kind;
      const effect = document.createElement('span');
      effect.className = `pet-effect pet-effect-${TOUCHES[kind].effect}`;
      effect.setAttribute('aria-hidden', 'true');
      effect.textContent = EFFECTS[TOUCHES[kind].effect];
      wrapper.querySelector('.pet-effects').append(effect);
      setTimeout(() => effect.remove(), 1200);
      timer = setTimeout(() => { wrapper.dataset.reaction = ''; }, 900);
    },
    clear() {
      clearTimeout(timer);
      wrapper.dataset.reaction = '';
      wrapper.querySelector('.pet-effects').replaceChildren();
    },
  };
}
const mine = stage($('pet-touch'));
const theirs = stage($('visit-touch'));

// A fresh announcement each time, even for the same line twice in a row.
function say(line, where = said) {
  where.textContent = '';
  where.textContent = line;
}

// How `pet` reacts to your touch.
const reaction = (pet, kind) =>
  (BUSY[pet.activity] ?? TOUCHES[kind].lines[turn++ % TOUCHES[kind].lines.length]).replaceAll('{name}', pet.id);

function react(kind) {
  if (!current) return;
  say(reaction(current, kind));
  mine.play(kind);
}

avatar.addEventListener('click', (event) => react(touchedZone(avatar, event)));
for (const button of document.querySelectorAll('[data-touch]')) {
  button.addEventListener('click', () => react(button.dataset.touch));
}

// Playing with the visited pet, as your own pet. It reacts when the server's
// pet:touched broadcast arrives, not before.
async function touchVisited(kind) {
  if (!current || !visited || touching) return;
  const owner = current.id;
  const target = visited.id;
  const still = () => current?.id === owner && visited?.id === target;
  touching = true;
  visitError.textContent = '';
  let gap = 0;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/touch/${encodeURIComponent(target)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }),
    });
    // Touches in the next second would be refused, and the reaction is still playing.
    if (res.ok) gap = TOUCH_GAP;
    else if (!still()) return;
    else if (res.status === 401 || res.status === 403) visitError.textContent = 'Your session has changed. Reload the page and sign in again.';
    else visitError.textContent = (await res.json()).error ?? `Couldn't reach ${target}. Try again.`;
  } catch {
    if (still()) visitError.textContent = `Couldn't reach ${target}. Try again.`;
  } finally {
    setTimeout(() => { touching = false; }, gap);
  }
}

visitAvatar.addEventListener('click', (event) => touchVisited(touchedZone(visitAvatar, event)));
for (const button of document.querySelectorAll('[data-visit-touch]')) {
  button.addEventListener('click', () => touchVisited(button.dataset.visitTouch));
}

// Keeps a visitor's newest touch, as the server does.
function sawVisitor(touch) {
  if ((visitors.get(touch.visitor)?.id ?? 0) < touch.id) visitors.set(touch.visitor, touch);
}

// "Recent visitors": who played with the signed-in pet lately, newest first.
function renderVisitors() {
  const list = [...visitors.values()].sort((a, b) => b.id - a.id).slice(0, VISITORS);
  visitors = new Map(list.map((touch) => [touch.visitor, touch]));
  $('visitors').replaceChildren(...list.map((touch) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    const who = document.createElement('b');
    who.textContent = touch.visitor;
    const { did, part } = TOUCHES[touch.kind] ?? { did: 'played with', part: '' };
    text.append(who, ` ${did} your pet${part ? `'s ${part}` : ''}.`);
    const time = document.createElement('time');
    const at = new Date(touch.at);
    time.dateTime = touch.at;
    time.textContent = at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
    li.append(text, time);
    return li;
  }));
  $('visitors-empty').hidden = list.length > 0;
}

async function loadVisitors() {
  if (!current) return;
  const owner = current.id;
  const request = ++visitorLoads;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/touches`);
    if (!res.ok) return;
    const list = await res.json();
    if (request !== visitorLoads || current?.id !== owner) return;
    // Merge, don't replace: a touch broadcast while this loaded is newer.
    for (const touch of list) sawVisitor(touch);
    renderVisitors();
  } catch {
    // Broadcasts still fill the list, and reconnecting loads it again.
  }
}

document.addEventListener('adventure:pet', ({ detail }) => {
  // A different pet signed in: forget the last reaction and its visitors.
  const switched = current?.id !== detail.id;
  if (switched) {
    said.textContent = '';
    turn = 0;
    visitors = new Map();
    renderVisitors();
  }
  current = detail;
  if (switched) loadVisitors();
});
document.addEventListener('realtime:resync', loadVisitors);

document.addEventListener('visit:pet', ({ detail }) => {
  if (visited?.id !== detail?.id) {
    visitSaid.textContent = '';
    visitError.textContent = '';
    theirs.clear();
  }
  visited = detail;
  if (!detail) return;
  $('visit-play-help').textContent = `Tap or click ${detail.id} where you'd like to touch it, or choose:`;
  $('visit-play').setAttribute('aria-label', `Play with ${detail.id}`);
});

document.addEventListener('pet:touched', ({ detail: touch }) => {
  const kind = TOUCHES[touch.kind];
  if (!kind) return; // a touch this page doesn't know yet
  if (current && touch.pet === current.id) {
    say(`${touch.visitor} ${kind.does} ${current.id}'s ${kind.part}.`);
    mine.play(touch.kind);
    sawVisitor(touch);
    renderVisitors();
  } else if (visited && touch.pet === visited.id) {
    say(touch.visitor === current?.id ? reaction(visited, touch.kind) : `${touch.visitor} ${kind.does} ${visited.id}'s ${kind.part}.`, visitSaid);
    theirs.play(touch.kind);
  }
});

document.addEventListener('adventure:reset', () => {
  current = null;
  visited = null;
  visitorLoads++;
  visitors = new Map();
  renderVisitors();
  said.textContent = '';
  visitSaid.textContent = '';
  visitError.textContent = '';
  mine.clear();
  theirs.clear();
});
