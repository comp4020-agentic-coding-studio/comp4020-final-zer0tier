// Team news: a short notice at the bottom right when you're invited to a
// team, when someone joins yours, and when you join someone's, plus a small
// status bar at the top centre while you're on a team that's getting ready.
//
// Everything comes from team:updated broadcasts, each the whole team as saved:
// comparing it with the last copy of the same team says what changed. Nothing
// is guessed or applied ahead of the server.
const newsEl = (id) => document.getElementById(id);
let newsPlayer = null; // the signed-in pet's ID, from app.js
const lastSeen = new Map(); // team ID -> the team as last broadcast
let myTeam = null; // the forming team this player has joined, as saved
let noticeTimer = 0;

// Shows a notice in the shared bottom-right banner, then clears it, unless
// something newer took its place meanwhile.
function notify(text) {
  const notice = newsEl('notice');
  if (!notice) return;
  notice.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { if (notice.textContent === text) notice.textContent = ''; }, 6000);
}
// Other modules' team notices go through the same banner and timer.
document.addEventListener('team:notice', ({ detail }) => { if (typeof detail === 'string') notify(detail); });

function renderStatus() {
  const bar = newsEl('team-status-bar');
  const forming = myTeam && myTeam.status === 'forming';
  bar.hidden = !forming || !newsPlayer;
  if (!forming) return;
  const joined = myTeam.members.filter((m) => m.joined).length;
  const leading = myTeam.leader === newsPlayer;
  newsEl('team-status-text').textContent = `${leading ? 'Your team' : `${myTeam.leader}'s team`} · ${joined} of 4 joined`;
  newsEl('team-status-hint').textContent = leading
    ? (joined < 2 ? 'Waiting for someone to join' : 'Open Adventure to set off together')
    : `Waiting for ${myTeam.leader} to set off`;
}

function onTeam(team) {
  if (!newsPlayer || !team?.members) return;
  const before = lastSeen.get(team.id);
  lastSeen.set(team.id, team);
  const me = team.members.find((m) => m.id === newsPlayer);
  const wasMe = before?.members.find((m) => m.id === newsPlayer);
  // Notices only for changes we saw happen, never for a team first heard of
  // mid-way (except a fresh invitation, which is news whenever it arrives).
  if (me && !me.joined && !me.requested && !wasMe && team.leader !== newsPlayer && team.status === 'forming') {
    notify(`${team.leader} invited you to their adventure team. Open Adventure to join.`);
  }
  // Accepting an invitation. (Being let in after asking has its own notice.)
  if (me?.joined && wasMe && !wasMe.joined && !wasMe.requested && team.leader !== newsPlayer) {
    notify(`You joined ${team.leader}'s adventure team.`);
  }
  if (before && team.leader === newsPlayer) {
    for (const member of team.members) {
      const earlier = before.members.find((m) => m.id === member.id);
      if (member.joined && member.id !== newsPlayer && earlier && !earlier.joined) notify(`${member.id} joined your adventure team.`);
    }
  }
  // The team you're on, for the status bar. Setting off or disbanding ends it.
  if (me?.joined && team.status === 'forming') myTeam = team;
  else if (myTeam?.id === team.id) myTeam = null;
  renderStatus();
}

document.addEventListener('team:updated', ({ detail }) => onTeam(detail));
// The Team up window reads the team as saved on opening; seed from that too,
// so a team joined in another window still shows its status here.
document.addEventListener('team:loaded', ({ detail }) => {
  if (!newsPlayer || !detail) return;
  const team = detail.team;
  if (team) { lastSeen.set(team.id, team); myTeam = team.status === 'forming' ? team : null; }
  else myTeam = null;
  for (const invitation of detail.invitations ?? []) lastSeen.set(invitation.id, invitation);
  renderStatus();
});
document.addEventListener('adventure:pet', ({ detail }) => {
  if (newsPlayer === detail.id) return;
  newsPlayer = detail.id;
  lastSeen.clear();
  myTeam = null;
  renderStatus();
});
document.addEventListener('adventure:reset', () => {
  newsPlayer = null;
  lastSeen.clear();
  myTeam = null;
  clearTimeout(noticeTimer);
  renderStatus();
});
renderStatus();
