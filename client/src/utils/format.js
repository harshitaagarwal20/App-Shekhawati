/**
 * Display formatting. One module, so that a date reads the same on every screen.
 *
 * ---------------------------------------------------------------------------
 *  DATES ARE STORED IN UTC AND DISPLAYED IN ASIA/KOLKATA, AS DD-MM-YYYY
 *
 *  The server stores every timestamp as `timestamptz` in UTC and sends ISO
 *  strings. Nothing in this application stores Indian local time as a database
 *  timestamp - which matters more than it sounds, because a server that
 *  restarts in a different timezone would otherwise silently shift every
 *  historical date by five and a half hours.
 *
 *  The conversion happens HERE, at the last possible moment, and always to
 *  Asia/Kolkata regardless of where the browser thinks it is. A director
 *  checking an order from Frankfurt sees the same date the Jaipur office does,
 *  which is the whole point: the delivery date is a fact about Jaipur.
 *
 *  `toLocaleDateString()` with no arguments - which is what these screens used
 *  to call - gives whatever the viewer's machine is set to. That produces
 *  04/03/2026 for one user and 03/04/2026 for another, from the same row.
 *  These functions replace it everywhere.
 *
 *  NUMBERS ARE DISPLAYED HERE, NEVER CALCULATED HERE
 *
 *  The formatters below take a value the SERVER computed and render it. There
 *  is no arithmetic in this file beyond what a thousands separator needs.
 *  Amounts, variations, excesses and requirements all arrive already worked
 *  out, because the figure on screen and the figure in the database have to
 *  come from one piece of code, and that code runs on the server.
 * ---------------------------------------------------------------------------
 */

/** The office's timezone. Not the browser's. */
export const DISPLAY_TIMEZONE = 'Asia/Kolkata';

/** The office's date format. */
export const DATE_FORMAT = 'DD-MM-YYYY';

const DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parse(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A date as DD-MM-YYYY, in Asia/Kolkata.
 *
 * @param {string|Date|null|undefined} value  An ISO string from the API
 * @param {string} [fallback]
 */
export function fmtDate(value, fallback = '-') {
  const date = parse(value);
  if (!date) return fallback;

  // en-GB already orders the parts day/month/year; the separator is the only
  // thing that needs changing, and doing it from the parts rather than by
  // string-replacing a slash keeps it correct if the locale data ever shifts.
  const parts = Object.fromEntries(
    DATE_PARTS.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.day}-${parts.month}-${parts.year}`;
}

/** A date and time as DD-MM-YYYY HH:mm, in Asia/Kolkata. */
export function fmtDateTime(value, fallback = '-') {
  const date = parse(value);
  if (!date) return fallback;
  return `${fmtDate(date)} ${TIME_PARTS.format(date)}`;
}

/**
 * A date for an `<input type="date">`, which wants YYYY-MM-DD.
 *
 * Deliberately NOT `toISOString().slice(0, 10)`: that converts to UTC first, so
 * an Indian evening becomes the previous day. This takes the Kolkata calendar
 * date, which is the one the user meant when they picked it.
 */
export function toDateInput(value) {
  const date = parse(value);
  if (!date) return '';
  const parts = Object.fromEntries(
    DATE_PARTS.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Today, in Asia/Kolkata, ready for an `<input type="date">`. */
/**
 * "Now", in the shape `<input type="datetime-local">` wants: YYYY-MM-DDTHH:mm,
 * in the BROWSER'S OWN timezone rather than UTC.
 *
 * `toISOString()` would be an hour or five out for anyone not on UTC, and a
 * gate pass whose movement time is five and a half hours in the future is
 * refused outright by the server - so getting this wrong in Jaipur would make
 * the field unusable rather than merely inaccurate.
 */
export function nowLocalInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function todayInput() {
  return toDateInput(new Date());
}

/** How long ago, in whole days. For "waiting since" columns. */
export function daysAgo(value) {
  const date = parse(value);
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
//  Numbers. Rendered, never computed.
// ---------------------------------------------------------------------------

/** A quantity or an amount the server worked out, with thousands separators. */
export function fmtNum(value, { decimals = 2, fallback = '-' } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** Money, always to two places, in the Indian grouping the office reads in. */
export function fmtMoney(value, { fallback = '-' } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A percentage the SERVER has already converted from a fraction.
 *
 * Prefer the `...Display` field the API sends - `permittedPctDisplay`,
 * `variationPctDisplay`, `shrinkagePctDisplay` - over converting here. This
 * exists for the older endpoints that still send a bare fraction.
 */
export function fmtPctFromFraction(value, { decimals = 2, fallback = '-' } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return `${(n * 100).toFixed(decimals)}%`;
}

/*
 * THERE IS DELIBERATELY NO `fmtPct` HERE.
 *
 * There used to be one, meaning "the server already did the x100, just add a
 * sign". It had no callers, but it had a NAME - and two screens had each
 * written their own local `fmtPct` that did the opposite, multiplying a
 * fraction by 100. Three functions, two behaviours, one name.
 *
 * That is a factor-of-100 error waiting for whoever imports the wrong one:
 * a 5% excess stored as `0.05` prints as "0.05%" instead of "5.00%", and the
 * output is plausible enough to survive review. Percentages in this system
 * are stored as FRACTIONS, so there is exactly one way to print one, and it
 * says so in its name.
 *
 * A value the API has already expressed as a percentage needs no helper -
 * prefer the `...Display` fields described above.
 */

/** SCREAMING_SNAKE enum to something a person can read. */
/**
 * The words in an enum that are NOT words.
 *
 * Sentence-casing an enum is right for STATUS values - IN_PROGRESS reads far
 * better as "In progress" than as a shout. It is wrong for the ones that are
 * initials: the Stock Movement register was labelling every goods receipt
 * "Grn", which is not a word, not what the document is called, and not what
 * the rest of the screen calls it two columns away.
 */
const ACRONYMS = new Set([
  'GRN', 'PO', 'GST', 'GSTIN', 'HSN', 'BOM', 'UOM', 'GSM', 'QC', 'MRN', 'FOB', 'CIF',
]);

export function fmtEnum(value, fallback = '-') {
  if (!value) return fallback;
  return String(value)
    .split('_')
    .filter(Boolean)
    .map((word, i) => {
      if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
      const lower = word.toLowerCase();
      // Sentence case, not Title Case: only the first word is capitalised, so
      // "SENT_TO_SCRUTINY" reads "Sent to scrutiny" rather than shouting.
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
