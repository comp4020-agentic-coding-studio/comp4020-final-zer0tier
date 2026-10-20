import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const preferenceKey = 'virtuepets:music';
const flush = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

function page(options: { signedIn?: boolean; saved?: string; blockedStorage?: boolean; webAudio?: boolean } = {}) {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/',
  });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  if (options.saved !== undefined) window.localStorage.setItem(preferenceKey, options.saved);
  if (options.blockedStorage) {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); },
    });
  }
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  let paused = true;
  let playback: () => Promise<void> = () => Promise.resolve();
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get: () => paused });
  const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused = false;
    return playback().then(() => {
      if (!paused) this.dispatchEvent(new window.Event('playing'));
    }, error => {
      paused = true;
      throw error;
    });
  });
  const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new window.Event('pause'));
  });
  const gain = { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn() };
  const source = { connect: vi.fn() };
  const context = {
    state: 'suspended', currentTime: 10, destination: {},
    createGain: vi.fn(() => gain),
    createMediaElementSource: vi.fn(() => source),
    resume: vi.fn(async () => { context.state = 'running'; }),
    suspend: vi.fn(async () => { context.state = 'suspended'; }),
  };
  const AudioContext = vi.fn(function () { return context; });
  if (options.webAudio) Object.defineProperty(window, 'AudioContext', { value: AudioContext });
  $('dashboard').hidden = !options.signedIn;
  $('signout').hidden = !options.signedIn;
  window.eval(readFileSync('public/world.js', 'utf8'));
  window.eval(readFileSync('public/music.js', 'utf8'));
  const audio = $('background-music') as HTMLAudioElement;
  const toggle = $('music-toggle') as HTMLButtonElement;
  const range = $('music-volume') as HTMLInputElement;
  return {
    window, $, audio, toggle, range, play, pause, context, gain, source, AudioContext,
    setPlayback: (callback: () => Promise<void>) => { playback = callback; },
    gesture: () => $('world-stage').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })),
    key: (key = 'a', repeat = false) => $('world-stage').dispatchEvent(new window.KeyboardEvent('keydown', { key, repeat, bubbles: true })),
    openMenu: () => $('world-stage').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    volume: (value: number) => {
      range.value = String(value);
      range.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    setVisible: (visible: boolean) => {
      Object.defineProperty(window.document, 'hidden', { configurable: true, value: !visible });
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    },
    storage: (value: { enabled: boolean; volume: number }) => {
      const newValue = JSON.stringify(value);
      window.localStorage.setItem(preferenceKey, newValue);
      window.dispatchEvent(new window.StorageEvent('storage', { key: preferenceKey, newValue }));
    },
    close: () => { play.mockRestore(); pause.mockRestore(); window.close(); },
  };
}

it('starts one quiet loop after a signed-in gesture and keeps music controls inside the game menu', async () => {
  const p = page();
  try {
    await flush();
    expect(p.play).not.toHaveBeenCalled();
    expect(p.audio.getAttribute('src')).toBeNull();
    expect(p.audio.loop).toBe(true);
    expect(p.audio.preload).toBe('none');
    expect(p.toggle.textContent).toContain('Background music');
    expect(p.toggle.getAttribute('aria-pressed')).toBe('true');
    expect(p.range.min).toBe('0');
    expect(p.range.max).toBe('100');
    expect(p.range.value).toBe('35');
    expect(p.$('world-panel-menu').contains(p.$('world-music'))).toBe(true);
    expect(p.$('world-music').closest('dialog:not([open])')).not.toBeNull();
    expect(p.range.labels?.length || p.range.getAttribute('aria-label')).toBeTruthy();
    p.$('dashboard').hidden = false;
    await flush();
    expect(p.play).not.toHaveBeenCalled();
    p.gesture();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.audio.getAttribute('src')).toBe('/audio/cozy-day.wav');
    expect(p.audio.volume).toBeCloseTo(0.35);
    expect(p.audio.paused).toBe(false);
    p.audio.currentTime = 18;
    const pauses = p.pause.mock.calls.length;
    p.key();
    p.key('a', true);
    p.gesture();
    p.$('home-door').click();
    p.$('town-home').click();
    p.openMenu();
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('world-music').closest('[hidden]')).toBeNull();
    p.$('world-dialog-close').click();
    // Normal server renders can set hidden=false repeatedly.
    p.$('dashboard').hidden = false;
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.pause).toHaveBeenCalledTimes(pauses);
    expect(p.audio.currentTime).toBe(18);
    expect(p.window.document.querySelectorAll('audio')).toHaveLength(1);
    p.$('dashboard').hidden = true;
    await flush();
    p.gesture();
    p.key();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.audio.paused).toBe(true);
  } finally { p.close(); }
});

it('preserves playback position while hidden, then resets it and stops on sign-out', async () => {
  const p = page({ signedIn: true });
  try {
    p.key('ArrowRight');
    await flush();
    expect(p.audio.paused).toBe(false);
    p.audio.currentTime = 27;
    p.setVisible(false);
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.audio.currentTime).toBe(27);
    const attempts = p.play.mock.calls.length;
    p.gesture();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(attempts);
    p.setVisible(true);
    await flush();
    expect(p.play).toHaveBeenCalledTimes(attempts + 1);
    expect(p.audio.paused).toBe(false);
    expect(p.audio.currentTime).toBe(27);
    p.window.dispatchEvent(new p.window.Event('pagehide'));
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.audio.currentTime).toBe(27);
    p.window.dispatchEvent(new p.window.Event('pageshow'));
    await flush();
    expect(p.audio.paused).toBe(false);
    expect(p.audio.currentTime).toBe(27);
    const attemptsBeforeSignOut = p.play.mock.calls.length;
    p.$('dashboard').hidden = true;
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.audio.currentTime).toBe(0);
    p.setVisible(false);
    p.setVisible(true);
    await flush();
    expect(p.play).toHaveBeenCalledTimes(attemptsBeforeSignOut);
  } finally { p.close(); }
});

it('persists mute and volume, restores them on reload, and follows other tabs without restarting the loop', async () => {
  const p = page({ signedIn: true });
  let saved = '';
  try {
    p.gesture();
    await flush();
    p.volume(18);
    expect(p.audio.volume).toBeCloseTo(0.18);
    expect(p.$('music-volume-value').textContent).toContain('18');
    p.toggle.click();
    await flush();
    expect(p.toggle.getAttribute('aria-pressed')).toBe('false');
    expect(p.audio.paused).toBe(true);
    saved = p.window.localStorage.getItem(preferenceKey)!;
    expect(JSON.parse(saved)).toEqual({ enabled: false, volume: 18 });
  } finally { p.close(); }

  const restored = page({ signedIn: true, saved });
  try {
    restored.gesture();
    restored.key();
    await flush();
    expect(restored.toggle.getAttribute('aria-pressed')).toBe('false');
    expect(restored.range.value).toBe('18');
    expect(restored.play).not.toHaveBeenCalled();
    restored.toggle.click();
    await flush();
    expect(restored.toggle.getAttribute('aria-pressed')).toBe('true');
    expect(restored.audio.paused).toBe(false);
    const attempts = restored.play.mock.calls.length;
    restored.storage({ enabled: true, volume: 42 });
    await flush();
    expect(restored.range.value).toBe('42');
    expect(restored.audio.volume).toBeCloseTo(0.42);
    expect(restored.play).toHaveBeenCalledTimes(attempts);
    restored.storage({ enabled: false, volume: 42 });
    await flush();
    expect(restored.toggle.getAttribute('aria-pressed')).toBe('false');
    expect(restored.audio.paused).toBe(true);
    restored.storage({ enabled: true, volume: 0 });
    await flush();
    expect(restored.toggle.getAttribute('aria-pressed')).toBe('true');
    expect(restored.audio.paused).toBe(true);
    expect(restored.play).toHaveBeenCalledTimes(attempts);
    restored.volume(25);
    await flush();
    expect(restored.audio.paused).toBe(false);
    expect(restored.play).toHaveBeenCalledTimes(attempts + 1);
    restored.volume(0);
    await flush();
    expect(restored.audio.paused).toBe(true);
    expect(JSON.parse(restored.window.localStorage.getItem(preferenceKey)!)).toEqual({ enabled: true, volume: 0 });
  } finally { restored.close(); }
});

it('handles denied autoplay and retries on a later keyboard gesture without changing the preference', async () => {
  const p = page({ signedIn: true });
  try {
    p.setPlayback(() => Promise.reject(new p.window.DOMException('Gesture needed', 'NotAllowedError')));
    p.gesture();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.audio.paused).toBe(true);
    expect(p.toggle.getAttribute('aria-pressed')).toBe('true');
    expect(p.$('music-status').textContent?.trim()).not.toBe('');
    // Neither background session renders nor visibility changes may retry
    // without the gesture required by the browser.
    p.$('dashboard').hidden = false;
    p.setVisible(false);
    p.setVisible(true);
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    p.setPlayback(() => Promise.resolve());
    p.key('ArrowRight');
    await flush();
    expect(p.play).toHaveBeenCalledTimes(2);
    expect(p.audio.paused).toBe(false);
  } finally { p.close(); }
});

it('leaves a failed recording quiet during movement until the player explicitly retries it', async () => {
  const p = page({ signedIn: true });
  try {
    p.setPlayback(() => Promise.reject(new p.window.DOMException('Cannot decode', 'NotSupportedError')));
    p.gesture();
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.play).toHaveBeenCalledTimes(1);
    p.setPlayback(() => Promise.resolve());
    p.gesture();
    p.key('ArrowRight');
    p.$('dashboard').hidden = false;
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    p.toggle.click();
    p.toggle.click();
    await flush();
    expect(p.audio.paused).toBe(false);
    expect(p.play).toHaveBeenCalledTimes(2);
  } finally { p.close(); }
});

it('uses one gain-controlled audio graph for mobile volume and resumes it after the page returns', async () => {
  const p = page({ signedIn: true, webAudio: true });
  try {
    expect(p.AudioContext).not.toHaveBeenCalled();
    p.gesture();
    await flush();
    expect(p.AudioContext).toHaveBeenCalledTimes(1);
    expect(p.context.createMediaElementSource).toHaveBeenCalledExactlyOnceWith(p.audio);
    expect(p.source.connect).toHaveBeenCalledExactlyOnceWith(p.gain);
    expect(p.gain.connect).toHaveBeenCalledExactlyOnceWith(p.context.destination);
    expect(p.gain.gain.value).toBeCloseTo(0.35);
    expect(p.audio.volume).toBe(1);
    p.volume(12);
    expect(p.gain.gain.setTargetAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(0.12);
    expect(p.audio.volume).toBe(1);
    p.setVisible(false);
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.context.state).toBe('suspended');
    p.setVisible(true);
    await flush();
    expect(p.audio.paused).toBe(false);
    expect(p.context.state).toBe('running');
    expect(p.AudioContext).toHaveBeenCalledTimes(1);
    expect(p.context.createMediaElementSource).toHaveBeenCalledTimes(1);
    p.toggle.click();
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.context.state).toBe('suspended');
    p.toggle.click();
    await flush();
    expect(p.context.state).toBe('running');
    p.audio.dispatchEvent(new p.window.Event('error'));
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.context.state).toBe('suspended');
  } finally { p.close(); }
});

it('suspends a delayed mobile audio unlock that finishes after sign-out', async () => {
  const p = page({ signedIn: true, webAudio: true });
  try {
    let unlock!: () => void;
    p.context.resume.mockImplementation(() => new Promise<void>(resolve => {
      unlock = () => {
        p.context.state = 'running';
        resolve();
      };
    }));
    p.gesture();
    await flush();
    expect(p.context.resume).toHaveBeenCalledTimes(1);
    expect(p.context.state).toBe('suspended');
    p.audio.currentTime = 12;
    p.$('dashboard').hidden = true;
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.audio.currentTime).toBe(0);
    unlock();
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.context.state).toBe('suspended');
    expect(p.context.suspend).toHaveBeenCalledTimes(1);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.audio.currentTime).toBe(0);
  } finally { p.close(); }
});

it.each(['mute', 'sign-out'] as const)('does not revive a pending play request after %s', async reason => {
  const p = page({ signedIn: true });
  try {
    let finish!: () => void;
    p.setPlayback(() => new Promise<void>(resolve => { finish = resolve; }));
    p.gesture();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    p.gesture();
    p.key();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
    if (reason === 'mute') p.toggle.click();
    else p.$('dashboard').hidden = true;
    await flush();
    expect(p.audio.paused).toBe(true);
    finish();
    await flush();
    expect(p.audio.paused).toBe(true);
    expect(p.play).toHaveBeenCalledTimes(1);
    if (reason === 'sign-out') expect(p.audio.currentTime).toBe(0);
  } finally { p.close(); }
});

it.each(['corrupt', 'unavailable'] as const)('keeps the music controls usable when storage is %s', async state => {
  const p = page({
    signedIn: true,
    ...(state === 'corrupt' ? { saved: '{invalid' } : { blockedStorage: true }),
  });
  try {
    expect(p.toggle.getAttribute('aria-pressed')).toBe('true');
    expect(p.range.value).toBe('35');
    p.gesture();
    await flush();
    expect(p.audio.paused).toBe(false);
    p.volume(20);
    p.toggle.click();
    await flush();
    expect(p.audio.paused).toBe(true);
    p.toggle.click();
    await flush();
    expect(p.audio.paused).toBe(false);
    expect(p.audio.volume).toBeCloseTo(0.2);
  } finally { p.close(); }
});
