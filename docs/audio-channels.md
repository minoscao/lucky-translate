# Audio channels and conversation response time

## Listener routing

Open **Translator → Set up audio channels** (also available in Settings).
Enable **Dual-channel interpretation**, then assign an output to each language.
The assignment follows the language when the two panels exchange positions.

Examples:

| Listener language | Playback device | Channel |
| --- | --- | --- |
| English | Bluetooth headset | Both |
| Chinese | Speakers / amplifier | Both |
| English | Shared stereo headset | Left only |
| Chinese | Shared stereo headset | Right only |

Connect the hardware using the operating system before choosing it in Lucky.
Use **Find devices** to grant browser access and **Test sound** to check each
listener's output. Test tones are generated locally and use no AI tokens.
For a shared headset, disable the operating system's mono audio setting.

This release uses the existing microphone and phrase-based translation:
hold the speaking person's button, then release to translate and play the other
language. It does not capture two microphones simultaneously or perform
simultaneous speech-to-speech interpretation. Existing continuous recording
behavior remains unchanged.

Audio choices are scoped to the current account workspace and browser tab.
They are reset after reload or sign-out. Selecting a device does not change the
system's default output. A failed selected output is not silently replaced with
another output. Playback stops on output-device changes and when the page hides.

## Browser support

Separate hardware outputs require `HTMLMediaElement.setSinkId`, output permission,
and outputs exposed by the operating system. Device discovery uses
`selectAudioOutput` when available; otherwise it requests microphone permission
briefly to enumerate permitted devices, immediately releasing that microphone.
Unsupported browsers show system output and left/right channel options. They
cannot be made to connect two independent Bluetooth devices by website code.

Left/right routing mixes the audio to mono and writes it only to the selected
channel of a stereo WAV; the opposite channel contains silence. This requires
stereo playback and browser audio decoding. The operating system may still
apply mono mixing or hardware-specific routing.

References: [Output device selection](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId),
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
