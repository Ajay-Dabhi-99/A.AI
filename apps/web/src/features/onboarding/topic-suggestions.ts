import { INTEREST_TOPICS } from '@a-ai/validation';

/** Starter prompts per built-in topic (MODEL-066). */
const TOPIC_PROMPTS: Record<(typeof INTEREST_TOPICS)[number], readonly string[]> = {
  Coding: [
    'Explain the difference between a process and a thread with an example.',
    'Review this approach: how would you structure a small REST API in TypeScript?',
    'Write a function that removes duplicates from an array, and explain its complexity.',
  ],
  Business: [
    'Help me write a one-page plan for a small online business.',
    'What are three low-cost ways to find my first customers?',
    'Explain unit economics with a simple example.',
  ],
  Marketing: [
    'Give me five Instagram post ideas for a local coffee shop.',
    'Write a short, friendly launch email for a new product.',
    'How do I measure whether a marketing campaign worked?',
  ],
  Writing: [
    'Rewrite this paragraph to be clearer and shorter.',
    'Give me three opening lines for a short story about a lighthouse.',
    'What makes a cover letter stand out? Show me an example.',
  ],
  Design: [
    'What are the basic rules of a good color palette for a website?',
    'Suggest a clean layout for a portfolio home page.',
    'Explain visual hierarchy with a simple example.',
  ],
  'Data & AI': [
    'Explain vector databases to a product manager in two sentences.',
    'What is the difference between machine learning and deep learning?',
    'Write a SQL query that finds duplicate email addresses.',
  ],
  Education: [
    'Create a one-week study plan for learning basic statistics.',
    'Explain photosynthesis like I am twelve.',
    'Give me ten quiz questions about world geography.',
  ],
  'Health & Fitness': [
    'Suggest a 20-minute home workout for beginners.',
    'Give me a simple, balanced meal plan for one day.',
    'What habits help with better sleep?',
  ],
  Travel: [
    'Plan a three-day trip to Jaipur on a moderate budget.',
    'What should I pack for a week of hiking in the mountains?',
    'Suggest a relaxed two-week itinerary for Japan.',
  ],
  Finance: [
    'Explain the 50/30/20 budgeting rule with an example.',
    'What is the difference between an index fund and a stock?',
    'How do I build an emergency fund step by step?',
  ],
  Career: [
    'Help me prepare answers for common interview questions.',
    'How do I ask for a raise? Give me a short script.',
    'Suggest a plan to switch careers into product management.',
  ],
  Science: [
    'Explain black holes in simple terms.',
    'Why is the sky blue? Keep it short.',
    'What are the most important scientific discoveries of the last decade?',
  ],
};

/** Prompts for a topic the user typed in. */
function customPrompts(topic: string): string[] {
  return [
    `Explain the basics of ${topic} for a beginner.`,
    `What are the latest trends in ${topic}?`,
    `Give me a practical first project to learn ${topic}.`,
  ];
}

export function promptsFor(topic: string): readonly string[] {
  const builtIn = INTEREST_TOPICS.find((item) => item.toLowerCase() === topic.toLowerCase());
  return builtIn ? TOPIC_PROMPTS[builtIn] : customPrompts(topic);
}

/**
 * Three starter prompts for the empty chat, taken in turn from each chosen
 * topic, or the defaults when the user chose none.
 */
export function starterPrompts(
  interests: readonly string[],
  fallback: readonly string[],
): string[] {
  if (interests.length === 0) return [...fallback];
  const lists = interests.map((topic) => promptsFor(topic));
  const result: string[] = [];
  for (let round = 0; result.length < 3 && round < 3; round++) {
    for (const list of lists) {
      const prompt = list[round];
      if (prompt && result.length < 3) result.push(prompt);
    }
  }
  return result;
}
