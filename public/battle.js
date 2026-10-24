// Live battles wait for an explicit skill choice. Animations and replays only
// show saved server turns; they never decide damage or advance gameplay.
let dialog;
let timer;
let scene = null;
let turn = 0;
let submitting = false;
let confirming = false;
let animating = false;
const seen = new Set();
const queue = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id) => document.getElementById(id);

function buildDialog() {
  dialog = document.createElement('dialog');
  dialog.id = 'battle-dialog';
  dialog.setAttribute('aria-labelledby', 'battle-title');
  dialog.setAttribute('aria-describedby', 'battle-mode battle-initiative');
  dialog.innerHTML = `
    <header class="battle-heading"><div><p id="battle-mode">Turn-based battle</p><h2 id="battle-title">Claws at the ready</h2></div>
      <button type="button" id="battle-close" class="chip-btn chip-buy" aria-label="Close battle">Close</button></header>
    <p id="battle-initiative" class="battle-initiative" hidden></p>
    <div class="battle-stage">
      <div class="battle-woodland-art" aria-hidden="true"><svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMax slice">
        <use href="/scenes/adventure-atlas.svg#tree" x="-38" y="-14" width="190" height="190"/>
        <use href="/scenes/adventure-atlas.svg#tree" x="450" y="-18" width="200" height="200"/>
        <use href="/scenes/adventure-atlas.svg#fern" x="230" y="140" width="90" height="90"/>
        <use href="/scenes/adventure-atlas.svg#grass" x="8" y="160" width="100" height="70"/>
        <use href="/scenes/adventure-atlas.svg#grass" x="500" y="160" width="100" height="70"/>
      </svg></div>
      <article class="battle-fighter" id="battle-fighter-0"><h3 id="battle-name-0"></h3><div class="battle-avatar" id="battle-avatar-0"></div>
        <label for="battle-hp-0">HP <span id="battle-hp-text-0"></span></label><meter id="battle-hp-0" min="0" aria-label="Attacker HP"></meter>
        <label for="battle-mp-0">MP <span id="battle-mp-text-0"></span></label><meter id="battle-mp-0" min="0" aria-label="Attacker MP"></meter></article>
      <span class="battle-versus" aria-hidden="true">VS</span>
      <article class="battle-fighter" id="battle-fighter-1"><h3 id="battle-name-1"></h3><div class="battle-avatar" id="battle-avatar-1"></div>
        <label for="battle-hp-1">HP <span id="battle-hp-text-1"></span></label><meter id="battle-hp-1" min="0" aria-label="Defender HP"></meter>
        <label for="battle-mp-1">MP <span id="battle-mp-text-1"></span></label><meter id="battle-mp-1" min="0" aria-label="Defender MP"></meter></article>
    </div>
    <section class="battle-allies" id="battle-allies" aria-label="Teammates in this battle" hidden></section>
    <div class="battle-ability"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m9 4-5 24M18 4l-5 24M27 4l-5 24"/></svg>
      <div><strong id="battle-ability-name">Choose a skill</strong><span id="battle-ability-cost">Your pet is ready</span></div></div>
    <p id="battle-status" role="status" aria-live="polite"></p>
    <div id="battle-skills" class="battle-skills" role="group" aria-label="Choose your pet's skill" hidden></div>
    <p id="battle-error" class="error" role="alert"></p>
    <details class="battle-log"><summary>Attack log</summary><ol id="battle-log"></ol></details>
    <footer class="battle-actions"><button type="button" id="battle-skip" class="chip-btn chip-buy">Skip to result</button>
      <button type="button" id="battle-replay" class="chip-btn chip-buy" hidden>Replay battle</button></footer>`;
  document.body.append(dialog);
  $('battle-close').addEventListener('click', closeBattle);
  dialog.addEventListener('cancel', event => {
    if (!scene?.manual || scene.battle.status !== 'active') return;
    event.preventDefault();
    closeBattle();
  });
  $('battle-skip').addEventListener('click', finish);
  $('battle-replay').addEventListener('click', () => { if (!scene?.manual && scene?.allowReplay !== false) play(scene); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    clearTimeout(timer);
    submitting = false;
    const closed = scene;
    scene = null;
    if (closed) document.dispatchEvent(new CustomEvent('battle:closed', { detail: { key: closed.key } }));
    if (queue.length) play(queue.shift());
  });
}
// Which saved fighter each card shows. Cards 0 and 1 are the viewer's side
// and its opponent; a team battle's other pets get a card each, from 2 on.
let cards = [0, 1];
function avatar(fighter, index) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 110');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.color = /^#[0-9a-f]{6}$/i.test(fighter.color) ? fighter.color : '#f59e0b';
  const appearance = ['cat', 'dog', 'hedgehog', 'lizard', 'panda', 'bird', 'dragon', 'blob'].includes(fighter.appearance) ? fighter.appearance : 'blob';
  const symbol = document.getElementById(`pet-${appearance}`);
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
  cards.forEach((fighterIndex, card) => {
    const fighter = scene.battle.fighters[fighterIndex];
    for (const [kind, value, max] of [['hp', hp[fighterIndex], fighter.maxHp], ['mp', mp[fighterIndex], fighter.maxMp]]) {
      $(`battle-${kind}-${card}`).max = Math.max(1, max);
      $(`battle-${kind}-${card}`).value = value;
      $(`battle-${kind}-text-${card}`).textContent = `${value} / ${max}`;
    }
  });
}
// One small card per teammate fighting alongside the viewer's pet.
function allyCards(battle) {
  const allies = $('battle-allies');
  allies.replaceChildren();
  allies.hidden = cards.length < 3;
  cards.slice(2).forEach((fighterIndex, offset) => {
    const card = offset + 2;
    const article = document.createElement('article');
    article.className = 'battle-fighter battle-ally';
    article.id = `battle-fighter-${card}`;
    article.innerHTML = `<h3 id="battle-name-${card}"></h3><div class="battle-avatar" id="battle-avatar-${card}"></div>
      <label for="battle-hp-${card}">HP <span id="battle-hp-text-${card}"></span></label><meter id="battle-hp-${card}" min="0"></meter>
      <label for="battle-mp-${card}">MP <span id="battle-mp-text-${card}"></span></label><meter id="battle-mp-${card}" min="0"></meter>`;
    allies.append(article);
    const name = fighterName(battle.fighters[fighterIndex]);
    $(`battle-hp-${card}`).setAttribute('aria-label', `${name} HP`);
    $(`battle-mp-${card}`).setAttribute('aria-label', `${name} MP`);
  });
}
// The server saves each turn's effectiveness; older replays simply omit it.
const typeName = type => type ? type[0].toUpperCase() + type.slice(1) : '';
const effectText = step => step.effectiveness > 1 ? " It's super effective!" : step.effectiveness < 1 ? " It's not very effective…" : '';
function describe(step) {
  const actor = fighterName(scene.battle.fighters[step.actor]);
  const target = fighterName(scene.battle.fighters[step.target]);
  return `${actor} used ${step.name || 'Claw Strike'}${step.hits > 1 ? ` ×${step.hits}` : ''}: ${step.damage} damage to ${target}${step.mpCost ? ` (${step.mpCost} MP)` : ''}.${effectText(step)}`;
}
// How one of the viewer's skills fares against the saved monster's type. Only
// a hint: the server's TYPE_CHART (src/combat.ts) decides the saved damage.
function matchup(attack, battle) {
  const monster = battle.monsterIndex === null || battle.monsterIndex === undefined ? null : battle.fighters[battle.monsterIndex];
  if (!monster?.type || !attack.type || attack.type === 'normal') return '';
  const strong = { fire: 'grass', water: 'earth', grass: 'water' }[attack.type];
  return strong === monster.type ? ' · Super effective' : ' · Not very effective';
}
function abilityLabel(step) {
  if (!step) return;
  $('battle-ability-name').textContent = step.name || 'Claw Strike';
  $('battle-ability-cost').textContent = `${step.mpCost || 0} MP · ${step.damage} damage`;
  dialog.dataset.ability = step.ability || 'claw-strike';
}
const fighterName = fighter => fighter.name || fighter.id;
// The saved pre-battle coin toss, or the acting pet's coin that replaced it.
function initiativeText(battle) {
  const initiative = battle.initiative;
  if (!initiative) return '';
  // The first pet's toss or coin decides; in a team battle its whole team
  // goes first or second together, against the monster listed last.
  const provider = battle.coinProvider ?? initiative.provider ?? 0;
  const pet = fighterName(battle.fighters[provider]);
  const opponent = battle.monsterIndex ?? (provider === 0 ? battle.fighters.length - 1 : 0);
  const other = fighterName(battle.fighters[opponent]);
  const side = battle.fighters.length > 2 ? `${pet}'s team` : pet;
  if (initiative.coin === 'silver-coin') return `${pet}'s Silver Coin: ${side} attacks first.`;
  if (initiative.coin === 'gold-coin') return `${pet}'s Gold Coin: ${other} attacks first, but ${pet}'s first hit deals double damage.`;
  const toss = initiative.toss === 'heads' ? `Coin toss: Heads. ${side} attacks first.` : `Coin toss: Tails. ${other} attacks first.`;
  return initiative.coin === 'copper-coin' ? `${toss} ${pet}'s Copper Coin adds +1 to every attribute.` : toss;
}
function addLog(step) {
  if (scene.manual || scene.showLog === false) return;
  const li = document.createElement('li');
  li.textContent = describe(step);
  $('battle-log').append(li);
}
function advance() {
  if (!dialog.open || !scene) return;
  if (turn === scene.battle.turns.length) {
    if (scene.manual && scene.battle.status === 'active') return awaitChoice();
    return finish();
  }
  const step = scene.battle.turns[turn++];
  animating = true;
  dialog.dataset.waiting = 'false';
  abilityLabel(step);
  meters(step.hp, step.mp);
  addLog(step);
  $('battle-status').textContent = describe(step);
  cards.forEach((_, card) => $(`battle-fighter-${card}`).classList.remove('striking', 'hit', 'taking-turn'));
  if (!reducedMotion.matches) {
    void $('battle-fighter-0').offsetWidth;
    $(`battle-fighter-${cards.indexOf(step.actor)}`).classList.add('striking');
    $(`battle-fighter-${cards.indexOf(step.target)}`).classList.add('hit');
  }
  timer = setTimeout(advance, reducedMotion.matches ? 350 : 750);
}
function finish() {
  clearTimeout(timer);
  animating = false;
  if (!scene) return;
  if (scene.manual && scene.battle.status === 'active') return awaitChoice();
  while (turn < scene.battle.turns.length) addLog(scene.battle.turns[turn++]);
  const last = scene.battle.turns.at(-1);
  abilityLabel(last);
  meters(scene.resultResources?.hp ?? scene.battle.hp ?? last?.hp ?? scene.battle.initialHp,
    scene.resultResources?.mp ?? scene.battle.mp ?? last?.mp ?? scene.battle.initialMp);
  $('battle-status').textContent = `${scene.won ?? scene.battle.winner === scene.viewer ? 'Victory!' : 'Defeat.'} ${scene.result}`;
  const skipped = document.activeElement === $('battle-skip');
  $('battle-skip').hidden = true;
  $('battle-skills').hidden = true;
  dialog.dataset.waiting = 'false';
  $('battle-close').disabled = false;
  $('battle-close').textContent = scene.returnLabel || 'Close';
  $('battle-close').setAttribute('aria-label', scene.returnLabel || 'Close battle');
  $('battle-replay').hidden = scene.manual || scene.allowReplay === false;
  if (skipped) $(scene.allowReplay === false ? 'battle-close' : 'battle-replay').focus();
  cards.forEach((_, card) => $(`battle-fighter-${card}`).classList.remove('striking', 'hit', 'taking-turn'));
}
function awaitChoice() {
  clearTimeout(timer);
  animating = false;
  if (!scene?.manual || scene.battle.status !== 'active') return;
  const battle = scene.battle;
  meters(battle.hp, battle.mp);
  cards.forEach((_, card) => {
    $(`battle-fighter-${card}`).classList.remove('striking', 'hit');
    $(`battle-fighter-${card}`).classList.toggle('taking-turn', cards[card] === battle.actor);
  });
  const mine = battle.fighters.findIndex(fighter => fighter.id === scene.viewer);
  const myTurn = battle.actor === mine;
  dialog.dataset.waiting = 'true';
  const fighter = battle.fighters[battle.actor];
  $('battle-mode').textContent = `Turn ${battle.turns.length + 1} · ${myTurn ? 'Your move' : 'Waiting'}`;
  $('battle-status').textContent = myTurn ? 'What will your pet do?' : `Waiting for ${fighter ? fighterName(fighter) : 'the next player'} to choose a skill…`;
  $('battle-ability-name').textContent = myTurn ? 'Choose a skill' : 'Their turn';
  $('battle-ability-cost').textContent = myTurn ? 'Skills use MP. Claw Strike is always free.' : 'Your pet will wait for your next choice.';
  $('battle-skills').hidden = false;
  const choices = battle.attacks?.[mine] ?? [];
  const focused = document.activeElement?.dataset.skill;
  $('battle-skills').replaceChildren(...choices.map(attack => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'battle-skill';
    button.dataset.skill = attack.id;
    const name = document.createElement('strong'), cost = document.createElement('span');
    name.textContent = attack.name;
    if (attack.type) button.dataset.type = attack.type;
    const affordable = attack.mpCost <= battle.mp[mine];
    cost.textContent = `${attack.type ? `${typeName(attack.type)} · ` : ''}${attack.mpCost} MP${matchup(attack, battle)}${!affordable ? ' · Not enough MP' : ''}`;
    button.append(name, cost);
    button.disabled = submitting || !myTurn || !affordable || battle.hp[mine] <= 0;
    button.addEventListener('click', () => chooseSkill(attack.id));
    return button;
  }));
  $('battle-skills').setAttribute('aria-busy', String(submitting));
  $('battle-close').disabled = submitting || confirming;
  $('battle-close').textContent = 'Forfeit';
  $('battle-close').setAttribute('aria-label', 'Forfeit battle');
  if (focused) [...$('battle-skills').children].find(button => button.dataset.skill === focused && !button.disabled)?.focus();
}
async function chooseSkill(ability) {
  if (submitting || !scene?.manual || scene.battle.status !== 'active' || turn < scene.battle.turns.length) return;
  if (scene.battle.fighters[scene.battle.actor]?.id !== scene.viewer) return;
  const active = scene;
  submitting = true;
  $('battle-error').textContent = '';
  awaitChoice();
  try {
    await active.onChoose(ability, active.battle.revision);
  } catch (error) {
    if (scene?.key === active.key) $('battle-error').textContent = error.message || 'Could not save your move. Try again.';
  } finally {
    submitting = false;
    if (scene?.key === active.key && !animating && turn >= scene.battle.turns.length && scene.battle.status === 'active') awaitChoice();
  }
}
async function closeBattle() {
  if (!scene?.manual || scene.battle.status !== 'active') return dialog.close();
  if (submitting || confirming) return;
  const active = scene;
  confirming = true;
  $('battle-close').disabled = true;
  const yes = await new Promise(answer => document.dispatchEvent(new CustomEvent('confirm:ask', {
    detail: { title: 'Forfeit this battle?', message: 'Your pet will withdraw. In a team battle, your teammates can keep fighting.', answer },
  })));
  confirming = false;
  if (scene?.key !== active.key) return;
  if (!yes) { $('battle-close').disabled = false; return; }
  submitting = true;
  try {
    await scene.onForfeit(scene.battle.revision);
  } catch (error) {
    if (scene?.key === active.key) $('battle-error').textContent = error.message || 'Could not forfeit. Try again.';
  } finally {
    submitting = false;
    if (scene?.key === active.key && !animating && turn >= scene.battle.turns.length && scene.battle.status === 'active') awaitChoice();
  }
}
function play(next) {
  clearTimeout(timer);
  animating = false;
  scene = next;
  turn = 0;
  if (!dialog) buildDialog();
  submitting = false;
  $('battle-error').textContent = '';
  $('battle-skills').hidden = true;
  dialog.dataset.encounter = next.encounter || '';
  dialog.dataset.manual = String(Boolean(next.manual));
  $('battle-title').textContent = next.title || 'Arena battle';
  $('battle-close').textContent = next.returnLabel || 'Close';
  $('battle-close').setAttribute('aria-label', next.returnLabel || 'Close battle');
  $('battle-log').replaceChildren();
  $('battle-log').parentElement.hidden = next.manual || next.showLog === false;
  $('battle-log').parentElement.open = false;
  $('battle-skip').hidden = Boolean(next.manual);
  $('battle-replay').hidden = true;
  const initiative = initiativeText(next.battle);
  $('battle-initiative').textContent = initiative;
  $('battle-initiative').hidden = !initiative;
  $('battle-status').textContent = 'Ready. Let the battle begin!';
  $('battle-mode').textContent = next.manual ? 'Turn-based battle' : 'Battle replay';
  $('battle-ability-name').textContent = next.manual ? 'Choose a skill' : 'Battle replay';
  $('battle-ability-cost').textContent = next.manual ? 'Your pet waits for your choice.' : 'Playing the saved battle.';
  // A team battle (pets, then the monster last) shows the viewer's pet against
  // the monster, with its teammates beside them.
  const fighters = next.battle.fighters, last = fighters.length - 1;
  const mine = Math.max(0, fighters.findIndex(fighter => fighter.id === next.viewer));
  cards = fighters.length === 2 ? [0, 1] : [mine, last, ...fighters.map((_, i) => i).filter(i => i !== mine && i !== last)];
  allyCards(next.battle);
  cards.forEach((fighterIndex, card) => {
    const fighter = fighters[fighterIndex];
    $(`battle-name-${card}`).textContent = fighter.id === next.viewer ? `${fighterName(fighter)} (you)` : fighterName(fighter);
    const tag = $(`battle-type-${card}`) ?? document.createElement('p');
    tag.id = `battle-type-${card}`;
    tag.className = 'battle-type';
    tag.hidden = !fighter.type;
    tag.dataset.type = fighter.type ?? '';
    tag.textContent = fighter.type ? `${typeName(fighter.type)} type` : '';
    $(`battle-name-${card}`).after(tag);
    avatar(fighter, card);
  });
  meters(next.battle.initialHp ?? next.battle.fighters.map(f => f.maxHp), next.battle.initialMp ?? next.battle.fighters.map(f => f.maxMp));
  if (!dialog.open) dialog.showModal();
  if (next.manual && !next.battle.turns.length) advance();
  else timer = setTimeout(advance, reducedMotion.matches ? 150 : 650);
}
document.addEventListener('battle:show', ({ detail }) => {
  if (!detail?.battle || (!detail.manual && !detail.battle.turns?.length && !detail.battle.status)) return;
  // A new saved turn updates the open scene, without replaying earlier moves.
  if (scene?.manual && detail.key === scene.key && detail.manual) {
    if (detail.battle.revision < scene.battle.revision) return;
    const duplicate = detail.battle.revision === scene.battle.revision && detail.battle.status === scene.battle.status;
    const finishedAnimating = !animating && turn >= scene.battle.turns.length;
    scene = detail;
    if (duplicate) return;
    if (finishedAnimating) {
      clearTimeout(timer);
      $('battle-skills').hidden = true;
      advance();
    }
    return;
  }
  const queued = queue.findIndex(next => next.manual && detail.manual && next.key === detail.key);
  if (queued >= 0) {
    if (detail.battle.revision >= queue[queued].battle.revision) queue[queued] = detail;
    return;
  }
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
  submitting = false;
  confirming = false;
  if (dialog?.open) dialog.close();
});
document.addEventListener('battle:dismiss', ({ detail }) => {
  if (scene?.key === detail?.key && dialog?.open) dialog.close();
});
