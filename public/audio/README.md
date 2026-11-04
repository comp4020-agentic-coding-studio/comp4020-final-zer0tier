# Music credits and source recordings

## Rainbows — Kevin MacLeod

`rainbows.mp3` is the game's background music, including Sweet Home and the
town map. It pauses during battles and resumes afterward from the same point.
Thank you, Kevin MacLeod, for creating this bright, refreshing
soundtrack and sharing it under a Creative Commons licence.

[Original track listing](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600063)
by [Kevin MacLeod / Incompetech](https://incompetech.com/).

| Detail | Value |
| --- | --- |
| Title | Rainbows |
| Genre | Soundtrack |
| Album | Light (Lighter Faire) |
| Length | 3:39 |
| Tempo | 110 BPM |
| Feel | Bright, Calming, Grooving |
| Instruments | Marimba, Ukulele, Cello, Drums, Percussion |
| ISRC | USUAN1600063 |
| Uploaded | 2016-10-22 |

Attribution supplied by the artist:

```text
"Rainbows" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
```

Licence: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

The supplied MP3 was re-encoded to a smaller file so it downloads faster on
phones; its metadata is kept. Nothing was edited, trimmed, or otherwise
changed. The player loops the recording and adjusts playback volume.

The supplied file was MPEG Layer III, stereo, 44.1 kHz, 256 kbps, 7,021,434
bytes, SHA-256:

```text
71bd8b3f78187c44cc8da14783f7ebb14a6f122307e6622c3f449bdc03eae4b6
```

The game's copy was re-encoded with LAME 3.100 (`--mp3input --cbr -b 128 -q 0`)
to MPEG Layer III, joint stereo, 44.1 kHz, 128 kbps, 3,512,665 bytes, SHA-256:

```text
e52ca27a0ac5f9c15149471f31e136053d5ee622381b62ab37ceb22883ce7ff5
```

## Raving Energy (faster) — Kevin MacLeod

`raving-energy-faster.mp3` plays while an Arena, revenge, or Adventure battle
window is open, including replays. It loops until the player returns to the
map. Both tracks share mute and volume settings and never play together.
Thank you, Kevin MacLeod, for sharing this energetic battle soundtrack.

[Original track listing](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900012)
by [Kevin MacLeod / Incompetech](https://incompetech.com/).

| Detail | Value |
| --- | --- |
| Title | Raving Energy (faster) |
| Genre | Electronica |
| Album | Disco and Lounge (Electronic and Rock) |
| Length | 4:04 |
| Tempo | 134 BPM |
| Feel | Bright, Grooving, Driving |
| Instruments | Synths, Percussion |
| ISRC | USUAN1900012 |
| Uploaded | 2019-06-11 |

Attribution supplied by the artist:

```text
"Raving Energy (faster)" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
```

Licence: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

The supplied faster version was re-encoded to a smaller file so it downloads
faster on phones; its metadata is kept. Nothing was edited, trimmed,
sped up, or otherwise changed. The player loops the recording and adjusts
playback volume.

The supplied file was MPEG Layer III, stereo, 44.1 kHz, 320 kbps, 9,749,860
bytes, SHA-256:

```text
048f03a2118b317bea2b99b31f435866a1263aa6a5d6a3a5f6bff8d084b82f76
```

The game's copy was re-encoded with LAME 3.100 (`--mp3input --cbr -b 128 -q 0`)
to MPEG Layer III, joint stereo, 44.1 kHz, 128 kbps, 3,903,236 bytes, SHA-256:

```text
2e2f4905ef40a1e2035894a02165e111570ac8320fe8bdc94b52d96035dbd54b
```

## Battle sound effects — original project audio

`public/battle-audio.js` synthesizes short pet voices and skill effects with
Web Audio. All eight pet species have distinct voices, with additional monster
voices, attack reactions, hurt reactions, and faint reactions. Skill cues cover
swishes, impacts, fire, water, electricity, shields, healing, and magic; misses
and monster charging turns have their own cues.

These effects were made for VirtuePets from oscillators and filtered noise.
They use no sampled recordings or third-party sound assets and are separate
from Kevin MacLeod's music above. Effects have their own saved mute and volume
controls and follow the battle's saved turn animations, including replays.

## A Little Place to Stay — original project recording

This earlier recording is retained as a project asset. The game now plays
“Rainbows” and “Raving Energy (faster)” instead.

`cozy-day.wav` is an original instrumental background composition created for
VirtuePets. The melody, arrangement, and synthesized instruments were made for
this project; it uses no third-party music, recordings, or samples.

It is a seamless 80-second loop in D major at 72 BPM, with soft electric-piano
notes, warm sustained chords, gentle bass, and occasional bell accents. The
audio is mono, 24 kHz, 16-bit PCM. Note releases and quiet room reflections wrap
around the loop boundary.

The deterministic source is `scripts/render-cozy-music.mjs`. Re-render it from
the repository root using Node, with no additional dependencies:

```sh
node scripts/render-cozy-music.mjs
```
