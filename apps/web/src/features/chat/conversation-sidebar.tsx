import type { ConversationListResponse, ConversationSummary } from '@a-ai/shared-types';
import { CONVERSATION_TITLE_MAX_LENGTH } from '@a-ai/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { ApiError } from '@/services/api';
import { fetchConversations } from '@/services/chat';
import { deleteHistoryItem, updateConversation } from '@/services/history';
import { CONVERSATIONS_QUERY_KEY } from './use-chat-session';

type Changes = { title?: string; pinned?: boolean };

const DAY_MS = 86_400_000;

/** Pinned first (latest pin on top), then most recently active, as the API orders them. */
function sortChats(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort(
    (a, b) =>
      (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** Recent chats grouped the way people remember them. */
function recentGroups(list: ConversationSummary[], now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = [
    { label: 'Today', from: today, items: [] as ConversationSummary[] },
    { label: 'Yesterday', from: today - DAY_MS, items: [] as ConversationSummary[] },
    { label: 'Previous 7 days', from: today - 7 * DAY_MS, items: [] as ConversationSummary[] },
    { label: 'Older', from: -Infinity, items: [] as ConversationSummary[] },
  ];
  for (const chat of list) {
    const at = Date.parse(chat.updatedAt);
    groups.find((group) => at >= group.from)?.items.push(chat);
  }
  return groups.filter((group) => group.items.length > 0);
}

function useUpdateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Changes }) =>
      updateConversation(id, changes),
    // Show the change at once; roll back if the server refuses it.
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey: CONVERSATIONS_QUERY_KEY, exact: true });
      const previous = queryClient.getQueryData<ConversationListResponse>(CONVERSATIONS_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<ConversationListResponse>(CONVERSATIONS_QUERY_KEY, {
          conversations: sortChats(
            previous.conversations.map((chat) =>
              chat.id === id
                ? {
                    ...chat,
                    ...(changes.title === undefined ? {} : { title: changes.title }),
                    ...(changes.pinned === undefined
                      ? {}
                      : { pinnedAt: changes.pinned ? new Date().toISOString() : null }),
                  }
                : chat,
            ),
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CONVERSATIONS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['history'] }),
      ]),
  });
}

function useDeleteChat(activeId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (id: string) => deleteHistoryItem('conversation', id),
    onSuccess: async (_result, id) => {
      queryClient.setQueryData<ConversationListResponse>(CONVERSATIONS_QUERY_KEY, (current) =>
        current
          ? { conversations: current.conversations.filter((chat) => chat.id !== id) }
          : current,
      );
      queryClient.removeQueries({ queryKey: [...CONVERSATIONS_QUERY_KEY, id], exact: true });
      // The open chat is gone: start a fresh one instead of showing "does not exist".
      if (id === activeId) await navigate('/chat', { replace: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY, exact: true }),
        queryClient.invalidateQueries({ queryKey: ['history'] }),
      ]);
    },
  });
}

function RenameField({
  chat,
  onSave,
  onCancel,
}: {
  chat: ConversationSummary;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(chat.title);
  const [invalid, setInvalid] = useState(false);
  // Guards against the blur that follows Enter, Escape or a button press.
  const doneRef = useRef(false);
  const errorId = `chat-title-error-${chat.id}`;

  function finish(action: () => void) {
    if (doneRef.current) return;
    doneRef.current = true;
    action();
  }

  /** Enter keeps the field open on a blank title; leaving the field abandons it. */
  function save(from: 'submit' | 'blur') {
    const title = draft.trim();
    if (!title) {
      if (from === 'blur') finish(onCancel);
      else setInvalid(true);
      return;
    }
    finish(() => (title === chat.title ? onCancel() : onSave(title)));
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save('submit');
      }}
      className={cn('chat-row chat-row-editing', invalid && 'chat-row-invalid')}
    >
      <div className="flex items-center gap-1 p-1">
        <input
          autoFocus
          aria-label="Chat title"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          value={draft}
          maxLength={CONVERSATION_TITLE_MAX_LENGTH}
          onChange={(event) => {
            setDraft(event.target.value);
            if (event.target.value.trim()) setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              finish(onCancel);
            }
          }}
          onBlur={() => save('blur')}
          onFocus={(event) => event.target.select()}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm text-foreground outline-none"
        />
        <button
          type="submit"
          aria-label="Save title"
          onMouseDown={(event) => event.preventDefault()}
          className="chat-action text-success"
        >
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Cancel renaming"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => finish(onCancel)}
          className="chat-action"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {invalid ? (
        <p id={errorId} role="alert" className="px-3 pb-1.5 text-[11px] text-danger">
          Enter a title
        </p>
      ) : (
        draft.length > CONVERSATION_TITLE_MAX_LENGTH - 20 && (
          <p className="px-3 pb-1.5 text-[11px] text-muted-foreground">
            {draft.length}/{CONVERSATION_TITLE_MAX_LENGTH}
          </p>
        )
      )}
    </form>
  );
}

function ChatRow({
  chat,
  active,
  onUpdate,
  onDelete,
  onNavigate,
}: {
  chat: ConversationSummary;
  active: boolean;
  onUpdate: (changes: Changes) => void;
  /** Resolves once the chat is gone; rejects when the server refuses. */
  onDelete: () => Promise<unknown>;
  onNavigate: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Rename and Delete move focus elsewhere, so the menu must not pull it back to its button.
  const keepFocusRef = useRef(false);
  const pinned = chat.pinnedAt !== null;

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      setConfirmOpen(false);
    } catch (error) {
      // The dialog stays open to retry or cancel.
      setDeleteError(
        error instanceof ApiError ? error.message : 'The chat could not be deleted. Try again.',
      );
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <RenameField
        chat={chat}
        onCancel={() => setEditing(false)}
        onSave={(title) => {
          setEditing(false);
          onUpdate({ title });
        }}
      />
    );
  }

  return (
    <div className={cn('chat-row', active && 'chat-row-active')}>
      <Link
        to={`/chat/${chat.id}`}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        onDoubleClick={(event) => {
          event.preventDefault();
          setEditing(true);
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-9 pl-3 text-sm"
      >
        {pinned ? (
          <Pin className="size-3.5 shrink-0 rotate-45 text-primary" aria-hidden="true" />
        ) : (
          <MessageSquare className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
        )}
        <span className="truncate">{chat.title}</span>
      </Link>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`Options for “${chat.title}”`}
          className="chat-menu-trigger chat-action"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          onCloseAutoFocus={(event) => {
            if (keepFocusRef.current) event.preventDefault();
            keepFocusRef.current = false;
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              keepFocusRef.current = true;
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onUpdate({ pinned: !pinned })}>
            {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {pinned ? 'Unpin' : 'Pin to top'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={() => {
              keepFocusRef.current = true;
              setDeleteError(null);
              setConfirmOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={(open) => !deleting && setConfirmOpen(open)}>
        <DialogContent
          title="Delete this chat?"
          description={
            <>
              <span className="font-medium break-words text-foreground">“{chat.title}”</span> and
              all its messages will be deleted permanently. This cannot be undone.
            </>
          }
        >
          {deleteError && (
            <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary" disabled={deleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>
              <Trash2 aria-hidden="true" />
              {deleting ? 'Deleting…' : 'Delete chat'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="space-y-0.5">
      <h3 className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
        {icon}
        {label}
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

export function ConversationSidebar({
  activeId,
  onNavigate,
  className,
}: {
  activeId: string | undefined;
  /** Called when a link is followed, e.g. to close the mobile drawer. */
  onNavigate?: () => void;
  className?: string;
}) {
  const conversations = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: ({ signal }) => fetchConversations(signal),
  });
  const update = useUpdateChat();
  const remove = useDeleteChat(activeId);
  // Delete errors are shown in the confirmation dialog.
  const failure = update.error;
  const [query, setQuery] = useState('');

  const all = conversations.data?.conversations ?? [];
  const needle = query.trim().toLowerCase();
  const visible = needle ? all.filter((chat) => chat.title.toLowerCase().includes(needle)) : all;
  const pinned = visible.filter((chat) => chat.pinnedAt !== null);
  const recent = visible.filter((chat) => chat.pinnedAt === null);

  const row = (chat: ConversationSummary) => (
    <li key={chat.id}>
      <ChatRow
        chat={chat}
        active={chat.id === activeId}
        onUpdate={(changes) => update.mutate({ id: chat.id, changes })}
        onDelete={() => remove.mutateAsync(chat.id)}
        onNavigate={onNavigate}
      />
    </li>
  );

  return (
    <nav
      aria-label="Conversations"
      className={cn(
        'chat-sidebar flex h-full min-h-0 flex-col rounded-2xl border border-border p-2.5',
        className,
      )}
    >
      <div className="flex items-center justify-between px-1.5 pt-1 pb-2.5">
        <h2 className="text-sm font-semibold">Your chats</h2>
        {all.length > 0 && (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {all.length}
          </span>
        )}
      </div>

      <Link to="/chat" onClick={onNavigate} className="new-chat-button">
        <Plus className="size-4" aria-hidden="true" />
        New chat
      </Link>

      {all.length > 0 && (
        <label className="relative mt-2.5 block">
          <span className="sr-only">Search chats</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            className="h-9 w-full rounded-lg border border-border bg-background/60 pr-2 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/50 sm:h-8 sm:text-xs"
          />
        </label>
      )}

      {failure && (
        <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
          {failure instanceof ApiError
            ? failure.message
            : 'That change could not be saved. Try again.'}
        </p>
      )}

      <div className="scrollbar-none -mx-1 mt-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {conversations.isPending ? (
          <Spinner label="Loading chats" className="px-2 py-3" />
        ) : conversations.isError ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Could not load your chats.</p>
        ) : all.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <span className="chat-empty-icon" aria-hidden="true">
              <MessageSquare className="size-4" />
            </span>
            <p className="text-xs text-muted-foreground">Your saved chats will appear here.</p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No chats match “{query.trim()}”.
          </p>
        ) : (
          <>
            {pinned.length > 0 && (
              <Section
                label="Pinned"
                icon={<Pin className="size-3 rotate-45" aria-hidden="true" />}
              >
                {pinned.map(row)}
              </Section>
            )}
            {recentGroups(recent, new Date()).map((group) => (
              <Section key={group.label} label={group.label}>
                {group.items.map(row)}
              </Section>
            ))}
          </>
        )}
      </div>
    </nav>
  );
}
