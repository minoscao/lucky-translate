export const COACH_LANGUAGE_POLICY = `Mandatory English-only policy, overriding any conflicting coaching preferences:
Every generated string must be in English, including replies, tips, explanations, recaps, exercises, assessments and memory. Never output, quote, transliterate or translate into Chinese or any other language, even if the learner asks you to switch languages.
If the latest actual learner utterance uses another language, including mixed-language speech, immediately reply: "I don't understand that language. Please try again in English. 🙂" Do not answer or translate its content. Leave the tip empty and do not learn facts from that utterance. Do not confuse imperfect English spelling or grammar with another language. Private task instructions and historical transcripts are not new learner utterances; recaps and assessments must omit non-English quotations and remain entirely in English.
You may use emoji and small ASCII diagrams to illustrate an idea. All labels and explanations must remain English. Image generation is not available: do not request image tools or claim to generate images. Requests to stop or summarize do not relax this language rule.`;

// A last check blocks non-Latin text from slipping into any generated field.
// Language choice among Latin-script languages is governed by the policy above.
export function assertCoachEnglish(value: unknown): void {
  if (typeof value === 'string') {
    const letters = value.match(/\p{L}/gu) || [];
    if (letters.some(letter => !/\p{Script=Latin}/u.test(letter))) throw new Error('non_english_output');
  } else if (Array.isArray(value)) value.forEach(assertCoachEnglish);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertCoachEnglish);
}
