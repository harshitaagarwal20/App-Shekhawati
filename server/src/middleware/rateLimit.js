/**
 * Minimal in-process rate limiter for the credential endpoints.
 *
 * Intentionally dependency-free and in-memory: the stack for this project is
 * fixed and does not include a rate-limit package or Redis. That means the
 * counter is per-process and resets on restart, which is adequate for a single
 * on-premise API server slowing down password guessing. If the API is ever run
 * behind more than one process, move this to a shared store.
 *
 * ===========================================================================
 *  F-08 - WHY ONE LIMITER TAKES SEVERAL KEYS
 * ===========================================================================
 *
 * A limiter is only as good as what it counts. The login route counted
 * attempts PER USERNAME and nothing else, which left two holes on opposite
 * sides of the same key:
 *
 *   SPRAYING   One attacker, one IP, one weak password, every username in the
 *              company. Each account has its own fresh bucket, so nothing ever
 *              adds up and no limit is ever reached.
 *
 *   LOCKOUT    An attacker who knows a username burns its ten attempts every
 *              fifteen minutes and keeps a real person - plausibly the
 *              Director, whose approvals gate the whole pipeline - out of the
 *              system indefinitely. The limiter becomes the attack.
 *
 * Neither is fixed by tightening the one key: spraying needs a key that spans
 * accounts, and the lockout needs a key that does NOT let one origin exhaust
 * an account for everybody. So a limiter now takes a LIST of keys, counts an
 * attempt against every bucket in it, and refuses if ANY of them is over.
 *
 * ---------------------------------------------------------------------------
 *  AND WHY IT COUNTS FAILURES RATHER THAN REQUESTS
 *
 *  The first version of this counted every attempt, and the test suite found
 *  the flaw within a run: enough SUCCESSFUL logins from one address tripped
 *  the per-IP bucket. That is not a test artefact. This factory's machines sit
 *  behind one router, so as far as this middleware is concerned the whole
 *  office IS one address - and at the start of a shift, a dozen people signing
 *  in correctly would have locked out the thirteenth.
 *
 *  A successful login is not attack signal. It is the outcome the limiter
 *  exists to protect, and spending allowance on it means the ceilings have to
 *  be set high enough for a busy office, which is far too high to stop an
 *  attacker. Counting only what FAILS decouples the two: the ceilings can be
 *  as tight as the attack deserves, because no honest user ever approaches
 *  them.
 *
 *  `countWhen` decides what counts, and it runs on `res.on('finish')` - after
 *  the handler has decided. The check itself still happens BEFORE the handler,
 *  so a caller already over the line never reaches the password comparison.
 * ---------------------------------------------------------------------------
 */

const buckets = new Map();

/** Drops expired buckets so the map cannot grow without bound. */
function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

let lastSweep = 0;

/** Reads a bucket, treating an expired one as absent. */
function bucketFor(id, windowMs, now) {
  const existing = buckets.get(id);
  if (existing && existing.resetAt > now) return existing;
  const fresh = { count: 0, resetAt: now + windowMs };
  buckets.set(id, fresh);
  return fresh;
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs  Window length
 * @param {number} [opts.max]     Requests allowed per window, for `key`
 * @param {(req: import('express').Request) => string} [opts.key]
 *        A single bucket. Shorthand for a one-entry `keys`.
 * @param {Array<{max: number, windowMs?: number, key: (req) => string}>} [opts.keys]
 *        Several buckets, each with its own ceiling. The request is refused if
 *        any one of them is already exceeded. `windowMs` defaults to the outer
 *        window.
 * @param {(res: import('express').Response) => boolean} [opts.countWhen]
 *        Which responses consume allowance. Omitted, every request counts,
 *        which is the right rule for a plain throughput limit. The login route
 *        passes a predicate so that only FAILED attempts count - see above.
 */
export function rateLimit({ windowMs, max, key, keys, countWhen }) {
  const rules = keys?.length
    ? keys.map((r) => ({ ...r, windowMs: r.windowMs ?? windowMs }))
    : [{ max, windowMs, key: key ?? ((req) => `${req.ip}:${req.path}`) }];

  return (req, res, next) => {
    const now = Date.now();

    if (now - lastSweep > windowMs) {
      sweep(now);
      lastSweep = now;
    }

    const active = rules.map((rule) => ({ rule, bucket: bucketFor(rule.key(req), rule.windowMs, now) }));

    /*
     * The headers describe the TIGHTEST bucket - the one the caller will hit
     * first. Reporting the loosest would tell an honest client it had far more
     * attempts left than it does.
     */
    const tightest = active.reduce((a, b) =>
      b.rule.max - b.bucket.count < a.rule.max - a.bucket.count ? b : a,
    );
    res.setHeader('X-RateLimit-Limit', String(tightest.rule.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, tightest.rule.max - tightest.bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(tightest.bucket.resetAt / 1000)));

    const breached = active.find((c) => c.bucket.count >= c.rule.max);
    if (breached) {
      const retryAfter = Math.max(1, Math.ceil((breached.bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          /*
           * The message names no key. Saying "too many attempts for this
           * username" would confirm to a guesser that the account exists, and
           * saying "from this address" would tell them which bucket to work
           * around. One wording for every bucket.
           */
          message: `Too many attempts. Try again in ${retryAfter} second(s).`,
        },
      });
    }

    /*
     * Count on the way OUT, once the handler has decided.
     *
     * Every bucket is incremented, not just the tightest: a bucket that goes
     * uncounted because a different one is closer to its ceiling is a bucket
     * an attacker can hide behind.
     */
    res.on('finish', () => {
      if (countWhen && !countWhen(res)) return;
      const at = Date.now();
      for (const rule of rules) bucketFor(rule.key(req), rule.windowMs, at).count += 1;
    });

    next();
  };
}

/**
 * The predicate the credential routes use: anything that is not a success.
 *
 * A 401 is a wrong password, a 400 a malformed attempt, a 429 one that was
 * already over. All of them are noise a legitimate user makes rarely and an
 * attacker makes constantly, which is exactly what a ceiling should measure.
 */
export const onlyFailures = (res) => res.statusCode >= 400;

export default rateLimit;
