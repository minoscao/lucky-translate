export type TimeCategory = 'training' | 'translation' | 'summary';
export type TextTimeRules = { secondsPerWord: number; secondsPerCharacter: number };
export const DEFAULT_TEXT_TIME_RULES: TextTimeRules = { secondsPerWord: 0.4, secondsPerCharacter: 0.25 };

export function validTextTimeRules(value: unknown): value is TextTimeRules {
  const rules = value as TextTimeRules | null;
  return !!rules && Number.isFinite(rules.secondsPerWord) && rules.secondsPerWord >= .05 && rules.secondsPerWord <= 5
    && Number.isFinite(rules.secondsPerCharacter) && rules.secondsPerCharacter >= .05 && rules.secondsPerCharacter <= 5;
}

// Count spoken units, never punctuation, private prompts, model tokens or playback speed.
export function estimateTextTime(texts: readonly string[], rules: TextTimeRules, category: TimeCategory = 'training') {
  if (!validTextTimeRules(rules)) throw new Error('计时参数无效');
  const text = texts.join('\n').normalize('NFKC');
  const characterPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const characters = (text.match(characterPattern) || []).length;
  const words = (text.replace(characterPattern, ' ').match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
  const estimatedSeconds = Math.round((words * rules.secondsPerWord + characters * rules.secondsPerCharacter) * 1000) / 1000;
  const multiplier = category === 'summary' ? .1 : 1;
  return { words, characters, estimatedSeconds, multiplier, chargedSeconds: Math.max(0, Math.ceil(estimatedSeconds * multiplier - 1e-9)), rules: { ...rules } };
}

export function parseCoachContent(content: string): Record<string, unknown> {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  const parsed = JSON.parse(start >= 0 && end >= start ? clean.slice(start, end + 1) : clean);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('回复内容不完整');
  return parsed;
}

export function coachTimeBasis(messages: Array<{ role: string; content: string }>, response: Record<string, unknown>) {
  const system = messages[0]?.content || '', task = messages.at(-1)?.content || '';
  if (typeof response.reply === 'string') {
    if (!response.reply.trim() || typeof response.tip !== 'string' || !response.memory || typeof response.memory !== 'object') throw new Error('对话回复不完整');
    const previous = messages.slice(1, -1).filter(message => message.role === 'user');
    return { category: 'training' as const, texts: [previous.at(-1)?.content || '', response.reply], label: '英语对话' };
  }
  if (system.includes('daily English learning recalls')) {
    if (typeof response.overview !== 'string' || !Array.isArray(response.vocabulary) || !Array.isArray(response.grammar)) throw new Error('总结内容不完整');
    const transcript = task.split('\nConversation:\n').at(-1) || '';
    if (transcript === task) throw new Error('没有找到总结对应的对话');
    return { category: 'summary' as const, texts: [transcript.replace(/^(?:Coach|Learner):\s*/gm, '')], label: '对话总结' };
  }
  if (system.includes('weekly learning record')) {
    if (typeof response.overview !== 'string' || !Array.isArray(response.vocabulary)) throw new Error('周总结内容不完整');
    // Automatic consolidation of already charged daily recaps does not charge the conversation again.
    return { category: 'summary' as const, texts: [], label: '周汇总（已计入每日总结）' };
  }
  if (Array.isArray(response.exercises) && response.exercises.length > 0) {
    const texts = response.exercises.flatMap(item => {
      const exercise = item as Record<string, unknown>;
      if (typeof exercise.prompt !== 'string' || typeof exercise.answer !== 'string' || !Array.isArray(exercise.options)) throw new Error('练习内容不完整');
      return [exercise.prompt, exercise.definition, exercise.explanation, ...exercise.options].filter((text): text is string => typeof text === 'string');
    });
    return { category: 'training' as const, texts, label: '词汇与语法练习' };
  }
  if (Number.isFinite(response.score) && typeof response.conclusion === 'string') {
    return { category: 'training' as const, texts: [response.grammar, response.vocabulary, response.fluency, response.conclusion].filter((text): text is string => typeof text === 'string'), label: '水平评估' };
  }
  throw new Error('回复内容不完整');
}
