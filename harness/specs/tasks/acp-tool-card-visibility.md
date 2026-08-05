---
id: acp-tool-card-visibility
title: Hide live ACP tool activity and collapse completed turns
scenario: acp-chat-experience
taskType: renderer-ui
intent: Keep tool execution out of the live conversation display, then reveal every tool collapsed after the assistant response settles.
touchedAreas:
  - harness/specs/tasks/acp-tool-card-visibility.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/reference/acp-chat.md
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/AcpToolCallCard.tsx
  - src/pages/Chat/AcpToolCallsGroup.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Tool UI belonging to a live assistant turn is not shown while that turn is running.
  - When the assistant response settles, consecutive tool calls appear as a collapsed group and a single tool appears with collapsed details.
  - Users can expand completed tool groups or individual cards after they appear.
  - Historical completed tools remain collapsed by default.
  - Tool events without live whole-turn timing retain the existing standalone rendering fallback.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - electron-rendering-performance
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-components.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/acp-tool-card-visibility.md
  - pnpm harness run --spec harness/specs/tasks/acp-tool-card-visibility.md
acceptance:
  - Live visibility is derived from the existing running whole-turn timing for the owning user message; no transport, reducer, or persisted history state is added.
  - Hiding live tool UI does not remove, reorder, or delay its timeline item, output, attachment extraction, or file-activity projection.
  - A settled live turn mounts consecutive tool calls as one collapsed group and mounts a single tool with collapsed details immediately.
  - Manual expansion affects only the selected completed group or card.
  - Historical completed tools preserve their existing collapsed-first behavior.
  - Focused unit, Electron E2E, typecheck, lint, Vite build, harness validation, and synchronized README checks pass.
docs:
  required: true
---

## Scope

This task changes only ACP Chat presentation. The existing live whole-turn timing determines whether a turn is still running; the flat timeline remains authoritative and continues to reduce every tool update immediately.

## Out Of Scope

- Hiding permission prompts, thoughts, plans, attachments, or file-activity controls.
- Changing ACP transport, event reduction, tool status, or history replay.
- Adding a global user preference for tool visibility.
