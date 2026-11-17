import { test } from "node:test";
import assert from "node:assert/strict";
import { io as client } from "socket.io-client";
import { Rooms, validSegment, validCursor, cleanName, throttle, ROOM_ID, MAX_SEGMENTS } from "./room.js";

const seg = { x0: 1, y0: 2, x1: 3, y1: 4, c: "#ff0000", w: 4, s: "stroke01" };

test("validSegment accepts good and rejects bad input", () => {
  assert.ok(validSegment(seg));
  assert.ok(!validSegment({ ...seg, x0: -1 }));
  assert.ok(!validSegment({ ...seg, y1: 901 }));
  assert.ok(!validSegment({ ...seg, x0: NaN }));
  assert.ok(!validSegment({ ...seg, c: "red" }));
  assert.ok(!validSegment({ ...seg, w: 999 }));
  assert.ok(!validSegment({ ...seg, s: undefined }));
  assert.ok(!validSegment({ ...seg, s: "../../x" }));
  assert.ok(!validSegment(null));
});

test("validCursor, room id, names", () => {
  assert.ok(validCursor({ x: 10, y: 10 }));
  assert.ok(!validCursor({ x: "1", y: 1 }));
  assert.ok(ROOM_ID.test("abc-123"));
  assert.ok(!ROOM_ID.test("../etc"));
  assert.equal(cleanName("  Ada\u0000 "), "Ada");
  assert.equal(cleanName("x".repeat(50)).length, 20);
  assert.equal(cleanName(""), "Guest");
  assert.equal(cleanName({ evil: 1 }), "Guest");
});

test("throttle drops events past the cap, then recovers", () => {
  let t = 0;
  const ok = throttle(2, 1000, () => t);
  assert.ok(ok() && ok());
  assert.ok(!ok());
  t = 1000;
  assert.ok(ok());
});

test("room stores history for late joiners and is deleted when empty", () => {
  const r = new Rooms();
  r.join("a");
  assert.ok(r.addSegment("a", seg, "u1"));
  assert.equal(r.join("a").length, 1);
  r.clear("a");
  assert.equal(r.join("a").length, 0);
  r.leave("a"); r.leave("a"); r.leave("a");
  assert.ok(!r.has("a"));
});

test("room rejects invalid segments, unknown rooms and overflow", () => {
  const r = new Rooms();
  assert.ok(!r.addSegment("nope", seg, "u1"));
  r.join("a");
  assert.ok(!r.addSegment("a", { ...seg, w: 0 }, "u1"));
  for (let i = 0; i < MAX_SEGMENTS; i++) r.addSegment("a", seg, "u1");
  assert.ok(!r.addSegment("a", seg, "u1"));
});

test("addSegment strips unknown fields before they are stored or broadcast", () => {
  const r = new Rooms();
  r.join("a");
  const clean = r.addSegment("a", { ...seg, evil: "<script>", __proto__: { x: 1 } }, "u1");
  assert.deepEqual(clean, seg);
});

test("undo removes only the owner's stroke, and nobody can hijack a stroke id", () => {
  const r = new Rooms();
  r.join("a");
  r.addSegment("a", seg, "u1");
  r.addSegment("a", { ...seg, s: "stroke02" }, "u2");
  assert.ok(!r.addSegment("a", seg, "u2")); // u2 appending to u1's stroke
  assert.ok(!r.undo("a", "stroke01", "u2")); // u2 undoing u1's stroke
  assert.ok(r.undo("a", "stroke01", "u1"));
  assert.ok(!r.undo("a", "stroke01", "u1")); // already gone
  assert.deepEqual(r.join("a").map((s) => s.s), ["stroke02"]);
});

// Real server, real sockets: B must receive what A draws, and a late joiner gets the history.
test("end to end: draw, name, undo, and late-join replay", async () => {
  const { http, io } = await import("./server.js");
  await new Promise((r) => http.listen(0, r));
  const url = `http://localhost:${http.address().port}`;
  const once = (sock, ev) => new Promise((r) => sock.once(ev, r));

  const a = client(url), b = client(url);
  a.emit("join", "e2e"); b.emit("join", "e2e");
  await Promise.all([once(a, "init"), once(b, "init")]);

  // Extra client-supplied fields must not reach other clients.
  const got = once(b, "draw");
  a.emit("draw", { ...seg, evil: 1 });
  assert.deepEqual(await got, seg);

  a.emit("name", "Ada\u0000");
  const cur = once(b, "cursor");
  a.emit("cursor", { x: 5, y: 5 });
  assert.equal((await cur).name, "Ada");

  // B cannot undo A's stroke; A can, and B hears about it.
  b.emit("undo", seg.s);
  const c = client(url);
  c.emit("join", "e2e");
  assert.equal((await once(c, "init")).segments.length, 1);
  const undone = once(b, "undo");
  a.emit("undo", seg.s);
  assert.equal(await undone, seg.s);

  [a, b, c].forEach((s) => s.close());
  await io.close(); // also closes the http server
});
