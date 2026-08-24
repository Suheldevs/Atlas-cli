import { describe, expect, it } from 'vitest';

import { hoistGlobalFlags, resolveGlobalOptions } from '../../src/commands/global-options.js';

describe('hoistGlobalFlags', () => {
  it('leaves an already-ordered argument list alone', () => {
    expect(hoistGlobalFlags(['--verbose', 'doctor'])).toEqual(['--verbose', 'doctor']);
  });

  it('moves a global flag that trails the command name', () => {
    expect(hoistGlobalFlags(['doctor', '--verbose'])).toEqual(['--verbose', 'doctor']);
  });

  it('keeps a value flag together with its value', () => {
    expect(hoistGlobalFlags(['doctor', '--cwd', '/tmp/project'])).toEqual([
      '--cwd',
      '/tmp/project',
      'doctor',
    ]);
  });

  it('handles the inline form of a value flag', () => {
    expect(hoistGlobalFlags(['doctor', '--cwd=/tmp/project'])).toEqual([
      '--cwd=/tmp/project',
      'doctor',
    ]);
  });

  it('preserves the relative order of everything it does not hoist', () => {
    expect(hoistGlobalFlags(['crud', 'User', '--dry-run', '--fields', 'name'])).toEqual([
      '--dry-run',
      'crud',
      'User',
      '--fields',
      'name',
    ]);
  });

  it('never reorders tokens after a bare double dash', () => {
    expect(hoistGlobalFlags(['run', '--', '--verbose', '--cwd', 'x'])).toEqual([
      'run',
      '--',
      '--verbose',
      '--cwd',
      'x',
    ]);
  });

  it('tolerates a value flag with no value', () => {
    expect(hoistGlobalFlags(['doctor', '--cwd'])).toEqual(['--cwd', 'doctor']);
  });
});

describe('resolveGlobalOptions', () => {
  it('defaults every flag to off', () => {
    const options = resolveGlobalOptions({});

    expect(options.yes).toBe(false);
    expect(options.dryRun).toBe(false);
    expect(options.verbose).toBe(false);
    expect(options.cwd).toBe(process.cwd());
  });

  it('resolves a relative cwd to an absolute path', () => {
    expect(resolveGlobalOptions({ cwd: '.' }).cwd).toBe(process.cwd());
  });

  it('treats colour as disabled only when Commander reports false', () => {
    expect(resolveGlobalOptions({ color: false }).color).toBe(false);
  });

  it('ignores values of the wrong type instead of trusting them', () => {
    const options = resolveGlobalOptions({ yes: 'yes', cwd: 42, verbose: 1 });

    expect(options.yes).toBe(false);
    expect(options.verbose).toBe(false);
    expect(options.cwd).toBe(process.cwd());
  });
});
