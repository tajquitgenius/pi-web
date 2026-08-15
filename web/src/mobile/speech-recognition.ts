export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionResultEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export interface SpeechRecognitionEnvironment {
  isSecureContext?: boolean;
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface SpeechRecognitionAdapter {
  isSupported(): boolean;
  create(): SpeechRecognitionInstance | null;
}

export function createBrowserSpeechRecognitionAdapter(
  environment: SpeechRecognitionEnvironment = globalThis as SpeechRecognitionEnvironment,
): SpeechRecognitionAdapter {
  const constructor = () => environment.SpeechRecognition || environment.webkitSpeechRecognition;
  return {
    isSupported: () => environment.isSecureContext !== false && Boolean(constructor()),
    create: () => {
      const Recognition = constructor();
      return environment.isSecureContext !== false && Recognition ? new Recognition() : null;
    },
  };
}
