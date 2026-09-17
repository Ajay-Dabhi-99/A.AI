import { useQuery } from '@tanstack/react-query';
import { CornerDownRight } from 'lucide-react';
import { SUGGESTION_ANSWER_MAX_LENGTH, SUGGESTION_QUESTION_MAX_LENGTH } from '@a-ai/validation';
import { fetchChatSuggestions } from '@/services/chat';

/**
 * Follow-up questions under the latest answer (MODEL-067). Clicking one sends
 * it as the next message. Shows nothing while loading or when none came back.
 */
export function FollowUpSuggestions({
  answerKey,
  question,
  answer,
  disabled,
  onPick,
}: {
  answerKey: string;
  question: string;
  answer: string;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const suggestions = useQuery({
    queryKey: ['chat-suggestions', answerKey],
    queryFn: ({ signal }) =>
      fetchChatSuggestions(
        {
          question: question.slice(0, SUGGESTION_QUESTION_MAX_LENGTH),
          // The end of a long answer is what the next question usually follows from.
          answer: answer.slice(-SUGGESTION_ANSWER_MAX_LENGTH),
        },
        signal,
      ),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });

  const items = suggestions.data?.suggestions ?? [];
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Suggested follow-ups"
      className="follow-ups mt-3 flex flex-col items-start gap-1.5"
    >
      {items.map((item) => (
        <button
          key={item}
          type="button"
          disabled={disabled}
          onClick={() => onPick(item)}
          className="follow-up-chip"
        >
          <CornerDownRight className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{item}</span>
        </button>
      ))}
    </nav>
  );
}
