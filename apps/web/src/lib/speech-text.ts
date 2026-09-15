/**
 * Turns a Markdown answer into text worth reading aloud: code blocks are
 * announced rather than spelled out, and formatting marks are dropped.
 */
export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' Code block omitted. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}
