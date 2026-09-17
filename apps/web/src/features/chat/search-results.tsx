import { CHAT_SEARCH_MIN_LENGTH } from '@a-ai/validation';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Pin } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { searchConversations } from '@/services/chat';

/** Wraps each case-insensitive occurrence of `needle` in <mark>. */
function highlight(text: string, needle: string): ReactNode {
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(target); at >= 0 && target; at = lower.indexOf(target, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="search-mark">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Server-side search in chat titles and messages (MODEL-071). */
export function SearchResults({
  query,
  activeId,
  onNavigate,
}: {
  query: string;
  activeId: string | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const text = useDebounced(query.trim().replace(/\s+/g, ' '), 250);
  const ready = text.length >= CHAT_SEARCH_MIN_LENGTH;
  const results = useQuery({
    queryKey: ['conversations', 'search', text],
    queryFn: ({ signal }) => searchConversations(text, signal),
    enabled: ready,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  if (!ready) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        Type at least {CHAT_SEARCH_MIN_LENGTH} characters to search your chats.
      </p>
    );
  }
  if (results.isPending) return <Spinner label="Searching" className="px-3 py-4" />;
  if (results.isError) {
    return (
      <p role="alert" className="px-3 py-6 text-center text-xs text-danger">
        Search is not available right now.
      </p>
    );
  }
  const items = results.data.results;
  if (items.length === 0) {
    return (
      <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">
        No chats mention “{text}”.
      </p>
    );
  }

  return (
    <section aria-label="Search results" className="space-y-0.5">
      <h3 className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
        {items.length === 1 ? '1 chat' : `${items.length} chats`}
        {results.isFetching && ' · searching…'}
      </h3>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={`/chat/${item.id}`}
              onClick={onNavigate}
              aria-current={item.id === activeId ? 'page' : undefined}
              className={cn('search-result', item.id === activeId && 'chat-row-active')}
            >
              <span className="flex items-center gap-2 text-sm text-foreground">
                {item.pinnedAt ? (
                  <Pin className="size-3.5 shrink-0 rotate-45 text-primary" aria-hidden="true" />
                ) : (
                  <MessageSquare className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
                )}
                <span className="truncate">{highlight(item.title, text)}</span>
              </span>
              {item.snippet && (
                <span className="mt-0.5 line-clamp-2 pl-5.5 text-xs text-muted-foreground">
                  {highlight(item.snippet, text)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
