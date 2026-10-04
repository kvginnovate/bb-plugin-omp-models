---
name: omp-models
description: Use when reading or changing omp's model role assignments (the `modelRoles` record that omp's `/models` roles view edits) — assigning a provider/model selector to a role such as default, smol, task, or judge, or removing an assignment. Covers the `bb omp-models` CLI subcommands (`roles`, `assign`, `unset`) and the `omp_model_roles` agent tool, which drive the real `omp` binary on the target host.
---

# omp models

The omp-models plugin reads and rewrites omp's `modelRoles` record — the same
record omp's `/models` roles dialog edits. It never writes the config file
directly: it drives `omp config ...` on the target machine, so omp keeps its
own write path.

## Surfaces

- CLI: `bb omp-models <roles|assign|unset> ...`
- Agent tool: `omp_model_roles`, one tool with an `action` parameter.
- A sidebar page in bb shows the same matrix visually. Agents cannot see it —
  when a user would prefer to click, point them there; the write path is the
  same one this tool uses.

## Actions

| Parameter | Required for | Meaning |
| --- | --- | --- |
| `action` | always | `roles` \| `assign` \| `unset` |
| `role` | `assign`, `unset` | Role name, e.g. `smol`, `judge`, or one of the user's custom roles. |
| `selector` | `assign` | The model selector, or a comma-separated ordered candidate list (see below). |
| `machine` | optional, any action | Target host id. |

CLI equivalents:

```
bb omp-models roles
bb omp-models roles --json
bb omp-models assign smol openai/gpt-5.1
bb omp-models assign web web/duckduckgo --json
bb omp-models unset commit
```

`roles` prints the current role matrix: one line per role — its group and
the selector it resolves against the live catalog. `roles` also accepts
`--limit` to cap rows; the agent tool's `roles` output is bounded to about
25 one-line rows either way, so the catalog never gets dumped into a
transcript. All three subcommands accept `--json` for machine output instead
of the human table; use it when the output drives code.

## Role vocabulary

**Chat roles** (pick a conversational model):

| Role | For |
| --- | --- |
| `default` | Primary conversation model; `*` and `@default` expand here. |
| `smol` | Fast, cheap model for lightweight tool work. |
| `slow` | Slow reasoning model for thorough analysis. |
| `plan` | Model used in plan mode; assigning it does not enter plan mode. |
| `task` | Model for sub-agent task resolution. |
| `vision` | Chat model for image analysis; the model needs image input. |
| `commit` | Model for commit message generation. |
| `tiny` | Titles and background text; falls back to `smol` when unset. |
| `memory` | Managed memory extraction; falls back to `tiny` when unset. |
| `advisor` | Advisor runtime model; an invalid assignment never falls back. |

**Model-kind roles** (pick a runner of that catalog kind):

| Role | For |
| --- | --- |
| `image` | Model for image generation. |
| `web` | Search model for the web search tool. |
| `speech` | Text-to-speech model. |
| `dictation` | Speech-to-text model. |
| `judge` | Model for typed judgments: thinking level, stop detection, staging. |

Any key in the user's `modelRoles` that is not documented above is a custom
role; the plugin surfaces it instead of dropping it.

## Selector syntax

A selector is `provider/model` — one catalog row's `selector` field, which
`roles` prints for you. Legal forms:

- `provider/model`, e.g. `anthropic/claude-opus-4-1`.
- Optional thinking suffix after a `:` — levels:
  `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `auto`, `inherit`.
- `@role` aliases, e.g. `@default` — omp expands them to that role's value.
- `*` — shorthand naming the default role.
- Comma-separated ordered candidates, e.g.
  `anthropic/claude-sonnet-4-5,openai/gpt-5.1`: this is ONE value; omp tries
  them in order and uses the first available. Never split them across writes.

`web/*` (search engines) and `local/*` (on-device runners) are legal role
targets even though they publish no catalog rows — do not reject them as
unresolved.

## Two rules that matter

1. **Whole-record write, no partials.** `omp config set modelRoles` replaces
   the entire map, and the plugin preserves the rest for you: `assign` and
   `unset` carry every other role forward server-side. So never hand-write a
   partial `modelRoles` map. Still run `roles` before a write to see the
   current stored record, and check the reported `stored` result afterward.
2. **omp validates nothing.** An unresolvable selector or unknown role name
   persists silently and only breaks the workload that uses it. This plugin
   checks every candidate against the live catalog before shelling out — but
   if you construct a value yourself, resolve it against `roles` output first.

## Target host resolution

In order: explicit `machine` / `--machine` → the invoking thread's
environment host → the system primary host. If none resolves, the error
names the `--machine` flag to use.

## Caveat

A running omp TUI does not hot-reload role assignments. A write applies to
the NEXT omp session; a session that is open keeps the model it started
with. Say so after a write.
