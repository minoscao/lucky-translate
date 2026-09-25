const limitMessages: Record<string, string> = {
  daily_token_limit: 'Your daily AI service allowance has been used up. This is separate from your fish balance. Please return tomorrow (China time), or ask the administrator to increase this allowance.',
  monthly_token_limit: 'Your monthly AI service allowance has been used up. This is separate from your fish balance. Please return next month (China time), or ask the administrator to increase this allowance.',
  daily_time_limit: 'You have used all of today’s fish allowance. Please return tomorrow (China time), or ask the administrator to increase your allowance.',
  monthly_time_limit: 'You have used all of this month’s fish allowance. Please return next month (China time), or ask the administrator to increase your allowance.',
  provider_busy: 'The AI service is temporarily busy. Please try again shortly. No fish were used for this request.',
};

export function coachServiceError(cause: unknown, streaming = false) {
  const failure = cause as { status?: number; code?: string } | null;
  const status = failure?.status || 500;
  const code = failure?.code;
  const error = status === 429 && code && Object.hasOwn(limitMessages, code)
    ? limitMessages[code]
    : status === 401 || status === 409
      ? 'Please sign in again to continue.'
      : streaming
        ? 'Lucky could not finish saving this reply. Please try again.'
        : 'Lucky could not finish this reply. Please try again. No fish were used.';
  return { status, code, error };
}
