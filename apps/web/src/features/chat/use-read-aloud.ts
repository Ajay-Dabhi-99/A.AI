import { useEffect, useState } from 'react';
import { toSpeechText } from '@/lib/speech-text';

/** The browser's own speech voices (Web Speech API): no server, no key, no stored audio. */
export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** Reads one answer aloud at a time; starting another stops the current one. */
export function useReadAloud() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // Leaving the chat stops the voice.
  useEffect(
    () => () => {
      if (speechSupported()) window.speechSynthesis.cancel();
    },
    [],
  );

  function toggle(id: string, markdown: string) {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speakingId === id) {
      setSpeakingId(null);
      return;
    }
    const utterance = new window.SpeechSynthesisUtterance(toSpeechText(markdown));
    const finished = () => setSpeakingId((current) => (current === id ? null : current));
    utterance.onend = finished;
    utterance.onerror = finished;
    setSpeakingId(id);
    synth.speak(utterance);
  }

  return { speakingId, toggle };
}
