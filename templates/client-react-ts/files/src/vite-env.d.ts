/**
 * Ambient declarations for the things the bundler provides rather than a package.
 *
 * Written out rather than pulled in with `/// <reference types="vite/client" />` so that the type
 * of every environment variable this application reads is stated here, in one list, and adding one
 * without declaring it is a compile error rather than a silent `any` at the call site.
 */

interface ImportMetaEnv {
  /**
   * Absolute base URL of the API, including the `/api` prefix. Unset in development, where the
   * client calls the relative `/api` path and the Vite dev proxy forwards it.
   */
  readonly VITE_API_URL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Stylesheets are imported for their side effect; they export nothing. */
declare module '*.css';
