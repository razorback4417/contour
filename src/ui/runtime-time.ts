const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

export function formatPacificTimestamp(value: string): string {
  const parts = pacificParts(timestampMs(value));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}

export function formatPacificRange(start: string, end: string): string {
  const startParts = pacificParts(timestampMs(start));
  const endParts = pacificParts(timestampMs(end));
  const sameDate = startParts.year === endParts.year
    && startParts.month === endParts.month
    && startParts.day === endParts.day
    && startParts.timeZoneName === endParts.timeZoneName;
  if (!sameDate) return `${formatPacificTimestamp(start)}–${formatPacificTimestamp(end)}`;
  return `${startParts.year}-${startParts.month}-${startParts.day} · ${startParts.hour}:${startParts.minute}:${startParts.second}–${endParts.hour}:${endParts.minute}:${endParts.second} ${startParts.timeZoneName}`;
}

export function formatPacificDateTimeInput(value: string): string {
  const parts = pacificParts(timestampMs(value));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function pacificDateTimeInputToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Invalid Pacific date and time.");
  const [, year, month, day, hour, minute, second = "00"] = match;
  const wallTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  let instant = wallTime - pacificOffsetAt(wallTime);
  instant = wallTime - pacificOffsetAt(instant);
  return new Date(instant).toISOString();
}

function pacificOffsetAt(instant: number): number {
  const parts = pacificParts(instant);
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ) - instant;
}

function pacificParts(instant: number): Record<Intl.DateTimeFormatPartTypes, string> {
  return Object.fromEntries(
    pacificFormatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  ) as Record<Intl.DateTimeFormatPartTypes, string>;
}

function timestampMs(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2"));
}
