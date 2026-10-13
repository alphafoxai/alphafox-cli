---
name: setup-workspace
description: "Set up the AlphaFox development layout from whichever AlphaFox repository was cloned first. In alphafox-workspace it clones the registered repositories beside it; in any other AlphaFox repository it clones alphafox-workspace beside it. Either way it syncs with origin/main and exports ALPHAFOX_WORKSPACE from the shell profile. Use when a developer has just cloned a repository, when ../alphafox-workspace is missing, or when asked to set up or repair the workspace."
---

# Set up the AlphaFox workspace

AlphaFox is a set of repositories that sit side by side in one dedicated parent directory,
with `alphafox-workspace` among them. This skill is the same file in every AlphaFox
repository, so it works from whichever one the developer cloned first. It never deletes,
moves, stashes, resets, or switches anything.

## 1. Find where you are

Run these from anywhere inside the repository, including a linked worktree:

```sh
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
PARENT=$(dirname "$MAIN")
grep -E '^project:' "$MAIN/.alphafox/workspace.yaml"
basename "$MAIN"
ls -A "$PARENT"
```

- `MAIN` is the repository's main checkout and `PARENT` the directory that holds it. Work
  from `MAIN`, not from a worktree under `~/.worktrees/`.
- `project: alphafox-workspace` means this is the workspace: follow section 2. Any other
  `project:` value is a component registry id (`web`, `engine`, …): follow section 3.
- No `.alphafox/workspace.yaml` means this is not an AlphaFox repository, or a very old
  checkout. Stop and say so.
- The checkout directory must be named after the repository, for example `alphafox-web`,
  because every cross-repository link is `../alphafox-<name>`. If it is not, stop and ask
  the developer to rename or re-clone it; do not rename it yourself.
- Look at what else is in `PARENT`. Other `alphafox-*` repositories are expected. If it
  holds unrelated projects (for example the home directory or a general `~/code`), ask the
  developer before cloning anything: the right fix is a dedicated parent such as
  `~/projects/alphafox/`, and moving their files is their decision.

Prerequisites: Git, Node.js 22 or newer (`node --version`), and the GitHub CLI signed in
with access to the `alphafoxai` organization (`gh auth status`). Most repositories are
private; a clone that fails with "not found" means the account lacks access. Report a
missing prerequisite instead of working around it.

## 2. In alphafox-workspace: clone the other repositories

```sh
cd "$MAIN"
node scripts/setup-workspace.mjs                    # read-only report of the layout
node scripts/setup-workspace.mjs --clone            # clone every registered repository
node scripts/setup-workspace.mjs --sync             # bring every clone up to origin/main
```

Clone everything unless the developer named the repositories they work on; then use
`--clone --only <id>,<id>` with ids from `.alphafox/project-registry.yaml`. `--clone` only
clones into an empty path and never touches an existing checkout.

## 3. In any other repository: clone the workspace

```sh
WS="$PARENT/alphafox-workspace"
test -e "$WS" || gh repo clone alphafoxai/alphafox-workspace "$WS"
git -C "$WS" remote get-url origin | grep -Eq '[:/]alphafoxai/alphafox-workspace(\.git)?$' && echo "workspace ok"
node "$WS/scripts/setup-workspace.mjs" --sync --only <id>    # <id> is this repository's project: value
```

- If `$WS` exists but is not a clone of `alphafoxai/alphafox-workspace`, stop and report it;
  never overwrite or delete it.
- Without `gh`, clone with `git clone git@github.com:alphafoxai/alphafox-workspace.git "$WS"`.
- Other repositories are not required. Clone one later, when a task needs it, with
  `node "$WS/scripts/setup-workspace.mjs" --clone --only <id>`.

## 4. What the script does, and how to read it

`--clone` and `--sync` also write `ALPHAFOX_WORKSPACE` into the shell profile (`~/.zshrc`,
`~/.bash_profile` on macOS bash, `~/.bashrc` on other bash, or a fish `conf.d` file), inside
a block between `# >>> alphafox-workspace >>>` and `# <<< alphafox-workspace <<<`. Task
worktrees under `~/.worktrees/` find the workspace through this variable.

- `added …; open a new terminal` — done. The current terminal does not have the variable
  yet; tell the developer to open a new one.
- `FAIL ALPHAFOX_WORKSPACE … change it to …` — the profile already sets the variable on its
  own line to another path. Show the developer that line; do not edit it.
- `WARN … not set automatically` — an unsupported shell. Give the developer the printed
  line to add by hand.
- `NOT UPDATED (dirty | not-on-main | diverged …)` — a checkout holds someone's work. Leave
  it and report it; never stash, reset, or switch it to make the sync pass.
- `miss` / `clone-failed` — usually access or authentication; check `gh auth status`.

The run ends with `layout ok`, or `layout ok, checkouts current` after `--sync`. Anything
else is unfinished; report the exact lines.

## 5. Finish

Tell the developer what was cloned, where `ALPHAFOX_WORKSPACE` now points, and anything left
for them to resolve. Then read `alphafox-workspace/AGENTS.md`: its development workflow
applies from the first change.
