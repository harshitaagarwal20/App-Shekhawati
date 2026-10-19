/**
 * Dates as people in the factory read them.
 *
 * `toISOString().slice(0, 10)` is the UTC calendar date, which runs 05:30
 * behind India: anything done between midnight and 05:30 IST comes out as the
 * day before. It is also YYYY-MM-DD, where every screen and print in this
 * application says DD-MM-YYYY (client/src/utils/format.js). Messages and
 * file names that name a day go through here instead.
 */

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function partsOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Object.fromEntries(PARTS.formatToParts(d).map((p) => [p.type, p.value]));
}

/** DD-MM-YYYY, the Indian calendar day. '' for a missing or bad value. */
export function istDate(value) {
  if (value == null) return '';
  const p = partsOf(value);
  return p ? `${p.day}-${p.month}-${p.year}` : '';
}

/** YYYY-MM-DD of the Indian calendar day - for file names, which sort. */
export function istIsoDate(value = new Date()) {
  const p = partsOf(value);
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}
