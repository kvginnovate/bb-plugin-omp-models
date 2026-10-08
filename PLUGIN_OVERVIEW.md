Open omp's model roles inside bb, pick a model per role, and keep every
assignment that was already there.

## What you get

- A **Model roles** page in the left sidebar: omp's roles down the side, omp's
  providers across the top, and one click to assign any model in the catalog to
  any role.
- Free-text editing of a role value, validated candidate by candidate, because
  omp accepts more than `provider/model` — `@smol` aliases, `*`, comma-separated
  ordered candidates, and `:thinking` suffixes all work.
- A `bb omp-models` command and an `omp_model_roles` agent tool that do the same
  from a terminal or a thread.

## How it works

omp stores every workload's model in one `modelRoles` record in its own config
file, and its `/models` dialog edits exactly that record. This plugin reads the
live catalog with `omp models` and rewrites the record through `omp config set`,
on whichever machine omp is actually installed on.

omp replaces `modelRoles` wholesale and validates nothing, so a typo would
persist silently and break only the workload that uses it — long after you
stopped looking. Every write here resolves each selector against the live
catalog first, then carries every other role forward and re-reads the file to
confirm what landed. A change applies to the next omp session; a running TUI
keeps the model it started with.

Nothing leaves the machine: the plugin drives the `omp` binary that is already
installed and needs no account or API key.

## For agents

The bundled skill documents the role vocabulary in both groups — chat roles
(`default`, `smol`, `slow`, `plan`, `task`, `vision`, `commit`, `tiny`, `memory`,
`advisor`) and model-kind roles (`image`, `web`, `speech`, `dictation`, `judge`)
— plus the selector grammar and the two rules that keep a rewrite from
destroying existing assignments.