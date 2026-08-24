# Architecture Decision Records

An ADR here records a decision that is expensive to reverse — one where the cost is not the code that
implements it but the code, templates, published packages, or users' files that come to depend on it. Each
record captures the context that forced the decision, the alternatives that were genuinely weighed, and
the consequences accepted in exchange, including the costs. The point is that a reader six months or six
contributors later can reconstruct the reasoning without re-litigating it, and can tell the difference
between a decision that was considered and one that merely happened.

## Naming

`NNNN-kebab-title.md`, where `NNNN` is a zero-padded sequence number assigned in order of acceptance.
Numbers are never reused.

## Append-only

ADRs are append-only. A decision that no longer holds is **not** edited or deleted — its `Status` is
changed to `Superseded by NNNN` and a new record is written. The old reasoning stays readable, because the
value of an ADR is largely historical: knowing why something _was_ right is what makes it clear whether the
conditions that made it right still apply.

## Index

| ADR                                                          | Title                                      | Status   |
| ------------------------------------------------------------ | ------------------------------------------ | -------- |
| [0001](./0001-templates-live-at-the-repository-root.md)      | Templates live at the repository root      | Accepted |
| [0002](./0002-esm-only-on-node-22.md)                        | ESM-only on Node 22.13                     | Accepted |
| [0003](./0003-anchor-comment-injection-over-ast-codemods.md) | Anchor-comment injection over AST codemods | Accepted |
| [0004](./0004-plan-then-apply-generation.md)                 | Plan-then-apply generation                 | Accepted |
