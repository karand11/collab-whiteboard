// Pure room state + validation, kept separate from the socket layer so it can be unit-tested.
export const W = 1600;
export const H = 900;
export const MAX_SEGMENTS = 20000; // per room, bounds memory
export const ROOM_ID = /^[a-z0-9-]{1,32}$/;
const STROKE_ID = /^[a-z0-9]{6,24}$/i;

const num = (v, max) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

export function validSegment(s) {
  return (
    !!s &&
    num(s.x0, W) && num(s.y0, H) && num(s.x1, W) && num(s.y1, H) &&
    typeof s.c === "string" && /^#[0-9a-f]{6}$/i.test(s.c) &&
    typeof s.w === "number" && s.w >= 1 && s.w <= 40 &&
    typeof s.s === "string" && STROKE_ID.test(s.s)
  );
}

export function validCursor(p) {
  return !!p && num(p.x, W) && num(p.y, H);
}

// Display name: strip control chars, trim, cap length. Falls back to "Guest".
export function cleanName(n) {
  const s = typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20) : "";
  return s || "Guest";
}

// Fixed-window limiter for one socket: at most `max` events per `ms`; the rest are dropped.
export function throttle(max, ms, now = Date.now) {
  let start = 0, n = 0;
  return () => {
    const t = now();
    if (t - start >= ms) { start = t; n = 0; }
    return ++n <= max;
  };
}

// shortcut: rooms live in process memory, lost on restart and not shared across instances; use Redis + the socket.io redis adapter to scale out.
export class Rooms {
  #rooms = new Map();

  join(id) {
    if (!this.#rooms.has(id)) this.#rooms.set(id, { segments: [], owners: new Map(), users: 0 });
    const r = this.#rooms.get(id);
    r.users++;
    return r.segments;
  }

  leave(id) {
    const r = this.#rooms.get(id);
    if (r && --r.users <= 0) this.#rooms.delete(id);
  }

  // Returns the sanitised segment to broadcast (never the raw client object, which may carry extra fields), or null.
  addSegment(id, seg, owner) {
    const r = this.#rooms.get(id);
    if (!r || !validSegment(seg) || r.segments.length >= MAX_SEGMENTS) return null;
    // A stroke id belongs to whoever drew its first segment; nobody else can append to it.
    if (r.owners.has(seg.s) && r.owners.get(seg.s) !== owner) return null;
    r.owners.set(seg.s, owner);
    const clean = { x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1, c: seg.c, w: seg.w, s: seg.s };
    r.segments.push(clean);
    return clean;
  }

  // Remove one stroke, only if `owner` drew it.
  undo(id, stroke, owner) {
    const r = this.#rooms.get(id);
    if (!r || r.owners.get(stroke) !== owner) return false;
    r.owners.delete(stroke);
    r.segments = r.segments.filter((s) => s.s !== stroke);
    return true;
  }

  clear(id) {
    const r = this.#rooms.get(id);
    if (r) {
      r.segments = [];
      r.owners.clear();
    }
  }

  has(id) {
    return this.#rooms.has(id);
  }
}
