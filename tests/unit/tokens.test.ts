import { describe, expect, it } from 'vitest';

import { findTokens, findUnknownTokens, KNOWN_TOKENS, TOKENS } from '../../src/constants/tokens.js';
import { replaceTokens, replaceTokensInPath } from '../../src/engine/template/token-replacer.js';
import { assertValidEntityName, buildTokenTable } from '../../src/engine/template/token-table.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import type { PackageManifest, ProjectContext } from '../../src/types/project-context.js';

const ROOT = process.platform === 'win32' ? 'C:\\projects\\atlas-demo' : '/projects/atlas-demo';

function manifest(name: string): PackageManifest {
  return {
    path: `${ROOT}/package.json`,
    name,
    version: '1.0.0',
    type: 'module',
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    scripts: {},
    raw: {},
  };
}

function projectContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: ROOT,
    manifest: undefined,
    framework: 'express',
    language: 'typescript',
    moduleSystem: 'esm',
    packageManager: 'pnpm',
    database: 'mongoose',
    typescript: { present: true, configPath: `${ROOT}/tsconfig.json`, strict: true },
    layout: { sourceDir: 'src', flat: false },
    workspace: { isMonorepo: false, installRoot: ROOT, workspaceRoot: undefined },
    importSuffix: '.js',
    ...overrides,
  };
}

function caught(run: () => unknown): AtlasError {
  try {
    run();
  } catch (error) {
    if (AtlasError.isAtlasError(error)) return error;
    throw error;
  }

  throw new Error('Expected an AtlasError to be thrown.');
}

describe('buildTokenTable', () => {
  it('derives every entity form from the one name the user typed', () => {
    const tokens = buildTokenTable({ project: projectContext(), entity: 'user profile' });

    expect(tokens[TOKENS.entityName]).toBe('UserProfile');
    expect(tokens[TOKENS.entityCamel]).toBe('userProfile');
    expect(tokens[TOKENS.entityKebab]).toBe('user-profile');
    expect(tokens[TOKENS.entitySnake]).toBe('user_profile');
    expect(tokens[TOKENS.entityConstant]).toBe('USER_PROFILE');
    expect(tokens[TOKENS.entityTitle]).toBe('User Profile');
    expect(tokens[TOKENS.entityPlural]).toBe('UserProfiles');
    expect(tokens[TOKENS.entityPluralCamel]).toBe('userProfiles');
    expect(tokens[TOKENS.entityPluralKebab]).toBe('user-profiles');
    expect(tokens[TOKENS.entityPluralConstant]).toBe('USER_PROFILES');
  });

  it('pluralises irregularly where English does', () => {
    const tokens = buildTokenTable({ project: projectContext(), entity: 'category' });

    expect(tokens[TOKENS.entityPlural]).toBe('Categories');
    expect(tokens[TOKENS.entityPluralKebab]).toBe('categories');
  });

  it('accepts an already-cased name unchanged', () => {
    const tokens = buildTokenTable({ project: projectContext(), entity: 'User' });

    expect(tokens[TOKENS.entityName]).toBe('User');
    expect(tokens[TOKENS.entityPlural]).toBe('Users');
  });

  it('omits entity tokens entirely when there is no entity', () => {
    const tokens = buildTokenTable({ project: projectContext() });

    for (const token of [TOKENS.entityName, TOKENS.entityCamel, TOKENS.entityPlural]) {
      expect(Object.hasOwn(tokens, token)).toBe(false);
    }
  });

  it('takes project tokens from the detected context', () => {
    const tokens = buildTokenTable({
      project: projectContext({
        framework: 'fastify',
        database: 'prisma',
        packageManager: 'bun',
        layout: { sourceDir: 'app', flat: false },
      }),
    });

    expect(tokens[TOKENS.sourceDir]).toBe('app');
    expect(tokens[TOKENS.framework]).toBe('fastify');
    expect(tokens[TOKENS.database]).toBe('prisma');
    expect(tokens[TOKENS.packageManager]).toBe('bun');
    expect(tokens[TOKENS.moduleSystem]).toBe('esm');
  });

  it('carries the import suffix through, since generated imports depend on it', () => {
    const esm = buildTokenTable({ project: projectContext() });
    const cjs = buildTokenTable({
      project: projectContext({ moduleSystem: 'cjs', importSuffix: '' }),
    });

    expect(esm[TOKENS.importSuffix]).toBe('.js');
    expect(cjs[TOKENS.importSuffix]).toBe('');
    expect(cjs[TOKENS.moduleSystem]).toBe('cjs');
  });

  it('prefers the manifest name and falls back to the root directory name', () => {
    const named = buildTokenTable({ project: projectContext({ manifest: manifest('@acme/api') }) });
    const unnamed = buildTokenTable({ project: projectContext() });

    expect(named[TOKENS.projectName]).toBe('@acme/api');
    expect(unnamed[TOKENS.projectName]).toBe('atlas-demo');
  });

  it('lets extra values override the derived ones', () => {
    const tokens = buildTokenTable({
      project: projectContext(),
      entity: 'user',
      extra: { [TOKENS.entityKebab]: 'account', __CUSTOM__: 'value' },
    });

    expect(tokens[TOKENS.entityKebab]).toBe('account');
    expect(tokens[TOKENS.entityName]).toBe('User');
    expect(tokens['__CUSTOM__']).toBe('value');
  });

  it('generates an unpredictable JWT secret', () => {
    const first = buildTokenTable({ project: projectContext() })[TOKENS.jwtSecret];
    const second = buildTokenTable({ project: projectContext() })[TOKENS.jwtSecret];

    expect(first).not.toBe(second);
    // 48 random bytes, base64url encoded: no padding, no characters needing escaping in .env.
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('rejects an invalid entity name before deriving anything from it', () => {
    expect(() => buildTokenTable({ project: projectContext(), entity: '123' })).toThrow(AtlasError);
  });
});

describe('assertValidEntityName', () => {
  it('accepts names a generator can build identifiers from', () => {
    for (const name of ['user', 'User', 'user profile', 'user-profile', 'USER_PROFILE', 'oauth2']) {
      expect(() => {
        assertValidEntityName(name);
      }).not.toThrow();
    }
  });

  it('rejects an empty or whitespace-only name', () => {
    for (const name of ['', '   ']) {
      const error = caught(() => {
        assertValidEntityName(name);
      });
      expect(error.code).toBe(ErrorCode.InvalidUsage);
      expect(error.hint).toBeDefined();
    }
  });

  it('rejects a name that would start with a digit', () => {
    const error = caught(() => {
      assertValidEntityName('2fa');
    });

    expect(error.code).toBe(ErrorCode.InvalidUsage);
  });

  it('rejects a name that survives no casing conversion', () => {
    for (const name of ['---', '...', '__']) {
      expect(() => {
        assertValidEntityName(name);
      }).toThrow(AtlasError);
    }
  });

  it('rejects reserved words, however they are spelled', () => {
    for (const name of ['class', 'Class', 'CLASS', 'interface', 'enum', 'string', 'new']) {
      const error = caught(() => {
        assertValidEntityName(name);
      });
      expect(error.code).toBe(ErrorCode.InvalidUsage);
      expect(error.message).toContain('reserved word');
    }
  });
});

describe('token vocabulary', () => {
  it('exposes every token literal in KNOWN_TOKENS', () => {
    expect(KNOWN_TOKENS).toContain(TOKENS.entityName);
    expect(KNOWN_TOKENS).toContain(TOKENS.jwtSecret);
    expect(KNOWN_TOKENS).toHaveLength(Object.keys(TOKENS).length);
    expect(new Set(KNOWN_TOKENS).size).toBe(KNOWN_TOKENS.length);
  });

  it('finds the distinct tokens in a file, once each', () => {
    const contents = 'class __ENTITY_NAME__Service { path = "__ENTITY_KEBAB__"; }\n__ENTITY_NAME__';

    expect(findTokens(contents)).toEqual([TOKENS.entityName, TOKENS.entityKebab]);
  });

  it('finds nothing in a file with no tokens', () => {
    expect(findTokens('export const a = 1;')).toEqual([]);
  });

  it('spots a misspelled token, which is what keeps it out of generated code', () => {
    const contents = 'const a = "__ENTITY_NAM__"; const b = "__ENTITY_NAME__";';

    expect(findUnknownTokens(contents)).toEqual(['__ENTITY_NAM__']);
  });
});

describe('replaceTokens', () => {
  const tokens = {
    [TOKENS.entityName]: 'User',
    [TOKENS.entityKebab]: 'user',
    [TOKENS.importSuffix]: '.js',
  };

  it('substitutes every occurrence of every token', () => {
    const contents = [
      "import type { __ENTITY_NAME__ } from './__ENTITY_KEBAB__.model__IMPORT_SUFFIX__';",
      'export class __ENTITY_NAME__Service {}',
    ].join('\n');

    expect(replaceTokens(contents, tokens)).toBe(
      ["import type { User } from './user.model.js';", 'export class UserService {}'].join('\n'),
    );
  });

  it('is single pass, so a replacement value is never rescanned', () => {
    const result = replaceTokens('__ENTITY_NAME__', {
      [TOKENS.entityName]: '__ENTITY_KEBAB__',
      [TOKENS.entityKebab]: 'corrupted',
    });

    expect(result).toBe('__ENTITY_KEBAB__');
  });

  it('leaves an unknown token untouched by default', () => {
    expect(replaceTokens('__ENTITY_NAME__ __MYSTERY__', tokens)).toBe('User __MYSTERY__');
  });

  it('returns the input unchanged when there are no tokens to substitute', () => {
    expect(replaceTokens('export const a = 1;', {})).toBe('export const a = 1;');
  });

  it('throws in strict mode, listing what was left unresolved', () => {
    const error = caught(() =>
      replaceTokens('__ENTITY_NAME__ __MYSTERY__ __OTHER__', tokens, {
        strict: true,
      }),
    );

    expect(error.code).toBe(ErrorCode.GenerationFailed);
    expect(error.details).toEqual(['__MYSTERY__', '__OTHER__']);
  });

  it('passes strict mode when every token resolves', () => {
    expect(replaceTokens('__ENTITY_NAME__', tokens, { strict: true })).toBe('User');
  });

  it('does not blame a replacement value that itself looks like a token in strict mode', () => {
    const result = replaceTokens(
      '__ENTITY_NAME__',
      { [TOKENS.entityName]: '__NOT_A_TOKEN__' },
      {
        strict: true,
      },
    );

    expect(result).toBe('__NOT_A_TOKEN__');
  });
});

describe('replaceTokensInPath', () => {
  it('resolves a tokenised destination', () => {
    const tokens = buildTokenTable({ project: projectContext(), entity: 'user profile' });

    expect(replaceTokensInPath('__SOURCE_DIR__/services/__ENTITY_KEBAB__.service.ts', tokens)).toBe(
      'src/services/user-profile.service.ts',
    );
  });

  it('resolves a plural directory name', () => {
    const tokens = buildTokenTable({ project: projectContext(), entity: 'category' });

    expect(replaceTokensInPath('src/__ENTITY_PLURAL_KEBAB__/index.ts', tokens)).toBe(
      'src/categories/index.ts',
    );
  });

  it('leaves a path with no tokens alone', () => {
    expect(replaceTokensInPath('src/index.ts', {})).toBe('src/index.ts');
  });
});
