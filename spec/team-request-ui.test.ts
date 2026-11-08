import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// Asking to join an adventure from a host's home, in the page: the visitor's
// button in the visit window, and the host's answer in the Team up window.
async function setup() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const host = { ...pet, id: 'host' };
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new window.Event('close')); };
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof window.WebSocket;
  const bodies: any[] = [];
  let answer: ((response: Response) => void) | null = null;
  let lobby: any = { team: null, invitations: [], run: { team: null, state: 'new' }, size: 4 };
  window.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/team') {
      if (options?.method === 'POST') { bodies.push(JSON.parse(options.body as string)); return new Promise<Response>((resolve) => { answer = resolve; }); }
      return Response.json(lobby);
    }
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url === '/api/pets?limit=20') return Response.json([pet, host]);
    if (url === '/api/pets/host') return Response.json(host);
    if (url === '/api/adventure') return Response.json({ started: false, restartCost: { stamina: 40, hygiene: 20 } });
    return Response.json([]);
  }) as typeof fetch;
  const $ = (id: string) => window.document.getElementById(id)!;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  // As in index.html: team-news.js shows team notices in the bottom-right banner.
  for (const file of ['app.js', 'adventure.js', 'team-news.js']) window.eval(readFileSync(`public/${file}`, 'utf8'));
  await vi.waitFor(() => expect(window.document.querySelectorAll('.visit-btn')).toHaveLength(1));
  return {
    dom, window, $, pet, send, bodies,
    answer: (response: Response) => answer!(response),
    setLobby: (next: any) => { lobby = next; },
  };
}

it('asks to join an online host from their home, and hears their answer from the saved team', async () => {
  const p = await setup();
  try {
    (p.window.document.querySelector('.visit-btn[data-pet="host"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(p.$('visit').hidden).toBe(false));
    const ask = p.$('visit-ask-join') as HTMLButtonElement;
    // Offline hosts can't answer, so they can't be asked.
    p.send({ type: 'presence:updated', players: [p.pet.id] });
    expect(ask.disabled).toBe(true);
    expect(p.$('visit-join-hint').textContent).toContain('host is offline');
    p.send({ type: 'presence:updated', players: [p.pet.id, 'host'] });
    expect(ask.disabled).toBe(false);
    expect(ask.textContent).toBe('Ask to join');
    ask.click();
    ask.click();
    expect(p.bodies).toEqual([{ action: 'ask', player: 'host' }]);
    expect(ask.textContent).toBe('Asking…');
    p.answer(Response.json({ team: null, invitations: [], run: { team: null, state: 'new' }, size: 4 }));
    await vi.waitFor(() => expect(ask.textContent).toBe('Asked'));
    expect(ask.disabled).toBe(true);
    expect(p.$('visit-join-news').textContent).toBe("You asked to join host's adventure.");
    // The host lets us in: their team, as saved, says so.
    p.send({ type: 'team:updated', team: { id: 9, leader: 'host', status: 'forming', members: [
      { id: 'host', joined: true, requested: false }, { id: p.pet.id, joined: true, requested: false },
    ] } });
    await vi.waitFor(() => expect(p.$('visit-join-news').textContent).toBe('host let you in! Open Adventure to see your team.'));
    expect(ask.textContent).toBe('Ask to join');
  } finally { p.dom.window.close(); }
});

it("shows a visitor's request to the host, who lets them in or turns them down", async () => {
  const p = await setup();
  try {
    // Wherever the host is, a request arrives as a notice.
    p.send({ type: 'team:requested', request: { team: 4, leader: p.pet.id, player: 'visitor' } });
    expect(p.$('notice').textContent).toBe('visitor asked to join your adventure team. Open Adventure to let them in.');
    // Someone else's request isn't news here.
    p.send({ type: 'team:requested', request: { team: 5, leader: 'someone', player: 'other' } });
    expect(p.$('notice').textContent).toContain('visitor asked');
    // In the Team up window, the request has its own answers for the leader.
    p.setLobby({ team: { id: 4, leader: p.pet.id, status: 'forming', members: [
      { id: p.pet.id, color: '#123456', appearance: 'cat', joined: true, requested: false, waiting: null },
      { id: 'visitor', color: '#654321', appearance: 'dog', joined: false, requested: true, waiting: null },
    ] }, invitations: [], run: { team: null, state: 'new' }, size: 4 });
    p.$('adventure-team-up').click();
    await vi.waitFor(() => expect((p.$('team-dialog') as HTMLDialogElement).open).toBe(true));
    const row = p.$('team-members').querySelector('.team-request')!;
    expect(row.textContent).toContain('Asked to join');
    const letIn = row.querySelector<HTMLButtonElement>('button[aria-label="Let visitor join your team"]')!;
    expect(row.querySelector('button[aria-label="Turn down visitor\'s request"]')).not.toBeNull();
    letIn.click();
    expect(p.bodies).toEqual([{ action: 'answer', player: 'visitor', accept: true }]);
  } finally { p.dom.window.close(); }
});
