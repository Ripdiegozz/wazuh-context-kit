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
