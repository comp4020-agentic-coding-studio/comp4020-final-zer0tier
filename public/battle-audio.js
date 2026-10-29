// Original, short cartoon voices and skill effects. No recordings or network
// requests: bounded Web Audio voices follow the saved turn's visual playback.
const sfxDashboard = document.getElementById('dashboard');
const sfxKey = 'virtuepets:effects';
const SfxContext = window.AudioContext || window.webkitAudioContext;
function sfxPreferences(value) {
  let saved;
  try { saved = JSON.parse(value); } catch { /* Use quiet defaults. */ }
  return {
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
    volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
      ? Math.round(Math.max(0, Math.min(100, saved.volume))) : 55,
  };
}
let sfxSettings;
try { sfxSettings = sfxPreferences(localStorage.getItem(sfxKey)); }
catch { sfxSettings = sfxPreferences(null); }
const sfxControls = document.createElement('section');
sfxControls.id = 'battle-sound-settings';
sfxControls.innerHTML = `
  <button type="button" id="sfx-toggle" class="world-button" aria-pressed="true" aria-describedby="sfx-status">Battle sound effects <span id="sfx-state" aria-hidden="true">On</span></button>
  <div class="music-volume-heading"><label for="sfx-volume">Effects volume</label><output id="sfx-volume-value" for="sfx-volume"></output></div>
  <input id="sfx-volume" type="range" min="0" max="100" step="1" value="55">
  <p id="sfx-status" class="help" role="status"></p>`;
document.getElementById('music-credit').before(sfxControls);
const sfxToggle = document.getElementById('sfx-toggle');
const sfxRange = document.getElementById('sfx-volume');
let sfxContext = null, sfxOutput = null, sfxNoise = null, sfxPending = null;
let sfxAway = false, sfxFailure = '';
const sfxVoices = new Set();
const sfxEnabled = () => SfxContext && sfxSettings.enabled && sfxSettings.volume > 0;
const sfxPresent = () => !sfxDashboard.hidden && !document.hidden && !sfxAway;
function sfxRender() {
  sfxToggle.setAttribute('aria-pressed', String(sfxSettings.enabled));
  sfxToggle.disabled = !SfxContext;
  document.getElementById('sfx-state').textContent = sfxSettings.enabled ? 'On' : 'Off';
  sfxRange.value = String(sfxSettings.volume);
  sfxRange.disabled = !SfxContext;
  sfxRange.setAttribute('aria-valuetext', `${sfxSettings.volume}%`);
  document.getElementById('sfx-volume-value').textContent = `${sfxSettings.volume}%`;
  const battleToggle = document.getElementById('battle-sfx-toggle');
  if (battleToggle) {
    battleToggle.hidden = false;
    battleToggle.disabled = !SfxContext;
    battleToggle.setAttribute('aria-pressed', String(sfxSettings.enabled));
    battleToggle.textContent = `Sound effects: ${sfxSettings.enabled ? 'On' : 'Off'}`;
  }
  document.getElementById('sfx-status').textContent = !SfxContext ? 'Sound effects are unavailable in this browser.'
    : !sfxSettings.enabled ? 'Sound effects are off.' : !sfxSettings.volume ? 'Effects volume is muted.'
      : sfxFailure || 'Pet voices and skill effects. Music has its own controls.';
}
function sfxStop() {
  if (!sfxContext) return;
  const now = sfxContext.currentTime;
  for (const voice of sfxVoices) {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, .004);
    try { voice.source.stop(now + .02); } catch { /* Already ended. */ }
  }
  sfxVoices.clear();
}
function sfxSuspend() {
  sfxStop();
  if (sfxContext?.state === 'running') sfxContext.suspend().catch(() => {});
}
function sfxSetVolume() {
  sfxOutput?.gain.setTargetAtTime(sfxSettings.volume / 100, sfxContext.currentTime, .02);
}
function sfxUnlock() {
  if (!sfxEnabled() || !sfxPresent()) return;
  try {
    if (!sfxContext) {
      sfxContext = new SfxContext();
      sfxOutput = sfxContext.createGain();
      sfxOutput.gain.value = sfxSettings.volume / 100;
      sfxOutput.connect(sfxContext.destination);
      sfxNoise = sfxContext.createBuffer(1, Math.ceil(sfxContext.sampleRate * .75), sfxContext.sampleRate);
      const data = sfxNoise.getChannelData(0);
      let seed = 7419;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
    }
    if (sfxContext.state === 'running' || sfxPending) return;
    sfxPending = sfxContext.resume().then(() => {
      // Never replay missed turns after a delayed browser permission prompt.
      if (!sfxEnabled() || !sfxPresent()) return sfxSuspend();
      sfxFailure = ''; sfxRender();
    }).catch(() => {
      sfxFailure = 'Tap a battle control to enable sound effects.'; sfxRender();
    }).finally(() => { sfxPending = null; });
  } catch {
    sfxFailure = 'Sound effects could not start. Switch them off and on to retry.'; sfxRender();
  }
}
function sfxSave() {
  try { localStorage.setItem(sfxKey, JSON.stringify(sfxSettings)); } catch { /* Controls still work. */ }
}
for (const type of ['pointerdown', 'keydown', 'click']) document.addEventListener(type, event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('#sfx-toggle, #battle-sfx-toggle')) return;
  sfxUnlock();
}, { capture: true });
document.addEventListener('click', event => {
  if (!event.target.closest?.('#sfx-toggle, #battle-sfx-toggle') || !SfxContext) return;
  sfxSettings.enabled = !sfxSettings.enabled;
  sfxFailure = '';
  sfxSave();
  if (sfxEnabled()) sfxUnlock(); else sfxSuspend();
  sfxRender();
});
sfxRange.addEventListener('input', () => {
  sfxSettings.volume = Number(sfxRange.value);
  sfxSetVolume(); sfxSave();
  if (sfxEnabled()) sfxUnlock(); else sfxSuspend();
  sfxRender();
});

// Each source has a short attack and release, and is disconnected when done.
// At most one turn's voices are scheduled; cancellation also stops future hits.
function sfxVoice(source, start, duration, volume, pan = 0, filter = null) {
  if (sfxVoices.size >= 32) return;
  const gain = sfxContext.createGain();
  const stereo = sfxContext.createStereoPanner?.();
  if (stereo) stereo.pan.value = Math.max(-.4, Math.min(.4, pan));
  const nodes = [source, ...(filter ? [filter] : []), gain, ...(stereo ? [stereo] : [])];
  nodes.forEach((node, i) => node.connect(nodes[i + 1] ?? sfxOutput));
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(.012, duration * .15));
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  const voice = { source, gain };
  sfxVoices.add(voice);
  source.onended = () => { sfxVoices.delete(voice); nodes.forEach(node => node.disconnect()); };
  source.start(start); source.stop(start + duration + .01);
}
function sfxTone(at, duration, from, to, volume = .12, wave = 'sine', pan = 0, middle = null) {
  const source = sfxContext.createOscillator();
  source.type = wave;
  source.frequency.setValueAtTime(from, at);
  if (middle) source.frequency.exponentialRampToValueAtTime(middle, at + duration * .45);
  source.frequency.exponentialRampToValueAtTime(to, at + duration);
  sfxVoice(source, at, duration, volume, pan);
}
function sfxAir(at, duration, from, to, volume = .08, pan = 0) {
  const source = sfxContext.createBufferSource();
  source.buffer = sfxNoise;
  const filter = sfxContext.createBiquadFilter();
  filter.type = 'bandpass'; filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + duration);
  sfxVoice(source, at, duration, volume, pan, filter);
}
function sfxBell(at, pitch, duration, pan, volume = .10) {
  [1, 2.02, 3.99].forEach((harmonic, i) => sfxTone(at, duration / (1 + i * .3), pitch * harmonic, pitch * harmonic, volume / (1 + i * 2), 'sine', pan));
}
const sfxPets = {
  cat: [520, 390, 780, 'triangle'], dog: [180, 100, 240, 'triangle'],
  hedgehog: [900, 640, 1050, 'sine'], lizard: [310, 460, 560, 'triangle'],
  panda: [190, 135, 245, 'sine'], bird: [1150, 1400, 1800, 'sine'],
  dragon: [125, 65, 170, 'sawtooth'], blob: [290, 190, 600, 'sine'],
  slime: [230, 140, 480, 'sine'], goblin: [270, 160, 390, 'triangle'],
  'slime-king': [100, 60, 190, 'sine'],
};
function sfxPet(fighter, at, scale, pan, reaction = 'attack') {
  if (!fighter) return;
  const species = fighter.monster || fighter.appearance;
  const [from, to, middle, wave] = sfxPets[species] ?? sfxPets.blob;
  const hurt = reaction === 'hurt', faint = reaction === 'faint';
  const pitch = hurt ? 1.25 : faint ? .8 : 1;
  const duration = (faint ? .28 : hurt ? .13 : .20) * scale;
  sfxTone(at, duration, from * pitch, faint ? to * .5 : to * pitch, .10, wave, pan, middle * pitch);
  if (['dog', 'dragon', 'lizard', 'goblin'].includes(species)) {
    sfxAir(at, duration * .8, species === 'lizard' ? 2400 : 700, 300, .07, pan);
  }
  if (species === 'bird' && !faint) sfxTone(at + .08 * scale, .10 * scale, from * 1.2, to, .055, 'sine', pan);
}
const sfxFamilies = {
  slash: ['claw', 'maul', 'sweep', 'riposte', 'dart', 'vine', 'review'],
  impact: ['breath', 'pie', 'bloodlust', 'titan', 'hammer', 'bump', 'heckle'],
  fire: ['flame'], water: ['wave'], electric: ['synapse', 'crown', 'beam'],
  shield: ['hardhat', 'barrier'], heal: ['coffee', 'ovation', 'smile'],
  sparkle: ['siren', 'velvet', 'makeover', 'perfume', 'pump', 'roar'],
  arcane: ['gravity', 'mind', 'grimoire'], balance: ['jack', 'equalizer', 'golden'],
};
function sfxSkill(cue, at, scale) {
  const { step, motion, actorPan, targetPan, targetKind } = cue;
  const pan = targetKind === 'self' ? actorPan : targetPan;
  const hash = [...(step.ability || 'claw-strike')].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const pitch = 1 + (hash % 9 - 4) * .035;
  const family = Object.keys(sfxFamilies).find(key => sfxFamilies[key].includes(motion)) ?? 'impact';
  if (step.telegraph) {
    sfxTone(at, .46 * scale, 110, 440, .13, 'triangle', actorPan);
    sfxAir(at, .42 * scale, 350, 2400, .08, actorPan);
    return;
  }
  if (step.missed) {
    sfxAir(at, .22 * scale, 3200, 650, .13, pan);
    sfxTone(at + .12 * scale, .14 * scale, 580, 240, .07, 'sine', pan);
    return;
  }
  switch (family) {
    case 'slash':
      for (let i = 0; i < Math.min(3, Math.max(1, step.hits || 1)); i++) sfxAir(at + i * .065 * scale, .12 * scale, 2600 * pitch, 650, .13, pan);
      if (motion === 'riposte' || motion === 'review') sfxBell(at + .11 * scale, 720 * pitch, .2 * scale, pan, .065);
      break;
    case 'impact':
      sfxTone(at, .21 * scale, 150 * pitch, 48, .18, 'triangle', pan);
      sfxAir(at, .11 * scale, 1200, 170, .11, pan);
      if (motion === 'pie' || motion === 'bump') sfxTone(at + .04 * scale, .16 * scale, 220, 90, .10, 'sine', pan, 420);
      break;
    case 'fire':
      sfxAir(at, .34 * scale, 500, 3500, .16, pan);
      sfxTone(at, .28 * scale, 180, 80, .08, 'triangle', pan);
      break;
    case 'water':
      sfxAir(at, .3 * scale, 1900, 480, .10, pan);
      [0, .07, .14].forEach((delay, i) => sfxTone(at + delay * scale, .16 * scale, (420 + i * 110) * pitch, 150, .09, 'sine', pan));
      break;
    case 'electric':
      [0, .055, .11].forEach((delay, i) => sfxTone(at + delay * scale, .11 * scale, (300 + i * 140) * pitch, 1800, .075, 'triangle', pan));
      sfxAir(at, .14 * scale, 3200, 1200, .08, pan);
      break;
    case 'shield':
      sfxBell(at, 420 * pitch, .38 * scale, pan);
      sfxTone(at, .18 * scale, 200, 200, .09, 'triangle', pan);
      break;
    case 'heal':
    case 'sparkle':
    case 'balance':
      [1, 1.25, 1.5].forEach((ratio, i) => sfxBell(at + i * .075 * scale, (family === 'heal' ? 440 : family === 'balance' ? 330 : 660) * ratio * pitch, .23 * scale, pan, .075));
      break;
    case 'arcane':
      sfxTone(at, .38 * scale, 180 * pitch, 420, .12, 'triangle', pan, 110);
      sfxBell(at + .16 * scale, 540 * pitch, .22 * scale, pan, .065);
      break;
  }
}
document.addEventListener('battle:sound', ({ detail: cue }) => {
  const battle = document.getElementById('battle-dialog');
  if (!cue?.step || !sfxEnabled() || !sfxPresent() || sfxContext?.state !== 'running' ||
    !battle?.open || battle.classList.contains('battle-motion-paused')) return;
  sfxStop();
  try {
    const scale = Math.max(.4, Math.min(1, cue.duration / 650));
    const at = sfxContext.currentTime + .005;
    sfxPet(cue.actor, at, scale, cue.actorPan);
    sfxSkill(cue, at + .065 * scale, scale);
    if (!cue.step.telegraph && !cue.step.missed && cue.step.damage > 0 && cue.step.actor !== cue.step.target) {
      sfxTone(at + .17 * scale, .10 * scale, 110, 55, .12, 'triangle', cue.targetPan);
      sfxPet(cue.target, at + .20 * scale, scale, cue.targetPan, cue.step.hp?.[cue.step.target] <= 0 ? 'faint' : 'hurt');
    }
  } catch { sfxStop(); /* Audio must never interrupt a saved battle. */ }
});
document.addEventListener('battle:sound-stop', sfxStop);
document.addEventListener('battle:show', () => queueMicrotask(sfxRender));
document.addEventListener('battle:reset', sfxStop);
document.addEventListener('visibilitychange', () => {
  if (!sfxPresent()) sfxSuspend(); else if (sfxContext) sfxUnlock();
});
new MutationObserver(() => { if (!sfxPresent()) sfxSuspend(); }).observe(sfxDashboard, { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('pagehide', () => { sfxAway = true; sfxSuspend(); });
window.addEventListener('pageshow', () => { sfxAway = false; if (sfxContext) sfxUnlock(); });
window.addEventListener('storage', event => {
  if (event.key !== sfxKey && event.key !== null) return;
  sfxSettings = sfxPreferences(event.newValue);
  sfxSetVolume();
  if (!sfxEnabled()) sfxSuspend(); else if (sfxContext) sfxUnlock();
  sfxRender();
});
sfxRender();
