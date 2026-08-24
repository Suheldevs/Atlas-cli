import { describe, expect, it } from 'vitest';

import { planDependencies } from '../../src/engine/deps/dependency-planner.js';
import { splitByKind, toSpecifiers } from '../../src/engine/deps/dependency-resolver.js';
import type { DependencyRequest } from '../../src/types/generation-plan.js';
import type { PackageManifest } from '../../src/types/project-context.js';
import {
  compareVersions,
  extractMinimumVersion,
  isWorkspaceOrLocalRange,
  parseVersion,
  rangeSatisfiedBy,
} from '../../src/utils/semver.js';

interface ManifestOverrides {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function manifestWith(overrides: ManifestOverrides = {}): PackageManifest {
  return {
    path: '/project/package.json',
    name: 'demo',
    version: '1.0.0',
    type: 'module',
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    scripts: {},
    raw: {},
    ...overrides,
  };
}

function prod(name: string, range: string): DependencyRequest {
  return { name, range, dev: false };
}

function dev(name: string, range: string): DependencyRequest {
  return { name, range, dev: true };
}

const names = (requests: readonly { readonly name: string }[]): readonly string[] =>
  requests.map((request) => request.name);

describe('planDependencies with no manifest', () => {
  it('installs everything, because nothing is known to be present', () => {
    const plan = planDependencies([prod('zod', '^3.0.0'), dev('vitest', '^4.0.0')], undefined);

    expect(names(plan.toInstall)).toEqual(['vitest', 'zod']);
    expect(plan.alreadySatisfied).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('produces an empty plan for no requests', () => {
    const plan = planDependencies([], undefined);

    expect(plan.toInstall).toEqual([]);
    expect(plan.alreadySatisfied).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('planDependencies against installed packages', () => {
  it('leaves a satisfying dependency alone rather than reinstalling it', () => {
    const plan = planDependencies(
      [prod('express', '^5.0.0')],
      manifestWith({ dependencies: { express: '^5.2.1' } }),
    );

    expect(plan.toInstall).toEqual([]);
    expect(plan.alreadySatisfied).toEqual([prod('express', '^5.0.0')]);
    expect(plan.conflicts).toEqual([]);
  });

  it('treats an exactly equal minimum as satisfied', () => {
    const plan = planDependencies(
      [prod('express', '^5.0.0')],
      manifestWith({ dependencies: { express: '^5.0.0' } }),
    );

    expect(names(plan.alreadySatisfied)).toEqual(['express']);
  });

  it('reports a lower installed range as a conflict instead of upgrading it', () => {
    const plan = planDependencies(
      [prod('express', '^5.0.0')],
      manifestWith({ dependencies: { express: '^4.18.2' } }),
    );

    expect(plan.toInstall).toEqual([]);
    expect(plan.alreadySatisfied).toEqual([]);
    expect(plan.conflicts).toEqual([
      { name: 'express', installedRange: '^4.18.2', requiredRange: '^5.0.0', dev: false },
    ]);
  });

  it('carries the dev flag of the request into the conflict report', () => {
    const plan = planDependencies(
      [dev('typescript', '^6.0.0')],
      manifestWith({ devDependencies: { typescript: '^5.4.0' } }),
    );

    expect(plan.conflicts).toEqual([
      { name: 'typescript', installedRange: '^5.4.0', requiredRange: '^6.0.0', dev: true },
    ]);
  });

  it('installs a package the manifest does not mention at all', () => {
    const plan = planDependencies(
      [prod('zod', '^3.0.0')],
      manifestWith({ dependencies: { express: '^5.0.0' } }),
    );

    expect(names(plan.toInstall)).toEqual(['zod']);
  });

  it('ignores peerDependencies, which say nothing about what is installed', () => {
    const plan = planDependencies(
      [prod('react', '^19.0.0')],
      manifestWith({ peerDependencies: { react: '^19.0.0' } }),
    );

    expect(names(plan.toInstall)).toEqual(['react']);
  });
});

describe('planDependencies across dependency kinds', () => {
  it('accepts a production dependency as satisfying a dev request', () => {
    const plan = planDependencies(
      [dev('typescript', '^6.0.0')],
      manifestWith({ dependencies: { typescript: '^6.0.3' } }),
    );

    expect(plan.toInstall).toEqual([]);
    expect(names(plan.alreadySatisfied)).toEqual(['typescript']);
  });

  it('does not accept a dev-only dependency as satisfying a production request', () => {
    const plan = planDependencies(
      [prod('zod', '^3.0.0')],
      manifestWith({ devDependencies: { zod: '^3.22.0' } }),
    );

    expect(names(plan.toInstall)).toEqual(['zod']);
    expect(plan.conflicts).toEqual([]);
  });

  it('does not report a conflict for a dev-only package a production request outgrew', () => {
    // The dev entry is not consulted for a production request, so there is nothing to conflict
    // with — the package is simply installed into `dependencies`.
    const plan = planDependencies(
      [prod('zod', '^4.0.0')],
      manifestWith({ devDependencies: { zod: '^3.0.0' } }),
    );

    expect(names(plan.toInstall)).toEqual(['zod']);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('planDependencies with local and workspace ranges', () => {
  const localRanges = ['workspace:*', 'workspace:^1.2.3', 'file:../shared', 'link:../shared'];

  for (const installedRange of localRanges) {
    it(`treats ${installedRange} as satisfied and never as a conflict`, () => {
      const plan = planDependencies(
        [prod('@acme/shared', '^9.9.9')],
        manifestWith({ dependencies: { '@acme/shared': installedRange } }),
      );

      expect(names(plan.alreadySatisfied)).toEqual(['@acme/shared']);
      expect(plan.toInstall).toEqual([]);
      expect(plan.conflicts).toEqual([]);
    });
  }

  it('treats a catalog reference as satisfied', () => {
    const plan = planDependencies(
      [dev('eslint', '^10.0.0')],
      manifestWith({ devDependencies: { eslint: 'catalog:' } }),
    );

    expect(names(plan.alreadySatisfied)).toEqual(['eslint']);
  });
});

describe('planDependencies deduplication', () => {
  it('keeps the higher minimum when two templates want the same package', () => {
    const plan = planDependencies([prod('zod', '^3.20.0'), prod('zod', '^3.24.1')], undefined);

    expect(plan.toInstall).toEqual([prod('zod', '^3.24.1')]);
  });

  it('keeps the higher minimum regardless of request order', () => {
    const plan = planDependencies([prod('zod', '^3.24.1'), prod('zod', '^3.20.0')], undefined);

    expect(plan.toInstall).toEqual([prod('zod', '^3.24.1')]);
  });

  it('promotes a package to production when any requester needs it there', () => {
    const plan = planDependencies([dev('zod', '^3.0.0'), prod('zod', '^3.0.0')], undefined);

    expect(plan.toInstall).toEqual([prod('zod', '^3.0.0')]);
  });

  it('keeps a package dev-only when every requester asked for dev', () => {
    const plan = planDependencies([dev('vitest', '^4.0.0'), dev('vitest', '^4.1.0')], undefined);

    expect(plan.toInstall).toEqual([dev('vitest', '^4.1.0')]);
  });

  it('compares the merged range against the manifest, not the individual requests', () => {
    // The lower request would have been satisfied on its own; the merged one is not.
    const plan = planDependencies(
      [prod('zod', '^3.0.0'), prod('zod', '^4.0.0')],
      manifestWith({ dependencies: { zod: '^3.22.0' } }),
    );

    expect(plan.conflicts).toEqual([
      { name: 'zod', installedRange: '^3.22.0', requiredRange: '^4.0.0', dev: false },
    ]);
  });

  it('keeps the first range when a duplicate cannot be compared', () => {
    const plan = planDependencies(
      [prod('shared', 'github:acme/shared#v2'), prod('shared', '^1.0.0')],
      undefined,
    );

    expect(plan.toInstall).toEqual([prod('shared', 'github:acme/shared#v2')]);
  });
});

describe('planDependencies output ordering', () => {
  it('sorts every bucket by name, independently of request order', () => {
    const plan = planDependencies(
      [
        prod('zod', '^3.0.0'),
        prod('express', '^5.0.0'),
        dev('vitest', '^4.0.0'),
        prod('bcryptjs', '^3.0.0'),
        prod('jsonwebtoken', '^9.0.0'),
      ],
      manifestWith({
        dependencies: { express: '^5.1.0', jsonwebtoken: '^8.5.1' },
        devDependencies: { vitest: '^4.1.0' },
      }),
    );

    expect(names(plan.toInstall)).toEqual(['bcryptjs', 'zod']);
    expect(names(plan.alreadySatisfied)).toEqual(['express', 'vitest']);
    expect(names(plan.conflicts)).toEqual(['jsonwebtoken']);
  });

  it('is deterministic across shuffled input', () => {
    const requests = [prod('c', '^1.0.0'), prod('a', '^1.0.0'), prod('b', '^1.0.0')];

    const first = planDependencies(requests, undefined);
    const second = planDependencies([...requests].reverse(), undefined);

    expect(names(first.toInstall)).toEqual(names(second.toInstall));
    expect(names(first.toInstall)).toEqual(['a', 'b', 'c']);
  });
});

describe('toSpecifiers', () => {
  it('joins name and range with @', () => {
    expect(toSpecifiers([prod('zod', '^3.0.0'), dev('vitest', '4.1.10')])).toEqual([
      'zod@^3.0.0',
      'vitest@4.1.10',
    ]);
  });

  it('keeps scoped names intact', () => {
    expect(toSpecifiers([prod('@types/node', '^26.0.0')])).toEqual(['@types/node@^26.0.0']);
  });

  it('emits a bare name for an empty range, since `pkg@` is not a specifier', () => {
    expect(toSpecifiers([prod('zod', '  ')])).toEqual(['zod']);
  });
});

describe('splitByKind', () => {
  it('separates production from development requests, preserving order', () => {
    const split = splitByKind([
      prod('express', '^5.0.0'),
      dev('vitest', '^4.0.0'),
      prod('zod', '^3.0.0'),
    ]);

    expect(names(split.prod)).toEqual(['express', 'zod']);
    expect(names(split.dev)).toEqual(['vitest']);
  });

  it('returns empty sides for empty input', () => {
    expect(splitByKind([])).toEqual({ prod: [], dev: [] });
  });
});

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('tolerates a leading v', () => {
    expect(parseVersion('v10.0.1')).toEqual({ major: 10, minor: 0, patch: 1 });
  });

  it('defaults absent segments to zero', () => {
    expect(parseVersion('7')).toEqual({ major: 7, minor: 0, patch: 0 });
    expect(parseVersion('7.2')).toEqual({ major: 7, minor: 2, patch: 0 });
  });

  it('ignores prerelease and build suffixes', () => {
    expect(parseVersion('2.0.0-rc.1')).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion('2.0.0+build.5')).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('returns undefined for things that are not versions', () => {
    expect(parseVersion('latest')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
    expect(parseVersion('^1.2.3')).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
  });

  it('reports equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', 'v1.2.3')).toBe(0);
  });

  it('does not order prereleases below their release', () => {
    // A documented limit of this hand-rolled implementation, asserted so it stays deliberate.
    expect(compareVersions('2.0.0-rc.1', '2.0.0')).toBe(0);
  });

  it('stays a total ordering when a value cannot be parsed', () => {
    expect(compareVersions('nonsense', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', 'nonsense')).toBeGreaterThan(0);
    expect(compareVersions('nonsense', 'rubbish')).toBe(0);
  });
});

describe('extractMinimumVersion', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['1.2.3', '1.2.3'],
    ['=1.2.3', '1.2.3'],
    ['v1.2.3', '1.2.3'],
    ['^1.2.3', '1.2.3'],
    ['~1.2.3', '1.2.3'],
    ['~>1.2.3', '1.2.3'],
    ['>=1.2.3', '1.2.3'],
    ['>= 1.2.3', '1.2.3'],
    ['>1.2.3', '1.2.3'],
    ['1.2.x', '1.2.0'],
    ['1.x', '1.0.0'],
    ['1', '1.0.0'],
    ['1.2', '1.2.0'],
    ['*', '0.0.0'],
    ['x', '0.0.0'],
    ['', '0.0.0'],
    ['^2.0.0-rc.1', '2.0.0'],
    ['>=1.2.3 <2.0.0', '1.2.3'],
    ['<2.0.0', '0.0.0'],
    ['^1.0.0 || ^2.0.0', '1.0.0'],
    ['^2.0.0 || ^1.0.0', '1.0.0'],
    ['4.17.21 || >=5.0.0', '4.17.21'],
  ];

  for (const [range, expected] of cases) {
    it(`reads ${range === '' ? '(empty)' : range} as ${expected}`, () => {
      expect(extractMinimumVersion(range)).toBe(expected);
    });
  }

  it('takes the greatest lower bound of an ANDed comparator set', () => {
    expect(extractMinimumVersion('>=1.0.0 >=1.5.0')).toBe('1.5.0');
  });

  const unreadable = [
    'latest',
    'next',
    'workspace:*',
    'file:../shared',
    'link:../shared',
    'catalog:default',
    'github:acme/shared#v2',
    'https://example.test/pkg.tgz',
    '1.2.3 - 2.0.0',
  ];

  for (const range of unreadable) {
    it(`refuses to guess at ${range}`, () => {
      expect(extractMinimumVersion(range)).toBeUndefined();
    });
  }

  it('refuses a union whose other branch is unreadable', () => {
    expect(extractMinimumVersion('^1.0.0 || next')).toBeUndefined();
  });
});

describe('rangeSatisfiedBy', () => {
  it('accepts an installed minimum at or above the required one', () => {
    expect(rangeSatisfiedBy('^5.2.0', '^5.0.0')).toBe(true);
    expect(rangeSatisfiedBy('^5.0.0', '^5.0.0')).toBe(true);
    expect(rangeSatisfiedBy('6.0.0', '^5.0.0')).toBe(true);
  });

  it('rejects an installed minimum below the required one', () => {
    expect(rangeSatisfiedBy('^4.18.2', '^5.0.0')).toBe(false);
    expect(rangeSatisfiedBy('^5.0.0', '^5.1.0')).toBe(false);
    expect(rangeSatisfiedBy('*', '^1.0.0')).toBe(false);
  });

  it('is directional', () => {
    expect(rangeSatisfiedBy('^2.0.0', '^1.0.0')).toBe(true);
    expect(rangeSatisfiedBy('^1.0.0', '^2.0.0')).toBe(false);
  });

  it('errs toward leaving the project alone when either range is unreadable', () => {
    expect(rangeSatisfiedBy('github:acme/express', '^5.0.0')).toBe(true);
    expect(rangeSatisfiedBy('^1.0.0', 'next')).toBe(true);
  });

  it('accepts anything against a wildcard requirement', () => {
    expect(rangeSatisfiedBy('^1.0.0', '*')).toBe(true);
  });
});

describe('isWorkspaceOrLocalRange', () => {
  it('recognises every protocol that resolves outside the registry', () => {
    for (const range of [
      'workspace:*',
      'workspace:^1.0.0',
      'file:../shared',
      'link:../shared',
      'catalog:',
      'catalog:default',
      'portal:../shared',
    ]) {
      expect(isWorkspaceOrLocalRange(range)).toBe(true);
    }
  });

  it('does not claim ordinary ranges', () => {
    for (const range of ['^1.0.0', '1.2.3', '*', 'latest', 'github:acme/shared']) {
      expect(isWorkspaceOrLocalRange(range)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace and casing', () => {
    expect(isWorkspaceOrLocalRange('  Workspace:*  ')).toBe(true);
  });
});
