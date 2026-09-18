# Neuron rename validation

Validated on September 18, 2026, in the `codex/rename-neuron` worktree, based on
local `master` at `a3263b1`. Uncommitted EPUB work in the original checkout was
excluded.

## Automated checks

- `npm test`: 150 tests passed, including import, reopen, reading-position,
  preference, chapter-refresh, and deletion coverage.
- `npm run typecheck`: passed.
- `npm run test:corpus`: 8 tests passed under Python 3.12 with the existing
  requirements installed in an isolated temporary environment. The printed
  extraction-timeout message belongs to the intentional timeout test.
- Additional storage smoke check: an empty library and default preferences load
  correctly; all four `neuron.*.v1` key families round-trip; saved reading
  position and preferences survive reload; deletion removes content, chapter
  metadata, and the owned PDF.
- The package manifest and lockfile match the base revision apart from their
  package-name fields. Dependency versions are unchanged.
- Case-insensitive source and generated-native-metadata audits found no prior
  app-name references. Other worktrees and historical build outputs were excluded.
- `git diff --check`: passed.

## Native generation and build

- Clean Expo iOS prebuild and CocoaPods installation succeeded, creating the
  Neuron project, workspace, target, scheme, and application product.
- Repeated `expo prebuild --platform ios --no-install` succeeded and produced an
  identical AppDelegate. This installed Expo version regenerated the native
  directory on that run, so CocoaPods was reinstalled afterward.
- A direct double-application check of the development-bundle plugin preserved
  the first patched result exactly. Unsupported AppDelegate language and missing
  insertion-point errors also used the new app name.
- Release simulator build succeeded with Xcode 26.6 and the iOS 26.5 SDK.
- The built Info.plist contains display/product name `Neuron`, bundle identifier
  `com.example.neuron`, URL schemes `neuron` and `com.example.neuron`, and the
  existing PDF document registration.

## Simulator observations

Used an isolated iPhone 17 Pro simulator named **Neuron Rename QA**, running
iOS 26.5.

- Fresh installation opened to an empty library headed **Neuron**; its Documents
  directory was empty before introducing a synthetic PDF test fixture.
- Terminating and relaunching the app returned to the same empty library.
- Home-screen search identified the installed app as **Neuron**.
- Settings > Apps listed **Neuron**, with an **Allow Neuron to Access** page.
- The system PDF share sheet displayed the existing icon labeled **Neuron**.
- Opening `neuron://` displayed **Open in “Neuron”?** and opened Neuron after
  confirmation.

## Remaining manual checks

- End-to-end PDF selection/import, reading-progress changes, restart/reopen, and
  deletion on the installed simulator app remain unverified. The UI automation
  tool exposed neither selectable document-picker/share-sheet items nor working
  coordinate clicks. Automated lifecycle and storage coverage passed, but that
  does not replace this on-device interaction check.
- The icon label on its ordinary home-screen page was not separately inspected;
  home-screen search, Settings, share-sheet labels, and built display metadata
  were verified.
- Physical-device signing, camera permission presentation, and page scanning were
  not tested. The Apple team, icon, app version, and camera permission text remain
  unchanged.

The new app identity intentionally starts with a separate library. No legacy URL
alias or transfer of earlier books, reading positions, or preferences is included.
