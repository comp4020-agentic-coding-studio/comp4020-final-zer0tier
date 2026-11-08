// Two local recordings share one volume control; only one plays at a time.
// Keep the world track paused in place while the battle window is open.
const musicDashboard = document.getElementById('dashboard');
const musicSettingsKey = 'virtuepets:music';
function musicPreferences(value) {
  let saved;
  try { saved = JSON.parse(value); } catch { /* Use the quiet defaults. */ }
  return {
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
    volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
      ? Math.round(Math.max(0, Math.min(100, saved.volume))) : 35,
  };
}
let musicSettings;
try { musicSettings = musicPreferences(localStorage.getItem(musicSettingsKey)); }
catch { musicSettings = musicPreferences(null); }

const musicControls = document.createElement('fieldset');
musicControls.id = 'world-music';
musicControls.innerHTML = `
  <legend>Sound</legend>
  <button type="button" id="music-toggle" class="world-button" aria-pressed="true" aria-describedby="music-status">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg>
    Background music <span id="music-state" aria-hidden="true">On</span>
  </button>
  <div class="music-volume-heading"><label for="music-volume">Volume</label><output id="music-volume-value" for="music-volume"></output></div>
  <input id="music-volume" type="range" min="0" max="100" step="1" value="35">
  <p id="music-status" class="help" role="status"></p>
  <p id="music-credit" class="help">
    Home &amp; town: <a href="https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600063" target="_blank" rel="noopener noreferrer">“Rainbows”</a>.<br>
    Battles: <a href="https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900012" target="_blank" rel="noopener noreferrer">“Raving Energy (faster)”</a>.<br>
    Both by <a href="https://incompetech.com/" target="_blank" rel="noopener noreferrer">Kevin MacLeod</a>.<br>
    Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>; re-encoded smaller, otherwise unchanged.<br>
    Thank you, Kevin, for sharing your music.
  </p>`;
document.getElementById('world-panel-menu').append(musicControls);
const musicToggle = document.getElementById('music-toggle');
const musicVolume = document.getElementById('music-volume');
const musicStatus = document.getElementById('music-status');
const musicTracks = {
  world: { id: 'background-music', title: 'Rainbows', path: '/audio/rainbows.mp3' },
  battle: { id: 'battle-music', title: 'Raving Energy (faster)', path: '/audio/raving-energy-faster.mp3' },
};
for (const track of Object.values(musicTracks)) {
  track.audio = document.createElement('audio');
  track.audio.id = track.id;
  track.audio.loop = true;
  track.audio.preload = 'none';
  track.audio.hidden = true;
  document.body.append(track.audio);
}
let musicTrack = musicTracks.world;
let musicAudio = musicTrack.audio;

let musicActivated = false;
let musicPending = null;
let musicGeneration = 0;
let musicFailure = '';
let musicNeedsGesture = false;
let musicFailed = false;
let musicContext = null;
let musicGain = null;
let musicAway = false;
const musicWanted = () => musicActivated && musicSettings.enabled && musicSettings.volume > 0 &&
  !musicDashboard.hidden && !document.hidden && !musicAway;

function musicRender() {
  musicToggle.setAttribute('aria-pressed', String(musicSettings.enabled));
  document.getElementById('music-state').textContent = musicSettings.enabled ? 'On' : 'Off';
  musicVolume.value = String(musicSettings.volume);
  musicVolume.setAttribute('aria-valuetext', `${musicSettings.volume}%`);
  document.getElementById('music-volume-value').textContent = `${musicSettings.volume}%`;
  const message = !musicSettings.enabled ? 'Music is off.' : musicSettings.volume === 0 ? 'Volume is muted.' :
    musicFailure || (!musicActivated ? 'Click, tap or press a key to start the music.' :
      musicAudio.paused || (musicContext && musicContext.state !== 'running') ? 'Music will resume when you return.' :
        `${musicTrack.title} · Kevin MacLeod`);
  if (musicStatus.textContent !== message) musicStatus.textContent = message;
}

function musicSave() {
  try { localStorage.setItem(musicSettingsKey, JSON.stringify(musicSettings)); }
  catch { /* Controls still work when browser storage is unavailable. */ }
}

function musicSetVolume() {
  const level = musicSettings.volume / 100;
  if (musicGain) {
    // Gain also works on mobile browsers that reserve audio.volume for the
    // device buttons. Smooth adjustments prevent clicks while dragging.
    musicGain.gain.setTargetAtTime(level, musicContext.currentTime, 0.08);
  } else for (const track of Object.values(musicTracks)) track.audio.volume = level;
}

function musicPrepare() {
  if (!musicAudio.getAttribute('src')) musicAudio.src = musicTrack.path;
  else if (musicAudio.error) musicAudio.load();
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!musicContext && Context) {
    musicContext = new Context();
    musicGain = musicContext.createGain();
    musicGain.gain.value = musicSettings.volume / 100;
    musicGain.connect(musicContext.destination);
  }
  if (musicContext && !musicTrack.source) {
    musicTrack.source = musicContext.createMediaElementSource(musicAudio);
    musicTrack.source.connect(musicGain);
    musicAudio.volume = 1;
  }
  musicSetVolume();
}

function musicPause() {
  musicGeneration++;
  musicPending = null;
  for (const { audio } of Object.values(musicTracks)) {
    audio.pause();
    if (musicDashboard.hidden) {
      try { audio.currentTime = 0; } catch { /* No recording loaded yet. */ }
    }
  }
  if (musicContext?.state === 'running') {
    musicContext.suspend().catch(() => {});
  }
}

function musicResume() {
  if (!musicContext) return Promise.resolve();
  return musicContext.resume().then(() => {
    // A mobile audio context can finish unlocking after the player has
    // already muted, signed out, or switched tabs.
    if (!musicWanted() || musicFailed || musicNeedsGesture) {
      musicAudio.pause();
      return musicContext.suspend();
    }
  });
}

function musicSelectTrack() {
  const next = !musicDashboard.hidden && document.getElementById('battle-dialog')?.open
    ? musicTracks.battle : musicTracks.world;
  if (next === musicTrack) return;
  musicGeneration++;
  musicPending = null;
  musicAudio.pause();
  musicTrack = next;
  musicAudio = next.audio;
  // Each new encounter starts fresh. Returning to the map preserves Rainbows.
  if (next === musicTracks.battle) {
    try { musicAudio.currentTime = 0; } catch { /* Load on the next permitted play. */ }
  }
  musicFailure = ''; musicNeedsGesture = false; musicFailed = false;
}

function musicSync() {
  musicSelectTrack();
  if (!musicWanted()) {
    musicPause();
    musicRender();
    return;
  }
  if (musicNeedsGesture || musicFailed) return;
  if (musicPending) return;
  if (!musicAudio.paused && (!musicContext || musicContext.state === 'running')) return;
  const generation = ++musicGeneration;
  const audio = musicAudio;
  try {
    musicPrepare();
    // Both calls happen in the gesture's stack. Awaiting resume before play
    // would lose the media permission in some browsers.
    const resume = musicResume();
    musicPending = Promise.all([resume, audio.play()]);
    musicPending.then(() => {
      if (generation !== musicGeneration) {
        if (audio !== musicAudio) audio.pause();
        if (!musicWanted()) musicPause();
        return;
      }
      musicPending = null;
      if (!musicWanted()) return musicSync();
      musicFailure = '';
      musicRender();
    }).catch(error => {
      if (generation !== musicGeneration) return;
      musicPause();
      musicNeedsGesture = error.name === 'NotAllowedError';
      musicFailed = !musicNeedsGesture;
      musicFailure = musicNeedsGesture
        ? 'Click, tap or press a key to start the music.'
        : 'Music could not play. Switch it off and on to retry.';
      musicRender();
    });
  } catch {
    musicPause();
    musicFailed = true;
    musicFailure = 'Music could not play. Switch it off and on to retry.';
    musicRender();
  }
}

function musicGesture(event) {
  if (event.type === 'keydown' && (event.repeat || event.ctrlKey || event.metaKey || event.altKey)) return;
  musicActivated = true;
  musicNeedsGesture = false;
  // Do not briefly start music while the player is turning it off.
  if (musicControls.contains(event.target)) return;
  if (musicPending && musicContext && musicContext.state !== 'running' && musicWanted()) {
    musicResume().catch(() => {});
  }
  musicSync();
}
for (const type of ['pointerdown', 'click', 'keydown']) {
  document.addEventListener(type, musicGesture, { capture: true });
}
musicToggle.addEventListener('click', () => {
  musicActivated = true;
  musicSettings.enabled = !musicSettings.enabled;
  musicFailure = '';
  musicNeedsGesture = false;
  musicFailed = false;
  if (musicSettings.enabled && musicAudio.error) musicAudio.load();
  musicSave();
  musicSync();
  musicRender();
});
musicVolume.addEventListener('input', () => {
  musicActivated = true;
  musicSettings.volume = Number(musicVolume.value);
  musicSave();
  musicSetVolume();
  musicSync();
  musicRender();
});
for (const { audio } of Object.values(musicTracks)) {
  audio.addEventListener('error', () => {
    // A delayed error from a paused track must not silence its replacement.
    if (audio !== musicAudio) return;
    musicFailed = true;
    musicPause();
    musicFailure = 'Music could not load. Switch it off and on to retry.';
    musicRender();
  });
}
// Observe the result of battle.js handling the event, including its queue.
// A duplicate turn, ignored replay, or unrelated dismissal never changes tracks.
let musicBattleSyncPending = false;
for (const type of ['battle:show', 'battle:closed', 'battle:reset', 'battle:dismiss']) {
  document.addEventListener(type, () => {
    if (musicBattleSyncPending) return;
    musicBattleSyncPending = true;
    queueMicrotask(() => { musicBattleSyncPending = false; musicSync(); });
  });
}
new MutationObserver(musicSync).observe(musicDashboard, { attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('visibilitychange', musicSync);
window.addEventListener('pagehide', () => { musicAway = true; musicSync(); });
window.addEventListener('pageshow', () => { musicAway = false; musicSync(); });
window.addEventListener('storage', event => {
  if (event.key !== musicSettingsKey && event.key !== null) return;
  musicSettings = musicPreferences(event.newValue);
  musicSetVolume();
  musicSync();
  musicRender();
});
musicSetVolume();
musicRender();
