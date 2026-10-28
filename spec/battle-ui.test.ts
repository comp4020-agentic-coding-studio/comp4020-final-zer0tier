import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { coinEffect, forfeitBattle, simulateBattle, startBattle, takeBattleTurn, type ActiveBattle } from '../src/combat.ts';

it.each(['hedgehog', 'lizard', 'panda'])('keeps the saved %s model and coat color in battle playback', (appearance) => {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    const pet = { id: 'companion', strength: 5, intelligence: 5, charisma: 5, appearance, color: '#8aa87b' };
    const battle = simulateBattle(pet, { ...pet, id: 'neighbour', appearance: 'cat' }, [24, 16]);
    window.document.dispatchEvent(new window.CustomEvent('battle:show', {
      detail: { key: `new-pet:${appearance}`, battle, viewer: pet.id, result: '' },
    }));
    const avatar = window.document.querySelector<SVGElement>('#battle-avatar-0 svg')!;
    expect(avatar.querySelector('use')?.getAttribute('href')).toBe(`#pet-${appearance}`);
    expect(avatar.style.color).toBe('rgb(138, 168, 123)');
    window.document.getElementById('battle-skip')!.click();
    window.document.getElementById('battle-replay')!.click();
    expect(window.document.querySelector('#battle-avatar-0 use')?.getAttribute('href')).toBe(`#pet-${appearance}`);
  } finally { window.close(); }
});

it('plays saved HP/MP, skips and replays without posting actions, and clears on logout', () => {
  const dom = new JSDOM('<!doctype html><body><button id="start">Fight</button></body>', { runScripts: 'outside-only' });
  const { window }=dom;
  window.matchMedia=(()=>({matches:true})) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  const $=(id:string)=>window.document.getElementById(id)!;
  try {
    window.eval(readFileSync('public/battle.js','utf8'));
    const a={id:'a',strength:5,intelligence:5,charisma:5, abilities: ['firebolt'] as const};
    const battle=simulateBattle(a,{...a,id:'b'},[24,16]);
    const detail={key:'fight:1',battle,viewer:'a',result:'You won $10.'};
    window.document.dispatchEvent(new window.CustomEvent('battle:show',{detail}));
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect($('battle-hp-text-0').textContent).toBe('15 / 15');
    $('battle-skip').click();
    expect($('battle-hp-text-1').textContent).toBe('0 / 15');
    expect($('battle-mp-text-0').textContent).toBe('2 / 5');
    expect($('battle-log').textContent).toContain('Firebolt');
    expect($('battle-log').textContent).toContain('(3 MP)');
    expect($('battle-status').textContent).toContain('Victory!');
    expect($('battle-log').children).toHaveLength(battle.turns.length);
    $('battle-replay').click();
    expect($('battle-mp-text-0').textContent).toBe('5 / 5');
    expect($('battle-hp-text-1').textContent).toBe('15 / 15');
    window.document.dispatchEvent(new window.CustomEvent('battle:reset'));
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false);
    window.document.dispatchEvent(new window.CustomEvent('battle:show',{detail}));
    $('battle-close').click();
    window.document.dispatchEvent(new window.CustomEvent('battle:show',{detail}));
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false); // response + broadcast cannot open twice
  } finally {window.close();}
});

it('shows the saved coin toss, or the coin that replaced it, for the whole battle', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const $ = (id: string) => window.document.getElementById(id)!;
  const rex = { id: 'rex', strength: 5, intelligence: 5, charisma: 5 };
  const slime = { id: 'monster:f1-enemy-0', name: 'Slime', monster: 'slime' as const, strength: 3, intelligence: 1, charisma: 2 };
  const show = (key: string, battle: ReturnType<typeof simulateBattle>) => {
    window.document.dispatchEvent(new window.CustomEvent('battle:show', { detail: { key, battle, viewer: 'rex', result: '' } }));
    return $('battle-initiative');
  };
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    const cases: [string | null, number, string][] = [
      [null, 0.49, 'Coin toss: Heads. rex attacks first.'],
      [null, 0.5, 'Coin toss: Tails. Slime attacks first.'],
      ['copper-coin', 0.49, "Coin toss: Heads. rex attacks first. rex's Copper Coin adds +1 to every attribute."],
      ['silver-coin', 0.5, "rex's Silver Coin: rex attacks first."],
      ['gold-coin', 0.49, "rex's Gold Coin: Slime attacks first, but rex's first hit deals double damage."],
    ];
    for (const [coin, random, text] of cases) {
      const line = show(`${coin}-${random}`, simulateBattle(rex, slime, [20, 9], coinEffect(coin as never, () => random)));
      expect(line.hidden).toBe(false);
      expect(line.textContent).toBe(text);
      expect($('battle-dialog').getAttribute('aria-describedby')).toContain('battle-initiative'); // read out on opening
      $('battle-skip').click();
      expect(line.textContent).toBe(text); // still shown once the result is in
      $('battle-close').click();
    }
    const older = show('older', simulateBattle(rex, slime, [20, 9]));
    expect(older.hidden).toBe(true);
    expect($('battle-status').textContent).toBe('Ready. Let the battle begin!');
  } finally { window.close(); }
});

it('withholds Adventure replay and attack records until the finished-run scene explicitly enables them', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const $ = (id: string) => window.document.getElementById(id)!;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    const pet = { id: 'explorer', strength: 5, intelligence: 5, charisma: 5 };
    const battle = simulateBattle(pet, { ...pet, id: 'monster:slime', name: 'Slime' }, [24, 16]);
    const detail = { key: 'adventure:live', battle, viewer: pet.id, result: '', allowReplay: false, showLog: false };
    window.document.dispatchEvent(new window.CustomEvent('battle:show', { detail }));
    $('battle-skip').focus();
    $('battle-skip').click();
    expect($('battle-replay').hidden).toBe(true);
    expect($('battle-log').closest('details')!.hidden).toBe(true);
    expect($('battle-log').children).toHaveLength(0);
    expect(window.document.activeElement?.id).toBe('battle-close');
    const result = $('battle-status').textContent;
    $('battle-replay').click();
    expect($('battle-status').textContent).toBe(result);
    $('battle-close').click();

    window.document.dispatchEvent(new window.CustomEvent('battle:show', { detail: {
      ...detail, key: 'adventure:record', allowReplay: true, showLog: true, replay: true,
    } }));
    $('battle-skip').click();
    expect($('battle-replay').hidden).toBe(false);
    expect($('battle-log').closest('details')!.hidden).toBe(false);
    expect($('battle-log').children).toHaveLength(battle.turns.length);
    $('battle-replay').click();
    expect($('battle-hp-text-1').textContent).toBe('15 / 15');
  } finally { window.close(); }
});

function manualScene() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  window.setTimeout = ((callback: () => void) => { timers.set(++timerId, callback); return timerId; }) as typeof window.setTimeout;
  window.clearTimeout = (id: number | undefined) => { if (id !== undefined) timers.delete(id); };
  window.eval(readFileSync('public/battle.js', 'utf8'));
  const $ = (id: string) => window.document.getElementById(id)!;
  const show = (battle: ActiveBattle, extra: Record<string, unknown> = {}) => window.document.dispatchEvent(new window.CustomEvent('battle:show', {
    detail: { key: 'manual:test', battle, viewer: 'pet', manual: true, result: '', ...extra },
  }));
  function flush() {
    let limit = 100;
    while (timers.size && limit-- > 0) {
      const [id, callback] = timers.entries().next().value!;
      timers.delete(id); callback();
    }
    expect(timers.size).toBe(0);
  }
  const skill = (id: string) => window.document.querySelector<HTMLButtonElement>(`[data-skill="${id}"]`)!;
  return { window, $, show, flush, skill, timers, close: () => window.close() };
}
const manualPet = {
  id: 'pet', strength: 5, intelligence: 6, charisma: 20,
  equippedCoin: 'silver-coin' as const, equippedAbilities: ['firebolt', 'heavy-strike'] as const,
};
const manualRival = { id: 'rival', strength: 4, intelligence: 4, charisma: 14 };
const manualBattle = () => startBattle([manualPet], manualRival, [36, 26], { mp: [2, 4], random: () => 0 });
const microtasks = async () => { await Promise.resolve(); await Promise.resolve(); };

it('clears live buff labels when the battle ends or another playback opens', () => {
  const scene = manualScene();
  try {
    const pet = { ...manualPet, equippedAbilities: ['gym-pump'] as const };
    const battle = startBattle([pet], manualRival, [36, 26], { random: () => 0 });
    const buffed = takeBattleTurn(battle, 'pet', 'gym-pump', battle.revision);
    if ('error' in buffed) throw new Error(buffed.error);
    scene.show(buffed); scene.flush();
    expect(scene.$('battle-effects-0').textContent).toContain('STR +25%');
    // A reset can open a different replay using the same fighter cards.
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:reset'));
    scene.show(battle, { key: 'replay:other', manual: false, replay: true });
    expect(scene.window.document.querySelectorAll('.battle-effects')).toHaveLength(0);
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:reset'));
    scene.show(buffed); scene.flush();
    const ended = forfeitBattle(buffed, 'pet', buffed.revision);
    if ('error' in ended) throw new Error(ended.error);
    scene.show(ended); scene.flush();
    expect(scene.window.document.querySelectorAll('.battle-effects')).toHaveLength(0);
  } finally { scene.close(); }
});

it('uses effect time for team buff countdowns after knocked-out slots are skipped', () => {
  const scene = manualScene();
  try {
    const pet = { ...manualPet, strength: 50, intelligence: 50, charisma: 50, equippedAbilities: ['gym-pump', 'coffee-break'] as const };
    const ally = { ...manualRival, strength: 1, intelligence: 1, charisma: 1 };
    const monster = { ...manualRival, id: 'monster', strength: 500, monster: 'slime' as const };
    let b = startBattle([pet, { ...ally, id: 'ally1' }, { ...ally, id: 'ally2' }], monster, [200, 4, 4, 0],
      { hp: [160, 0, 0, 1510], random: () => 0 });
    for (const skill of ['gym-pump', 'coffee-break']) {
      const next = takeBattleTurn(b, 'pet', skill, b.revision, () => 0);
      if ('error' in next) throw new Error(next.error);
      b = next;
    }
    scene.show(b); scene.flush();
    expect(scene.$('battle-effects-0').textContent).toContain('STR +25% (2 turns)');
  } finally { scene.close(); }
});

it('opens a live battle with zero attacks, waits indefinitely for a choice, and exposes no live replay, skip or attack log', () => {
  const scene = manualScene();
  try {
    let requests = 0;
    const battle = manualBattle();
    scene.show(battle, { onChoose: () => { requests++; } });
    scene.flush();
    expect((scene.$('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect(scene.$('battle-status').textContent).toBe('What will your pet do?');
    expect(scene.$('battle-hp-text-0').textContent).toBe('25 / 25');
    expect(scene.$('battle-hp-text-1').textContent).toBe('22 / 22');
    expect(scene.$('battle-skip').hidden).toBe(true);
    expect(scene.$('battle-replay').hidden).toBe(true);
    expect(scene.$('battle-log').closest('details')!.hidden).toBe(true);
    expect(requests).toBe(0);
    expect(battle.turns).toHaveLength(0);
    scene.$('battle-skip').click();
    scene.$('battle-replay').click();
    scene.flush();
    expect(scene.$('battle-status').textContent).toBe('What will your pet do?');
    expect(scene.$('battle-skills').hidden).toBe(false);
    expect(scene.$('battle-log').children).toHaveLength(0);
    expect(requests).toBe(0);
  } finally { scene.close(); }
});

it('submits only the selected affordable skill with its saved revision and waits for server-confirmed resources', async () => {
  const scene = manualScene();
  try {
    const battle = manualBattle(), requests: unknown[][] = [];
    let release!: () => void;
    const onChoose = (ability: string, revision: number) => {
      requests.push([ability, revision]);
      return new Promise<void>(resolve => { release = resolve; });
    };
    scene.show(battle, { onChoose });
    expect(scene.skill('firebolt').disabled).toBe(true);
    expect(scene.skill('firebolt').textContent).toContain('Not enough MP');
    expect(scene.skill('heavy-strike').disabled).toBe(false);
    scene.skill('firebolt').click();
    expect(requests).toEqual([]);
    scene.skill('heavy-strike').click();
    scene.skill('claw-strike').click();
    expect(requests).toEqual([['heavy-strike', 0]]);
    expect(scene.$('battle-skills').getAttribute('aria-busy')).toBe('true');
    expect(scene.skill('claw-strike').disabled).toBe(true);
    expect(scene.$('battle-hp-text-1').textContent).toBe('22 / 22');
    expect(scene.$('battle-mp-text-0').textContent).toBe('2 / 5');
    const updated = takeBattleTurn(battle, 'pet', 'heavy-strike', 0);
    if ('error' in updated) throw new Error(updated.error);
    scene.show(updated, { onChoose });
    release();
    await microtasks();
    scene.flush();
    expect(scene.$('battle-mp-text-0').textContent).toBe('0 / 5');
    expect(scene.$('battle-hp-text-1').textContent).toBe('14 / 22');
    expect(scene.$('battle-status').textContent).toContain('Waiting for rival');
    expect(scene.skill('claw-strike').disabled).toBe(true);
    expect(scene.$('battle-log').children).toHaveLength(0);
  } finally { scene.close(); }
});

it('waits for the opponent and animates only newly saved turns without replaying duplicate or stale updates', () => {
  const scene = manualScene();
  try {
    const rival = { ...manualRival, charisma: 40, equippedCoin: 'silver-coin' as const };
    const battle = startBattle([manualPet], rival, [36, 52]);
    let requests = 0;
    const handlers = { onChoose: () => { requests++; } };
    scene.show(battle, handlers);
    expect(scene.$('battle-status').textContent).toContain('Waiting for rival');
    expect(scene.skill('claw-strike').disabled).toBe(true);
    scene.skill('claw-strike').click();
    expect(requests).toBe(0);
    const updated = takeBattleTurn(battle, 'rival', 'claw-strike', 0);
    if ('error' in updated) throw new Error(updated.error);
    scene.show(updated, handlers);
    expect(scene.$('battle-status').textContent).toContain('rival used Claw Strike');
    expect(scene.timers.size).toBe(1);
    scene.show(updated, handlers); // the same turn arriving over HTTP and WebSocket
    expect(scene.$('battle-status').textContent).toContain('rival used Claw Strike');
    expect(scene.timers.size).toBe(1);
    scene.flush();
    expect(scene.$('battle-status').textContent).toBe('What will your pet do?');
    expect(scene.$('battle-hp-text-0').textContent).toBe('21 / 25');
    expect(scene.skill('claw-strike').disabled).toBe(false);
    scene.show(updated, handlers);
    expect(scene.timers.size).toBe(0);
    expect(scene.$('battle-status').textContent).toBe('What will your pet do?');
    scene.show(battle, handlers);
    expect(scene.$('battle-hp-text-0').textContent).toBe('21 / 25');
    expect(scene.$('battle-status').textContent).toBe('What will your pet do?');
    expect(requests).toBe(0);
  } finally { scene.close(); }
});

it('asks the game confirmation before forfeiting by button or Escape and renders the final authoritative HP', async () => {
  const scene = manualScene();
  try {
    const battle = manualBattle(), forfeits: number[] = [];
    let answer!: (yes: boolean) => void;
    scene.window.document.addEventListener('confirm:ask', event => {
      const detail = (event as CustomEvent).detail;
      expect(detail.title).toBe('Forfeit this battle?');
      answer = detail.answer;
    });
    const onForfeit = (revision: number) => { forfeits.push(revision); };
    scene.show(battle, { onForfeit });
    scene.$('battle-close').click();
    expect(forfeits).toEqual([]);
    expect((scene.$('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect((scene.$('battle-close') as HTMLButtonElement).disabled).toBe(true);
    answer(false); await microtasks();
    expect(forfeits).toEqual([]);
    expect((scene.$('battle-close') as HTMLButtonElement).disabled).toBe(false);
    const cancel = new scene.window.Event('cancel', { cancelable: true });
    scene.$('battle-dialog').dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    answer(true); await microtasks();
    expect(forfeits).toEqual([battle.revision]);
    const ended = forfeitBattle(battle, 'pet', battle.revision);
    if ('error' in ended) throw new Error(ended.error);
    scene.show(ended, { onForfeit, result: 'Your pet withdrew.' });
    scene.flush();
    expect(scene.$('battle-hp-text-0').textContent).toBe('0 / 25');
    expect(scene.$('battle-status').textContent).toContain('Defeat. Your pet withdrew.');
    expect(scene.$('battle-skills').hidden).toBe(true);
    expect(scene.$('battle-replay').hidden).toBe(true);
    scene.$('battle-close').click();
    expect((scene.$('battle-dialog') as HTMLDialogElement).open).toBe(false);
  } finally { scene.close(); }
});

it('identifies the actual stronger defender and cooperative teammate as the saved coin provider', () => {
  const scene = manualScene();
  try {
    const stronger = { ...manualRival, charisma: 40, equippedCoin: 'gold-coin' as const };
    scene.show(startBattle([manualPet], stronger, [36, 52]));
    expect(scene.$('battle-initiative').textContent).toBe("rival's Gold Coin: pet attacks first, but rival's first hit deals double damage.");
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:reset'));
    const monster = { id: 'monster:slime', name: 'Slime', monster: 'slime' as const, strength: 2, intelligence: 1, charisma: 30 };
    scene.show(startBattle([manualPet, { ...stronger, equippedCoin: 'silver-coin' }], monster, [36, 52, 35]));
    expect(scene.$('battle-initiative').textContent).toBe("rival's Silver Coin: rival's team attacks first.");
    expect(scene.$('battle-name-2').textContent).toBe('rival');
  } finally { scene.close(); }
});

it('keeps the newest saved state when a live battle is queued behind another battle window', () => {
  const scene = manualScene();
  try {
    const old = forfeitBattle(manualBattle(), 'pet');
    if ('error' in old) throw new Error(old.error);
    scene.show(old, { key: 'manual:old' });
    scene.flush();
    const queued = manualBattle();
    scene.show(queued, { key: 'manual:queued' });
    const finished = forfeitBattle(queued, 'rival');
    if ('error' in finished) throw new Error(finished.error);
    scene.show(finished, { key: 'manual:queued', result: 'Your opponent withdrew.' });
    scene.show(queued, { key: 'manual:queued' }); // a delayed older response
    scene.$('battle-close').click();
    scene.flush();
    expect((scene.$('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect(scene.$('battle-status').textContent).toBe('Victory! Your opponent withdrew.');
    expect(scene.$('battle-hp-text-1').textContent).toBe('0 / 22');
    expect(scene.$('battle-skills').hidden).toBe(true);
    expect(scene.$('battle-close').textContent).toBe('Close');
  } finally { scene.close(); }
});

it('shows dynamic types, acquisition-era skills, costs, restrictions and status effects', () => {
  const scene = manualScene();
  try {
    const caster = { id: 'pet', strength: 20, intelligence: 40, charisma: 20, equippedCoin: 'silver-coin' as const,
      abilities: ['paperplane-dart', 'mana-barrier', 'golden-ratio'] as const };
    const slime = { id: 'monster:slime', name: 'Slime', monster: 'slime' as const, strength: 50, intelligence: 1, charisma: 1 };
    const battle = startBattle([caster], slime, [120, 102], { mp: [12, 5], random: () => 0 });
    scene.show(battle);
    expect(scene.$('battle-type-1').textContent).toBe('STR type');
    expect(scene.$('battle-type-0').textContent).toBe('INT type');
    expect(scene.skill('paperplane-dart').textContent).toContain('Type advantage');
    expect(scene.skill('paperplane-dart').textContent).toContain('Sure-hit');
    expect(scene.skill('golden-ratio').disabled).toBe(true);
    expect(scene.skill('golden-ratio').textContent).toContain('Requires balanced Normal stats');
    const updated = takeBattleTurn(battle, 'pet', 'mana-barrier', 0, () => 0);
    if ('error' in updated) throw new Error(updated.error);
    scene.show(updated); scene.flush();
    expect(scene.$('battle-effects-0').textContent).toContain('Mana Barrier');
    expect(scene.$('battle-mp-text-0').textContent).toBe(`${updated.mp[0]} / 12`);
  } finally { scene.close(); }
});

it.each(['success', 'failure'])('ignores a delayed move %s after the same battle is reopened', async outcome => {
  const scene = manualScene();
  try {
    let settleOld!: () => void, settleNew!: () => void, newRequests = 0;
    const b = manualBattle();
    scene.show(b, { onChoose: () => new Promise<void>((resolve, reject) => {
      settleOld = () => outcome === 'success' ? resolve() : reject(new Error('Old connection failed'));
    }) });
    scene.skill('heavy-strike').click();
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:reset'));
    // Signing back in can reopen the same saved battle key before its old
    // request settles. The new window has its own request in flight.
    scene.show(b, { onChoose: () => { newRequests++; return new Promise<void>(resolve => { settleNew = resolve; }); } });
    scene.skill('heavy-strike').click();
    settleOld(); await microtasks();
    expect(scene.skill('heavy-strike').disabled).toBe(true);
    expect(scene.$('battle-skills').getAttribute('aria-busy')).toBe('true');
    expect(scene.$('battle-error').textContent).toBe('');
    scene.skill('heavy-strike').click();
    expect(newRequests).toBe(1);
    settleNew(); await microtasks();
    expect(scene.skill('heavy-strike').disabled).toBe(false);
  } finally { scene.close(); }
});

it('cannot apply an old forfeit confirmation to a reopened battle', async () => {
  const scene = manualScene();
  try {
    let answerOld!: (yes: boolean) => void, forfeits = 0;
    scene.window.document.addEventListener('confirm:ask', event => { answerOld = (event as CustomEvent).detail.answer; });
    const b = manualBattle();
    scene.show(b, { onForfeit: () => { forfeits++; } });
    scene.$('battle-close').click();
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:reset'));
    scene.show(b, { onForfeit: () => { forfeits++; } });
    answerOld(true); await microtasks();
    expect(forfeits).toBe(0);
    expect(scene.skill('heavy-strike').disabled).toBe(false);
    expect((scene.$('battle-close') as HTMLButtonElement).disabled).toBe(false);
  } finally { scene.close(); }
});

it('ignores a delayed forfeit response while a reopened battle is submitting a move', async () => {
  const scene = manualScene();
  try {
    let failOld!: (error: Error) => void, settleNew!: () => void;
    scene.window.document.addEventListener('confirm:ask', event => { (event as CustomEvent).detail.answer(true); });
    const b = manualBattle();
    scene.show(b, { onForfeit: () => new Promise<void>((_resolve, reject) => { failOld = reject; }) });
    scene.$('battle-close').click(); await microtasks();
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:reset'));
    scene.show(b, { onChoose: () => new Promise<void>(resolve => { settleNew = resolve; }) });
    scene.skill('heavy-strike').click();
    failOld(new Error('Old forfeit failed')); await microtasks();
    expect(scene.skill('heavy-strike').disabled).toBe(true);
    expect(scene.$('battle-error').textContent).toBe('');
    settleNew(); await microtasks();
    expect(scene.skill('heavy-strike').disabled).toBe(false);
  } finally { scene.close(); }
});

it.each([false, true])('removes a dismissed queued battle and preserves other queued battles (%s)', hasNext => {
  const scene = manualScene();
  try {
    const b = manualBattle();
    scene.show(b, { key: 'replay:previous', manual: false, replay: true });
    scene.show(b, { key: 'adventure:obsolete' });
    if (hasNext) scene.show(b, { key: 'session:next', title: 'Next arena battle' });
    scene.window.document.dispatchEvent(new scene.window.CustomEvent('battle:dismiss', { detail: { key: 'adventure:obsolete' } }));
    scene.$('battle-close').click();
    expect((scene.$('battle-dialog') as HTMLDialogElement).open).toBe(hasNext);
    if (hasNext) expect(scene.$('battle-title').textContent).toBe('Next arena battle');
    expect(scene.timers.size).toBe(0);
  } finally { scene.close(); }
});
