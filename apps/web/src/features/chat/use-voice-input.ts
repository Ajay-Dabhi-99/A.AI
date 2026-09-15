import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api';
import { transcribeAudio } from '@/services/audio';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

/** Container types the API accepts, in the order browsers usually support them. */
const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export function voiceInputSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * Records a voice message and turns it into text (Phase 9, ADR-016). The
 * recording goes to the API once and is discarded there; nothing is kept here
 * after the transcript arrives.
 */
export function useVoiceInput(options: {
  maxSeconds: number;
  maxBytes: number;
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ticker = useRef<number | null>(null);
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (ticker.current !== null) window.clearInterval(ticker.current);
    ticker.current = null;
  };

  // Leaving the chat mid-recording turns the microphone off and discards the recording.
  useEffect(
    () => () => {
      const active = recorder.current;
      if (active) {
        active.onstop = null;
        if (active.state !== 'inactive') active.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      if (ticker.current !== null) window.clearInterval(ticker.current);
    },
    [],
  );

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function finish(recording: Blob) {
    recorder.current = null;
    const { maxBytes, onTranscript } = latest.current;
    if (recording.size === 0) {
      setState('idle');
      setError('Nothing was recorded.');
      return;
    }
    if (recording.size > maxBytes) {
      setState('idle');
      setError('The recording is too long. Try a shorter message.');
      return;
    }
    setState('transcribing');
    try {
      const type = recording.type || 'audio/webm';
      const file = new File([recording], `recording.${extensionFor(type)}`, { type });
      const { transcript } = await transcribeAudio(file);
      onTranscript(transcript.text);
    } catch (transcribeError) {
      setError(
        transcribeError instanceof ApiError
          ? transcribeError.message
          : 'The recording could not be transcribed.',
      );
    } finally {
      setState('idle');
    }
  }

  async function start() {
    if (state !== 'idle') return;
    setError(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access was blocked. Allow it in your browser to record.');
      return;
    }
    stream.current = media;
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const active = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    active.onstop = () => {
      release();
      void finish(new Blob(chunks, { type: active.mimeType || mimeType || 'audio/webm' }));
    };
    recorder.current = active;
    active.start(1_000);

    const startedAt = Date.now();
    setSeconds(0);
    setState('recording');
    ticker.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= latest.current.maxSeconds) stop();
    }, 250);
  }

  return { state, error, seconds, start, stop, dismissError: () => setError(null) };
}
