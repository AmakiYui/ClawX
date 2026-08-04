---
id: custom-provider-reasoning-levels
title: Let users configure custom-provider reasoning levels
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep custom-provider reasoning disabled by default and let users explicitly enable it and declare the primary model's supported thinking levels.
touchedAreas:
  - harness/specs/tasks/custom-provider-reasoning-levels.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - harness/specs/tasks/chat-session-reasoning-effort.md
  - shared/host-api/contract.ts
  - shared/chat/types.ts
  - electron/shared/providers/model-capabilities.ts
  - electron/shared/providers/types.ts
  - electron/services/providers/provider-service.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/utils/openclaw-auth.ts
  - src/components/settings/ProvidersSettings.tsx
  - src/lib/providers.ts
  - src/pages/Chat/ChatInput.tsx
  - src/stores/providers.ts
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/chat-input.test.tsx
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-service-stale-cleanup.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A new custom provider has reasoning disabled until the user enables it.
  - Enabling reasoning allows the user to select Low, Medium, High, and Extra High for the primary model.
  - Saving updates the primary OpenClaw model row and preserves unrelated model metadata.
  - Disabling reasoning clears the explicit effort list and prevents Chat from advertising unsupported inferred levels.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - provider-model-metadata-preservation
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-service-stale-cleanup.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Renderer persists the explicit custom-provider capability through the typed host-api provider boundary.
  - Custom model rows default to reasoning false and never infer a concrete effort list from the model id.
  - Enabled rows store only user-selected supportedReasoningEfforts values.
  - Disabled rows store reasoning false and remove supportedReasoningEfforts without deleting unrelated compat keys.
  - Provider snapshots project the primary row's explicit capability back to the settings form.
  - Chat continues to render only Gateway-owned thinkingLevels.
  - New labels are localized in English, Chinese, Japanese, and Russian.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: true
---

## Scope

- Add explicit primary-model reasoning controls to custom-provider settings.
- Persist and reload the selected capability through OpenClaw model metadata.
- Keep the Chat session picker Gateway-owned.

## Out Of Scope

- Automatically probing provider APIs.
- Configuring fallback-model effort lists.
- Inferring supported effort levels from model names.
