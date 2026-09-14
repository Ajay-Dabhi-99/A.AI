import { useQuery } from '@tanstack/react-query';
import { MessageSquarePlus } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button-variants';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { fetchConversations } from '@/services/chat';
import { CONVERSATIONS_QUERY_KEY } from './use-chat-session';

export function ConversationSidebar({ activeId }: { activeId: string | undefined }) {
  const conversations = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: ({ signal }) => fetchConversations(signal),
  });

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col gap-3">
      <Link
        to="/chat"
        className={buttonVariants({ variant: 'secondary', className: 'w-full justify-start' })}
      >
        <MessageSquarePlus aria-hidden="true" />
        New chat
      </Link>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.isPending ? (
          <Spinner label="Loading chats" className="px-2 py-3" />
        ) : conversations.isError ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Could not load your chats.</p>
        ) : conversations.data.conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Your saved chats will appear here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.data.conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  to={`/chat/${conversation.id}`}
                  aria-current={conversation.id === activeId ? 'page' : undefined}
                  className={cn(
                    'block truncate rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground',
                    conversation.id === activeId && 'bg-surface-muted font-medium text-foreground',
                  )}
                >
                  {conversation.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
