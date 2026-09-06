declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AI?: Ai;
  }
}

interface Ai {
  run(model: string, input: unknown, options?: { returnRawResponse?: boolean }): Promise<unknown>;
}
