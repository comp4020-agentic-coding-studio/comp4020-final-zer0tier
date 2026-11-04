import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl } from './helpers.ts';

// app.js and adventure.js share one once-a-second clock for their countdowns.
// It rests while the tab is hidden and catches up when the player returns.
it('runs one shared one-second clock for both scripts, resting while the tab is hidden', () => {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof WebSocket;
  window.fetch = (async () => Response.json({ error: 'Sign in first.' }, { status: 401 })) as typeof fetch;
  window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const seconds: (() => void)[] = [];
  vi.spyOn(window, 'setInterval').mockImplementation(((callback: () => void, delay: number) => {
    if (delay === 1000) seconds.push(callback);
    return seconds.length;
  }) as typeof window.setInterval);
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    expect(seconds).toHaveLength(1);
    const clock = (window as unknown as { virtuePetsClock: Set<() => void> }).virtuePetsClock;
    expect(clock.size).toBe(2);
    const render = vi.fn();
    clock.add(render);
    seconds[0]();
    expect(render).toHaveBeenCalledTimes(1);
    hidden = true;
    document.dispatchEvent(new window.Event('visibilitychange'));
    seconds[0](); seconds[0]();
    expect(render).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(render).toHaveBeenCalledTimes(2);
  } finally { window.close(); }
});
