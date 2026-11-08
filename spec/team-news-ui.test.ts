import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl } from './helpers.ts';

// Team news in the page: bottom-right notices for invitations and joins, and a
// top-centre status bar while you're on a forming team. All from team:updated.
function setup(me = 'me') {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(readFileSync('public/team-news.js', 'utf8'));
  const $ = (id: string) => window.document.getElementById(id)!;
  const fire = (name: string, detail: unknown) => window.document.dispatchEvent(new window.CustomEvent(name, { detail }));
  fire('adventure:pet', { id: me });
  const member = (id: string, joined: boolean, requested = false) => ({ id, joined, requested, color: '#123456', appearance: 'cat', waiting: null });
  const team = (id: number, leader: string, members: any[], status = 'forming') => ({ id, leader, status, members });
  return { dom, window, $, fire, member, team };
}

it('tells you at the bottom right when you are invited, and when you join, then clears itself', () => {
  vi.useFakeTimers();
  const p = setup();
  try {
    p.fire('team:updated', p.team(1, 'host', [p.member('host', true), p.member('me', false)]));
    expect(p.$('notice').textContent).toBe('host invited you to their adventure team. Open Adventure to join.');
    p.fire('team:updated', p.team(1, 'host', [p.member('host', true), p.member('me', true)]));
    expect(p.$('notice').textContent).toBe("You joined host's adventure team.");
    // It clears itself after a few seconds.
    vi.advanceTimersByTime(6100);
    expect(p.$('notice').textContent).toBe('');
  } finally { vi.useRealTimers(); p.dom.window.close(); }
});

it("tells the host when someone joins, and shows the team's status at the top centre until it sets off", () => {
  const p = setup('host');
  try {
    expect(p.$('team-status-bar').hidden).toBe(true);
    p.fire('team:updated', p.team(2, 'host', [p.member('host', true), p.member('pal', false)]));
    // The host is on a forming team: the status bar shows, top centre.
    expect(p.$('team-status-bar').hidden).toBe(false);
    expect(p.$('team-status-text').textContent).toBe('Your team · 1 of 4 joined');
    expect(p.$('team-status-hint').textContent).toBe('Waiting for someone to join');
    p.fire('team:updated', p.team(2, 'host', [p.member('host', true), p.member('pal', true)]));
    expect(p.$('notice').textContent).toBe('pal joined your adventure team.');
    expect(p.$('team-status-text').textContent).toBe('Your team · 2 of 4 joined');
    expect(p.$('team-status-hint').textContent).toBe('Open Adventure to set off together');
    // Setting off ends the forming team, and the bar goes.
    p.fire('team:updated', p.team(2, 'host', [p.member('host', true), p.member('pal', true)], 'exploring'));
    expect(p.$('team-status-bar').hidden).toBe(true);
  } finally { p.dom.window.close(); }
});

it("shows a member which team they're on, says nothing twice for a visitor let in, and ignores other players' teams", () => {
  const p = setup();
  try {
    // A visitor who asked and was let in already hears "let you in" from the visit.
    p.fire('team:updated', p.team(3, 'host', [p.member('host', true), p.member('me', false, true)]));
    expect(p.$('notice').textContent).toBe('');
    p.fire('team:updated', p.team(3, 'host', [p.member('host', true), p.member('me', true)]));
    expect(p.$('notice').textContent).toBe('');
    expect(p.$('team-status-text').textContent).toBe("host's team · 2 of 4 joined");
    expect(p.$('team-status-hint').textContent).toBe('Waiting for host to set off');
    // Someone else's team, which we're not on, says nothing.
    p.fire('team:updated', p.team(4, 'other', [p.member('other', true), p.member('stranger', true)]));
    expect(p.$('notice').textContent).toBe('');
    expect(p.$('team-status-text').textContent).toBe("host's team · 2 of 4 joined");
    // The host disbands: no team to show.
    p.fire('team:updated', p.team(3, 'host', [], 'disbanded'));
    expect(p.$('team-status-bar').hidden).toBe(true);
  } finally { p.dom.window.close(); }
});
