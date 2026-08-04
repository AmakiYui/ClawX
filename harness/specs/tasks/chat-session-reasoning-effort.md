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
  - electron/utils/openclaw-auth.ts
  - shared/chat/types.ts
  - src/stores/chat.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat/session-catalog.ts
  - src/pages/Chat/ChatInput.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/session-catalog.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The Chat model button shows the effective reasoning effort for the current session.
  - The model menu offers only the thinking levels advertised by OpenClaw for the resolved model.
  - Reasoning effort opens in a dedicated submenu with a current-session Thinking toggle.
  - Selecting a level persists an explicit current-session override through Gateway sessions.patch.
  - Disabling Thinking patches the explicit off level; enabling it restores the prior selection or runtime default.
  - A message cannot be sent while an effort change is still being applied.
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
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - Renderer uses the typed host-api Gateway RPC boundary and never opens its own Gateway transport.
  - thinkingLevels, thinkingDefault, and thinkingLevel remain Gateway-owned session metadata.
  - Custom-provider reasoning levels come only from explicit user-owned OpenClaw capability metadata.
  - Explicit off is distinct from a cleared override.
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

## Out Of Scope

- Adding per-message or per-agent thinking defaults.
- Maintaining a model/provider capability table in ClawX.
- Changing ACP prompt payloads or OpenClaw reasoning semantics.
