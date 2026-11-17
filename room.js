// Pure room state + validation, kept separate from the socket layer so it can be unit-tested.
export const W = 1600;
export const H = 900;
export const MAX_SEGMENTS = 20000; // per room, bounds memory
export const ROOM_ID = /^[a-z0-9-]{1,32}$/;

const num = (v, max) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

export function validSegment(s) {
  return (
    !!s &&
    num(s.x0, W) && num(s.y0, H) && num(s.x1, W) && num(s.y1, H) &&
    typeof s.c === "string" && /^#[0-9a-f]{6}$/i.test(s.c) &&
    typeof s.w === "number" && s.w >= 1 && s.w <= 40
  );
}

export function validCursor(p) {
  return !!p && num(p.x, W) && num(p.y, H);
}

// shortcut: rooms live in process memory, lost on restart and not shared across instances; use Redis + the socket.io redis adapter to scale out.
export class Rooms {
  #rooms = new Map();

  join(id) {
    if (!this.#rooms.has(id)) this.#rooms.set(id, { segments: [], users: 0 });
    const r = this.#rooms.get(id);
    r.users++;
    return r.segments;
  }

  leave(id) {
    const r = this.#rooms.get(id);
    if (r && --r.users <= 0) this.#rooms.delete(id);
  }

  addSegment(id, seg) {
    const r = this.#rooms.get(id);
    if (!r || !validSegment(seg) || r.segments.length >= MAX_SEGMENTS) return false;
    r.segments.push({ x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1, c: seg.c, w: seg.w });
    return true;
  }

  clear(id) {
    const r = this.#rooms.get(id);
    if (r) r.segments = [];
  }

  has(id) {
    return this.#rooms.has(id);
  }
}
