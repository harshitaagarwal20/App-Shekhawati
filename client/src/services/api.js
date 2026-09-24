/**
 * Axios instance for the ERP API.
 *
 * Handles the access/refresh token pair: the access token is attached to every
 * request, and a 401 caused by an expired access token triggers a single
 * refresh, after which the original request is replayed. Concurrent 401s share
 * one refresh rather than each firing their own.
 *
 * Tokens live in localStorage. That is a deliberate trade-off for an
 * on-premise ERP used on shared factory machines: httpOnly cookies would be
 * stronger against XSS but need same-site cookie handling and a CSRF defence,
 * and the access token here is short-lived and revocable server-side. The
 * server is the security boundary either way - it re-checks the session and
 * re-reads permissions on every single request.
 */

import axios from 'axios';

const ACCESS_KEY = 'si.accessToken';
const REFRESH_KEY = 'si.refreshToken';

function tryLocalStorage(fn) {
  try {
    return fn();
  } catch {
    /* private mode - the session simply will not survive a reload */
    return null;
  }
}

export const tokenStore = {
  get access() {
    return tryLocalStorage(() => localStorage.getItem(ACCESS_KEY));
  },
  get refresh() {
    return tryLocalStorage(() => localStorage.getItem(REFRESH_KEY));
  },
  set({ accessToken, refreshToken }) {
    tryLocalStorage(() => {
      if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    });
  },
  clear() {
    tryLocalStorage(() => {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    });
  },
};

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

/*
 * ===========================================================================
 *  A MULTIPART BODY MUST NOT INHERIT THE JSON CONTENT-TYPE DEFAULT
 * ===========================================================================
 *
 *  The instance above declares `Content-Type: application/json`, which is
 *  right for the ninety-odd JSON endpoints and WRONG - silently, and in a way
 *  that looks like a server bug - for the two that send a file.
 *
 *  Axios 1.x reads that header before it decides what the body is:
 *
 *      if (isFormData) {
 *        return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;
 *      }
 *
 *  So a FormData carrying a File was not sent as multipart at all. It was
 *  flattened to JSON, in which a File serialises to `{}` - and the server, with
 *  nothing for multer to parse and no `csv` field in the body, answered
 *  "No file was sent. Choose a CSV file to import." with the file plainly
 *  sitting in the file picker. The same request broke the order attachment
 *  upload.
 *
 *  Both call sites already knew not to set the header (see the comments on
 *  dataImports.send and orders.attachments.upload in erp.js) - but neither
 *  could DELETE a default set on the instance. This is the only place that can,
 *  so it is the only place that should: a new file upload written next year
 *  gets this for free rather than rediscovering it.
 *
 *  Deleted, not overwritten: only the browser knows the boundary string it
 *  generated, so the header has to be absent for the adapter to write
 *  `multipart/form-data; boundary=...` itself.
 * ---------------------------------------------------------------------------
 */
api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  return config;
});

/** Called when refresh fails - the AuthProvider registers a handler here. */
let onSessionLost = () => {};
export function setSessionLostHandler(fn) {
  onSessionLost = fn;
}

let refreshPromise = null;

async function refreshAccessToken() {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('No refresh token');

  // A bare axios call, so this request does not re-enter the interceptor.
  const { data } = await axios.post(
    `${api.defaults.baseURL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' } },
  );
  tokenStore.set(data.data);
  return data.data.accessToken;
}

/** Only an expired/invalid token is worth retrying - a revoked session is not. */
const RETRYABLE = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHENTICATED']);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;

    if (!response) {
      return Promise.reject(
        new ApiClientError('The server is unreachable. Check your connection and try again.', 0),
      );
    }

    /*
     * A FAILED FILE REQUEST STILL CARRIES A SENTENCE, AND IT HAS TO BE READ.
     *
     * `responseType: 'blob'` applies to the failure as well as the success, so
     * the JSON error body of a refused download arrives as a Blob and every
     * `response.data?.error?.message` below reads `undefined` - the user gets
     * "Something went wrong" for a refusal that said exactly what was wrong
     * and how to fix it ("this export would be 82,000 rows; narrow it with a
     * date range"). Unpacking it here means every file route gets its real
     * message without any of them having to know about this.
     */
    if (response.data instanceof Blob && response.data.type?.includes('json')) {
      try {
        response.data = JSON.parse(await response.data.text());
      } catch {
        /* not JSON after all - fall through to the generic message */
      }
    }

    const code = response.data?.error?.code;

    if (
      response.status === 401 &&
      RETRYABLE.has(code) &&
      !config._retried &&
      !config.url?.includes('/auth/refresh') &&
      !config.url?.includes('/auth/login')
    ) {
      config._retried = true;
      try {
        refreshPromise = refreshPromise ?? refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const token = await refreshPromise;
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      } catch {
        tokenStore.clear();
        onSessionLost();
        return Promise.reject(new ApiClientError('Your session has ended. Please sign in again.', 401, 'SESSION_LOST'));
      }
    }

    if (response.status === 401) {
      tokenStore.clear();
      onSessionLost();
    }

    return Promise.reject(
      new ApiClientError(
        response.data?.error?.message ?? 'Something went wrong',
        response.status,
        code,
        response.data?.error?.details,
      ),
    );
  },
);

/** Normalised error the UI can render without knowing about axios. */
export class ApiClientError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field errors from the server, shaped for react-hook-form's setError. */
  get fieldErrors() {
    const fields = this.details?.fields;
    if (!fields) return null;
    return Object.fromEntries(
      Object.entries(fields).map(([key, messages]) => [key, messages.join(' ')]),
    );
  }
}

/** Unwraps `{ success, data }` so callers deal in plain data. */
export async function request(config) {
  const { data } = await api(config);
  return data.data;
}

/**
 * A binary response - a file rather than JSON.
 *
 * `responseType: 'blob'` keeps axios from parsing the body as text, which for
 * a PDF means corrupting it. The interceptors still run, so a 401 here still
 * refreshes the token and replays exactly as it does everywhere else.
 */
export async function requestBlob(config) {
  const { data } = await api({ ...config, responseType: 'blob' });
  return data;
}

/** The name the server gave the file, out of its Content-Disposition. */
function fileNameFromDisposition(header) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * A download, with the two things around it the caller needs.
 *
 * `requestBlob` throws the headers away, and for an export both of them matter:
 * the FILENAME so the saved file is `buyers-2026-09-04.csv` rather than the
 * route it came from, and the ROW COUNT so the screen can say how many rows
 * went into the file it just handed to the browser without opening it again.
 */
export async function requestFile(config) {
  const response = await api({ ...config, responseType: 'blob' });
  const rowCount = Number(response.headers['x-row-count']);
  return {
    blob: response.data,
    fileName: fileNameFromDisposition(response.headers['content-disposition']),
    rowCount: Number.isFinite(rowCount) ? rowCount : null,
  };
}

/**
 * Hands a blob to the browser as a download.
 *
 * NOT a plain `<a href>` to the API. Every route below /api needs the bearer
 * token in a header, and a browser navigating to a URL sends no such header -
 * the link would answer 401. So the bytes are fetched with the token and given
 * to the browser as an object URL it already holds.
 */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick rather than immediately: Safari reads the object
  // URL asynchronously and a synchronous revoke races the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Unwraps a list response, keeping the pagination meta alongside. */
export async function requestList(config) {
  const { data } = await api(config);
  return { rows: data.data, meta: data.meta };
}

export default api;

/**
 * The API base, for the few places that need a URL rather than a request —
 * a CSV download the browser performs itself, for instance.
 */
export function apiBaseUrl() {
  return api.defaults.baseURL;
}
