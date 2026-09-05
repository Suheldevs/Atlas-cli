/**
 * The single HTTP client, and the only place that knows what the API's envelope looks like.
 *
 * Three things are settled here so that no component has to think about them again:
 *
 * 1. **The access token lives in memory.** It is a module variable — not `localStorage`, not a
 *    cookie readable by script. Anything in `localStorage` is readable by every script on the page,
 *    so one reflected XSS or one compromised dependency walks off with a credential that outlives
 *    the tab. A variable dies with the page, which is why a reload restores the session through the
 *    refresh cookie below rather than by reading a token back off disk.
 * 2. **The envelope is unwrapped once.** Every successful response is
 *    `{ statusCode, success, message, data, meta?, timestamp }`, and callers only ever want `data`.
 *    Unwrapping in an interceptor is what keeps `res.data.data` out of every call site.
 * 3. **A 401 is retried exactly once**, after a single refresh, and never for the refresh call
 *    itself. See `isUnretryable` — that guard is the entire reason this cannot loop.
 */
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

/**
 * Two request-scoped flags, declared on axios's own config type.
 *
 * They are the state the retry logic needs and there is nowhere else to put it: a request that is
 * replayed has to carry the fact that it has already been replayed. Augmenting the interface is
 * what keeps that honest instead of casting to `any` at three call sites.
 */
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    /** Set once, on the single replay a request is allowed. */
    retriedAfterRefresh?: boolean;
    /** The token this request went out with, or `null` for none. */
    tokenAtSend?: string | null;
  }
}

/** The shape the API reports a user in. `role` drives whatever authorisation the UI does. */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'admin' | 'user';
}

/** The payload behind a successful signup or login. */
export interface AuthPayload {
  readonly user: User;
  readonly accessToken: string;
}

export interface MePayload {
  readonly user: User;
}

export interface RefreshPayload {
  readonly accessToken: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface SignupInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/** Server-side validation messages, keyed by the form field they belong under. */
export type FieldErrors = Readonly<Record<string, string | undefined>>;

/**
 * The `/api` default is a relative path on purpose: it is same-origin, so the browser attaches the
 * `httpOnly` refresh cookie. `VITE_API_URL` is for the deployment where the API is elsewhere.
 */
const configuredBaseUrl = import.meta.env.VITE_API_URL;
const baseURL = configuredBaseUrl !== undefined && configuredBaseUrl !== '' ? configuredBaseUrl : '/api';

/** Endpoints whose own 401 means "these credentials are wrong", not "this token expired". */
const NO_RETRY_PATHS = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout'];

/**
 * In memory, and deliberately not exported as a mutable binding.
 *
 * Reads and writes go through functions so there is exactly one place a token is set and one place
 * it is cleared, which is what makes "did we forget to clear it on logout?" answerable by reading
 * this file instead of grepping the application.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null | undefined): void {
  accessToken = token ?? null;
  // A new token means a new session, so a future expiry is worth announcing again.
  if (accessToken !== null) sessionEndAnnounced = false;
}

export function clearAccessToken(): void {
  accessToken = null;
}

/**
 * `withCredentials` is load-bearing. Without it axios omits cookies on cross-origin requests, the
 * refresh cookie never reaches `/auth/refresh`, and every session ends the moment the access token
 * expires — with no error that points at the cause.
 */
export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

api.interceptors.request.use((config) => {
  if (accessToken !== null) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }

  // Which token this request went out with — including `null` for none. The 401 handler compares
  // it against the current one to tell "my token expired" apart from "my token was already
  // replaced while I was in flight", and only the first of those is worth a rotation.
  config.tokenAtSend = accessToken;

  return config;
});

export interface ApiErrorOptions {
  readonly status?: number;
  readonly errors?: readonly unknown[];
  readonly fieldErrors?: FieldErrors;
  readonly generalMessages?: readonly string[];
  readonly isNetworkError?: boolean;
}

/**
 * A failure every caller can render without knowing about axios.
 *
 * `fieldErrors` is the reason this class exists: the API reports validation problems per field, and
 * a form that drops them has to fall back to "Request failed with status code 400". Keeping the raw
 * `errors` alongside means nothing is lost for a caller that wants more.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly errors: readonly unknown[];
  readonly fieldErrors: FieldErrors;
  /** Entries from `errors` that named no field, for the parts of a form that has no input. */
  readonly generalMessages: readonly string[];
  readonly isNetworkError: boolean;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.status = options.status ?? 0;
    this.errors = options.errors ?? [];
    this.fieldErrors = options.fieldErrors ?? {};
    this.generalMessages = options.generalMessages ?? [];
    this.isNetworkError = options.isNetworkError ?? false;
  }

  /** True when the API rejected the *content* of the request rather than the caller's identity. */
  get isValidationError(): boolean {
    return this.status === 422 || this.status === 400;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') return value;
  }

  return undefined;
}

const FIELD_KEYS = ['field', 'path', 'param', 'name'];
const MESSAGE_KEYS = ['message', 'msg', 'error'];

/**
 * Field errors, from any of the shapes an `errors` array realistically arrives in.
 *
 * Entries may be `{ field, message }`, `{ path, message }`, `{ param, msg }`, or bare strings.
 * Matching all of them here is cheaper than a form that silently renders nothing because the server
 * spelled the key `path` and the client expected `field`. Only the first message per field is kept:
 * a form shows one line under an input, and the rest stays available on `errors`.
 */
function toFieldErrors(errors: readonly unknown[]): FieldErrors {
  const fields: Record<string, string> = {};

  for (const entry of errors) {
    if (!isRecord(entry)) continue;

    const field = readString(entry, FIELD_KEYS);
    const message = readString(entry, MESSAGE_KEYS);

    if (field === undefined || message === undefined) continue;
    if (fields[field] !== undefined) continue;

    fields[field] = message;
  }

  return fields;
}

/** Messages from entries that named no field, so nothing the server said is dropped. */
function toGeneralMessages(errors: readonly unknown[]): readonly string[] {
  const messages: string[] = [];

  for (const entry of errors) {
    if (typeof entry === 'string' && entry !== '') {
      messages.push(entry);
      continue;
    }

    if (!isRecord(entry)) continue;
    if (readString(entry, FIELD_KEYS) !== undefined) continue;

    const message = readString(entry, MESSAGE_KEYS);
    if (message !== undefined) messages.push(message);
  }

  return messages;
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'That resource could not be found.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The server ran into a problem. Please try again shortly.';
  return 'Something went wrong. Please try again.';
}

/** Normalises anything axios can reject with into one `ApiError`. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const response = axios.isAxiosError(error) ? error.response : undefined;

  if (response === undefined) {
    return new ApiError('Could not reach the server. Check your connection and try again.', {
      isNetworkError: true,
    });
  }

  const body: unknown = response.data;
  const envelope = isRecord(body) ? body : {};
  const errors = Array.isArray(envelope['errors']) ? (envelope['errors'] as readonly unknown[]) : [];
  const general = toGeneralMessages(errors);
  const message = readString(envelope, ['message']) ?? general[0] ?? fallbackMessage(response.status);

  return new ApiError(message, {
    status: response.status,
    errors,
    fieldErrors: toFieldErrors(errors),
    // The headline is already `message`; repeating it in the list below would print it twice.
    generalMessages: general.filter((entry) => entry !== message),
  });
}

/**
 * One refresh at a time.
 *
 * Without this, a page that fires four requests on mount answers four 401s with four rotations —
 * and rotation invalidates the previous refresh token, so three of them fail and the reuse detector
 * on the server sees what looks like a stolen token. Sharing one in-flight promise means the four
 * callers wait on a single rotation.
 */
let refreshInFlight: Promise<string> | null = null;

/** Notified when the session is definitively gone, so `AuthContext` can drop the user. */
let sessionExpiredHandler: (() => void) | null = null;

/**
 * Guards the handler against a burst.
 *
 * Several requests can fail on one dead session — they share the same rejected refresh — and each
 * of them reaches the branch below. Announcing an expiry once per failed request would mean a
 * redirect fired three times for a session that ended once.
 */
let sessionEndAnnounced = false;

/** Registers the handler and returns the function that removes it again. */
export function onSessionExpired(handler: () => void): () => void {
  sessionExpiredHandler = handler;

  return () => {
    if (sessionExpiredHandler === handler) sessionExpiredHandler = null;
  };
}

/** Drops the credential and announces the expiry at most once per session. */
function endSession(): void {
  clearAccessToken();

  if (sessionEndAnnounced) return;

  sessionEndAnnounced = true;
  sessionExpiredHandler?.();
}

function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= api
    .post('/auth/refresh')
    .then((payload: unknown) => {
      const token = isRecord(payload) ? readString(payload, ['accessToken']) : undefined;

      if (token === undefined) throw new ApiError('The server did not return a new access token.');

      setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

function matchesPath(url: string | undefined, path: string): boolean {
  const value = url ?? '';
  return value === path || value.endsWith(path);
}

function isRefreshCall(config: AxiosRequestConfig): boolean {
  return matchesPath(config.url, '/auth/refresh');
}

function isUnretryable(config: AxiosRequestConfig): boolean {
  return NO_RETRY_PATHS.some((path) => matchesPath(config.url, path));
}

api.interceptors.response.use(
  /**
   * Unwraps the success envelope. Callers receive `data` directly, so `login()` reads
   * `const { user, accessToken } = await http.post(...)` rather than reaching through two levels.
   * A 204 and any non-enveloped body pass through as-is instead of becoming `undefined`.
   *
   * The cast is the price of changing what a call resolves to. It is contained here and to the
   * `http` façade at the bottom of the file, which is the surface the application actually uses.
   */
  (response: AxiosResponse): AxiosResponse => {
    const body: unknown = response.data;
    const payload: unknown = isRecord(body) && 'data' in body ? body['data'] : body;

    return payload as AxiosResponse;
  },
  async (error: unknown): Promise<AxiosResponse> => {
    const config = axios.isAxiosError(error) ? error.config : undefined;
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    // Everything that is not a 401 on a request we can replay leaves as a normalised ApiError.
    if (status !== 401 || config === undefined) throw toApiError(error);

    // A 401 from login, signup, refresh or logout *is* the answer — wrong password, dead cookie —
    // rather than a stale access token. Retrying would ask /auth/refresh to refresh itself, which
    // is the loop this guard exists to prevent.
    if (isUnretryable(config)) {
      if (isRefreshCall(config)) endSession();
      throw toApiError(error);
    }

    // One retry per request, ever. A second 401 after a successful refresh is not a token problem.
    if (config.retriedAfterRefresh === true) {
      endSession();
      throw toApiError(error);
    }

    config.retriedAfterRefresh = true;

    // A refresh that finished after this request left has already produced a usable token.
    // Rotating again would invalidate the one every other request is now using, and on a server
    // that detects refresh-token reuse that looks exactly like a stolen token.
    if (accessToken !== null && accessToken !== config.tokenAtSend) {
      return api(config);
    }

    try {
      await refreshAccessToken();
    } catch {
      endSession();
      throw toApiError(error);
    }

    // Re-enters the request interceptor, so the retry carries the token the refresh just produced.
    return api(config);
  },
);

/**
 * The surface the application actually calls.
 *
 * It exists because the response interceptor above changed what a call resolves to: `api.get()` no
 * longer hands back an `AxiosResponse`, it hands back the payload. Routing every call through
 * `http` states that in the name, gives each call site a place to say what it expects
 * (`http.get<MePayload>('/auth/me')`), and keeps the one unavoidable cast next to the interceptor
 * that makes it necessary.
 */
export const http = {
  get: <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    api.get(url, config) as unknown as Promise<T>,
  post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    api.post(url, body, config) as unknown as Promise<T>,
  put: <T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    api.put(url, body, config) as unknown as Promise<T>,
  patch: <T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    api.patch(url, body, config) as unknown as Promise<T>,
  delete: <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    api.delete(url, config) as unknown as Promise<T>,
};
