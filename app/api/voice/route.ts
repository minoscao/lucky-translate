import { json } from '@/lib/server/http';

export async function POST() { return json({ error: '当前版本使用 Cloudflare 语音，不再需要客户录制或保存声音样本' }, 410); }
