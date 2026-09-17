# Exploration — `settings-merge`

The last open criterion in Phase 2. `.claude/settings.json` is named in SPEC
2.4's known-conflicts criterion, sits beside the skills tree, and does not fall
out of a skills diff because it is not a `SKILL.md`.

Everything below was measured on 2026-09-17 against the seven real files.

## Finding 1 — the earlier assessment was pessimism, not measurement

`skills-diff` deferred this with a reason: the override model is a positional
patch anchored to a heading, JSON has no heading anchors, so it would need
key-level merging — "two override engines under one name".

That reasoning was sound in shape and wrong in scale, because nobody had counted:

| | `SKILL.md` | `settings.json` |
| --- | --- | --- |
| Files | 42 | 7 |
| Leaf keys / blocks | 61 sections, 409 patch blocks | **4 leaf keys** |
| Diverging | 70 findings | **1 key** |
| Conflicts | 50 undeclared | **0** |
| Shape of divergence | replace, insert, delete | **additions only** |

A general key-level merge engine is not needed. What is needed is a list union
for one key.

## Finding 2 — the divergence is purely additive

`permissions.allow` is the only key that differs. The other three are identical
across all seven repositories.

- **22 entries common to all seven.**
- Each repo adds between 3 and 6 of its own.
- **No repository removes a common entry.** Each file's total equals 22 plus its
  own additions, checked arithmetically rather than by eye.

The additions are repo-specific by nature, which is why nobody declared them as
overrides — there was nothing to declare against:

| repo | adds |
| --- | --- |
| `wazuh-dashboard` | `yarn typecheck`, `yarn test:jest_integration` |
| `wazuh-dashboard-plugins` | `yarn format`, `yarn knip` |
| `wazuh-security-dashboards-plugin` | `yarn runIdp`, `yarn test:jest_server`, `yarn test:jest_ui` |
| `alerting`, `notifications`, `security-analytics` | `yarn cypress` |
| `reporting` | `yarn test` — bare, where the others use `yarn test:jest` |

The three that are byte-identical to each other — `alerting`, `notifications`,
`security-analytics` — are so because they add the same three entries, not by
coincidence.

## Finding 3 — the conflict mechanism is needed even though the corpus has none

Today there is nothing to block: no removal, no scalar disagreement, no
contradiction. A merge built only for what exists would be a union and nothing
else.

That would be wrong for the same reason the ambiguous-anchor check was worth
building when the corpus produced zero ambiguous anchors. The day a repository
drops a common entry, or a scalar key diverges, that **is** a conflict and must
block distribution exactly as an unmarked skill divergence does. A mechanism
that cannot represent the failure will silently pick a side the first time it
happens.

## Finding 4 — what "conflict" means here differs from the skills case

In `skills-diff` a conflict is *divergence with no marker declaring intent*.
`settings.json` has no marker convention at all, so that definition does not
transfer.

The honest analogue: additions are compatible by construction — two repos adding
different permissions do not contradict each other. What conflicts is a
**contradiction**: the same key with different scalar values, or a common entry
present in some repos and removed in others.

That distinction needs deciding rather than assuming, because it determines
whether the 22-vs-additions split is "core plus overrides" or "core plus
conflicts" on the day something changes.

## Open questions for propose

1. **Is a removal a conflict or an override?** A repo that deliberately drops a
   permission has expressed an intent, but there is no marker to say so. Treating
   it as a conflict is safe and may be noisy; treating it as an override
   distributes a removal nobody declared.
2. **Does `sync` distribute `settings.json` per file or per key?** The skills gate
   is per skill. The analogue here could be the whole file or a single key.
3. **Does this reuse the `conflicts/` layer** and the same undistributable gate,
   or does it get its own? Reusing it keeps one concept; separating it admits
   that "conflict" means something different here.
