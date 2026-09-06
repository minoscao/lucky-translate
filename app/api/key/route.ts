import { json } from '@/lib/server/http';

export async function POST() { return json({ error: '服务密钥由管理员统一配置，客户不需要填写' }, 410); }
