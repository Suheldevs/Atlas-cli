import type { Framework, PackageManifest } from '../../types/project-context.js';
import { hasDependency } from '../manifest-reader.js';

interface FrameworkSignature {
  readonly framework: Framework;
  /** Any one of these in the manifest identifies the framework. */
  readonly packages: readonly string[];
}

/**
 * Ordering is the entire point of this file.
 *
 * Frameworks are layered in practice, so the first match has to be the outermost one:
 *
 * - Next ships React, so every Next app also looks exactly like a React app.
 * - Nest runs on Express by default, so `@nestjs/core` must be seen before `express`.
 * - Fastify comes before Express because `@fastify/express` pulls Express in for
 *   middleware compatibility, and the project is still a Fastify project.
 * - React comes last: a React SPA with an Express dev server is best served by the
 *   Express generators, whereas Express code in a Next app would be dead weight.
 *
 * Reordering any of these does not fail loudly — it silently generates for the wrong
 * framework, which is the most expensive kind of bug this subsystem can have.
 */
const FRAMEWORK_SIGNATURES: readonly FrameworkSignature[] = [
  { framework: 'next', packages: ['next'] },
  { framework: 'nest', packages: ['@nestjs/core'] },
  { framework: 'fastify', packages: ['fastify'] },
  { framework: 'express', packages: ['express'] },
  { framework: 'react', packages: ['react'] },
];

export function detectFramework(manifest: PackageManifest | undefined): Framework {
  const match = FRAMEWORK_SIGNATURES.find((signature) =>
    signature.packages.some((name) => hasDependency(manifest, name)),
  );

  return match?.framework ?? 'unknown';
}
