# Issue tracker: Feishu Tasks

Issues and specs for this repo live as tasks in the **Alphafox-Issues** Feishu (Lark) tasklist. Use the `lark-cli` CLI ([`@larksuite/cli`](https://github.com/larksuite/cli)) for all operations, always with `--as user` — a task created by the bot identity is invisible in the human's task centre.

List: <https://applink.feishu.cn/client/todo/task_list?guid=6d628d79-cdfe-47cc-98f7-35561944494b>

## Identifiers

An issue's identity is its **task GUID** — a UUID. There is no usable short number: the `t101420`-style id the Feishu UI shows (`task_id`, `suite_entity_num`) is **display-only** and every API rejects it, so a bare `#42` or `t101420` cannot be looked up directly.

- Prefer the task **URL** (`https://applink.feishu.cn/client/todo/detail?guid=<GUID>`) — the GUID is the `guid` query param. Every write command below also accepts the URL in place of the GUID.
- Given only a `t1014xx` number or a title fragment, resolve it with `lark-cli task +search --query "<title words>" --as user` and match on `summary`. Search spans **all** the user's tasks, not just this tasklist, so confirm the match before writing.
- When narrating to the human, refer to an issue by its **title**, not its GUID.

## Setup values

- **Tasklist GUID**: `6d628d79-cdfe-47cc-98f7-35561944494b`
- **`Type` field GUID**: `227d69e7-e535-40f0-b64f-4e90247149e2`

Triage roles are **sections** — a task sits in exactly one, so the state machine can't be violated. `待分类` is the default section, so anything created without a section lands there as untriaged.

| Canonical role | Section | Section GUID |
| -------------- | ------- | ------------ |
| _(untriaged)_ | `待分类` (default) | `4ca8fd68-9a08-5794-1598-8e5a394e8638` |
| `needs-triage` | `待评估` | `44e58692-1ced-462b-99bb-bf082a745ef3` |
| `needs-info` | `待补充信息` | `0cff4cf9-00b9-42bd-b482-5cd06a51b99b` |
| `ready-for-agent` | `可交给 Agent` | `1ce586d5-7953-4d68-b41a-d4b2851f5806` |
| `ready-for-human` | `需人工处理` | `8713387c-e758-4730-9de8-0b30859674ff` |
| `wontfix` | `不予处理` | `00d4b874-1a4a-43d8-b0cf-fcb52460f9bf` |
| _(wayfinder — outside the triage queue)_ | `探路图` | `bab88abf-0bf9-407d-806b-680901a86dd7` |

Every other label is an option on the single-select `Type` field. Address an option by its GUID, never by name — the skills' canonical labels use a colon (`wayfinder:map`) while the Feishu options are named with a hyphen (`wayfinder-map`), so this table is the only mapping between them:

| Label | Option GUID |
| ----- | ----------- |
| `bug` | `0eb51704-bead-4e8e-93be-dd8d02c1d20c` |
| `enhancement` | `ebd05bc8-ab6c-4a56-8628-6c3284d9f1f9` |
| `spec` | `399a640f-5d51-4dab-a4f3-da3df638ec8a` |
| `ticket` | `3bb7ca44-ac8c-4b75-8925-96fc457fb974` |
| `wayfinder:map` | `8cd13987-010e-46f0-808f-a8f289791cf5` |
| `wayfinder:research` | `f18b808a-d978-41cb-9bef-cd0708fecf0c` |
| `wayfinder:prototype` | `49126969-48dc-4297-96d4-36d176ffb8bb` |
| `wayfinder:grilling` | `265feb46-9ac8-4c03-afa8-9400296defe4` |
| `wayfinder:task` | `ed48b848-01d0-406b-ac7d-a96ce66cee0d` |

## Conventions

- **Shared-list title** — prefix every issue/task title with `[alphafox-cli]` so the repository remains identifiable on the shared board.
- **Tracker boundary** — Matt Skills issues, specs, tickets, triage items, and wayfinder maps belong in `Alphafox-Issues`, not a quarterly execution list. If quarterly planning initiated the work, link its absolute Feishu task URL instead of duplicating workflow state.

- **Create an issue** — one call sets body, section (triage role) and `Type`:

  ```bash
  lark-cli task tasks create --as user --params '{"user_id_type":"open_id"}' --data '{
    "summary": "<title>",
    "description": "<body>",
    "tasklists": [{"tasklist_guid": "6d628d79-cdfe-47cc-98f7-35561944494b", "section_guid": "<SECTION_GUID>"}],
    "custom_fields": [{"guid": "227d69e7-e535-40f0-b64f-4e90247149e2", "single_select_value": "<OPTION_GUID>"}]
  }'
  ```

  For an untriaged issue with no label, `lark-cli task +create --tasklist-id 6d628d79-cdfe-47cc-98f7-35561944494b --summary "..." --description "..." --as user` is enough — it lands in `待分类`.

- **Read an issue** — the body and the comments are two calls:

  ```bash
  lark-cli task tasks get --as user --params '{"task_guid": "<GUID>", "user_id_type": "open_id"}'
  lark-cli api GET /open-apis/task/v2/comments --as user \
    --params '{"resource_type": "task", "resource_id": "<GUID>", "page_size": 50, "user_id_type": "open_id"}'
  ```

  `tasks get` returns `description` (the body), `custom_fields` (the `Type` label), `tasklists[].section_guid` (the triage role), `members` (assignees), `status` (`todo`/`done`), `dependencies` (blockers) and `parent_task_guid`. Comments are **not** exposed by `lark-cli task`; the raw `api` call above is the only way to read them.

- **List a triage bucket** — one call per section, and this is the cheap path:

  ```bash
  lark-cli task sections tasks --as user --params '{"section_guid": "<SECTION_GUID>", "completed": false, "page_size": 100}'
  ```

  Returns a brief per task — `guid`, `summary`, `completed_at`, `subtask_count` — which is all a queue listing needs. Pass `created_from`/`created_to` to window by age; results come oldest-first. Reading a task's `Type` or assignees means a `tasks get` per task, so don't do it while building a queue listing.

- **List every issue**: `lark-cli task tasklists tasks --as user --params '{"tasklist_guid": "6d628d79-cdfe-47cc-98f7-35561944494b", "completed": false, "page_size": 100}'`.

- **Comment on an issue**: `lark-cli task +comment --task-id <GUID> --content "..." --as user`. Plain text — Feishu renders no markdown in comments, so keep formatting light.

- **Apply a triage role** — move the task to that role's section. Re-adding an existing task with a new `--section-guid` moves it; there is no separate "remove from old section" step:

  ```bash
  lark-cli task +tasklist-task-add --tasklist-id 6d628d79-cdfe-47cc-98f7-35561944494b --task-id <GUID> --section-guid <SECTION_GUID> --as user
  ```

- **Apply a `Type` label** — patch the custom field. This replaces the previous value, since the field is single-select:

  ```bash
  lark-cli task tasks patch --as user --params '{"task_guid": "<GUID>"}' --data '{
    "task": {"custom_fields": [{"guid": "227d69e7-e535-40f0-b64f-4e90247149e2", "single_select_value": "<OPTION_GUID>"}]},
    "update_fields": ["custom_fields"]
  }'
  ```

- **Edit the body**: same shape, with `{"task": {"description": "..."}, "update_fields": ["description"]}`. A patch **replaces** the description, so read it first and re-send the whole text.

- **Every markdown link in a body needs a real absolute URL.** Feishu parses `[text](target)` in `description` and validates the target, rejecting the entire write with `Invalid Param 'description', url in description is invalid` when it isn't one. A placeholder `(link)`, an empty `()`, and a repo-relative `(./src/foo.ts)` all fail. Link to an absolute `https://` URL, or drop the link syntax and name the thing in plain text. Headings, lists, bold, bare URLs and task GUIDs are all fine.

- **Close**: `lark-cli task +complete --task-id <GUID> --as user`. It takes no closing comment, so post the explanation with `+comment` first, then complete. Reopen with `lark-cli task +reopen --task-id <GUID> --as user`.

- **Assign**: `lark-cli task +assign --task-id <GUID> --add <open_id> --as user` (`--remove` to unassign). Get your own `open_id` from `lark-cli auth status --jq '.identities.user.openId'`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

Feishu Tasks holds no code, so PRs live on the GitHub remote. When this flag is `yes`, triage reads a PR and its diff with `gh pr view` / `gh pr list` / `gh pr diff` while the roles and states stay here in the tasklist: a PR under triage gets a task in this list whose body links the PR. Numbering never collides, because a task GUID and a `#42` are different shapes.

## When a skill says "publish to the issue tracker"

Create a task in this tasklist. Put the whole document in `description`, set `Type`, and place it in the section matching its triage role.

## When a skill says "fetch the relevant ticket"

Run `tasks get` for the body plus the raw `comments` call for the history — an agent brief or a resolution lives in one or the other.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a task; its tickets are **subtasks** of it.

- **Map**: a task with `Type` = `wayfinder:map`, in `探路图`, holding the Destination / Notes / Decisions-so-far / Fog body in `description`.
- **Child ticket**: create the task, then parent it — `lark-cli task +set-ancestor --task-id <CHILD_GUID> --ancestor-id <MAP_GUID> --as user`. Parenting **keeps** the child's tasklist and section membership, so tickets stay visible in `探路图`. Label each with `Type` = `wayfinder:<type>`.
- **Blocking**: Feishu's **native task dependencies** — the canonical, UI-visible representation. `type: "prev"` means "blocks this task", so a child blocked by another records the blocker as `prev`:

  ```bash
  lark-cli api POST /open-apis/task/v2/tasks/<CHILD_GUID>/add_dependencies --as user \
    --data '{"dependencies": [{"task_guid": "<BLOCKER_GUID>", "type": "prev"}]}'
  ```

  The reciprocal `next` edge appears on the blocker automatically. Drop an edge with `--data '{"dependencies": [{"task_guid": "<BLOCKER_GUID>"}]}'` against `.../remove_dependencies`. Dependencies are **not** settable through `tasks create` or `tasks patch` — the raw `api` call is the only route, so tickets must exist before they can be wired, which is why charting creates first and wires second.

- **Frontier query** — one call, because `subtasks list` returns *full* task objects rather than briefs:

  ```bash
  lark-cli task subtasks list --as user --params '{"task_guid": "<MAP_GUID>", "page_size": 100, "user_id_type": "open_id"}'
  ```

  Each child carries `status`, `members`, `dependencies` and `description`. Filter locally: keep `status` of `todo`, drop any with a `members` entry whose `role` is `assignee` (claimed), and drop any whose `prev` dependencies include a task still `todo` (blocked). Blockers that are siblings on the same map are already in this response; resolve any others with `tasks get`. First in map order wins.

- **Claim**: `lark-cli task +assign --task-id <GUID> --add <your open_id> --as user` — the session's first write.
- **Resolve**: `+comment` with the answer, then `+complete`, then patch the map's `description` to append a context pointer to Decisions-so-far. That pointer's link must be the ticket's full applink URL — a Decisions-so-far line written as `[title](link)` is rejected by the description's URL validation, taking the whole map update with it.

## Re-reading the setup values

```bash
lark-cli task sections list --as user --params '{"resource_type": "tasklist", "resource_id": "6d628d79-cdfe-47cc-98f7-35561944494b", "page_size": 50}'
lark-cli task custom_fields list --as user --params '{"resource_type": "tasklist", "resource_id": "6d628d79-cdfe-47cc-98f7-35561944494b", "page_size": 50}'
```

`custom_fields list` returns each option's `guid` alongside its `name`, which is what the `Type` table above records.
