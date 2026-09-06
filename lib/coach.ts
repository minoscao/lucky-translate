export type CoachRole = 'learner' | 'coach';
export type CoachMessage = { id: number; role: CoachRole; text: string };
export type CoachMemory = { level: string; topics: string[]; strengths: string[]; focus: string[]; phrases: string[] };
export type CoachExercise = {
  type: 'cloze' | 'meaning' | 'grammar'; prompt: string; answer: string;
  initial: string; definition: string; options: string[]; explanation: string;
};
export type CoachUsage = { tokens: number; cost: number };
export type CoachVocabulary = { word: string; definition: string };
export type CoachGrammar = { point: string; example: string };
export type CoachMistake = { original: string; better: string; reason: string };
export type CoachDailySummary = {
  id: string; date: string; minutes: number; overview: string; mainFocus: string[];
  likelyMistakes: CoachMistake[]; vocabulary: CoachVocabulary[]; grammar: CoachGrammar[];
};
export type CoachWeeklySummary = {
  id: string; startDate: string; endDate: string; minutes: number; overview: string;
  progress: string[]; nextFocus: string[]; vocabulary: CoachVocabulary[]; grammar: CoachGrammar[];
};

export const EMPTY_COACH_MEMORY: CoachMemory = { level: 'discovering', topics: [], strengths: [], focus: [], phrases: [] };

const COACH_RULES = `You are Luna, an affectionate and adaptive English conversation coach. Practice is in English only. Follow the learner's real topic and latest clear intent. This is a natural conversation, never a quiz, test, or grammar lecture. Respond to the meaning first and leave most of the speaking opportunity to the learner.
Treat a self-reported level or IELTS score as a starting point and verify it across several turns. For a learner reporting IELTS 6 or above, use richer language and deeper questions by default. Never lower the assumed level because of one short answer or one transcription-looking mistake. Introduce a few precise, useful expressions naturally in context and explain them in simple English when asked.
Use one or two precise expressions that fit the topic, and mark those expressions with **double asterisks** so the learner can notice them. Do not pile on difficult vocabulary or require immediate repetition. Correct at most one meaningful issue when it helps the current conversation, then return to the topic. Never rewrite the learner's whole answer. If wording may be a transcription error, confirm the intended meaning rather than judging ability from it. When the learner is stuck, first invite one detail; only then offer the smallest useful sentence beginning, insertion point, or blank using their own words. Do not trigger scaffolds merely because a reply is short.
Keep reply under 55 words and tip under 20 words. Update compact learner memory with interests, experiences, goals, repeated difficulty and useful expressions without sounding as if you are reading a database.`;

const memorySchema = {
  type: 'object', additionalProperties: false, required: ['level', 'topics', 'strengths', 'focus', 'phrases'],
  properties: {
    level: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    focus: { type: 'array', items: { type: 'string' } },
    phrases: { type: 'array', items: { type: 'string' } },
  },
};

async function coachRequest<T>(_key: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, _schemaName: string, _schema: object, signal: AbortSignal): Promise<{ data: T; usage: CoachUsage }> {
  let response: Response;
  try {
    response = await fetch('/api/coach', {
      method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, maxTokens: 1800 }),
    });
  } catch { throw new Error('无法连接 English Coach，请检查网络'); }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || 'English Coach 暂时无法回应');
  }
  const result = await response.json() as { content?: string; usage?: CoachUsage };
  const content = result.content;
  if (!content) throw new Error('English Coach 没有返回完整内容');
  try { return { data: JSON.parse(content) as T, usage: result.usage || { tokens: 0, cost: 0 } }; }
  catch { throw new Error('English Coach 返回内容不完整，请重试'); }
}

export async function coachReplyDirect(input: { key: string; history: CoachMessage[]; memory: CoachMemory; turnStatus: string; newSession?: boolean; signal: AbortSignal }) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['reply', 'tip', 'memory'],
    properties: { reply: { type: 'string' }, tip: { type: 'string' }, memory: memorySchema },
  };
  const history = input.history.slice(-12).map(message => ({ role: message.role === 'coach' ? 'assistant' as const : 'user' as const, content: message.text.slice(0, 1000) }));
  const task = input.newSession
    ? `Start a fresh ordinary open conversation. Do not announce a level or lesson. Learner memory: ${JSON.stringify(input.memory)}`
    : `Private learner memory: ${JSON.stringify(input.memory)}\nLearner-turn signal: ${input.turnStatus}. Respond to the learner's latest message.`;
  return coachRequest<{ reply: string; tip: string; memory: CoachMemory }>(input.key, [{ role: 'system', content: COACH_RULES }, ...history, { role: 'user', content: task }], 'luna_coach_turn', schema, input.signal);
}

export async function coachPracticeDirect(input: { key: string; history: CoachMessage[]; memory: CoachMemory; signal: AbortSignal }) {
  const exerciseSchema = {
    type: 'object', additionalProperties: false, required: ['type', 'prompt', 'answer', 'initial', 'definition', 'options', 'explanation'],
    properties: {
      type: { type: 'string', enum: ['cloze', 'meaning', 'grammar'] }, prompt: { type: 'string' }, answer: { type: 'string' },
      initial: { type: 'string' }, definition: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 3 }, explanation: { type: 'string' },
    },
  };
  const schema = { type: 'object', additionalProperties: false, required: ['title', 'exercises'], properties: { title: { type: 'string' }, exercises: { type: 'array', minItems: 6, maxItems: 6, items: exerciseSchema } } };
  const transcript = input.history.map(message => `${message.role === 'coach' ? 'Coach' : 'Learner'}: ${message.text}`).join('\n').slice(-12000);
  const prompt = `Create exactly six short English practice questions based on this conversation and its learner memory. Use two cloze, two meaning, and two grammar questions, mixed in order.
For each cloze: reuse a useful keyword from the conversation in a new natural sentence, replace only that keyword with _____, set answer to the keyword, initial to its first letter, and definition to a simple English explanation. options must be [].
For each meaning question: prompt is one useful word from the conversation, answer is its correct English definition, options contains exactly three English definitions including the answer, initial and definition are empty.
For each grammar question: prompt briefly asks the learner to choose the most natural sentence for an idea or pattern from their own conversation, answer is the correct complete sentence, options contains exactly three English sentences, initial and definition are empty. explanation briefly explains the grammar in plain English.
Do not test facts. Do not introduce unrelated advanced vocabulary. Keep everything in English.
Learner memory: ${JSON.stringify(input.memory)}\nConversation:\n${transcript}`;
  return coachRequest<{ title: string; exercises: CoachExercise[] }>(input.key, [{ role: 'system', content: 'You create concise, fair English practice from a learner\'s own conversation. Return only the requested JSON.' }, { role: 'user', content: prompt }], 'luna_session_practice', schema, input.signal);
}

const vocabularySchema = {
  type: 'object', additionalProperties: false, required: ['word', 'definition'],
  properties: { word: { type: 'string' }, definition: { type: 'string' } },
};
const grammarSchema = {
  type: 'object', additionalProperties: false, required: ['point', 'example'],
  properties: { point: { type: 'string' }, example: { type: 'string' } },
};

export async function coachDailySummaryDirect(input: { key: string; history: CoachMessage[]; memory: CoachMemory; existing?: CoachDailySummary; signal: AbortSignal }) {
  const mistakeSchema = {
    type: 'object', additionalProperties: false, required: ['original', 'better', 'reason'],
    properties: { original: { type: 'string' }, better: { type: 'string' }, reason: { type: 'string' } },
  };
  const schema = {
    type: 'object', additionalProperties: false, required: ['overview', 'mainFocus', 'likelyMistakes', 'vocabulary', 'grammar'],
    properties: {
      overview: { type: 'string' }, mainFocus: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      likelyMistakes: { type: 'array', items: mistakeSchema, maxItems: 4 },
      vocabulary: { type: 'array', items: vocabularySchema, maxItems: 6 },
      grammar: { type: 'array', items: grammarSchema, maxItems: 4 },
    },
  };
  const transcript = input.history.map(message => `${message.role === 'coach' ? 'Coach' : 'Learner'}: ${message.text}`).join('\n').slice(-14000);
  const prompt = `Create or update today's English learning recall from the conversation below. Write all learning content in clear English. Be specific, constructive, and concise.
Identify the learner's main weaknesses and useful next focus. Include only vocabulary and grammar grounded in this conversation. Vocabulary rows must contain an English word or short phrase and an English definition. Grammar rows must contain a named grammar point and one natural English example.
Some learner text may come from speech recognition. If an apparent error may be transcription noise, include it only as a likely mistake and say so in the reason. Never invent a mistake. Empty arrays are allowed when evidence is insufficient.
Learner memory: ${JSON.stringify(input.memory)}
Existing recall from earlier conversations today (merge rather than repeat): ${JSON.stringify(input.existing || null)}
Conversation:
${transcript}`;
  return coachRequest<Omit<CoachDailySummary, 'id' | 'date' | 'minutes'>>(input.key, [{ role: 'system', content: 'You make evidence-based daily English learning recalls. Return only the requested JSON.' }, { role: 'user', content: prompt }], 'luna_daily_recall', schema, input.signal);
}

export async function coachWeeklySummaryDirect(input: { key: string; daily: CoachDailySummary[]; signal: AbortSignal }) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['overview', 'progress', 'nextFocus', 'vocabulary', 'grammar'],
    properties: {
      overview: { type: 'string' }, progress: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      nextFocus: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      vocabulary: { type: 'array', items: vocabularySchema, maxItems: 10 },
      grammar: { type: 'array', items: grammarSchema, maxItems: 8 },
    },
  };
  const prompt = `Combine these daily English learning recalls into one weekly recall. Write everything in clear English. Show concrete progress, recurring weaknesses, and next priorities. Deduplicate vocabulary and grammar. Keep the most useful English definitions and English examples. Do not add claims unsupported by the daily records.
Daily recalls:
${JSON.stringify(input.daily).slice(0, 18000)}`;
  return coachRequest<Omit<CoachWeeklySummary, 'id' | 'startDate' | 'endDate' | 'minutes'>>(input.key, [{ role: 'system', content: 'You consolidate daily English recalls into a concise weekly learning record. Return only the requested JSON.' }, { role: 'user', content: prompt }], 'luna_weekly_recall', schema, input.signal);
}
