import * as service from '../services/notification.service.js';
import * as summary from '../services/dailySummary.service.js';
import { env } from '../config/env.js';
import { asyncHandler, ok } from '../utils/http.js';

/** Everything here is the caller's OWN inbox; nobody reads another's. */
const me = (req) => req.auth.userId;

export const list = asyncHandler(async (req, res) => ok(res, await service.listMine(me(req), req.query)));

export const unreadCount = asyncHandler(async (req, res) => ok(res, await service.unreadCount(me(req))));

export const markRead = asyncHandler(async (req, res) => ok(res, await service.markRead(me(req), req.body)));

export const dismiss = asyncHandler(async (req, res) => ok(res, await service.dismiss(me(req), req.body)));

/**
 * Whether the daily summary is this person's to receive at all - holding
 * REPORT.SUMMARY - so the settings screen offers the switch only to them.
 */
const withSummary = (req, prefs) => ({
  ...prefs,
  dailySummary: {
    eligible: req.auth.has(summary.SUMMARY_PERMISSION),
    enabled: env.DAILY_SUMMARY_ENABLED,
    time: env.DAILY_SUMMARY_TIME,
  },
});

export const getPreferences = asyncHandler(async (req, res) =>
  ok(res, withSummary(req, await service.getPreferences(me(req)))),
);

export const setPreferences = asyncHandler(async (req, res) =>
  ok(res, withSummary(req, await service.setPreferences(me(req), req.body))),
);

/**
 * The caller's own daily summary for a day, as it would be sent - without
 * sending it. Every line is gated by the caller's own permissions, so this
 * shows nobody anything their screens would not.
 */
export const dailySummaryPreview = asyncHandler(async (req, res) =>
  ok(res, await summary.previewFor((code) => req.auth.has(code), req.query.date)),
);
