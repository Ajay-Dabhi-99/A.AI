import type { AIModel, MeResponse, ModelsResponse } from '@a-ai/shared-types';
import { CHAT_MESSAGE_MAX_LENGTH, COMPARE_MIN_MODELS } from '@a-ai/validation';
import { Square } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { ComparisonColumn } from '@/features/compare/comparison-column';
import { ModelPicker } from '@/features/compare/model-picker';
import { columnKey, modelRefKey, useComparison } from '@/features/compare/use-comparison';
import { useMe } from '@/hooks/use-me';
import { useModels } from '@/hooks/use-models';
import { cn } from '@/lib/utils';

const GRID_COLUMNS: Record<number, string> = {
  1: '',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-2 xl:grid-cols-3',
  4: 'md:grid-cols-2 xl:grid-cols-4',
};

function CompareWorkspace({ me, catalog }: { me: MeResponse; catalog: ModelsResponse }) {
  const { models, providers } = catalog;
  const isGuest = me.identity.kind === 'guest';
  const max = me.limits.compareMaxModels;
  const session = useComparison();
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string[]>(() =>
    models.slice(0, Math.min(COMPARE_MIN_MODELS, max)).map(modelRefKey),
  );

  // Only models that are still offered count, in the order they were chosen.
  const chosen = selected
    .map((key) => models.find((model) => modelRefKey(model) === key))
    .filter((model): model is AIModel => model !== undefined)
    .slice(0, max);
  const tooLong = draft.length > CHAT_MESSAGE_MAX_LENGTH;
  const canCompare =
    !session.running && !tooLong && draft.trim().length > 0 && chosen.length >= COMPARE_MIN_MODELS;

  const nameOf = (provider: string, id: string) =>
    models.find((model) => model.provider === provider && model.id === id)?.name ?? id;
  const providerNameOf = (id: string) => providers.find((item) => item.id === id)?.name ?? id;

  const completed = session.columns.filter(
    (column) => column.status === 'completed' && column.latencyMs !== null,
  );
  const fastestLatency =
    completed.length > 1
      ? Math.min(...completed.map((column) => column.latencyMs as number))
      : null;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canCompare) return;
    void session.compare(
      draft.trim(),
      chosen.map((model) => ({ provider: model.provider, model: model.id })),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare models</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send one prompt to several models at once and compare their answers, speed, tokens and
          estimated cost.
          {isGuest && ' Guest comparisons are not saved.'}
        </p>
      </div>

      {models.length < COMPARE_MIN_MODELS ? (
        <Alert tone="info" title="Comparison needs at least two available models">
          {models.length === 0
            ? 'The API has no provider key configured.'
            : 'Only one model is available right now.'}{' '}
          Add a Groq, Gemini or OpenRouter key, or ask an administrator to enable more models.
        </Alert>
      ) : (
        <form
          onSubmit={submit}
          className="space-y-5 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
        >
          <ModelPicker
            models={models}
            providers={providers}
            selected={chosen.map(modelRefKey)}
            max={max}
            isGuest={isGuest}
            disabled={session.running}
            onChange={setSelected}
          />

          <div>
            <label htmlFor="compare-prompt" className="text-sm font-medium">
              Prompt
            </label>
            <textarea
              id="compare-prompt"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={4}
              placeholder="Ask every selected model the same thing…"
              aria-invalid={tooLong ? true : undefined}
              className="mt-2 block w-full resize-y rounded-xl border border-border bg-surface-muted/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none"
            />
            {tooLong && (
              <p className="mt-1 font-mono text-xs text-danger">
                {draft.length.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {me.quota.remaining} of {me.quota.limit} messages left today · each model uses one
            </p>
            {session.running ? (
              <Button type="button" variant="secondary" onClick={session.stop}>
                <Square className="fill-current" aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button type="submit" disabled={!canCompare}>
                Compare {chosen.length} models
              </Button>
            )}
          </div>
        </form>
      )}

      {session.failure && (
        <Alert tone="danger" title={session.failure.message}>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {session.failure.code === 'QUOTA_EXCEEDED' && isGuest && (
              <Link to="/signup">Create a free account for a higher daily limit</Link>
            )}
            <button
              type="button"
              className="text-xs hover:underline"
              onClick={session.dismissFailure}
            >
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {session.columns.length > 0 && (
        <section aria-label="Comparison results" className="space-y-3">
          <p className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-sm">
            <span className="mt-0.5 font-mono text-xs text-primary">prompt</span>
            <span className="min-w-0 break-words whitespace-pre-wrap">{session.prompt}</span>
          </p>
          <div
            className={cn('grid gap-3', GRID_COLUMNS[session.columns.length])}
            aria-live="polite"
          >
            {session.columns.map((column) => (
              <ComparisonColumn
                key={columnKey(column)}
                column={column}
                modelName={nameOf(column.provider, column.model)}
                providerName={providerNameOf(column.provider)}
                fastest={fastestLatency !== null && column.latencyMs === fastestLatency}
                canRetry={session.comparisonId !== null}
                onRetry={() => void session.retry(column)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ComparePage() {
  const me = useMe();
  const models = useModels();

  let body: React.ReactNode;
  if (me.isPending || models.isPending) {
    body = <PageSpinner label="Loading comparison" />;
  } else if (me.isError || models.isError) {
    body = (
      <div className="mx-auto max-w-md space-y-4 py-16">
        <Alert tone="danger" title="The comparison could not be loaded." />
        <Button
          variant="secondary"
          onClick={() => {
            void me.refetch();
            void models.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  } else {
    body = <CompareWorkspace me={me.data} catalog={models.data} />;
  }

  return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5">{body}</div>;
}
