---
name: research
description: Fetch authoritative, timely, and comprehensive information needed to
  work on a task — official cloud-provider docs, signature/spec details, SDK
  behavior, dependency status. Use during deep analysis whenever the task depends
  on facts outside the repo.
---
# Research authoritative sources

## Steps
1. State the question(s) to answer and why the answer matters (signature
   byte-compatibility, transport behavior, API availability…).
2. Preferred sources, in order: official provider/SDK docs → upstream specs /
   RFCs → changelogs/release notes → the repo's own README/UPGRADING/CHANGELOG
   → pinned oracle tests in `test/`.
3. For each claim you will act on, capture: source URL, version/date, quote.
   No quote → treat as unverified and say so.
4. Cross-check against oracle tests (`test/*-signature.spec.ts`,
   `pnpm test:azure-oracle`): a documented behavior that contradicts a green
   oracle test is suspicious — verify before trusting either side.
5. Append `findings` to the task state file (source, claim, confidence).

## Done when
- Every question has an answer with a source, or is explicitly marked
  unresolvable; findings are in the task state.
