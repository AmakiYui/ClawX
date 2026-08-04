---
id: provider-model-metadata-preservation
title: Provider Model Metadata Preservation
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

When ClawX rewrites an explicit `models.providers.*` entry, existing model rows
must be merged by exact model ID instead of reconstructed from only `id` and
`name`.

All fields on an existing matching row are user/runtime-owned metadata and must
survive provider save, update, default-switch, and reload flows unless a task
explicitly owns that field.

New model IDs may receive deterministic capability defaults, but metadata from a
different model ID must never be copied onto them.

Custom-provider model rows (`models.providers.custom-*`) must carry an explicit
`contextWindow`: new rows receive a deterministic model-family default, and
existing rows missing both `contextWindow` and `contextTokens` may be
backfilled with that default. Rows that already declare either field are
user-owned and must never be modified, and non-`custom-` provider entries are
never backfilled.

Custom-provider primary model rows receive `reasoning: true` and the fixed
effort ladder `compat.supportedReasoningEfforts: ["low","medium","high","xhigh"]`
so Chat can offer session thinking controls. Provider settings must not expose
enable-reasoning controls, and model-name inference must not invent a different
effort list. Sync must preserve unrelated compat keys while writing this ladder.
