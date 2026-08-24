import { join } from 'node:path';

import type { FileSystemService } from '../../services/filesystem.service.js';
import type { SourceLayout } from '../../types/project-context.js';

/**
 * Probed in order. `src` is the near-universal convention; `app` covers Next's app router
 * and Rails-shaped layouts, where introducing a sibling `src` would scatter the source.
 */
const CANDIDATE_SOURCE_DIRS = ['src', 'app'] as const;

export async function detectSourceLayout(
  fs: FileSystemService,
  root: string,
): Promise<SourceLayout> {
  for (const candidate of CANDIDATE_SOURCE_DIRS) {
    if (await fs.isDirectory(join(root, candidate))) {
      return { sourceDir: candidate, flat: false };
    }
  }

  // Flat repositories are a real choice, not an oversight — single-file tools and freshly
  // initialised projects both look like this. Creating a `src` Atlas invented would leave
  // the project's source split across two conventions.
  return { sourceDir: '.', flat: true };
}
