# What this changes

<!-- One or two sentences. Link the issue it closes. -->

Closes #

## Why

<!-- What was wrong, or what was missing. Skip this only if the title already says it. -->

## Checklist

- [ ] `npm run verify` passes locally — typecheck, lint, format check, tests, build
- [ ] Tests added or updated, and they fail without this change
- [ ] A changeset is added (`npx changeset`) if this is user-facing — anything that changes a
      command, a flag, generated output, or an error message
- [ ] An ADR is added under [docs/adr/](../docs/adr/) for any architectural change: a new module
      boundary, a change to the generator or plugin contract, a new dependency, or a decision that
      would be expensive to reverse. If the reasoning is worth explaining in a review comment, it
      is worth recording where the next contributor will find it
- [ ] Generated-code changes come with an updated snapshot, reviewed as part of this diff — a
      template edit that changes nine other generated files is only visible that way
- [ ] Docs updated if behaviour changed: [README.md](../README.md),
      [docs/troubleshooting.md](../docs/troubleshooting.md) for a new error code, and the relevant
      page under [docs/](../docs/)

## Templates and generated output

<!--
Delete this section if the change touches neither.

Templates are excluded from `tsconfig.json` and from ESLint on purpose, so `npm run verify` does
not cover them. Run their own gate:

    npx tsx scripts/check-generated-output.ts
    npx tsx scripts/validate-templates.ts

Then generate into a fixture and confirm the output compiles. CI runs `tsc` and ESLint over
generated results, which is the only honest check that generated code is production-quality.
-->

- [ ] Generated output compiles ([scripts/check-generated-output.ts](../scripts/check-generated-output.ts))
- [ ] Generated output compiles and lints in a real project
- [ ] No `__TOKEN__` left unsubstituted, and no new token added without registering it in
      `src/constants/tokens.ts`
- [ ] Nothing generated imports Atlas

## Notes for the reviewer

<!-- Anything non-obvious: a trade-off you made, a case you deliberately did not handle. -->
