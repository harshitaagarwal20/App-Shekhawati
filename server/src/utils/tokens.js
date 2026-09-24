/**
 * Token and password primitives.
 *
 * Two token kinds, deliberately different in nature:
 *
 *   access token  - a short-lived signed JWT carrying the user id and the
 *                   resolved permission set. Never stored server-side.
 *   refresh token - a long random opaque string. Only its SHA-256 hash is
 *                   stored (`user_sessions.refresh_token_hash`), so a database
 *                   leak does not yield usable tokens, and revoking a row
 *                   genuinely ends the session.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

const ACCESS_AUDIENCE = 'shekhawati-erp';
const ACCESS_ISSUER = 'shekhawati-erp-api';

// ---------------------------------------------------------------------------
//  Passwords
// ---------------------------------------------------------------------------

export function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
//  Access token (JWT)
// ---------------------------------------------------------------------------

/**
 * @param {{id:string, username:string, fullName:string, sessionId:string,
 *          roles:string[], permissions:string[]}} payload
 */
export function signAccessToken(payload) {
  return jwt.sign(
    {
      sub: payload.id,
      username: payload.username,
      name: payload.fullName,
      sid: payload.sessionId,
      roles: payload.roles,
      perms: payload.permissions,
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN,
      audience: ACCESS_AUDIENCE,
      issuer: ACCESS_ISSUER,
    },
  );
}

/** @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError} */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    audience: ACCESS_AUDIENCE,
    issuer: ACCESS_ISSUER,
  });
}

// ---------------------------------------------------------------------------
//  Refresh token (opaque)
// ---------------------------------------------------------------------------

export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Refresh-token lifetime, from REFRESH_TOKEN_DAYS (default 7 days). */
export function refreshTokenExpiry() {
  const days = Number(process.env.REFRESH_TOKEN_DAYS || 7);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
