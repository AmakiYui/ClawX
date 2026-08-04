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

Custom-provider reasoning is explicit user-owned metadata and defaults to
`reasoning: false`; model-name inference must not enable it or create
`compat.supportedReasoningEfforts`. When the user enables reasoning, only the
selected primary-model effort IDs may be written. Disabling reasoning removes
`supportedReasoningEfforts` while preserving unrelated compat keys. Provider
sync and backfill must preserve this explicit state.
