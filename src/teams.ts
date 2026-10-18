import { db, transaction } from './db.ts';
import { getPet } from './pets.ts';
import { runFor, setOffRefusal, startTeamRun } from './adventure.ts';

// A team forms in the Team up window before an adventure: its leader invites
// other players by ID, they accept or decline, and the leader sets everyone
// off together on one shared map.
export const TEAM_SIZE = 4;

export type TeamMember = {
  id: string; color: string; appearance: string;
  joined: boolean; // false while only invited
  waiting: string | null; // why a joined pet can't set off yet, or null once it can
};
export type Team = {
  id: number; leader: string; status: 'forming' | 'exploring' | 'disbanded';
  members: TeamMember[]; // the leader first, then joined pets, then invitations
};
export type TeamOutcome = { team: Team } | { status: 400 | 404 | 409; error: string };

type Row = { id: number; leader: string; status: Team['status'] };
type MemberRow = { id: string; color: string; appearance: string; joined: number };

// Once a team sets off, its members are the pets whose runs are on its map.
// A disbanded team has none.
function read(teamId: number): Team {
  const row = db.prepare('SELECT id, leader, status FROM teams WHERE id = ?').get(teamId) as Row;
  const rows = (row.status === 'exploring'
    ? db.prepare(`SELECT a.player_id AS id, p.color, p.appearance, 1 AS joined FROM adventures a JOIN pets p ON p.id = a.player_id
        WHERE a.team_id = ? ORDER BY a.player_id = ? DESC, a.player_id`).all(teamId, row.leader)
    : db.prepare(`SELECT m.player_id AS id, p.color, p.appearance, m.joined FROM team_members m JOIN pets p ON p.id = m.player_id
        WHERE m.team_id = ? ORDER BY m.player_id = ? DESC, m.joined DESC, m.rowid`).all(teamId, row.leader)) as MemberRow[];
  return {
    ...row,
    members: rows.map(m => ({
      ...m, joined: m.joined === 1,
      waiting: m.joined === 1 && row.status === 'forming' ? setOffRefusal(m.id) ?? null : null,
    })),
  };
}

// The forming team the pet has joined, if any.
const joinedTeam = (id: string) => (db.prepare(
  "SELECT t.id FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.player_id = ? AND m.joined = 1 AND t.status = 'forming'",
).get(id) as { id: number } | undefined)?.id;

// Everything the Team up window shows: the forming team the pet is on, the
// invitations waiting for it, and its own run.
export function teamFor(id: string) {
  const teamId = joinedTeam(id);
  const invitations = (db.prepare(`SELECT t.id FROM teams t JOIN team_members m ON m.team_id = t.id
      WHERE m.player_id = ? AND m.joined = 0 AND t.status = 'forming' ORDER BY t.id`).all(id) as { id: number }[])
    .map(row => read(row.id));
  return { team: teamId === undefined ? null : read(teamId), invitations, run: runFor(id), size: TEAM_SIZE };
}

const refuse = (error: string, status: 400 | 404 | 409 = 409) => ({ status, error });

// The forming team the pet leads, or a new one with just the pet.
function ledBy(id: string): number | ReturnType<typeof refuse> {
  const teamId = joinedTeam(id);
  if (teamId !== undefined) {
    return read(teamId).leader === id ? teamId : refuse('Only the team leader can invite players.');
  }
  const created = db.prepare('INSERT INTO teams (leader) VALUES (?)').run(id);
  db.prepare('INSERT INTO team_members (team_id, player_id, joined) VALUES (?, ?, 1)').run(created.lastInsertRowid, id);
  return Number(created.lastInsertRowid);
}

export function invite(id: string, other: string): TeamOutcome {
  if (other === id) return refuse("You're already on your own team.", 400);
  if (!getPet(other) || !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(other)) return refuse(`No player called ${other}.`, 404);
  return transaction(() => {
    const teamId = ledBy(id);
    if (typeof teamId !== 'number') return teamId;
    const already = read(teamId).members;
    const member = already.find(m => m.id === other);
    if (member) return refuse(`${other} is already ${member.joined ? 'on your team' : 'invited'}.`);
    if (already.length >= TEAM_SIZE) return refuse(`A team holds at most ${TEAM_SIZE} pets, invitations included.`);
    db.prepare('INSERT INTO team_members (team_id, player_id, joined) VALUES (?, ?, 0)').run(teamId, other);
    return { team: read(teamId) };
  });
}

export function accept(id: string, teamId: number): TeamOutcome {
  return transaction(() => {
    const invited = db.prepare(`SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id
        WHERE m.team_id = ? AND m.player_id = ? AND m.joined = 0 AND t.status = 'forming'`).get(teamId, id);
    if (!invited) return refuse('That invitation is no longer open.', 404);
    if (joinedTeam(id) !== undefined) return refuse('Leave your current team before joining another.');
    db.prepare('UPDATE team_members SET joined = 1 WHERE team_id = ? AND player_id = ?').run(teamId, id);
    return { team: read(teamId) };
  });
}

// Declining an invitation, or leaving a forming team. When the leader leaves,
// the team disbands.
export function leave(id: string, teamId: number): TeamOutcome {
  return transaction(() => {
    const row = db.prepare(`SELECT t.leader FROM team_members m JOIN teams t ON t.id = m.team_id
        WHERE m.team_id = ? AND m.player_id = ? AND t.status = 'forming'`).get(teamId, id) as { leader: string } | undefined;
    if (!row) return refuse("You're not on that team.", 404);
    if (row.leader === id) {
      db.prepare("UPDATE teams SET status = 'disbanded' WHERE id = ?").run(teamId);
      db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
    } else {
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND player_id = ?').run(teamId, id);
    }
    return { team: read(teamId) };
  });
}

// Only those who joined set off; invitations still pending lapse.
export function setOff(id: string): TeamOutcome {
  return transaction(() => {
    const teamId = joinedTeam(id);
    if (teamId === undefined) return refuse('Invite a teammate first.');
    const team = read(teamId);
    if (team.leader !== id) return refuse('Only the team leader can set off.');
    const joined = team.members.filter(m => m.joined);
    if (joined.length < 2) return refuse('Wait for at least one invited player to join.');
    const waiting = joined.find(m => m.waiting);
    if (waiting) return refuse(`${waiting.id === id ? 'Your pet' : waiting.id} ${waiting.waiting}.`);
    startTeamRun(teamId, joined.map(m => m.id));
    db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
    return { team: read(teamId) };
  });
}
