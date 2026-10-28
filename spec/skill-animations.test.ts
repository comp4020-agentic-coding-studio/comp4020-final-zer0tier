import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import { SKILLS } from '../src/skills.ts';
import { startBattle, takeBattleTurn, type ActiveBattle, type AbilityId } from '../src/combat.ts';

const pet = { id: 'pet', strength: 50, charisma: 50, intelligence: 50, equippedCoin: 'silver-coin' as const,
  abilities: SKILLS.map(skill => skill.id) };
const rival = { id: 'rival', strength: 500, charisma: 50, intelligence: 50, equippedCoin: 'gold-coin' as const, abilities: ['coffee-break'] as const };
const power = (p: typeof rival | typeof pet) => 2 * p.strength + p.charisma + p.intelligence;
const initial = () => startBattle([pet], rival, [power(pet), power(rival)], { random: () => 0 });
function move(battle: ActiveBattle, skill: AbilityId, random = () => 0) {
  const next = takeBattleTurn(battle, battle.fighters[battle.actor!].id, skill, battle.revision, random);
  if ('error' in next) throw new Error(next.error);
  return next;
}
function screen(reduce = false) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const preference = { matches: reduce, addEventListener: vi.fn() };
  window.matchMedia = (() => preference) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  window.setTimeout = ((callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }) as typeof window.setTimeout;
  window.clearTimeout = (id: number | undefined) => { if (id !== undefined) timers.delete(id); };
  const animations: { cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> }[] = [];
  window.HTMLElement.prototype.animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), pause: vi.fn(), play: vi.fn() }; animations.push(animation);
    return animation as unknown as Animation;
  });
  window.eval(readFileSync('public/battle.js', 'utf8'));
  const $ = (selector: string) => window.document.querySelector<HTMLElement>(selector)!;
  const show = (battle: ActiveBattle, extra = {}) => window.document.dispatchEvent(new window.CustomEvent('battle:show', {
    detail: { key: 'animations', battle, viewer: 'pet', manual: true, result: '', ...extra },
  }));
  function tick() {
    const entry = timers.entries().next().value;
    if (!entry) return;
    const [id, callback] = entry; timers.delete(id); callback();
  }
  const reset = () => window.document.dispatchEvent(new window.CustomEvent('battle:reset'));
  return { window, $, show, tick, timers, animations, preference, reset, close: () => window.close() };
}

it('gives all 30 skills distinct artwork and motion, with effects anchored to the correct fighters', () => {
  const s = screen();
  const art = new Set<string>(), motions = new Set<string>();
  const self = new Set(['gym-pump', 'hardhat-guard', 'makeover-glow', 'phantom-perfume', 'standing-ovation', 'peer-review', 'mana-barrier', 'coffee-break']);
  try {
    for (const skill of SKILLS) {
      s.reset();
      const before = initial(); s.show(before);
      const after = move(before, skill.id); s.show(after);
      const effects = [...s.window.document.querySelectorAll<HTMLElement>('.skill-vfx')];
      expect(effects).toHaveLength(skill.id === 'equalizer-field' ? 2 : 1);
      expect(effects[0].dataset.skill).toBe(skill.id);
      expect(effects[0].getAttribute('aria-hidden')).toBe('true');
      art.add(effects[0].innerHTML); motions.add(effects[0].dataset.motion!);
      if (skill.id !== 'equalizer-field') expect(effects[0].parentElement!.id).toBe(`battle-avatar-${self.has(skill.id) ? 0 : 1}`);
      expect(s.$('#battle-status').textContent).toContain(skill.name);
      expect(s.$('#battle-hp-text-0').textContent).toBe(`${after.hp[0]} / ${after.fighters[0].maxHp}`);
      // Identical HTTP and socket responses cannot add effects or timers.
      s.show(after);
      expect(s.window.document.querySelectorAll('.skill-vfx')).toHaveLength(effects.length);
      expect(s.timers.size).toBe(1);
      s.tick();
      expect(s.window.document.querySelector('.skill-vfx')).toBeNull();
      expect(s.window.document.querySelector('.battle-cue')).toBeNull();
      expect(s.timers.size).toBe(0);
    }
    expect(art.size).toBe(30); expect(motions.size).toBe(30);
    const css = readFileSync('public/battle.css', 'utf8');
    for (const motion of motions) expect(css).toContain(`@keyframes fx-${motion}`);
  } finally { s.close(); }
});

it('shows misses without damage cues and moves support effects to the caster on either side', () => {
  const s = screen();
  try {
    let b = initial(); s.show(b);
    b = move(b, 'humble-pie', () => .999); s.show(b);
    expect(s.$('.skill-vfx').classList.contains('is-miss')).toBe(true);
    expect(s.$('.battle-cue').textContent).toBe('Miss');
    expect(s.$('.battle-cue').dataset.outcome).toBe('miss');
    expect(b.turns[0].damage).toBe(0);
    s.tick(); b = move(b, 'coffee-break'); s.show(b);
    expect(s.$('.skill-vfx').parentElement!.id).toBe('battle-avatar-1');
    expect(s.$('.battle-cue').textContent).toBe('MP ↑');
  } finally { s.close(); }
});

it('keeps reduced-motion feedback static and responds when the preference changes mid-turn', () => {
  const s = screen(true);
  try {
    let b = initial(); s.show(b); s.show(move(b, 'titans-relic-press'));
    expect(s.$('.skill-vfx').classList.contains('is-still')).toBe(true);
    expect(s.animations).toHaveLength(0);
    expect(s.$('#battle-status').textContent).toContain('Titan');
    s.reset(); s.preference.matches = false;
    b = initial(); s.show(b); s.show(move(b, 'titans-relic-press'));
    expect(s.animations).toHaveLength(2);
    s.preference.matches = true;
    s.preference.addEventListener.mock.calls[0][1]();
    expect(s.animations.every(a => a.cancel.mock.calls.length > 0)).toBe(true);
    expect(s.$('.skill-vfx').classList.contains('is-still')).toBe(true);
    s.tick(); expect(s.timers.size).toBe(0);
  } finally { s.close(); }
});

it('pauses turn playback and portrait motion while hidden or covered, then resumes once', async () => {
  const s = screen();
  try {
    const b = initial(); s.show(b); s.show(move(b, 'gym-pump'));
    Object.defineProperty(s.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    s.window.document.dispatchEvent(new s.window.Event('visibilitychange'));
    expect(s.timers.size).toBe(0);
    expect(s.$('#battle-dialog').classList.contains('battle-motion-paused')).toBe(true);
    expect(s.animations[0].pause).toHaveBeenCalledTimes(1);
    Object.defineProperty(s.window.document, 'visibilityState', { configurable: true, value: 'visible' });
    s.window.document.dispatchEvent(new s.window.Event('visibilitychange'));
    expect(s.timers.size).toBe(1);
    expect(s.animations[0].play).toHaveBeenCalledTimes(1);
    const cover = s.window.document.createElement('dialog');
    cover.innerHTML = '<button>Continue</button>'; s.window.document.body.append(cover); cover.open = true;
    cover.querySelector('button')!.focus();
    await Promise.resolve();
    expect(s.timers.size).toBe(0);
    cover.open = false; s.$('#battle-close').focus();
    await Promise.resolve();
    expect(s.timers.size).toBe(1);
    s.tick();
    expect(s.window.document.querySelector('.skill-vfx')).toBeNull();
    expect(s.$('#battle-status').textContent).toContain('Waiting for rival');
  } finally { s.close(); }
});

it('cancels effects on replay skip, close and reset', () => {
  const s = screen();
  try {
    const b = move(initial(), 'golden-ratio');
    for (const exit of ['skip', 'close', 'reset']) {
      s.reset(); s.show(b, { manual: false, replay: true }); s.tick();
      expect(s.$('.skill-vfx')).not.toBeNull();
      if (exit === 'reset') s.reset();
      else s.$(`#battle-${exit}`).click();
      expect(s.window.document.querySelector('.skill-vfx')).toBeNull();
      expect(s.timers.size).toBe(0);
    }
    expect(s.animations.every(a => a.cancel.mock.calls.length > 0)).toBe(true);
  } finally { s.close(); }
});

it('does not restart a completed portrait reaction when a hidden tab resumes', () => {
  const s = screen();
  try {
    const b = initial(); s.show(b); s.show(move(b, 'titans-relic-press'));
    const finishedReaction = s.animations[1];
    Object.defineProperty(finishedReaction, 'playState', { value: 'finished' });
    for (const value of ['hidden', 'visible']) {
      Object.defineProperty(s.window.document, 'visibilityState', { configurable: true, value });
      s.window.document.dispatchEvent(new s.window.Event('visibilitychange'));
    }
    expect(finishedReaction.pause).not.toHaveBeenCalled();
    expect(finishedReaction.play).not.toHaveBeenCalled();
    expect(s.timers.size).toBe(1);
  } finally { s.close(); }
});

it('anchors a teammate’s support effect to their own card and a field effect to every card', () => {
  const s = screen();
  try {
    const ally = { ...pet, id: 'ally' };
    const monster = { ...rival, id: 'monster', monster: 'slime' as const };
    let b = startBattle([pet, ally], monster, [200, 200, 0], { random: () => 0 });
    s.show(b, { viewer: 'ally' });
    b = move(b, 'hardhat-guard'); s.show(b, { viewer: 'ally' });
    expect(s.$('.skill-vfx').parentElement!.id).toBe('battle-avatar-2');
    s.tick();
    b = move(b, 'equalizer-field'); s.show(b, { viewer: 'ally' });
    expect([...s.window.document.querySelectorAll('.skill-vfx')].map(e => e.parentElement!.id))
      .toEqual(['battle-avatar-0', 'battle-avatar-1', 'battle-avatar-2']);
  } finally { s.close(); }
});

it('retains distinct legacy move effects and animates the boss’s automatic Bump', () => {
  const s = screen();
  try {
    const legacy = ['claw-strike', 'heavy-strike', 'firebolt', 'tide-crash', 'vine-lash'] as const;
    const motions = new Set<string>();
    for (const skill of legacy) {
      s.reset();
      const b = startBattle([{ ...pet, abilities: legacy }], rival, [200, 1100], { random: () => 0 });
      s.show(b); s.show(move(b, skill));
      expect(s.$('.skill-vfx').dataset.skill).toBe(skill);
      motions.add(s.$('.skill-vfx').dataset.motion!);
    }
    expect(motions.size).toBe(5);
    s.reset();
    const monster = { id: 'boss', name: 'Slime King', strength: 100, charisma: 1, intelligence: 5,
      monster: 'slime-king' as const, abilities: ['bump'] as const };
    const b = startBattle([pet], monster, [200, 20], { random: () => 0 });
    s.show(b); s.show(move(b, 'coffee-break')); s.tick();
    expect(s.$('.skill-vfx').dataset.skill).toBe('bump');
    expect(s.$('.skill-vfx').parentElement!.id).toBe('battle-avatar-0');
  } finally { s.close(); }
});

it.each([false, true])('shows a saved boss charge on the caster and a persistent target warning (reduced motion: %s)', reduce => {
  const s = screen(reduce);
  try {
    const king = { id: 'king', name: 'Slime King', monster: 'slime-king' as const, strength: 18, intelligence: 10, charisma: 12,
      abilities: ['bump'] as const, tactic: 'boss' as const, strategy: 'Charges Bump before attacking.' };
    const b = startBattle([{ ...pet, equippedCoin: undefined }], king, [200, 58], { random: () => 0.6 });
    s.show(b); s.tick();
    expect(s.$('.skill-vfx').dataset.motion).toBe('charge');
    expect(s.$('.skill-vfx').parentElement!.id).toBe('battle-avatar-1');
    expect(s.$('.skill-vfx').classList.contains('is-still')).toBe(reduce);
    expect(s.$('.battle-cue').textContent).toBe('Charging');
    expect(s.$('#battle-ability-cost').textContent).toContain('No MP spent');
    s.tick();
    expect(s.$('#battle-intent').hidden).toBe(false);
    expect(s.$('#battle-intent').textContent).toContain('Target: pet (you)');
    expect(s.$('#battle-intent').textContent).toContain('below 5 MP');
    expect(s.$('#battle-intent').closest('[role="status"]')?.getAttribute('aria-atomic')).toBe('true');
    expect(s.$('#battle-strategy').textContent).toContain('Charges Bump');
    expect(s.$('[data-skill="hardhat-guard"]')).toHaveProperty('disabled', false);
    s.reset(); s.show(JSON.parse(JSON.stringify(b))); s.tick(); s.tick();
    expect(s.$('#battle-intent').hidden).toBe(false);
    const after = move(b, 'hardhat-guard'); s.show(after);
    expect(s.$('#battle-intent').hidden).toBe(true);
    s.tick();
    expect(s.$('.skill-vfx').dataset.motion).toBe('bump');
    expect(s.$('.skill-vfx').parentElement!.id).toBe('battle-avatar-0');
    s.tick();
    expect(s.$('#battle-intent').hidden).toBe(true);
    s.reset(); s.show(initial());
    expect(s.$('#battle-intent').hidden).toBe(true);
    expect(s.$('#battle-strategy').hidden).toBe(true);
  } finally { s.close(); }
});

it('updates the boss warning after a teammate drains MP, before the next player chooses', () => {
  const s = screen(true);
  try {
    const king = { id: 'king', monster: 'slime-king' as const, strength: 18, intelligence: 10, charisma: 12,
      abilities: ['bump'] as const, tactic: 'boss' as const };
    const b = startBattle([{ ...pet, intelligence: 15, equippedCoin: undefined }, { ...pet, id: 'ally', strength: 5, equippedCoin: undefined }],
      king, [165, 110, 58], { random: () => 0.6 });
    s.show(b); s.tick(); s.tick();
    s.show(move(b, 'synapse-shock')); s.tick();
    expect(s.$('#battle-intent').hidden).toBe(false);
    expect(s.$('#battle-intent').textContent).toContain('Bump interrupted: not enough MP');
    expect(s.$('#battle-status').textContent).toContain('Waiting for ally');
    expect(s.$('[data-skill="hardhat-guard"]')).toHaveProperty('disabled', true);
  } finally { s.close(); }
});
