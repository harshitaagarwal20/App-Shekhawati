/**
 * SHADE AND DYE LOT - one bag, one shade.
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS
 * ===========================================================================
 *
 *  A tote is cut from several panels - front, back, gusset, handles, pocket -
 *  and they are stitched side by side. Cloth dyed in two batches differs by a
 *  shade the buyer's inspector sees across the seam, and the whole lot is
 *  rejected at final inspection, long after the cloth has been cut and paid
 *  for. So the panels of one cutting requirement must come off rolls of the
 *  SAME shade band and the SAME dye lot.
 *
 *  The cutting challan line is the requirement a set of panels is cut
 *  against, so it is the unit this rule is applied to: the first roll issued
 *  against a line fixes its shade and lot, and every later roll must match.
 *
 * ---------------------------------------------------------------------------
 *  WHAT "MATCH" MEANS
 *
 *   - Two known values that differ are a mix.
 *   - A known value against an unknown one is ALSO a mix. "We never graded
 *     that roll" is exactly the case this exists to catch - an ungraded roll
 *     is whatever shade it turns out to be.
 *   - Unknown against unknown is not a mix. A store that grades nothing is
 *     not stopped by this rule; it simply gets no protection from it.
 *
 *  A mix is not impossible - a buyer may accept a shade band spread, or the
 *  panels may go to different bags. It is REFUSED WITHOUT A REASON, and the
 *  reason is stored on the issue that caused it.
 *
 *  Pure, so it runs identically in the posting transaction, in a preview and
 *  in a unit test with no database.
 * ---------------------------------------------------------------------------
 */

/** Shades and lots are compared case- and space-insensitively: "a " is "A". */
export function normaliseShade(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ').toUpperCase();
  return text || null;
}

/** The shortest reason that is still a reason rather than a keystroke. */
export const MIN_MIX_REASON = 10;

function describe({ shade, dyeLot }) {
  const parts = [];
  parts.push(shade ? `shade ${shade}` : 'no shade');
  parts.push(dyeLot ? `lot ${dyeLot}` : 'no lot');
  return parts.join(', ');
}

/**
 * Judges one roll against what a challan line has already been cut from.
 *
 * @param {{rollNo?: string, shade?: string|null, dyeLot?: string|null}} roll
 * @param {Array<{rollNo?: string, issueNo?: string, shade?: string|null, dyeLot?: string|null}>} established
 *        the issues already posted against the line, oldest first
 * @returns {{ok: boolean, reference: object|null, conflicts: string[], message: string|null}}
 */
export function assessShadeMix(roll, established = []) {
  if (!established.length) {
    return { ok: true, reference: null, conflicts: [], message: null };
  }

  const candidate = { shade: normaliseShade(roll.shade), dyeLot: normaliseShade(roll.dyeLot) };

  // The FIRST issue fixes the line. Later issues that already mixed (with a
  // reason) do not move the reference - the line is still "meant" to be the
  // shade it started as.
  const first = established[0];
  const reference = {
    shade: normaliseShade(first.shade),
    dyeLot: normaliseShade(first.dyeLot),
    rollNo: first.rollNo ?? null,
    issueNo: first.issueNo ?? null,
  };

  const conflicts = [];
  for (const field of ['shade', 'dyeLot']) {
    const a = reference[field];
    const b = candidate[field];
    if (a === null && b === null) continue;
    if (a !== b) conflicts.push(field);
  }

  if (!conflicts.length) return { ok: true, reference, conflicts, message: null };

  return {
    ok: false,
    reference,
    conflicts,
    message:
      `Roll ${roll.rollNo ?? ''} is ${describe(candidate)}, but this cutting line was started on ` +
      `${describe(reference)}${reference.rollNo ? ` (roll ${reference.rollNo})` : ''}. Panels of one ` +
      'bag must come from the same shade and dye lot. Issue a matching roll, or give a reason ' +
      'for mixing them.',
  };
}

/**
 * Whether a mix may proceed: only with a real reason.
 *
 * @returns {string|null} the reason to store, or null when there is none
 */
export function acceptedMixReason(reason) {
  const text = String(reason ?? '').trim();
  return text.length >= MIN_MIX_REASON ? text : null;
}
