// Coach capture, upload validation and the visible countdown share these limits.
export const COACH_RECORDING = { maxSeconds: 120, warningSeconds: 10, sampleRate: 16000, bytesPerSample: 2, maxTextCharacters: 8000 } as const;
export const MAX_COACH_AUDIO_BYTES = 44 + COACH_RECORDING.maxSeconds * COACH_RECORDING.sampleRate * COACH_RECORDING.bytesPerSample;
