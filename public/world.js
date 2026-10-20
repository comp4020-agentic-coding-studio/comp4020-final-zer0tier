// The home and town are a presentation layer. Keep the original gameplay
// controls (and their listeners) alive; app.js owns every saved pet update.
const worldById = (id) => document.getElementById(id);
const worldDashboard = worldById('dashboard');
const original = {
  hero: worldDashboard.querySelector('.pet-hero'),
  play: worldDashboard.querySelector('.play'),
  stats: worldDashboard.querySelector('.stats'),
  school: worldDashboard.querySelector('.school'),
  study: worldById('study-heading').closest('section'),
  work: worldById('work-heading').closest('section'),
  arena: worldById('arena-heading').closest('section'),
  supplies: worldById('care-heading').closest('section'),
  adventure: worldById('adventure-heading').closest('section'),
};
const worldShell = document.createElement('div');
worldShell.id = 'world-shell';
worldShell.dataset.scene = 'home';
worldShell.innerHTML = `
  <header class="world-heading">
    <div class="world-title"><p class="world-eyebrow" id="world-eyebrow">A PLACE TO CALL YOUR OWN</p>
      <h1 id="world-title" tabindex="-1">Home, sweet home.</h1>
      <p id="world-description">A warm fire, a familiar face, and a little time together.</p></div>
    <div class="world-heading-actions"><button type="button" id="world-map" class="world-button">Town map <span aria-hidden="true">↗</span></button></div>
  </header>
  <div class="world-layout">
    <div class="world-main">
      <div id="world-stage" class="world-stage" data-scene="home" tabindex="0" role="group" aria-label="Your home. Move with W A S D or arrow keys. Press Space near an object to interact." aria-describedby="home-controls-tip">
        <div id="home-scene">
          <img class="scene-art" src="/scenes/home.svg" alt="A cozy wooden room with a television, couch, fireplace, pet house, food bowl, bathtub, storage chest, wall clock, and a door leading into town." draggable="false" />
          <button type="button" class="home-hotspot" data-home-action="tv" style="--x:22.8%;--y:25.4%;--w:15%;--h:21%" aria-label="Watch the television: town journal"><span class="hotspot-label">Town TV</span></button>
          <button type="button" class="home-hotspot" data-home-action="couch" style="--x:22.9%;--y:50%;--w:19%;--h:18%" aria-label="Sit on the couch with your pet"><span class="hotspot-label">Take a breather</span></button>
          <button type="button" class="home-hotspot" data-home-action="fire" style="--x:77.6%;--y:25%;--w:17%;--h:22%" aria-label="Warm up by the fireplace"><span class="hotspot-label">Cozy fireplace</span></button>
          <button type="button" class="home-hotspot" data-home-action="bed" style="--x:78.1%;--y:49%;--w:17%;--h:20%" aria-label="Pet's little home: customize appearance"><span class="hotspot-label">Your pet's nook</span></button>
          <button type="button" class="home-hotspot" data-home-action="feed" style="--x:67.7%;--y:64.1%;--w:10%;--h:10%" aria-label="Food bowl: feed your pet"><span class="hotspot-label">Food bowl</span></button>
          <button type="button" class="home-hotspot" data-home-action="clean" style="--x:85.4%;--y:75%;--w:16%;--h:16%" aria-label="Bath: clean your pet"><span class="hotspot-label">Bath time</span></button>
          <button type="button" class="home-hotspot" data-home-action="chest" style="--x:38.1%;--y:75%;--w:9%;--h:9%" aria-label="Storage chest: open your backpack"><span class="hotspot-label">Backpack</span></button>
          <button type="button" class="home-hotspot" data-home-action="menu" style="--x:37%;--y:14.1%;--w:7%;--h:10%" aria-label="Wall clock: game menu and sign out"><span class="hotspot-label">Game menu</span></button>
          <button type="button" class="home-hotspot" data-home-action="pet" data-place="pet" style="--x:50%;--y:55%;--w:13%;--h:16%" aria-label="Spend time with your pet: care and details"><span class="hotspot-label">Your companion</span></button>
          <button type="button" id="home-door" class="home-hotspot" data-home-action="door" style="--x:50%;--y:91%;--w:15%;--h:14%" aria-label="Leave home for the town map"><span class="hotspot-label">Go to town ↗</span></button>
          <span class="home-pet-label" id="home-pet-label">Your companion</span>
        </div>
        <div id="town-scene" hidden>
          <img class="scene-art" src="/scenes/town.svg" alt="A green village connected by winding paths, with shops, a school, a job board, an arena, your home, and a woodland adventure trail." draggable="false" />
          <button type="button" class="town-stop" data-place="work" style="--x:26%;--y:31%"><span class="stop-name">Part-time Jobs</span><span class="stop-detail">Earn a little extra</span></button>
          <button type="button" class="town-stop" data-place="school" style="--x:50%;--y:35%"><span class="stop-name">School</span><span class="stop-detail">Learn &amp; grow</span></button>
          <span id="town-adventure-slot"></span>
          <button type="button" class="town-stop" data-place="shop" style="--x:21.4%;--y:60%"><span class="stop-name">Shops</span><span class="stop-detail">Stock up on supplies</span></button>
          <button type="button" class="town-stop" data-place="arena" style="--x:78.6%;--y:68%"><span class="stop-name">Arena</span><span class="stop-detail">Meet, visit &amp; battle</span></button>
          <button type="button" id="town-home" class="town-stop" style="--x:50%;--y:87%"><span class="stop-name">Sweet Home</span><span class="stop-detail">Your cozy corner</span></button>
        </div>
        <div id="world-avatar" class="world-avatar" aria-hidden="true" data-facing="down">
          <svg viewBox="0 0 32 44" shape-rendering="crispEdges" aria-hidden="true"><ellipse cx="16" cy="41" rx="11" ry="3" fill="#353b2b" opacity=".22"/>
            <path fill="#493e38" d="M9 32h6v10H8v-4h1m8-6h6v6h1v4h-7"/>
            <path fill="#a7573f" d="M7 21h18v13H7z"/><path fill="#d78455" d="M10 21h12v12H10z"/><path fill="#efc58a" d="M5 24h4v9H5zm18 0h4v9h-4zM10 8h13v14H10zM8 11h2v7H8z"/>
            <path fill="#60452f" d="M7 5h18v8h-4V9H11v5H7z"/><path fill="#405b40" d="M7 3h17v5H7zM4 7h23v4H4z"/><path fill="#83956a" d="M9 3h13v3H9z"/>
            <g class="walker-face" fill="#3f382d"><path d="M12 14h2v3h-2zm7 0h2v3h-2zM15 19h4v1h-4z"/></g>
            <path fill="#e5ae6e" d="M13 23h6v2h-6z"/><path fill="#f8d89a" d="M12 27h8v2h-8z"/>
          </svg>
        </div>
      </div>
      <p id="home-controls-tip"><span><kbd>W/A/S/D</kbd> move</span><span><kbd>Space bar</kbd> interact</span></p>
      <p id="home-feedback" role="status" aria-live="polite" hidden></p>
      <div class="scene-caption"><p id="world-message" role="status">Welcome home. Your pet is happy to see you.</p><button type="button" id="world-interact" class="world-button" disabled>Move closer to interact</button></div>
      <div class="world-controls">
        <p class="movement-help" id="world-movement-help"><kbd>W A S D</kbd> or <kbd>↑ ← ↓ →</kbd> to walk · <kbd>Space</kbd> to interact<br /><span>Click the floor to walk. Select any object or building to interact.</span></p>
        <div class="movement-pad" role="group" aria-label="Move your character">
          <button type="button" data-world-direction="up" aria-label="Walk up">↑</button><button type="button" data-world-direction="left" aria-label="Walk left">←</button><button type="button" data-world-direction="down" aria-label="Walk down">↓</button><button type="button" data-world-direction="right" aria-label="Walk right">→</button>
        </div>
      </div>
    </div>
    <aside class="world-companion" aria-label="Your companion and care">
      <p class="companion-heading world-eyebrow">YOUR LITTLE COMPANION</p>
      <div id="world-pet-summary"></div>
      <p id="home-interaction-label">Choose an interaction</p>
      <div class="home-care" aria-label="Care for your pet at home"><button type="button" id="home-feed" class="world-button" disabled><svg class="icon" aria-hidden="true"><use href="#i-food" /></svg><span>Feed <small id="home-feed-count">0 left</small></span></button><button type="button" id="home-clean" class="world-button" disabled><svg class="icon" aria-hidden="true"><use href="#i-soap" /></svg><span>Clean <small id="home-clean-count">0 left</small></span></button></div>
      <p id="home-care-hint" class="world-care-hint help"></p><p id="home-care-error" class="error" role="alert"></p>
      <div id="world-play" class="home-play"></div>
      <p id="town-care-hint" class="help" hidden>Head home to feed, clean, and spend time with your pet.</p>
      <div class="companion-footer"><button type="button" class="world-button" data-place="backpack">Backpack</button><button type="button" class="world-button" data-place="appearance">Appearance</button></div>
    </aside>
  </div>
  <nav class="world-nav" aria-label="Explore VirtuePets"><button type="button" id="world-home" aria-current="page">Sweet Home</button><button type="button" id="world-town">Town map</button><button type="button" data-place="backpack">Backpack</button><button type="button" id="world-journal" data-place="journal">Journal</button></nav>`;
worldDashboard.append(worldShell);

const worldStage = worldById('world-stage');
const worldAvatar = worldById('world-avatar');
const homePet = worldById('pet-touch');
homePet.classList.add('home-pet');
worldById('home-scene').append(homePet);
worldById('world-pet-summary').append(original.hero, original.stats, worldById('busy'));
worldById('world-play').append(original.play);

const worldDialog = document.createElement('dialog');
worldDialog.id = 'world-dialog';
worldDialog.className = 'place-dialog';
worldDialog.setAttribute('aria-labelledby', 'world-dialog-title');
worldDialog.innerHTML = `<header class="place-heading"><div><p class="world-eyebrow" id="world-place-eyebrow">AROUND TOWN</p><h2 id="world-dialog-title"></h2></div><button type="button" class="world-button" id="world-dialog-close" aria-label="Close window">Close <span aria-hidden="true">×</span></button></header><p id="world-place-intro" class="place-intro"></p><div class="place-body"></div>`;
document.body.append(worldDialog);
const worldPanels = {};
for (const name of ['school', 'work', 'shop', 'arena', 'journal', 'appearance', 'pet', 'menu']) {
  const panel = document.createElement('section');
  panel.id = `world-panel-${name}`;
  panel.className = 'world-panel';
  panel.hidden = true;
  worldDialog.querySelector('.place-body').append(panel);
  worldPanels[name] = panel;
}
worldPanels.school.append(original.school, original.study);
worldPanels.work.append(original.work);
worldPanels.shop.append(original.supplies, original.adventure);
worldPanels.arena.append(original.arena);
worldPanels.appearance.append(worldById('appearance-settings'));
worldPanels.pet.classList.add('world-companion');
worldPanels.menu.innerHTML = '<p class="help">Take your time. Your pet and progress are saved.</p><p><a href="/readme/" target="_blank" rel="noopener">How to play</a></p><button type="button" class="world-button" data-place="backpack">Backpack</button> <button type="button" class="world-button" data-place="journal">Town journal</button>';
const homePanelMoves = ['#world-pet-summary', '#home-interaction-label', '.home-care', '#home-care-hint', '#home-care-error', '#world-play', '.companion-footer'].map(selector => {
  const node = worldShell.querySelector(selector);
  const anchor = document.createComment('town companion position');
  node.before(anchor);
  return { node, anchor };
});
const signoutAnchor = document.createComment('sign out position');
worldById('signout').before(signoutAnchor);
for (const node of [worldById('visitors-heading'), worldById('visitors'), worldById('visitors-empty'), worldById('theft-notifications'), worldById('fight-log').previousElementSibling, worldById('fight-log'), worldById('feed-heading'), worldById('feed')]) worldPanels.journal.append(node);
const journalEmpty = document.createElement('p');
journalEmpty.className = 'help';
journalEmpty.id = 'world-reports-empty';
journalEmpty.textContent = 'No theft reports. A peaceful day in the neighbourhood.';
worldById('theft-notifications').before(journalEmpty);

const adventureEntrance = worldById('adventure-open');
adventureEntrance.className = 'town-stop';
adventureEntrance.style.cssText = '--x:78.3%;--y:31%';
adventureEntrance.innerHTML = '<span class="stop-name">Adventure</span><span class="stop-detail">Into the woodland</span>';
worldById('town-adventure-slot').replaceWith(adventureEntrance);
worldById('adventure-hint').classList.add('world-adventure-hint');
worldById('town-scene').append(worldById('adventure-hint'));
worldById('adventure-heading').textContent = 'Abilities & equipment';
original.adventure.querySelector('.help').textContent = 'Your woodland discoveries travel with you. Equipped coins work in Adventure, Arena, and revenge.';
original.adventure.querySelector('.treasure-inventory').open = true;
original.adventure.querySelector('.treasure-inventory > .help:nth-of-type(2)').textContent = 'Chest items join your supplies. Equip a coin to use its effect in your next battle.';

const worldPlaces = {
  shop: ['Village shops', 'A few essentials for a very good day. Buy food, soap, and hourglasses, or collect your free daily supplies.'],
  backpack: ['Your backpack', 'Your supplies, learned abilities, and lucky finds. Visit the shops in town when you need to restock.'],
  school: ['A little learning', 'Every lesson brings your pet a little further. Choose a course and watch them grow.'],
  work: ['Part-time jobs', 'Find a shift that suits your pet. Build skills, earn money, and work your way up.'],
  arena: ['The town arena', 'Meet your neighbours, visit their pets, or challenge someone to a friendly rivalry.'],
  journal: ['Your town journal', 'Recent visitors, battles, town news, and any theft reports that need your attention.'],
  appearance: ["Your pet's little nook", 'Make your companion feel like yours. Choose a shape and colour, then save your appearance.'],
  pet: ['Your companion', 'A little affection goes a long way. Play, care, or see how your pet is doing.'],
  menu: ['Make yourself at home', ''],
};
let worldScene = 'home';
let worldReturnFocus = null;
let worldFrame = 0;
let worldLastFrame = 0;
let worldKeys = new Set();
let worldPath = [];
let worldPosition = { x: 480, y: 475 };
let worldView = { width: 960, height: 640, viewportWidth: 960, viewportHeight: 640 };
let worldCameraTransform = '';
let worldAvatarTransform = '';
let worldNearest = null;
let worldHighlighted = null;
let worldFeedbackTimer = 0;
let worldCarePending = null;
let worldWasVisible = false;
const worldInteractionButtons = [...original.play.querySelectorAll('[data-touch]'), worldById('home-feed'), worldById('home-clean')];
function worldSelectInteraction(kind) {
  let label = '';
  for (const button of worldInteractionButtons) {
    const selected = (button.dataset.touch || button.id.replace('home-', '')) === kind;
    button.toggleAttribute('data-selected', selected);
    if (selected) label = button.dataset.touch ? button.textContent : kind === 'feed' ? 'Feed' : 'Clean';
  }
  worldById('home-interaction-label').textContent = label ? `Last interaction: ${label}` : 'Choose an interaction';
}
for (const button of worldInteractionButtons) button.addEventListener('click', () => worldSelectInteraction(button.dataset.touch || button.id.replace('home-', '')));
new MutationObserver(() => {
  if (homePet.dataset.reaction) worldSelectInteraction(homePet.dataset.reaction);
}).observe(homePet, { attributes: true, attributeFilter: ['data-reaction'] });

function worldMessage(text, feedback = true) {
  worldById('world-message').textContent = text;
  if (feedback && worldScene === 'home' && !worldDashboard.hidden && text) {
    clearTimeout(worldFeedbackTimer);
    const message = worldById('home-feedback');
    if (worldDialog.open && worldDialog.dataset.place === 'pet') {
      message.hidden = true;
      worldById('pet-reaction').textContent = text;
      return;
    }
    message.textContent = text;
    message.hidden = false;
    worldFeedbackTimer = setTimeout(() => { message.hidden = true; }, 4500);
  }
}
function worldArrangeHome(atHome) {
  for (const { node, anchor } of homePanelMoves) {
    if (atHome) worldPanels.pet.append(node);
    else anchor.after(node);
  }
  for (const selector of ['.world-heading', '.world-layout > .world-companion', '.scene-caption', '.world-controls', '.world-nav']) worldShell.querySelector(selector).hidden = atHome;
  worldById('home-controls-tip').hidden = !atHome;
  worldById('home-pet-label').hidden = true;
  for (const selector of ['.home-care', '.home-play', '#home-care-hint', '#home-interaction-label']) document.querySelector(selector).hidden = !atHome;
  if (atHome && !worldDashboard.hidden) worldPanels.menu.append(worldById('signout'));
  else signoutAnchor.after(worldById('signout'));
  document.body.classList.toggle('world-home', atHome && !worldDashboard.hidden);
  worldStage.setAttribute('aria-describedby', atHome ? 'home-controls-tip' : 'world-movement-help');
}
function worldCamera(point = worldPosition) {
  if (worldScene !== 'home' || worldDashboard.hidden) return;
  const { width, height, viewportWidth, viewportHeight } = worldView;
  const offsetX = Math.max(viewportWidth - width, Math.min(0, viewportWidth / 2 - point.x * width / 960));
  const offsetY = Math.max(viewportHeight - height, Math.min(0, viewportHeight / 2 - point.y * height / 640));
  const transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
  if (worldCameraTransform !== transform) {
    worldStage.style.transform = transform;
    worldCameraTransform = transform;
  }
}
// Measure only when the layout changes. Walking moves two composited layers,
// without laying out the room or invalidating inherited styles on its children.
function worldResize() {
  const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
  if (worldScene === 'home' && !worldDashboard.hidden) {
    const scale = Math.max(viewportWidth / 960, viewportHeight / 640);
    worldView = { width: 960 * scale, height: 640 * scale, viewportWidth, viewportHeight };
    worldStage.style.setProperty('--scene-width', `${worldView.width}px`);
    worldStage.style.setProperty('--scene-height', `${worldView.height}px`);
  } else {
    worldStage.style.removeProperty('--scene-width');
    worldStage.style.removeProperty('--scene-height');
    worldStage.style.removeProperty('transform');
    worldCameraTransform = '';
    const { width, height } = worldStage.getBoundingClientRect();
    worldView = { width: width || 960, height: height || 640, viewportWidth, viewportHeight };
  }
}
window.addEventListener('resize', () => { worldResize(); worldDraw(); });
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(([entry]) => {
  if (worldScene !== 'town' || worldDashboard.hidden) return;
  const { width, height } = entry.contentRect;
  if (!width || !height || (width === worldView.width && height === worldView.height)) return;
  worldView = { ...worldView, width, height };
  worldDraw();
}).observe(worldStage);
worldStage.addEventListener('focusin', event => {
  const object = event.target.closest('.home-hotspot');
  // Keyboard users can reach furniture outside the camera. Pointer focus
  // must not move a hotspot away between pressing and releasing it.
  if (object?.matches(':focus-visible')) worldCamera({ x: parseFloat(object.style.getPropertyValue('--x')) * 9.6, y: parseFloat(object.style.getPropertyValue('--y')) * 6.4 });
});
function worldStop() {
  worldKeys.clear();
  worldPath = [];
  cancelAnimationFrame(worldFrame);
  worldFrame = 0;
  worldLastFrame = 0;
  worldSetWalking(false);
}
function worldSetWalking(walking) {
  const value = String(walking);
  if (worldAvatar.dataset.walking !== value) worldAvatar.dataset.walking = value;
}
function worldModalOpen() { return Boolean(document.querySelector('dialog[open]')); }
function worldOpenPlace(name, trigger) {
  if (worldDashboard.hidden || !worldPlaces[name]) return;
  worldStop();
  const source = trigger ?? document.activeElement;
  // Switching panels must not return focus to a now-closed modal.
  if (!worldDialog.contains(source)) worldReturnFocus = source;
  const panelName = name === 'backpack' ? 'shop' : name;
  for (const [key, panel] of Object.entries(worldPanels)) panel.hidden = key !== panelName;
  worldDialog.dataset.place = name;
  worldById('world-dialog-title').textContent = worldPlaces[name][0];
  worldById('world-place-intro').textContent = worldPlaces[name][1];
  worldById('world-place-eyebrow').textContent = ['pet', 'menu'].includes(name) ? 'SWEET HOME' : ['backpack', 'appearance'].includes(name) ? 'YOURS TO KEEP' : 'AROUND TOWN';
  if (name === 'pet') worldById('home-feedback').hidden = true;
  if (!worldDialog.open) worldDialog.showModal();
  worldById('world-dialog-close').focus({ preventScroll: true });
}
worldById('world-dialog-close').addEventListener('click', () => worldDialog.close());
worldDialog.addEventListener('close', () => {
  if (worldDialog.open || worldDashboard.hidden || worldModalOpen()) return;
  const back = worldScene === 'home' ? worldStage : worldReturnFocus?.isConnected && !worldReturnFocus.closest('[hidden]') ? worldReturnFocus : worldStage;
  back.focus({ preventScroll: true });
  worldCamera();
});
worldDialog.addEventListener('click', (event) => {
  const box = worldDialog.getBoundingClientRect();
  if (event.target === worldDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) worldDialog.close();
});
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-place]');
  if (button && (worldShell.contains(button) || worldDialog.contains(button))) worldOpenPlace(button.dataset.place, button);
});
homePet.addEventListener('click', () => worldOpenPlace('pet', homePet));

function worldChangeScene(scene, focus = true) {
  worldStop();
  if (worldDialog.open) worldDialog.close();
  worldScene = scene;
  worldStage.dataset.scene = scene;
  worldShell.dataset.scene = scene;
  worldById('home-scene').hidden = scene !== 'home';
  worldById('town-scene').hidden = scene !== 'town';
  const atHome = scene === 'home';
  clearTimeout(worldFeedbackTimer);
  worldById('home-feedback').hidden = true;
  worldArrangeHome(atHome);
  worldPosition = atHome ? { x: 480, y: 475 } : { x: 480, y: 585 };
  worldById('world-title').textContent = atHome ? 'Home, sweet home.' : 'A little town. A lot to discover.';
  worldById('world-eyebrow').textContent = atHome ? 'A PLACE TO CALL YOUR OWN' : 'WELCOME TO THE NEIGHBOURHOOD';
  worldById('world-description').textContent = atHome ? 'A warm fire, a familiar face, and a little time together.' : 'Follow a path. Meet a neighbour. Make a day of it.';
  worldById('world-map').textContent = atHome ? 'Town map ↗' : 'Back home ↙';
  worldById('world-home').toggleAttribute('aria-current', atHome);
  worldById('world-town').toggleAttribute('aria-current', !atHome);
  (atHome ? worldById('world-home') : worldById('world-town')).setAttribute('aria-current', 'page');
  worldById('town-care-hint').hidden = atHome;
  worldStage.setAttribute('aria-label', `${atHome ? 'Your home' : 'Town map'}. Move with W A S D or arrow keys. Press Space near an object to interact.`);
  worldMessage(atHome ? '' : 'The day is yours. Select a building, or walk over and press Space.', false);
  worldResize();
  worldDraw();
  if (focus && !worldDashboard.hidden) worldStage.focus({ preventScroll: true });
}
worldById('home-door').addEventListener('click', () => worldChangeScene('town'));
worldById('town-home').addEventListener('click', () => worldChangeScene('home'));
worldById('world-home').addEventListener('click', () => worldChangeScene('home'));
worldById('world-town').addEventListener('click', () => worldChangeScene('town'));
worldById('world-map').addEventListener('click', () => worldChangeScene(worldScene === 'home' ? 'town' : 'home'));

function worldCare(kind) {
  const source = worldById('items').querySelector(`[data-item="${kind}"] .chip-use`);
  if (!source || source.disabled) {
    const full = Number(worldById(`meter-${kind === 'food' ? 'stamina' : 'hygiene'}`).getAttribute('aria-valuenow')) >= 100;
    worldMessage(full ? kind === 'food' ? 'Your pet is already full of energy.' : 'Your pet is already squeaky clean.' : worldById('home-care-hint').textContent || 'Visit the shops when supplies run low.');
    return;
  }
  worldCarePending = { kind, count: Number(source.closest('[data-item]').querySelector('.item-count').textContent) };
  worldSelectInteraction(kind === 'food' ? 'feed' : 'clean');
  source.click();
}
worldById('home-feed').addEventListener('click', () => worldCare('food'));
worldById('home-clean').addEventListener('click', () => worldCare('soap'));
for (const button of worldShell.querySelectorAll('[data-home-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.homeAction;
    if (action === 'tv') worldOpenPlace('journal', button);
    if (action === 'bed') worldOpenPlace('appearance', button);
    if (action === 'chest') worldOpenPlace('backpack', button);
    if (action === 'menu') worldOpenPlace('menu', button);
    if (action === 'feed') worldCare('food');
    if (action === 'clean') worldCare('soap');
    if (action === 'couch') {
      worldMessage('You settle into the cushions. Your pet snuggles up beside you.');
      original.play.querySelector('[data-touch="stroke"]').click();
    }
    if (action === 'fire') worldMessage('The fire crackles softly. There is no hurry here.');
    if (['feed', 'clean', 'couch', 'fire'].includes(action)) {
      worldStage.focus({ preventScroll: true });
      worldCamera();
    }
  });
}
function worldSyncCare() {
  const hints = [];
  for (const [kind, action, need] of [['food', 'feed', 'stamina'], ['soap', 'clean', 'hygiene']]) {
    const item = worldById('items').querySelector(`[data-item="${kind}"]`);
    const source = item?.querySelector('.chip-use');
    const count = Number(item?.querySelector('.item-count')?.textContent || 0);
    worldById(`home-${action}`).disabled = !source || source.disabled;
    worldById(`home-${action}-count`).textContent = `${count} left`;
    const full = Number(worldById(`meter-${need}`).getAttribute('aria-valuenow')) >= 100;
    worldById(`home-${action}`).title = full ? `${need === 'stamina' ? 'Stamina' : 'Hygiene'} is already full.` : !count ? `No ${kind} left. Collect free daily supplies in your backpack or visit the shops.` : '';
    if (!count) hints.push(`No ${kind} left`);
    if (worldCarePending?.kind === kind && count < worldCarePending.count) {
      worldCarePending = null;
      worldMessage(kind === 'food' ? 'Your pet enjoyed a tasty snack.' : 'All clean! Your pet feels fresh again.');
    }
  }
  worldById('home-care-hint').textContent = hints.length ? `${hints.join(' · ')}. Collect daily supplies in your backpack or restock in town.` : 'Feed when stamina is low. Clean when hygiene is low. Full meters mean a happy, cared-for pet.';
  worldById('home-care-error').textContent = worldById('care-error').textContent;
  worldById('home-pet-label').textContent = worldById('pet-name').textContent || 'Your companion';
  adventureEntrance.title = worldById('adventure-hint').textContent || 'Explore the woodland, solo or with a team.';
  worldDraw();
}
const worldCareObserver = new MutationObserver(worldSyncCare);
for (const id of ['items', 'care-error', 'pet-name', 'meter-stamina', 'meter-hygiene', 'adventure-hint']) worldCareObserver.observe(worldById(id), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-valuenow'] });
worldSyncCare();
new MutationObserver(() => {
  const error = worldById('care-error').textContent;
  if (error) { worldCarePending = null; worldMessage(error); }
}).observe(worldById('care-error'), { childList: true, characterData: true, subtree: true });
new MutationObserver(() => {
  const reaction = worldById('pet-reaction').textContent;
  if (reaction && !worldDialog.open) worldMessage(reaction);
}).observe(worldById('pet-reaction'), { childList: true, characterData: true, subtree: true });

const worldAlertsObserver = new MutationObserver(() => {
  const count = worldById('theft-list').children.length;
  const error = Boolean(worldById('theft-error').textContent);
  worldById('world-journal').textContent = count ? `Journal · ${count} ${count === 1 ? 'report' : 'reports'}` : error ? 'Journal · check reports' : 'Journal';
  worldById('world-journal').classList.toggle('has-alerts', count > 0 || error);
  journalEmpty.hidden = !worldById('theft-notifications').hidden;
});
worldAlertsObserver.observe(worldById('theft-notifications'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });

// Positions are cosmetic navigation only. They do not create a second copy of
// pet state or change stamina, money, timers, or any Adventure coordinates.
const worldObstacles = {
  home: [
    [148, 164, 140, 64], [91, 215, 43, 48], [124, 268, 182, 107], [681, 174, 140, 48], [684, 252, 126, 123], [610, 409, 87, 30], [735, 430, 145, 97], [855, 315, 35, 108], [101, 473, 44, 71], [330, 461, 72, 41],
    // The pet occupies the rug too. Player coordinates are their feet, so
    // leave enough space below the pet for the character's head and body.
    [428, 300, 104, 128],
  ],
  town: [[401, 421, 162, 135], [112, 237, 184, 126], [162, 51, 176, 126], [399, 71, 166, 145], [659, 291, 186, 134], [428, 287, 88, 60], [714, 97, 13, 80], [777, 97, 13, 80]],
};
function worldWalkable(x, y) {
  const bounds = worldScene === 'home' ? [76, 174, 884, 570] : [44, 30, 870, 614];
  if (x < bounds[0] || y < bounds[1] || x > bounds[2] || y > bounds[3]) return false;
  return !worldObstacles[worldScene].some(([left, top, width, height]) => x > left - 9 && x < left + width + 9 && y > top - 5 && y < top + height + 10);
}
function worldTargets() {
  if (worldScene === 'home') return [
    [220, 241, 'Watch town TV', '[data-home-action="tv"]'], [215, 390, 'Sit on the couch', '[data-home-action="couch"]'],
    [748, 237, 'Warm up by the fire', '[data-home-action="fire"]'], [748, 391, "Visit your pet's nook", '[data-home-action="bed"]'],
    [649, 458, 'Feed your pet', '[data-home-action="feed"]'], [808, 540, 'Clean your pet', '[data-home-action="clean"]'],
    [480, 375, 'Spend time with your pet', '[data-home-action="pet"]', 90], [480, 565, 'Leave for town', '#home-door'],
    [366, 525, 'Open your backpack', '[data-home-action="chest"]'], [350, 220, 'Game menu', '[data-home-action="menu"]'],
  ];
  return [[250, 194, 'Browse part-time jobs', '[data-place="work"]'], [482, 233, 'Visit school', '[data-place="school"]'], [751, 189, 'Enter the woodland', '#adventure-open'], [204, 379, 'Visit the shops', '[data-place="shop"]'], [752, 440, 'Enter the arena', '[data-place="arena"]'], [482, 571, 'Go home', '#town-home']];
}
function worldHighlight(destination) {
  const target = !worldDashboard.hidden && !worldModalOpen() && destination && !destination.disabled ? destination : null;
  // Only touch the highlight when the interaction target changes. Walking
  // within one object's range must not repaint its indicator every frame.
  if (target === worldHighlighted) return;
  worldHighlighted?.classList.remove('is-interactable');
  worldHighlighted = target;
  worldHighlighted?.classList.add('is-interactable');
}
function worldDraw() {
  const transform = `translate3d(${worldPosition.x * worldView.width / 960}px, ${worldPosition.y * worldView.height / 640}px, 0) translate(-50%, -100%)`;
  if (worldAvatarTransform !== transform) {
    worldAvatar.style.transform = transform;
    worldAvatarTransform = transform;
  }
  const choices = worldTargets().map((target) => ({ target, distance: Math.hypot(target[0] - worldPosition.x, target[1] - worldPosition.y) })).sort((a, b) => a.distance - b.distance);
  const nearest = choices[0];
  // The pet's wider body clearance must still allow interaction from every
  // side, including when a slower frame stops a few pixels before its edge.
  worldNearest = nearest?.distance <= (nearest?.target[4] ?? 82) ? nearest.target : null;
  const control = worldById('world-interact');
  const destination = worldNearest && worldShell.querySelector(worldNearest[3]);
  const disabled = !destination || destination.disabled;
  const label = worldNearest ? `${worldNearest[2]} · Space` : 'Move closer to interact';
  if (control.disabled !== disabled) control.disabled = disabled;
  if (control.textContent !== label) control.textContent = label;
  worldHighlight(destination);
  worldCamera();
}
// Dialogs and destination availability can change while the player stands
// still, so keep their highlight in sync without a polling animation loop.
const worldAvailabilityObserver = new MutationObserver(records => {
  if (records.some(record => record.attributeName === 'disabled')) worldDraw();
  else if (records.some(record => record.target.tagName === 'DIALOG')) {
    worldHighlight(worldNearest && worldShell.querySelector(worldNearest[3]));
  }
});
worldAvailabilityObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
worldAvailabilityObserver.observe(worldStage, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
worldById('world-interact').addEventListener('click', () => {
  if (worldNearest && !worldModalOpen()) worldShell.querySelector(worldNearest[3])?.click();
});

const worldDirections = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
function worldMove(dx, dy) {
  if (worldWalkable(worldPosition.x + dx, worldPosition.y)) worldPosition.x += dx;
  if (worldWalkable(worldPosition.x, worldPosition.y + dy)) worldPosition.y += dy;
}
function worldTick(now) {
  worldFrame = 0;
  if (worldDashboard.hidden || worldModalOpen()) return worldStop();
  const seconds = Math.min(Math.max((now - worldLastFrame) / 1000, 0), .04);
  worldLastFrame = now;
  const previous = { ...worldPosition };
  let dx = 0, dy = 0;
  for (const key of worldKeys) { dx += worldDirections[key][0]; dy += worldDirections[key][1]; }
  const distance = Math.hypot(dx, dy);
  if (distance) worldMove(dx / distance * 190 * seconds, dy / distance * 190 * seconds);
  if (!worldKeys.size && worldPath.length) {
    // Spend the whole frame's travel, including across route corners. Stopping
    // for a frame at every grid node made floor-click walking visibly stutter.
    let remaining = 190 * seconds;
    while (worldPath.length && remaining > 0) {
      const next = worldPath[0];
      const dx = next.x - worldPosition.x, dy = next.y - worldPosition.y;
      const distance = Math.hypot(dx, dy);
      if (distance < .000001) { worldPath.shift(); continue; }
      const step = Math.min(remaining, distance);
      const before = { ...worldPosition };
      worldMove(dx / distance * step, dy / distance * step);
      if (worldPosition.x === before.x && worldPosition.y === before.y) { worldPath = []; break; }
      remaining -= step;
      if (step === distance) worldPath.shift();
    }
  }
  dx = worldPosition.x - previous.x; dy = worldPosition.y - previous.y;
  const moved = dx !== 0 || dy !== 0;
  if (moved) {
    const facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
    if (worldAvatar.dataset.facing !== facing) worldAvatar.dataset.facing = facing;
    worldDraw();
    if (worldScene === 'home' && worldPosition.y > 558 && Math.abs(worldPosition.x - 480) < 55) return worldChangeScene('town');
  }
  worldSetWalking(moved);
  if (worldKeys.size || worldPath.length) worldFrame = requestAnimationFrame(worldTick);
  else worldStop();
}
function worldScheduleWalk() {
  if (worldFrame) return;
  worldLastFrame = performance.now();
  worldFrame = requestAnimationFrame(worldTick);
}
function worldStartWalk(key) {
  if (worldDashboard.hidden || worldModalOpen()) return;
  worldPath = [];
  worldKeys.add(key);
  worldScheduleWalk();
}
document.addEventListener('keydown', (event) => {
  if (worldDashboard.hidden || worldModalOpen() || event.target !== worldStage || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (worldDirections[key]) { event.preventDefault(); worldStartWalk(key); }
  if (['e', 'Enter', ' '].includes(key)) { event.preventDefault(); if (!event.repeat) worldById('world-interact').click(); }
  if (key === 'Escape' && worldScene === 'home') { event.preventDefault(); worldOpenPlace('menu', worldStage); }
});
document.addEventListener('keyup', (event) => {
  worldKeys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
});
window.addEventListener('blur', worldStop);
document.addEventListener('visibilitychange', () => { if (document.hidden) worldStop(); });
worldStage.addEventListener('blur', worldStop);
for (const button of worldShell.querySelectorAll('[data-world-direction]')) {
  const key = { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight' }[button.dataset.worldDirection];
  button.addEventListener('pointerdown', (event) => { event.preventDefault(); worldStage.focus({ preventScroll: true }); button.setPointerCapture?.(event.pointerId); worldStartWalk(key); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => worldKeys.delete(key));
  button.addEventListener('click', (event) => {
    if (event.detail !== 0 || worldModalOpen()) return;
    const [dx, dy] = worldDirections[key];
    const x = worldPosition.x + dx * 20, y = worldPosition.y + dy * 20;
    if (worldWalkable(x, y)) worldPosition = { x, y };
    if (worldScene === 'home' && worldPosition.y > 558 && Math.abs(worldPosition.x - 480) < 55) return worldChangeScene('town');
    worldDraw();
  });
}

// A small breadth-first grid route lets a floor click walk around furniture.
// Hotspots remain direct shortcuts, including on small touch screens.
worldStage.addEventListener('click', (event) => {
  if (event.target.closest('button, #pet-touch') || worldModalOpen() || worldDashboard.hidden) return;
  const rect = worldStage.getBoundingClientRect();
  worldStage.focus({ preventScroll: true });
  if (!rect.width || !rect.height) return;
  const end = { x: Math.round((event.clientX - rect.left) * 960 / rect.width / 20), y: Math.round((event.clientY - rect.top) * 640 / rect.height / 20) };
  if (!worldWalkable(end.x * 20, end.y * 20)) { worldMessage('That spot is occupied. Choose a clear patch of floor or a path.'); return; }
  worldStop();
  // Rounding a position beside a wall can put the first grid node *inside*
  // that wall. Choose a nearby free node with a clear approach instead.
  const rounded = { x: Math.round(worldPosition.x / 20), y: Math.round(worldPosition.y / 20) };
  const starts = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const point = { x: rounded.x + dx, y: rounded.y + dy };
    const distance = Math.hypot(point.x * 20 - worldPosition.x, point.y * 20 - worldPosition.y);
    const steps = Math.max(1, Math.ceil(distance / 4));
    let clear = true;
    for (let step = 1; step <= steps; step++) {
      if (!worldWalkable(worldPosition.x + (point.x * 20 - worldPosition.x) * step / steps,
        worldPosition.y + (point.y * 20 - worldPosition.y) * step / steps)) { clear = false; break; }
    }
    if (clear) starts.push({ point, distance });
  }
  const start = starts.sort((a, b) => a.distance - b.distance)[0]?.point;
  if (!start) return worldMessage('There is no clear path there. Try another spot.');
  const queue = [start], visited = new Map([[`${start.x},${start.y}`, null]]);
  let found = false;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.x === end.x && current.y === end.y) { found = true; break; }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const next = { x: current.x + dx, y: current.y + dy }, key = `${next.x},${next.y}`;
      if (visited.has(key) || !worldWalkable(next.x * 20, next.y * 20)) continue;
      visited.set(key, current); queue.push(next);
    }
  }
  if (!found) return worldMessage('There is no clear path there. Try another spot.');
  for (let point = end; point; point = visited.get(`${point.x},${point.y}`)) worldPath.unshift({ x: point.x * 20, y: point.y * 20 });
  worldScheduleWalk();
});

// Preserve normal arrow-key navigation in the Arena's actual tabs.
const arenaTabs = original.arena.querySelector('.arena-tabs');
arenaTabs.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...arenaTabs.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
});

document.addEventListener('adventure:reset', () => { worldCarePending = null; worldSelectInteraction(null); worldChangeScene('home', false); });
document.addEventListener('battle:show', worldStop);
document.addEventListener('confirm:ask', worldStop);
adventureEntrance.addEventListener('click', worldStop);
function worldSyncSession() {
  const visible = !worldDashboard.hidden;
  document.body.classList.toggle('world-playing', visible);
  if (!visible || !worldWasVisible) worldChangeScene('home', visible);
  worldWasVisible = visible;
}
new MutationObserver(worldSyncSession).observe(worldDashboard, { attributes: true, attributeFilter: ['hidden'] });
worldSyncSession();
worldDraw();
