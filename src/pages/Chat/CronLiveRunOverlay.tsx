import { useId, type ReactNode } from 'react';
import {
  CheckCircle2,
  FileDiff,
  Loader2,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CronLiveRunItem, CronLiveRunOverlaySnapshot } from '@shared/chat/cron-live-run';
import { cn } from '@/lib/utils';
import { AcpRenderPart } from './AcpMessageSegment';

type ItemStatus = Extract<CronLiveRunItem, { status: unknown }>['status'];

function Status({ status }: { status: ItemStatus }) {
  const { t } = useTranslation('chat');
  const classes = status === 'completed'
    ? 'text-green-700 dark:text-green-400'
    : status === 'failed'
      ? 'text-red-700 dark:text-red-400'
      : 'text-yellow-700 dark:text-yellow-400';

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide dark:bg-white/10', classes)}
    >
      {status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
      {status === 'failed' && <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      {t(`cronLiveRun.status.${status}`)}
    </span>
  );
}

function ItemHeader({
  icon,
  label,
  title,
  status,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  status?: ItemStatus;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="shrink-0 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{title}</span>
      </div>
      {status && <Status status={status} />}
    </div>
  );
}

function Detail({ label, children, error = false }: { label: string; children: ReactNode; error?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className={cn(
        'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10',
        error && 'border-red-500/20 text-red-700 dark:text-red-400',
      )}>
        {children}
      </pre>
    </div>
  );
}

function ToolRow({ item }: { item: Extract<CronLiveRunItem, { kind: 'tool' }> }) {
  const { t } = useTranslation('chat');
  return (
    <article data-testid="cron-live-tool" className="rounded-xl border border-border bg-surface-input px-3 py-3 sm:px-4">
      <ItemHeader
        icon={<Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        label={t('cronLiveRun.item.tool')}
        title={item.title}
        status={item.status}
      />
      {(item.inputText || item.outputText || item.error) && (
        <div className="mt-3 grid gap-3">
          {item.inputText && <Detail label={t('cronLiveRun.detail.input')}>{item.inputText}</Detail>}
          {item.outputText && <Detail label={t('cronLiveRun.detail.output')}>{item.outputText}</Detail>}
          {item.error && <Detail label={t('cronLiveRun.detail.error')} error>{item.error}</Detail>}
        </div>
      )}
    </article>
  );
}

function CommandRow({ item }: { item: Extract<CronLiveRunItem, { kind: 'command' }> }) {
  const { t } = useTranslation('chat');
  return (
    <article data-testid="cron-live-command" className="rounded-xl border border-border bg-surface-input px-3 py-3 sm:px-4">
      <ItemHeader
        icon={<TerminalSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        label={t('cronLiveRun.item.command')}
        title={item.title}
        status={item.status}
      />
      {item.exitCode !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">{t('cronLiveRun.detail.exitCode', { code: item.exitCode })}</p>
      )}
      {item.output && (
        <pre
          data-testid="cron-live-command-output"
          className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10"
        >
          {item.output}
        </pre>
      )}
    </article>
  );
}

function PatchCount({ text, className }: { text: string; className: string }) {
  return (
    <span className={cn('rounded-full bg-black/5 px-2 py-1 text-xs font-medium dark:bg-white/10', className)}>
      {text}
    </span>
  );
}

function PatchRow({ item }: { item: Extract<CronLiveRunItem, { kind: 'patch' }> }) {
  const { t } = useTranslation('chat');
  return (
    <article data-testid="cron-live-patch" className="rounded-xl border border-border bg-surface-input px-3 py-3 sm:px-4">
      <ItemHeader
        icon={<FileDiff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        label={t('cronLiveRun.item.patch')}
        title={item.title}
      />
      {item.summary && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/80">{item.summary}</p>}
      {(item.added !== undefined || item.modified !== undefined || item.deleted !== undefined) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.added !== undefined && <PatchCount text={t('cronLiveRun.patch.added', { count: item.added })} className="text-green-700 dark:text-green-400" />}
          {item.modified !== undefined && <PatchCount text={t('cronLiveRun.patch.modified', { count: item.modified })} className="text-yellow-700 dark:text-yellow-400" />}
          {item.deleted !== undefined && <PatchCount text={t('cronLiveRun.patch.deleted', { count: item.deleted })} className="text-red-700 dark:text-red-400" />}
        </div>
      )}
    </article>
  );
}

function ApprovalRow({ item }: { item: Extract<CronLiveRunItem, { kind: 'approval' }> }) {
  const { t } = useTranslation('chat');
  return (
    <article data-testid="cron-live-approval" className="rounded-xl border border-yellow-500/20 bg-surface-input px-3 py-3 sm:px-4">
      <ItemHeader
        icon={<ShieldCheck className="h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-400" aria-hidden="true" />}
        label={t('cronLiveRun.item.approval')}
        title={item.title}
        status={item.status}
      />
      {item.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground/80">{item.message}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{t('cronLiveRun.approvalReadOnly')}</p>
    </article>
  );
}

function LiveItem({ item }: { item: CronLiveRunItem }) {
  if (item.kind === 'tool') return <ToolRow item={item} />;
  if (item.kind === 'command') return <CommandRow item={item} />;
  if (item.kind === 'patch') return <PatchRow item={item} />;
  return <ApprovalRow item={item} />;
}

export function CronLiveRunOverlay({ snapshot }: { snapshot: CronLiveRunOverlaySnapshot }) {
  const { t } = useTranslation('chat');
  const headingId = useId();

  return (
    <section
      data-testid="cron-live-run-overlay"
      aria-labelledby={headingId}
      className="w-full rounded-2xl border border-primary/20 bg-surface-modal p-3 shadow-sm sm:p-4"
    >
      <header className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">{t('cronLiveRun.title')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('cronLiveRun.transient')}</p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-yellow-700 dark:bg-white/10 dark:text-yellow-400">
          <span data-testid="cron-live-running-pulse" className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" aria-hidden="true" />
          {t('cronLiveRun.running')}
        </span>
      </header>

      {snapshot.assistantText && (
        <div data-testid="cron-live-assistant" className="mt-4 min-w-0">
          <AcpRenderPart part={{ kind: 'markdown', text: snapshot.assistantText }} tone="assistant" />
        </div>
      )}

      {snapshot.thinking && (
        <div data-testid="cron-live-thinking" role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('cronLiveRun.thinking')}
        </div>
      )}

      {snapshot.items.length > 0 && (
        <div className="mt-4 grid gap-3">
          {snapshot.items.map((item) => <LiveItem key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}
