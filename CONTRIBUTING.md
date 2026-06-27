# Contributing to goose-note

Thanks for your interest in contributing! This document explains how to get set
up and the conventions this project follows.

## Development setup

This project uses [Bun](https://bun.sh/) as the primary package manager and runtime.

```bash
# Install dependencies
bun install

# Start the dev server (http://localhost:6001)
bun run dev

# Build the uTools plugin bundle
bun run build
```

Node.js `>=20` is required if you run the toolchain without Bun.

## Before opening a pull request

Run the same checks CI runs, locally:

```bash
bun run typecheck   # tsc -b --noEmit
bun run lint        # eslint .
bun run build       # full production build
```

All three must pass. CI runs them on every pull request to `main` and `dev`.

## Branching & commits

- Branch off **`dev`**, not `main`. `main` always reflects the latest released state.
- Keep pull requests focused — one logical change per PR.
- Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/)
  style, e.g. `feat: add word-count footer`, `fix: prevent cursor jump on toggle`.
- Commit messages and PR descriptions should be in **English**.

## Code style

- TypeScript + React. ESLint config lives in `eslint.config.js`.
- Match the conventions of the surrounding code (naming, formatting, comment density).
- Avoid `any` where a real type is reasonable — `@typescript-eslint/no-explicit-any`
  is enabled as a warning.

## Reporting bugs & requesting features

Use the issue templates under **Issues → New issue**. Please include reproduction
steps, your environment (OS, uTools version or browser), and expected vs. actual
behavior.

## Maintainer review checklist

Use this when reviewing contributor PRs (AI assistants: skill `oss-pr-reviewer` + `references/goose-note.md`).

1. **Correct diff** — Review the PR’s real remote head (not a stale local branch with the same name).
2. **Merge gate** — `typecheck`, `lint`, and full `build` (includes the quick-note plugin build).
3. **Scope** — One logical change; English Conventional Commits; no `tasks/`, `.env*`, or AI-only tooling artifacts.
4. **Editor** — Changes under `src/components/editor/` must not break **title block one** (first block is always H1; see `AGENTS.md` / `firstTitleGuard.ts`).
5. **uTools UI** — Style changes must avoid Tailwind alpha/palette traps that fail in the uTools WebView; prefer CSS variables in `src/index.css`. Browser dev alone is not enough for hover/selected states.
6. **Dual plugin** — Shared code must still build for both the main app and `GOOSE_BUILD_TARGET=quicknote` / `__GOOSE_LITE__`.
7. **Data** — Persistence and local-folder sync changes must not lose or silently overwrite notes.
8. **Security** — No hardcoded secrets or personal paths in defaults; see [SECURITY.md](./SECURITY.md).
9. **Verification** — Ask for a short **Testing** note in the PR when behavior changes (we do not run e2e in CI).

Local uTools smoke test after `bun run build`: load `dist/plugin.json` in the uTools developer tools (see README).

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md).
