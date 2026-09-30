# WALL PUSH — video avatars · work handoff

Everything needed to pick this up in a fresh chat. Read this file first.

---

## 0. The 60-second version

The GO WILD game shows a "wall push" duel. The avatars used to be two flat
`<img>` sprites, so they could only slide around. They are now **pre-rendered
video clips**: a correct answer plays that seat's push clip, and the answer that
reaches two correct answers plays the break clip and drops the losing seat.

The integration is **written and verified working**, but it is **not live** —
I reverted it off GitHub at the user's request. It lives on branch
`feat/wall-push-video` in the local clone.

**Only 2 of 13 avatars have clips so far** (pumpkin-boy, ninja) plus one fall
clip (ninja). Generating the rest is the main outstanding job.

---

## 1. Repos, branches, URLs — get these right first

| what | value |
|---|---|
| source repo | `https://github.com/damimasalanews-spec/champho` |
| **deploy branch** | **`fresh/go-wild-2v2-finished`** |
| live site | `https://champword-go-wild-2v2.onrender.com/` |
| entry page | `go-wild-2v2-finished.html` (NOT `go-wild-2v2.html`) |
| local clone | `C:\Users\fanso\AccioWork\2026-09-30-00-27-10-099-37804b95\champho` |

### ⚠️ The trap that cost the most time

`go-wild-2v2.html` and `go-wild-2v2-finished.html` are **different files**, and
the live site only loads `-finished`. My earlier local clone was on a branch
(`feat/wall-push-3d-fighters`, off `main`) that **does not contain
`game/wall-push-guess.js` at all** — the very file that implements the
correct-answer mechanic. Hours went into editing a page the live game never
loads.

**Before changing anything, confirm:**
```bash
cd <clone>
git fetch origin
git checkout -B feat/wall-push-video origin/fresh/go-wild-2v2-finished
ls game/wall-push-guess.js     # must exist, ~27.5 KB
```
On `origin/main` it does **not** exist. If it's missing you are on the wrong branch.

### Current git state (as of handoff)

- `origin/fresh/go-wild-2v2-finished` → `a2f2007` (a revert; content identical to `60c2526`)
- `feat/wall-push-video` (local, **unpushed**) → has the film integration
- `60c2526` is the clean pre-change base of the deploy branch

---

## 2. The game mechanic — already existed, do not rebuild it

From `game/wall-push-guess.js`:

```js
const ROUNDS    = 4;      /* four cliparts in a duel */
const NEED      = 2;      /* first to two correct answers takes the wall */
const SHOVE_MS  = 1150;   /* beat between a shove and the next picture */
const FINISH_MS = 1000;   /* beat between the winning answer and the knockout */
```

Each correct answer shoves the slab one step toward the opponent. The first
duelist to **two** correct answers drives it home — that is the knockout.
A duel can therefore finish at question 2 (2–0), 3 (2–1) or 4, so **between one
and three shoves** happen before the knockout. The film needs no special case
for that: each correct answer = one push beat; the answer that hits `NEED` =
break + fall.

### The two hook points (already wired on `feat/wall-push-video`)

```js
// in the correct-answer handler, right after arena.steps(net)
if (arena && arena.film) arena.film(by);          // plays that seat's push clip

const decided = tally[by] >= NEED;
if (decided) {
  if (arena && arena.breaker) arena.breaker(by);  // break clip + loser's fall
```

---

## 3. Code changes (branch `feat/wall-push-video`)

Three files touched. A ready-made patch is in `code/wall-push-film.patch`.

**`game/wall-push.js`**
- added `<video id="wpFilm" muted playsinline preload="auto">` into the arena markup
- added `film(side)` and `breaker(side)` to the object returned by `standoff()`
- `film()` plays that seat's push clip; `breaker()` plays the break clip then
  adds a fall class to the losing seat
- exports the handle as before, so nothing else breaks

**`game/wall-push-guess.js`** — the two lines above.

**`game/wall-push.css`** — film covers the felt/floor/fighters/slab; name plates
and meters stay above it as HUD so the guess deck keeps working; losing seat
drops via `@keyframes wpFilmFall`.

### Verified working (real browser, not assumed)

Started a duel, answered two cliparts correctly (`fish`, then `boat`):

```json
{"stageClass":"film film-fall-b",
 "video":{"src":"pumpkin-boy-break.mp4","readyState":4,"paused":true,
          "t":2.46,"w":1344,"h":768,"err":null}}
```

Film mode engaged, the fall class landed on the seat that **lost**, the clip
decoded to full duration, frames sampled off a canvas returned real picture
(avg luma 64.6) rather than black, all media `200`/`206`, no console errors.

---

## 4. Video assets — what exists

### Generated so far (video_generate_submit)

| avatar | kind | task id | state |
|---|---|---|---|
| pumpkin-boy | push/break source | `447148204077431` | delivered ✓ |
| pumpkin-girl | push/break source | `447151649968697` | submitted, **never delivered** |
| knight | push/break source | `447155700109782` | submitted, **never delivered** |
| ninja | push/break source | `447156248912393` | delivered ✓ |
| pirate | push/break source | `447154939068916` | delivered ✓ |
| vampire | push/break source | `447155374264813` | delivered ✓ |
| ninja | **fall** | `447173438353756` | delivered ✓ |
| pumpkin-boy | **fall** | — | `SUBMISSION_OUTCOME_UNKNOWN` |
| pumpkin-girl | **fall** | — | `SUBMISSION_OUTCOME_UNKNOWN` |

Downloaded originals are in `video/source-clips/`. Note `ninja-fall.mp4` is the
only fall clip that exists.

### Trimmed for the game beats

In `video/trimmed-beats/`. Cut windows were taken from each clip's measured
frame-difference profile (ninja spikes at 4.46 s; pumpkin-boy changes hardest at
4.04 s and 5.00 s), not guessed.

| clip | length | game beat |
|---|---|---|
| `pumpkin-boy-push.mp4` | 1.17 s | `SHOVE_MS` 1.15 s |
| `ninja-push.mp4` | 1.13 s | `SHOVE_MS` 1.15 s |
| `pumpkin-boy-break.mp4` | 0.96 s | `FINISH_MS` 1.0 s |
| `ninja-break.mp4` | 1.00 s | `FINISH_MS` 1.0 s |

**Clip lengths must match those beats** or the film lags behind the questions.
Any new push clip must be re-cut to ~1.15 s.

---

## 5. How the clips are made (reproduce exactly)

### Step 1 — build a first frame, in the game's arena format

```bash
python scripts/_firstframes.py      # writes first-frames/<key>-start.png  (13 avatars)
python scripts/make_duel_frame.py   # writes duel-frames/<a>-vs-<b>.png    (both fighters)
```

These are code-drawn: dark blue arena, brick wall, the fighter braced with hands
on the wall, name plate. Handing the model this frame is what keeps the clips
consistent — it does not have to invent a scene.

**Then upload it to get a public HTTPS URL**: `read` the PNG; the result includes
a `https://sc02.alicdn.com/...` URL. That URL is what goes in `image_url`.

### Step 2 — submit image-to-video

**Working configuration (use exactly this):**
```
provider   google-veo ✗        minimax ✓
mode       i2v
duration   6
resolution 2K            (veo only accepts 720P/1080P)
ratio      16:9
```

`google-veo` fails on these assets with
`Video first-frame image could not be downloaded`, and only accepts 720P/1080P.

### Step 3 — trim to the beat

```bash
ffmpeg -y -ss 3.55 -i ninja.mp4 -t 1.15 -an -c:v libx264 -preset slow \
  -crf 20 -pix_fmt yuv420p -movflags +faststart ninja-push.mp4
```

`-movflags +faststart` matters — it puts `moov` at the front so the browser can
start playing before the whole file arrives. Verify with:
```bash
python scripts/_cut_scan.py     # prints the motion profile + top change points
```

---

## 6. ⚠️ Submission rules — learned the hard way

**Submit ONE video at a time. Never in parallel.**

| attempt | result |
|---|---|
| 12 in parallel | all `CONFIRMATION_TIMEOUT`, **nothing created** |
| 3 in parallel | 3 × `CONFIRMATION_TIMEOUT` |
| 2 in parallel | 2 × `SUBMISSION_OUTCOME_UNKNOWN` |
| **1 alone** | **submitted successfully** |

`SUBMISSION_OUTCOME_UNKNOWN` means the remote create *may* have been accepted but
no `task_id` came back — so it **cannot be queried or cancelled**, and retrying
risks paying twice. When you see it: stop, wait for a video card, and only
re-issue if none appears.

Each submission pops a cost-confirmation card that times out after **300 s**.

---

## 7. What's next (in order)

1. **Generate the remaining fall clips.** A fall clip is needed for every avatar,
   because the loser may be either seat. 12 outstanding:
   `pumpkin-boy, pumpkin-girl, knight, pirate, vampire, wizard, scholar, robot,
   alien, genie, ghost, yeti`.
   Start frames for all 13 already exist in `frames/start-frames/`.
   **One submission at a time.**

2. **Re-check pumpkin-girl and knight.** Their push/break clips were submitted but
   never delivered, and no task id can be resolved. Re-issue if no card appears.

3. **Generate push/break clips for the remaining avatars.** These were never
   submitted: `wizard, scholar, robot, alien, genie, ghost, yeti`.

4. **Extend the clip map in `wall-push.js`.** Currently only `pumpkin-boy`,
   `boy`, `pumpkin-girl`, `girl` and `ninja` are mapped; every other avatar falls
   back to the pumpkin-boy clip. Add `<key>-fall.mp4` alongside push/break.

5. **Play the fall after the break.** On `breaker()`, play the winner's
   `<key>-break.mp4`, then the **loser's** `<key>-fall.mp4` back to back, and hold
   the payout card until both finish (~2.5 s). This likely needs `FINISH_MS`
   raised from 1000 to ~2500.

6. **Decide the deploy.** The work is on `feat/wall-push-video`, unpushed.
   Pushing to `fresh/go-wild-2v2-finished` triggers a Render auto-deploy.

---

## 8. Known limitations — be honest about these

- **The fall is not in the break footage.** The push/break clips each contain one
  fighter and a wall. "Opponent falls" is currently the losing seat's plate
  dropping out of frame via CSS — which is why a dedicated **fall clip per
  avatar** is the next job.
- **Clips are full-frame film**, so they replace the arena's whole picture. They
  are not two fighters composited into the existing DOM scene.
- Only 2 of 13 avatars currently have any clip at all.

---

## 9. Contents of this folder

```
HANDOFF.md                     this file
video/source-clips/            the AI-generated originals (5 clips, incl. ninja-fall)
video/trimmed-beats/           the 4 clips cut to the game's beats
frames/start-frames/           13 arena first frames, one per avatar
frames/duel-frames/            both-fighters frames (game layout, felt + slab)
sprites/                       the 13 fighter sprites (transparent PNG) + contact sheet
scripts/                       every Python tool used
code/                          the 3 changed game files + wall-push-film.patch
renders/                       one sample of the procedural route (superseded)
```

**Deliberately NOT saved:** the full procedural render sets
(`wallpush-video/` 39 MB, `wallpush-movie/` 42 MB). That route was rejected —
the fighters read as sliding pictures rather than animated characters. One
sample clip is in `renders/`; the whole set is regenerable in ~14 min with
`python scripts/render_movie.py`.

---

## 10. Debugging notes worth keeping

- **A `<video>` that renders black.** Do **not** assign `currentTime` before
  metadata exists. Doing so on a `HAVE_NOTHING` element left Chrome stalling in
  `NETWORK_LOADING` at `readyState 0` forever. Set `src`, call `load()`, and only
  seek from the `loadeddata` handler.
- **`python -m http.server`** serves static files fine; `HEAD` with a range
  header is rejected by PowerShell, which is a client quirk, not a server fault.
- **`moov` before `mdat`** = faststart. Check it if playback is slow to start.
- **The 2D warp rig** (in `scripts/render_movie.py`) had a falloff bug worth
  remembering: a cone-to-zero falloff with weight normalisation delivered only
  ~15 % of the authored limb travel to the limb *tips*, so a kick could never
  reach the wall. A plateau falloff fixed it. Also: a limb must **rotate about
  its joint**, not translate — translating the foot shears the leg into a strand.
