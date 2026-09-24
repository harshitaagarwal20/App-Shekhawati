import * as authService from '../services/auth.service.js';
import { asyncHandler, ok } from '../utils/http.js';

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] ?? req.ip ?? '').trim() || null;

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login({
    username: req.body.username,
    password: req.body.password,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'],
  });
  return ok(res, result);
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh({
    refreshToken: req.body.refreshToken,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'],
  });
  return ok(res, result);
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout({ sessionId: req.auth.sessionId });
  return ok(res, { loggedOut: true });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const count = await authService.logoutAll({ userId: req.auth.userId });
  return ok(res, { sessionsEnded: count });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.auth.userId);
  return ok(res, user);
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({
    userId: req.auth.userId,
    sessionId: req.auth.sessionId,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });
  return ok(res, { changed: true });
});

export const sessions = asyncHandler(async (req, res) => {
  const rows = await authService.listSessions(req.auth.userId);
  return ok(res, rows.map((s) => ({ ...s, current: s.id === req.auth.sessionId })));
});
