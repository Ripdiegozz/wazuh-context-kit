# wazuh-context-kit

## Hard rule: `wazuh/*` repositories are read-only. No exceptions.

**Never create an issue, a pull request, or a commit in any repository owned by
the `wazuh` organisation.** Not as a convenience, not as a follow-up, not
because a finding looks obviously actionable.

This is not a style preference. The maintainer works at Wazuh, and any write
from this tooling would be an unauthorised action under his name inside his
employer's organisation. He decides what gets filed there, with his own
judgement and his own name on it.

### What is permitted

Reads, and only reads. The production code invokes exactly these git
subcommands against `wazuh/*` remotes, and the list is the contract:

```
ls-remote   clone   fetch   rev-parse   sparse-checkout   init   checkout
```

No `push`. No `commit`. No `remote add`. The cached clones under
`.cache/<repo>@<ref>/` are `blob:none` partial clones, and they stay clean.

**The boundary is what you point git at, not which verb you use.** Phase 3 added
world detection, which reads the *consumer's own working tree* to answer "where
is this person standing" — `config --get remote.origin.url` and
`symbolic-ref --short HEAD`, neither of which appears above. That is not a
loophole and it is not drift: those commands never touch a `wazuh/*` remote, they
inspect the checkout the user is already sitting in.

So the contract has two halves, and they are not the same rule:

| Target | Permitted |
| --- | --- |
| a `wazuh/*` remote | exactly the seven subcommands listed above |
| the consumer's local working tree | any read-only subcommand |

A write is forbidden in both columns. The first column is narrow because every
call in it crosses into the maintainer's employer's organisation; the second is
broader because it never leaves the machine. Recorded 2026-09-17, when the code
started using two subcommands this file had not named and the honest fix was to
say which rule they fall under rather than quietly widen the list.

`gh` against a `wazuh/*` target is read-only too: queries yes, never
`gh issue create`, `gh pr create`, or `gh api -X POST|PATCH|PUT|DELETE`.

Every commit and pull request this project produces goes to **its own
repository**.

### Where findings go instead

This tool exists to find things about Wazuh's code — a pattern declared without
its glob, an index declared and never installed, an accessor answering as the
wrong principal. Those are delivered as **documents in this repository**, for a
person to read and act on.

A finding written down is information. The same finding filed upstream by
automation is an action nobody authorised, and it arrives wearing a human's
name. The distinction is the whole reason this boundary exists.

### When asked whether anything upstream changed, verify

Do not answer from memory. The check takes seconds:

```sh
# every cached clone clean, and none diverged from its upstream
for d in .cache/*@*/; do git -C "$d" status --porcelain; done
for d in .cache/*@*/; do git -C "$d" rev-parse HEAD @{u}; done

# nothing in the org authored during the session window
gh search issues --author "@me" --owner wazuh --limit 20
gh search prs    --author "@me" --owner wazuh --limit 20
```

An assertion is worth less than the command that proves it, and this project's
whole thesis is that a claim you cannot check is not evidence.
