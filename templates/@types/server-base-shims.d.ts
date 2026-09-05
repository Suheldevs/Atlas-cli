/**
 * Ambient declaration for `dotenv`, which `templates/server-base-js` and
 * `templates/server-base-ts` declare but this repository does not install.
 *
 * The same rule as `auth-shims.d.ts` applies: model only the surface the templates actually call,
 * at the real types. Widening anything here to `any` removes the only thing the file is for; a
 * declaration that is deliberately narrower than reality is fine, because narrower can only cause
 * a false failure, never a false pass.
 *
 * Everything else the server-base templates import — express, cors, cookie-parser — is a real
 * devDependency of this repository (directly or through socket.io) and resolves to its published
 * types. `mongoose` is declared in `auth-shims.d.ts`.
 */

declare module 'dotenv' {
  export interface DotenvConfigOptions {
    /** Path to the file to read. Defaults to `.env` beside the working directory. */
    readonly path?: string;
    readonly encoding?: string;
    /** Whether a value in the file replaces one already present in `process.env`. */
    readonly override?: boolean;
    /** Silences the banner dotenv v17 prints on every load unless told not to. */
    readonly quiet?: boolean;
  }

  export interface DotenvConfigOutput {
    readonly error?: Error;
    readonly parsed?: Record<string, string>;
  }

  export function config(options?: DotenvConfigOptions): DotenvConfigOutput;
}
