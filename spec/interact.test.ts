import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// Touching your own pet is only for fun: it plays a reaction in this window
// and never asks the server for anything. Touching a pet you're visiting goes
// to the server, and the pet reacts when the pet:touched broadcast arrives.
function page(saved: object[] = []) {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  let answer = (): Response => Response.json({});
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') return answer();
    if (url.endsWith('/touches')) return Response.json(saved);
    throw new Error(`Unexpected request: ${url}`);
  });
  window.fetch = requests as unknown as typeof fetch;
  window.eval(readFileSync('public/interact.js', 'utf8'));
  const fire = (type: string, detail?: unknown) => window.document.dispatchEvent(new window.CustomEvent(type, { detail }));
  const signIn = (pet: object) => fire('adventure:pet', pet);
  const visit = (pet: object | null) => fire('visit:pet', pet);
  const touched = (touch: object) => fire('pet:touched', touch);
  // Clicks the 120 × 110 drawing at (x, y), drawn 240 × 220 pixels at (100, 50).
  const touchAt = (x: number, y: number, svg = 'pet-avatar') => {
    $(svg).getBoundingClientRect = () => ({ left: 100, top: 50, width: 240, height: 220 }) as DOMRect;
    $(svg).dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 100 + x * 2, clientY: 50 + y * 2 }));
  };
  const posts = () => requests.mock.calls.filter(([, options]) => options?.method === 'POST');
  const reply = (response: () => Response) => { answer = response; };
  return { dom, window, $, requests, posts, reply, signIn, visit, touched, touchAt };
}
// Words that only that touch's lines use.
const SAYS = { pat: /head|pats|leans into your hand/, tickle: /giggles|laughing|wriggles/, stroke: /nuzzles|purrs|blinks/, paw: /paw|high-fives|holds your hand/ };

it('reacts to a pat, tickle, stroke, or paw shake where your own pet is touched, without a server request', async () => {
  const { dom, $, requests, posts, signIn, touchAt } = page();
  try {
    touchAt(60, 25); // before sign-in there is no pet to react
    expect($('pet-reaction').textContent).toBe('');
    expect($('pet-touch').dataset.reaction).toBe('');
    signIn({ id: 'rex', activity: 'idle' });
    await vi.waitFor(() => expect(requests).toHaveBeenCalledWith('/api/pets/rex/touches'));
    const cases: [number, number, keyof typeof SAYS][] = [
      [60, 25, 'pat'], // top of the head
      [60, 52, 'pat'], // between the eyes
      [60, 78, 'tickle'], // belly
      [22, 58, 'stroke'], // left cheek
      [98, 58, 'stroke'], // right cheek
      [45, 96, 'paw'], // feet
      [20, 82, 'paw'], // a lower corner
    ];
    for (const [x, y, kind] of cases) {
      touchAt(x, y);
      expect($('pet-touch').dataset.reaction, `(${x}, ${y})`).toBe(kind);
      expect($('pet-reaction').textContent).toMatch(/^rex /);
      expect($('pet-reaction').textContent).toMatch(SAYS[kind]);
    }
    // Each touch floats one decorative effect, hidden from screen readers.
    expect($('pet-touch').querySelectorAll('.pet-effect')).toHaveLength(cases.length);
    expect($('pet-touch').querySelector('.pet-effects')!.getAttribute('aria-hidden')).toBe('true');
    expect(posts()).toHaveLength(0);
    expect(requests).toHaveBeenCalledTimes(1); // only the visitors list
  } finally { dom.window.close(); }
});

it('offers every touch as a keyboard-reachable button, announces the reaction, and varies the lines', () => {
  const { dom, window, $, posts, signIn } = page();
  try {
    signIn({ id: 'rex', activity: 'idle' });
    expect($('pet-reaction').getAttribute('role')).toBe('status');
    const buttons = [...window.document.querySelectorAll<HTMLButtonElement>('[data-touch]')];
    expect(buttons.map(b => [b.textContent, b.type])).toEqual([
      ['Pat head', 'button'], ['Tickle belly', 'button'], ['Stroke cheek', 'button'], ['Shake paw', 'button'],
    ]);
    for (const button of buttons) {
      button.focus();
      button.click();
      expect($('pet-touch').dataset.reaction).toBe(button.dataset.touch);
      expect($('pet-reaction').textContent).toMatch(SAYS[button.dataset.touch as keyof typeof SAYS]);
      expect(window.document.activeElement).toBe(button);
    }
    const pats = new Set<string>();
    for (let i = 0; i < 12; i++) { buttons[0].click(); pats.add($('pet-reaction').textContent!); }
    expect(pats.size).toBeGreaterThan(1);
    expect(posts()).toHaveLength(0);
  } finally { dom.window.close(); }
});

it('a busy pet still reacts, but goes back to its lesson or shift; signing out clears the reaction', () => {
  const { dom, $, signIn, touchAt, window } = page();
  try {
    signIn({ id: 'rex', activity: 'studying' });
    touchAt(60, 25);
    expect($('pet-reaction').textContent).toBe('rex gives a quick happy wiggle, then gets back to studying.');
    signIn({ id: 'rex', activity: 'working' });
    touchAt(60, 78);
    expect($('pet-reaction').textContent).toBe('rex smiles at you between tasks, then gets back to work.');
    expect($('pet-touch').dataset.reaction).toBe('tickle');
    // Signing out (or switching pet) forgets the last pet and its reaction.
    window.document.dispatchEvent(new window.CustomEvent('adventure:reset'));
    expect($('pet-reaction').textContent).toBe('');
    expect($('pet-touch').dataset.reaction).toBe('');
    expect($('pet-touch').querySelectorAll('.pet-effect')).toHaveLength(0);
    touchAt(60, 25);
    expect($('pet-reaction').textContent).toBe('');
    signIn({ id: 'ace', activity: 'idle' });
    window.document.querySelector<HTMLButtonElement>('[data-touch="paw"]')!.click();
    expect($('pet-reaction').textContent).toMatch(/^ace /);
  } finally { dom.window.close(); }
});

it('touching a visited pet asks the server as your pet, and the pet reacts only when the broadcast arrives', async () => {
  const { dom, window, $, requests, posts, reply, signIn, visit, touched, touchAt } = page();
  try {
    signIn({ id: 'rex', activity: 'idle' });
    visit({ id: 'mia', activity: 'idle' });
    expect($('visit-play-help').textContent).toBe("Tap or click mia where you'd like to touch it, or choose:");
    expect($('visit-reaction').getAttribute('role')).toBe('status');
    const buttons = [...window.document.querySelectorAll<HTMLButtonElement>('[data-visit-touch]')];
    expect(buttons.map(b => [b.textContent, b.type])).toEqual([
      ['Pat head', 'button'], ['Tickle belly', 'button'], ['Stroke cheek', 'button'], ['Shake paw', 'button'],
    ]);
    touchAt(60, 78, 'visit-avatar'); // the belly
    expect(requests).toHaveBeenCalledWith('/api/pets/rex/touch/mia', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tickle' }),
    });
    // Nothing plays until the server says the touch happened.
    expect($('visit-touch').dataset.reaction).toBe('');
    expect($('visit-reaction').textContent).toBe('');
    // A second touch while the first is on its way (or just landed) isn't sent.
    buttons[0].click();
    expect(posts()).toHaveLength(1);
    touched({ id: 1, visitor: 'rex', pet: 'mia', kind: 'tickle', at: new Date().toISOString() });
    expect($('visit-touch').dataset.reaction).toBe('tickle');
    expect($('visit-reaction').textContent).toMatch(/^mia /);
    expect($('visit-reaction').textContent).toMatch(SAYS.tickle);
    // Your own pet's dashboard doesn't react to a touch on someone else's.
    expect($('pet-touch').dataset.reaction).toBe('');
    // Someone else touching the pet you're visiting shows up here too.
    touched({ id: 2, visitor: 'zed', pet: 'mia', kind: 'stroke', at: new Date().toISOString() });
    expect($('visit-reaction').textContent).toBe("zed strokes mia's cheek.");
    expect($('visit-touch').dataset.reaction).toBe('stroke');
    // Touches on pets nobody here is showing are ignored.
    touched({ id: 3, visitor: 'zed', pet: 'kim', kind: 'pat', at: new Date().toISOString() });
    expect($('visit-reaction').textContent).toBe("zed strokes mia's cheek.");
    // After the one-second gap, the next touch goes; a refusal is shown.
    reply(() => Response.json({ error: 'Give mia a moment between touches.' }, { status: 429 }));
    await new Promise(resolve => setTimeout(resolve, 1100));
    buttons[3].click();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(String(posts()[1][1]!.body))).toEqual({ kind: 'paw' });
    await vi.waitFor(() => expect($('visit-touch-error').textContent).toBe('Give mia a moment between touches.'));
    // Leaving the visit forgets its reaction.
    visit(null);
    expect($('visit-reaction').textContent).toBe('');
    expect($('visit-touch-error').textContent).toBe('');
    expect($('visit-touch').dataset.reaction).toBe('');
  } finally { dom.window.close(); }
});

it("the owner's pet reacts to a visitor's touch and lists each visitor's latest touch, newest first", async () => {
  const at = new Date().toISOString();
  const { dom, $, signIn, touched } = page([
    { id: 7, visitor: 'zed', pet: 'rex', kind: 'pat', at },
    { id: 4, visitor: 'kim', pet: 'rex', kind: 'paw', at: '2026-01-02T03:04:05.000Z' },
  ]);
  const rows = () => [...$('visitors').querySelectorAll('li > span')].map(li => li.textContent);
  try {
    expect($('visitors-empty').hidden).toBe(false);
    signIn({ id: 'rex', activity: 'working' });
    await vi.waitFor(() => expect(rows()).toEqual(["zed patted your pet's head.", "kim shook your pet's paw."]));
    expect($('visitors-empty').hidden).toBe(true);
    expect($('visitors').querySelector('time')!.dateTime).toBe(at);
    touched({ id: 9, visitor: 'mia', pet: 'rex', kind: 'tickle', at });
    expect($('pet-touch').dataset.reaction).toBe('tickle');
    expect($('pet-reaction').textContent).toBe("mia tickles rex's belly.");
    expect(rows()).toEqual(["mia tickled your pet's belly.", "zed patted your pet's head.", "kim shook your pet's paw."]);
    // A visitor coming back moves up, rather than taking a second row.
    touched({ id: 10, visitor: 'kim', pet: 'rex', kind: 'stroke', at });
    expect(rows()).toEqual(["kim stroked your pet's cheek.", "mia tickled your pet's belly.", "zed patted your pet's head."]);
    // Signing in as someone else starts their own list.
    dom.window.document.dispatchEvent(new dom.window.CustomEvent('adventure:reset'));
    expect(rows()).toEqual([]);
    expect($('visitors-empty').hidden).toBe(false);
  } finally { dom.window.close(); }
});
