export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const validEmail = (value: string) => value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value) && value.split('@')[0].length <= 64 && !value.startsWith('.') && !value.includes('..') && !value.includes('.@');
export const validUsername = (value: string) => /^[\p{L}\p{N}_.-]{2,24}$/u.test(value);
export const validVerificationCode = (value: string) => /^\d{6}$/.test(value);
