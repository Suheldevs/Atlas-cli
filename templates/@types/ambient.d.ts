/**
 * Ambient declarations that exist only so templates can be typechecked in CI.
 *
 * `scripts/check-generated-output.ts` renders every template as a user would receive it and
 * compiles the result. Most packages resolve for real from this repository's `node_modules` —
 * jose, zod, express, cookie-parser are devDependencies precisely so their real types are used.
 * The three declared below are the exceptions: argon2 compiles natively and mongoose and Prisma
 * are large, so they are modelled rather than installed.
 *
 * They are never copied into a user's project and never published. Once generated code lands
 * somewhere real it resolves the real packages and every declaration here is discarded.
 *
 * Keep them honest. Each models the slice of real API a template actually uses, at the real types,
 * and is deliberately no wider. Widening one to `any` to make an error go away removes the only
 * thing this file is for: a gate that typed `winston.format` as `any` would have passed every
 * version of `redact.ts` ever written, including the ones that leaked a password. If a template
 * needs more surface, model the surface.
 *
 * There is a second rule, learned the hard way. An earlier revision declared `express` here, and
 * `templates/logger` then typechecked in CI while importing Express types its `template.json`
 * never declared — so the generated code could not compile in a project without Express, and the
 * gate reported PASS. A shim must only ever cover a package the template genuinely declares.
 */

/*
 * ---------------------------------------------------------------------------------------------
 * winston
 * ---------------------------------------------------------------------------------------------
 */

declare module 'winston' {
  /**
   * A log record as it travels through the format pipeline.
   *
   * `message` is `unknown` where logform types it `any`. Stricter on purpose: template code has
   * to prove it handled a non-string message, and code that compiles against `unknown` also
   * compiles against `any`.
   */
  export interface TransformableInfo {
    level: string;
    message: unknown;
    [key: string]: unknown;
  }

  export interface Format {
    transform(info: TransformableInfo, options?: unknown): TransformableInfo | boolean;
  }

  export type TransformFunction = (
    info: TransformableInfo,
    options?: unknown,
  ) => TransformableInfo | boolean;

  /** What `format(fn)` returns: a factory that takes the format's own options. */
  export type FormatWrap = (options?: unknown) => Format;

  export interface TimestampOptions {
    /** A fecha pattern, or a function returning the rendered stamp. */
    format?: string | (() => string) | undefined;
    alias?: string | undefined;
  }

  export interface JsonOptions {
    space?: number | undefined;
    deterministic?: boolean | undefined;
    replacer?: ((key: string, value: unknown) => unknown) | undefined;
  }

  /**
   * `winston.format` is callable and also carries the combinators. Only the combinators a
   * template uses are declared; adding one here is the intended way to start using it.
   */
  interface FormatFactory {
    (transform: TransformFunction): FormatWrap;
    combine(...formats: Format[]): Format;
    json(options?: JsonOptions): Format;
    printf(template: (info: TransformableInfo) => string): Format;
    splat(): Format;
    timestamp(options?: TimestampOptions): Format;
  }

  export const format: FormatFactory;

  /** The winston-transport surface a logger option needs. */
  export interface Transport {
    log(info: TransformableInfo, next: () => void): void;
    level?: string | undefined;
    silent?: boolean | undefined;
    format?: Format | undefined;
  }

  export interface ConsoleTransportOptions {
    level?: string | undefined;
    silent?: boolean | undefined;
    format?: Format | undefined;
    /** Levels routed to stderr instead of stdout. Empty by default in winston 3. */
    stderrLevels?: string[] | undefined;
  }

  export namespace transports {
    export class Console implements Transport {
      constructor(options?: ConsoleTransportOptions);
      log(info: TransformableInfo, next: () => void): void;
      level?: string | undefined;
      silent?: boolean | undefined;
      format?: Format | undefined;
    }
  }

  export interface LoggerOptions {
    level?: string | undefined;
    silent?: boolean | undefined;
    format?: Format | undefined;
    defaultMeta?: Record<string, unknown> | undefined;
    exitOnError?: boolean | undefined;
    levels?: Record<string, number> | undefined;
    transports?: Transport | Transport[] | undefined;
  }

  /**
   * The npm levels winston enables by default, plus `log`, `child` and the two mutable fields a
   * caller may reach for. `meta` is `unknown[]` rather than `any[]`, again on the strict side.
   */
  export interface Logger {
    level: string;
    silent: boolean;
    log(level: string, message: string, ...meta: unknown[]): Logger;
    error(message: string, ...meta: unknown[]): Logger;
    warn(message: string, ...meta: unknown[]): Logger;
    info(message: string, ...meta: unknown[]): Logger;
    http(message: string, ...meta: unknown[]): Logger;
    verbose(message: string, ...meta: unknown[]): Logger;
    debug(message: string, ...meta: unknown[]): Logger;
    silly(message: string, ...meta: unknown[]): Logger;
    /** Returns a logger that merges `meta` into every record it writes. */
    child(meta: Record<string, unknown>): Logger;
  }

  export function createLogger(options?: LoggerOptions): Logger;
}

/*
 * ---------------------------------------------------------------------------------------------
 * express — deliberately NOT declared
 * ---------------------------------------------------------------------------------------------
 *
 * There was an `express` shim here, and removing it was a bug fix rather than a simplification.
 *
 * With it present, `templates/logger` compiled in CI while importing `express` types — even
 * though its `template.json` declares only `winston`. The generated code therefore failed to
 * compile in any target project without Express installed, and the gate that exists to catch
 * exactly that reported PASS. A shim that supplies a package the template never declared does
 * not make the check stricter; it makes it lie.
 *
 * A template needing framework types has two honest options: type the boundary structurally, so
 * the framework's own types satisfy it and nothing is imported (see
 * `templates/logger/files/logger/http-logger.ts`), or declare the package in `template.json`
 * — at which point it is a real dependency and belongs in a shim.
 *
 * Note that `declare global { namespace Express { ... } }` inside a template still compiles
 * without anything here: a global namespace augmentation is self-declaring, and merges with
 * `@types/express` when a real project has it.
 */

/*
 * Node built-ins are NOT declared here.
 *
 * The generated-output gate compiles against the real `@types/node`, which is what a target
 * project has. Shimming `process` or `node:crypto` would both duplicate those declarations and
 * risk being narrower than reality in a way that hides a genuine mistake.
 */
