import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { coinEffect, simulateBattle } from '../src/combat.ts';

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
