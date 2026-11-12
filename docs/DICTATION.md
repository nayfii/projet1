# Voice dictation (V1.1, phase 7)

The microphone in the message box (and in long fields in the apps). The person speaks; the text appears
while they talk; when they stop, the text is in the box, ready to read and edit. Files:
`src/modules/dictation/` (`segments.ts`, `cleanup.ts`, `timing.ts`, `ui/dictation-button.tsx`),
`src/app/api/dictation/route.ts` (one part → its text), `src/app/api/dictation/clean/route.ts` (polish).

## How it works now

1. **Click.** The recording bar shows at once (grey dot, "Ouverture du micro…") while the browser opens
   the microphone. The first time, the browser asks for permission. The dot turns red when the
   microphone is really listening. Cancelling before that leaves no open microphone.
2. **Parts.** The voice level is read every 60 ms. A part ends at a pause of 380 ms. The first part can
   end after 1.2 s, so the first words show quickly; later parts last at least 2 s. From 10 s, a short
   pause of 150 ms is enough. Without any pause, a part ends at 18 s.
3. **Parallel transcription.** Each part goes to `/api/dictation` as soon as it is recorded. It does not
   wait for the parts before it. As a hint, it carries what the earlier parts said, waiting at most
   0.6 s for the part just before. The text always keeps the order of the parts.
4. **Server.** The checks run side by side:
   - sign-in;
   - the company's switch;
   - credits;
   - the per-minute rate;
   - reading the upload.

   Then OpenAI's transcription model runs (`DICTATION_MODEL`, default `gpt-4o-transcribe`). Usage is
   written after the answer has left (`after()`). The answer carries a `Server-Timing` header with
   durations only: checks, model, total.
5. **Stop.** The text goes into the box **at once**, cleaned by our own rules (hesitations, words said
   twice, spaces, capitals; `tidyDictation`). The polished version then follows (punctuation, the
   person's own corrections) from a fast OpenAI model the company allows. It replaces the text **only
   if the box has not changed at all** since the text was delivered: the person's typing and caret are
   never disturbed. "Voir l'original" puts the transcript back.
6. **Send arrow.** The text is sent at once. It waits at most 2.5 s for the polished version, otherwise
   our own rules' version is sent. A text with a missing part is never sent unread: it goes into the
   box instead.

## Audit: what made it slow (before)

| Cause | Effect | Change |
|---|---|---|
| A part lasted at least 2.5 s and needed a 450 ms pause | The first words appeared only after the first pause that came 2.5 s or more after the start | The first part can end after 1.2 s; the pause is 380 ms; later parts last at least 2 s |
| The "polish" call (an extra model) ran **before** the text reached the box | Stop → text took the time of the last part's transcription **plus** the polish | The text goes into the box at once; the polish follows and replaces the text only if it is untouched |
| Parts were transcribed one after the other (a chain) | A slow part held up the next ones, including the last one after Stop | Each part is transcribed as soon as it is recorded |
| The server ran its checks one after the other, and wrote usage before answering | Several database round trips per part | Checks run side by side; usage is written after the answer |
| No time limit on a part's request | A stalled connection left the "Transcription…" state forever | Each part gives up after 45 s; one retry after 0.4 s |
| No feedback before the microphone was open | The click seemed to do nothing for a moment (much longer the first time, while the browser asks for permission) | The bar shows at once |
| Audio sent at the browser's default bitrate | Larger uploads on a weak connection | Opus at 32 kbit/s, enough for speech |

Not causes, checked:

- capture: the recorder starts in about 20 ms with an open microphone;
- the file sizes of short parts;
- the work done in the browser.

**Streaming.** OpenAI offers live transcription through its Realtime API. The installed AI SDK
(`experimental_streamTranscribe`) uses it over a WebSocket, fed with raw PCM audio. It is **not
compatible with our architecture today**. Our server runs as Vercel functions, which cannot receive a
continuous audio stream from the browser. The browser cannot open that connection itself either,
unless we hand out temporary OpenAI keys to browsers, which changes the data flow and how credits are
counted. Cutting at the person's pauses gives live text without that change. If we revisit it, it
needs a working OpenAI key, measurements and a security review.

**Model.** We keep `gpt-4o-transcribe` for accuracy. `DICTATION_MODEL=gpt-4o-mini-transcribe` is a
faster and cheaper option, but its speed and accuracy on our audio have not been measured.

## Measurements (before → after)

How they were taken:

- a real Chromium on this development machine;
- the page's own timing marks (`cendr:dictation:*`, durations only, never any content);
- the e2e benchmark `e2e/dictation-speed.spec.ts` (run on demand: `DICTATION_BENCH=1`);
- Chromium's fake microphone playing a **synthetic voice**: bursts of a voiced sound with pauses
  between phrases;
- the **transcription model is simulated**: either instantly, or with a fixed 800 ms per part
  (`DICTATION_FAKE_LATENCY_MS`, honoured only in test mode). The polish takes the same 800 ms in the
  "before" version, where it delayed the text.

The person stops 8 s after clicking. There were 8 recordings per row (6 for the rows with an instant
model) and **no failures in any run**. "Before" is the previous version with the same timing marks
added.

| Median | Scenario | Before | After |
|---|---|---|---|
| Click → bar on screen | all | after the microphone opened | at once (same render as the click) |
| Click → microphone listening | all (fake microphone) | 20–26 ms | 20–22 ms |
| Click → first words | phrases of ~3 s, model 800 ms | 3.40 s | 3.20 s |
| Click → first words | short opening then phrases, model 800 ms | **5.32 s** | **2.72 s** |
| Click → first words | phrases of ~3 s, instant model | 2.60 s | 2.41 s |
| Stop → text in the box | model 800 ms | **1.70 s** | **0.85 s** |
| Stop → text in the box | instant model | 87 ms | 47 ms |
| Server checks per part | local database | 29–31 ms | 19–20 ms |

What these numbers mean:

- After Stop, the text now waits only for the last part's transcription. Before, it waited for the
  transcription **plus** the polish.
- The first words come as soon as the person makes a first short pause, from 1.2 s on.
- These are measurements of **our pipeline**, with a simulated model and a synthetic voice. The real
  model's speed has **not** been measured here: the OpenAI key in this environment has no credit
  (429).
- With a real model, the real gains depend on the model's speed and on how people speak.
- We do **not** claim parity with ChatGPT: there has been no comparable measurement.

To measure with the real model once a working OpenAI key is in place, start the app with
`AI_FAKE_PROVIDER` unset and a real microphone, then read the `cendr:dictation:*` marks and the
`Server-Timing` header in the browser's performance tools.

## Reliability tests

**Tested in a real browser** (`e2e/dictation.spec.ts`):

- the bar shows at once;
- cancelling while the microphone opens, with no microphone left open;
- a refused microphone, then a missing microphone, each with a clear message;
- the first words while talking;
- the text in the box at once, editable;
- dictating again after existing text;
- the polished version replaces only an untouched text;
- "Voir l'original";
- a cut network: one retry, a message, then the next dictation works;
- Stop while parts are still being transcribed: nothing lost, in order;
- a phone (Pixel 7 emulation): the bar fits, the text arrives.

**Also covered elsewhere:**

- push-to-talk, Escape, the send arrow, app fields: `e2e/chat-ux.spec.ts`;
- the company's switch: `e2e/step12.spec.ts`;
- the endpoint itself, against the real database (`tests/integration/dictation-route.test.ts`):
  - signed out;
  - switched off before any transcription;
  - credits used up before any transcription, with the blocked request logged;
  - a file that is not audio;
  - a claimed duration over the limit;
  - `Server-Timing`;
  - usage recorded without the text.
- segmentation rules: `tests/unit/dictation.test.ts`.

**Not tested here: these need the real model and real voices.** The accuracy in French, in English and
when switching languages, long sentences, punctuation, reasonable background noise, and a real phone's
microphone. Hide still masks the text before any chat model. The voice itself reaches OpenAI unmasked
(docs/SECURITY.md).
