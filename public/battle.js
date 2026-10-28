// Live battles wait for an explicit skill choice. Animations and replays only
// show saved server turns; they never decide damage or advance gameplay.
let dialog;
let timer;
let scene = null;
// A saved battle key can be reopened after logout or dismissal. Async work
// belongs to that particular opening, not every future view of the same key.
let sceneVersion = 0;
let turn = 0;
let submitting = false;
let confirming = false;
let animating = false;
const seen = new Set();
const queue = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id) => document.getElementById(id);

// Small, local vector effects: no images to download, particle loops, or
// per-frame layout reads. Only saved turns select these presentation details.
const spark = '<path d="m50 12 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z"/>';
const burst = '<path d="m50 15 7 19 19-8-8 19 18 7-19 7 8 18-19-8-7 19-7-19-18 8 8-19-19-7 19-7-8-19 19 8Z"/>';
const shield = '<path class="fx-solid" d="M50 14 78 25v23c0 20-17 32-28 39-11-7-28-19-28-39V25Z"/>';
const rings = '<ellipse cx="50" cy="72" rx="36" ry="12"/><ellipse cx="50" cy="72" rx="24" ry="7"/>';
const visual = (type, motion, art, options = {}) => ({ type, motion, art, target: 'enemy', duration: 680, pose: 'cast', ...options });
const skillVisuals = {
  'heavy-breath-slam': visual('str', 'breath', '<g class="fx-core"><path class="fx-solid" d="M20 38c-8-17 18-27 24-14 9-22 38-8 29 7 22-2 23 27 3 28H30c-21 0-23-18-10-21Z"/><path d="m31 40 6 7m13-9 7 7m11-9 6 7"/></g><g class="fx-detail">'+rings+'</g>', { duration: 540, pose: 'slam' }),
  'lumberjack-sweep': visual('str', 'sweep', '<g class="fx-core"><path class="fx-solid" d="m30 22 19 13-9 19-24-5Z"/><path d="m42 36 32 44"/></g><g class="fx-detail"><path d="M13 62Q51 99 89 31M20 72Q62 94 88 53"/></g>', { pose: 'lunge' }),
  'humble-pie': visual('str', 'pie', '<g class="fx-core"><path class="fx-paper" d="M19 56h62l-9 18H28Z"/><path class="fx-solid" d="M23 53c0-13 15-13 17-20 5-12 21-13 24 3 14 0 18 9 14 17Z"/><path d="M15 76h70m-48-34 26 8"/></g><g class="fx-detail"><path d="m16 26 7 7m59-9-6 8M9 48h9m65 2h9"/></g>', { pose: 'lunge' }),
  'feral-maul': visual('str', 'maul', '<g class="fx-core"><path class="fx-solid" d="m17 21 13 36 8-37 12 31 13-31 8 37 12-36-6 51H24Z"/><path d="M27 80h46m-39-6v12m32-12v12"/></g>', { pose: 'lunge' }),
  'bloodlust-crash': visual('str', 'bloodlust', '<g class="fx-detail"><circle cx="50" cy="50" r="34"/><path d="M50 5v12m0 66v12M5 50h12m66 0h12"/></g><g class="fx-core"><path class="fx-solid" d="m24 20 26 23 26-23-19 30 19 30-26-23-26 23 19-30Z"/></g>', { duration: 900, pose: 'slam' }),
  'titans-relic-press': visual('str', 'titan', '<g class="fx-core"><path class="fx-solid" d="M26 12h48v58H26Z"/><path d="M32 19h36M33 62h34M50 25l10 12-10 13-10-13Z"/></g><g class="fx-detail"><path d="m11 83 14-8 13 9 12-7 13 7 12-10 14 9m-73-19 7 2m56-3 7-2"/></g>', { duration: 940, pose: 'slam' }),
  'gym-pump': visual('str', 'pump', '<g class="fx-core"><path class="fx-solid" d="M13 38h12v30H13Zm62 0h12v30H75ZM25 44h9v18h-9Zm41 0h9v18h-9Z"/><path d="M34 53h32"/></g><g class="fx-detail"><path d="M50 31V10m-8 8 8-8 8 8"/></g>', { target: 'self', cue: 'STR ↑', pose: 'rise' }),
  'apex-roar': visual('str', 'roar', '<g class="fx-core"><path d="M38 38q-16 12 0 24m24-24q16 12 0 24M26 26q-30 24 0 48m48-48q30 24 0 48"/><path class="fx-solid" d="m43 43 14-5v24l-14-5Z"/></g><g class="fx-detail"><circle cx="50" cy="50" r="41"/></g>', { cue: 'CHA ↓', pose: 'slam' }),
  'hardhat-guard': visual('str', 'hardhat', '<g class="fx-core">'+shield+'<path class="fx-paper" d="M31 53a19 19 0 0 1 38 0Zm-5 0h48v7H26Z"/><path d="M46 51V34h8v17"/></g>', { target: 'self', cue: 'Guard', pose: 'brace' }),
  'service-smile': visual('cha', 'smile', '<g class="fx-core"><path class="fx-paper" d="M25 37h44v19a21 21 0 0 1-42 0Zm44 3h7c15 0 10 20-7 18"/><path d="M21 80h54m-35-25q8 10 16 0m-19-8h1m21 0h1"/></g><g class="fx-detail"><path class="fx-solid" d="M52 25C28 10 48 1 52 12 60 1 77 14 52 25Z"/></g>', { duration: 560 }),
  'hecklers-jab': visual('cha', 'heckle', '<g class="fx-core"><path class="fx-solid" d="m19 59 15-16 18 14-18 16Z"/><circle class="fx-paper" cx="51" cy="39" r="17"/><path d="m42 29 18 17M24 68l-9 15m55-53 15-12-4 21 12-3-13 18"/></g>', { pose: 'lunge' }),
  'dazzling-riposte': visual('cha', 'riposte', '<g class="fx-detail"><path d="M23 72C-5 35 50-8 80 26M25 72l-3-16m3 16 15-5"/></g><g class="fx-core"><path class="fx-paper" d="m31 64 43-46-9 29-27 24Z"/><path d="m25 56 20 22m-11-11-15 15"/></g>', { pose: 'lunge' }),
  'sirens-lure': visual('cha', 'siren', '<g class="fx-core"><path class="fx-solid" d="M45 77C-9 43 28 10 45 34 64 9 99 43 45 77Z"/><path d="M69 35V14l17-4v24m-17-14 17-4"/><ellipse cx="64" cy="37" rx="6" ry="4"/><ellipse cx="81" cy="35" rx="6" ry="4"/></g>', { duration: 740 }),
  'vip-velvet-rope': visual('cha', 'velvet', '<g class="fx-core"><path d="M16 26v54m68-54v54M7 84h18m50 0h18"/><circle class="fx-solid" cx="16" cy="22" r="7"/><circle class="fx-solid" cx="84" cy="22" r="7"/><path class="fx-ribbon" d="M16 38Q50 88 84 38"/><path d="m38 18 12-9 12 9-12 9Z"/></g>', { duration: 900 }),
  'crown-jewel-beam': visual('cha', 'crown', '<g class="fx-core"><path class="fx-solid" d="m26 22 12 12 12-19 12 19 12-12-5 26H31Z"/><path class="fx-paper" d="m50 34 7 7-7 7-7-7Z"/><path d="m43 55-9 27m16-27v35m7-35 9 27"/></g><g class="fx-detail">'+spark+'</g>', { duration: 940 }),
  'makeover-glow': visual('cha', 'makeover', '<g class="fx-core"><ellipse class="fx-paper" cx="50" cy="39" rx="22" ry="27"/><path d="M44 66v20h12V66M40 28l15-10m-16 24 25-18"/></g><g class="fx-detail"><path d="m19 52 3 8 8 3-8 3-3 8-3-8-8-3 8-3m64-37v12m-6-6h12"/></g>', { target: 'self', cue: 'CHA ↑', pose: 'rise' }),
  'phantom-perfume': visual('cha', 'perfume', '<g class="fx-core"><path class="fx-paper" d="M34 48h32l9 34H25Z"/><path class="fx-solid" d="M39 36h22v12H39Z"/><path d="M45 34V24h16m5 0h5"/></g><g class="fx-detail"><circle cx="80" cy="22" r="9"/><circle cx="63" cy="12" r="7"/><circle cx="85" cy="45" r="6"/></g>', { target: 'self', cue: 'Evasion ↑', pose: 'sway' }),
  'standing-ovation': visual('cha', 'ovation', '<g class="fx-core"><path class="fx-paper" d="m26 77-15-25 5-4 12 13-10-25 6-3 12 23-4-27 7-1 6 31 7-15 6 4-10 29Zm48 0 15-25-5-4-12 13 10-25-6-3-12 23 4-27-7-1-6 31"/></g><g class="fx-detail"><path d="M50 7v13m-20-9 6 11m34-11-6 11M50 80v12m-6-6h12"/></g>', { target: 'self', cue: 'Heal', duration: 760, pose: 'rise' }),
  'paperplane-dart': visual('int', 'dart', '<g class="fx-core"><path class="fx-paper" d="m13 37 76-19-25 64-16-24-24 4 5-16Z"/><path d="m29 46 60-28-41 40m0 0-10 18-2-16"/></g><g class="fx-detail"><path d="M8 73h18M5 83h12"/></g>', { duration: 540 }),
  'synapse-shock': visual('int', 'synapse', '<g class="fx-core"><path d="m20 30 25 14 29-23m-29 23-8 31m8-31 34 24"/><circle class="fx-solid" cx="20" cy="30" r="9"/><circle class="fx-solid" cx="74" cy="21" r="7"/><circle class="fx-solid" cx="37" cy="75" r="8"/><circle class="fx-solid" cx="79" cy="68" r="9"/><path class="fx-paper" d="m52 26-20 28h14l-1 20 23-33H53Z"/></g>'),
  'gravity-formula': visual('int', 'gravity', '<g class="fx-detail"><ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(-25 50 50)"/><path class="fx-solid" d="m13 17 13 2 3 12-14-2Zm63 55 13-2-3 13-12 4Z"/></g><g class="fx-core"><circle class="fx-solid" cx="50" cy="50" r="20"/><path class="fx-paper" d="M45 37h10v15h8L50 65 37 52h8Z"/></g>'),
  'laser-trajectory': visual('int', 'laser', '<g class="fx-detail"><circle cx="59" cy="50" r="24"/><path d="M59 15v17m0 36v17M24 50h17m36 0h17"/></g><g class="fx-core"><path class="fx-ribbon" d="M5 50h84"/><path class="fx-paper" d="m75 40 15 10-15 10"/></g>'),
  'mind-gap': visual('int', 'mind', '<g class="fx-detail"><path d="M18 64Q50 1 82 36M18 44Q50 100 82 56"/></g><g class="fx-core"><circle class="fx-paper" cx="22" cy="54" r="12"/><circle class="fx-solid" cx="77" cy="45" r="18"/><path d="m40 51 18-6m-7-6 7 6-5 8"/></g>', { duration: 900 }),
  'forbidden-grimoire': visual('int', 'grimoire', '<g class="fx-core"><path class="fx-paper" d="M50 43Q28 29 13 37v40q19-7 37 4 18-11 37-4V37q-15-8-37 6Z"/><path d="M50 43v38m-28-33 18 5m-18 7 18 5m20-12 18-5m-18 17 18-5"/></g><g class="fx-detail"><path d="m50 7 16 14-16 14-16-14Zm-28 9v8m-4-4h8m52-3v9m-4-4h8"/></g>', { duration: 980 }),
  'peer-review': visual('int', 'review', '<g class="fx-core"><path class="fx-paper" d="M22 15h44v68H22Z"/><path d="m30 28 4 4 7-9m-11 24 4 4 7-9m-11 24 4 4 7-9m8-30h9m-9 18h9"/><circle class="fx-solid" cx="66" cy="61" r="16"/><path d="m78 74 13 15m-32-29 5 5 9-11"/></g>', { target: 'self', cue: 'Focus ↑', pose: 'rise' }),
  'mana-barrier': visual('int', 'barrier', '<g class="fx-core"><path class="fx-paper" d="m50 8 35 21v42L50 92 15 71V29Z"/><path d="m50 21 24 15v28L50 79 26 64V36Z"/><path class="fx-solid" d="m50 33 10 17-10 17-10-17Z"/></g>', { target: 'self', cue: 'Barrier', pose: 'brace' }),
  'coffee-break': visual('int', 'coffee', '<g class="fx-core"><path class="fx-paper" d="M23 41h43v22c0 24-43 24-43 0Zm43 2h7c18 0 14 23-7 23"/><path d="M17 87h59"/></g><g class="fx-detail"><path d="M34 32c-13-10 12-12 0-24m15 24c-13-10 12-12 0-24m14 24c-13-10 12-12 0-24"/></g>', { target: 'self', cue: 'MP ↑', pose: 'rise' }),
  'jack-of-all-trades': visual('normal', 'jack', '<g class="fx-core"><path class="fx-solid" d="m50 10 13 22H37Z"/><circle class="fx-paper" cx="23" cy="71" r="13"/><path class="fx-solid" d="M65 58h25v25H65Z"/><path d="M36 71h24M29 51l10-16m24 1 10 16"/></g><g class="fx-detail"><circle cx="50" cy="52" r="8"/></g>'),
  'equalizer-field': visual('normal', 'equalizer', '<g class="fx-core"><ellipse cx="50" cy="50" rx="42" ry="30"/><path class="fx-ribbon" d="M32 43h36M32 57h36"/></g><g class="fx-detail"><path d="M8 17h84M8 83h84"/><circle class="fx-solid" cx="17" cy="17" r="5"/><circle class="fx-paper" cx="83" cy="83" r="5"/></g>', { target: 'field', cue: 'Neutral', duration: 780 }),
  'golden-ratio': visual('normal', 'golden', '<g class="fx-detail"><path d="M12 18h76v64H12Zm47 0v64M12 57h47m-22 0v25"/></g><g class="fx-core"><path class="fx-ribbon" d="M80 75C80 5 19 11 19 53c0 35 46 35 46 9 0-21-28-21-28-5 0 11 17 12 17 2"/></g>', { duration: 960 }),
  'claw-strike': visual('str', 'claw', '<g class="fx-core"><path d="M28 17Q39 46 16 78M53 14Q64 48 39 83M78 17Q90 48 65 80"/></g>', { duration: 500, pose: 'lunge' }),
  'heavy-strike': visual('str', 'hammer', '<g class="fx-core"><path class="fx-solid" d="m22 14 48 14-7 22-48-14Z"/><path d="m44 42-11 39"/></g><g class="fx-detail">'+rings+'</g>', { pose: 'slam' }),
  'firebolt': visual('str', 'flame', '<g class="fx-core"><path class="fx-solid" d="M49 8C61 42 92 36 79 72 68 95 20 92 19 63c0-21 22-25 30-55Z"/><path class="fx-paper" d="M49 45c4 16 19 15 13 29-8 13-23 4-22-6 1-7 9-12 9-23Z"/></g>'),
  'tide-crash': visual('int', 'wave', '<g class="fx-core"><path class="fx-solid" d="M10 76C36 74 23 22 59 21c36 0 33 38 13 38 7-23-15-17-11-3 3 11 18 17 29 20Z"/><path d="M18 85h64M36 64q6-28 21-29"/></g>'),
  'vine-lash': visual('cha', 'vine', '<g class="fx-core"><path d="M14 84C91 86 6 15 82 16"/><path class="fx-solid" d="M43 65Q10 64 19 41q24-1 24 24Zm6-24Q45 15 67 9q17 23-18 32Z"/></g>'),
  'bump': visual('str', 'bump', '<g class="fx-core">'+burst+'</g><g class="fx-detail"><circle cx="50" cy="50" r="16"/></g>', { pose: 'slam', duration: 580 }),
};
const bossChargeVisual = visual('str', 'charge', '<g class="fx-core"><path class="fx-solid" d="m24 40-5-22 20 9 11-17 11 17 20-9-5 22Z"/><ellipse cx="50" cy="65" rx="28" ry="17"/></g><g class="fx-detail">'+rings+'</g>', { target: 'self', cue: 'Charging', pose: 'brace', duration: 780 });
let portraitAnimations = [];
let nextTurnDelay = null;
let nextTurnAt = 0;
let motionPaused = false;
const coveringDialogs = new Set();
function clearSkillVisuals() {
  portraitAnimations.forEach(animation => animation.cancel());
  portraitAnimations = [];
  dialog?.querySelectorAll('.skill-vfx, .battle-cue').forEach(node => node.remove());
}
function cancelAdvance() {
  clearTimeout(timer); timer = undefined; nextTurnDelay = null;
}
function scheduleAdvance(delay) {
  cancelAdvance();
  nextTurnDelay = delay;
  if (motionPaused) return;
  nextTurnAt = performance.now() + delay;
  timer = setTimeout(() => { timer = undefined; nextTurnDelay = null; advance(); }, delay);
}
function syncBattleMotion() {
  if (!dialog?.open) return;
  for (const cover of coveringDialogs) if (!cover.open || !cover.isConnected) coveringDialogs.delete(cover);
  const paused = document.visibilityState === 'hidden' || confirming || coveringDialogs.size > 0;
  dialog.classList.toggle('battle-motion-paused', paused);
  if (paused === motionPaused) return;
  motionPaused = paused;
  if (paused) {
    if (timer !== undefined) {
      nextTurnDelay = Math.max(0, nextTurnAt - performance.now());
      clearTimeout(timer); timer = undefined;
    }
    portraitAnimations.forEach(animation => { if (animation.playState !== 'finished') animation.pause(); });
  } else {
    // play() on a finished Web Animation rewinds it; do not replay an impact
    // that completed before the tab or confirmation window interrupted us.
    portraitAnimations.forEach(animation => { if (animation.playState !== 'finished') animation.play(); });
    if (nextTurnDelay !== null) scheduleAdvance(nextTurnDelay);
  }
}
function animatePortrait(card, pose, duration, direction = 1) {
  const node = $(`battle-avatar-${card}`);
  if (reducedMotion.matches || !node?.animate) return;
  const frames = {
    lunge: ['none', `translateX(${direction * 14}px) rotate(${direction * 5}deg)`, 'none'],
    slam: ['none', 'translateY(-7px) scale(.97, 1.03)', 'translateY(3px) scale(1.04, .96)', 'none'],
    cast: ['none', 'translateY(-4px) rotate(-3deg)', 'none'],
    rise: ['none', 'translateY(-6px) scale(1.04)', 'none'],
    sway: ['none', 'translateX(-5px) rotate(-4deg)', 'translateX(5px) rotate(4deg)', 'none'],
    brace: ['none', 'scale(1.04, .94)', 'none'],
    hit: ['none', `translateX(${direction * 6}px) rotate(${direction * 4}deg)`, 'none'],
    dodge: ['none', `translateX(${direction * 12}px) rotate(${direction * 9}deg)`, 'none'],
  };
  const reacting = pose === 'hit' || pose === 'dodge';
  const animation = node.animate((frames[pose] ?? frames.cast).map(transform => ({ transform })),
    { duration: reacting ? 240 : Math.min(duration, 540), delay: reacting ? duration * .25 : 0,
      easing: 'cubic-bezier(.22,.7,.3,1)' });
  portraitAnimations.push(animation);
  if (motionPaused) animation.pause();
}
function showSkillVisuals(step) {
  clearSkillVisuals();
  const profile = step.telegraph ? bossChargeVisual : skillVisuals[step.ability] ?? skillVisuals['claw-strike'];
  const actorCard = cards.indexOf(step.actor), targetCard = cards.indexOf(step.target);
  const direction = actorCard === 1 ? -1 : 1;
  const recipients = profile.target === 'field' ? cards.map((_, card) => card)
    : [profile.target === 'self' ? actorCard : targetCard];
  for (const card of recipients) {
    const avatar = $(`battle-avatar-${card}`);
    if (!avatar) continue;
    const effect = document.createElement('span');
    effect.className = `skill-vfx${step.missed ? ' is-miss' : ''}${reducedMotion.matches ? ' is-still' : ''}`;
    effect.dataset.skill = step.ability; effect.dataset.motion = profile.motion; effect.dataset.palette = profile.type;
    effect.setAttribute('aria-hidden', 'true');
    effect.style.setProperty('--fx-duration', `${profile.duration}ms`);
    effect.style.setProperty('--fx-direction', String(direction));
    // Only trusted, local vector strings go into this decorative SVG.
    effect.innerHTML = `<svg viewBox="0 0 100 100" focusable="false">${profile.art}</svg>`;
    avatar.append(effect);
    const cue = document.createElement('span');
    cue.className = 'battle-cue'; cue.setAttribute('aria-hidden', 'true');
    cue.dataset.outcome = step.missed ? 'miss' : step.damage > 0 ? 'damage' : 'support';
    cue.textContent = step.missed ? 'Miss' : step.damage > 0 ? `−${step.damage}` : profile.cue || 'Ready';
    avatar.append(cue);
  }
  animatePortrait(actorCard, profile.pose, profile.duration, direction);
  if (profile.target === 'enemy' && targetCard !== actorCard && (step.damage > 0 || step.missed)) {
    animatePortrait(targetCard, step.missed ? 'dodge' : 'hit', profile.duration, direction);
  }
  return reducedMotion.matches ? 350 : profile.duration + 90;
}
document.addEventListener('visibilitychange', syncBattleMotion);
reducedMotion.addEventListener?.('change', () => {
  if (!reducedMotion.matches) return;
  portraitAnimations.forEach(animation => animation.cancel()); portraitAnimations = [];
  dialog?.querySelectorAll('.skill-vfx').forEach(node => node.classList.add('is-still'));
  if (nextTurnDelay !== null) scheduleAdvance(350);
});

function buildDialog() {
  dialog = document.createElement('dialog');
  dialog.id = 'battle-dialog';
  dialog.setAttribute('aria-labelledby', 'battle-title');
  dialog.setAttribute('aria-describedby', 'battle-mode battle-initiative');
  dialog.innerHTML = `
    <header class="battle-heading"><div><p id="battle-mode">Turn-based battle</p><h2 id="battle-title">Claws at the ready</h2></div>
      <button type="button" id="battle-close" class="chip-btn chip-buy" aria-label="Close battle">Close</button></header>
    <p id="battle-initiative" class="battle-initiative" hidden></p>
    <p id="battle-strategy" class="battle-strategy" hidden></p>
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
    <div role="status" aria-live="polite" aria-atomic="true">
      <p id="battle-status"></p>
      <p id="battle-intent" class="battle-intent" hidden></p>
    </div>
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
    sceneVersion++;
    cancelAdvance(); clearSkillVisuals();
    coveringDialogs.clear();
    motionPaused = false;
    submitting = false;
    confirming = false;
    const closed = scene;
    scene = null;
    if (closed) document.dispatchEvent(new CustomEvent('battle:closed', { detail: { key: closed.key } }));
    if (queue.length) play(queue.shift());
  });
  // Track opening order, rather than focus: the Adventure dialog underneath
  // this modal must not pause it when that map refreshes its controls.
  new MutationObserver(records => {
    for (const { target, oldValue } of records) {
      if (target.tagName !== 'DIALOG') continue;
      if (target === dialog && target.open && oldValue === null) coveringDialogs.clear();
      else if (dialog.open && target !== dialog && target.open && oldValue === null) coveringDialogs.add(target);
    }
    syncBattleMotion();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
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
    const gearArt = {
      bruiser: '<path d="m10 1 8 3v6c0 5-5 8-8 10-3-2-8-5-8-10V4Z"/><path d="M10 5v10M5 9h10" fill="none"/>',
      caster: '<path d="M1 3q5-3 9 0 4-3 9 0v15q-5-3-9 0-4-3-9 0Z"/><path d="M10 4v13M4 7h3m-3 4h3m6-4h3m-3 4h3" fill="none"/>',
      dodger: '<path d="M1 4q9 4 18 0v8q-4 7-9 0-5 7-9 0Z"/><path d="m4 8 3 1m6 0 3-1" fill="none"/>',
    };
    if (gearArt[fighter.tactic] && (fighter.tactic !== 'bruiser' || fighter.abilities.includes('hardhat-guard'))) {
      const gear = document.createElementNS(svg.namespaceURI, 'g');
      gear.setAttribute('class', 'monster-gear'); gear.dataset.tactic = fighter.tactic;
      gear.setAttribute('transform', 'translate(15 16) scale(.34)');
      gear.innerHTML = gearArt[fighter.tactic];
      svg.append(gear);
    }
  } else if (symbol) {
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#${symbol.id}`);
    svg.append(use);
  } else {
    svg.innerHTML = '<ellipse cx="60" cy="99" rx="35" ry="5" fill="currentColor" opacity=".15"/><path d="M24 50 23 15 45 31Q60 26 75 31L97 15 96 50C110 85 87 98 60 98S10 85 24 50Z" fill="currentColor" stroke="#3b2314" stroke-width="2"/><ellipse cx="60" cy="77" rx="22" ry="15" fill="#ffedd5"/><circle cx="44" cy="54" r="6" fill="#3b2314"/><circle cx="76" cy="54" r="6" fill="#3b2314"/><path d="M53 70q7 8 14 0" fill="none" stroke="#3b2314" stroke-width="3"/>';
  }
  $(`battle-avatar-${index}`).replaceChildren(svg);
}
function meters(hp, mp, snapshot) {
  cards.forEach((fighterIndex, card) => {
    const fighter = scene.battle.fighters[fighterIndex];
    for (const [kind, value, max] of [['hp', hp[fighterIndex], snapshot?.maxHp?.[fighterIndex] ?? fighter.maxHp], ['mp', mp[fighterIndex], snapshot?.maxMp?.[fighterIndex] ?? fighter.maxMp]]) {
      $(`battle-${kind}-${card}`).max = Math.max(1, max);
      $(`battle-${kind}-${card}`).value = value;
      $(`battle-${kind}-text-${card}`).textContent = `${value} / ${max}`;
    }
    const tag = $(`battle-type-${card}`), type = snapshot?.types?.[fighterIndex] ?? fighter.type;
    if (tag && type) { tag.textContent = `${typeName(type)} type`; tag.dataset.type = type; tag.hidden = false; }
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
const typeName = type => ['str', 'cha', 'int'].includes(type) ? type.toUpperCase() : type ? type[0].toUpperCase() + type.slice(1) : '';
const effectText = step => step.effectiveness > 1 ? " It's super effective!" : step.effectiveness < 1 ? " It's not very effective…" : '';
function describe(step) {
  const actor = fighterName(scene.battle.fighters[step.actor]);
  const target = fighterName(scene.battle.fighters[step.target]);
  if (step.telegraph) return `${actor} is charging ${step.name} at ${target}. ${step.events?.join('. ') ?? ''}.`;
  return `${actor} used ${step.name || 'Claw Strike'}${step.hits > 1 ? ` ×${step.hits}` : ''}: ${step.missed ? 'missed' : step.damage ? `${step.damage} damage to ${target}` : 'support skill'}${step.mpCost ? ` (${step.mpCost} MP)` : ''}.${effectText(step)}${step.events?.length ? ` ${step.events.join('. ')}.` : ''}`;
}
// How one of the viewer's skills fares against the saved monster's type. Only
// a hint: the server's TYPE_CHART (src/combat.ts) decides the saved damage.
function matchup(attack, battle) {
  if (battle.rulesVersion === 2) {
    if (!attack.power || battle.fieldUntil > (battle.effectTick ?? battle.revision)) return '';
    const mine = battle.fighters.findIndex(f => f.id === scene.viewer);
    const opponent = battle.monsterIndex ?? (1 - mine);
    const ownType = battle.fighters[mine]?.type, otherType = battle.fighters[opponent]?.type;
    const beats = { str: 'cha', cha: 'int', int: 'str' };
    return beats[ownType] === otherType ? ' · Type advantage' : beats[otherType] === ownType ? ' · Type disadvantage' : '';
  }
  const monster = battle.monsterIndex === null || battle.monsterIndex === undefined ? null : battle.fighters[battle.monsterIndex];
  if (!monster?.type || !attack.type || attack.type === 'normal') return '';
  const strong = { fire: 'grass', water: 'earth', grass: 'water' }[attack.type];
  return strong === monster.type ? ' · Super effective' : ' · Not very effective';
}
function abilityLabel(step) {
  if (!step) return;
  $('battle-ability-name').textContent = `${step.telegraph ? 'Charging ' : ''}${step.name || 'Claw Strike'}`;
  $('battle-ability-cost').textContent = step.telegraph ? 'No MP spent · Lands on the next boss turn' : `${step.mpCost || 0} MP · ${step.damage} damage`;
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
  $('battle-intent').hidden = true;
  if (!dialog.open || !scene) return;
  syncBattleMotion();
  if (motionPaused) { scheduleAdvance(0); return; }
  if (turn === scene.battle.turns.length) {
    if (scene.manual && scene.battle.status === 'active') return awaitChoice();
    return finish();
  }
  const step = scene.battle.turns[turn++];
  animating = true;
  dialog.dataset.waiting = 'false';
  abilityLabel(step);
  meters(step.hp, step.mp, step);
  addLog(step);
  $('battle-status').textContent = describe(step);
  cards.forEach((_, card) => $(`battle-fighter-${card}`).classList.remove('taking-turn'));
  scheduleAdvance(showSkillVisuals(step));
}
function finish() {
  cancelAdvance(); clearSkillVisuals();
  $('battle-intent').hidden = true;
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
  dialog.querySelectorAll('.battle-effects').forEach(label => label.remove());
  $('battle-close').disabled = false;
  $('battle-close').textContent = scene.returnLabel || 'Close';
  $('battle-close').setAttribute('aria-label', scene.returnLabel || 'Close battle');
  $('battle-replay').hidden = scene.manual || scene.allowReplay === false;
  if (skipped) $(scene.allowReplay === false ? 'battle-close' : 'battle-replay').focus();
  cards.forEach((_, card) => $(`battle-fighter-${card}`).classList.remove('striking', 'hit', 'taking-turn'));
}
function awaitChoice() {
  cancelAdvance(); clearSkillVisuals();
  animating = false;
  if (!scene?.manual || scene.battle.status !== 'active') return;
  const battle = scene.battle;
  meters(battle.hp, battle.mp);
  const intent = battle.monsterIntent, warning = $('battle-intent');
  warning.textContent = '';
  warning.hidden = !intent;
  if (intent) {
    const target = battle.fighters[intent.target];
    const attack = battle.attacks[battle.monsterIndex]?.find(a => a.id === intent.ability);
    if (battle.hp[intent.target] <= 0) warning.textContent = 'Bump interrupted: its target has left. The boss will use Claw Strike instead.';
    else if (attack?.unavailable) warning.textContent = 'Bump interrupted: not enough MP. The boss will use Claw Strike instead.';
    else warning.textContent = `Bump incoming · Target: ${fighterName(target)}${target.id === scene.viewer ? ' (you)' : ''}. On the next boss turn, it deals two-thirds of current HP before mitigation. Guard to reduce damage, or lower the boss below ${attack?.currentMpCost ?? 5} MP to interrupt it.`;
  }
  cards.forEach((index, card) => {
    const summary = $(`battle-effects-${card}`) ?? document.createElement('p');
    summary.id = `battle-effects-${card}`; summary.className = 'battle-effects';
    const effects = battle.states?.[index]?.effects ?? [];
    const effectTime = battle.effectTick ?? battle.revision;
    summary.textContent = effects.map(e => `${e.name} (${Math.ceil((e.expires - effectTime) / battle.order.length)} turns)`).join(' · ')
      + (battle.states?.[index]?.surcharge ? ' · Next paid skill +2 MP' : '')
      + (battle.fieldUntil > effectTime ? ' · Type advantages disabled' : '');
    summary.hidden = !summary.textContent;
    $(`battle-fighter-${card}`).append(summary);
  });
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
  $('battle-ability-cost').textContent = myTurn ? 'Basic attacks restore MP. Choose a skill below.' : 'Your pet will wait for your next choice.';
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
    const mpCost = attack.currentMpCost ?? attack.mpCost;
    const affordable = mpCost <= battle.mp[mine];
    const reason = attack.unavailable || (!affordable ? 'Not enough MP' : '');
    cost.textContent = `${attack.type ? `${typeName(attack.type)} · ` : ''}${mpCost} MP${matchup(attack, battle)}${reason ? ` · ${reason}` : ''}`;
    const detail = document.createElement('span'); detail.className = 'battle-skill-detail';
    detail.textContent = `${attack.power !== undefined ? `Power ${attack.power} · ${attack.accuracy === 'sure-hit' ? 'Sure-hit' : `${Math.round((attack.hitChance ?? (attack.accuracy ?? 100) / 100) * 100)}% hit chance`}. ` : ''}${attack.description ?? ''}`;
    button.append(name, cost, detail);
    button.disabled = submitting || !myTurn || Boolean(reason) || battle.hp[mine] <= 0;
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
  const active = scene, version = sceneVersion;
  submitting = true;
  $('battle-error').textContent = '';
  awaitChoice();
  try {
    await active.onChoose(ability, active.battle.revision);
  } catch (error) {
    if (sceneVersion === version && scene?.key === active.key) $('battle-error').textContent = error.message || 'Could not save your move. Try again.';
  } finally {
    if (sceneVersion === version && scene?.key === active.key) {
      submitting = false;
      if (!animating && turn >= scene.battle.turns.length && scene.battle.status === 'active') awaitChoice();
    }
  }
}
async function closeBattle() {
  if (!scene?.manual || scene.battle.status !== 'active') return dialog.close();
  if (submitting || confirming) return;
  const active = scene, version = sceneVersion;
  confirming = true;
  syncBattleMotion();
  $('battle-close').disabled = true;
  const yes = await new Promise(answer => document.dispatchEvent(new CustomEvent('confirm:ask', {
    detail: { title: 'Forfeit this battle?', message: 'Your pet will withdraw. In a team battle, your teammates can keep fighting.', answer },
  })));
  if (sceneVersion !== version || scene?.key !== active.key) return;
  confirming = false;
  syncBattleMotion();
  if (!yes) { $('battle-close').disabled = false; return; }
  submitting = true;
  try {
    await scene.onForfeit(scene.battle.revision);
  } catch (error) {
    if (sceneVersion === version && scene?.key === active.key) $('battle-error').textContent = error.message || 'Could not forfeit. Try again.';
  } finally {
    if (sceneVersion === version && scene?.key === active.key) {
      submitting = false;
      if (!animating && turn >= scene.battle.turns.length && scene.battle.status === 'active') awaitChoice();
    }
  }
}
function play(next) {
  sceneVersion++;
  cancelAdvance(); clearSkillVisuals();
  animating = false;
  scene = next;
  turn = 0;
  if (!dialog) buildDialog();
  dialog.querySelectorAll('.battle-effects').forEach(label => label.remove());
  submitting = false;
  confirming = false;
  $('battle-close').disabled = false;
  $('battle-error').textContent = '';
  $('battle-skills').hidden = true;
  $('battle-intent').hidden = true;
  const enemy = next.battle.fighters.find(f => f.monster && f.strategy);
  $('battle-strategy').textContent = enemy ? `${fighterName(enemy)}: ${enemy.strategy}` : '';
  $('battle-strategy').hidden = !enemy;
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
  meters(next.battle.initialHp ?? next.battle.fighters.map(f => f.maxHp), next.battle.initialMp ?? next.battle.fighters.map(f => f.maxMp),
    { maxHp: next.battle.initialMaxHp, maxMp: next.battle.initialMaxMp, types: next.battle.initialTypes });
  if (!dialog.open) {
    dialog.showModal();
    $('battle-close').focus({ preventScroll: true });
  }
  syncBattleMotion();
  if (next.manual && !next.battle.turns.length) advance();
  else scheduleAdvance(reducedMotion.matches ? 150 : 400);
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
      cancelAdvance();
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
  sceneVersion++;
  cancelAdvance(); clearSkillVisuals();
  queue.length = 0;
  seen.clear();
  scene = null;
  submitting = false;
  confirming = false;
  motionPaused = false;
  if (dialog?.open) dialog.close();
});
document.addEventListener('battle:dismiss', ({ detail }) => {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].key === detail?.key) queue.splice(i, 1);
  }
  if (scene?.key === detail?.key && dialog?.open) dialog.close();
});
