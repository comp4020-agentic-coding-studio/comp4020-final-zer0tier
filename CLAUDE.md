# VirtuePets — agent harness

A multiplayer virtual pet game (see README.md). It runs on one Fly.io machine
with 256 MB of memory and one volume at `/data`. Every rule here follows from that.

## Working with the owner

- Read this file before starting each task, changing direction, or making
  changes. Apply its rules and keep it current when project guidance changes
  or the owner supplies new standing preferences.
- Finish the requested work and relevant checks, then commit every completed
  change. Keep unrelated existing changes out of the commit. Do not push unless
  the owner explicitly asks.
- For desktop-only layout requests, preserve the phone layout and interactions.
  Check desktop and phone sizes, keyboard access, and overflow before committing.
- Keep the rules concise and specific to this project. Do not turn a one-off
  implementation choice into a permanent rule without the owner's direction.
- Whenever the player must confirm something, ask in the game's own Yes/No
  window (`confirm:ask`, `public/confirm.js`), never `window.confirm`.
- Keep the Adventure playable from the keyboard alone, mouse optional.

## Stack (don't add to it without asking)

- **Node 24, TypeScript run directly** (`node src/server.ts`, type stripping).
  There is no build step. Use only erasable syntax: no `enum`, no `namespace`,
  no constructor parameter properties. Imports name the `.ts` file.
- **Express 5** for HTTP. **`ws`** for real-time; not Socket.io.
- **`node:sqlite`** (`DatabaseSync`) is the only datastore. The file is
  `$DATA_DIR/virtuepets.db` (`./data` locally, `/data` in the image). Nothing
  else is persistent: no in-memory state may be the only copy of game state.
- Frontend is plain HTML/CSS/JS in `public/`, with no framework or bundler.

## Home and town interface

- Preserve the original sign-in and create-account theme and use its colors,
  typefaces, rounded controls, and light/dark appearance throughout the game.
  Scope world styles to the signed-in game rather than restyling account screens.
- Sweet Home and town fill the screen with a following camera and a small
  upper-left tip: W/A/S/D to move, Space bar to interact. Keep persistent
  dashboard, navigation, and stats panels out of both scenes. Reach activities
  through the pet, furniture, and town buildings; Escape opens the game menu
  for pet details, appearance, supplies, the journal, help, and account controls.
  Show these windows only when requested and keep pet care at home.
- While the pet works or studies, show a compact progress bar and time remaining
  on the town map. Keep it hidden at home and when the pet is idle, and use the
  saved activity timing and server-confirmed completion.
- Pet interaction opens a small pop-up with the pet's current status,
  care and play choices, and interaction feedback. Keep extra navigation
  and supplies guidance out of this pop-up; use the furniture for those.
- Pet artwork should fit the warm, illustrated home, with cute, recognizable
  animals that also read clearly in small icons. Preserve saved species and
  colors when updating their artwork.
- `public/world.js` and `public/world.css` present Sweet Home and the town
  map. Move the existing gameplay controls into scenes and windows; preserve
  their IDs, listeners, and server-driven updates in `app.js` and the other
  gameplay modules.
- Keep home care, town destinations, and Adventure accessible with both
  keyboard and touch. World movement must pause while a dialog is open or
  the player is typing. Home movement and floor-click routes must respect
  the pet's space while keeping nearby pet interaction reachable.
- Highlight the available object that Space will interact with. Keep the
  indicator tied to the current interaction range and clear it while a
  dialog is open, without adding persistent scene panels or animated effects.

## Adventure interface

- Match home's and town's warm illustrated style with a full-screen woodland
  and following camera. Keep movement tips small and reveal backpack and team
  details only when requested. Support keyboard movement and touch routes.
- Ordinary monsters hide in tall grass and trigger surprise battles while
  walking. Clear paths and standing still are safe; the final boss remains
  visible. Preserve saved exploration, battle, treasure, and team progress.
- New runs lock each downward exit until a monster drops its Floor Key at a
  fixed 5% chance per victory. Keep grass encounters available until the key
  drops. Keys and permanent gate unlocks belong to the shared floor, and saved
  battle replays never reroll drops. Preserve unlocked exits in existing runs.
- Use cute original monster artwork, detailed treasure chests, and subtle
  environmental animation. Respect reduced-motion preferences and pause scene
  animation when hidden or covered by another window.

## Rules

1. **Every database query is parameterised.** Use `db.prepare(...)` with `?`
   placeholders. Never build SQL from strings, template literals or
   concatenation with any value, even one that's already validated.
   `db.exec` is only for fixed schema DDL.
2. **Every real-time event has an automated test in `spec/`.** Each event in
   `ServerEvent` (`src/realtime.ts`) needs a test that names the event in its
   title. The test must open real WebSockets against the running app and show
   the event reaches the clients within 1 second. Adding an event without its
   test is an unfinished change.
3. **The database is the source of truth.** Change it first, then broadcast the
   row as read back from it. Clients never apply their own updates
   optimistically; they render what the broadcast says.
4. **Clients act over HTTP; the socket only carries server → client events.**
5. Validate every player ID with `isValidId` at the edge.
6. Don't break the course invariants: `/` answers 200, and `/readme/` serves
   README.md in full, rendered. Keep `spec/invariants.test.ts`. When behaviour
   changes, update README.md in the same change.

## Checking your work

Start the app on a fast clock (`pnpm start:test`, which sets `TIME_SCALE=36000`
so a game hour takes 0.1 s), then run `pnpm check` (typecheck plus the spec,
against the running app). CI runs the image with the same `TIME_SCALE`; the
deployed app leaves it unset, so lessons and shifts take real time. Specs
share one long-lived database, so each test uses a fresh ID from `freshId()`. A change is done when `pnpm check` is green.
