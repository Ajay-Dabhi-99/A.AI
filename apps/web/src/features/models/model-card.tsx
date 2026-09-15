import type { CatalogModel, ModelStatus } from '@a-ai/shared-types';
import { modelUpdateRequestSchema, type ModelUpdateRequest } from '@a-ai/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextField } from '@/features/auth/fields';
import { MODELS_QUERY_KEY } from '@/hooks/use-models';
import { ApiError, NetworkError } from '@/services/api';
import { updateModel } from '@/services/models';

const STATUS: Record<ModelStatus, { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  available: { label: 'Available', tone: 'success' },
  disabled: { label: 'Disabled', tone: 'danger' },
  provider_not_configured: { label: 'Provider not configured', tone: 'neutral' },
};

const ACCESS: Record<CatalogModel['availability'], string> = {
  free: 'Free',
  'free-tier': 'Free tier',
  paid: 'Paid',
};

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function formatPrice(
  model: Pick<CatalogModel, 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'>,
): string {
  const { inputPricePerMillionUsd: input, outputPricePerMillionUsd: output } = model;
  if (input === null || output === null) return 'Price not set';
  if (input === 0 && output === 0) return '$0 (free)';
  return `$${input} in · $${output} out per 1M tokens`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return 'Something went wrong. Please try again.';
}

function EditForm({
  model,
  onCancel,
  onSave,
}: {
  model: CatalogModel;
  onCancel: () => void;
  onSave: (changes: ModelUpdateRequest) => Promise<void>;
}) {
  const [values, setValues] = useState({
    name: model.name,
    sortOrder: String(model.sortOrder),
    contextWindow: String(model.contextWindow),
    maxOutputTokens: String(model.maxOutputTokens),
    availability: model.availability,
    inputPrice: model.inputPricePerMillionUsd === null ? '' : String(model.inputPricePerMillionUsd),
    outputPrice:
      model.outputPricePerMillionUsd === null ? '' : String(model.outputPricePerMillionUsd),
    verified: model.verifiedAt !== null,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const id = (name: string) => `model-${model.registryId}-${name}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = (text: string) => (text.trim() === '' ? null : Number(text));
    const candidate: Record<string, unknown> = {
      name: values.name.trim(),
      sortOrder: Number(values.sortOrder),
      contextWindow: Number(values.contextWindow),
      maxOutputTokens: Number(values.maxOutputTokens),
      availability: values.availability,
      inputPricePerMillionUsd: price(values.inputPrice),
      outputPricePerMillionUsd: price(values.outputPrice),
    };
    const current: Record<string, unknown> = {
      name: model.name,
      sortOrder: model.sortOrder,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      availability: model.availability,
      inputPricePerMillionUsd: model.inputPricePerMillionUsd,
      outputPricePerMillionUsd: model.outputPricePerMillionUsd,
    };
    const changes = Object.fromEntries(
      Object.entries(candidate).filter(([key, value]) => value !== current[key]),
    );
    if (values.verified !== (model.verifiedAt !== null)) changes.verified = values.verified;
    // Always validate the limits together, even if only one of them changed.
    if ('maxOutputTokens' in changes || 'contextWindow' in changes) {
      changes.contextWindow = candidate.contextWindow;
      changes.maxOutputTokens = candidate.maxOutputTokens;
    }

    if (Object.keys(changes).length === 0) {
      setError('Nothing has changed.');
      return;
    }
    const parsed = modelUpdateRequestSchema.safeParse(changes);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the values.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave(parsed.data);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-3 border-t border-border pt-4">
      {error && <Alert tone="danger" title={error} />}
      <TextField
        id={id('name')}
        label="Display name"
        value={values.name}
        onChange={field('name')}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          id={id('context')}
          label="Context window"
          inputMode="numeric"
          value={values.contextWindow}
          onChange={field('contextWindow')}
        />
        <TextField
          id={id('output')}
          label="Max output tokens"
          inputMode="numeric"
          value={values.maxOutputTokens}
          onChange={field('maxOutputTokens')}
        />
        <TextField
          id={id('order')}
          label="Sort order"
          inputMode="numeric"
          value={values.sortOrder}
          onChange={field('sortOrder')}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor={id('access')} className="text-sm font-medium">
            Access
          </label>
          <select
            id={id('access')}
            value={values.availability}
            onChange={field('availability')}
            className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
          >
            <option value="free">Free</option>
            <option value="free-tier">Free tier</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <TextField
          id={id('input-price')}
          label="Input $ per 1M"
          inputMode="decimal"
          placeholder="Unknown"
          value={values.inputPrice}
          onChange={field('inputPrice')}
        />
        <TextField
          id={id('output-price')}
          label="Output $ per 1M"
          inputMode="decimal"
          placeholder="Unknown"
          value={values.outputPrice}
          onChange={field('outputPrice')}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.verified}
          onChange={(event) =>
            setValues((current) => ({ ...current, verified: event.target.checked }))
          }
          className="size-4 accent-[var(--primary)]"
        />
        Limits confirmed with a real provider key
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ModelCard({ model, isAdmin }: { model: CatalogModel; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const mutation = useMutation({
    mutationFn: (changes: ModelUpdateRequest) => updateModel(model.registryId, changes),
    // ['models'] covers the chat model list and both catalog views.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY }),
  });
  const status = STATUS[model.status];
  const capabilities = [
    model.supportsStreaming && 'Streaming',
    model.supportsVision && 'Vision',
    model.supportsTools && 'Tools',
  ].filter(Boolean);

  return (
    <article aria-label={model.name} className="rounded-2xl border border-border bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium">{model.name}</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">{model.id}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Context</dt>
        <dd className="font-mono tabular-nums">{compact.format(model.contextWindow)} tokens</dd>
        <dt className="text-muted-foreground">Max output</dt>
        <dd className="font-mono tabular-nums">{compact.format(model.maxOutputTokens)} tokens</dd>
        <dt className="text-muted-foreground">Access</dt>
        <dd>{ACCESS[model.availability]}</dd>
        <dt className="text-muted-foreground">Price</dt>
        <dd>{formatPrice(model)}</dd>
        <dt className="text-muted-foreground">Capabilities</dt>
        <dd>{capabilities.join(', ') || 'Text only'}</dd>
        <dt className="text-muted-foreground">Limits</dt>
        <dd>
          {model.verifiedAt
            ? `Verified ${date.format(new Date(model.verifiedAt))}`
            : 'Not yet verified'}
        </dd>
      </dl>

      {isAdmin && (
        <div className="mt-4">
          {mutation.isError && !editing && (
            <Alert tone="danger" title={errorMessage(mutation.error)} className="mb-3" />
          )}
          {!editing && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={model.enabled ? 'secondary' : 'primary'}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ enabled: !model.enabled })}
              >
                {model.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          )}
          {editing && (
            <EditForm
              model={model}
              onCancel={() => setEditing(false)}
              onSave={async (changes) => {
                await mutation.mutateAsync(changes);
                setEditing(false);
              }}
            />
          )}
        </div>
      )}
    </article>
  );
}
