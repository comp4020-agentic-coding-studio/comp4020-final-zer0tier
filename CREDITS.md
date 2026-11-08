# Credits

Every asset in VirtuePets that came from someone else, with its creator, where
it came from, and its licence. Everything not listed here (code, scene and pet
artwork, and the sound effects) was made for this project.

## Music

Both tracks are by Kevin MacLeod and come from his own site, Incompetech, not
itch.io, so each links to its Incompetech listing.

| Asset | Creator | Source | Licence | Used for |
| --- | --- | --- | --- | --- |
| `public/audio/rainbows.mp3` — "Rainbows" | Kevin MacLeod | [Incompetech listing](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600063) (ISRC USUAN1600063) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Sweet Home and the town map |
| `public/audio/raving-energy-faster.mp3` — "Raving Energy (faster)" | Kevin MacLeod | [Incompetech listing](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900012) (ISRC USUAN1900012) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Arena, revenge, and Adventure battles |

Attribution, as the artist supplies it:

```text
"Rainbows" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/

"Raving Energy (faster)" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
```

**Licence checked.** CC BY 4.0 allows sharing and adapting the music, so
committing it to this public repository and serving it from the game is fine,
as long as it's credited, the licence is linked, and any changes are stated.
Kevin MacLeod's
[FAQ](https://incompetech.com/music/royalty-free/faq.html) asks that a game's
credit be easy for a player to find, "most commonly… a 'Credits' screen found in
the settings menu". VirtuePets shows it **in the game itself**: the game menu
(**Escape**, or the wall clock at home) names both tracks, links them, credits
Kevin MacLeod, links CC BY 4.0, and says they were re-encoded.

**Changes made.** Both files were re-encoded from the supplied MP3s to 128 kbps
so they download faster on phones. Nothing was edited, trimmed, sped up, or
otherwise changed, and their metadata is kept. The game loops them and sets
their volume. Sizes and checksums of the supplied and re-encoded files are in
[`public/audio/README.md`](public/audio/README.md).

Incompetech supplies no licence file with its downloads, so the licence notice
the artist supplies is committed beside the music as
[`public/audio/LICENSE-music.txt`](public/audio/LICENSE-music.txt).

## Original audio (no credit needed)

- **Battle sound effects** (`public/battle-audio.js`): synthesised for
  VirtuePets with Web Audio from oscillators and filtered noise. No samples.
- **"A Little Place to Stay"** (`public/audio/cozy-day.wav`): an original
  composition, rendered by `scripts/render-cozy-music.mjs`. Kept as a project
  asset; the game no longer plays it.

## Fonts

Nunito Sans and Varela Round are served by
[Google Fonts](https://fonts.google.com/) under the
[SIL Open Font License 1.1](https://openfontlicense.org/). They load from
Google's servers, so no font files are in this repository.
