---
id: acp-chat-experience
title: ACP Chat Experience
type: user-visible-flow
ownedPaths:
  - shared/acp-chat/**
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - shared/chat/cron-live-run.ts
  - shared/file-preview/**
  - electron/services/acp-chat-service.ts
  - electron/services/acp-session-access-registry.ts
  - electron/services/acp-trace.ts
  - electron/services/attachment-access.ts
  - electron/services/attachment-open-with.ts
  - electron/services/files-api.ts
  - resources/scripts/attachment-open-with.ps1
  - src/lib/acp/**
  - src/lib/file-preview-client.ts
  - src/lib/file-preview-capabilities.ts
  - src/lib/generated-files.ts
  - src/components/file-preview/**
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - tests/unit/acp-*.test.ts
  - tests/unit/acp-*.test.tsx
  - tests/unit/attachment-open-with.test.ts
  - tests/unit/attachment-open-with-native.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - src/stores/cron-live-run-overlay.ts
  - tests/unit/cron-live-run-overlay-store.test.ts
  - tests/unit/cron-live-run-overlay.test.tsx
  - tests/e2e/cron-run-live-status.spec.ts
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    - ACP timeline presentation changes
    - send, cancel, permission, media, or history behavior changes
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - attachment-access-safety
  - diagnostics-trace-safety
  - session-workspace-authority
  - tool-derived-file-safety
  - office-preview-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
---

ACP Chat covers session load, prompt, cancel, permission, replay, timeline reduction, assistant-turn presentation and whole-turn duration, standard ACP attachments, bounded generated-media and OpenClaw MEDIA compatibility, and Chat-specific diagnostics. The user-visible attachment flow includes attachment-scoped preview, system open, selected-application open, reveal actions, and a first-position built-in Preview action for eligible local HTML, with platform discovery limited to macOS and Windows. Authorized local DOCX/PPTX attachments within the Office limit use scoped Preview; remote, legacy, and over-limit Office attachments retain scoped system/external-open behavior. User-selected directories remain system-open-only targets: Main may open the directory after session-scoped revalidation, but directory contents are not read, enumerated, previewed, or exposed to Open With.

Main owns ACP transport, routing, transcript retrieval and timing extraction, workspace grants, and session/generation-scoped attachment authorization. Renderer owns the in-memory timeline, bounded compatibility and timing alignment, attachment presentation, and display grouping, including user-image thumbnails and user-selected source-path labels. ACP replay remains authoritative for historical turns and content; transcript-derived timing may only annotate an unambiguously matched ACP turn. Standard ACP content remains preferred over compatibility projections, and incidental tool paths never enter the attachment pipeline.

An externally triggered cron run may appear only as the separate, bounded, running-only overlay documented in `harness/reference/acp-cron-live-overlay.md`. Gateway runtime events never become ACP notifications or timeline items. The overlay is read-only and cannot own ACP sending, cancellation, permissions, replay, history, or sidebar attention; terminal content becomes visible only through an authoritative ACP or typed cron-history reload after overlay removal.

The durable architecture, exceptions, access boundary, file-activity separation, Office preview behavior, cron live-overlay boundary, and validation anchors are documented in `harness/reference/acp-chat.md`, `harness/reference/acp-generated-media-and-diagnostics.md`, `harness/reference/acp-attachment-access-control.md`, `harness/reference/openclaw-file-activity.md`, `harness/reference/office-document-preview.md`, and `harness/reference/acp-cron-live-overlay.md`.
