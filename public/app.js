const W = 1600, H = 900;
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const board = document.getElementById("board");
const status = document.getElementById("status");
const colorEl = document.getElementById("color");
const sizeEl = document.getElementById("size");

// Room comes from /r/<room>; no room yet means create one and redirect.
const m = location.pathname.match(/^\/r\/([a-z0-9-]{1,32})$/);
if (!m) location.replace(`/r/${Math.random().toString(36).slice(2, 8)}`);
const room = m && m[1];

const socket = io();
const cursors = new Map();

function drawSegment(s) {
  ctx.strokeStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(s.x0, s.y0);
  ctx.lineTo(s.x1, s.y1);
  ctx.stroke();
}

const clearCanvas = () => ctx.clearRect(0, 0, W, H);
function setStatus(text, cls) {
  status.textContent = text;
  status.className = `status ${cls}`;
}
const setUsers = (n) => setStatus(`${n} online · room ${room}`, "live");

// Re-sends join on reconnect; the server replays history, so redraw from scratch.
socket.on("connect", () => socket.emit("join", room));
socket.on("disconnect", () => setStatus("Disconnected, retrying…", "down"));
socket.on("init", ({ segments, users }) => {
  clearCanvas();
  segments.forEach(drawSegment);
  setUsers(users);
});
socket.on("users", setUsers);
socket.on("draw", drawSegment);
socket.on("clear", clearCanvas);

// Pointer position -> canvas coordinates (canvas is CSS-scaled).
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

let last = null;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  last = pos(e);
});
canvas.addEventListener("pointerup", () => (last = null));
canvas.addEventListener("pointercancel", () => (last = null));

let lastCursorSent = 0;
canvas.addEventListener("pointermove", (e) => {
  const p = pos(e);
  const now = performance.now();
  if (now - lastCursorSent > 30) {
    lastCursorSent = now;
    socket.volatile.emit("cursor", p);
  }
  if (!last) return;
  const seg = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, c: colorEl.value, w: Number(sizeEl.value) };
  drawSegment(seg); // draw locally first so there is no input lag
  socket.emit("draw", seg);
  last = p;
});

// Remote cursors: one absolutely-positioned dot per peer, coloured from the socket id.
function hue(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
socket.on("cursor", ({ id, x, y }) => {
  let el = cursors.get(id);
  if (!el) {
    el = document.createElement("div");
    el.className = "cursor";
    el.style.background = `hsl(${hue(id)} 80% 50%)`;
    board.appendChild(el);
    cursors.set(id, el);
  }
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
const dot = document.getElementById("dot");
function showSize() {
  const scale = canvas.getBoundingClientRect().width / W;
  dot.style.setProperty("--d", `${Math.max(2, Math.min(24, sizeEl.value * scale))}px`);
}
sizeEl.addEventListener("input", showSize);
addEventListener("resize", showSize);
showSize();

document.getElementById("clear").addEventListener("click", () => {
  clearCanvas();
  socket.emit("clear");
});
document.getElementById("share").addEventListener("click", async (e) => {
  try {
    await navigator.clipboard.writeText(location.href);
    e.target.textContent = "Copied!";
  } catch {
    e.target.textContent = "Copy failed";
  }
  setTimeout(() => (e.target.textContent = "Copy link"), 1500);
});
