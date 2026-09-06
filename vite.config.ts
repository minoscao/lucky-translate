import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type ViteDevServer } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { Readable } from 'node:stream';
import { POST as translateLocally } from './app/api/translate/route';
import { POST as speakLocally } from './app/api/speech/route';
import { POST as createVoiceLocally } from './app/api/voice/route';
import { POST as checkKeyLocally } from './app/api/key/route';
import { DELETE as lockLocally, GET as checkAccessLocally, POST as unlockLocally } from './app/api/unlock/route';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  // Keep server-side OpenAI requests on a supported, stable cloud region.
  // Static assets remain globally distributed by Cloudflare.
  placement: { region: 'aws:us-east-1' },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      {
        name: 'lucky-local-translation',
        apply: 'serve',
        configureServer(server: ViteDevServer) {
          server.middlewares.use(async (req, res, next) => {
            const path = req.url?.split('?')[0];
            if (!['/api/translate', '/api/speech', '/api/voice', '/api/key', '/api/unlock'].includes(path || '')) return next();
            if (['/api/translate', '/api/speech', '/api/voice', '/api/key'].includes(path || '') && req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            if (path === '/api/unlock' && !['GET', 'POST', 'DELETE'].includes(req.method || '')) { res.writeHead(405); res.end(); return; }
            const abort = new AbortController(); req.on('aborted', () => abort.abort());
            try {
              const headers = new Headers();
              for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
              const hasBody = req.method === 'POST';
              const request = new Request(`http://${req.headers.host}${path}`, {
                method: req.method, headers, ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}), signal: abort.signal,
              } as RequestInit);
              const response = path === '/api/translate' ? await translateLocally(request) : path === '/api/speech' ? await speakLocally(request) : path === '/api/voice' ? await createVoiceLocally(request) : path === '/api/key' ? await checkKeyLocally(request) : req.method === 'GET' ? await checkAccessLocally(request) : req.method === 'DELETE' ? await lockLocally() : await unlockLocally(request);
              res.writeHead(response.status, Object.fromEntries(response.headers));
              res.end(Buffer.from(await response.arrayBuffer()));
            } catch { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '本机连接中断，请重试' })); }
          });
        },
      },
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
