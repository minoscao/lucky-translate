# Usage and service costs

The customer dashboard, admin customer dashboard, directory overview and directory rows read the same server aggregation. Today, this month and all time use Asia/Shanghai calendar boundaries. Open dashboards refresh every five seconds after request records are saved.

## Separate services

| Service | Usage source | Cost source |
| --- | --- | --- |
| AI text | Provider-reported tokens for conversation, translation, assessments and recaps | Each event's saved cost |
| Speech recognition | Submitted audio seconds from the event snapshot | Each event's saved cost |
| Speech generation | Estimated generated seconds from text length, explicitly marked estimated | Each event's saved cost |
| Other services | Recorded requests when present | Each event's saved cost |

Audio has no fabricated token equivalent. Audio minutes are not added to the text-based membership minutes. Cached replay adds no cloud synthesis event; each newly generated segment does. Unknown durations remain visible as missing and do not erase the event's cost. Membership accounting events are excluded. All other event costs appear exactly once, including recorded failed model attempts. Historical costs are never recalculated using today's prices.

## Rates and limitations

Checked 2026-09-13 against Cloudflare model documentation:

- [MeloTTS](https://developers.cloudflare.com/workers-ai/models/melotts/): $0.0002 per generated audio minute ($0.012 per hour).
- [Whisper large v3 turbo](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/): $0.00051 per input audio minute.

The UI says **Estimated cost**, because these are per-request allocations, not imported provider invoices. Allowances, discounts, taxes, infrastructure and unrecorded provider charges are not included. TTS currently estimates duration as `max(1, text.length / 12)` seconds; it must not be presented as exact audio duration. New TTS snapshots also explicitly mark `durationSource: text_estimate`. Changing this calculation to measured output duration is separate work; the streaming playback path must not wait for a full download to measure it.

Costs are summed in stored integer USD millionths, retaining tiny audio costs in the display. No quota, points, language behavior, provider rate, streaming or caching behavior is changed by the breakdown.
