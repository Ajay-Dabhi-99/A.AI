import type { AIModel, ProviderInfo } from '@a-ai/shared-types';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { modelRefKey } from './use-comparison';

/** Checkboxes grouped by provider. Unchecked models are disabled once the limit is reached. */
export function ModelPicker({
  models,
  providers,
  selected,
  max,
  isGuest,
  disabled,
  onChange,
}: {
  models: AIModel[];
  /** Provider display names come from the API, never from the client. */
  providers: ProviderInfo[];
  selected: string[];
  max: number;
  isGuest: boolean;
  disabled: boolean;
  onChange: (selected: string[]) => void;
}) {
  const providerIds = [...new Set(models.map((model) => model.provider))];
  const full = selected.length >= max;

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm font-medium">Models to compare</legend>
      <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
        {selected.length} of {max} selected
        {isGuest && full && (
          <>
            {' · '}
            <Link to="/signup" className="text-primary hover:underline">
              Create a free account
            </Link>{' '}
            to compare more models
          </>
        )}
      </p>
      <div className="mt-3 space-y-3">
        {providerIds.map((providerId) => {
          const providerName = providers.find((item) => item.id === providerId)?.name ?? providerId;
          return (
            <div key={providerId} role="group" aria-label={providerName}>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{providerName}</p>
              <div className="flex flex-wrap gap-2">
                {models
                  .filter((model) => model.provider === providerId)
                  .map((model) => {
                    const key = modelRefKey(model);
                    const checked = selected.includes(key);
                    const blocked = !checked && full;
                    return (
                      <label
                        key={key}
                        className={cn(
                          'inline-flex max-w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                          checked
                            ? 'border-primary/50 bg-primary/10 text-foreground'
                            : 'border-border bg-surface text-muted-foreground hover:text-foreground',
                          (blocked || disabled) && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={checked}
                          disabled={blocked}
                          onChange={() =>
                            onChange(
                              checked
                                ? selected.filter((item) => item !== key)
                                : [...selected, key],
                            )
                          }
                        />
                        <span className="truncate">{model.name}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
