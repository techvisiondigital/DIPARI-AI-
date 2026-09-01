/**
 * Timezone-aware date utility to calculate the next 10:00 AM slot.
 */
export interface Next10AMSlotResult {
  targetDate: Date;
  isoString: string;
  timestampMs: number;
  timestampSec: number;
  formattedLocal: string;
  isToday: boolean;
}

/**
 * Converts a wall-clock time in `timeZone` into the correct UTC instant.
 *
 * Builds the target as if it were UTC, formats that instant back in the target
 * zone to measure how far it drifted, then subtracts that drift. Handles DST
 * because the offset is measured at the target date rather than assumed.
 *
 * @param month 0-indexed, matching Date.UTC.
 */
function utcDateForLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const targetAsUtcMs = Date.UTC(year, month, day, hour, minute, 0, 0);

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const oMap: Record<string, string> = {};
  for (const p of offsetFormatter.formatToParts(new Date(targetAsUtcMs))) {
    if (p.type !== 'literal') oMap[p.type] = p.value;
  }

  // Intl renders midnight as hour 24 in some locales; normalise it.
  const oHour = parseInt(oMap.hour, 10) % 24;

  const localAsUtc = Date.UTC(
    parseInt(oMap.year, 10),
    parseInt(oMap.month, 10) - 1,
    parseInt(oMap.day, 10),
    oHour,
    parseInt(oMap.minute, 10),
    parseInt(oMap.second, 10),
  );

  return new Date(targetAsUtcMs - (localAsUtc - targetAsUtcMs));
}

/**
 * Calculates the exact next 10:00 AM execution slot for a given timezone or base date.
 * If current time in local timezone is before 10:00 AM, returns today at 10:00:00 AM.
 * If current time in local timezone is at or after 10:00 AM, returns tomorrow at 10:00:00 AM.
 *
 * @param timeZone - IANA Timezone string (e.g., 'Asia/Kolkata', 'America/New_York', 'UTC'). Defaults to system local time.
 * @param fromDate - Optional reference Date (defaults to now).
 */
export function calculateNext10AMSlot(
  timeZone?: string,
  fromDate?: Date,
): Next10AMSlotResult {
  const base = fromDate ? new Date(fromDate.getTime()) : new Date();

  // Create date object initialized to base time
  let target = new Date(base.getTime());

  if (timeZone) {
    try {
      // Format current time in specified timezone to extract YYYY-MM-DD
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const parts = formatter.formatToParts(base);
      const partMap: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== 'literal') partMap[p.type] = p.value;
      }

      const currentHour = parseInt(partMap.hour || '0', 10);

      // Determine if today's 10 AM in target timezone is still in the future
      const dayOffset = currentHour >= 10 ? 1 : 0;

      const year = parseInt(partMap.year, 10);
      const month = parseInt(partMap.month, 10) - 1; // 0-indexed
      const day = parseInt(partMap.day, 10) + dayOffset;

      // This previously returned `Date.UTC(year, month, day, 10, ...)` — the
      // local calendar date with 10:00 written as a UTC time, with the zone's
      // offset never applied. For Asia/Kolkata that published at 15:30 IST
      // instead of 10:00, five and a half hours late.
      target = utcDateForLocalTime(year, month, day, 10, 0, timeZone);
    } catch {
      // Fallback to standard local timezone calculation if invalid timezone string
      target.setHours(10, 0, 0, 0);
      if (target.getTime() <= base.getTime()) {
        target.setDate(target.getDate() + 1);
        target.setHours(10, 0, 0, 0);
      }
    }
  } else {
    // Standard local normalization to 10:00 AM
    target.setHours(10, 0, 0, 0);
    if (target.getTime() <= base.getTime()) {
      target.setDate(target.getDate() + 1);
      target.setHours(10, 0, 0, 0);
    }
  }

  const timestampMs = target.getTime();
  const timestampSec = Math.floor(timestampMs / 1000);

  // Compare calendar days in the TARGET timezone. Using getDate() compared the
  // server's local day, so a slot that is "today" in Kolkata read as tomorrow
  // on a UTC server, and vice versa.
  const dayKey = (d: Date) =>
    timeZone
      ? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const isToday = dayKey(target) === dayKey(base);

  return {
    targetDate: target,
    isoString: target.toISOString(),
    timestampMs,
    timestampSec,
    formattedLocal: target.toLocaleString('en-US', { timeZone: timeZone || undefined }),
    isToday,
  };
}
