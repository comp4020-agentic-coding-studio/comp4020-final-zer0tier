import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// The town goal in the page: a small bar on the town map and the fountain's
// window, both drawn from what the server says.
const WEEK = Date.UTC(2026, 10, 9), ENDS = Date.UTC(2026, 10, 16);
const shared = (meals: number, helpers = 3) => ({ week: WEEK, endsAt: ENDS, target: 100, meals, helpers, reached: meals >= 100, reward: { money: 25, food: 1 } });

async function setup() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  vi.spyOn(window.Date, 'now').mockImplementation(() => Date.UTC(2026, 10, 12, 12));
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
  let status: any = { ...shared(37), mine: { meals: 0, claimed: false, canClaim: false } };
  let answer: ((response: Response) => void) | null = null;
  const reads: string[] = [], posts: string[] = [];
  window.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/town-goal') { reads.push(url); return Response.json(status); }
    if (options?.method === 'POST') { posts.push(url); return new Promise<Response>((resolve) => { answer = resolve; }); }
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url === '/api/world') return Response.json({ online: [pet.id], players: [] });
    if (url === `/api/pets/${pet.id}`) return Response.json(pet);
    return Response.json([]);
  }) as typeof fetch;
  const $ = (id: string) => window.document.getElementById(id)!;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  for (const file of ['app.js', 'town-goal.js', 'world.js']) window.eval(readFileSync(`public/${file}`, 'utf8'));
  await vi.waitFor(() => expect($('town-goal-bar-label').textContent).toBe('Town goal · 37 / 100 meals'));
  return {
    dom, window, $, pet, send, reads, posts,
    setStatus: (next: any) => { status = next; },
    answer: (response: Response) => answer!(response),
  };
}

it('shows the town goal as a small bar that opens the fountain window, moving live with each meal', async () => {
  const p = await setup();
  try {
    // The bar lives with the activity bar; the stylesheet shows it only in town.
    expect(p.$('town-goal-bar').closest('.world-main')).not.toBeNull();
    expect(p.$('town-goal-bar').closest('.world-main')!.contains(p.$('town-activity'))).toBe(true);
    expect(p.$('town-goal-bar').hidden).toBe(false);
    expect(p.$('town-goal-bar-progress').getAttribute('aria-valuenow')).toBe('37');
    expect(p.$('town-goal-bar-progress').getAttribute('aria-valuetext')).toBe('37 of 100 meals');
    expect(Number(p.$('town-goal-bar-fill').style.getPropertyValue('--fill'))).toBeCloseTo(0.37);
    // A meal anywhere in town moves every bar. An older total never winds it back.
    p.send({ type: 'town:goal', goal: shared(38) });
    expect(p.$('town-goal-bar-label').textContent).toBe('Town goal · 38 / 100 meals');
    p.send({ type: 'town:goal', goal: shared(36) });
    expect(p.$('town-goal-bar-label').textContent).toBe('Town goal · 38 / 100 meals');
    // Someone else's meal doesn't send this window back to the server.
    const readsBefore = p.reads.length;
    p.send({ type: 'town:goal', goal: shared(39) });
    expect(p.reads.length).toBe(readsBefore);
    // The bar is a button: pressing it opens the fountain's window.
    p.$('town-goal-bar').click();
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('world-dialog').dataset.place).toBe('goal');
    expect(p.$('town-goal').closest('[hidden]')).toBeNull();
    expect(p.$('town-goal-target').textContent).toBe('Feed 100 pets as a town this week');
    expect(p.$('town-goal-count').textContent).toBe('39 meals served · 61 to go');
    expect(p.$('town-goal-mine').textContent).toBe('0');
    expect(p.$('town-goal-helpers').textContent).toBe('3');
    // Days while there are plenty; hours too once fewer than three days are left.
    expect(p.$('town-goal-ends').textContent).toBe('in 3 days');
    p.send({ type: 'town:goal', goal: { ...shared(39), endsAt: Date.UTC(2026, 10, 14, 18) } });
    expect(p.$('town-goal-ends').textContent).toBe('in 2 days, 6 h');
    p.send({ type: 'town:goal', goal: { ...shared(39), endsAt: Date.UTC(2026, 10, 12, 17) } });
    expect(p.$('town-goal-ends').textContent).toBe('in 5 h');
    expect(p.$('town-goal-reward').textContent).toContain('Serve one meal this week');
    expect(p.$('town-goal-claim').hidden).toBe(true);
    // The fountain in town opens the same window, by click or Space.
    p.$('world-dialog-close').click();
    p.window.document.querySelector<HTMLButtonElement>('[data-town-action="fountain"]')!.click();
    expect(p.$('world-dialog').dataset.place).toBe('goal');
  } finally { p.dom.window.close(); }
});

it("reads its own share again after feeding, and collects the reward once the goal is reached", async () => {
  const p = await setup();
  try {
    // Feeding our pet: its Food drops, then the total moves. Only now do we re-read.
    p.setStatus({ ...shared(99), mine: { meals: 1, claimed: false, canClaim: false } });
    p.send({ type: 'pet:updated', pet: { ...p.pet, food: p.pet.food - 1 } });
    const readsBefore = p.reads.length;
    p.send({ type: 'town:goal', goal: shared(99) });
    await vi.waitFor(() => expect(p.$('town-goal-mine').textContent).toBe('1'));
    expect(p.reads.length).toBe(readsBefore + 1);
    expect(p.$('town-goal-reward').textContent).toContain("You're helping!");
    // Someone else's meal reaches the goal; having helped, we read our share again.
    p.setStatus({ ...shared(100), mine: { meals: 1, claimed: false, canClaim: true } });
    p.send({ type: 'town:goal', goal: shared(100) });
    await vi.waitFor(() => expect(p.$('town-goal-claim').hidden).toBe(false));
    expect(p.$('town-goal-bar').dataset.reached).toBe('true');
    expect(p.$('town-goal-bar').dataset.claimable).toBe('true');
    expect(p.$('town-goal-bar-label').textContent).toBe('Town goal reached · 100 meals');
    expect(p.$('town-goal-count').textContent).toBe('Goal reached! The town served 100 meals.');
    const claim = p.$('town-goal-claim') as HTMLButtonElement;
    expect(claim.textContent).toBe('Collect $25 and 1 Food');
    claim.focus();
    claim.click();
    claim.click();
    expect(p.posts).toEqual(['/api/town-goal/claim']);
    expect(claim.textContent).toBe('Collecting…');
    p.answer(Response.json({ ...shared(100), mine: { meals: 1, claimed: true, canClaim: false } }));
    await vi.waitFor(() => expect(p.$('town-goal-news').textContent).toBe("Collected $25 and 1 Food. It's in your backpack."));
    expect(claim.hidden).toBe(true);
    expect(p.window.document.activeElement).toBe(p.$('town-goal-news'));
    expect(p.$('town-goal-reward').textContent).toContain('You collected this week');
    expect(p.$('town-goal-bar').dataset.claimable).toBe('false');
  } finally { p.dom.window.close(); }
});

it('shows a refused collection and starts a new week from zero', async () => {
  const p = await setup();
  try {
    p.setStatus({ ...shared(100), mine: { meals: 4, claimed: false, canClaim: true } });
    p.send({ type: 'pet:updated', pet: { ...p.pet, food: p.pet.food - 1 } });
    p.send({ type: 'town:goal', goal: shared(100) });
    await vi.waitFor(() => expect(p.$('town-goal-claim').hidden).toBe(false));
    p.$('town-goal-claim').click();
    p.setStatus({ ...shared(100), mine: { meals: 4, claimed: true, canClaim: false } });
    p.answer(Response.json({ error: "You've already collected this week's town reward." }, { status: 409 }));
    await vi.waitFor(() => expect(p.$('town-goal-error').textContent).toBe("You've already collected this week's town reward."));
    await vi.waitFor(() => expect(p.$('town-goal-claim').hidden).toBe(true));
    // Monday: a new week's total arrives, and our share resets with it.
    p.send({ type: 'town:goal', goal: { ...shared(1, 1), week: ENDS, endsAt: ENDS + 7 * 86_400_000 } });
    expect(p.$('town-goal-bar-label').textContent).toBe('Town goal · 1 / 100 meals');
    expect(p.$('town-goal-mine').textContent).toBe('0');
    expect(p.$('town-goal-bar').dataset.reached).toBe('false');
    // Last week's news can't come back.
    p.send({ type: 'town:goal', goal: shared(100) });
    expect(p.$('town-goal-bar-label').textContent).toBe('Town goal · 1 / 100 meals');
  } finally { p.dom.window.close(); }
});
