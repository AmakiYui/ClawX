---
id: chat-session-reasoning-effort
title: Add a session-scoped reasoning effort picker to Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let users select the current OpenClaw session thinking level from the existing Chat model control without duplicating provider capability rules in ClawX.
touchedAreas:
  - harness/specs/tasks/chat-session-reasoning-effort.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - electron/shared/providers/model-capabilities.ts
  - electron/shared/providers/types.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/services/acp-chat-service.ts
  - electron/utils/openclaw-auth.ts
  - shared/acp-chat/types.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - src/components/settings/ProvidersSettings.tsx
  - src/lib/providers.ts
  - src/stores/acp-chat-session.ts
  - src/stores/chat.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/providers.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/session-catalog.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-service-stale-cleanup.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The Chat model button shows the effective reasoning effort for the current session.
  - The model menu directly offers the advertised members of the Off, Low, Medium, and High product ladder.
  - A new local draft can use the current agent's Gateway-advertised session defaults before its first prompt creates a persisted session row.
  - Reasoning effort opens in a compact dedicated submenu without a separate Thinking toggle.
  - Selecting Off, Low, Medium, or High persists that explicit current-session override through Gateway sessions.patch.
  - Each ACP prompt carries the same explicit reasoning effort selected for its current session instead of falling back to a different prompt-level effort.
  - A message cannot be sent while an effort change is still being applied.
  - A provider-side aborted prompt that was not cancelled by the user surfaces a localized retryable error instead of ending silently.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - acp-chat-state-and-history
  - provider-model-metadata-preservation
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/session-catalog.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-service-stale-cleanup.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Renderer uses the typed host-api Gateway RPC boundary and never opens its own Gateway transport.
  - thinkingLevels, thinkingDefault, and thinkingLevel remain Gateway-owned session metadata.
  - A local draft falls back only to agent-scoped sessions.list defaults, and a persisted session row always takes precedence.
  - Custom-provider primary models are synced with a fixed OpenClaw reasoning ladder; provider settings do not expose enable-reasoning controls.
  - Explicit off is distinct from a cleared override.
  - The reasoning-effort submenu stays narrower than the parent model menu while preserving readable wrapped guidance.
  - An explicit user-selected session level is forwarded unchanged in ACP prompt metadata; an inherited session adds no prompt-level override.
  - Failed patches restore the prior session state and leave the message available to send.
  - New labels are localized in English, Chinese, Japanese, and Russian.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: true
---

## Scope

- Project Gateway session thinking metadata into the Chat session catalog.
- Add a combined model and reasoning-effort picker to the composer.
- Persist current-session overrides with `sessions.patch`.
- Forward the explicit current-session selection through ACP prompt metadata so prompt execution uses that exact level.

## Out Of Scope

- Adding an independently selectable per-message or per-agent thinking default.
- Maintaining a model/provider capability table in ClawX.
- Changing OpenClaw reasoning semantics.
