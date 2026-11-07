import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// The woodland's crown and its Happening now line, drawn only from saved pets
// and broadcast feed entries.
async function setup() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const champion = { ...pet, id: 'champion', woodlandClears: 3 };
  const newcomer = { ...pet, id: 'newcomer', woodlandClears: 0 };
  const { window } = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof WebSocket;
  window.fetch = vi.fn(async (url: string) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url === '/api/pets?limit=20') return Response.json([pet, champion, newcomer]);
    return Response.json([]);
  }) as typeof fetch;
  const $ = (id: string) => window.document.getElementById(id)!;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  window.eval(readFileSync('public/app.js', 'utf8'));
  await vi.waitFor(() => expect(window.document.querySelectorAll('.visit-btn')).toHaveLength(2));
  return { window, $, send, pet };
}

it('shows a crown for each woodland clear on Arena pets and in pet details, from the saved pet', async () => {
  const p = await setup();
  try {
    const card = (id: string) => p.window.document.querySelector(`.visit-btn[data-pet="${id}"]`)!.closest('.rival')!;
    expect(card('champion').querySelector('.crown-tag')?.getAttribute('aria-label')).toBe('Woodland cleared ×3');
    expect(card('champion').querySelector('.crown-tag')?.textContent).toBe('Woodland ×3');
    expect(card('newcomer').querySelector('.crown-tag')).toBeNull();
    // A new pet has no crown; its first clear arrives in the broadcast.
    expect(p.$('pet-crown').hidden).toBe(true);
    p.send({ type: 'pet:updated', pet: { ...p.pet, money: 150, woodlandClears: 1 } });
    await vi.waitFor(() => expect(p.$('pet-crown').hidden).toBe(false));
    expect(p.$('pet-crown').textContent).toBe('Woodland cleared');
  } finally { p.window.close(); }
});

it('announces a woodland clear in Happening now, naming every pet that earned it', async () => {
  const p = await setup();
  try {
    const at = new Date().toISOString();
    p.send({ type: 'feed:added', entry: { id: 9_000_001, at, kind: 'cleared', pet: 'champion', team: ['champion'] } });
    p.send({ type: 'feed:added', entry: { id: 9_000_002, at, kind: 'cleared', pet: 'champion', team: ['champion', 'newcomer', p.pet.id] } });
    await vi.waitFor(() => expect(p.$('feed').children).toHaveLength(2));
    const lines = [...p.$('feed').querySelectorAll('li > span')].map(line => line.textContent);
    expect(lines).toEqual(['champion, newcomer and you cleared the woodland together!', 'champion cleared the woodland!']);
    // A clear you shared is highlighted as yours; someone else's is not.
    expect([...p.$('feed').children].map(line => line.hasAttribute('data-mine'))).toEqual([true, false]);
  } finally { p.window.close(); }
});
