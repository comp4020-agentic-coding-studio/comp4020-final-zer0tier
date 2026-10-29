import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import { startBattle, takeBattleTurn, type ActiveBattle } from '../src/combat.ts';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(reduce = false) {
  const { window } = new JSDOM('<!doctype html><body><svg hidden><symbol id="pet-cat"></symbol><symbol id="pet-dog"></symbol></svg></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const preference = { matches: reduce, addEventListener: vi.fn() };
  window.matchMedia = (() => preference) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  let clock = 0, timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  window.performance.now = () => clock;
  window.setTimeout = ((callback: () => void, delay = 0) => { timers.set(++timerId, { at: clock + delay, callback }); return timerId; }) as typeof window.setTimeout;
  window.clearTimeout = (id: number | undefined) => { if (id !== undefined) timers.delete(id); };
  const advance = (milliseconds: number) => {
    const until = clock + milliseconds;
    for (let i = 0; i < 100; i++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      timers.delete(next[0]); clock = next[1].at; next[1].callback();
    }
    clock = until;
  };
  const pet = { id: 'owner', appearance: 'cat', color: '#8855aa', strength: 20, intelligence: 20, charisma: 20, equippedCoin: 'silver-coin' as const };
  const battle = startBattle([pet], { ...pet, id: 'rival', appearance: 'dog', equippedCoin: null }, [80, 80], { random: () => 0 });
  const choose = vi.fn(), forfeit = vi.fn(), cues = vi.fn();
  window.document.addEventListener('battle:sound', cues);
  window.eval(readFileSync('public/battle.js', 'utf8'));
  const $ = (id: string) => window.document.getElementById(id)!;
  const show = (next: ActiveBattle = battle, extra: Record<string, unknown> = {}) => window.document.dispatchEvent(new window.CustomEvent('battle:show', {
    detail: { key: 'opening:1', battle: next, viewer: 'owner', manual: true, onChoose: choose, onForfeit: forfeit, ...extra },
  }));
  const visible = (shown: boolean) => {
    Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: shown ? 'visible' : 'hidden' });
    Object.defineProperty(window.document, 'hidden', { configurable: true, value: !shown });
    window.document.dispatchEvent(new window.Event('visibilitychange'));
  };
  const reduced = () => { preference.matches = true; preference.addEventListener.mock.calls[0][1](); };
  return { window, $, battle, show, advance, timers, choose, forfeit, cues, visible, reduced, close: () => window.close() };
}

it('opens with the saved pet artwork and a focused skip control, then offers skills without taking a turn', () => {
  const p = setup();
  try {
    p.show();
    expect(p.$('battle-dialog').dataset.opening).toBe('true');
    expect(p.$('battle-opening').hidden).toBe(false);
    expect(p.window.document.activeElement).toBe(p.$('battle-opening-skip'));
    expect(p.$('battle-skills').inert).toBe(true);
    expect(p.$('battle-close').parentElement!.inert).toBe(true);
    expect([...p.$('battle-opening-fighters').querySelectorAll('use')].map(node => node.getAttribute('href'))).toEqual(['#pet-cat', '#pet-dog']);
    expect(p.$('battle-opening-fighters').textContent).toBe('ownerVSrival');
    p.advance(1499);
    expect(p.$('battle-dialog').dataset.opening).toBe('true');
    expect(p.cues).not.toHaveBeenCalled();
    p.advance(1);
    expect(p.$('battle-opening').hidden).toBe(true);
    expect(p.$('battle-opening-fighters').children).toHaveLength(0);
    expect(p.$('battle-skills').inert).toBe(false);
    expect(p.$('battle-mode').textContent).toContain('Your move');
    expect((p.window.document.activeElement as HTMLElement).dataset.skill).toBe('claw-strike');
    expect(p.choose).not.toHaveBeenCalled(); expect(p.forfeit).not.toHaveBeenCalled();
    expect(p.battle.turns).toHaveLength(0);
  } finally { p.close(); }
});

it.each(['Enter', ' ', 'Escape', 'button', 'cancel'])('skips with %s without choosing a move or forfeiting', input => {
  const p = setup();
  try {
    p.show();
    if (input === 'button') p.$('battle-opening-skip').click();
    else if (input === 'cancel') p.$('battle-dialog').dispatchEvent(new p.window.Event('cancel', { cancelable: true }));
    else p.$('battle-opening-skip').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: input, bubbles: true, cancelable: true }));
    expect(p.$('battle-opening').hidden).toBe(true);
    expect((p.$('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('battle-status').textContent).toContain('What will your pet do?');
    expect(p.choose).not.toHaveBeenCalled(); expect(p.forfeit).not.toHaveBeenCalled();
    p.advance(3000);
    expect(p.cues).not.toHaveBeenCalled();
  } finally { p.close(); }
});

it('keeps the original opening deadline and queues saved turns received during it', () => {
  const p = setup();
  try {
    p.show(); p.advance(600); p.show();
    const saved = takeBattleTurn(p.battle, 'owner', 'claw-strike', p.battle.revision, () => 0);
    if ('error' in saved) throw new Error(saved.error);
    p.show(saved); p.show(saved);
    p.advance(899);
    expect(p.cues).not.toHaveBeenCalled();
    expect(p.$('battle-opening').hidden).toBe(false);
    p.advance(1);
    expect(p.cues).toHaveBeenCalledTimes(1);
    expect(p.$('battle-status').textContent).toContain('Claw Strike');
    p.advance(1000); p.show(saved);
    expect(p.cues).toHaveBeenCalledTimes(1);
    expect(p.choose).not.toHaveBeenCalled();
  } finally { p.close(); }
});

it('consumes the skip key release and held-key repeats after focus moves to a skill', () => {
  const p = setup();
  try {
    for (const key of [' ', 'Enter', 'Escape']) {
      p.window.document.dispatchEvent(new p.window.CustomEvent('battle:reset'));
      p.show();
      p.$('battle-opening-skip').dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const skill = p.window.document.activeElement!;
      const repeat = new p.window.KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true });
      skill.dispatchEvent(repeat); expect(repeat.defaultPrevented).toBe(true);
      const release = new p.window.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true });
      skill.dispatchEvent(release); expect(release.defaultPrevented).toBe(true);
      expect(p.choose).not.toHaveBeenCalled(); expect(p.forfeit).not.toHaveBeenCalled();
    }
  } finally { p.close(); }
});

it.each(['tab', 'dialog'])('pauses the opening while covered by a %s and resumes the remaining time', async cover => {
  const p = setup();
  try {
    p.show(); p.advance(400);
    const other = p.window.document.createElement('dialog');
    p.window.document.body.append(other);
    if (cover === 'tab') p.visible(false); else other.showModal();
    await flush();
    expect(p.$('battle-dialog').classList.contains('battle-motion-paused')).toBe(true);
    p.advance(10000);
    expect(p.$('battle-opening').hidden).toBe(false);
    if (cover === 'tab') p.visible(true); else other.close();
    await flush(); p.advance(1099);
    expect(p.$('battle-opening').hidden).toBe(false);
    p.advance(1);
    expect(p.$('battle-opening').hidden).toBe(true);
    expect(p.cues).not.toHaveBeenCalled();
  } finally { p.close(); }
});

it('bypasses the opening for reduced motion and cancels it when that preference changes', () => {
  for (const reduced of [true, false]) {
    const p = setup(reduced);
    try {
      p.show();
      if (!reduced) { p.advance(300); p.reduced(); }
      expect(p.$('battle-opening').hidden).toBe(true);
      expect(p.$('battle-skills').hidden).toBe(false);
      expect(p.$('battle-skills').inert).not.toBe(true);
      p.advance(3000);
      expect(p.cues).not.toHaveBeenCalled();
    } finally { p.close(); }
  }
});

it.each(['battle:reset', 'battle:dismiss'])('clears the opening on %s and keeps a subsequent battle usable', type => {
  const p = setup();
  try {
    p.show(); p.advance(300);
    p.window.document.dispatchEvent(new p.window.CustomEvent(type, { detail: { key: 'opening:1' } }));
    expect((p.$('battle-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.$('battle-opening').hidden).toBe(true);
    expect(p.timers.size).toBe(0);
    expect(p.$('battle-skills').inert).toBe(false);
    p.show(p.battle, { key: 'opening:2' }); p.advance(1499);
    expect(p.$('battle-opening').hidden).toBe(false);
    p.advance(1); expect(p.$('battle-skills').hidden).toBe(false);
  } finally { p.close(); }
});

it('plays an opening for the next queued encounter but opens saved replays directly', () => {
  const p = setup();
  try {
    p.show(); p.show(p.battle, { key: 'opening:queued', title: 'Next encounter' });
    (p.$('battle-dialog') as HTMLDialogElement).close();
    expect(p.$('battle-opening').hidden).toBe(false);
    expect(p.$('battle-opening-title').textContent).toBe('Next encounter');
    p.advance(1500);
    (p.$('battle-dialog') as HTMLDialogElement).close();
    p.show(p.battle, { key: 'replay:1', manual: false, replay: true });
    expect(p.$('battle-opening').hidden).toBe(true);
    expect(p.$('battle-skip').hidden).toBe(false);
  } finally { p.close(); }
});

it('introduces the viewing teammate against the saved monster in a shared encounter', () => {
  const p = setup();
  try {
    const monsterSymbol = p.window.document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    monsterSymbol.id = 'monster-slime'; p.$('pet-cat').parentElement!.append(monsterSymbol);
    const pet = { id: 'leader', strength: 20, intelligence: 20, charisma: 20, appearance: 'cat', equippedCoin: 'silver-coin' as const };
    const ally = { ...pet, id: 'owner', appearance: 'dog' };
    const monster = { id: 'wild-slime', name: 'Meadow Slime', monster: 'slime' as const, strength: 3, intelligence: 1, charisma: 2 };
    p.show(startBattle([pet, ally], monster, [60, 60, 6], { random: () => 0 }), { encounter: 'grass', title: 'Tall grass encounter' });
    expect(p.$('battle-opening-kind').textContent).toBe('Wild encounter');
    expect(p.$('battle-opening-title').textContent).toBe('Tall grass encounter');
    expect([...p.$('battle-opening-fighters').querySelectorAll('use')].map(node => node.getAttribute('href'))).toEqual(['#pet-dog', '#monster-slime']);
    expect(p.$('battle-opening-fighters').textContent).toBe('ownerVSMeadow Slime');
    p.advance(1500);
    expect(p.choose).not.toHaveBeenCalled(); expect(p.forfeit).not.toHaveBeenCalled();
  } finally { p.close(); }
});
