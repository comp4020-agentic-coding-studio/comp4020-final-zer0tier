import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { Pet } from '../src/pets.ts';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

async function page() {
  let now = 1_800_000_000_000;
  const idle: Pet = await (await signUp(freshId())).json();
  const working: Pet = {
    ...idle, activity: 'working', task: 'Office', busySince: now - 60_000, busyUntil: now + 60_000,
    hourglass: 1, reward: { strength: 0, intelligence: 0, charisma: 0, money: 25, credits: 0 },
  };
  const rules = { ...await getRules(), timeScale: 60 };
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
    url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  const clock = vi.spyOn(window.Date, 'now').mockImplementation(() => now);
  const ticks: (() => void)[] = [];
  const interval = vi.spyOn(window, 'setInterval').mockImplementation(callback => {
    ticks.push(callback as () => void);
    return ticks.length;
  });
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof window.WebSocket;
  let saved = working;
  const requests = vi.fn(async (url: string) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me' || url === '/api/signin' || url === `/api/pets/${saved.id}`) return Response.json(saved);
    if (url === '/api/signout' || url.endsWith('/use/hourglass')) return new Response(null, { status: 204 });
    return Response.json([]);
  });
  window.fetch = requests as typeof fetch;
  const update = (pet: Pet) => {
    saved = pet;
    socket.dispatchEvent(new window.MessageEvent('message', {
      data: JSON.stringify({ type: 'pet:updated', pet }),
    }));
  };
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    await vi.waitFor(() => expect($('town-activity-label').textContent).toBe('Working at the Office'));
    return {
      dom, window, $, idle, working, requests, interval, socket, update,
      mountWorld: () => window.eval(readFileSync('public/world.js', 'utf8')),
      setSaved: (pet: Pet) => { saved = pet; },
      setNow: (value: number) => { now = value; },
      tick: () => ticks.forEach(callback => callback()),
      close: () => { clock.mockRestore(); interval.mockRestore(); window.close(); },
    };
  } catch (error) {
    clock.mockRestore(); interval.mockRestore(); window.close();
    throw error;
  }
}

it('keeps a saved shift visible through town navigation and advances its existing clock without disturbing map focus', async () => {
  const p = await page();
  try {
    // A cached login can finish before world.js loads; the same rendered node
    // must survive mounting the world and moving between scenes.
    const panel = p.$('town-activity'), progress = p.$('town-activity-progress');
    expect(panel.hidden).toBe(false);
    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(progress.getAttribute('aria-labelledby')).toBe('town-activity-label');
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('100');
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
    expect(p.$('town-activity-percent').textContent).toBe('50%');
    expect(p.$('town-activity-left').textContent).toBe('1 h left');
    expect(Number(p.$('town-activity-fill').style.getPropertyValue('--fill'))).toBe(0.5);
    p.mountWorld();
    expect(p.$('town-activity')).toBe(panel);
    expect(panel.closest('.world-main')).not.toBeNull();
    expect(p.$('world-stage').contains(panel)).toBe(false);
    expect(p.$('world-shell').dataset.scene).toBe('home');
    p.$('home-door').click();
    expect(p.$('world-shell').dataset.scene).toBe('town');
    const stage = p.$('world-stage');
    stage.focus();
    const avatar = p.$('world-avatar'), position = avatar.style.transform;
    const requestCount = p.requests.mock.calls.length;
    p.setNow(p.working.busySince! + 90_000);
    p.tick();
    expect(progress.getAttribute('aria-valuenow')).toBe('75');
    expect(p.$('town-activity-left').textContent).toBe('30 min left');
    expect(progress.getAttribute('aria-valuetext')).toContain('75%');
    expect(progress.getAttribute('aria-valuetext')).toContain('30 min left');
    expect(p.$('busy-progress').getAttribute('aria-valuenow')).toBe('75');
    expect(p.window.document.activeElement).toBe(stage);
    expect(avatar.style.transform).toBe(position);
    expect(p.requests).toHaveBeenCalledTimes(requestCount);
    expect(p.interval).toHaveBeenCalledTimes(1);
    p.$('town-home').click();
    p.$('home-door').click();
    expect(p.$('town-activity')).toBe(panel);
    expect(progress.getAttribute('aria-valuenow')).toBe('75');

    // Resync after a dropped socket must replace stale work with the saved
    // activity even when the start broadcast was missed.
    p.setSaved({ ...p.working, activity: 'studying', task: 'Math' });
    p.socket.dispatchEvent(new p.window.Event('open'));
    await vi.waitFor(() => expect(p.$('town-activity-label').textContent).toBe('Studying Math'));
    expect(p.$('town-activity')).toBe(panel);
    expect(progress.getAttribute('aria-valuenow')).toBe('75');
  } finally { p.close(); }
});

it('waits for saved completion and Hourglass broadcasts, then clears the town activity on sign-out and a new login', async () => {
  const p = await page();
  try {
    p.mountWorld();
    p.$('home-door').click();
    const panel = p.$('town-activity'), progress = p.$('town-activity-progress');
    p.setNow(p.working.busyUntil! - 750);
    p.tick();
    expect(p.$('town-activity-left').textContent).toBe('45 s left');
    expect(progress.getAttribute('aria-valuenow')).toBe('99');
    p.setNow(p.working.busyUntil! + 1);
    p.tick();
    expect(progress.getAttribute('aria-valuenow')).toBe('100');
    expect(p.$('town-activity-left').textContent).toBe('finishing…');
    expect(panel.hidden).toBe(false);
    expect(p.$('busy').hidden).toBe(false);
    p.update(p.idle);
    expect(panel.hidden).toBe(true);
    expect(p.$('busy').hidden).toBe(true);

    const studying: Pet = {
      ...p.working, activity: 'studying', task: 'Math',
      busySince: p.working.busyUntil! + 1, busyUntil: p.working.busyUntil! + 30_001,
      reward: { strength: 0, intelligence: 1, charisma: 0, money: 0, credits: 1 },
    };
    p.update(studying);
    expect(panel.hidden).toBe(false);
    expect(p.$('town-activity-label').textContent).toBe('Studying Math');
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    p.$('skip').click();
    await vi.waitFor(() => expect((p.$('skip') as HTMLButtonElement).disabled).toBe(false));
    expect(p.requests.mock.calls.some(([url]) => url.endsWith('/use/hourglass'))).toBe(true);
    expect(panel.hidden).toBe(false); // An HTTP success alone does not grant completion.
    p.update({ ...p.idle, intelligence: p.idle.intelligence + 1, credits: 1, hourglass: 0 });
    expect(panel.hidden).toBe(true);

    p.update(studying);
    p.$('signout').click();
    await vi.waitFor(() => expect(p.$('login').hidden).toBe(false));
    expect(panel.hidden).toBe(true);
    p.setNow(studying.busyUntil! + 1);
    p.tick();
    expect(panel.hidden).toBe(true);
    p.setSaved({ ...p.idle, id: freshId() });
    p.$('login').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(p.$('dashboard').hidden).toBe(false));
    p.$('home-door').click();
    expect(panel.hidden).toBe(true);
    expect(p.$('busy').hidden).toBe(true);
  } finally { p.close(); }
});

it('clamps the town activity progress when the browser clock is behind or a saved activity has zero duration', async () => {
  const p = await page();
  try {
    p.mountWorld();
    p.$('home-door').click();
    p.setNow(p.working.busySince! - 1_000);
    p.tick();
    expect(p.$('town-activity-progress').getAttribute('aria-valuenow')).toBe('0');
    expect(Number(p.$('town-activity-fill').style.getPropertyValue('--fill'))).toBe(0);
    p.setNow(p.working.busyUntil!);
    p.update({ ...p.working, busySince: p.working.busyUntil });
    expect(p.$('town-activity-progress').getAttribute('aria-valuenow')).toBe('100');
    expect(Number(p.$('town-activity-fill').style.getPropertyValue('--fill'))).toBe(1);
    expect(p.$('town-activity-left').textContent).toBe('finishing…');
    expect(p.$('town-activity').hidden).toBe(false);
    p.update(p.idle);
    expect(p.$('town-activity').hidden).toBe(true);
  } finally { p.close(); }
});
