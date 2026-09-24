import * as service from '../services/notification.service.js';
import { asyncHandler, ok } from '../utils/http.js';

/** Everything here is the caller's OWN inbox; nobody reads another's. */
const me = (req) => req.auth.userId;

export const list = asyncHandler(async (req, res) => ok(res, await service.listMine(me(req), req.query)));

export const unreadCount = asyncHandler(async (req, res) => ok(res, await service.unreadCount(me(req))));

export const markRead = asyncHandler(async (req, res) => ok(res, await service.markRead(me(req), req.body)));

export const getPreferences = asyncHandler(async (req, res) =>
  ok(res, await service.getPreferences(me(req))),
);

export const setPreferences = asyncHandler(async (req, res) =>
  ok(res, await service.setPreferences(me(req), req.body)),
);
