# Experimental eye tracking: implementation and validation

## Branch and review boundary

Feature branch: `codex/eye-tracking-word-highlight`, based on `master` at `a1a001a`.
Worktree: `.worktrees/eye-tracking-word-highlight`. All feature changes and build
artifacts were produced in that worktree. No merge into `master` is included.

The feature is off at the beginning of every reader session. It does not change
book storage, parser versions, reading-page grouping, bookmark commits or progress
calculations. It is restricted to physical TrueDepth iPhones for this first version.

## Architecture and contracts

`ReaderEyeTracking` is a local Expo module with `getCapabilities`, `start`, `pause`,
`stop`, `calibrate`, and `onStatus`. Camera commands and events carry a unique reader
session ID; obsolete session commands cannot stop a newer reader. Pause resolves
after capture stops and any calibration presentation is dismissed. The JavaScript
controller sends cancellation immediately even during a pending permission request.

The native tracker composes `inverse(camera) * face * eye`, uses the eye's positive
Z direction, intersects both rays with a virtual camera-space z=0 plane, and averages
their intersections. It does not project camera pixels or access enrolled Face ID data.
Nine target medians fit a robust affine mapping into top-left normalized UIWindow
coordinates. Five later fixations provide independent mean Euclidean validation
error. Nominal duration is 14 × 1.75 seconds; missing samples may extend a target
briefly before returning a recoverable error. High fit error still permits the user's
requested best estimate, with a low-quality status.

Calibration coefficients, validation error, and reference head pose exist only in
memory. Sustained pose/distance changes lower quality; prediction cannot update its
own calibration. Native frames and camera images never cross the React bridge.

The native passage view uses the same TextKit 1 layout for visible text and word
rectangles. Word identity is a UTF-16 half-open range within the displayed passage,
qualified by reader session, passage and layout revision. It matches Georgia,
fixed line height, scaling and letter spacing. A non-scrolling UITextView preserves
selection; the existing React Native ScrollView handles long cards.

Native word selection uses a short low-pass filter, distance to visible word
rectangles, a bounded current/neighbor preference, and 35 ms hysteresis for ambiguous
changes. Strong jumps can bypass hysteresis. There is no word-advancement timer.
Blink/loss holds the box and dims it after 500 ms. Offscreen/outside-passage gaze
does not force an edge-word target. The outline is touch-inert and does not reflow text.

Only the settled reading card is eligible. Native code independently checks actual
paging offset, scrolling ancestors, clipping, and geometry stability before using
fresh samples. Full layout revisions reject stale height and word callbacks, including
accessibility font scaling. Lifecycle invalidation clears old targets.

Scanner sessions acquire an awaited camera lease before presenting their camera;
cancellation/disposal still releases it exactly once after native work settles. Scanner
sheet activity, other panels, backgrounding, and outstanding leases prevent restart.
AR interruption completion asks the JavaScript controller to reconcile eligibility;
native code never takes the camera back on its own.

## Automated and build verification

Verified on this feature worktree:

- TypeScript check passed; **177 tests passed, zero failed or skipped**, including
  production Swift math and selection cases.
- Full Debug simulator build succeeded with Xcode 26.6 / iOS 26.5 SDK for arm64 and
  x86_64. Native tracker/calibration/math also typechecked against the iPhone SDK.
- Production iOS JavaScript export succeeded.
- An isolated iPhone 15 Pro Max simulator running iOS 26.5 opened a synthetic book,
  displayed the new experimental settings and physical-TrueDepth requirement, and
  returned to reader controls after closing settings. The simulator correctly does
  not offer camera tracking. A pre-existing React Native SafeAreaView deprecation
  warning was the only development console warning observed.

- Run `npm run typecheck` and `npm test` from the feature worktree.
- The test suite includes production Swift ray/calibration and word-selection tests
  on macOS, plus deterministic reader lifecycle, scanner handoff and layout callback tests.
- Swift tests cover invalid/parallel/backward rays, affine fitting, independent holdout
  error, rank-deficient data, outliers, head-pose drift, Unicode offsets, repeated words,
  wrapped words, forward/backward jumps, line returns, jitter and obsolete samples.
- JavaScript tests cover permission status-before-rejection ordering, calibration
  cancellation, immediate stop during permission, overlapping leases, interruption
  recovery, stale sessions/layouts and settled paging without changing saved progress.
- Native simulator Debug build and iOS JavaScript production bundle export are checked.

These checks establish software behavior and compilability. They do not establish
sensor accuracy, exact device typography, native selection gestures, power consumption,
or handheld comfort. Host Swift tests skip where a macOS Swift toolchain is unavailable;
they must run on the macOS validation machine before accepting native changes.

## Physical iPhone procedure

Xcode's paired-device inventory identifies an **iPhone 15 Pro Max**, disconnected at
implementation time. No phone-based accuracy result is claimed. A simulator cannot
substitute for its TrueDepth camera.

1. Build/install the feature worktree on the connected, unlocked iPhone. Record device
   model, iOS version, app commit, font size, viewing distance, lighting and glasses.
2. Confirm ordinary reading first: open a saved book, copy/select text, toggle controls,
   swipe forward/backward, scroll a long card, jump chapters and reopen at the same place.
3. Enable tracking for the first time. Grant permission and complete calibration. Repeat
   after denying permission to verify the Open Settings recovery action. Cancel setup,
   then open/close panels and scan a page: camera capture must not restart without a
   valid calibration or a new setup attempt.
4. At 18, 24 and 32 points, check all themes, short/repeated words, punctuation, wrapped
   words, long passages and larger accessibility text. Outline edges must align with
   rendered glyphs and must not intercept selection or cause duplicate taps.
5. Test brief blinks, looking away, face departure, natural hand/head motion, dim lighting,
   background/foreground, lock/unlock and camera interruption. The last estimate must
   not advance while gaze is unavailable. Stale boxes must not appear on another page.
6. Scan a physical page while tracking is enabled. Test success, cancellation, denial,
   matching failure and leaving the reader. Verify camera exclusivity, expected return
   to tracking, and unchanged scan-jump/Undo behavior.
7. Repeat three seated handheld sessions. Use at least 30 prompted-word trials per session,
   distributed across the displayed text, including short words and line boundaries.
   Use different positions from calibration; include all failures in the denominator.
8. Compare normal reading with and without the outline for 15 minutes. Record distraction,
   unwanted box changes and apparent drift. Repeat word trials afterward.

## Measurements and acceptance targets

| Measure | Initial target at 24 points | Current result |
| --- | --- | --- |
| Prompted-word correctness | ≥80% | Not measured on device |
| Correct line | ≥95% | Not measured on device |
| Frame timestamp to visible outline, p95 | ≤150 ms | Not measured on device |
| Tracking availability and failed trials | Report all trials | Not measured on device |
| Jitter, 15-minute drift, comfort | Report before/after and box-on/off comparison | Not measured on device |
| Camera exclusivity and text interaction | All device scenarios pass | Automated lifecycle coverage; device checks pending |

Report sample counts and per-font results, not only averages. Count tracking loss,
failed calibration and unavailable predictions as failures in prompted trials. Do not
use calibration training residual or a stable-looking outline as evidence of accuracy.
Validation-point error is a spatial proxy, not word correctness.

For instrumented timing, compare ARFrame.timestamp with the display presentation
timestamp for the corresponding outline update using a local development instrument;
JavaScript callback arrival alone is not sensor-to-display latency. No telemetry or
automatic gaze-history export is included in the product.

Prompted trials alter behavior and cannot establish natural-reading accuracy. Before
claiming exact-word performance during natural reading, compare against a calibrated
reference eye tracker. Until those measurements pass, this remains an opt-in personal
prototype, with broader release deferred.

## Research basis and follow-up

- [Apple ARFaceAnchor eye transforms](https://developer.apple.com/documentation/arkit/arfaceanchor/lefteyetransform)
- [Apple Face ID privacy](https://support.apple.com/en-ie/102381)
- [2024 ARKit/iPad evaluation](https://pmc.ncbi.nlm.nih.gov/articles/PMC11223623/)
- [2020 calibrated smartphone gaze research](https://www.nature.com/articles/s41467-020-18360-5)
- [Word skipping during reading](https://pmc.ncbi.nlm.nih.gov/articles/PMC3543826/)

The longer-term goal is zero explicit calibration. The module boundary permits a
different gaze provider without changing word layout/navigation. Saved calibration
and a learned on-device model each need the same independent word/line benchmarks;
they are not implemented or assumed reliable in this version.
