import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function setup() {
  const pet = await (await signUp(freshId())).json();
  let loginPet = pet;
  const rules = await getRules();
  const neighbours = [{ ...pet, id: 'first', money: 75 }, { ...pet, id: 'second', money: 90 }];
  const { window } = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof WebSocket;
  const delayed = new Map<string, Promise<Response>>();
  const requests = vi.fn(async (url: string) => {
    if (delayed.has(url)) {
      const response = delayed.get(url)!; delayed.delete(url); return response;
    }
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me' || url === '/api/signin') return Response.json(loginPet);
    if (url === '/api/signout') return new Response(null, { status: 204 });
    if (url === '/api/pets?limit=20') return Response.json([loginPet, ...neighbours]);
    const found = neighbours.find(p => url === `/api/pets/${p.id}`);
    return Response.json(found ?? []);
  });
  window.fetch = requests as typeof fetch;
  const $ = (id: string) => window.document.getElementById(id)!;
  const visits: string[] = [];
  window.document.addEventListener('home:visit', e => visits.push((e as CustomEvent).detail.id));
  window.eval(readFileSync('public/app.js', 'utf8'));
  await vi.waitFor(() => expect(window.document.querySelectorAll('.visit-btn')).toHaveLength(2));
  const defer = (id: string) => {
    let resolve!: (response: Response) => void, reject!: (error: Error) => void;
    delayed.set(`/api/pets/${id}`, new Promise<Response>((yes, no) => { resolve = yes; reject = no; }));
    return { resolve, reject };
  };
  const lookup = (id: string) => {
    ($('lookup-id') as HTMLInputElement).value = id;
    $('lookup').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  };
  const relogin = async (same: boolean) => {
    $('signout').click();
    await vi.waitFor(() => expect($('dashboard').hidden).toBe(true));
    if (!same) loginPet = { ...pet, id: 'new-owner' };
    $('login').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('dashboard').hidden).toBe(false));
  };
  return { window, $, pet, neighbours, visits, requests, defer, lookup, relogin, close: () => window.close() };
}

it('keeps the latest lookup when an earlier search returns late', async () => {
  const p = await setup();
  try {
    const first = p.defer('first'); p.lookup('first'); p.lookup('second');
    await vi.waitFor(() => expect(p.visits).toEqual(['second']));
    first.resolve(Response.json(p.neighbours[0])); await flush();
    expect(p.visits).toEqual(['second']);
    expect(p.$('visit-heading').textContent).toContain('second');
    expect(p.requests.mock.calls.filter(([url]) => url === '/api/pets/second')).toHaveLength(1);
  } finally { p.close(); }
});

it.each(['success', 'not found', 'network error'])('discards an old lookup %s after signing out and back in to the same account', async outcome => {
  const p = await setup();
  try {
    const first = p.defer('first'); p.lookup('first');
    await p.relogin(true);
    if (outcome === 'network error') first.reject(new Error('Connection lost'));
    else first.resolve(outcome === 'success' ? Response.json(p.neighbours[0]) : Response.json({ error: 'Missing' }, { status: 404 }));
    await flush();
    expect(p.visits).toEqual([]);
    expect(p.$('visit').hidden).toBe(true);
    expect(p.$('arena-error').textContent).toBe('');
  } finally { p.close(); }
});

it('ignores lookup data decoded after switching accounts', async () => {
  const p = await setup();
  try {
    const first = p.defer('first');
    let finishJson!: (pet: unknown) => void;
    const json = new Promise(resolve => { finishJson = resolve; });
    p.lookup('first');
    first.resolve({ ok: true, status: 200, json: () => json } as unknown as Response);
    await flush(); await p.relogin(false);
    finishJson(p.neighbours[0]); await flush();
    expect(p.visits).toEqual([]);
    expect(p.$('visit').hidden).toBe(true);
    expect(p.$('pet-name').textContent).toBe('new-owner');
  } finally { p.close(); }
});

it('does not reopen a searched home after choosing another visit and leaving it', async () => {
  const p = await setup();
  try {
    const first = p.defer('first'); p.lookup('first');
    p.window.document.querySelector<HTMLButtonElement>('.visit-btn[data-pet="second"]')!.click();
    await vi.waitFor(() => expect(p.visits).toEqual(['second']));
    p.$('visit-close').click();
    first.resolve(Response.json(p.neighbours[0])); await flush();
    expect(p.visits).toEqual(['second']);
    expect(p.$('visit').hidden).toBe(true);
  } finally { p.close(); }
});

it.each([false, true])('cancels the old search across a quick close/reopen without cancelling a new search (%s)', async searchAgain => {
  const p = await setup();
  try {
    const dialog = p.window.document.createElement('dialog');
    p.window.document.body.append(dialog); dialog.append(p.$('lookup')); dialog.open = true;
    const first = p.defer('first'); p.lookup('first');
    dialog.open = false;
    dialog.open = true;
    // Native close events can be queued until after the window reopens.
    // A new lookup in that opening must still work.
    if (searchAgain) p.lookup('second');
    dialog.dispatchEvent(new p.window.Event('close'));
    first.resolve(Response.json(p.neighbours[0])); await flush();
    expect(p.visits).toEqual(searchAgain ? ['second'] : []);
    expect(p.$('visit').hidden).toBe(!searchAgain);
  } finally { p.close(); }
});
