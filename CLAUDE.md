# VirtuePets — agent harness

A multiplayer virtual pet game (see README.md). It runs on one Fly.io machine
with 256 MB of memory and one volume at `/data`. Every rule here follows from that.

## Stack (don't add to it without asking)

- **Node 24, TypeScript run directly** (`node src/server.ts`, type stripping).
  There is no build step. Use only erasable syntax: no `enum`, no `namespace`,
  no constructor parameter properties. Imports name the `.ts` file.
- **Express 5** for HTTP. **`ws`** for real-time; not Socket.io.
- **`node:sqlite`** (`DatabaseSync`) is the only datastore. The file is
  `$DATA_DIR/virtuepets.db` (`./data` locally, `/data` in the image). Nothing
  else is persistent: no in-memory state may be the only copy of game state.
- Frontend is plain HTML/CSS/JS in `public/`, with no framework or bundler.

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
