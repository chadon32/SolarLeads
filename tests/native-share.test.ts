import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRedactedNativeShareMessage,
  buildRedactedNativeSharePayload,
  REDACTED_NATIVE_SHARE_TITLE,
} from "../mobile/src/estimate-sharing";

const SENSITIVE_OUTPUT =
  /address|bill|coordinate|latitude|longitude|email|phone|name|lead|token|report|https?:\/\//i;

test("native outbound share is a redacted summary without property or URL data", () => {
  const message = buildRedactedNativeShareMessage();

  assert.match(message, /preliminary/i);
  assert.match(message, /illustrative/i);
  assert.doesNotMatch(message, SENSITIVE_OUTPUT);
  assert.equal(message.includes(REDACTED_NATIVE_SHARE_TITLE), true);
});

test("native share payload allow-lists only title and message", () => {
  const payload = buildRedactedNativeSharePayload();

  assert.deepEqual(Object.keys(payload).sort(), ["message", "title"]);
  assert.equal(payload.title, REDACTED_NATIVE_SHARE_TITLE);
  assert.equal(payload.message, buildRedactedNativeShareMessage());
  assert.doesNotMatch(JSON.stringify(payload), SENSITIVE_OUTPUT);
});
