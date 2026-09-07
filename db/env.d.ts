declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AI?: Ai;
    EMAIL?: { send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown> };
  }
}

interface Ai {
  run(model: string, input: unknown, options?: { returnRawResponse?: boolean }): Promise<unknown>;
}
