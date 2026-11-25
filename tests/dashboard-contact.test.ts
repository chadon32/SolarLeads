import { strict as assert } from "node:assert";
import test from "node:test";
import { readDashboardContact, withDashboardContactColumns } from "../src/lib/dashboard-contact";

test("explicit installer preference is independent of pipeline stage or contact details", () => {
  assert.deepEqual(readDashboardContact(true, " email "), { request: "requested", preferredMethod: "Email" });
  assert.deepEqual(readDashboardContact(true, "phone"), { request: "requested", preferredMethod: "Phone" });
  assert.deepEqual(readDashboardContact(true, "unspecified"), { request: "requested", preferredMethod: null });
  assert.deepEqual(readDashboardContact(false, "Phone"), { request: "report", preferredMethod: null });
  for (const value of [null, undefined, "true", 1]) {
    assert.deepEqual(readDashboardContact(value, "Email"), { request: "unknown", preferredMethod: null });
  }
});

test("legacy projections drop only explicitly missing fields and retain known consent", async () => {
  const calls: string[] = [];
  const read = withDashboardContactColumns(async columns => {
    calls.push(columns);
    return { error: columns.includes("preferred_contact_method")
      ? { code: "42703", message: "column leads.preferred_contact_method does not exist" } : null };
  });
  assert.equal((await read("id")).error, null);
  assert.equal((await read("id,status")).error, null);
  assert.deepEqual(calls, ["id, installer_contact_consent, preferred_contact_method", "id, installer_contact_consent", "id,status, installer_contact_consent"]);
});

test("missing both optional columns falls back once per column; other errors propagate", async () => {
  let calls = 0;
  const read = withDashboardContactColumns(async columns => {
    calls++;
    const field = ["installer_contact_consent", "preferred_contact_method"].find(key => columns.includes(key));
    return { error: field ? { code: "PGRST204", message: `Could not find the '${field}' column` } : null };
  });
  assert.equal((await read("id")).error, null);
  assert.equal(calls, 3);
  for (const error of [
    { code: "42501", message: "permission denied for installer_contact_consent" },
    { code: "42703", message: "column leads.other_field does not exist" },
  ]) {
    let tries = 0;
    const fail = withDashboardContactColumns(async () => { tries++; return { error }; });
    assert.deepEqual((await fail("id")).error, error);
    assert.equal(tries, 1);
  }
});
