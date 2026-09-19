# Earlier Coach replies

The old chat path waited for all JSON fields, usage recording and membership
accounting before displaying a reply or preparing its speech. Chat now uses
SSE with final provider usage enabled. A complete first `reply` string is
checked with the existing language guard and sent early; tip and memory can
finish while the client displays the reply and starts speech.

The final validated result remains the source for persistence, memory and
accounting. The preview and final result share one message ID and do not trigger
speech twice. Failed, interrupted and cancelled requests keep their existing
isolation boundaries. Provider usage comes from the final usage event, never
from a character or time conversion. Invalid output after an emitted preview
is not automatically retried with a different spoken reply. Other Coach tasks
keep the existing JSON response path. The saved skill is unchanged.

This change does not select a new speech provider. Speech-provider selection
is a separate decision because its pricing changes.

## Validation

Tests cover split UTF-8/SSE boundaries, early reply versus final usage timing,
incomplete streams, failed-output accounting, no duplicate speech/history, and
account isolation. Browser checks also verified streaming and cached playback
of a real generated WAV containing an open-ended data-length marker, with one
download for two playbacks and no browser console errors. This is a desktop
Chrome mobile viewport check, not a physical Android sound test.
