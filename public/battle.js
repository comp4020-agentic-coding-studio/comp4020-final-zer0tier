// Plays only server-saved turns. Replay and Skip never send gameplay requests.
let dialog;
let timer;
let scene = null;
let turn = 0;
const seen = new Set();
const queue = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id) => document.getElementById(id);

function buildDialog() {
  dialog = document.createElement('dialog');
  dialog.id = 'battle-dialog';
  dialog.setAttribute('aria-labelledby', 'battle-title');
  dialog.setAttribute('aria-describedby', 'battle-mode');
  dialog.innerHTML = `
    <header class="battle-heading"><div><p id="battle-mode">Automatic battle</p><h2 id="battle-title">Claws at the ready</h2></div>
      <button type="button" id="battle-close" class="chip-btn chip-buy" aria-label="Close battle">Close</button></header>
    <div class="battle-stage">
      <article class="battle-fighter" id="battle-fighter-0"><h3 id="battle-name-0"></h3><div class="battle-avatar" id="battle-avatar-0"></div>
        <label for="battle-hp-0">HP <span id="battle-hp-text-0"></span></label><meter id="battle-hp-0" min="0" aria-label="Attacker HP"></meter>
        <label for="battle-mp-0">MP <span id="battle-mp-text-0"></span></label><meter id="battle-mp-0" min="0" aria-label="Attacker MP"></meter></article>
      <span class="battle-versus" aria-hidden="true">VS</span>
      <article class="battle-fighter" id="battle-fighter-1"><h3 id="battle-name-1"></h3><div class="battle-avatar" id="battle-avatar-1"></div>
        <label for="battle-hp-1">HP <span id="battle-hp-text-1"></span></label><meter id="battle-hp-1" min="0" aria-label="Defender HP"></meter>
        <label for="battle-mp-1">MP <span id="battle-mp-text-1"></span></label><meter id="battle-mp-1" min="0" aria-label="Defender MP"></meter></article>
    </div>
    <div class="battle-ability"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m9 4-5 24M18 4l-5 24M27 4l-5 24"/></svg>
      <div><strong>Claw Strike</strong><span>0 MP · Both fighters attack automatically</span></div></div>
    <p id="battle-status" role="status" aria-live="polite"></p>
    <details class="battle-log"><summary>Attack log</summary><ol id="battle-log"></ol></details>
    <footer class="battle-actions"><button type="button" id="battle-skip" class="chip-btn chip-buy">Skip to result</button>
      <button type="button" id="battle-replay" class="chip-btn chip-buy" hidden>Replay battle</button></footer>`;
  document.body.append(dialog);
  $('battle-close').addEventListener('click', () => dialog.close());
  $('battle-skip').addEventListener('click', finish);
  $('battle-replay').addEventListener('click', () => play(scene));
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    clearTimeout(timer);
    const closed = scene;
    scene = null;
    if (closed) document.dispatchEvent(new CustomEvent('battle:closed', { detail: { key: closed.key } }));
    if (queue.length) play(queue.shift());
  });
}
function avatar(fighter, index) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 110');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.color = /^#[0-9a-f]{6}$/i.test(fighter.color) ? fighter.color : '#f59e0b';
  const symbol = ['cat', 'dog', 'bird', 'dragon', 'blob'].includes(fighter.appearance) && document.getElementById(`pet-${fighter.appearance}`);
  const monster = ['slime', 'goblin', 'slime-king'].includes(fighter.monster) && document.getElementById(`monster-${fighter.monster}`);
  if (monster) {
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'battle-monster');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#${monster.id}`);
    svg.append(use);
  } else if (symbol) {
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#${symbol.id}`);
    svg.append(use);
  } else {
    svg.innerHTML = '<ellipse cx="60" cy="99" rx="35" ry="5" fill="currentColor" opacity=".15"/><path d="M24 50 23 15 45 31Q60 26 75 31L97 15 96 50C110 85 87 98 60 98S10 85 24 50Z" fill="currentColor" stroke="#3b2314" stroke-width="2"/><ellipse cx="60" cy="77" rx="22" ry="15" fill="#ffedd5"/><circle cx="44" cy="54" r="6" fill="#3b2314"/><circle cx="76" cy="54" r="6" fill="#3b2314"/><path d="M53 70q7 8 14 0" fill="none" stroke="#3b2314" stroke-width="3"/>';
  }
  $(`battle-avatar-${index}`).replaceChildren(svg);
}
function meters(hp, mp) {
  scene.battle.fighters.forEach((fighter, i) => {
    for (const [kind, value, max] of [['hp', hp[i], fighter.maxHp], ['mp', mp[i], fighter.maxMp]]) {
      $(`battle-${kind}-${i}`).max = Math.max(1, max);
      $(`battle-${kind}-${i}`).value = value;
      $(`battle-${kind}-text-${i}`).textContent = `${value} / ${max}`;
    }
  });
}
function describe(step) {
  const actor = fighterName(scene.battle.fighters[step.actor]);
  const target = fighterName(scene.battle.fighters[step.target]);
  return `${actor} used Claw Strike${step.hits > 1 ? ` ×${step.hits}` : ''}: ${step.damage} damage to ${target}.`;
}
const fighterName = fighter => fighter.name || fighter.id;
function addLog(step) {
  const li = document.createElement('li');
  li.textContent = describe(step);
  $('battle-log').append(li);
}
function advance() {
  if (!dialog.open || !scene) return;
  if (turn === scene.battle.turns.length) return finish();
  const step = scene.battle.turns[turn++];
  meters(step.hp, step.mp);
  addLog(step);
  $('battle-status').textContent = describe(step);
  for (const i of [0, 1]) $(`battle-fighter-${i}`).classList.remove('striking', 'hit');
  if (!reducedMotion.matches) {
    void $('battle-fighter-0').offsetWidth;
    $(`battle-fighter-${step.actor}`).classList.add('striking');
    $(`battle-fighter-${step.target}`).classList.add('hit');
  }
  timer = setTimeout(advance, reducedMotion.matches ? 350 : 750);
}
function finish() {
  clearTimeout(timer);
  if (!scene) return;
  while (turn < scene.battle.turns.length) addLog(scene.battle.turns[turn++]);
  const last = scene.battle.turns.at(-1);
  meters(scene.resultResources?.hp ?? last.hp, scene.resultResources?.mp ?? last.mp);
  $('battle-status').textContent = `${scene.battle.winner === scene.viewer ? 'Victory!' : 'Defeat.'} ${scene.result}`;
  const skipped = document.activeElement === $('battle-skip');
  $('battle-skip').hidden = true;
  $('battle-replay').hidden = false;
  if (skipped) $('battle-replay').focus();
  for (const i of [0, 1]) $(`battle-fighter-${i}`).classList.remove('striking', 'hit');
}
function play(next) {
  clearTimeout(timer);
  scene = next;
  turn = 0;
  if (!dialog) buildDialog();
  $('battle-title').textContent = next.title || 'Arena battle';
  $('battle-close').textContent = next.returnLabel || 'Close';
  $('battle-close').setAttribute('aria-label', next.returnLabel || 'Close battle');
  $('battle-log').replaceChildren();
  $('battle-skip').hidden = false;
  $('battle-replay').hidden = true;
  $('battle-status').textContent = 'Claw Strike ready. Let the battle begin!';
  next.battle.fighters.forEach((fighter, i) => {
    $(`battle-name-${i}`).textContent = fighter.id === next.viewer ? `${fighterName(fighter)} (you)` : fighterName(fighter);
    avatar(fighter, i);
  });
  meters(next.battle.initialHp ?? next.battle.fighters.map(f => f.maxHp), next.battle.initialMp ?? next.battle.fighters.map(f => f.maxMp));
  if (!dialog.open) dialog.showModal();
  timer = setTimeout(advance, reducedMotion.matches ? 350 : 750);
}
document.addEventListener('battle:show', ({ detail }) => {
  if (!detail?.battle?.turns?.length) return;
  if (seen.has(detail.key) && !detail.replay) return;
  seen.add(detail.key);
  if (seen.size > 100) seen.delete(seen.values().next().value);
  if (dialog?.open) { queue.push(detail); return; }
  play(detail);
});
document.addEventListener('battle:reset', () => {
  clearTimeout(timer);
  queue.length = 0;
  seen.clear();
  scene = null;
  if (dialog?.open) dialog.close();
});
