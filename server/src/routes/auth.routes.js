import { Router } from 'express';
import rateLimit, { onlyFailures } from '../middleware/rateLimit.js';
import validate from '../middleware/validate.js';
import authenticate from '../middleware/authenticate.js';
import * as controller from '../controllers/auth.controller.js';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
} from '../validators/auth.validator.js';

const router = Router();

// Public -------------------------------------------------------------------
/*
 * F-08 - THREE BUCKETS, BECAUSE ONE KEY CANNOT HOLD BOTH ENDS OF THIS.
 *
 * The route counted attempts per username alone. That is simultaneously too
 * loose and too tight: too loose because one attacker can try one password
 * against every account in the company without any of the per-account
 * counters ever adding up, and too tight because burning ten attempts on a
 * known username locks that person out for fifteen minutes, over and over,
 * for as long as the attacker cares to keep doing it.
 *
 * So the attempt is counted three ways, and refused if any one is over:
 *
 *   USERNAME + IP   10 / 15 min.  The original protection, and still the
 *                   tightest. Scoped to the origin, so one attacker exhausts
 *                   THEIR OWN allowance against an account rather than the
 *                   account's - the real user, on a different address, is
 *                   unaffected. This is the bucket a genuine fat-fingered
 *                   login trips, which is what it is sized for.
 *
 *   IP              30 / 15 min.  Spans accounts, so spraying one password
 *                   across forty usernames from one address stops at thirty
 *                   rather than never.
 *
 *   USERNAME        50 / 15 min.  The backstop for a genuinely distributed
 *                   attack on one account, where every request comes from a
 *                   different address and neither bucket above ever fills. Set
 *                   high on purpose: it is the only bucket a third party can
 *                   fill on somebody else's behalf, so it must not be
 *                   reachable by an attacker who would then have a lockout.
 *                   Five distinct origins failing ten times each in a quarter
 *                   of an hour is not a person mistyping a password.
 *
 * `onlyFailures` is what makes those ceilings affordable. This whole factory
 * sits behind one router, so the per-IP bucket is, in practice, the whole
 * office's bucket - and counting SUCCESSFUL logins against it would mean a
 * dozen people signing in correctly at the start of a shift locked out the
 * thirteenth. The first version of this did exactly that and the test suite
 * tripped it within one run. A login that succeeds is the outcome this
 * limiter exists to protect; only failures are attack signal, and only
 * failures are counted.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THE IP BUCKETS ARE WORTH, HONESTLY
 *
 *  `app.set('trust proxy', 1)` in app.js makes `req.ip` the last entry of
 *  X-Forwarded-For rather than the socket address. That is right behind
 *  exactly one reverse proxy, which is how this is meant to be deployed.
 *
 *  Run WITHOUT that proxy and the header is attacker-controlled: a sprayer can
 *  send a different X-Forwarded-For on every request and both IP buckets
 *  become one bucket per forged address, i.e. no bucket at all. The per-
 *  username backstop still holds at fifty, so the account is not defenceless,
 *  but the spraying limit is gone.
 *
 *  This is a deployment property, not something this file can fix, and it is
 *  written down here because the two are easy to get out of step: whoever
 *  changes the proxy in front of this API is changing what these buckets mean.
 * ---------------------------------------------------------------------------
 */
const loginKey = (req) => String(req.body?.username ?? '').trim().toLowerCase() || '<none>';

router.post(
  '/login',
  rateLimit({
    windowMs: 15 * 60_000,
    countWhen: onlyFailures,
    keys: [
      { max: 10, key: (req) => `login:user+ip:${loginKey(req)}:${req.ip}` },
      { max: 30, key: (req) => `login:ip:${req.ip}` },
      { max: 50, key: (req) => `login:user:${loginKey(req)}` },
    ],
  }),
  validate({ body: loginSchema }),
  controller.login,
);
/*
 * Refresh, for the same reason: a client with a valid session refreshes on a
 * timer and must never be throttled for doing so. What sixty failures in a
 * quarter of an hour means is somebody replaying stolen or guessed tokens.
 */
router.post(
  '/refresh',
  rateLimit({ windowMs: 15 * 60_000, max: 60, countWhen: onlyFailures }),
  validate({ body: refreshSchema }),
  controller.refresh,
);

// Authenticated ------------------------------------------------------------
router.get('/me', authenticate, controller.me);
router.get('/sessions', authenticate, controller.sessions);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), controller.changePassword);
router.post('/logout', authenticate, controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);

export default router;
