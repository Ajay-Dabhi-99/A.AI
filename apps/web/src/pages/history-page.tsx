import type { HistoryItem } from '@a-ai/shared-types';
import { CONVERSATION_TITLE_MAX_LENGTH } from '@a-ai/validation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSpinner, Spinner } from '@/components/ui/spinner';
import { CONVERSATIONS_QUERY_KEY } from '@/features/chat/use-chat-session';
import { daysAgo, formatDateTime, formatUsd } from '@/features/history/format';
import { ApiError, NetworkError } from '@/services/api';
import {
  deleteHistoryItem,
  fetchHistory,
  updateConversation,
  type HistoryFilters,
} from '@/services/history';

const HISTORY_QUERY_KEY = ['history'] as const;

const PERIODS = [
  { value: '', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return 'Something went wrong. Please try again.';
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm-delete'>('view');
  const [title, setTitle] = useState(item.title);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }),
    ]);

  const rename = useMutation({
    mutationFn: (next: string) => updateConversation(item.id, { title: next }),
    onSuccess: async () => {
      setMode('view');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteHistoryItem(item.kind, item.id),
    onSuccess: refresh,
  });

  const href =
    item.kind === 'conversation' ? `/chat/${item.id}` : `/history/comparisons/${item.id}`;
  const kindLabel = item.kind === 'conversation' ? 'Chat' : 'Comparison';

  function submitRename(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (next && next !== item.title) rename.mutate(next);
    else setMode('view');
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={item.kind === 'conversation' ? 'neutral' : 'primary'}>{kindLabel}</Badge>
            {mode === 'rename' ? (
              <form onSubmit={submitRename} className="flex min-w-0 flex-1 items-center gap-2">
                <Label htmlFor={`rename-${item.id}`} className="sr-only">
                  New title
                </Label>
                <Input
                  id={`rename-${item.id}`}
                  value={title}
                  maxLength={CONVERSATION_TITLE_MAX_LENGTH}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-8 min-w-0 flex-1 px-2"
                  autoFocus
                />
                <Button type="submit" size="sm" disabled={rename.isPending || !title.trim()}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTitle(item.title);
                    setMode('view');
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <Link
                to={href}
                className="truncate text-sm font-medium text-foreground hover:text-primary"
              >
                {item.title}
              </Link>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(item.lastActivityAt)} · {item.runCount}{' '}
            {item.runCount === 1 ? 'run' : 'runs'}
            {item.failedRunCount > 0 && ` · ${item.failedRunCount} failed`}
            {' · '}
            {formatUsd(item.estimatedCostUsd)} est.
          </p>
          {item.models.length > 0 && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {item.models.map((model) => model.model).join(' · ')}
            </p>
          )}
        </div>

        {mode === 'view' && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {item.kind === 'conversation' && (
              <>
                <Link
                  to={`/history/chats/${item.id}`}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  Runs
                </Link>
                <Button size="sm" variant="ghost" onClick={() => setMode('rename')}>
                  Rename
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setMode('confirm-delete')}>
              Delete
            </Button>
          </div>
        )}
      </div>

      {mode === 'confirm-delete' && (
        <div
          role="alertdialog"
          aria-label={`Delete ${kindLabel.toLowerCase()}`}
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm"
        >
          <span className="flex-1">
            Delete this {kindLabel.toLowerCase()} and all its runs permanently? This cannot be
            undone.
          </span>
          <Button size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete permanently
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      )}
      {(rename.isError || remove.isError) && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {errorMessage(rename.error ?? remove.error)}
        </p>
      )}
    </li>
  );
}

/** Saved chats and comparisons, searchable, with rename and delete (Phase 7). */
export function HistoryPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState<HistoryFilters['type']>('all');
  const [period, setPeriod] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters: HistoryFilters = {
    type,
    q: debouncedSearch,
    from: period ? daysAgo(Number(period)) : null,
  };
  const history = useInfiniteQuery({
    queryKey: [...HISTORY_QUERY_KEY, filters],
    queryFn: ({ pageParam, signal }) => fetchHistory(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });

  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(debouncedSearch.trim() || type !== 'all' || period);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your saved chats and comparisons.</p>
        </div>
        <Link to="/dashboard" className="text-sm font-medium text-primary hover:underline">
          Usage dashboard
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="history-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <Input
            id="history-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Titles and comparison prompts"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="history-type" className="text-xs text-muted-foreground">
            Type
          </Label>
          <Select value={type} onValueChange={(value) => setType(value as HistoryFilters['type'])}>
            <SelectTrigger id="history-type" className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="conversation">Chats</SelectItem>
              <SelectItem value="comparison">Comparisons</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="history-period" className="text-xs text-muted-foreground">
            Period
          </Label>
          {/* Radix items cannot use an empty value, so "All time" is `all` here. */}
          <Select
            value={period || 'all'}
            onValueChange={(value) => setPeriod(value === 'all' ? '' : value)}
          >
            <SelectTrigger id="history-period" className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((option) => (
                <SelectItem key={option.value || 'all'} value={option.value || 'all'}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {history.isPending ? (
        <PageSpinner label="Loading history" />
      ) : history.isError ? (
        <div className="space-y-3">
          <Alert tone="danger" title="Your history could not be loaded.">
            {errorMessage(history.error)}
          </Alert>
          <Button variant="secondary" onClick={() => void history.refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <Alert tone="info" title={filtered ? 'Nothing matches these filters.' : 'No history yet.'}>
          {filtered ? (
            'Try another search or a longer period.'
          ) : (
            <>
              Saved <Link to="/chat">chats</Link> and <Link to="/compare">comparisons</Link> appear
              here.
            </>
          )}
        </Alert>
      ) : (
        <>
          <ul className="space-y-2" aria-label="History">
            {items.map((item) => (
              <HistoryRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </ul>
          {history.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchingNextPage ? <Spinner label="Loading" /> : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
