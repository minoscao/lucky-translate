export const LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', name: 'Chinese (Simplified)' },
  { code: 'en', label: 'English', name: 'English' },
  { code: 'ja', label: '日本語', name: 'Japanese' },
  { code: 'ko', label: '한국어', name: 'Korean' },
  { code: 'fr', label: 'Français', name: 'French' },
  { code: 'de', label: 'Deutsch', name: 'German' },
  { code: 'es', label: 'Español', name: 'Spanish' },
  { code: 'it', label: 'Italiano', name: 'Italian' },
  { code: 'pt', label: 'Português', name: 'Portuguese' },
  { code: 'ru', label: 'Русский', name: 'Russian' },
  { code: 'ar', label: 'العربية', name: 'Arabic' },
  { code: 'th', label: 'ไทย', name: 'Thai' },
  { code: 'vi', label: 'Tiếng Việt', name: 'Vietnamese' },
  { code: 'id', label: 'Indonesia', name: 'Indonesian' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi' },
  { code: 'zh-TW', label: '繁體中文', name: 'Chinese (Traditional)' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export type Pair = [LanguageCode, LanguageCode];
export type Speaker = 'self' | 'other';
export type RecordMode = 'idle' | 'hold' | 'continuous';
export const language = (code: string) => LANGUAGES.find(item => item.code === code);
export function selectLanguage(pair: Pair, side: 0 | 1, code: LanguageCode): Pair {
  const next: Pair = [...pair]; next[side] = code;
  if (next[1 - side] === code) next[1 - side] = pair[side];
  return next;
}
export type Translation = { original: string; upper: string; lower: string; pair: Pair; id: number; speaker: Speaker };
export const CONTEXT_LIMITS = { turns: 6, characters: 1000 } as const;
/** One in-memory source for the transcript and the next queued request. */
export function createConversationStore() {
  let items: Translation[] = [];
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  return {
    snapshot: () => items,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    append: (item: Translation) => { items = [...items, item]; publish(); },
    replace: (id: number, item: Translation) => { items = items.map(current => current.id === id ? item : current); publish(); },
    clear: () => { items = []; publish(); },
    context: (beforeId?: number) => {
      const eligible = beforeId === undefined ? items : items.slice(0, items.findIndex(item => item.id === beforeId));
      return eligible.slice(-CONTEXT_LIMITS.turns).map(item => item.original.slice(0, CONTEXT_LIMITS.characters));
    },
  };
}
export function transcriptForLanguage(history: Translation[], code: LanguageCode) {
  return history.flatMap(item => item.pair[0] === code ? [{ id: item.id, text: item.upper, speaker: item.speaker }] : item.pair[1] === code ? [{ id: item.id, text: item.lower, speaker: item.speaker }] : []);
}

export function conversationText(history: Translation[], name: string) {
  return [`Lucky · ${name} · 完整对话`, ...history.map((item, index) =>
    `${index + 1}. ${item.speaker === 'self' ? name : 'other speaks'}\n${language(item.pair[0])?.label}: ${item.upper}\n${language(item.pair[1])?.label}: ${item.lower}\n原文: ${item.original}`,
  )].join('\n\n');
}

/** Gesture timing is independent from microphone permission/network timing. */
export class RecordGesture {
  static HOLD_MS = 300;
  static DOUBLE_MS = 340;
  mode: RecordMode = 'idle';
  private pressed = false;
  private downAt = 0;
  private lastTap = -Infinity;
  down(time: number) { this.pressed = true; this.downAt = time; }
  hold(time: number): 'start' | undefined {
    if (this.pressed && this.mode === 'idle' && time - this.downAt >= RecordGesture.HOLD_MS) {
      this.mode = 'hold'; this.lastTap = -Infinity; return 'start';
    }
  }
  up(time: number): 'start' | 'stop' | undefined {
    if (!this.pressed) return;
    this.pressed = false;
    if (this.mode !== 'idle') return this.cancel();
    if (time - this.downAt >= RecordGesture.HOLD_MS) { this.lastTap = -Infinity; return; }
    if (time - this.lastTap <= RecordGesture.DOUBLE_MS) return this.toggle();
    this.lastTap = time;
  }
  toggle(): 'start' | 'stop' {
    if (this.mode !== 'idle') { this.cancel(); return 'stop'; }
    this.lastTap = -Infinity; this.mode = 'continuous'; return 'start';
  }
  cancel(): 'stop' | undefined {
    const active = this.mode !== 'idle'; this.mode = 'idle'; this.pressed = false; this.lastTap = -Infinity;
    return active ? 'stop' : undefined;
  }
}
