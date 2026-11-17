# Collab Whiteboard

A real-time collaborative whiteboard. Open a link, draw, and everyone in the same room sees your strokes and your cursor live.

## Features
- Shareable rooms: `/r/<room-id>`; visiting `/` creates a new room
- Live strokes and live cursors over WebSockets (Socket.IO)
- Late joiners get the full drawing history; reconnects resync automatically
- Optimistic local drawing, so there is no input lag
- Server-side validation of every message (coordinates, colour, size, room id) and a per-room history cap
- Touch and pen support, dark mode, keyboard-focusable controls

## Run
```bash
npm install
npm start        # http://localhost:3000  (set PORT to change)
npm test         # unit tests + an end-to-end test with real sockets
```

## How it works
| Piece | Role |
|---|---|
| `server.js` | HTTP static server (whitelisted files only) + Socket.IO events: `join`, `draw`, `cursor`, `clear` |
| `room.js` | Pure room state and validation, unit-tested in isolation |
| `public/app.js` | Canvas drawing, pointer handling, remote cursors |

Drawing is sent as small line segments in a fixed 1600x900 coordinate space, so every screen size renders the same picture. Cursor updates are throttled (~30 ms) and sent as volatile messages, so slow clients drop stale positions instead of queueing them.

## Known limits / next steps
- Rooms live in memory: they are lost on restart and do not span multiple server instances. Fix: Redis + `@socket.io/redis-adapter`, and persist segments.
- No undo, eraser or usernames.
- No auth: anyone with the room link can draw.
