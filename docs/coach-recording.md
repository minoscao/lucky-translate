# Coach voice-message duration

Coach voice messages now allow 120 seconds of microphone audio per message.
This is a per-message limit, independent of membership conversation allowances.
The timer starts with audio processing, excluding the permission prompt. It
includes pauses, even though leading silence is not included in the sent WAV.
The last ten seconds show a red microphone button and a visible countdown.
At the limit the processor stops accepting samples and the controller sends
the buffered message once. If the user is sliding up to cancel, it discards it.
Manual send/cancel and account-switch cancellation keep their existing behavior.

Previously `/api/transcribe` accepted at most 1 MiB, equivalent to about 32.77
seconds of 16 kHz mono PCM16 WAV. The recorder did not expose this constraint,
so longer recordings were rejected only on submission. This explains the old
near-30-second ceiling; it does not prove why a truly shorter recording failed.

`lib/recording-limits.ts` is shared by the Coach controller and upload validation.
The recorder passes its configured limit to the audio worklet. Uploaded bodies
are read with a byte cap whether or not Content-Length is present; both oversized
paths report the same English error. Other recording modes retain their existing
limits. The latest learner message is no longer silently cut to 1,000 characters
before reaching Coach. Older prompt history retains its previous size bounds.

Validation: 78 automated tests pass. Coverage includes 29/30/35/60/120-second
uploads, exact audio limits at 44.1 and 48 kHz, single automatic submission,
cancellation at the limit, each countdown second, full latest-message text,
and unchanged account isolation. The provider is stubbed in upload tests;
these do not establish live transcription accuracy or turnaround time for
a two-minute recording. The existing provider model and billing are unchanged.
The actual Coach component's red countdown was visually checked at a 360-pixel
Chrome viewport, without overflow or console errors. This is desktop browser
emulation, not a physical Android recording test.
