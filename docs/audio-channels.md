# Audio channels and conversation response time

## Two input/output channels

Open **Translator → Set up audio channels** (also available in Settings).
Lucky scans the system's microphones and speakers as the panel opens, requesting
microphone permission when needed to read device names. **Scan system devices**
refreshes the shared inventory; hotplug events refresh it automatically.

Each channel has a language, a **Microphone** selector and a **Speaker** selector.
Selecting a device enables channel routing. Settings follow the language when
the conversation panels exchange positions.

| Channel | Language | Microphone | Speaker |
| --- | --- | --- | --- |
| 1 | English | USB microphone | Bluetooth headset |
| 2 | Chinese | Bluetooth microphone | Amplifier |

The speaking channel records its chosen microphone; its words are translated
and played on the other channel's speaker. **Test microphone** shows live input
level for five seconds, with a stop button. It never uploads or saves audio.
**Test speaker** plays a locally generated tone. Neither test uses AI tokens.

A selected microphone is requested with an exact device constraint, so a missing
input produces an error instead of recording another microphone. Channel capture
uses a fixed speaker identity instead of guessing direction from voice changes.
This release still records one microphone at a time using the existing recording
controls. It does not perform simultaneous speech-to-speech interpretation.

Audio choices are scoped to the current account workspace and browser tab. They
reset after reload or sign-out. Changing device assignments does not change the
operating system defaults. Settings are locked while a conversation request is
finishing. Playback stops when audio devices change or the page hides.

## Browser support

System discovery uses `enumerateDevices`, with a temporary permission stream
released immediately after enumeration, even on failure. Cameras are excluded.
Only devices exposed by the browser are listed. Some browsers additionally need
output permission through **Allow another speaker** (`selectAudioOutput`).

Separate speakers require `HTMLMediaElement.setSinkId` and permission. Unsupported
browsers retain microphone selection and clearly mark speaker selection unavailable.
A failed selected output is never silently replaced with another device.

Left/right headset playback remains under **Advanced speaker options**. This is
separate from the two input/output channels. It mixes audio to mono and writes
only the selected side of a stereo WAV; disable system mono mixing to use it.

References: [System device inventory](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices),
[Output device selection](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId),
[Output permissions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/selectAudioOutput).

## Coach response time

The original path waits sequentially for transcription, complete model JSON
(reply and memory), accounting, complete speech synthesis, and playback.
Coach recording uses hold mode: the translator's five-second continuous-silence
threshold does not explain this delay.

Read-only production event analysis on 2026-09-13, covering the previous seven
days and adjacent events within 30 seconds:

| Event interval | Samples | Average | Range |
| --- | ---: | ---: | ---: |
| Coach transcription recorded → model usage recorded | 64 | 2.35 s | 1.78–3.79 s |
| Coach conversation charge recorded → speech cost recorded | 54 | 2.50 s | 1.30–8.38 s |

These are event intervals, not isolated inference measurements or matched
end-to-end trials. They include request transit and accounting and do not measure
microphone release or the moment sound starts on a phone.

Coach now synthesizes a complete first sentence separately when an appropriate
boundary exists, and prepares the remaining text while that sentence plays.
Every generated character is retained. Only one further segment is prefetched.
Model validation, memory, skill rules, actual token recording, and quota rules
are unchanged. Service key loading and quota checks also run concurrently before
any model request. Speech service cost is recorded for each synthesized segment.

`Server-Timing` headers expose recognition, reply, synthesis, and route-total
durations for subsequent diagnosis without logging conversation contents.
Reply duration includes quota checks and token accounting. For raw audio
responses, synthesis timing ends when the provider response is available and
does not include the remaining streamed download or device playback.

## Verification boundaries

Automated tests cover stereo sample isolation, output selection failures,
unchanged speech text, early first-segment playback, ordered playback,
prefetch failure, and cancellation. Browser control was unavailable during this
change. Physical Bluetooth/amplifier routing, mobile autoplay, audible continuity,
and before/after phone latency still require device testing. No two-second
response guarantee has been established.
