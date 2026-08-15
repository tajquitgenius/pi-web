import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserSpeechRecognitionAdapter,
  type SpeechRecognitionInstance,
} from './speech-recognition';

function recognitionConstructor(label: string) {
  return class {
    label = label;
    continuous = false;
    interimResults = false;
    lang = '';
    maxAlternatives = 0;
    onstart = null;
    onresult = null;
    onerror = null;
    onend = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
  } as unknown as new () => SpeechRecognitionInstance & { label: string };
}

describe('browser speech recognition adapter', () => {
  it('prefers the standard constructor and falls back to the Safari prefix', () => {
    const Standard = recognitionConstructor('standard');
    const Safari = recognitionConstructor('webkit');

    const standard = createBrowserSpeechRecognitionAdapter({
      isSecureContext: true,
      SpeechRecognition: Standard,
      webkitSpeechRecognition: Safari,
    });
    const prefixed = createBrowserSpeechRecognitionAdapter({
      isSecureContext: true,
      webkitSpeechRecognition: Safari,
    });

    expect(standard.isSupported()).toBe(true);
    expect((standard.create() as SpeechRecognitionInstance & { label: string }).label).toBe(
      'standard',
    );
    expect((prefixed.create() as SpeechRecognitionInstance & { label: string }).label).toBe(
      'webkit',
    );
  });

  it('is unavailable without a constructor or outside a secure context', () => {
    expect(createBrowserSpeechRecognitionAdapter({ isSecureContext: true }).isSupported()).toBe(
      false,
    );
    const insecure = createBrowserSpeechRecognitionAdapter({
      isSecureContext: false,
      SpeechRecognition: recognitionConstructor('standard'),
    });
    expect(insecure.isSupported()).toBe(false);
    expect(insecure.create()).toBeNull();
  });
});
