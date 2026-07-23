import assert from "node:assert/strict";
import test from "node:test";
import {
  isHoneypotFilled,
  isLikelyBotAddress,
  isTooFastSubmission,
  readJsonWithLimit,
} from "../src/lib/abuse-protection";

test("honeypot rejects hidden-field bot submissions", () => {
  assert.equal(isHoneypotFilled("", null, undefined), false);
  assert.equal(isHoneypotFilled("", "bot company"), true);
});

test("minimum completion time rejects missing or too-fast form submissions", () => {
  assert.equal(isTooFastSubmission(undefined), true);
  assert.equal(isTooFastSubmission(0), true);
  assert.equal(isTooFastSubmission(Date.now()), true);
  assert.equal(isTooFastSubmission(Date.now() - 6000), false);
});

test("bot address validation rejects impossible addresses before expensive work", () => {
  assert.equal(isLikelyBotAddress("asdf"), true);
  assert.equal(isLikelyBotAddress("PO Box 123"), true);
  assert.equal(isLikelyBotAddress("6420 E Nance St, Mesa, AZ 85215"), false);
});

test("streaming JSON limits reject bodies larger than a misleading content length", async () => {
  const request = new Request("http://localhost/api/test", {
    body: JSON.stringify({ value: "x".repeat(200) }),
    headers: {
      "Content-Length": "1",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  assert.deepEqual(await readJsonWithLimit(request, 64), {
    ok: false,
    reason: "too_large",
  });
});

test("streaming JSON limits parse valid bodies", async () => {
  const request = new Request("http://localhost/api/test", {
    body: JSON.stringify({ value: "safe" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  assert.deepEqual(await readJsonWithLimit(request, 1024), {
    data: { value: "safe" },
    ok: true,
  });
});
