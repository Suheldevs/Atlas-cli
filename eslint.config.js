// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'templates/**',
      // Miniature projects used as detection input. Assets, not source.
      'tests/fixtures/**',
      // Scratch space: rendered template output and temporary projects written by the gates.
      'tests/.tmp/**',
      'node_modules/**',
      '*.tgz',
    ],
  },

  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // Off deliberately. Atlas defines its seams as Promise-returning interfaces
      // (FileSystemService, PromptRunner, PackageManagerService) and several correct
      // implementations are synchronous — the in-memory test doubles above all, plus the
      // scripted prompt runner. Satisfying the rule would mean dropping `async` and hand-
      // wrapping every return in `Promise.resolve`, which is noise, not safety. The rules
      // that catch genuine async mistakes — no-floating-promises and await-thenable — stay on.
      '@typescript-eslint/require-await': 'off',
      // The `Reporter` service is the only permitted writer to stdout/stderr. Everything else
      // routes through it so output can be silenced, redirected, or stripped of colour.
      'no-console': 'error',
      eqeqeq: ['error', 'smart'],
      curly: ['error', 'multi-line'],
    },
  },

  // `bin/atlas.js` is deliberately plain JavaScript kept outside the TypeScript project, and
  // this config file is never compiled either. Type-aware rules need a program, so they are
  // switched off for JS rather than dragging these files into `tsconfig.json`.
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    files: ['*.config.ts', 'eslint.config.js', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
