import { test } from "node:test";
import assert from "node:assert/strict";
import { io as client } from "socket.io-client";
import { Rooms, validSegment, validCursor, ROOM_ID, MAX_SEGMENTS } from "./room.js";

const seg = { x0: 1, y0: 2, x1: 3, y1: 4, c: "#ff0000", w: 4 };

test("validSegment accepts good and rejects bad input", () => {
  assert.ok(validSegment(seg));
  assert.ok(!validSegment({ ...seg, x0: -1 }));
  assert.ok(!validSegment({ ...seg, y1: 901 }));
  assert.ok(!validSegment({ ...seg, x0: NaN }));
  assert.ok(!validSegment({ ...seg, c: "red" }));
  assert.ok(!validSegment({ ...seg, w: 999 }));
  assert.ok(!validSegment(null));
});

test("validCursor and room id", () => {
  assert.ok(validCursor({ x: 10, y: 10 }));
  assert.ok(!validCursor({ x: "1", y: 1 }));
  assert.ok(ROOM_ID.test("abc-123"));
  assert.ok(!ROOM_ID.test("../etc"));
});

test("room stores history for late joiners and is deleted when empty", () => {
  const r = new Rooms();
  r.join("a");
  assert.ok(r.addSegment("a", seg));
  assert.equal(r.join("a").length, 1);
  r.clear("a");
  assert.equal(r.join("a").length, 0);
  r.leave("a"); r.leave("a"); r.leave("a");
  assert.ok(!r.has("a"));
});

test("room rejects invalid segments, unknown rooms and overflow", () => {
  const r = new Rooms();
  assert.ok(!r.addSegment("nope", seg));
  r.join("a");
  assert.ok(!r.addSegment("a", { ...seg, w: 0 }));
  for (let i = 0; i < MAX_SEGMENTS; i++) r.addSegment("a", seg);
  assert.ok(!r.addSegment("a", seg));
});

// Real server, real sockets: B must receive what A draws, and a late joiner gets the history.
test("end to end: draw is broadcast and replayed to late joiners", async () => {
  const { http, io } = await import("./server.js");
  await new Promise((r) => http.listen(0, r));
  const url = `http://localhost:${http.address().port}`;
  const once = (sock, ev) => new Promise((r) => sock.once(ev, r));

  const a = client(url), b = client(url);
  a.emit("join", "e2e"); b.emit("join", "e2e");
  await Promise.all([once(a, "init"), once(b, "init")]);
  const got = once(b, "draw");
  a.emit("draw", seg);
  assert.deepEqual(await got, seg);

  const c = client(url);
  c.emit("join", "e2e");
  assert.equal((await once(c, "init")).segments.length, 1);

  [a, b, c].forEach((s) => s.close());
  await io.close(); // also closes the http server
});
