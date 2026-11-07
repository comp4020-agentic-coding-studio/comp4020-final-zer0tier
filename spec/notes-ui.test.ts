import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// The guestbook in the page: phrase buttons while visiting, and the owner's
// notes in the Journal, both drawn only from what the server broadcasts.
async function setup() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const neighbour = { ...pet, id: 'neighbour' };
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof window.WebSocket;
  const posts: { url: string; body: any }[] = [];
  let answer: ((response: Response) => void) | null = null;
  const saved = [{ id: 1, visitor: 'ana', pet: pet.id, phrase: 'food', at: new Date().toISOString() }];
  window.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push({ url, body: options.body ? JSON.parse(options.body as string) : undefined });
      return new Promise<Response>((resolve) => { answer = resolve; });
    }
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url === `/api/pets/${pet.id}/notes`) return Response.json(saved);
    if (url === '/api/pets?limit=20') return Response.json([pet, neighbour]);
    if (url === '/api/pets/neighbour') return Response.json(neighbour);
    return Response.json([]);
  }) as typeof fetch;
  const $ = (id: string) => window.document.getElementById(id)!;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  for (const file of ['app.js', 'confirm.js', 'interact.js', 'notes.js']) window.eval(readFileSync(`public/${file}`, 'utf8'));
  await vi.waitFor(() => expect(window.document.querySelectorAll('.visit-btn')).toHaveLength(1));
  return { window, $, pet, send, posts, answer: (response: Response) => answer!(response) };
}

it('leaves one fixed phrase per press while visiting, and confirms it only from the broadcast', async () => {
  const p = await setup();
  try {
    (p.window.document.querySelector('.visit-btn[data-pet="neighbour"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(p.$('note-phrases').children).toHaveLength(8));
    const buttons = () => [...p.$('note-phrases').querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons().map(b => b.textContent)).toContain('Rematch?');
    expect(p.$('note-hint').textContent).toBe("Pick a note for neighbour's owner. They'll find it in their Journal.");
    const rematch = buttons().find(b => b.dataset.phrase === 'rematch')!;
    rematch.focus();
    rematch.click();
    rematch.click();
    expect(p.posts).toEqual([{ url: `/api/pets/${p.pet.id}/note/neighbour`, body: { phrase: 'rematch' } }]);
    expect(buttons().find(b => b.dataset.phrase === 'rematch')!.textContent).toBe('Sending…');
    expect(p.window.document.activeElement?.getAttribute('data-phrase')).toBe('rematch');
    expect(buttons().filter(b => b.dataset.phrase !== 'rematch').every(b => b.disabled)).toBe(true);
    const note = { id: 9, visitor: p.pet.id, pet: 'neighbour', phrase: 'rematch', at: new Date().toISOString() };
    p.answer(Response.json(note));
    await vi.waitFor(() => expect(p.$('note-hint').textContent).toBe('Note sent. You can leave another in a few seconds.'));
    expect(buttons().every(b => b.disabled)).toBe(true);
    expect(p.$('note-news').textContent).toBe('');
    p.send({ type: 'pet:noted', note });
    expect(p.$('note-news').textContent).toBe('You left neighbour a note: “Rematch?”');
  } finally { p.window.close(); }
});

it("shows the owner's notes in the Journal, adds new ones live, and clears them after a Yes", async () => {
  const p = await setup();
  try {
    await vi.waitFor(() => expect(p.$('guestbook-notes').children).toHaveLength(1));
    expect(p.$('guestbook-notes').textContent).toContain('ana wrote Thanks for the food!');
    expect(p.$('guestbook-empty').hidden).toBe(true);
    p.send({ type: 'pet:noted', note: { id: 2, visitor: 'ben', pet: p.pet.id, phrase: 'adorable', at: new Date().toISOString() } });
    expect(p.$('guestbook-notes').firstElementChild!.textContent).toContain('ben wrote Your pet is adorable!');
    expect(p.$('notice').textContent).toBe('ben left you a note: “Your pet is adorable!”');
    // Clearing asks in the game's own Yes/No window first.
    p.$('guestbook-clear').click();
    await vi.waitFor(() => expect((p.$('confirm-dialog') as HTMLDialogElement).open).toBe(true));
    expect(p.$('confirm-dialog').textContent).toContain('All 2 notes will be gone for good.');
    expect(p.posts).toEqual([]);
    p.$('confirm-yes').click();
    await vi.waitFor(() => expect(p.posts).toEqual([{ url: `/api/pets/${p.pet.id}/notes/clear`, body: undefined }]));
    // The list empties only when the broadcast says so.
    expect(p.$('guestbook-notes').children).toHaveLength(2);
    p.answer(Response.json({ cleared: 2 }));
    p.send({ type: 'notes:cleared', pet: p.pet.id });
    await vi.waitFor(() => expect(p.$('guestbook-notes').children).toHaveLength(0));
    expect(p.$('guestbook-empty').hidden).toBe(false);
    expect(p.$('guestbook-clear').hidden).toBe(true);
  } finally { p.window.close(); }
});
