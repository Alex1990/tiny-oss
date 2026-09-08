---
name: sweep
description: Scheduled consistency pass over the loop system itself — reconcile
  GitHub state against the state layer, expire stale tasks (needs-info without
  reply, abandoned waiting-merge), fold dependency/security notifications into
  tasks or triage, and refresh the human summary. Runs on a timer (e.g. daily).
---
# Sweep the system

## Steps
1. Fetch open issues and PRs (`gh issue list --state open`, `gh pr list
   --state open`) and compare with `state/tasks/*.json`:
   - GitHub item missing in state → create task file (`status: new`).
   - State says `processing` but lock expired and run dead → mark interrupted,
     re-triage or resume per memory doc §3.8.
   - `waiting-merge` PR merged/closed since last run → record acceptance
     event if the dispatcher missed it (label it `sweep-corrected`).
2. Expiry rules:
   - `needs-info` unanswered > 30 days → close with comment, `status: closed`.
   - `waiting-merge` untouched > 14 days → comment nudge once; if the human
     then closes without merging → `rejected` (counted).
3. Dependency/security notifications (Dependabot alert, security advisory
   event): triage them — patch/minor risk → create/queue a `deps` task with
   `ready-for-agent`; major/breaking or unclear → `needs-triage`.
4. Rebuild `state/SUMMARY.md` from the current state files.
5. Write a sweep run record; surface anomalies (state/gh mismatch unresolved,
   deadlocks) in the summary for the human.

## Done when
- State and GitHub agree on every open item; expiry rules applied; summary
  refreshed; anomalies listed.
