import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelLeft, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog, DialogTrigger, SheetContent } from '@/components/ui/dialog';
import { PageSpinner } from '@/components/ui/spinner';
import { ChatPanel } from '@/features/chat/chat-panel';
import { ConversationSidebar } from '@/features/chat/conversation-sidebar';
import { currentUser, useMe } from '@/hooks/use-me';
import { useModels } from '@/hooks/use-models';
import { ApiError } from '@/services/api';
import { clearGuestConversation, fetchConversation, fetchGuestConversation } from '@/services/chat';

const GUEST_CONVERSATION_KEY = ['guest-conversation'] as const;

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16">
      <Alert tone="danger" title={message} />
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Guests: one temporary chat. "New chat" clears it. */
function GuestChat() {
  const queryClient = useQueryClient();
  const me = useMe();
  const models = useModels();
  const [generation, setGeneration] = useState(0);
  const guestChat = useQuery({
    queryKey: GUEST_CONVERSATION_KEY,
    queryFn: ({ signal }) => fetchGuestConversation(signal),
    staleTime: Infinity,
  });
  const clear = useMutation({
    mutationFn: clearGuestConversation,
    onSuccess: async () => {
      await queryClient.resetQueries({ queryKey: GUEST_CONVERSATION_KEY });
      setGeneration((value) => value + 1);
    },
  });

  if (guestChat.isPending || models.isPending) return <PageSpinner label="Loading chat" />;
  if (guestChat.isError || models.isError) {
    return (
      <LoadError
        message="The chat could not be loaded."
        onRetry={() => {
          void guestChat.refetch();
          void models.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 pb-2">
        <p className="text-xs text-muted-foreground">
          Guest chat ·{' '}
          <Link to="/signup" className="text-primary hover:underline">
            create an account
          </Link>{' '}
          to keep it
        </p>
        {guestChat.data.messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          >
            <Trash2 aria-hidden="true" />
            New chat
          </Button>
        )}
      </div>
      <ChatPanel
        key={`guest-${generation}`}
        isGuest
        conversationId={null}
        initialMessages={guestChat.data.messages}
        models={models.data.models}
        defaultModel={models.data.defaultModel}
        providers={models.data.providers}
        quota={me.data?.quota}
        attachmentLimits={me.data?.limits.attachments}
      />
    </div>
  );
}

/** Below the large breakpoint the sidebar becomes a drawer opened from this bar. */
function MobileChatBar({ conversationId }: { conversationId: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 pb-2 lg:hidden">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <PanelLeft aria-hidden="true" />
          Chats
        </DialogTrigger>
        <SheetContent side="left" title="Your chats" className="px-2 pt-12">
          <ConversationSidebar
            activeId={conversationId}
            onNavigate={() => setOpen(false)}
            className="border-0 bg-transparent p-0"
          />
        </SheetContent>
      </Dialog>
      <Link to="/chat" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <Plus aria-hidden="true" />
        New chat
      </Link>
    </div>
  );
}

/** Signed-in users: saved conversations with a sidebar. */
function UserChat({ conversationId }: { conversationId: string | undefined }) {
  const me = useMe();
  const models = useModels();
  const location = useLocation();
  const conversation = useQuery({
    queryKey: ['conversations', conversationId],
    queryFn: ({ signal }) => fetchConversation(conversationId as string, signal),
    enabled: conversationId !== undefined,
    retry: false,
  });

  let content: React.ReactNode;
  if (models.isPending || (conversationId && conversation.isPending)) {
    content = <PageSpinner label="Loading chat" />;
  } else if (
    conversation.isError &&
    conversation.error instanceof ApiError &&
    conversation.error.code === 'NOT_FOUND'
  ) {
    content = (
      <div className="mx-auto max-w-md space-y-4 py-16">
        <Alert tone="danger" title="This conversation does not exist" />
        <Link to="/chat" className="text-sm font-medium text-primary hover:underline">
          Start a new chat
        </Link>
      </div>
    );
  } else if (models.isError || conversation.isError) {
    content = (
      <LoadError
        message="The chat could not be loaded."
        onRetry={() => {
          void models.refetch();
          if (conversationId) void conversation.refetch();
        }}
      />
    );
  } else {
    content = (
      <ChatPanel
        // A new chat keeps its panel when it gets an id; opening another chat remounts.
        key={conversationId ?? `new-${location.key}`}
        isGuest={false}
        conversationId={conversationId ?? null}
        initialMessages={conversation.data?.messages ?? []}
        initialMediaJobs={conversation.data?.mediaJobs}
        models={models.data.models}
        defaultModel={models.data.defaultModel}
        providers={models.data.providers}
        quota={me.data?.quota}
        attachmentLimits={me.data?.limits.attachments}
        onConversationStarted={(id) => {
          // Update the address without remounting the panel mid-stream.
          window.history.replaceState(window.history.state, '', `/chat/${id}`);
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-6">
      <aside className="hidden w-64 shrink-0 lg:block">
        <ConversationSidebar activeId={conversationId} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileChatBar conversationId={conversationId} />
        {content}
      </div>
    </div>
  );
}

export function ChatPage() {
  const { conversationId } = useParams();
  const me = useMe();

  let body: React.ReactNode;
  if (me.isPending) {
    body = <PageSpinner label="Loading chat" />;
  } else if (me.isError) {
    body = (
      <LoadError message="We couldn't check your session." onRetry={() => void me.refetch()} />
    );
  } else if (currentUser(me.data)) {
    body = <UserChat conversationId={conversationId} />;
  } else if (conversationId) {
    body = <Navigate to="/login" replace />;
  } else {
    body = <GuestChat />;
  }

  return (
    <div className="mx-auto h-[calc(100svh-4rem-30px)] max-w-6xl px-3 py-3 sm:px-5 sm:py-4">
      {body}
    </div>
  );
}
