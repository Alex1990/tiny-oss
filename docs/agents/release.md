# Releasing

How to cut a release of tiny-oss. Tooling: `bumpp` drives the version bump / commit / tag / push; `changelogen` maintains `CHANGELOG.md`. Orchestration lives in `package.json` scripts and `bump.config.ts` — read `bump.config.ts` before changing anything here.

## Flow

1. **Working tree must be clean.** `bump.config.ts` sets `all: true`, so the release commit runs `git commit -a` and sweeps up every tracked modification and staged file. Uncommitted work would land in the release commit.
2. **Gates** (fast, no browser needed): `pnpm lint && pnpm check:types`.
3. `pnpm release` — interactive semver prompt. Pick per the commits since the last tag: new feature(s) → `minor`; fixes/docs/tests only → `patch`. This repo has had no breaking change yet, so no `major`. Non-interactive (agent/CI): `pnpm exec bumpp --release <patch|minor> --yes`.
4. That commits `chore(release): <version>` — including the regenerated `CHANGELOG.md` — tags `v<version>`, and pushes straight to `main`, carrying any unpushed commits already on the branch. Push is on by default; opt out with `--no-push`.
5. **`pnpm build && pnpm publish`** — manual, needs npm auth. `dist/` is gitignored but ships in the package (`files: ["dist", "UPGRADING.md"]`), so build locally right before publishing.

Preview the next changelog without touching anything: `pnpm changelog` (stdout only).

## Gotchas (verified against the installed tool versions)

- `bump.config.ts` MUST keep `all: true`. Without it bumpp commits with `git commit <files>` (only the bumped files), silently dropping the staged `CHANGELOG.md` from the release commit. That shipped once; it was fixed by amending the release commit and force-pushing.
- `changelogen` needs `-r <newVersion>` (injected by the config's `execute` hook from `operation.state.newVersion`), or the changelog heading reads `<oldTag>...<branch>` instead of `v<newVersion>`.
- A brand-new `CHANGELOG.md` is untracked, and `git commit -a` skips untracked files — the `execute` hook stages it explicitly. Do not pre-create `CHANGELOG.md`; the release commit creates it.
- Bare `changelogen` prints to stdout and writes nothing; only `--output` / `--bump` / `--release` touch disk.
- Re-tagging after a mistaken push: `git push --force-with-lease origin <tag>` fails with `stale info` for tags — use `git push --force origin <tag>`.
- Tags are `v<version>` since v1.0.0 (pre-1.0.0 `0.x.y` tags have no prefix). `bumpp`/`changelogen` defaults match the `v` prefix; commit messages historically read `chore(release): <version>` without the `v`.
