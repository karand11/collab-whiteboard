# Collab Whiteboard

A real-time collaborative whiteboard. Open a link, draw, and everyone in the same room sees your strokes and your cursor live.

## Features
- Shareable rooms: `/r/<room-id>`; visiting `/` creates a new room
- Live strokes and live cursors over WebSockets (Socket.IO)
- Late joiners get the full drawing history; reconnects resync automatically
- Optimistic local drawing, so there is no input lag
- Server-side validation of every message (coordinates, colour, size, room id) and a per-room history cap
- Touch and pen support, dark mode, keyboard-focusable controls

### New in 2.0
- **Names on live cursors**: set your name in the header; it is remembered per browser
- **Undo your own strokes** (button or Ctrl/Cmd+Z). The server enforces ownership: you can't undo or append to someone else's stroke
- **Save as PNG**, and colour swatches with an eraser and a pen-size preview
- **Flood protection**: each connection is capped at 300 events/s, extras are dropped
- **Sanitised broadcasts**: the server re-builds every segment from validated fields instead of forwarding what the client sent

## Run
```bash
npm install
npm start        # http://localhost:3000  (set PORT to change)
npm test         # unit tests + an end-to-end test with real sockets
```

## How it works
| Piece | Role |
|---|---|
| `server.js` | HTTP static server (whitelisted files only) + Socket.IO events: `join`, `name`, `draw`, `undo`, `cursor`, `clear` |
| `room.js` | Pure room state and validation, unit-tested in isolation |
| `public/app.js` | Canvas drawing, pointer handling, remote cursors |

Drawing is sent as small line segments in a fixed 1600x900 coordinate space, so every screen size renders the same picture. Cursor updates are throttled (~30 ms) and sent as volatile messages, so slow clients drop stale positions instead of queueing them.

## Known limits / next steps
- Rooms live in memory: they are lost on restart and do not span multiple server instances. Fix: Redis + `@socket.io/redis-adapter`, and persist segments.
- No redo, and undo is per connection: after a reconnect you can no longer undo strokes drawn before it.
- Names are not unique or verified, and there is no auth: anyone with the room link can draw.
