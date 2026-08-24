# Detection fixtures

Miniature projects used by `tests/integration/detection-fixtures.test.ts` to exercise the real
`ProjectScanner` against a real filesystem, rather than the in-memory double the unit tests use.

They are **assets, not source**: excluded from `tsconfig.json`, ESLint and Prettier, for the same
reason `templates/` is. Their manifests deliberately reference packages that are not installed
here, which is harmless because detection only reads `package.json` and `tsconfig.json` — it never
parses project source.

| Fixture | What it pins down |
| --- | --- |
| `express-esm` | `"type": "module"` → ESM, so generated imports carry `.js` |
| `express-cjs` | No `type` field plus `module: commonjs` → CJS, so imports carry no suffix |
| `js-only` | No TypeScript and no `src` directory → JavaScript, flat layout |
| `monorepo` | A package inside a pnpm workspace → dependencies install at the workspace root |
