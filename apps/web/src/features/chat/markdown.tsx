import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Wraps each word of prose in `<span class="stream-word">` so words fade in as
 * they arrive. React keeps the spans already on screen, so only new words
 * animate. Code is left alone.
 */
function rehypeStreamWords() {
  const split = (node: HastNode) => {
    if (!node.children || node.tagName === 'code' || node.tagName === 'pre') return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== 'text' || !child.value) {
        split(child);
        return [child];
      }
      return child.value
        .split(/(\s+)/)
        .filter(Boolean)
        .map((part) =>
          /^\s+$/.test(part)
            ? { type: 'text', value: part }
            : {
                type: 'element',
                tagName: 'span',
                properties: { className: ['stream-word'] },
                children: [{ type: 'text', value: part }],
              },
        );
    });
  };
  return split;
}

const REMARK_PLUGINS = [remarkGfm];
const STREAMING_PLUGINS = [rehypeStreamWords];
// Defined once so links are not remounted on every streamed frame.
const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
};

/**
 * Renders model output. Model text is untrusted: raw HTML is dropped
 * (`skipHtml`), react-markdown's default URL transform strips unsafe schemes
 * such as `javascript:`, and links open in a new tab without referrer.
 * Memoised so a streaming answer does not re-parse every other message.
 */
export const Markdown = memo(function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  /** Fade new words in while the answer is being typed. */
  streaming?: boolean;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={streaming ? STREAMING_PLUGINS : undefined}
        skipHtml
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
