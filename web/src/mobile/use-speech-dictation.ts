import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocale, t } from '../shared/i18n.js';
import {
  createBrowserSpeechRecognitionAdapter,
  type SpeechRecognitionInstance,
  type SpeechRecognitionResultEventLike,
} from './speech-recognition';

type DictationState = 'unsupported' | 'idle' | 'starting' | 'listening' | 'stopping' | 'error';

interface UseSpeechDictationOptions {
  value: string;
  enabled: boolean;
  sessionId: string;
  onChange(value: string): void;
}

function joinTranscript(snapshot: string, transcript: string): string {
  if (!snapshot || !transcript || /\s$/.test(snapshot) || /^[\s.,!?;:]/.test(transcript)) {
    return `${snapshot}${transcript}`;
  }
  return `${snapshot} ${transcript}`;
}

function errorText(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return t('composer.dictationPermissionDenied');
    case 'audio-capture':
      return t('composer.dictationNoMicrophone');
    case 'no-speech':
      return t('composer.dictationNoSpeech');
    case 'network':
      return t('composer.dictationNetworkError');
    case 'language-not-supported':
      return t('composer.dictationLanguageUnsupported');
    default:
      return t('composer.dictationUnavailable');
  }
}

export function useSpeechDictation({
  value,
  enabled,
  sessionId,
  onChange,
}: UseSpeechDictationOptions) {
  const adapterRef = useRef(createBrowserSpeechRecognitionAdapter());
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const snapshotRef = useRef('');
  const mountedRef = useRef(true);
  const intentionalAbortRef = useRef(false);
  const [state, setState] = useState<DictationState>(() =>
    adapterRef.current.isSupported() ? 'idle' : 'unsupported',
  );
  const [error, setError] = useState('');
  const active = state === 'starting' || state === 'listening' || state === 'stopping';

  const detach = useCallback((recognition: SpeechRecognitionInstance) => {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  }, []);

  const abort = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    intentionalAbortRef.current = true;
    recognitionRef.current = null;
    detach(recognition);
    try {
      recognition.abort();
    } catch {
      // The browser may already have ended the recognition session.
    }
    if (mountedRef.current) setState('idle');
  }, [detach]);

  const start = useCallback(() => {
    if (!enabled || recognitionRef.current) return;
    setError('');
    intentionalAbortRef.current = false;
    let recognition: SpeechRecognitionInstance | null = null;
    try {
      recognition = adapterRef.current.create();
      if (!recognition) {
        setState('unsupported');
        return;
      }
      const instance = recognition;
      recognitionRef.current = instance;
      snapshotRef.current = value;
      instance.continuous = true;
      instance.interimResults = true;
      instance.maxAlternatives = 1;
      instance.lang = getLocale() || navigator.language;
      instance.onstart = () => {
        if (recognitionRef.current === instance) setState('listening');
      };
      instance.onresult = (event: SpeechRecognitionResultEventLike) => {
        if (recognitionRef.current !== instance) return;
        let transcript = '';
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index]?.[0]?.transcript || '';
        }
        onChange(joinTranscript(snapshotRef.current, transcript));
      };
      instance.onerror = (event) => {
        if (recognitionRef.current !== instance) return;
        recognitionRef.current = null;
        detach(instance);
        if (intentionalAbortRef.current && event.error === 'aborted') {
          setState('idle');
          return;
        }
        setError(errorText(event.error));
        setState('error');
      };
      instance.onend = () => {
        if (recognitionRef.current !== instance) return;
        recognitionRef.current = null;
        detach(instance);
        setState('idle');
      };
      setState('starting');
      instance.start();
    } catch {
      if (recognition) detach(recognition);
      recognitionRef.current = null;
      setError(t('composer.dictationUnavailable'));
      setState('error');
    }
  }, [detach, enabled, onChange, value]);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      start();
      return;
    }
    setState('stopping');
    try {
      recognition.stop();
    } catch {
      abort();
    }
  }, [abort, start]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) abort();
  }, [abort, enabled]);

  useEffect(() => abort, [abort, sessionId]);

  useEffect(() => {
    const stopForPageLifecycle = () => abort();
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') abort();
    };
    window.addEventListener('pagehide', stopForPageLifecycle);
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      window.removeEventListener('pagehide', stopForPageLifecycle);
      document.removeEventListener('visibilitychange', stopWhenHidden);
    };
  }, [abort]);

  return { supported: state !== 'unsupported', state, active, error, toggle, abort };
}
