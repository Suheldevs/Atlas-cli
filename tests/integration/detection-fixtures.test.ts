import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProjectScanner } from '../../src/detection/index.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { NodeFileSystemService } from '../../src/services/filesystem.service.js';
import type { ProjectContext } from '../../src/types/project-context.js';

/**
 * Detection against the real filesystem.
 *
 * The unit tests cover the detectors exhaustively through an in-memory double; these exist to
 * catch the class of bug a double cannot — a path joined wrongly, a file read that works only
 * on POSIX, an upward walk that stops one directory too early.
 */

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function scanner(): ProjectScanner {
  return new ProjectScanner({ fs: new NodeFileSystemService() });
}

function scan(fixture: string): Promise<ProjectContext> {
  return scanner().scan(join(FIXTURES, fixture));
}

describe('express-esm fixture', () => {
  it('detects an ESM TypeScript Express project', async () => {
    const project = await scan('express-esm');

    expect(project.framework).toBe('express');
    expect(project.language).toBe('typescript');
    expect(project.moduleSystem).toBe('esm');
    expect(project.typescript.strict).toBe(true);
  });

  it('requires generated relative imports to carry .js', async () => {
    expect((await scan('express-esm')).importSuffix).toBe('.js');
  });

  it('reads the package manager from the packageManager field', async () => {
    expect((await scan('express-esm')).packageManager).toBe('pnpm');
  });

  it('detects mongoose', async () => {
    expect((await scan('express-esm')).database).toBe('mongoose');
  });

  it('finds the src directory', async () => {
    const project = await scan('express-esm');

    expect(project.layout.sourceDir).toBe('src');
    expect(project.layout.flat).toBe(false);
  });

  it('parses a tsconfig containing comments', async () => {
    // The fixture's tsconfig has a `//` comment, which JSON.parse rejects outright.
    expect((await scan('express-esm')).typescript.configPath).toBeDefined();
    expect((await scan('express-esm')).typescript.strict).toBe(true);
  });
});

describe('express-cjs fixture', () => {
  it('detects CommonJS from tsconfig when package.json has no type field', async () => {
    expect((await scan('express-cjs')).moduleSystem).toBe('cjs');
  });

  it('leaves relative imports without a suffix', async () => {
    expect((await scan('express-cjs')).importSuffix).toBe('');
  });

  it('reports non-strict TypeScript honestly', async () => {
    const project = await scan('express-cjs');

    expect(project.language).toBe('typescript');
    expect(project.typescript.strict).toBe(false);
  });

  it('detects prisma', async () => {
    expect((await scan('express-cjs')).database).toBe('prisma');
  });
});

describe('js-only fixture', () => {
  it('detects JavaScript with no TypeScript present', async () => {
    const project = await scan('js-only');

    expect(project.language).toBe('javascript');
    expect(project.typescript.present).toBe(false);
  });

  it('reports a flat layout when there is no src directory', async () => {
    expect((await scan('js-only')).layout.flat).toBe(true);
  });

  it('detects no database layer', async () => {
    expect((await scan('js-only')).database).toBe('none');
  });
});

describe('monorepo fixture', () => {
  const packageRoot = join('monorepo', 'packages', 'api');

  it('recognises a package inside a workspace', async () => {
    expect((await scan(packageRoot)).workspace.isMonorepo).toBe(true);
  });

  it('points the install root at the workspace root, not the package', async () => {
    const project = await scan(packageRoot);

    // Installing inside the package would create a nested node_modules that pnpm's
    // resolution ignores — this is the assertion that guards against that.
    expect(project.workspace.installRoot).toBe(join(FIXTURES, 'monorepo'));
    expect(project.workspace.installRoot).not.toBe(project.root);
  });

  it('finds the workspace lockfile by walking upward', async () => {
    expect((await scan(packageRoot)).packageManager).toBe('pnpm');
  });

  it('prefers Nest over the Express it ships on top of', async () => {
    expect((await scan(packageRoot)).framework).toBe('nest');
  });

  it('detects drizzle', async () => {
    expect((await scan(packageRoot)).database).toBe('drizzle');
  });
});

describe('a directory that is not a project', () => {
  it('scans without throwing, so `atlas info` can still describe it', async () => {
    const project = await scanner().scan(FIXTURES);

    expect(project.manifest).toBeUndefined();
    expect(project.framework).toBe('unknown');
  });

  it('is rejected by requireProject', async () => {
    try {
      await scanner().requireProject(FIXTURES);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.NotAProject);
    }
  });
});

describe('caching', () => {
  it('serves a repeated scan of the same root from cache', async () => {
    const subject = scanner();
    const root = join(FIXTURES, 'express-esm');

    expect(await subject.scan(root)).toBe(await subject.scan(root));
  });
});
