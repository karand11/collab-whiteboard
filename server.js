import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { Rooms, ROOM_ID, validCursor, cleanName, throttle } from "./room.js";

// Whitelist instead of path joining: no way to traverse out of public/.
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

export const http = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  // Any /r/<room> URL serves the same page; the client reads the room from the path.
  const key = path.startsWith("/r/") ? "/" : path;
  const f = FILES[key];
  if (!f) return res.writeHead(404).end("Not found");
  try {
    const body = await readFile(fileURLToPath(new URL(`./public/${f[0]}`, import.meta.url)));
    res.writeHead(200, { "Content-Type": f[1] }).end(body);
  } catch {
    res.writeHead(500).end("Server error");
  }
});

export const io = new Server(http);
const rooms = new Rooms();

io.on("connection", (socket) => {
  let room = null;

  socket.on("join", (id) => {
    if (room || typeof id !== "string" || !ROOM_ID.test(id)) return;
    room = id;
    socket.join(room);
    socket.emit("init", { segments: rooms.join(room), users: io.sockets.adapter.rooms.get(room).size });
    socket.to(room).emit("users", io.sockets.adapter.rooms.get(room).size);
  });

  // Flood protection: a normal drawer sends well under 150 events/s; anything past the cap is dropped.
  const allow = throttle(300, 1000);
  let name = "Guest";

  socket.on("name", (n) => {
    name = cleanName(n);
  });

  socket.on("draw", (seg) => {
    if (!room || !allow()) return;
    const clean = rooms.addSegment(room, seg, socket.id);
    if (clean) socket.to(room).emit("draw", clean);
  });

  socket.on("undo", (stroke) => {
    if (room && allow() && rooms.undo(room, stroke, socket.id)) socket.to(room).emit("undo", stroke);
  });

  socket.on("cursor", (p) => {
    if (room && allow() && validCursor(p)) socket.volatile.to(room).emit("cursor", { id: socket.id, x: p.x, y: p.y, name });
  });

  socket.on("clear", () => {
    if (!room || !allow()) return;
    rooms.clear(room);
    socket.to(room).emit("clear");
  });

  socket.on("disconnect", () => {
    if (!room) return;
    rooms.leave(room);
    const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    io.to(room).emit("leave", socket.id);
    io.to(room).emit("users", size);
  });
});

// Only listen when run directly, so tests can import the server and bind their own port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  http.listen(port, () => console.log(`http://localhost:${port}`));
}
