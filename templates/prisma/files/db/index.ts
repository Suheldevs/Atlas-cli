/**
 * Import the client from here rather than from `prisma.ts`, so the singleton stays the only way
 * into the database and there is one place to change if it ever needs wrapping.
 */
export { disconnect, prisma } from './prisma__IMPORT_SUFFIX__';
