# Speech startup and replay

## Findings

Previously every speaker-button press called `/api/speech` again. Even a reply
that had just played was synthesized and downloaded again. The client then
waited for `response.blob()` to finish before starting sound. Coach's earlier
sentence split helped synthesis size but retained this full-download barrier.

Production probes on 2026-09-13 used original diagnostic sentences and a
temporary account that was removed after the probe. These are single network
samples from this computer, not Android measurements:

| Input | Synthesis | Server total | First response byte | Full audio received |
| --- | ---: | ---: | ---: | ---: |
| 21 characters | 1.03 s | 1.57 s | 2.73 s | 4.17 s |
| 164 characters | 0.86 s | 1.70 s | 2.49 s | 10.36 s |

The longer audio was 743,782 bytes. Two later short-phrase requests returned
502 from the speech route, and a direct provider probe returned 500. This is
evidence of intermittent upstream failure, not a verified explanation for every
reported delay. Playback errors previously went to translator state and were
not visible in Coach. They now appear in Coach with a retry instruction.

## Changes

- Coach starts PCM WAV playback incrementally as network chunks arrive, using
  Web Audio. Complete sample frames are scheduled in order; supported PCM16,
  PCM24, PCM32 and float32 WAV preserve their source sample rate and channels.
  Unknown formats fall back to browser decoding after the full download.
- Each account workspace owns a memory-only LRU audio cache (16 MiB, 24 entries).
  Pending requests are shared. Replay avoids synthesis, download and duplicate
  usage updates. Speed and output routing are applied after retrieving audio.
  Cache content is not written to storage and is cleared on workspace unmount.
- Stopping playback immediately stops sound and unsubscribes the player. An
  already-started download can finish into the account cache, allowing immediate
  replay; signing out aborts it. A failed synthesis is evicted so retry can work.
- Brief first sentences are allowed to start separately from the rest. The next
  segment is prefetched once sound starts. Spoken words and order are retained;
  visual bold markers are removed consistently for automatic and manual playback.
- Preparing voice, actual playback, cancellation and playback errors are visible
  in Coach. The pet no longer claims to be speaking while awaiting audio.

The speech model, Coach model, prompts and account billing rules are unchanged.
This does not remove speech recognition, reply-generation, network first-byte
latency or provider outages. It does not guarantee an end-to-end two-second reply.

## Validation

84 automated tests pass, including arbitrary WAV chunk boundaries, float WAV
metadata, exact samples, scheduling before download completion, no overlapping
buffers, cancellation, in-flight reuse, replay, account cleanup, eviction and
retry. Chrome with a mobile viewport also ran the actual player against a
controlled slow stream: first sound was scheduled at 127 ms, roughly 870 ms
before download completion. This controlled result is not a production speed
claim. Physical Android/Chrome playback and audible continuity still need the
user's device test.
