import type { CatalogModel, ProviderInfo } from '@a-ai/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { ModelCard } from '@/features/models/model-card';
import { currentUser, useMe } from '@/hooks/use-me';
import { MODELS_QUERY_KEY } from '@/hooks/use-models';
import { fetchAdminModelCatalog, fetchModelCatalog } from '@/services/models';

function groupByProvider(models: CatalogModel[], providers: ProviderInfo[]) {
  const order: string[] = [];
  for (const model of models) if (!order.includes(model.provider)) order.push(model.provider);
  return order.map((id) => ({
    provider: providers.find((item) => item.id === id) ?? { id, name: id, configured: false },
    models: models.filter((model) => model.provider === id),
  }));
}

/** The model registry: a public catalog, with management controls for administrators. */
export function ModelsPage() {
  const me = useMe();
  const isAdmin = currentUser(me.data)?.role === 'admin';
  const catalog = useQuery({
    queryKey: [...MODELS_QUERY_KEY, 'catalog', isAdmin ? 'admin' : 'public'],
    queryFn: ({ signal }) => (isAdmin ? fetchAdminModelCatalog(signal) : fetchModelCatalog(signal)),
    enabled: !me.isPending,
    retry: false,
  });

  if (me.isPending || catalog.isPending) return <PageSpinner label="Loading models" />;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-5 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Models</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every model A.ai knows about, with its limits, price and whether you can use it right now.
        </p>
      </div>

      {isAdmin && (
        <Alert tone="info" title="Administrator view">
          Changes apply to everyone within about 30 seconds.
        </Alert>
      )}

      {catalog.isError ? (
        <div className="space-y-4">
          <Alert tone="danger" title="The model list could not be loaded." />
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Try again
          </Button>
        </div>
      ) : catalog.data.models.length === 0 ? (
        <Alert tone="info" title="No models are registered yet." />
      ) : (
        groupByProvider(catalog.data.models, catalog.data.providers).map(({ provider, models }) => (
          <section
            key={provider.id}
            aria-labelledby={`provider-${provider.id}`}
            className="space-y-3"
          >
            <div className="flex items-center gap-2">
              <h2 id={`provider-${provider.id}`} className="text-lg font-semibold">
                {provider.name}
              </h2>
              {!provider.configured && <Badge>Not configured</Badge>}
            </div>
            <ul className="grid gap-4 md:grid-cols-2">
              {models.map((model) => (
                <li key={model.registryId}>
                  <ModelCard model={model} isAdmin={isAdmin} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
