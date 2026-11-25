export const VISIT_DURATIONS = [30, 60, 90] as const;
export type VisitSchedule = { date: string; time: string; minutes: number };
export const EMPTY_VISIT: VisitSchedule = { date: "", time: "", minutes: 60 };

export function visitTimes({ date, time, minutes }: VisitSchedule) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) ||
      !VISIT_DURATIONS.some(value => value === minutes)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (year < 2000 || year > 9998 || hour > 23 || minute > 59) return null;
  const civil = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day) return null;
  // The form asks for Phoenix time, not the device's time zone. Phoenix stays on MST.
  const start = new Date(civil.getTime() + 7 * 3_600_000);
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

function textValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldLine(line: string) {
  const encoder = new TextEncoder();
  let bytes = 0;
  let folded = "";
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      folded += "\r\n ";
      bytes = 1;
    }
    folded += character;
    bytes += size;
  }
  return folded;
}

function stamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function siteVisitCalendar(schedule: VisitSchedule, agenda: string, id: string, created: Date) {
  const times = visitTimes(schedule);
  if (!times || !agenda.trim() || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || !Number.isFinite(created.getTime())) return null;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SolarTelligence//Site visit agenda//EN",
    "BEGIN:VEVENT", "UID:" + id + "@solartelligence.com", "DTSTAMP:" + stamp(created),
    "DTSTART:" + stamp(times.start), "DTEND:" + stamp(times.end),
    "SUMMARY:Solar installer site visit", "DESCRIPTION:" + textValue(agenda), "CLASS:PRIVATE",
    "END:VEVENT", "END:VCALENDAR",
  ].map(foldLine).join("\r\n") + "\r\n";
}
