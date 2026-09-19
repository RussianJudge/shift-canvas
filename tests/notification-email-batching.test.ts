import assert from "node:assert/strict";
import test from "node:test";

import {
  BATCH_SEND_LIMIT,
  buildBatchIdempotencyKey,
  chunkForBatchSend,
} from "../lib/notification-email";

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `notification-${index}`);
}

test("Resend's batch maximum is the default chunk size", () => {
  assert.equal(BATCH_SEND_LIMIT, 100);
});

test("nothing to send produces no calls", () => {
  assert.deepEqual(chunkForBatchSend(ids(0)), []);
});

test("a single message is one chunk", () => {
  assert.deepEqual(chunkForBatchSend(ids(1)).map((chunk) => chunk.length), [1]);
});

test("exactly the limit stays one chunk", () => {
  assert.deepEqual(chunkForBatchSend(ids(100)).map((chunk) => chunk.length), [100]);
});

test("one over the limit splits", () => {
  assert.deepEqual(chunkForBatchSend(ids(101)).map((chunk) => chunk.length), [100, 1]);
});

test("a large send splits evenly with a remainder", () => {
  assert.deepEqual(chunkForBatchSend(ids(250)).map((chunk) => chunk.length), [100, 100, 50]);
});

test("chunking preserves every item exactly once", () => {
  const source = ids(250);
  const flattened = chunkForBatchSend(source).flat();

  assert.deepEqual(flattened, source);
});

test("the idempotency key describes the set, not the order", () => {
  const forward = buildBatchIdempotencyKey(["a", "b", "c"]);
  const shuffled = buildBatchIdempotencyKey(["c", "a", "b"]);

  assert.equal(forward, shuffled);
});

test("different sets get different keys", () => {
  assert.notEqual(buildBatchIdempotencyKey(["a", "b"]), buildBatchIdempotencyKey(["a", "c"]));
});

test("the key is a fixed-length hash rather than the ids themselves", () => {
  // A hundred concatenated ids would be a multi-kilobyte HTTP header.
  const key = buildBatchIdempotencyKey(ids(100));

  assert.match(key, /^[0-9a-f]{64}$/);
});

test("sorting does not mutate the caller's array", () => {
  const source = ["c", "a", "b"];
  buildBatchIdempotencyKey(source);

  assert.deepEqual(source, ["c", "a", "b"]);
});
