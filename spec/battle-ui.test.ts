import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { simulateBattle } from '../src/combat.ts';
it('plays saved HP/MP, skips and replays without posting actions, and clears on logout', () => {
  const dom = new JSDOM('<!doctype html><body><button id="start">Fight</button></body>', { runScripts: 'outside-only' });
  const { window }=dom;
  window.matchMedia=(()=>({matches:true})) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  const $=(id:string)=>window.document.getElementById(id)!;
  try {
    window.eval(readFileSync('public/battle.js','utf8'));
    const a={id:'a',strength:5,intelligence:5,charisma:5};
    const battle=simulateBattle(a,{...a,id:'b'},[24,16]);
    const detail={key:'fight:1',battle,viewer:'a',result:'You won $10.'};
    window.document.dispatchEvent(new window.CustomEvent('battle:show',{detail}));
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect($('battle-hp-text-0').textContent).toBe('15 / 15');
    $('battle-skip').click();
    expect($('battle-hp-text-1').textContent).toBe('0 / 15');
    expect($('battle-mp-text-0').textContent).toBe('5 / 5');
    expect($('battle-status').textContent).toContain('Victory!');
    expect($('battle-log').children).toHaveLength(battle.turns.length);
    $('battle-replay').click();
    expect($('battle-hp-text-1').textContent).toBe('15 / 15');
    window.document.dispatchEvent(new window.CustomEvent('battle:reset'));
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false);
    window.document.dispatchEvent(new window.CustomEvent('battle:show',{detail}));
    $('battle-close').click();
    window.document.dispatchEvent(new window.CustomEvent('battle:show',{detail}));
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false); // response + broadcast cannot open twice
  } finally {window.close();}
});
