# Local English voice download

Coach uses an on-device Piper / ONNX voice. Translation retains its existing speech path.

## First entry

After sign-in and onboarding, missing voice assets open the shared English download dialog. The user explicitly downloads the 96.6 MB pack or continues in text. Automatic replies respect text mode; tapping a speaker opens setup again.

Progress is downloaded bytes divided by the manifest byte total. After 100%, the UI shows preparation until model initialization and a real warmup inference finish. Errors offer retry. Two assets download concurrently; completed, hash-validated assets are reused. Corrupt assets are downloaded again. Complete browser cache starts the engine on the next visit without the initial download prompt. Browser eviction or clearing storage can require download again.

## Implementation

- `components/voice-setup.tsx`: shared Dialog / Button UI.
- `lib/voice-pack.ts`: manifest, streaming transfer, SHA-256 validation, Cache Storage.
- `lib/local-voice.worker.ts`: local model initialization and inference.
- `lib/local-speech.ts`: worker states, gesture-unlocked AudioContext, playback / cancellation.
- `public/local-voice/v1`: versioned model/runtime, manifest and license notices. Include this directory in Git releases; manual deployment alone was overwritten by later builds.

Voice synthesis makes no cloud TTS request. Chat and speech recognition keep their existing metering. Text and generated audio are not written to the persistent voice cache.

## Verification — 2026-09-25

116 Node tests passed, including actual-byte progress, interrupted retry, cache reuse, corruption recovery, unavailable storage and preparing-versus-ready state. TypeScript check and Cloudflare production build passed. Chrome at 360x732 downloaded all ten real assets, showed intermediate percentages and preparation, completed local English playback, and reloaded to ready without another asset download. No browser console errors in the production preview. Physical Android hardware has not been tested in this run.

The vinext development overlay currently injects a window-only module into workers; use a production build served by Wrangler for real worker verification. The temporary voice-check route is excluded from the release.
