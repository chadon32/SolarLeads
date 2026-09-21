import assert from "node:assert/strict";
import test from "node:test";
import { deliverFollowUp, recoverInterruptedFollowUps } from "../src/lib/follow-up-processing";

type Row = Record<string, unknown>;
function databaseFixture(overrides: Row = {}) {
  const step: Row = { id: "follow-up-1", lead_id: "lead-1", step_order: 3, channel: "email", title: "Solar report", body: "Test content", attempts: 0, status: "queued", processed_at: null, ...overrides };
  const lead: Row = { name: "Test", email: "test@example.test", email_sent_at: null, marketing_email_consent: true };
  let failFinalize = false;
  const database = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      const query = {
        update(value: Row) { patch = value; return query; },
        select() { return query; },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
        in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
        lt(key: string, value: string) { filters.push((row) => typeof row[key] === "string" && row[key] < value); return query; },
        single() { return Promise.resolve(execute()); },
        maybeSingle() { return Promise.resolve(execute()); },
        then(resolve: (result: ReturnType<typeof execute>) => unknown) { return Promise.resolve(execute()).then(resolve); },
      };
      function execute() {
        if (table === "leads") return { data: { ...lead }, error: null };
        if (failFinalize && patch?.attempts) return { data: null, error: { message: "Database unavailable" } };
        if (!filters.every((matches) => matches(step))) return { data: null, error: null };
        if (patch) Object.assign(step, patch);
        return { data: { ...step }, error: null };
      }
      return query;
    },
  };
  return { database: database as unknown as Parameters<typeof deliverFollowUp>[0], step, lead, failFinalization() { failFinalize = true; } };
}

test("follow-up claims, failure recovery and status persistence", async (t) => {
  const previous = { RESEND_API_KEY: process.env.RESEND_API_KEY, FROM_EMAIL: process.env.FROM_EMAIL, DISABLE_EMAIL_SENDING: process.env.DISABLE_EMAIL_SENDING };
  process.env.RESEND_API_KEY = "fake-test-key";
  process.env.FROM_EMAIL = "reports@example.test";
  process.env.DISABLE_EMAIL_SENDING = "false";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  await t.test("concurrent scheduler and manual requests make only one provider call", async () => {
    const fixture = databaseFixture();
    let sends = 0;
    const sender = async () => { sends += 1; return "provider-test-1"; };
    const results = await Promise.all([
      deliverFollowUp(fixture.database, "follow-up-1", "scheduled", sender),
      deliverFollowUp(fixture.database, "follow-up-1", "manual", sender),
    ]);
    assert.equal(sends, 1);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(fixture.step.status, "sent");
    assert.match(String(fixture.step.delivery_message), /provider-test-1/);
  });

  await t.test("interrupted deliveries older than 24 hours never return to the send queue", async () => {
    const fixture = databaseFixture({ status: "processing", processed_at: "2020-01-01T00:00:00Z" });
    await recoverInterruptedFollowUps(fixture.database);
    assert.equal(fixture.step.status, "needs_review");
    const result = await deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => { assert.fail("Must not send"); });
    assert.equal(result, null);
  });

  await t.test("a provider timeout requires review rather than blind retry", async () => {
    const fixture = databaseFixture();
    const result = await deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => { throw new Error("Timeout"); });
    assert.equal(result?.status, "needs_review");
    assert.equal(await deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => { assert.fail("Must not retry"); }), null);
  });

  await t.test("successful send followed by database failure cannot be sent again", async () => {
    const fixture = databaseFixture();
    fixture.failFinalization();
    await assert.rejects(deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => "provider-test-1"), /could not be saved/);
    assert.equal(fixture.step.status, "processing");
    assert.equal(await deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => { assert.fail("Must not retry"); }), null);
  });

  await t.test("an expired worker cannot finalize a different claim", async () => {
    const fixture = databaseFixture();
    await assert.rejects(deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => {
      fixture.step.processed_at = "2099-01-01T00:00:00Z";
      return "provider-test-1";
    }), /could not be saved/);
    assert.equal(fixture.step.status, "processing");
  });

  await t.test("an initial report without acceptance evidence is not marked sent", async () => {
    const fixture = databaseFixture({ step_order: 1 });
    const result = await deliverFollowUp(fixture.database, "follow-up-1", "scheduled", async () => { assert.fail("Must not send initial report twice"); });
    assert.equal(result?.status, "needs_review");
  });

  await t.test("missing marketing consent never calls the email provider", async () => {
    const fixture = databaseFixture();
    fixture.lead.marketing_email_consent = false;
    const result = await deliverFollowUp(fixture.database, "follow-up-1", "manual", async () => { assert.fail("No consent"); });
    assert.equal(result?.status, "skipped");
  });
});
