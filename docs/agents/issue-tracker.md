# Issue tracker: shared Feishu Tasks

Matt engineering issues, specs and tickets for this repo live in **AlphaFox-Issues**, not GitHub Issues. Prefix titles with `[alphafox-cli]`. GitHub hosts code and PRs; a PR URL may be linked from the task.

On task operations, read the infra `docs/agents/issue-tracker.md` for canonical GUIDs, sections, Type options and dependency conventions. Resolve `alphafox-infra` in the workspace described in this repo's AGENTS.md (or its explicitly selected task worktree). Read the installed `lark-task` Skill for current commands; do not maintain a second CLI recipe here. If the shared file is unavailable, discover the named existing list using the Skill and verify its identity before writing; do not create a replacement list.

A linked task's acceptance is the specification. Without a linked task, use the explicit user request and record it in the PR; task creation is not a prerequisite for local work. Routine delivery comments stay within existing task authorization; new scope or tasklists need their own decision.

**PRs as a request surface: no.** For a specifically requested PR triage, inspect it on GitHub and keep engineering task state in Feishu.
