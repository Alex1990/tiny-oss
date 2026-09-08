# Triage Labels

Issues and PRs share one label system (PRs are a triage surface in this repo).
Five canonical roles drive the loop:

| Label | Meaning | Who acts next |
| --- | --- | --- |
| `needs-triage` | Needs a maintainer to evaluate (loop couldn't decide; too risky; external PR) | Maintainer |
| `needs-info` | Waiting on the reporter: exact questions are in the comments | Reporter; loop closes after 7 days unanswered |
| `ready-for-agent` | Fully specified, an AFK agent may handle it unattended | Loop workflow (claims & processes) |
| `ready-for-human` | Requires a human: implementation, merge of a loop PR, or a release call | Maintainer |
| `wontfix` | Will not be actioned (duplicate / off-scope / pure question already answered) | — (issue closed with a reason) |

Conventions

- The loop labels/unlabels on GitHub and mirrors into `state/tasks/<id>.json`.
  GitHub is the source of truth; `sweep` reconciles drift.
- Never stack contradictory roles on one item (e.g. `needs-triage` +
  `ready-for-agent`).
- Apply to PRs with the `gh pr` equivalents.
- When in doubt, use `needs-triage` — the loop prefers a human over a wrong guess.
