# Triage Labels

The skills speak in terms of five canonical triage roles. On this repo's tracker (Feishu Tasks) a role is not a label but a **section** of the AlphaFox-Issues tasklist — a task sits in exactly one, so the state machine can't be violated. `issue-tracker.md` holds the section GUIDs and the command that moves a task between them.

| Label in mattpocock/skills | Section in our tracker | Meaning                                  |
| -------------------------- | ---------------------- | ---------------------------------------- |
| _(no label yet)_           | `待分类`               | Never triaged — the default section       |
| `needs-triage`             | `待评估`               | Maintainer needs to evaluate this issue  |
| `needs-info`               | `待补充信息`           | Waiting on reporter for more information |
| `ready-for-agent`          | `可交给 Agent`         | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `需人工处理`           | Requires human implementation            |
| `wontfix`                  | `不予处理`             | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), move the task to the corresponding section from this table.

The remaining labels — the `bug` / `enhancement` categories and wayfinder's `wayfinder:<type>` — are **not** sections. They are options on the single-select `Type` field, because they coexist with a triage role rather than replacing it. `issue-tracker.md` holds their option GUIDs.

Editing the right-hand column here is not enough on its own: rename a section in Feishu and its GUID stays the same, so update this table and leave `issue-tracker.md`'s GUIDs alone. Adding or removing a section is the case that changes GUIDs, and then both files need re-syncing.
