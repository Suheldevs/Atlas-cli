#!/usr/bin/env node

/**
 * Atlas launcher.
 *
 * Plain JavaScript with no static imports, on purpose. Static `import` declarations are
 * hoisted and evaluated before this file's body runs, so an unsupported Node.js version
 * would report a syntax error from deep inside `dist/` instead of the message below. The
 * dynamic import at the end keeps the version guard genuinely first.
 *
 * The minimum version is duplicated from `src/constants/branding.ts` because this file
 * cannot import from the bundle it is guarding. Change both together.
 */

const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 13;

const [major, minor] = process.versions.node.split('.').map(Number);

if (major < MINIMUM_NODE_MAJOR || (major === MINIMUM_NODE_MAJOR && minor < MINIMUM_NODE_MINOR)) {
  process.stderr.write(
    `atlas requires Node.js ${MINIMUM_NODE_MAJOR}.${MINIMUM_NODE_MINOR} or newer, ` +
      `but this is ${process.versions.node}.\n` +
      'Upgrade Node.js, or use a version manager such as nvm, fnm, or volta.\n',
  );
  process.exit(1);
}

const { main } = await import('../dist/cli.js');

await main(process.argv);
