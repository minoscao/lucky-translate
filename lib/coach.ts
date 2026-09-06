export type CoachRole = 'learner' | 'coach';
export type CoachMessage = { id: number; role: CoachRole; text: string };
export type CoachMemory = { level: string; topics: string[]; strengths: string[]; focus: string[]; phrases: string[] };
export type CoachExercise = {
  type: 'cloze' | 'meaning' | 'grammar'; prompt: string; answer: string;
  initial: string; definition: string; options: string[]; explanation: string;
};
export type CoachUsage = { tokens: number; cost: number };

export const EMPTY_COACH_MEMORY: CoachMemory = { level: 'discovering', topics: [], strengths: [], focus: [], phrases: [] };

const COACH_RULES = `You are Luna, an affectionate and adaptive English conversation coach. Practice is in English only. Follow the learner's real topic and latest clear intent. This is a natural conversation, never a quiz or a grammar lecture. Help the learner speak more with the smallest useful prompt.
Start below the learner's presumed level and increase difficulty only when their answers show readiness. A word, greeting, playful text, or unclear reply is normal conversation: respond naturally and invite one easy detail. Do not use a cloze for one short reply. Only after two or more consecutive short topic replies may you use one expansion scaffold, and only with a phrase or structure already present in memory or taught earlier in this conversation. Never provide the completed scaffold answer.
For a complete sentence, mention one specific strength and ask exactly one natural next detail, reason, feeling, time, place, or example. Correct at most one meaningful issue when it helps the current conversation, then return the turn to the learner. Never rewrite the learner's whole answer. Use simple English for explanations unless the learner explicitly asks for another language. Keep reply under 55 words and tip under 20 words. Update compact learner memory without sounding as if you are reading a database.`;

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

function usageCost(usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }): CoachUsage {
  const input = Math.max(0, usage?.prompt_tokens || 0), output = Math.max(0, usage?.completion_tokens || 0);
  const cached = Math.min(input, Math.max(0, usage?.prompt_tokens_details?.cached_tokens || 0));
  return { tokens: usage?.total_tokens || input + output, cost: ((input - cached) * .15 + cached * .075 + output * .6) / 1_000_000 };
}

async function coachRequest<T>(key: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, schemaName: string, schema: object, signal: AbortSignal): Promise<{ data: T; usage: CoachUsage }> {
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 1800, response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } } }),
    });
  } catch { throw new Error('无法连接 English Coach，请检查网络'); }
  if (!response.ok) {
    if (response.status === 401) throw new Error('OpenAI 密钥无效，请在设置中重新填写');
    if (response.status === 403) throw new Error('当前网络或账户无法使用 English Coach');
    if (response.status === 429) throw new Error('OpenAI 额度不足或请求较多');
    throw new Error('English Coach 暂时无法回应');
  }
  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: Parameters<typeof usageCost>[0] };
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error('English Coach 没有返回完整内容');
  try { return { data: JSON.parse(content) as T, usage: usageCost(result.usage) }; }
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
