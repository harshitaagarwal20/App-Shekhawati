import path from 'node:path';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { auditContext } from './config/auditContext.js';
import { ApiError } from './utils/ApiError.js';

export function createApp() {
  const app = express();

  // Correct client IPs behind a reverse proxy - the rate limiter and the
  // session record both key on them.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

  /**
   * In DEVELOPMENT ONLY, any localhost port is allowed.
   *
   * ---------------------------------------------------------------------------
   *  WHY, AND WHY IT IS NOT A WEAKENING
   *
   *  Vite picks the next free port when 5175 is taken - by a stray dev server,
   *  a second checkout, a previous run that did not exit. It then serves the
   *  app from :5176, the allowlist names only :5175, and every API call fails
   *  CORS. The error names the origin but not the cause, and the obvious
   *  "fix" is to widen CLIENT_ORIGIN in .env - which is how a production
   *  allowlist quietly acquires a localhost entry.
   *
   *  So the tolerance lives HERE, gated on NODE_ENV, where it cannot reach a
   *  deployed environment. In production the allowlist is exactly what
   *  CLIENT_ORIGIN says and nothing else - no localhost, no wildcard.
   * ---------------------------------------------------------------------------
   */
  const isDev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

  /*
   * The origin gate, ahead of CORS.
   *
   * A refused origin is answered here as a plain 403. It used to be an Error
   * passed to the cors callback, which reached the error handler as an
   * unknown error and went back as "500 Something went wrong".
   *
   * The site's OWN origin always passes. The built client loads its bundle
   * with `<script type="module" crossorigin>`, and the browser sends an Origin
   * header on that same-site request - so a deployment whose CLIENT_ORIGIN
   * did not happen to list its own URL served every asset as a 500 and the
   * page came up blank.
   */
  const isOriginAllowed = (origin, req) => {
    if (allowedOrigins.includes(origin)) return true;
    if (isDev && LOCALHOST.test(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };

  app.use((req, _res, next) => {
    const { origin } = req.headers;
    // Non-browser callers send no Origin header.
    if (!origin || isOriginAllowed(origin, req)) return next();
    return next(
      new ApiError(
        403,
        `Origin ${origin} is not allowed.` +
          (isDev ? ' Add it to CLIENT_ORIGIN in server/.env, or serve the client from localhost.' : ''),
        { code: 'ORIGIN_NOT_ALLOWED' },
      ),
    );
  });

  app.use(
    cors({
      // Every origin that reaches this line has passed the gate above.
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      /*
       * A header the browser cannot read is a header that does not exist.
       *
       * CORS hides every response header from JavaScript except a short safe
       * list, so a cross-origin fetch - which is every call in development,
       * with the client on :5175 and the API on :4000 - sees these as
       * undefined unless they are named here.
       *
       * The two file headers matter as much as the rate-limit ones. Without
       * Content-Disposition an export saves under the route it came from
       * rather than as `buyers-2026-09-04.csv`, and without X-Row-Count the
       * screen cannot say how many rows it just handed to the browser. Both
       * failures are silent: the download still works, slightly wrongly.
       */
      exposedHeaders: [
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
        'Content-Disposition',
        'X-Row-Count',
      ],
    }),
  );

  // Makes the requesting user visible to the audit extension in
  // config/prisma.js, which is far below the route and has no `req`. Mounted
  // before `authenticate` so it also covers writes made by anonymous requests;
  // the actor is read lazily, once there is one.
  app.use(auditContext);

  /**
   * gzip on the way out.
   *
   * ---------------------------------------------------------------------------
   *  WHY THIS EARNS ITS PLACE
   *
   *  Every response this API sends is JSON, and JSON of the shape this one
   *  sends - the same twenty keys repeated once per row, quantities as decimal
   *  STRINGS rather than numbers - compresses roughly 8:1. A stock page, a
   *  report page or a ledger page is a few hundred kilobytes uncompressed and
   *  a few tens of kilobytes over the wire.
   *
   *  That matters here more than it would on a fast connection: the people
   *  using this are on a factory floor in Jaipur, and the store manager's
   *  screens are the biggest payloads in the application.
   *
   *  Mounted BEFORE the routes so it wraps every one of them, and before the
   *  body parsers only by convention - it acts on the response, so the order
   *  between the two does not matter.
   *
   *  The default threshold (1 kB) is left alone: below that, the gzip header
   *  costs more than the saving.
   * ---------------------------------------------------------------------------
   */
  app.use(compression());

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Baseline security headers. Set by hand rather than with helmet, which is
  // not part of the fixed stack for this project.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    // The built client loads only its own /assets bundle - no inline script,
    // no CDN, no web font - so everything can be pinned to 'self'. Inline
    // styles stay allowed for the style attributes React writes. blob: covers
    // the attachment and export downloads, which are handed over as object URLs.
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    // Only where the site is actually served over HTTPS; sent from a plain
    // http://localhost it would be ignored at best.
    if (env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  if (env.NODE_ENV === 'development') {
    app.use((req, _res, next) => {
      process.stdout.write(`${req.method} ${req.originalUrl}\n`);
      next();
    });
  }

  app.use('/api', routes);

  // In a deployed build the client is served from the same origin as the API,
  // so the browser never makes a cross-origin call. CLIENT_DIST points at the
  // built client; unset (as in development, where Vite serves it) this is off.
  if (process.env.CLIENT_DIST) {
    const clientDist = path.resolve(process.env.CLIENT_DIST);
    app.use(express.static(clientDist, { index: false, maxAge: '1y', immutable: true }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
