import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// Friends in the page: star buttons in the Arena and while visiting, the
// Friends window with live online status, one-press visits, and one-press
// team invites. The list changes only from what the server says.
async function setup() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const neighbour = { ...pet, id: 'neighbour', color: '#123456', appearance: 'panda' };
  const faraway = { ...pet, id: 'faraway', color: '#654321', appearance: 'cat' };
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
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
  const posts: string[] = [];
  const bodies: any[] = [];
  let answer: ((response: Response) => void) | null = null;
  let saved: any[] = [{ id: 'faraway', color: faraway.color, appearance: faraway.appearance, at: new Date().toISOString() }];
  let lobby: any = { team: null, invitations: [], run: { team: null, state: 'new' }, size: 4 };
  window.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/team') {
      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      if (body) bodies.push(body);
      if (body?.action === 'invite') lobby = { ...lobby, team: { id: 3, leader: pet.id, status: 'forming', members: [
        { id: pet.id, color: pet.color, appearance: pet.appearance, joined: true, waiting: null },
        { id: body.player, color: '#654321', appearance: 'cat', joined: false, waiting: null },
      ] } };
      return Response.json(lobby);
    }
    if (options?.method === 'POST') {
      posts.push(url);
      return new Promise<Response>((resolve) => { answer = resolve; });
    }
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url === `/api/pets/${pet.id}/friends`) return Response.json(saved);
    if (url === '/api/pets?limit=20') return Response.json([pet, neighbour]);
    if (url === '/api/pets/neighbour') return Response.json(neighbour);
    if (url === '/api/pets/faraway') return Response.json(faraway);
    if (url === '/api/world') return Response.json({ online: [pet.id], players: [] });
    return Response.json([]);
  }) as typeof fetch;
  const $ = (id: string) => window.document.getElementById(id)!;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  const visits: string[] = [];
  window.document.addEventListener('home:visit', (e) => visits.push((e as CustomEvent).detail.id));
  for (const file of ['app.js', 'confirm.js', 'adventure.js', 'friends.js', 'world.js']) window.eval(readFileSync(`public/${file}`, 'utf8'));
  await vi.waitFor(() => expect(window.document.querySelectorAll('.visit-btn')).toHaveLength(1));
  await vi.waitFor(() => expect($('friends-list').children).toHaveLength(1));
  return {
    dom, window, $, pet, send, posts, bodies, visits,
    answer: (response: Response) => answer!(response),
    setSaved: (list: any[]) => { saved = list; },
  };
}
const starIn = (root: Element, id: string) => root.querySelector<HTMLButtonElement>(`[data-star="${id}"]`)!;

it('stars a pet from the Arena, saved first, then pressed in every place that shows it', async () => {
  const p = await setup();
  try {
    const arena = starIn(p.$('rivals'), 'neighbour');
    expect(arena.getAttribute('aria-pressed')).toBe('false');
    expect(arena.getAttribute('aria-label')).toBe('Star neighbour as a friend');
    // The bot has no star: it isn't a player you can befriend.
    expect(p.$('rivals').querySelectorAll('[data-star]')).toHaveLength(1);
    arena.focus();
    arena.click();
    arena.click();
    expect(p.posts).toEqual([`/api/pets/${p.pet.id}/star/neighbour`]);
    expect(arena.getAttribute('aria-busy')).toBe('true');
    expect(arena.disabled).toBe(false);
    // Nothing changes until the server says so.
    expect(arena.getAttribute('aria-pressed')).toBe('false');
    const list = [
      { id: 'faraway', color: '#654321', appearance: 'cat', at: new Date().toISOString() },
      { id: 'neighbour', color: '#123456', appearance: 'panda', at: new Date().toISOString() },
    ];
    p.answer(Response.json(list));
    p.send({ type: 'friends:updated', player: p.pet.id, friends: list });
    await vi.waitFor(() => expect(starIn(p.$('rivals'), 'neighbour').getAttribute('aria-busy')).toBe('false'));
    expect(starIn(p.$('rivals'), 'neighbour').getAttribute('aria-pressed')).toBe('true');
    expect(p.$('friends-list').children).toHaveLength(2);
    // Another player's list never lands in this window.
    p.send({ type: 'friends:updated', player: 'someone-else', friends: [] });
    expect(p.$('friends-list').children).toHaveLength(2);
    // Visiting shows the same star, already pressed.
    (p.window.document.querySelector('.visit-btn[data-pet="neighbour"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(p.$('visit').hidden).toBe(false));
    expect(p.$('visit-star').hidden).toBe(false);
    expect(p.$('visit-star').dataset.star).toBe('neighbour');
    expect(p.$('visit-star').getAttribute('aria-pressed')).toBe('true');
    // Pressing it again unstars, also only once it's saved.
    p.$('visit-star').click();
    expect(p.posts.at(-1)).toBe(`/api/pets/${p.pet.id}/unstar/neighbour`);
    p.answer(Response.json(list.slice(0, 1)));
    p.send({ type: 'friends:updated', player: p.pet.id, friends: list.slice(0, 1) });
    await vi.waitFor(() => expect(p.$('visit-star').getAttribute('aria-pressed')).toBe('false'));
    expect(starIn(p.$('rivals'), 'neighbour').getAttribute('aria-pressed')).toBe('false');
  } finally { p.dom.window.close(); }
});

it('opens Friends from the game menu with live online status and visits a friend in one press', async () => {
  const p = await setup();
  try {
    // The wall clock opens the game menu, as Escape does from the keyboard.
    p.window.document.querySelector<HTMLButtonElement>('[data-home-action="menu"]')!.click();
    expect(p.$('world-dialog').dataset.place).toBe('menu');
    p.$('world-friends').click();
    expect(p.$('world-dialog').dataset.place).toBe('friends');
    expect(p.$('friends').closest('[hidden]')).toBeNull();
    const row = () => p.$('friends-list').firstElementChild as HTMLElement;
    expect(row().textContent).toContain('faraway');
    expect(row().querySelector('.friend-status')!.textContent).toBe('Offline');
    expect(row().querySelector('use')!.getAttribute('href')).toBe('#pet-cat');
    // Presence updates the list live, and the menu button counts who's on.
    p.send({ type: 'presence:updated', players: [p.pet.id, 'faraway'] });
    expect(row().querySelector('.friend-status')!.textContent).toBe('Online');
    expect(p.$('friends-count').textContent).toBe('1 of 1 online');
    expect(p.$('world-friends').textContent).toBe('Friends · 1 online');
    p.send({ type: 'presence:updated', players: [p.pet.id] });
    expect(row().querySelector('.friend-status')!.textContent).toBe('Offline');
    expect(p.$('world-friends').textContent).toBe('Friends');
    // Visit goes straight to their home, offline or not.
    (row().querySelector('[data-friend-visit="faraway"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(p.visits).toEqual(['faraway']));
    expect(p.$('visit-heading').textContent).toBe('Visiting faraway');
  } finally { p.dom.window.close(); }
});

it('stars a player by ID from the Friends window and says so once it is saved', async () => {
  const p = await setup();
  try {
    (p.$('friend-add-id') as HTMLInputElement).value = p.pet.id;
    p.$('friend-add').dispatchEvent(new p.window.Event('submit', { cancelable: true }));
    expect(p.$('friends-error').textContent).toBe("That's you. Star other players to keep them close.");
    (p.$('friend-add-id') as HTMLInputElement).value = 'faraway';
    p.$('friend-add').dispatchEvent(new p.window.Event('submit', { cancelable: true }));
    expect(p.$('friends-news').textContent).toBe('faraway is already a friend.');
    expect(p.posts).toEqual([]);
    (p.$('friend-add-id') as HTMLInputElement).value = 'nobody';
    p.$('friend-add').dispatchEvent(new p.window.Event('submit', { cancelable: true }));
    expect(p.posts).toEqual([`/api/pets/${p.pet.id}/star/nobody`]);
    p.answer(Response.json({ error: 'No player called nobody.' }, { status: 404 }));
    await vi.waitFor(() => expect(p.$('friends-error').textContent).toBe('No player called nobody.'));
    expect((p.$('friend-add-id') as HTMLInputElement).value).toBe('nobody');
    (p.$('friend-add-id') as HTMLInputElement).value = 'neighbour';
    p.$('friend-add').dispatchEvent(new p.window.Event('submit', { cancelable: true }));
    const list = [
      { id: 'faraway', color: '#654321', appearance: 'cat', at: new Date().toISOString() },
      { id: 'neighbour', color: '#123456', appearance: 'panda', at: new Date().toISOString() },
    ];
    p.send({ type: 'friends:updated', player: p.pet.id, friends: list });
    p.answer(Response.json(list));
    await vi.waitFor(() => expect(p.$('friends-news').textContent).toBe('neighbour is now a friend.'));
    expect((p.$('friend-add-id') as HTMLInputElement).value).toBe('');
    expect([...p.$('friends-list').querySelectorAll('b')].map(b => b.textContent)).toEqual(['faraway', 'neighbour']);
  } finally { p.dom.window.close(); }
});

it('invites a friend to a team in one press from the Team up window, online friends first', async () => {
  const p = await setup();
  try {
    p.send({ type: 'friends:updated', player: p.pet.id, friends: [
      { id: 'faraway', color: '#654321', appearance: 'cat', at: new Date().toISOString() },
      { id: 'neighbour', color: '#123456', appearance: 'panda', at: new Date().toISOString() },
    ] });
    p.send({ type: 'presence:updated', players: [p.pet.id, 'neighbour'] });
    // The finished-run panel's Team up opens the same window a first adventure does.
    p.$('adventure-team-up').click();
    await vi.waitFor(() => expect((p.$('team-dialog') as HTMLDialogElement).open).toBe(true));
    expect(p.$('team-friends').hidden).toBe(false);
    const rows = () => [...p.$('team-friend-list').children].map(row => row.textContent);
    expect(rows()).toEqual(['neighbourOnlineInvite', 'farawayOfflineInvite']);
    (p.$('team-invite-id') as HTMLInputElement).value = 'typed';
    p.$('team-friend-list').querySelector<HTMLButtonElement>('[data-invite="neighbour"]')!.click();
    await vi.waitFor(() => expect(rows()[0]).toBe('neighbourInvitedInvite'));
    expect(p.bodies).toEqual([{ action: 'invite', player: 'neighbour' }]);
    expect(p.$('team-friend-list').querySelector<HTMLButtonElement>('[data-invite="neighbour"]')!.disabled).toBe(true);
    expect(p.$('team-friend-list').querySelector<HTMLButtonElement>('[data-invite="faraway"]')!.disabled).toBe(false);
    // Whatever the player typed is still in the ID box.
    expect((p.$('team-invite-id') as HTMLInputElement).value).toBe('typed');
    // A friend going offline updates the open window.
    p.send({ type: 'presence:updated', players: [p.pet.id] });
    expect(rows()).toEqual(['farawayOfflineInvite', 'neighbourInvitedInvite']);
  } finally { p.dom.window.close(); }
});
