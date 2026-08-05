# Cron Live Run Overlay Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render live cron-run progress in ACP Chat without converting Gateway runtime events into ACP notifications or persisting them in the ACP timeline.

**Architecture:** Electron Main owns a bounded, memory-only cron live-run broker. It canonicalizes run-scoped cron keys, deduplicates and reduces Gateway runtime events into an explicit non-ACP overlay snapshot, publishes typed host events, and serves a race-safe snapshot for late subscribers. Renderer keeps that overlay separate from `AcpTimelineSnapshot`; when a visible run terminates, it removes the overlay and reloads the authoritative ACP/cron history exactly once.

**Tech Stack:** Electron Main, TypeScript, Zustand, React 19, typed host-api/host-events, Vitest, Playwright, react-i18next, Harness communication specs.

## Global Constraints

- Gateway runtime events must never be converted into `SessionNotification`, `AcpSessionUpdateEnvelope`, or `TimelineItem` objects.
- `src/lib/acp/reducer.ts`, `src/lib/acp/timeline-types.ts`, and ACP replay semantics remain unchanged.
- ACP `sending`, `cancelling`, Stop behavior, and `cancelAcpSession` remain owned exclusively by ACP prompts initiated by ClawX.
- The overlay accepts only strict run-scoped cron keys shaped as `agent:<agentId>:cron:<jobId>:run:<runSessionId>`; ordinary sessions, base-only cron keys, channel sessions, and heartbeat `:main` events are rejected.
- Main is the sole owner of cron key canonicalization, runtime-event deduplication, memory bounds, and active-run snapshots. Renderer must not reimplement protocol switching or Gateway event reduction.
- Keep raw `chat:runtime-event` forwarding unchanged for the existing legacy runtime graph and image-generation compatibility consumers.
- Display assistant text, but do not display raw `thinking.delta` text. The overlay exposes only a localized running/thinking indicator.
- Runtime approval events are read-only status rows. They must not call ACP permission response APIs.
- A terminal overlay is never treated as history. Completed content appears only after normal `loadAcpSession` replay or the existing typed cron-history fallback.
- Use these exact broker bounds:
  - `MAX_ACTIVE_CRON_LIVE_RUNS = 32`
  - `MAX_CRON_LIVE_ITEMS_PER_RUN = 128`
  - `MAX_CRON_LIVE_ASSISTANT_CHARS = 500_000`
  - `MAX_CRON_LIVE_ITEM_DETAIL_CHARS = 100_000`
  - `MAX_CRON_LIVE_EVENT_FINGERPRINTS = 256` per run
  - `MAX_CRON_LIVE_TERMINAL_TOMBSTONES = 128`
- Numeric sequence values are monotonic per run: reject `seq <= lastSeq`. Sequence-less events use bounded type-specific fingerprints; reject exact repeats but retain distinct incremental chunks.
- Namespace every process item identity by `runId` so repeated `toolCallId`, `itemId`, command names, or approval fallbacks cannot collide across runs.
- Main emits a monotonically increasing broker `revision`. Renderer subscribes before fetching the snapshot and ignores snapshots or changes older than its current revision.
- All new display text must be translated in `en`, `zh`, `ja`, and `ru` and use existing design tokens from `src/styles/globals.css`.
- Update the checked-in task spec before implementation. Because this changes backend communication, run Harness validation, communication replay/compare, and Electron E2E before completion.
- Do not commit unless the user explicitly requests it. Each task lists a commit point only for a later explicitly requested commit workflow.

---

### Task 1: Update the architecture contract before code

**Files:**
- Modify: `harness/specs/tasks/render-cron-run-live-status.md`
- Modify: `harness/specs/scenarios/gateway-backend-communication.md`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/specs/rules/acp-compatibility-content-safety.md`
- Create: `harness/reference/acp-cron-live-overlay.md`
- Test: `tests/unit/harness-specs.test.ts`

**Interfaces:**
- Consumes: Existing `gateway-backend-communication` and `acp-chat-experience` scenario contracts.
- Produces: A durable rule that permits one bounded, running-only Gateway overlay while preserving ACP replay as the sole history authority.

- [ ] **Step 1: Write the failing Harness assertion**

  Extend `tests/unit/harness-specs.test.ts` to require `render-cron-run-live-status` to declare `fast`, `comms`, and `e2e`; reference `acp-cron-live-overlay.md`; require ACP authority, compatibility safety, renderer/Main boundary, host-api/host-events, i18n/design-token, communication regression, and docs-sync rules.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run `pnpm exec vitest run tests/unit/harness-specs.test.ts`. Expect failure because the current task spec still describes the legacy Execution Graph and omits the overlay reference and E2E profile.

- [ ] **Step 3: Rewrite the task and reference contract**

  Change the expected behavior from “Gateway events become ACP/tool timeline updates” to:

  ```text
  Gateway runtime event -> Main bounded cron broker -> explicit live overlay
  terminal event -> overlay removal -> authoritative ACP/cron-history reload
  ```

  State explicitly that the overlay is non-historical, memory-only, run-scoped, read-only, and excluded from sidebar unread/busy authority. Set `docs.required: true`, list all touched areas from this plan, and include the focused/unit/E2E/comms commands used below.

- [ ] **Step 4: Validate the real task spec**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/harness-specs.test.ts
  pnpm harness validate --spec harness/specs/tasks/render-cron-run-live-status.md
  pnpm harness run --spec harness/specs/tasks/render-cron-run-live-status.md --dry-run
  ```

  Expect all structural validation to pass without `--no-diff`.

- [ ] **Step 5: Commit point**

  If explicitly requested, commit as `docs: define bounded cron live overlay architecture`.

---

### Task 2: Establish shared cron identity and correct lifecycle normalization

**Files:**
- Create: `shared/chat/cron-session.ts`
- Delete: `src/stores/chat/cron-session-utils.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/stores/gateway.ts`
- Modify: `src/stores/session-attention.ts`
- Modify: `src/stores/chat/history-actions.ts`
- Modify: `src/stores/chat/session-selection.ts`
- Modify: `src/stores/chat/session-catalog.ts`
- Modify: `src/stores/chat/session-key-utils.ts`
- Modify: `electron/services/cron-api.ts`
- Modify: `electron/gateway/chat-runtime-events.ts`
- Test: `tests/unit/cron-session-utils.test.ts`
- Test: `tests/unit/gateway-event-dispatch.test.ts`

**Interfaces:**
- Consumes: Raw OpenClaw `sessionKey`, lifecycle `phase`, and `data.aborted` values.
- Produces: `parseCronSessionKey`, `getCronSessionBaseKey`, `isCronSessionKey`, `isRunScopedCronSessionKey`, and `sessionKeysAreEquivalent` as one shared authority; normalized terminal `ChatRuntimeEvent` values.

- [ ] **Step 1: Write failing identity and terminal tests**

  Update `cron-session-utils.test.ts` to import from `@shared/chat/cron-session` and cover strict base/run parsing, empty or whitespace-only agent/job/run segment rejection, malformed suffix rejection, and run-scoped detection. Replace the current test that treats lifecycle `phase: 'end'` as non-terminal with expectations that:

  ```ts
  { phase: 'end' } -> { type: 'run.ended', status: 'completed' }
  { phase: 'end', aborted: true } -> { type: 'run.ended', status: 'aborted' }
  { phase: 'error' } -> { type: 'run.ended', status: 'error' }
  ```

- [ ] **Step 2: Run tests and verify failures**

  Run `pnpm exec vitest run tests/unit/cron-session-utils.test.ts tests/unit/gateway-event-dispatch.test.ts`. Expect missing shared imports and incorrect `phase: 'end'` normalization.

- [ ] **Step 3: Centralize and tighten key parsing, then update all callers**

  Move the parser into `shared/chat/cron-session.ts`, reject empty or whitespace-only `agentId`, `jobId`, and `runSessionId` segments, require exactly four segments for a base key or exactly six segments with literal `run` for a run key, and add `isRunScopedCronSessionKey`. Migrate all eight Renderer callers listed in the Files section plus Main `cron-api.ts`, delete the duplicate Main parser, and delete the old Renderer-owned utility file. Do not leave a compatibility re-export.

- [ ] **Step 4: Normalize OpenClaw terminal lifecycle correctly**

  In `normalizeGatewayChatRuntimeEvent`, accept `end`, `completed`, `done`, and `finished` as terminal. For `phase: 'end'`, map `data.aborted === true` to `aborted`; otherwise map to `completed`. Preserve `endedAt`, `livenessState`, `replayInvalid`, and `stopReason`.

- [ ] **Step 5: Run focused regressions**

  Run:

  ```bash
  pnpm exec vitest run \
    tests/unit/cron-session-utils.test.ts \
    tests/unit/gateway-event-dispatch.test.ts \
    tests/unit/gateway-events.test.ts \
    tests/unit/cron-schedule.test.ts
  ```

  Expect all tests to pass and no imports of `src/stores/chat/cron-session-utils.ts` to remain.

- [ ] **Step 6: Commit point**

  If explicitly requested, commit as `fix: share cron identity and normalize run terminals`.

---

### Task 3: Build the bounded Main-process cron live-run broker

**Files:**
- Create: `shared/chat/cron-live-run.ts`
- Create: `electron/services/cron-live-run-broker.ts`
- Create: `tests/unit/cron-live-run-broker.test.ts`

**Interfaces:**
- Consumes: `ChatRuntimeEvent` and shared cron-session parsing.
- Produces: `CronLiveRunOverlaySnapshot`, `CronLiveRunItem`, `CronLiveRunOverlayChange`, `CronLiveRunOverlaySnapshotSet`, and `CronLiveRunBroker`.

- [ ] **Step 1: Define the explicit non-ACP view model in the test**

  Write broker tests against this discriminated model:

  ```ts
  type CronLiveRunStatus = 'running';

  type CronLiveRunItem =
    | { kind: 'tool'; id: string; toolCallId: string; title: string; status: 'running' | 'completed' | 'failed'; inputText?: string; outputText?: string; error?: string }
    | { kind: 'command'; id: string; title: string; status: 'running' | 'completed' | 'failed'; output: string; exitCode?: number }
    | { kind: 'patch'; id: string; title: string; summary?: string; added?: number; modified?: number; deleted?: number }
    | { kind: 'approval'; id: string; title: string; status: 'running' | 'completed' | 'failed'; message?: string };

  interface CronLiveRunOverlaySnapshot {
    canonicalSessionKey: string;
    sourceSessionKey: string;
    runSessionId: string;
    runId: string;
    revision: number;
    status: CronLiveRunStatus;
    startedAt?: number;
    updatedAt: number;
    lastSeq?: number;
    assistantText: string;
    thinking: boolean;
    items: CronLiveRunItem[];
  }

  interface CronLiveRunOverlaySnapshotSet {
    revision: number;
    snapshots: CronLiveRunOverlaySnapshot[];
  }

  type CronLiveRunOverlayChange =
    | {
        kind: 'upsert';
        revision: number;
        snapshot: CronLiveRunOverlaySnapshot;
      }
    | {
        kind: 'remove';
        revision: number;
        canonicalSessionKey: string;
        sourceSessionKey: string;
        runId: string;
        reason: 'ended' | 'evicted' | 'gateway-reset';
        terminalStatus?: 'completed' | 'error' | 'aborted';
        terminalError?: string;
      };
  ```

  The broker-level `revision` increments once for every emitted change, including removals and clears. Every upsert snapshot carries that same revision. `getSnapshotSet()` returns the current broker revision even when `snapshots` is empty, so Renderer can reject a stale empty/non-empty hydration response deterministically.

- [ ] **Step 2: Write failing broker scenarios**

  Cover strict run-key admission, mid-flight adoption without `run.started`, text snapshot/replace/delta convergence, thinking boolean without retained thought text, tool updates, command output, patch and approval ordering, run-namespaced identities, numeric sequence rejection, sequence-less fingerprint dedupe, deterministic active-run eviction, text/item bounds, terminal removal, terminal tombstone suppression, gateway reset, and monotonic revisions.

- [ ] **Step 3: Run the broker test and verify failure**

  Run `pnpm exec vitest run tests/unit/cron-live-run-broker.test.ts`. Expect module-not-found failures.

- [ ] **Step 4: Implement the minimum reducer and broker**

  Implement one pure `reduceCronLiveRunEvent(snapshot, event)` and one stateful `CronLiveRunBroker`. Use type-specific stable fingerprints instead of generic unbounded serialization. Serialize structured input/output with stable key ordering, catch cycles, and truncate to `MAX_CRON_LIVE_ITEM_DETAIL_CHARS`. Preserve first-occurrence item ordering and update existing items in place.

  On terminal events, emit `remove` before deleting active state, then add a bounded run tombstone so delayed duplicate/non-terminal events cannot recreate the run. `getSnapshotSet()` returns immutable clones sorted by `updatedAt`, then `runId` for deterministic hydration.

- [ ] **Step 5: Run focused tests and static checks**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/cron-live-run-broker.test.ts
  pnpm run typecheck:node
  ```

  Expect broker tests and Node type checking to pass.

- [ ] **Step 6: Commit point**

  If explicitly requested, commit as `feat: add bounded cron live-run broker`.

---

### Task 4: Expose broker snapshots and changes through typed Main boundaries

**Files:**
- Modify: `shared/host-events/contract.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/services/cron-live-run-broker.ts`
- Modify: `electron/services/cron-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/lib/host-events.ts`
- Modify: `src/lib/host-api.ts`
- Test: `tests/unit/cron-live-run-broker.test.ts`
- Test: `tests/unit/cron-schedule.test.ts`
- Test: `tests/unit/host-events.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`
- Test: `tests/unit/host-services.test.ts`

**Interfaces:**
- Consumes: `CronLiveRunBroker` from Task 3 and `GatewayManager` runtime/status/exit events.
- Produces: `hostApi.cron.liveRunOverlays()` and `hostEvents.onCronLiveRunOverlayChanged()`.

- [ ] **Step 1: Write failing host-boundary tests**

  Add expectations for:

  ```ts
  HOST_EVENT_CHANNELS.cron.liveRunOverlayChanged === 'cron:live-run-overlay-changed'
  hostEvents.onCronLiveRunOverlayChanged(handler)
  hostApi.cron.liveRunOverlays()
  ```

  Extend broker tests for a `bindCronLiveRunBroker` helper that is the sole broker-ingestion owner: it listens to GatewayManager `chat:runtime-event`, publishes resulting broker changes, and clears on non-running Gateway status or `exit`. Existing raw runtime forwarding remains a separate listener and must not call `broker.ingestRuntimeEvent`.

- [ ] **Step 2: Run tests and verify missing contracts**

  Run:

  ```bash
  pnpm exec vitest run \
    tests/unit/cron-live-run-broker.test.ts \
    tests/unit/cron-schedule.test.ts \
    tests/unit/host-events.test.ts \
    tests/unit/host-api-facade.test.ts \
    tests/unit/host-services.test.ts
  ```

  Expect failures for the new API/event surface and dependency injection.

- [ ] **Step 3: Add typed contracts and facades**

  Add a static `cron` host-event module with `liveRunOverlayChanged`, and add `cron.liveRunOverlays` to `HostApiContract`. The preload channel allowlist is contract-derived, so do not add a direct IPC allowlist or renderer `window.electron.ipcRenderer.invoke` call.

- [ ] **Step 4: Wire one broker instance in Main**

  Instantiate `CronLiveRunBroker` next to `GatewayManager` in `electron/main/index.ts`, pass it through `registerIpcHandlers` to `createCronApi`, and call `bindCronLiveRunBroker` before Gateway auto-start. The binding publishes changes with `sendMainWindowEvent(HOST_EVENT_CHANNELS.cron.liveRunOverlayChanged, change)` and is the only code that calls `broker.ingestRuntimeEvent`. Keep the existing raw `chat:runtime-event` listener unchanged so legacy and image-generation consumers still receive the original event exactly once.

  `createCronApi({ gatewayManager, cronLiveRunBroker })` must return `liveRunOverlays: () => cronLiveRunBroker.getSnapshotSet()` for late join/reload hydration.

- [ ] **Step 5: Run boundary regressions**

  Run the focused tests from Step 2 plus:

  ```bash
  pnpm run typecheck:node
  pnpm run typecheck:web
  ```

  Expect all tests and both type-check lanes to pass.

- [ ] **Step 6: Commit point**

  If explicitly requested, commit as `feat: expose cron live overlays through host boundaries`.

---

### Task 5: Add the revision-safe Renderer overlay store

**Files:**
- Create: `src/stores/cron-live-run-overlay.ts`
- Create: `tests/unit/cron-live-run-overlay-store.test.ts`
- Modify: `tests/unit/host-events.test.ts`

**Interfaces:**
- Consumes: `hostApi.cron.liveRunOverlays()` and `hostEvents.onCronLiveRunOverlayChanged()`.
- Produces: `useCronLiveRunOverlayStore`, `ensureCronLiveRunOverlaySubscriptions`, `selectCronLiveRunsForSession`, and terminal-removal acknowledgement state.

- [ ] **Step 1: Write failing store tests**

  Mock host-api and host-events and cover:

  - subscribe-before-snapshot ordering;
  - ignoring an older snapshot after a newer change;
  - upsert by `canonicalSessionKey + runId`;
  - remove without retaining content as history;
  - bounded pending removals keyed by `canonicalSessionKey + runId + revision` so bursts cannot overwrite one another;
  - explicit `acknowledgeRemoval(revision)` that removes only the acknowledged change;
  - a burst where visible run A and inactive run B terminate before React processes either event;
  - selection by exact base cron key only;
  - gateway-reset and eviction removals never marked as terminal refreshes.

- [ ] **Step 2: Run and verify module-not-found failure**

  Run `pnpm exec vitest run tests/unit/cron-live-run-overlay-store.test.ts`.

- [ ] **Step 3: Implement the store**

  Keep only normalized snapshots and at most 128 pending removal changes ordered by revision. Key removals by `canonicalSessionKey + runId + revision`; never overwrite another run's terminal signal. Do not import ACP reducer/timeline modules or `ChatRuntimeEvent`. `ensureCronLiveRunOverlaySubscriptions` must be idempotent, register the event listener first, then request the Main snapshot, and compare revisions before applying either source.

- [ ] **Step 4: Run focused tests and Web type checking**

  Run:

  ```bash
  pnpm exec vitest run \
    tests/unit/cron-live-run-overlay-store.test.ts \
    tests/unit/host-events.test.ts
  pnpm run typecheck:web
  ```

  Expect all tests to pass with no ACP imports in the new store.

- [ ] **Step 5: Commit point**

  If explicitly requested, commit as `feat: add cron live overlay renderer store`.

---

### Task 6: Build the explicit, read-only live overlay UI

**Files:**
- Create: `src/pages/Chat/CronLiveRunOverlay.tsx`
- Create: `tests/unit/cron-live-run-overlay.test.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

**Interfaces:**
- Consumes: One `CronLiveRunOverlaySnapshot`.
- Produces: A clearly labeled transient panel with `data-testid="cron-live-run-overlay"` and item-specific test IDs.

- [ ] **Step 1: Write failing component tests**

  Cover the localized “Live scheduled run” header, running pulse, assistant Markdown, thinking indicator without raw thought text, tool status progression, whitespace-preserving command output, patch counts, read-only approval status, and distinct test IDs (`cron-live-tool`, `cron-live-command`, `cron-live-patch`, `cron-live-approval`).

- [ ] **Step 2: Run and verify failure**

  Run `pnpm exec vitest run tests/unit/cron-live-run-overlay.test.tsx`.

- [ ] **Step 3: Implement the presentation component**

  Reuse `AcpRenderPart` only as a Markdown renderer for assistant text; do not create ACP message/tool items. Implement dedicated cron item rows so they cannot be mistaken for native ACP cards or interactive ACP permissions. Use `bg-surface-modal`, `bg-surface-input`, selected/status token substitutions, and `text-X-700 dark:text-X-400` status colors from `globals.css`.

- [ ] **Step 4: Add complete locale coverage and regressions**

  Add labels for the panel, running/thinking, tool/command/patch/approval status, completion/failure wording, and read-only approval explanation in all four locale files. Run:

  ```bash
  pnpm exec vitest run tests/unit/cron-live-run-overlay.test.tsx
  pnpm run typecheck:web
  pnpm run lint:check
  ```

  Expect the component test, type check, and lint check to pass.

- [ ] **Step 5: Commit point**

  If explicitly requested, commit as `feat: render transient cron run progress`.

---

### Task 7: Compose the overlay with ACP Chat and refresh authoritative history

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `tests/unit/chat-acp-page.test.tsx`
- Modify: `tests/unit/cron-live-run-overlay-store.test.ts`

**Interfaces:**
- Consumes: Current base session key, overlay snapshots/removal markers, ACP `loadSession`, and workspace context.
- Produces: ACP timeline plus separate live panels; one authoritative reload for a visible terminal run.

- [ ] **Step 1: Write failing page integration tests**

  Cover:

  - overlay replaces `AcpEmptyState` while history is empty;
  - ACP timeline and overlay coexist as sibling DOM regions;
  - overlay content never appears under `data-testid="acp-chat-timeline"`;
  - another cron job or ordinary session does not render the overlay;
  - multiple active snapshots render in deterministic order;
  - switching away hides the overlay and switching back restores the Main snapshot;
  - external cron activity does not set `ChatInput.sending`, show ACP Stop, or call `cancelAcpSession`;
  - a terminal `remove` for a run that was visible triggers exactly one `loadAcpSession`;
  - a burst of removals for two runs preserves and acknowledges both revisions while refreshing only runs visible in the current session;
  - terminal removal while another session is selected does not trigger a delayed duplicate reload when returning later;
  - `evicted` and `gateway-reset` removals do not trigger authoritative reloads.

- [ ] **Step 2: Run and verify integration failures**

  Run:

  ```bash
  pnpm exec vitest run \
    tests/unit/chat-acp-page.test.tsx \
    tests/unit/cron-live-run-overlay-store.test.ts
  ```

- [ ] **Step 3: Integrate subscriptions and rendering**

  Initialize the overlay subscription alongside `ensureAcpChatSubscriptions`. Select snapshots for `currentSessionKey`, render them after the authoritative `AcpTimeline`, and suppress `AcpEmptyState` while at least one overlay is visible. Include overlay presence in scroll-to-latest calculations.

- [ ] **Step 4: Implement visible-run terminal refresh**

  Track run IDs actually rendered for the current session in a ref that resets on session switch. Process pending removals in revision order. When an unacknowledged removal has `reason: 'ended'`, matches the current base session, and its run ID was rendered there, acknowledge that exact revision and call normal `loadAcpSession({ sessionKey, workspaceRoot: cwd, cwd })` once. Acknowledge non-visible/stale removals without reload. Do not collapse multiple removals into one marker, call legacy `loadHistory`, mutate the ACP snapshot, or synthesize a generation.

- [ ] **Step 5: Run focused UI and state regressions**

  Run:

  ```bash
  pnpm exec vitest run \
    tests/unit/chat-acp-page.test.tsx \
    tests/unit/cron-live-run-overlay.test.tsx \
    tests/unit/cron-live-run-overlay-store.test.ts \
    tests/unit/acp-chat-store.test.ts \
    tests/unit/gateway-events.test.ts
  pnpm run typecheck
  ```

  Expect all existing ACP prompt, image-generation, cancellation, and runtime retention tests to remain green.

- [ ] **Step 6: Commit point**

  If explicitly requested, commit as `feat: compose cron live overlay with ACP Chat`.

---

### Task 8: Replace synthetic-ACP E2E coverage, update docs, and run communication proof

**Files:**
- Modify: `tests/e2e/cron-run-live-status.spec.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `harness/specs/tasks/render-cron-run-live-status.md`
- Modify: `harness/reference/acp-cron-live-overlay.md`
- Modify: `harness/reference/acp-chat.md`

**Interfaces:**
- Consumes: The completed Main broker, typed host event, snapshot API, Renderer store, and overlay UI.
- Produces: User-visible regression proof and synchronized architecture documentation.

- [ ] **Step 1: Rewrite E2E helpers and expectations**

  Remove fake `chat:acp-session-update` tool calls from the live cron scenarios. Add a helper that emits typed `cron:live-run-overlay-changed` upsert/remove changes and mock `cron.liveRunOverlays` for late join. Main broker reduction is covered by `cron-live-run-broker.test.ts`; E2E covers the real preload/host-event/Renderer/UI contract.

  Verify assistant text, thinking status, tool, command, patch, and approval rows; no legacy execution graph; no runtime content inside ACP timeline; no invalid Stop state; hide/restore across session switches; mid-flight overlay hydration; terminal removal; and one authoritative `loadAcpSession` invocation.

- [ ] **Step 2: Run the focused Electron E2E**

  Run:

  ```bash
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/cron-run-live-status.spec.ts
  ```

  Expect the spec to pass on the local platform.

- [ ] **Step 3: Update user and architecture documentation**

  In all three required READMEs, state that running cron progress is a transient Gateway-backed overlay, completed conversation content remains ACP/cron-history authoritative, and external cron activity does not become an ACP-cancellable prompt. Keep the explanation concise and localized.

  Update Harness references to document the exact bounds, revision race handling, no-CoT rule, terminal reload semantics, OpenClaw upgrade removal condition, and the prohibition against extending this exception to ordinary non-cron messages.

- [ ] **Step 4: Run the focused and project-wide safe validation suite**

  Run:

  ```bash
  pnpm exec vitest run \
    tests/unit/harness-specs.test.ts \
    tests/unit/cron-session-utils.test.ts \
    tests/unit/gateway-event-dispatch.test.ts \
    tests/unit/cron-live-run-broker.test.ts \
    tests/unit/cron-live-run-overlay-store.test.ts \
    tests/unit/cron-live-run-overlay.test.tsx \
    tests/unit/cron-schedule.test.ts \
    tests/unit/host-events.test.ts \
    tests/unit/host-api-facade.test.ts \
    tests/unit/host-services.test.ts \
    tests/unit/chat-acp-page.test.tsx \
    tests/unit/acp-chat-store.test.ts \
    tests/unit/acp-image-generation-compat.test.ts \
    tests/unit/gateway-events.test.ts
  pnpm run typecheck
  pnpm run lint:check
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/cron-run-live-status.spec.ts
  pnpm run comms:replay
  pnpm run comms:compare
  pnpm harness validate --spec harness/specs/tasks/render-cron-run-live-status.md
  pnpm harness run --spec harness/specs/tasks/render-cron-run-live-status.md
  pnpm run harness:ci
  ```

  Expected result: all focused tests, type checking, lint, build, E2E, communication regression comparison, task Harness run, and Harness CI pass. Re-run `pnpm run lint:check` only after any concurrent uv download has completed if the documented temporary-directory race occurs.

- [ ] **Step 5: Review the removal condition**

  Record in `acp-cron-live-overlay.md` that the overlay can be deleted only after a distributed OpenClaw package proves all of these through integration tests: loaded ACP sessions receive autonomous cron assistant/thought/tool updates, generated media arrives as standard ACP content blocks, replay is complete and deduplicated, and external-run lifecycle/cancel semantics are explicitly exposed.

- [ ] **Step 6: Commit point**

  If explicitly requested, commit as `test: cover authoritative cron live overlay flow`.

---

## Final Self-Review Checklist

- [ ] No Gateway runtime event is converted to an ACP update or inserted into `AcpTimelineSnapshot`.
- [ ] Main owns strict cron identity, event reduction, deduplication, bounds, snapshots, and revisions.
- [ ] Sequence-less and repeated terminal events cannot duplicate or resurrect runs.
- [ ] Renderer shows only current base-cron overlays and never raw chain-of-thought.
- [ ] ACP prompt sending, Stop, cancellation, permission response, replay, and image compatibility behavior remain unchanged.
- [ ] Terminal refresh occurs once only for a run that was visible in the currently selected session.
- [ ] E2E no longer claims live behavior by injecting synthetic ACP tool notifications.
- [ ] Harness specs and all required README translations describe the same authority boundary.
- [ ] No placeholders, compatibility re-exports, direct IPC invokes, Gateway HTTP calls, or undocumented protocol fallbacks remain.
