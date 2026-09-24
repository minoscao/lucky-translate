# Coach voice conversation and correction display

Double-tap the main microphone, or choose **Start voice conversation**. A single tap still starts a manual message; holding and sliding up retain send/cancel behavior. Entering conversation discards the short first-tap recording.

The microphone remains open during recognition, reply generation and playback. Confirmed sound onset cancels the previous pending request and playback; stale completions cannot play later. A roughly 0.95-second pause sends the utterance. Exit, navigation, hidden tab, page exit and account disposal stop capture. Utterances are split below the upload limit, without ending the mode.

Capture requests browser echo cancellation, noise suppression and automatic gain control. The worklet uses a noise floor, a minimum sustained signal, high-frequency noise rejection, pre-roll and a stricter onset during playback. These are sound heuristics, not speaker identification or a neural speech detector. Nearby speech, music and strong echo can still trigger a turn; hardware testing is required for each phone/audio route. ASR and model calls still occur after the pause; this change alone does not promise one-second speech responses.

Corrections use `{original, corrected}` on the coach message. Annotations are accepted only when the original occurs literally in the preceding learner text and the correction occurs in the spoken reply. Original text remains unchanged. Character differences are colored red/green; the corrected phrase is bold. Missing suffixes mark the original word red and just the added suffix green. No HTML from the model is rendered.

Recaps validate their full display fields and distinguish daily from weekly tasks. A new recap is saved and shown before older daily records are consolidated. Consolidation failure retains the daily records. The retry view provides access to today's saved recap.
