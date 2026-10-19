/**
 * Keeps the database connection pool open and ready.
 *
 * ---------------------------------------------------------------------------
 *  WHY
 *
 *  Opening a connection to PostgreSQL costs far more than a query on one: on
 *  a laptop ~100 ms each, against Azure's database over TLS considerably
 *  more. The pool opens connections only when a burst of queries asks for
 *  them, and the first burst after a start - the dashboard, right after
 *  login, fires a few dozen counts at once - paid for opening the whole pool
 *  at once. Measured locally: 2,300 ms for that burst on a cold pool, 6 ms on
 *  a warm one. That was the slow login.
 *
 *  Azure also drops a TCP connection that has sat idle for about four
 *  minutes, so a pool warmed at start goes cold again over a quiet spell and
 *  the next person pays the same price. Re-warming every three minutes keeps
 *  it open: ten trivial queries, a few milliseconds of database time.
 *
 *  Each warm-up query sleeps briefly so the queries overlap and the pool has
 *  to open a separate connection for each, rather than serving all of them
 *  down one.
 * ---------------------------------------------------------------------------
 */

import prisma from './prisma.js';
import { env } from './env.js';

const REWARM_MS = 3 * 60_000;

/** The pool size the connection string asks for, or Prisma's usual default. */
function poolSize() {
  const match = /[?&]connection_limit=(\d+)/.exec(env.DATABASE_URL ?? '');
  return match ? Number(match[1]) : 10;
}

export async function warmPool(size = poolSize()) {
  // $executeRaw: pg_sleep returns `void`, which $queryRaw cannot read back.
  await Promise.all(Array.from({ length: size }, () => prisma.$executeRaw`SELECT pg_sleep(0.05)`));
}

let timer = null;

/** Warms the pool now and keeps it warm. Failures are logged, never thrown. */
export function startPoolWarmer() {
  const run = () =>
    warmPool().catch((e) => process.stderr.write(`Pool warm-up failed: ${e.message}\n`));
  run();
  timer = setInterval(run, REWARM_MS);
  timer.unref();
}

export function stopPoolWarmer() {
  if (timer) clearInterval(timer);
  timer = null;
}
