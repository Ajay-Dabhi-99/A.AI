import { useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button-variants';
import { PageSpinner } from '@/components/ui/spinner';
import { Markdown } from '@/features/chat/markdown';
import { ApiError } from '@/services/api';
import { fetchSharedConversation } from '@/services/chat';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });

/** Keeps shared chats out of search engines while the page is open. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

/** A chat someone shared (MODEL-070): read-only, no account needed. */
export function SharedChatPage() {
  const { token = '' } = useParams();
  useNoIndex();
  const shared = useQuery({
    queryKey: ['shared', token],
    queryFn: ({ signal }) => fetchSharedConversation(token, signal),
    retry: false,
  });

  useEffect(() => {
    if (shared.data) document.title = `${shared.data.title} · A.ai`;
  }, [shared.data]);

  let body: React.ReactNode;
  if (shared.isPending) {
    body = <PageSpinner label="Loading shared chat" />;
  } else if (shared.isError) {
    const missing = shared.error instanceof ApiError && shared.error.code === 'NOT_FOUND';
    body = (
      <Alert
        tone={missing ? 'info' : 'danger'}
        title={
          missing
            ? 'This shared chat does not exist or was removed'
            : 'The shared chat could not be loaded.'
        }
      >
        <Link to="/chat" className="text-primary hover:underline">
          Start your own chat
        </Link>
      </Alert>
    );
  } else {
    const { title, messages, sharedAt, truncated } = shared.data;
    body = (
      <article aria-labelledby="shared-title">
        <header className="border-b border-border pb-5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-success">
            <Globe className="size-3.5" aria-hidden="true" />
            Shared chat · read-only
          </p>
          <h1 id="shared-title" className="mt-2 text-2xl font-semibold tracking-tight break-words">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shared on {dateTime.format(new Date(sharedAt))}
            {truncated && ' · only the newest messages are included'}
          </p>
        </header>
        <ol className="mt-6 flex flex-col gap-6">
          {messages.map((message, index) => (
            <li key={index}>
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <Markdown>{message.content}</Markdown>
                  {message.model && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">{message.model}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        <footer className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-sm font-medium">Want answers like these?</p>
          <Link to="/chat" className={buttonVariants({})}>
            Start your own chat
          </Link>
        </footer>
      </article>
    );
  }

  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-5 sm:py-10">{body}</div>;
}
