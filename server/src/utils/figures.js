/**
 * The two expressions every counting service was writing out by hand.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS FILE EXISTS
 *
 *  `D` and `ageDays` were copied verbatim into report.service.js and
 *  dashboard.service.js, and the day-difference arithmetic inside `ageDays`
 *  had two further copies inside approvalEngine.js. Four sites, one rule.
 *
 *  The rule is not as obvious as it looks. "Whole days between then and now"
 *  is currently elapsed 24-hour periods, NOT calendar days in Asia/Kolkata -
 *  so a document raised at 11pm is "0 days old" at 8am the next morning. That
 *  is a decision, it is arguable, and the day somebody wants to argue it they
 *  should have to change it in one place and see every ageing column in the
 *  application move together.
 *
 *  The soft-delete filter these modules also shared is NOT here: it already
 *  exists as `notDeleted` in config/prisma.js, which is where a filter over
 *  Prisma rows belongs.
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client';

/** Money and quantity are Decimal everywhere, and a missing one is zero. */
export const D = (v) => new Prisma.Decimal(v ?? 0);

const MS_PER_DAY = 86400000;

/**
 * Whole days between a timestamp and now; `null` in, `null` out.
 *
 * Every ageing figure in the application - report columns, approval queue
 * ages, dashboard "oldest has been waiting" - comes through here.
 */
export const ageDays = (from) =>
  from ? Math.floor((Date.now() - new Date(from).getTime()) / MS_PER_DAY) : null;

export default { D, ageDays };
