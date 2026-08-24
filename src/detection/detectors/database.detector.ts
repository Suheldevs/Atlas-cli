import type { DatabaseLayer, PackageManifest } from '../../types/project-context.js';
import { hasDependency } from '../manifest-reader.js';

interface DatabaseSignature {
  readonly layer: DatabaseLayer;
  /** Any one of these in the manifest identifies the layer. */
  readonly packages: readonly string[];
}

/**
 * First match wins. Prisma leads because a project migrating onto it keeps the outgoing
 * client installed until the last model is ported, and the destination is the useful answer.
 */
const DATABASE_SIGNATURES: readonly DatabaseSignature[] = [
  { layer: 'prisma', packages: ['prisma', '@prisma/client'] },
  { layer: 'mongoose', packages: ['mongoose'] },
  { layer: 'typeorm', packages: ['typeorm'] },
  { layer: 'drizzle', packages: ['drizzle-orm'] },
];

export function detectDatabase(manifest: PackageManifest | undefined): DatabaseLayer {
  const match = DATABASE_SIGNATURES.find((signature) =>
    signature.packages.some((name) => hasDependency(manifest, name)),
  );

  return match?.layer ?? 'none';
}
