const W = 1600, H = 900;
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const board = $("board");
const status = $("status");
const colorEl = $("color");
const sizeEl = $("size");

// Room comes from /r/<room>; no room yet means create one and redirect.
const m = location.pathname.match(/^\/r\/([a-z0-9-]{1,32})$/);
if (!m) location.replace(`/r/${Math.random().toString(36).slice(2, 8)}`);
const room = m && m[1];

const socket = io();
const cursors = new Map();

// Everything on the board, kept locally so an undo can redraw without asking the server.
let segments = [];
let mine = []; // stroke ids I drew, newest last (my undo stack)

function drawSegment(s) {
  ctx.strokeStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(s.x0, s.y0);
  ctx.lineTo(s.x1, s.y1);
  ctx.stroke();
}
function redraw() {
  ctx.clearRect(0, 0, W, H);
  segments.forEach(drawSegment);
}

function setStatus(text, cls) {
  status.textContent = text;
  status.className = `status ${cls}`;
}
const setUsers = (n) => setStatus(`${n} online · room ${room}`, "live");

// Display name, remembered per browser (storage can be blocked, so every access is guarded).
const nameEl = $("name");
try {
  nameEl.value = localStorage.getItem("wb-name") || "";
} catch {}
if (!nameEl.value) nameEl.value = `Guest ${100 + Math.floor(Math.random() * 900)}`;
const sendName = () => socket.emit("name", nameEl.value);
nameEl.addEventListener("input", () => {
  sendName();
  try {
    localStorage.setItem("wb-name", nameEl.value);
  } catch {}
});

// Re-sends join on reconnect; the server replays history, so redraw from scratch.
socket.on("connect", () => {
  socket.emit("join", room);
  sendName();
});
socket.on("disconnect", () => setStatus("Disconnected, retrying…", "down"));
socket.on("init", ({ segments: all, users }) => {
  segments = all;
  mine = []; // the server ties strokes to my old connection id, so they can't be undone after a reconnect
  redraw();
  setUsers(users);
});
socket.on("users", setUsers);
socket.on("draw", (s) => {
  segments.push(s);
  drawSegment(s);
});
socket.on("undo", (stroke) => {
  segments = segments.filter((s) => s.s !== stroke);
  redraw();
});
socket.on("clear", () => {
  segments = [];
  mine = [];
  redraw();
});

// Pointer position -> canvas coordinates (canvas is CSS-scaled).
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

let last = null;
let stroke = null;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  last = pos(e);
  stroke = Math.random().toString(36).slice(2, 14).padEnd(6, "0");
});
const endStroke = () => (last = stroke = null);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

let lastCursorSent = 0;
canvas.addEventListener("pointermove", (e) => {
  const p = pos(e);
  const now = performance.now();
  if (now - lastCursorSent > 30) {
    lastCursorSent = now;
    socket.volatile.emit("cursor", p);
  }
  if (!last) return;
  const seg = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, c: colorEl.value, w: Number(sizeEl.value), s: stroke };
  if (mine.at(-1) !== stroke) mine.push(stroke); // a stroke only counts once it has a segment
  segments.push(seg);
  drawSegment(seg); // draw locally first so there is no input lag
  socket.emit("draw", seg);
  last = p;
});

function undo() {
  const s = mine.pop();
  if (!s) return;
  segments = segments.filter((x) => x.s !== s);
  redraw();
  socket.emit("undo", s);
}
$("undo").addEventListener("click", undo);
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && e.target.type !== "text") {
    e.preventDefault();
    undo();
  }
});

// Remote cursors: a dot plus the peer's name, coloured from the socket id.
function hue(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
socket.on("cursor", ({ id, x, y, name }) => {
  let el = cursors.get(id);
  if (!el) {
    el = document.createElement("div");
    el.className = "cursor";
    el.style.setProperty("--c", `hsl(${hue(id)} 70% 40%)`);
    el.append(document.createElement("span"));
    board.appendChild(el);
    cursors.set(id, el);
  }
  el.firstChild.textContent = name; // textContent: names are user-supplied
  el.style.left = `${(x / W) * 100}%`;
  el.style.top = `${(y / H) * 100}%`;
});
socket.on("leave", (id) => {
  cursors.get(id)?.remove();
  cursors.delete(id);
});

// Colour swatches drive the same colour input the drawing code already reads.
const swatches = [...document.querySelectorAll(".swatch")];
function markActive() {
  swatches.forEach((s) => s.classList.toggle("active", s.dataset.color === colorEl.value.toLowerCase()));
}
swatches.forEach((s) =>
  s.addEventListener("click", () => {
    colorEl.value = s.dataset.color;
    markActive();
  })
);
colorEl.addEventListener("input", markActive);
markActive();

// Size preview dot shows the real pen width (scaled to the on-screen canvas).
const dot = $("dot");
function showSize() {
  const scale = canvas.getBoundingClientRect().width / W;
  dot.style.setProperty("--d", `${Math.max(2, Math.min(24, sizeEl.value * scale))}px`);
}
sizeEl.addEventListener("input", showSize);
addEventListener("resize", showSize);
showSize();

$("clear").addEventListener("click", () => {
  segments = [];
  mine = [];
  redraw();
  socket.emit("clear");
});

// The canvas is transparent (CSS paints it white), so composite onto white before exporting.
$("save").addEventListener("click", () => {
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const c = out.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);
  c.drawImage(canvas, 0, 0);
  out.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `whiteboard-${room}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
});

$("share").addEventListener("click", async (e) => {
  try {
    await navigator.clipboard.writeText(location.href);
    e.target.textContent = "Copied!";
  } catch {
    e.target.textContent = "Copy failed";
  }
  setTimeout(() => (e.target.textContent = "Copy link"), 1500);
});
