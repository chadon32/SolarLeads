import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_VISIT, siteVisitCalendar, visitTimes } from "../src/lib/site-visit-calendar";

const schedule = { date: "2028-02-29", time: "23:45", minutes: 90 };
const created = new Date("2026-11-24T17:18:19.123Z");

test("Phoenix calendar times stay fixed in both seasons and roll over month and year ends", () => {
  for (const [day, expectedStart, expectedEnd] of [
    ["2028-02-29", "2028-03-01T06:45:00.000Z", "2028-03-01T08:15:00.000Z"],
    ["2027-06-30", "2027-07-01T06:45:00.000Z", "2027-07-01T08:15:00.000Z"],
    ["2027-12-31", "2028-01-01T06:45:00.000Z", "2028-01-01T08:15:00.000Z"],
  ]) {
    const times = visitTimes({ ...schedule, date: day });
    assert.equal(times?.start.toISOString(), expectedStart);
    assert.equal(times?.end.toISOString(), expectedEnd);
  }
  for (const minutes of [30, 60, 90]) {
    const times = visitTimes({ ...schedule, minutes })!;
    assert.equal(times.end.getTime() - times.start.getTime(), minutes * 60_000);
  }
});

test("incomplete schedules, impossible dates and unsupported durations cannot generate a file", () => {
  for (const invalid of [EMPTY_VISIT, { ...schedule, date: "2027-02-29" }, { ...schedule, date: "2028-13-01" },
    { ...schedule, date: "2028-04-31" }, { ...schedule, date: "9999-12-31" }, { ...schedule, date: "28-7-1" },
    { ...schedule, time: "24:00" }, { ...schedule, time: "09:60" }, { ...schedule, time: "" },
    { ...schedule, minutes: 0 }, { ...schedule, minutes: 61 }]) {
    assert.equal(siteVisitCalendar(invalid, "Checklist", "test-id", created), null);
  }
  assert.equal(siteVisitCalendar(schedule, " ", "test-id", created), null);
  assert.equal(siteVisitCalendar(schedule, "Checklist", "invalid\nvalue", created), null);
  assert.equal(siteVisitCalendar(schedule, "Checklist", "test-id", new Date(NaN)), null);
});

test("exports a private standalone event, not an invitation, with unambiguous UTC timestamps", () => {
  const file = siteVisitCalendar(schedule, "My questions", "test-id", created)!;
  const lines = file.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.deepEqual(lines.slice(-3), ["END:VEVENT", "END:VCALENDAR", ""]);
  for (const line of ["VERSION:2.0", "BEGIN:VEVENT", "UID:test-id@solartelligence.com", "DTSTAMP:20261124T171819Z",
    "DTSTART:20280301T064500Z", "DTEND:20280301T081500Z", "CLASS:PRIVATE", "DESCRIPTION:My questions"]) assert.ok(lines.includes(line));
  assert.doesNotMatch(file, /^(?:ATTENDEE|ORGANIZER|LOCATION|METHOD|URL|BEGIN:VALARM)[:;]/m);
  assert.doesNotMatch(file.replaceAll("\r\n", ""), /[\n\r]/);
});

test("escaped agenda text survives RFC 5545 folding without splitting Unicode code points", () => {
  const letters = "\u00e9\u{1f31e}".repeat(60);
  const agenda = "Roof, quote; wiring\\shade\r\n" + letters + "\rNext\nLast";
  const file = siteVisitCalendar(schedule, agenda, "test-id", created)!;
  for (const line of file.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  assert.ok(file.includes("\r\n "));
  assert.ok(file.replace(/\r\n /g, "").split("\r\n").includes("DESCRIPTION:Roof\\, quote\\; wiring\\\\shade\\n" + letters + "\\nNext\\nLast"));
});
