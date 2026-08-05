---
id: render-cron-run-live-status
title: Render a bounded live overlay for cron-triggered runs
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Show transient progress for an externally triggered cron run without converting Gateway runtime events into ACP notifications, timeline items, history, prompt state, or sidebar attention state.
touchedAreas:
  - harness/specs/tasks/render-cron-run-live-status.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/reference/acp-cron-live-overlay.md
  - harness/reference/acp-chat.md
  - docs/plans/2026-08-04-cron-live-run-overlay.md
  - tests/unit/harness-specs.test.ts
  - shared/chat/cron-session.ts
  - shared/chat/cron-live-run.ts
  - shared/host-events/contract.ts
  - shared/host-api/contract.ts
  - electron/services/cron-api.ts
  - electron/services/cron-live-run-broker.ts
  - electron/gateway/chat-runtime-events.ts
  - electron/main/ipc-handlers.ts
  - electron/main/index.ts
  - src/lib/host-events.ts
  - src/lib/host-api.ts
  - src/stores/chat/cron-session-utils.ts
  - src/stores/acp-chat-session.ts
  - src/stores/chat.ts
  - src/stores/gateway.ts
  - src/stores/session-attention.ts
  - src/stores/chat/history-actions.ts
  - src/stores/chat/session-selection.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/chat/session-key-utils.ts
  - src/stores/cron-live-run-overlay.ts
  - src/pages/Chat/CronLiveRunOverlay.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/cron-session-utils.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/cron-live-run-broker.test.ts
  - tests/unit/cron-schedule.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/cron-live-run-overlay-store.test.ts
  - tests/unit/cron-live-run-overlay.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/cron-run-live-status.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - While the user views a cron session, each active run for that exact base cron key appears in a clearly labeled, read-only live overlay next to, but never inside, the authoritative ACP timeline.
  - The overlay may show assistant text and bounded process status, but thinking exposes only a localized activity indicator and never raw thought text.
  - A terminal event removes the transient overlay and reloads authoritative ACP replay or the existing typed cron-history fallback exactly once when that run was visible.
  - External cron activity never enters ACP sending or cancelling state, exposes ACP Stop or permission controls, or sets sidebar busy or unread authority.
  - Ordinary sessions, base-only cron events, channel sessions, and heartbeat :main events never enter the overlay.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm exec vitest run tests/unit/cron-session-utils.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/cron-live-run-broker.test.ts tests/unit/cron-live-run-overlay-store.test.ts tests/unit/cron-live-run-overlay.test.tsx tests/unit/cron-schedule.test.ts
  - pnpm exec vitest run tests/unit/host-events.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/acp-chat-store.test.ts tests/unit/acp-image-generation-compat.test.ts tests/unit/gateway-events.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/cron-run-live-status.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/render-cron-run-live-status.md
  - pnpm harness run --spec harness/specs/tasks/render-cron-run-live-status.md
  - pnpm run harness:ci
acceptance:
  - Only strict run-scoped cron keys shaped as agent:<agentId>:cron:<jobId>:run:<runSessionId> enter the Main-owned broker; Main alone canonicalizes identity, deduplicates events, applies memory bounds, and publishes revisioned snapshots.
  - Main enforces exactly 32 active runs, 128 items per run, 500000 assistant characters, 100000 characters per item detail, 256 sequence-less event fingerprints per run, and 128 terminal tombstones.
  - Gateway runtime events remain outside SessionNotification, AcpSessionUpdateEnvelope, TimelineItem, AcpTimelineSnapshot, and every persisted or reconstructed history path.
  - The overlay is non-historical, memory-only, run-scoped, running-only, read-only, and excluded from ACP prompt state and sidebar unread or busy authority; raw thinking text is neither retained nor rendered.
  - Renderer subscribes through typed host-events before hydrating through host-api, rejects snapshots and changes older than its current broker revision, and never implements Gateway reduction or protocol fallback.
  - Terminal removal precedes exactly one authoritative ACP reload for a run that was rendered in the currently selected base cron session; hidden, evicted, gateway-reset, or previously acknowledged removals never cause a delayed reload, and terminal content is never retained as overlay history.
  - This exception is prohibited for ordinary non-cron messages, base-only cron events, channel sessions, heartbeat sessions, historical event replay, and arbitrary Gateway content.
  - Existing raw chat:runtime-event forwarding and ACP replay, cancellation, permission, compatibility-media, and cron-history behavior remain unchanged.
  - All overlay display text is translated in English, Chinese, Japanese, and Russian and uses the semantic design tokens in src/styles/globals.css.
  - The broker and overlay may be removed only after a distributed OpenClaw package proves through integration tests that loaded ACP sessions receive autonomous cron assistant, thought, and tool updates; generated media arrives as standard ACP content blocks; replay is complete and deduplicated; and external-run lifecycle and cancellation semantics are explicitly exposed.
  - Focused unit, type, lint, build, Electron E2E, communication replay/compare, Harness task, Harness CI, and synchronized README documentation checks pass.
docs:
  required: true
---

## Architecture Contract

The only approved live cron assistant/process-progress exception is the bounded overlay documented in `harness/reference/acp-cron-live-overlay.md`:

```text
Gateway runtime event -> Main bounded cron broker -> explicit live overlay
terminal event -> overlay removal -> authoritative ACP/cron-history reload
```

The overlay is a transient view model, not an ACP compatibility event or historical projection. The primary ACP timeline, existing typed cron-history fallback, external-run controls, and sidebar attention authority remain separate.

Main bounds the broker to 32 active runs, 128 items per run, 500000 assistant characters, 100000 characters per item detail, 256 sequence-less fingerprints per run, and 128 terminal tombstones. Renderer subscribes before snapshot hydration and rejects older revisions. Raw thinking text is never retained or rendered. Only terminal removal for a run rendered in the currently selected base cron session causes one authoritative `loadAcpSession`; all other removals are acknowledged without a delayed reload.

This narrow exception must not be extended to ordinary non-cron traffic. It can be deleted only when a distributed OpenClaw package proves all four upstream capabilities through integration tests: autonomous cron assistant/thought/tool updates reach loaded ACP sessions, generated media uses standard ACP content blocks, replay is complete and deduplicated, and external-run lifecycle/cancellation semantics are explicit.

## Out Of Scope

- Converting Gateway runtime events into ACP notifications, tools, permissions, messages, or timeline items.
- Restoring the legacy Execution Graph in ACP Chat.
- Making externally triggered cron runs ACP-cancellable or permission-interactive.
- Extending the overlay exception to ordinary, channel, heartbeat, or base-only cron session events.
