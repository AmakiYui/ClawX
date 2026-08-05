import type { ElectronApplication } from '@playwright/test';
import type {
  CronLiveRunOverlayChange,
  CronLiveRunOverlaySnapshot,
  CronLiveRunOverlaySnapshotSet,
} from '../../shared/chat/cron-live-run';
import {
  closeElectronApp,
  expect,
  getRecordedHostInvocations,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const CRON_BASE_KEY = 'agent:main:cron:job-cron-live';
const CRON_RUN_KEY = `${CRON_BASE_KEY}:run:run-live-1`;
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const EXPECTED_CRON_LOAD_PAYLOAD = {
  sessionKey: CRON_BASE_KEY,
  workspaceRoot: DEFAULT_WORKSPACE,
  cwd: DEFAULT_WORKSPACE,
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function acpLoadMocks(sessionKey: string) {
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
      success: true,
      generation: 1,
    },
    [stableStringify(['chat', 'loadAcpSession', { sessionKey, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: {
      success: true,
      generation: 1,
    },
  };
}

function cronLiveRunSnapshot(
  revision: number,
  overrides: Partial<CronLiveRunOverlaySnapshot> = {},
): CronLiveRunOverlaySnapshot {
  return {
    canonicalSessionKey: CRON_BASE_KEY,
    sourceSessionKey: CRON_RUN_KEY,
    runSessionId: 'run-live-1',
    runId: 'gateway-run-live-1',
    revision,
    status: 'running',
    startedAt: 1_786_000_000_000,
    updatedAt: 1_786_000_001_000,
    assistantText: '',
    thinking: false,
    items: [],
    ...overrides,
  };
}

function cronOverlayMock(snapshotSet: CronLiveRunOverlaySnapshotSet) {
  return {
    [stableStringify(['cron', 'liveRunOverlays', null])]: snapshotSet,
  };
}

async function emitCronLiveRunOverlayChange(
  app: ElectronApplication,
  change: CronLiveRunOverlayChange,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('cron:live-run-overlay-changed', payload);
      }
    },
    change,
  );
}

function countAcpLoads(
  calls: Awaited<ReturnType<typeof getRecordedHostInvocations>>,
  sessionKey: string,
): number {
  return calls.filter((call) => (
    call.module === 'chat'
    && call.action === 'loadAcpSession'
    && call.payload?.sessionKey === sessionKey
  )).length;
}

async function reloadMainWindow(app: ElectronApplication) {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
  return page;
}

function sessionListMock(cronLabel: string) {
  return {
    [stableStringify(['sessions.list', {}])]: {
      success: true,
      result: {
        sessions: [
          { key: MAIN_SESSION_KEY, displayName: 'main' },
          {
            key: CRON_BASE_KEY,
            displayName: cronLabel,
            label: cronLabel,
            updatedAt: Date.now(),
          },
        ],
      },
    },
  };
}

function commonHostMocks(snapshotSet: CronLiveRunOverlaySnapshotSet) {
  return {
    ...acpLoadMocks(MAIN_SESSION_KEY),
    ...acpLoadMocks(CRON_BASE_KEY),
    ...cronOverlayMock(snapshotSet),
    [stableStringify(['/api/gateway/status', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      },
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{
            id: 'main',
            name: 'Main',
            workspace: DEFAULT_WORKSPACE,
            mainSessionKey: MAIN_SESSION_KEY,
          }],
        },
      },
    },
  };
}

test.describe('ClawX cron run live status', () => {
  test('renders typed live progress outside ACP and reloads authoritative history once on terminal removal', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        recordHostInvocations: true,
        failUnmatchedHostApiActions: ['chat.loadAcpSession'],
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: sessionListMock('Cron: Morning brief'),
        hostApi: commonHostMocks({ revision: 0, snapshots: [] }),
      });

      const page = await reloadMainWindow(app);
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      const assistantText = 'Collected **three** authoritative sources.';
      await emitCronLiveRunOverlayChange(app, {
        kind: 'upsert',
        revision: 1,
        snapshot: cronLiveRunSnapshot(1, {
          assistantText,
          thinking: true,
          items: [
            {
              kind: 'tool',
              id: 'gateway-run-live-1:tool:web-search',
              toolCallId: 'web-search',
              title: 'web_search',
              status: 'completed',
              inputText: 'AI news August 2026',
              outputText: 'Three sources found',
            },
            {
              kind: 'command',
              id: 'gateway-run-live-1:command:collect',
              title: 'Collect headlines',
              status: 'running',
              output: 'source one\n  source two',
            },
            {
              kind: 'patch',
              id: 'gateway-run-live-1:patch:brief',
              title: 'Update morning brief',
              summary: 'Prepared the digest',
              added: 3,
              modified: 1,
              deleted: 0,
            },
            {
              kind: 'approval',
              id: 'gateway-run-live-1:approval:publish',
              title: 'Publish digest',
              status: 'running',
              message: 'Waiting for external approval',
            },
          ],
        }),
      });

      const overlay = page.getByTestId('cron-live-run-overlay');
      await expect(overlay).toBeVisible({ timeout: 30_000 });
      await expect(overlay.getByTestId('cron-live-assistant')).toContainText('Collected three authoritative sources.');
      await expect(overlay.getByTestId('cron-live-thinking')).toContainText('Thinking');
      await expect(overlay.getByTestId('cron-live-tool')).toContainText('web_search');
      await expect(overlay.getByTestId('cron-live-command')).toContainText('Collect headlines');
      await expect(overlay.getByTestId('cron-live-command-output')).toHaveText('source one\n  source two');
      await expect(overlay.getByTestId('cron-live-patch')).toContainText('Prepared the digest');
      const approval = overlay.getByTestId('cron-live-approval');
      await expect(approval).toContainText('Waiting for external approval');
      await expect(approval).toContainText('Read-only status. Respond in the originating client.');
      await expect(approval.locator('button, input, select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="switch"]')).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(0);
      await expect(page.getByTestId('acp-chat-timeline').getByText('Collected three authoritative sources.')).toHaveCount(0);

      const composerAction = page.getByTestId('chat-composer-send');
      await expect(composerAction).toHaveAttribute('title', 'Send');
      let invocations = await getRecordedHostInvocations(app);
      expect(invocations.some((call) => call.module === 'chat' && call.action === 'cancelAcpSession')).toBe(false);
      expect(invocations.some((call) => call.module === 'chat' && call.action === 'sendAcpPrompt')).toBe(false);
      expect(invocations.some((call) => call.module === 'chat' && call.action === 'respondAcpPermission')).toBe(false);

      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(overlay).toHaveCount(0);
      await cronSidebarButton.click();
      await expect(overlay).toBeVisible({ timeout: 30_000 });
      await expect(overlay.getByTestId('cron-live-assistant')).toContainText('Collected three authoritative sources.');

      await expect.poll(async () => countAcpLoads(await getRecordedHostInvocations(app), CRON_BASE_KEY)).toBeGreaterThan(0);
      invocations = await getRecordedHostInvocations(app);
      const loadsBeforeTerminal = countAcpLoads(invocations, CRON_BASE_KEY);

      await emitCronLiveRunOverlayChange(app, {
        kind: 'remove',
        revision: 2,
        canonicalSessionKey: CRON_BASE_KEY,
        sourceSessionKey: CRON_RUN_KEY,
        runId: 'gateway-run-live-1',
        reason: 'ended',
        terminalStatus: 'completed',
      });

      await expect(overlay).toHaveCount(0);
      await expect.poll(async () => countAcpLoads(await getRecordedHostInvocations(app), CRON_BASE_KEY)).toBe(loadsBeforeTerminal + 1);
      await page.waitForTimeout(300);
      invocations = await getRecordedHostInvocations(app);
      const cronLoadsAfterTerminal = invocations.filter((call) => (
        call.module === 'chat'
        && call.action === 'loadAcpSession'
        && call.payload?.sessionKey === CRON_BASE_KEY
      )).slice(loadsBeforeTerminal);
      expect(cronLoadsAfterTerminal).toEqual([{
        module: 'chat',
        action: 'loadAcpSession',
        payload: EXPECTED_CRON_LOAD_PAYLOAD,
      }]);
      expect(invocations.some((call) => call.module === 'chat' && call.action === 'cancelAcpSession')).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hydrates a cron run already in progress without a run-start event', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const hydratedSnapshot = cronLiveRunSnapshot(7, {
      assistantText: 'Joined an autonomous run already in progress.',
      thinking: true,
      items: [{
        kind: 'tool',
        id: 'gateway-run-live-1:tool:read-skill',
        toolCallId: 'read-skill',
        title: 'read',
        status: 'running',
        inputText: '~/.openclaw/skills/docx/SKILL.md',
      }],
    });

    try {
      await installIpcMocks(app, {
        recordHostInvocations: true,
        failUnmatchedHostApiActions: ['chat.loadAcpSession'],
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: sessionListMock('Cron: Mid-flight brief'),
        hostApi: commonHostMocks({ revision: 7, snapshots: [hydratedSnapshot] }),
      });

      const page = await reloadMainWindow(app);
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();

      const overlay = page.getByTestId('cron-live-run-overlay');
      await expect(overlay).toBeVisible({ timeout: 30_000 });
      await expect(overlay.getByTestId('cron-live-assistant')).toContainText('Joined an autonomous run already in progress.');
      await expect(overlay.getByTestId('cron-live-tool')).toContainText('read');
      await expect(overlay.getByTestId('cron-live-thinking')).toBeVisible();
      await expect(page.getByTestId('acp-chat-timeline').getByText('Joined an autonomous run already in progress.')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', 'Send');

      const invocations = await getRecordedHostInvocations(app);
      expect(invocations.some((call) => call.module === 'cron' && call.action === 'liveRunOverlays')).toBe(true);
      expect(invocations.some((call) => call.module === 'chat' && call.action === 'sendAcpPrompt')).toBe(false);
      expect(invocations.some((call) => call.module === 'chat' && call.action === 'cancelAcpSession')).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows cron run summaries when ACP replay is empty', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const completeCronReply = `该喝水了！💧\n\n${'补充说明 '.repeat(500)}\n\n完整回复结尾`;

    try {
      await installIpcMocks(app, {
        recordHostInvocations: true,
        failUnmatchedHostApiActions: ['chat.loadAcpSession'],
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: sessionListMock('Cron: 喝水提醒'),
        hostApi: {
          ...commonHostMocks({ revision: 0, snapshots: [] }),
          [stableStringify(['cron', 'sessionHistory', { sessionKey: CRON_BASE_KEY, limit: 200 }])]: {
            messages: [
              { id: 'cron-prompt', role: 'user', content: '提醒我喝水', timestamp: Date.now() - 5000 },
              { id: 'cron-result', role: 'assistant', content: completeCronReply, timestamp: Date.now() },
            ],
          },
        },
      });

      const page = await reloadMainWindow(app);
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();

      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'cron'
        && call.action === 'sessionHistory'
        && call.payload?.sessionKey === CRON_BASE_KEY
      ))).toBe(true);
      await expect(page.getByText('提醒我喝水')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('该喝水了！💧')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('完整回复结尾')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-chat-empty-state')).toHaveCount(0);
      await expect(page.getByTestId('cron-live-run-overlay')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
