---
name: auto-commit
description: >
  Stage, review, and commit accumulated changes with user approval.
  Use when: finishing a feature, committing big changes, "commit this",
  "auto-commit", "stage and commit", "commit with approval", "review and commit".
  Presents a diff summary and a proposed conventional-commit message before writing
  anything to git history. Optionally pushes to the remote branch.
argument-hint: 'optional scope or short description, e.g. "feat: solax UI overhaul"'
---

# Auto-commit (with approval)

## When to Use

- After completing a multi-file feature or refactor
- Any time the user says "commit", "auto-commit", "commit big changes", or "finish and commit"
- After implementing changes across UI, backend, and config in the same session

---

## Procedure

### 1. Collect the current diff

Run these two commands to understand exactly what changed:

```bash
git diff --stat HEAD
git status --short
```

Also get a one-line summary of the last commit for context:

```bash
git log --oneline -1
```

### 2. Identify new/untracked files

Any `?? ` entries in `git status --short` are untracked — they must be explicitly staged.

### 3. Propose a commit message

Derive a [Conventional Commits](https://www.conventionalcommits.org/) message from the diff:

```
<type>(<scope>): <short summary>

[optional body: bullet list of notable changes]
```

Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`.

Keep the subject ≤ 72 characters. If the changeset spans multiple concerns, pick the most
prominent type and list the rest in the body.

### 4. Ask the user for approval

Present:

- The `git diff --stat` output (file list + insertion/deletion counts)
- The proposed commit message

Then ask the user to:

1. **Approve** the message as-is
2. **Edit** — provide a replacement message
3. **Cancel** — abort without committing

### 5. Stage and commit (only after approval)

```bash
# Stage all tracked modifications
git add -u

# Stage any new files the user should include
# (list them explicitly, do not blindly `git add .`)
git add <untracked-file-1> <untracked-file-2> ...

# Commit with the approved message
git commit -m "<approved message>"
```

> **NEVER** run `git commit` before the user has explicitly approved the message.
> **NEVER** include `.env`, `logs/`, `screenshots/`, or other files listed in `.gitignore`.

### 6. Offer to push

After a successful commit, ask: "Push to `origin/<branch>`?" — do **not** push automatically.

If the user confirms:

```bash
git push origin HEAD
```

---

## Safety Rules

| Rule | Reason |
|------|--------|
| No `git push --force` | Destructive — always ask separately with clear warning |
| No `git add .` blindly | Could include secrets, build artefacts, or unintended files |
| Never skip approval | The whole point of this skill is human-in-the-loop review |
| Check `.gitignore` before staging | Confirm sensitive files (`.env`, `logs/`) are excluded |

---

## Conventional Commit Cheatsheet

| Prefix | Use for |
|--------|---------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code change with no behaviour difference |
| `chore` | Tooling, deps, config |
| `docs` | Documentation only |
| `style` | CSS/visual changes, formatting |
| `perf` | Performance improvement |
| `test` | Tests added or fixed |
