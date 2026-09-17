import type { AIModel, ProviderInfo } from '@a-ai/shared-types';
import type { CSSProperties } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LANES = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)', 'var(--lane-4)'];

const AVAILABILITY: Record<AIModel['availability'], string> = {
  free: 'Free',
  'free-tier': 'Free tier',
  paid: 'Paid',
};

function modelKey(model: Pick<AIModel, 'provider' | 'id'>): string {
  return `${model.provider}::${model.id}`;
}

function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

/** One quiet line of facts under each model name. */
function details(model: AIModel): string {
  return [
    `${contextLabel(model.contextWindow)} context`,
    model.supportsVision ? 'Vision' : null,
    AVAILABILITY[model.availability],
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Model selector for the composer: a plain list grouped by provider. */
export function ModelPicker({
  models,
  providers,
  model,
  onSelect,
  disabled,
}: {
  models: AIModel[];
  providers: ProviderInfo[];
  model: AIModel | undefined;
  onSelect: (model: AIModel) => void;
  disabled: boolean;
}) {
  const providerIds = [...new Set(models.map((item) => item.provider))];
  const colorOf = (provider: string) =>
    LANES[Math.max(0, providerIds.indexOf(provider)) % LANES.length];

  return (
    <Select
      value={model ? modelKey(model) : ''}
      onValueChange={(value) => {
        const next = models.find((item) => modelKey(item) === value);
        if (next) onSelect(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id="chat-model"
        size="sm"
        aria-label="Model"
        className="model-trigger w-auto max-w-[14rem] gap-2 rounded-full"
        style={
          {
            '--provider': model ? colorOf(model.provider) : 'var(--muted-foreground)',
          } as CSSProperties
        }
      >
        <span className="model-dot" aria-hidden="true" />
        <SelectValue placeholder="Choose a model" />
      </SelectTrigger>
      {/* The composer sits at the bottom of the screen, so the list opens upward. */}
      <SelectContent
        side="top"
        align="start"
        sideOffset={8}
        className="model-menu w-72 max-w-[calc(100vw-2rem)]"
      >
        {providerIds.map((provider, index) => (
          <SelectGroup
            key={provider}
            className={index > 0 ? 'mt-1 border-t border-border/70 pt-1' : undefined}
            style={{ '--provider': colorOf(provider) } as CSSProperties}
          >
            <SelectLabel className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
              <span className="model-dot" aria-hidden="true" />
              {providers.find((item) => item.id === provider)?.name ?? provider}
            </SelectLabel>
            {models
              .filter((item) => item.provider === provider)
              .map((item) => (
                <SelectItem
                  key={modelKey(item)}
                  value={modelKey(item)}
                  className="model-option py-1.5"
                  description={
                    <span className="text-[11px] text-muted-foreground" aria-hidden="true">
                      {details(item)}
                    </span>
                  }
                >
                  {item.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
