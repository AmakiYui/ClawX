# ACP Cron Live Overlay

Status: approved architecture contract, reviewed 2026-08-05.

Related scenarios: `gateway-backend-communication`, `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `acp-compatibility-content-safety`, `renderer-main-boundary`, `host-api-fallback-policy`, `host-events-fallback-policy`, `ui-i18n-design-tokens`

Related task: `render-cron-run-live-status`

## Authority And Purpose

ACP `session/load` replay remains the primary authority for historical Chat content. When ACP replay for a cron session is empty, the existing typed cron-history fallback remains the only approved historical projection. Gateway runtime events are neither history nor ACP evidence for reconstructing history.

ClawX may expose current progress for an autonomous cron run through one narrow exception: a bounded, Main-owned, running-only overlay composed beside the ACP timeline. It exists only to bridge the upstream period in which autonomous cron activity emits useful Gateway runtime events but does not arrive as complete live ACP updates.

The normative flow is:

```text
Gateway runtime event -> Main bounded cron broker -> explicit live overlay
terminal event -> overlay removal -> authoritative ACP/cron-history reload
```

The overlay is non-historical, memory-only, run-scoped, read-only, and excluded from sidebar unread/busy authority. It is not an `AcpTimelineSnapshot` supplement and cannot survive a terminal event, Gateway reset, broker eviction, process exit, or application restart.

## Admission And Identity

Main accepts only strict run-scoped cron keys shaped as `agent:<agentId>:cron:<jobId>:run:<runSessionId>`, with every identity segment non-empty after trimming. Ordinary sessions, base-only cron keys, channel sessions, malformed suffixes, and heartbeat `:main` events are rejected.

Main is the sole owner of cron key parsing and canonicalization. It maps an admitted run to its exact base cron key for selection while retaining the source run key and run identity. Renderer may select snapshots for the exact current base key, but it must not parse keys, adopt arbitrary runtime sessions, reduce Gateway events, choose transports, or implement protocol fallback.

Every process-item identity is namespaced by `runId`. Repeated `toolCallId`, `itemId`, command names, or approval fallback identities from different runs cannot collide.

## Main Broker Contract

The broker owns runtime-event normalization, type-specific deduplication, reduction, ordering, active snapshots, terminal tombstones, and all memory bounds. It may adopt a valid run mid-flight without observing `run.started`, but a terminal tombstone prevents delayed events from resurrecting a completed run only while that tombstone remains in the bounded FIFO. Gateway reset removals do not create terminal tombstones: the Main binding disables ingestion before clearing, ignores runtime events while disconnected or reconnecting, and re-enables ingestion on `running` so the same identity can be adopted again mid-flight.

The exact bounds are:

- `MAX_ACTIVE_CRON_LIVE_RUNS = 32`
- `MAX_CRON_LIVE_ITEMS_PER_RUN = 128`
- `MAX_CRON_LIVE_ASSISTANT_CHARS = 500_000`
- `MAX_CRON_LIVE_ITEM_DETAIL_CHARS = 100_000`
- `MAX_CRON_LIVE_EVENT_FINGERPRINTS = 256` per run
- `MAX_CRON_LIVE_TERMINAL_TOMBSTONES = 128`

Numeric sequence values are monotonic per run; Main rejects `seq <= lastSeq`. Events without a sequence use bounded, type-specific fingerprints that reject exact repeats while preserving distinct incremental chunks. Structured details are serialized deterministically, tolerate cyclic input, and are truncated before entering the snapshot.

The overlay has only `running` status. Assistant text may be displayed, including bounded snapshot, replacement, and delta convergence. `thinking.delta` content is never retained or displayed; the view model exposes only a boolean that Renderer presents as a localized thinking indicator. Tool, command, patch, and approval items are bounded status rows. Approval rows are read-only and never call ACP permission-response APIs.

Terminal events produce a removal and delete the active snapshot. Renderer applies that removal to its overlay state before starting any authoritative history reload. Terminal content is never retained as a completed overlay. Gateway reset and deterministic capacity eviction also remove snapshots, but do not claim that authoritative history changed.

## Revision And Hydration Safety

Main emits a monotonically increasing broker revision for every upsert, removal, and clear. Every upsert snapshot carries the revision of its emitted change. Snapshot hydration returns the current broker revision even when no active snapshots exist.

Renderer subscribes to the typed change event before requesting the typed snapshot. It applies changes and hydration only when their revision is not older than the current store revision. This ordering prevents a late snapshot response, including an empty response, from replacing newer live events in the subscribe/snapshot revision race. Renderer bounds pending removals and acknowledges each removal by its exact revision so concurrent run completions cannot overwrite one another.

The supported boundary is:

```text
GatewayManager -> Main cron live-run broker -> typed host event / typed host API
Renderer overlay store -> explicit cron overlay component beside ACP timeline
```

No page or component may invoke IPC directly, fetch Gateway HTTP, open a Gateway WebSocket, or switch between transports. Existing raw `chat:runtime-event` forwarding remains unchanged for the legacy runtime graph and image-generation compatibility consumers; broker ingestion is a separate Main listener and must not duplicate raw forwarding.

## ACP And UI Separation

Gateway runtime events must never be converted into `SessionNotification`, `AcpSessionUpdateEnvelope`, `TimelineItem`, or any other synthetic ACP value. `src/lib/acp/reducer.ts`, `src/lib/acp/timeline-types.ts`, and ACP replay semantics remain unchanged. The overlay is rendered as a sibling region and its content never appears inside the ACP timeline DOM.

External cron activity cannot set ACP `sending` or `cancelling`, show Stop, call `cancelAcpSession`, respond to ACP permissions, synthesize a generation, or mutate a retained live prompt. It also cannot create, clear, or reconcile sidebar busy or unread state; Gateway session rows remain the sole sidebar authority.

When a terminal removal identifies a run that was actually rendered for the currently selected base cron session, Renderer keeps that removal pending while an ACP prompt is sending or cancelling, then acknowledges the exact removal and invokes normal `loadAcpSession` exactly once after the ACP lifecycle and existing workspace/load coordination permit it. The resulting ACP replay is authoritative. Only if that replay is empty may the existing typed cron-history fallback populate historical content. A run removed while hidden, an already acknowledged removal, or a removal for `evicted` or `gateway-reset` does not create a delayed reload when the user later returns. Sequence-less and repeated terminal events are suppressed while the corresponding bounded FIFO tombstone is retained, so they cannot duplicate the reload or resurrect the run during that retention window.

The panel and every status label use `react-i18next` with English, Chinese, Japanese, and Russian coverage. Presentation follows `src/styles/globals.css`, including semantic modal/input surfaces, selected-state substitutions, paired light/dark status colors, accessible labels, and reduced-motion behavior. The live panel must be visibly distinct from native ACP cards and the removed legacy Execution Graph.

## Scope And Removal Condition

This exception cannot be generalized to ordinary non-cron messages, channel sessions, heartbeats, historical event replay, or arbitrary Gateway content. It must remain simpler to delete than to expand.

The overlay may be removed only after a distributed OpenClaw package proves through integration tests that loaded ACP sessions receive autonomous cron assistant, thought, and tool updates; generated media arrives as standard ACP content blocks; replay is complete and deduplicated; and external-run lifecycle and cancellation semantics are explicitly exposed. At that point ClawX should remove the broker and overlay rather than retain two live authorities.

## Validation Anchors

Contract validation begins with `tests/unit/harness-specs.test.ts`. Broker identity and reduction are covered by `tests/unit/cron-session-utils.test.ts`, `tests/unit/gateway-event-dispatch.test.ts`, and `tests/unit/cron-live-run-broker.test.ts`. Typed boundaries and revision-safe Renderer state are covered by `tests/unit/host-events.test.ts`, `tests/unit/host-api-facade.test.ts`, `tests/unit/host-services.test.ts`, and `tests/unit/cron-live-run-overlay-store.test.ts`. Presentation and ACP separation are covered by `tests/unit/cron-live-run-overlay.test.tsx`, `tests/unit/chat-acp-page.test.tsx`, and `tests/e2e/cron-run-live-status.spec.ts`.

Communication changes require type checking, lint, Vite build, the focused Electron E2E spec, `pnpm run comms:replay`, `pnpm run comms:compare`, real task-spec validation without `--no-diff`, a task Harness run, and Harness CI.
