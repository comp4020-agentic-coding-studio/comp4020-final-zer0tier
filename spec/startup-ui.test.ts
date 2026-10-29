import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

it.each([4000, 1001, 1006])('reconnects immediately after sign-in even when the socket reports code %s, but delays network retries', async closeCode => {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  class Socket extends window.EventTarget {
    close = vi.fn((_code = 1000, _reason?: string) => this.dispatchEvent(new window.CloseEvent('close', { code: closeCode })));
  }
  const sockets: Socket[] = [];
  window.WebSocket = function () {
    const socket = new Socket(); sockets.push(socket); return socket;
  } as unknown as typeof WebSocket;
  window.fetch = (async (url: string) => {
    if (url === '/api/me') return Response.json({ error: 'Sign in first.' }, { status: 401 });
    if (url === '/api/signin') return Response.json(pet);
    if (url === '/api/rules') return Response.json(rules);
    return Response.json([]);
  }) as typeof fetch;
  const timers = vi.spyOn(window, 'setTimeout');
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 500 });
    const before = sockets.length, guest = sockets.at(-1)!;
    ($('player-id') as HTMLInputElement).value = pet.id;
    ($('password') as HTMLInputElement).value = 'test-password';
    $('login').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(sockets).toHaveLength(before + 1), { timeout: 500 });
    expect(guest.close).toHaveBeenCalledWith(4000, 'Session changed');
    expect($('dashboard').hidden).toBe(false);
    expect(timers.mock.calls.some(([, delay]) => delay === 1000)).toBe(false);
    sockets.at(-1)!.dispatchEvent(new window.CloseEvent('close', { code: 1006 }));
    expect(timers).toHaveBeenLastCalledWith(expect.any(Function), 1000);
    expect(sockets).toHaveLength(before + 1);
  } finally { window.close(); }
});

it.each(['signin', 'signout'])('ignores the initial account response after an explicit %s', async action => {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof WebSocket;
  let finishStartup: (response: Response) => void = () => {};
  window.fetch = (async (url: string) => {
    if (url === '/api/me') return new Promise<Response>(resolve => { finishStartup = resolve; });
    if (url === '/api/signin') return Response.json(pet);
    if (url === '/api/rules') return Response.json(rules);
    return Response.json([]);
  }) as typeof fetch;
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    ($('player-id') as HTMLInputElement).value = pet.id;
    ($('password') as HTMLInputElement).value = 'test-password';
    $('login').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('dashboard').hidden).toBe(false));
    if (action === 'signout') {
      $('signout').click();
      await vi.waitFor(() => expect($('dashboard').hidden).toBe(true));
      finishStartup(Response.json(pet));
    } else {
      finishStartup(Response.json({ error: 'Sign in first.' }, { status: 401 }));
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    expect($('dashboard').hidden).toBe(action === 'signout');
  } finally { window.close(); }
});
