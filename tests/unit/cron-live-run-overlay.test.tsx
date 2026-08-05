import { render, screen } from '@testing-library/react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { CronLiveRunItem, CronLiveRunOverlaySnapshot } from '@shared/chat/cron-live-run';
import { I18N_RESOURCES } from '@shared/i18n/resources';
import { CronLiveRunOverlay } from '@/pages/Chat/CronLiveRunOverlay';

vi.mock('@/pages/Chat/AcpMessageSegment', () => ({
  AcpRenderPart: ({ part }: { part: { kind: string; text: string } }) => {
    const strong = part.text.match(/\*\*(.+?)\*\*/)?.[1];
    const code = part.text.match(/`(.+?)`/)?.[1];
    return (
      <div data-testid="markdown-renderer" data-source={part.text}>
        {strong && <strong>{strong}</strong>}
        {code && <code>{code}</code>}
      </div>
    );
  },
}));

const localeTitles = {
  en: 'Live scheduled run',
  zh: '计划任务实时运行',
  ja: 'スケジュール実行のライブ状況',
  ru: 'Выполнение задачи по расписанию',
} as const;

function snapshot(overrides: Partial<CronLiveRunOverlaySnapshot> = {}): CronLiveRunOverlaySnapshot {
  return {
    canonicalSessionKey: 'agent:main:cron:daily-report',
    sourceSessionKey: 'agent:main:cron:daily-report:run:run-1',
    runSessionId: 'run-1',
    runId: 'run-1',
    revision: 7,
    status: 'running',
    startedAt: 1_786_000_000_000,
    updatedAt: 1_786_000_001_000,
    assistantText: '',
    thinking: false,
    items: [],
    ...overrides,
  };
}

function testI18n(language: keyof typeof I18N_RESOURCES): i18n {
  const instance = createInstance().use(initReactI18next);
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    defaultNS: 'chat',
    ns: ['chat'],
    resources: I18N_RESOURCES,
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
}

function renderOverlay(
  value: CronLiveRunOverlaySnapshot,
  language: keyof typeof I18N_RESOURCES = 'en',
) {
  const instance = testI18n(language);
  return render(
    <I18nextProvider i18n={instance}>
      <CronLiveRunOverlay snapshot={value} />
    </I18nextProvider>,
  );
}

describe('CronLiveRunOverlay', () => {
  it.each(Object.entries(localeTitles))('renders the localized transient panel header in %s', (language, title) => {
    renderOverlay(snapshot(), language as keyof typeof I18N_RESOURCES);

    expect(screen.getByTestId('cron-live-run-overlay')).toHaveAccessibleName(title);
    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(I18N_RESOURCES[language as keyof typeof I18N_RESOURCES].chat.cronLiveRun.transient)).toBeVisible();
    expect(screen.getByTestId('cron-live-running-pulse')).toHaveClass('animate-pulse');
  });

  it('renders assistant Markdown and exposes only localized thinking state', () => {
    renderOverlay(snapshot({
      assistantText: 'Report **ready** with `3 items`.',
      thinking: true,
    }));

    expect(screen.getByText('ready')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('3 items')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByTestId('markdown-renderer')).toHaveAttribute('data-source', 'Report **ready** with `3 items`.');
    expect(screen.getByTestId('cron-live-thinking')).toHaveTextContent('Thinking');
    expect(screen.queryByText(/chain of thought|raw thought/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-assistant-message')).not.toBeInTheDocument();
  });

  it('updates a dedicated tool row through running, completed, and failed statuses', () => {
    const tool: CronLiveRunItem = {
      kind: 'tool',
      id: 'run-1:tool:read',
      toolCallId: 'read',
      title: 'Read report',
      status: 'running',
      inputText: '{"path":"report.md"}',
      outputText: 'Loaded report',
    };
    const { rerender } = renderOverlay(snapshot({ items: [tool] }));
    const instance = testI18n('en');

    expect(screen.getByTestId('cron-live-tool')).toHaveTextContent('Tool');
    expect(screen.getByRole('status')).toHaveTextContent('Running');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByTestId('cron-live-tool')).toHaveTextContent('{"path":"report.md"}');
    expect(screen.getByTestId('cron-live-tool')).toHaveTextContent('Loaded report');
    for (const detail of screen.getByTestId('cron-live-tool').querySelectorAll('pre')) {
      expect(detail).toHaveClass('bg-surface-input');
      expect(detail).not.toHaveClass('bg-surface-modal');
    }
    expect(screen.queryByTestId('acp-tool-call-card')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={instance}>
        <CronLiveRunOverlay snapshot={snapshot({ items: [{ ...tool, status: 'completed' }] })} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Completed');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');

    rerender(
      <I18nextProvider i18n={instance}>
        <CronLiveRunOverlay snapshot={snapshot({ items: [{ ...tool, status: 'failed', error: 'Permission denied' }] })} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Failed');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByTestId('cron-live-tool')).toHaveTextContent('Permission denied');
  });

  it('renders static command, patch, and approval rows without approval actions', () => {
    const output = 'first line\n  indented line\n\nlast line';
    renderOverlay(snapshot({
      items: [
        {
          kind: 'command',
          id: 'run-1:command:test',
          title: 'Run tests',
          status: 'completed',
          output,
          exitCode: 0,
        },
        {
          kind: 'patch',
          id: 'run-1:patch:1',
          title: 'Update report',
          summary: 'Adjusted generated sections',
          added: 4,
          modified: 2,
          deleted: 1,
        },
        {
          kind: 'approval',
          id: 'run-1:approval:1',
          title: 'Publish report?',
          status: 'running',
          message: 'Waiting for an external decision',
        },
      ],
    }));

    const command = screen.getByTestId('cron-live-command');
    const commandOutput = screen.getByTestId('cron-live-command-output');
    expect(command).toHaveTextContent('Command');
    expect(command).toHaveTextContent('Exit code: 0');
    expect(commandOutput).toHaveClass('whitespace-pre-wrap', 'bg-surface-input');
    expect(commandOutput).not.toHaveClass('bg-surface-modal');
    expect(commandOutput).toHaveTextContent(output, { normalizeWhitespace: false });

    const patch = screen.getByTestId('cron-live-patch');
    expect(patch).toHaveTextContent('Patch');
    expect(patch).toHaveTextContent('Added: 4');
    expect(patch).toHaveTextContent('Modified: 2');
    expect(patch).toHaveTextContent('Deleted: 1');

    const approval = screen.getByTestId('cron-live-approval');
    expect(approval).toHaveTextContent('Approval');
    expect(approval).toHaveTextContent('Read-only status. Respond in the originating client.');
    expect(approval).toHaveTextContent('Waiting for an external decision');
    expect(approval.querySelector('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-permission-card')).not.toBeInTheDocument();
  });

  it.each([
    ['en', 'Added: 4', 'Modified: 2', 'Deleted: 1'],
    ['zh', '新增：4', '修改：2', '删除：1'],
    ['ja', '追加: 4', '変更: 2', '削除: 1'],
    ['ru', 'Добавлено: 4', 'Изменено: 2', 'Удалено: 1'],
  ] as const)('uses complete localized patch counts in %s', (language, added, modified, deleted) => {
    renderOverlay(snapshot({
      items: [{
        kind: 'patch',
        id: 'run-1:patch:localized',
        title: 'Localized patch',
        added: 4,
        modified: 2,
        deleted: 1,
      }],
    }), language);

    const patch = screen.getByTestId('cron-live-patch');
    expect(patch).toHaveTextContent(added);
    expect(patch).toHaveTextContent(modified);
    expect(patch).toHaveTextContent(deleted);
  });
});
