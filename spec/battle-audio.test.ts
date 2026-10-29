import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { ABILITIES, startBattle, takeBattleTurn, type ActiveBattle, type AbilityId } from '../src/combat.ts';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const pet = { id: 'owner', strength: 100, intelligence: 100, charisma: 100, appearance: 'cat', equippedCoin: 'silver-coin' as const };
const rival = { ...pet, id: 'other', appearance: 'dog' };
function setup(options: { saved?: string; supported?: boolean; signedIn?: boolean; blockedStorage?: boolean } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="dashboard"></section><fieldset id="world-music"><p id="music-credit"></p></fieldset></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/',
  });
  const $ = (id: string) => window.document.getElementById(id)!;
  $('dashboard').hidden = options.signedIn === false;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  if (options.saved) window.localStorage.setItem('virtuepets:effects', options.saved);
  if (options.blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
  let clock = 0, timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  window.setTimeout = ((callback: () => void, delay = 0) => { timers.set(++timerId, { at: clock + delay, callback }); return timerId; }) as typeof window.setTimeout;
  window.clearTimeout = (id: number | undefined) => { if (id !== undefined) timers.delete(id); };
  const advance = (milliseconds = 1000) => {
    const until = clock + milliseconds;
    for (let count = 0; count < 100; count++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      timers.delete(next[0]); clock = next[1].at; next[1].callback();
    }
    clock = until;
  };
  const parameter = (value = 0) => ({ value, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const sources: any[] = [], gains: any[] = [], pans: any[] = [];
  const source = (kind: string) => {
    const value = { ...node(), kind, type: '', frequency: parameter(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null };
    sources.push(value); return value;
  };
  const context = {
    state: 'suspended', get currentTime() { return clock / 1000; }, sampleRate: 24000, destination: {},
    createGain: vi.fn(() => { const gain = { ...node(), gain: parameter(1) }; gains.push(gain); return gain; }),
    createStereoPanner: vi.fn(() => { const pan = { ...node(), pan: parameter() }; pans.push(pan); return pan; }),
    createOscillator: vi.fn(() => source('tone')), createBufferSource: vi.fn(() => source('noise')),
    createBiquadFilter: vi.fn(() => ({ ...node(), type: '', frequency: parameter(), Q: parameter() })),
    createBuffer: vi.fn((_channels, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    resume: vi.fn(async () => { context.state = 'running'; }),
    suspend: vi.fn(async () => { context.state = 'suspended'; }),
  };
  const Context = vi.fn(function () { return context; });
  if (options.supported !== false) Object.defineProperty(window, 'AudioContext', { value: Context });
  window.eval(readFileSync('public/battle.js', 'utf8'));
  window.eval(readFileSync('public/battle-audio.js', 'utf8'));
  const event = (type: string, detail?: unknown) => window.document.dispatchEvent(new window.CustomEvent(type, { detail }));
  const cues: any[] = [];
  window.document.addEventListener('battle:sound', e => cues.push((e as CustomEvent).detail));
  const show = (battle: ActiveBattle, extra: Record<string, unknown> = {}) => event('battle:show', { key: 'sound:1', battle, viewer: 'owner', manual: true, result: '', ...extra });
  const gesture = () => window.document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  const turn = (battle: ActiveBattle, id = 'owner', skill: AbilityId = 'claw-strike') => {
    const next = takeBattleTurn(battle, id, skill, battle.revision, () => 0);
    if ('error' in next) throw new Error(next.error);
    show(next); return next;
  };
  const battle = (appearance = 'cat', skill: AbilityId = 'claw-strike') => startBattle([{ ...pet, appearance, equippedAbilities: [skill] }], rival, [300, 300], { random: () => 0 });
  return { window, $, sources, gains, pans, context, Context, cues, show, battle, turn, gesture, event, advance, close: () => window.close() };
}

it('plays both pets and the chosen skill only with a saved visual turn, never while waiting or receiving duplicates', async () => {
  const p = setup();
  try {
    const initial = p.battle(); p.show(initial); await flush();
    expect(p.Context).not.toHaveBeenCalled();
    p.gesture(); await flush();
    expect(p.sources).toHaveLength(0);
    const saved = p.turn(initial);
    expect(p.cues).toHaveLength(1);
    expect(p.cues[0]).toMatchObject({ actor: { appearance: 'cat' }, target: { appearance: 'dog' }, motion: 'claw' });
    expect(p.sources.length).toBeGreaterThan(3);
    expect(p.pans.some(pan => pan.pan.value < 0)).toBe(true);
    expect(p.pans.some(pan => pan.pan.value > 0)).toBe(true);
    const count = p.sources.length;
    p.show(saved); await flush();
    expect(p.cues).toHaveLength(1);
    expect(p.sources).toHaveLength(count);
    p.advance();
    p.turn(saved, 'other');
    expect(p.cues[1]).toMatchObject({ actor: { appearance: 'dog' }, target: { appearance: 'cat' } });
    expect(p.sources.length).toBeGreaterThan(count);
  } finally { p.close(); }
});

it('gives all eight pet species distinct attack voices', async () => {
  const p = setup(), pitches = new Set<number>();
  try {
    p.gesture(); await flush();
    for (const species of ['cat', 'dog', 'hedgehog', 'lizard', 'panda', 'bird', 'dragon', 'blob']) {
      p.event('battle:reset');
      const b = p.battle(species); p.show(b);
      const index = p.sources.length;
      p.turn(b);
      pitches.add(p.sources[index].frequency.setValueAtTime.mock.calls[0][0]);
      expect(p.cues.at(-1).actor.appearance).toBe(species);
    }
    expect(pitches.size).toBe(8);
    expect(p.Context).toHaveBeenCalledTimes(1);
    expect(p.context.createBuffer).toHaveBeenCalledTimes(1);
  } finally { p.close(); }
});

it('covers every equipped skill with bounded, finite audio cues and distinct skill textures', async () => {
  const p = setup(), textures = new Set<string>();
  try {
    p.gesture(); await flush();
    for (const skill of ABILITIES) {
      p.event('battle:reset');
      const b = p.battle('blob', skill.id); p.show(b);
      const index = p.sources.length;
      p.turn(b, 'owner', skill.id);
      const voices = p.sources.slice(index);
      expect(voices.length, skill.id).toBeGreaterThan(1);
      expect(voices.length, skill.id).toBeLessThanOrEqual(32);
      for (const voice of voices) {
        expect(voice.start).toHaveBeenCalledTimes(1);
        const start = voice.start.mock.calls[0][0], stop = voice.stop.mock.calls[0][0];
        expect(stop - start).toBeGreaterThan(0);
        expect(stop - start).toBeLessThan(1);
        for (const [frequency] of voice.frequency.exponentialRampToValueAtTime.mock.calls) {
          expect(Number.isFinite(frequency) && frequency > 0 && frequency < 20000).toBe(true);
        }
      }
      textures.add(JSON.stringify(voices.map(v => [v.kind, v.type, v.frequency.exponentialRampToValueAtTime.mock.calls])));
    }
    expect(textures.size).toBeGreaterThan(12);
  } finally { p.close(); }
});

it('uses a dodge cue without hurt sounds on a miss, and handles monster charge and support turns', async () => {
  const p = setup();
  try {
    p.gesture(); await flush();
    const b = p.battle(); p.show(b); p.turn(b);
    const cue = p.cues[0], hitCount = p.sources.length;
    let index = p.sources.length;
    p.event('battle:sound', { ...cue, step: { ...cue.step, missed: true, damage: 0 } });
    expect(p.sources.length - index).toBeLessThan(hitCount);
    expect(p.sources.slice(index).some(v => v.kind === 'noise')).toBe(true);
    index = p.sources.length;
    p.event('battle:sound', { ...cue, actor: { monster: 'slime-king' }, step: { ...cue.step, telegraph: true, damage: 0 } });
    expect(p.sources[index].frequency.setValueAtTime.mock.calls[0][0]).toBe(100);
    expect(p.sources.slice(index).some(v => v.frequency.exponentialRampToValueAtTime.mock.calls.some(([pitch]: number[]) => pitch === 440))).toBe(true);
    p.event('battle:reset');
    const support = p.battle('panda', 'mana-barrier'); p.show(support); p.turn(support, 'owner', 'mana-barrier');
    expect(p.cues.at(-1)).toMatchObject({ targetKind: 'self', motion: 'barrier', step: { damage: 0 } });
  } finally { p.close(); }
});

it('mutes immediately inside battle, retains separate volume settings, and restores them across tabs', async () => {
  const p = setup();
  try {
    p.gesture(); await flush();
    const b = p.battle(); p.show(b); await flush(); p.turn(b);
    const count = p.sources.length;
    p.$('battle-sfx-toggle').click();
    expect(p.$('sfx-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(p.sources.every(v => v.stop.mock.calls.some(([at]: number[]) => at <= .021))).toBe(true);
    p.event('battle:sound', p.cues[0]); expect(p.sources).toHaveLength(count);
    const range = p.$('sfx-volume') as HTMLInputElement;
    range.value = '18'; range.dispatchEvent(new p.window.Event('input'));
    expect(JSON.parse(p.window.localStorage.getItem('virtuepets:effects')!)).toEqual({ enabled: false, volume: 18 });
    expect(p.window.localStorage.getItem('virtuepets:music')).toBeNull();
    p.window.dispatchEvent(new p.window.StorageEvent('storage', { key: 'virtuepets:effects', newValue: JSON.stringify({ enabled: true, volume: 27 }) }));
    await flush();
    expect(p.$('battle-sfx-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(range.getAttribute('aria-valuetext')).toBe('27%');
    expect(p.gains[0].gain.setTargetAtTime.mock.calls.at(-1)[0]).toBeCloseTo(.27);
    p.event('battle:sound', p.cues[0]); expect(p.sources.length).toBeGreaterThan(count);
  } finally { p.close(); }
});

it('stops skipped and closed replays and never plays all skipped turns at once', async () => {
  const p = setup();
  try {
    p.gesture(); await flush();
    const b = p.battle();
    const first = takeBattleTurn(b, 'owner', 'claw-strike', b.revision, () => 0);
    if ('error' in first) throw new Error(first.error);
    p.show(first, { manual: false, replay: true }); p.advance(150);
    expect(p.sources.length).toBeGreaterThan(0);
    const count = p.sources.length;
    p.$('battle-skip').click(); p.advance();
    expect(p.sources).toHaveLength(count);
    expect(p.sources.every(v => v.stop.mock.calls.length >= 2)).toBe(true);
    p.$('battle-replay').click(); p.advance(150);
    expect(p.sources.length).toBeGreaterThan(count);
    p.$('battle-close').click();
    expect(p.sources.every(v => v.stop.mock.calls.length >= 2)).toBe(true);
    p.sources.forEach(v => v.onended?.());
    expect(p.sources.every(v => v.disconnect.mock.calls.length > 0)).toBe(true);
  } finally { p.close(); }
});

it('drops effects when covered, hidden, or signed out, including a delayed audio unlock', async () => {
  const p = setup();
  try {
    let unlock!: () => void;
    p.context.resume.mockImplementation(() => new Promise<void>(resolve => { unlock = () => { p.context.state = 'running'; resolve(); }; }));
    p.gesture();
    const b = p.battle(); p.show(b); p.turn(b);
    expect(p.sources).toHaveLength(0);
    p.$('dashboard').hidden = true; await flush(); unlock(); await flush();
    expect(p.context.state).toBe('suspended'); expect(p.sources).toHaveLength(0);
    p.context.resume.mockImplementation(async () => { p.context.state = 'running'; });
    p.$('dashboard').hidden = false; p.gesture(); await flush();
    p.event('battle:sound', p.cues[0]);
    const count = p.sources.length;
    const cover = p.window.document.createElement('dialog'); p.window.document.body.append(cover); cover.showModal(); await flush();
    expect(p.$('battle-dialog').classList.contains('battle-motion-paused')).toBe(true);
    p.event('battle:sound', p.cues[0]); expect(p.sources).toHaveLength(count);
    cover.close(); await flush();
    Object.defineProperty(p.window.document, 'hidden', { configurable: true, value: true });
    p.event('visibilitychange');
    p.event('battle:sound', p.cues[0]); expect(p.sources).toHaveLength(count);
    Object.defineProperty(p.window.document, 'hidden', { configurable: true, value: false });
    p.event('visibilitychange'); await flush();
    expect(p.context.state).toBe('running'); expect(p.sources).toHaveLength(count);
  } finally { p.close(); }
});

it.each(['unsupported', 'corrupt storage', 'blocked storage'])('keeps battle controls usable with %s', async mode => {
  const p = setup({ supported: mode !== 'unsupported', saved: '{bad', blockedStorage: mode === 'blocked storage' });
  try {
    const b = p.battle(); p.show(b); await flush(); p.gesture(); await flush(); p.turn(b);
    expect((p.$('battle-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('battle-status').textContent).toContain('Claw Strike');
    expect((p.$('sfx-toggle') as HTMLButtonElement).disabled).toBe(mode === 'unsupported');
    if (mode === 'unsupported') expect(p.sources).toHaveLength(0);
    else expect(p.sources.length).toBeGreaterThan(0);
  } finally { p.close(); }
});
