# Navigation, the roster toolbar, forms, settings, themes, printables

Part of the Trusty Track agent guide; the index is in [`CLAUDE.md`](../../CLAUDE.md). Read this before touching `Navigation.tsx`, `RaceDetails.tsx`, `RaceForm.tsx`, `SystemSettings.tsx`, `theming/`, `features/printables/`, or photo cropping.

---

### One row of race navigation

`Navigation.tsx` holds every race view — Roster, Control, Standings, Awards, Stats, Live — and that is the only race navigation there is. There used to be a second: a `RaceModeToggle` rendered by four pages, offering Roster/Standings/Awards/Stats. Standings and Stats therefore appeared **twice**, two rows apart, and the same page was called Details in one and Roster in the other. Awards appeared only on the toggle, so it was unreachable from Control or Live.

The merged row keeps the toggle's word — **Roster**, which is what the page calls itself — and Standings and RaceStats lost header rows that existed only to centre the toggle between two spacer divs.

If you add a race view, it goes in `links` in `Navigation.tsx`. Don't reintroduce a per-page toggle.

**The browser tab's name is `features/core/pageTitle.ts`**, applied by `PageTitle` — a component rendering nothing, mounted once inside the router. Every page was called "Trusty Track" until then, which on race day is several identical tabs. A component rather than a hook each page calls, for #48's reason: fourteen routes, and a rule depending on every page remembering reaches only some. Two things about the wording, both about how a tab strip is read: **what distinguishes this tab comes first**, since a tab truncates from the right and the app's name is the part every tab shares; and the second half names **what the page is about** — the race for a race page, the application otherwise ("Standings — 2026 Pinewood Derby", "Settings — Trusty Track"). The words are the navigation's labels and Race Control's own tab labels, so a title traces back to something the operator clicked. A race whose name has not arrived yet is the view alone rather than "Standings — undefined". The name costs no request: it comes off `GET_RACES_NAV`, which the navigation has already fetched.

**The race list survives a second tab** ([#300](https://github.com/dknowles2/trusty-track/issues/300)). `Navigation.tsx` fetched `GET_RACES_NAV` once on mount, so a race created, renamed or deleted in another tab — or another device on the same LAN — left every other tab's selector, and the browser tab's title behind it, stale until a reload. `racesChanged` is an **argument-free** subscription — the one exception to every other subscription in the schema being scoped to a race, a track or a display, because the navigation's race list is not scoped to one race — and its payload is a bare `true` rather than the list itself: the client already holds `GET_RACES_NAV`, and shipping the list down the socket a second way would need to be kept in step with the query rather than just triggering it. `createRace`, `updateRace`, `deleteRace` and `createPracticeRace` all publish it — the fourth because it inserts into `races` the same as the first, and #48's lesson is that a rule reaching only the obvious call sites reaches only some of them. Deliberately **not** folded into `raceStateChanged`: that channel is per-race, and a sentinel race id on it would mean every existing subscriber — scoped to a race that may not be the one on screen — filtering out an event that was never theirs. `Navigation.tsx` re-executes `GET_RACES_NAV` with `requestPolicy: 'network-only'` on the signal; `PageTitle` needs no change, since it reads the same query through the normalized cache and updates when the cache does.

**Home's race rows use the navigation row's own words, not a third vocabulary** ([#589](https://github.com/dknowles2/trusty-track/issues/589)). Each row used to say **Control** and **View** for the destinations the navigation row itself calls **Control** and **Live** — the same two screens, described two different ways depending on which page you were looking at. The row now says **Control** and **Live**, matching `links` in `Navigation.tsx` exactly, on the theory that a destination should have exactly one name anywhere in the app; the issue's own suggested wording ("Race Control", "Live Display", "Roster & Check-In") was a proposal, not something to copy verbatim once it would have meant a *third* set of words alongside the two that already existed.

Two friction points the issue raised had no button behind them at all — the race title link goes to the Roster page without saying so, and race settings were reachable only by first landing on Roster and clicking **Edit Details**. Both are fixed without adding a page: the title link now carries a `title` attribute naming its destination on hover, and each row gets a **⋯** overflow menu — the same pattern the roster toolbar itself uses, reused rather than reinvented — holding explicit **Roster** and **Edit race** actions. **Roster** and **Control**/**Live** end up pointing at the same two places two different ways (title link and row action), which is deliberate: the title link is what a returning operator already reaches for, and the explicit action is what a first-time reader can *see* is there.

**Edit race opens the Roster page's existing modal, not a new `/race/:id/settings` route.** The edit form has only ever been a modal on `RaceDetails.tsx`, opened by its own **Edit Details** button — there was no settings page to link to, and inventing one would mean two ways to reach the same form drawing from two different pieces of code. Instead, both Home's overflow menu and a new **Edit race** button on Race Control (replacing a spacer div that existed only to balance the centered tab group against the page title) navigate to `/race/:id?edit=true`; `RaceDetails.tsx` opens the modal when it sees the param and strips it immediately (`replace`, so it does not sit in history and cannot reopen the modal on a reload or a Back navigation). Opening the modal is done as an "adjust state while rendering" comparison against the previous render's param value, not inside a `useEffect` — `eslint-plugin-react-hooks`' `set-state-in-effect` rule (part of the React Compiler-oriented rules pulled in by v7) flags a bare `useEffect(() => { if (param) setIsEditingRace(true) }, ...)`, and rightly: it fires on every render where the param is still present, including the render right after the operator has already closed the modal by hand but before the param-stripping effect has run. Stripping the param itself stays a plain effect — it synchronizes the browser's own address bar, an external system, not this component's state.

### The roster toolbar

`RaceDetails.tsx`. Six buttons competed for one row and four of them wrapped their labels at 1280px. The rule now: **the first row holds Add Racer, Scan and an overflow menu, and nothing else.** Manage racing groups, upload photos and print are things an operator does once before an event, so they live behind the `⋯`; add and scan are the two reached for repeatedly. Search and the group-by-racing-group toggle sit on their own row beneath.

**There is no Bulk Actions button.** It was disabled for most of the day — space spent saying "not yet" — and what it held is now a selection bar that exists only while rows are ticked, with a clear-selection ✕. `roster-selection-bar` and `roster-more-menu` are the test ids; the individual `bulk-*-btn` ids survived the move, so what changed for a test is only that the actions no longer need a menu opened first.

Move-to-racing-group is still a menu, because six racing groups will not fit on the bar — but it opens **downward** now rather than flying out sideways, which retired `denMenuSide`, `denMenuContainerRef`, `moveDenTimeoutRef` and the two hover handlers that measured which side had room.

**Only the actions that remove something clear the selection** ([#420](https://github.com/dknowles2/trusty-track/issues/420)). The desk works a queue: select everyone, Auto number, then Check In — and until now the first click cleared the selection along with everything else, so the second landed on nothing, silently, because the bar it would have used had just disappeared. Check In, Auto number and Move to racing group now leave `selectedRacerIds` standing after they succeed, so that sequence is one selection rather than two. Clear numbers and Delete still clear it — both remove data (numbers, or the rows themselves) rather than adding to it, so a selection surviving them is a chance to repeat a destructive action by mistake, not a convenience. The explicit **✕** is unaffected either way.

### The race form is sectioned, except when creating

`RaceForm.tsx`, with the vocabulary and the validation in
`features/management/raceSettingsSections.ts` ([#587](https://github.com/dknowles2/trusty-track/issues/587)).
The form had grown to one 500px modal column holding, in edit mode, the lock,
a name, a date, a location, two five-option fieldsets, four numeric inputs,
six checkboxes and — behind two of those — seven more text boxes and a radio
group. An operator opening it to turn on the weight check scrolled past the
scoring rules to find it. It is now four sections, one on screen at a time,
with the same `SettingsNav` down the left that System Settings uses — the
component went generic over its section id for this, and its two links out
moved to `SystemSettings.tsx` as children, so there is one nav and one
stylesheet rather than two that can drift.

**The sections are the questions an operator opens the form with, not where
a column lives.** *Event* (lock, name, date, location, track, interleave —
"which track" is an event fact and sits with the name, and the running order
is how the event runs on that track); *Scoring* (method, drop worst, ties,
championship trophies, the Grand Finals exclusion, one trophy per racer —
all three of the last are "who wins"); *Check-in* (numbering, the weight
check); *Words and names* (the terminology and name-display overrides —
both about what strangers read). The blurbs deliberately name no built-in
vocabulary, since the last section exists so a race can replace it.

**The create form is the wizard case and is flat**, exactly as the first run
of System Settings is: `sectionsFor(false)` returns nothing and the form
renders every field under the same four headings, so the create form teaches
the vocabulary the edit form is later navigated by. *Words and names* holds
nothing at all while creating — both controls are update-only — so it is
absent there rather than an empty heading.

**Validation moved into `firstProblem`, the same way and for the same
reason as the settings page.** The browser only validates the fields it is
rendering, so with one section on screen an empty race name in *Event* is not
in the document while somebody is on *Scoring*, and nothing native fires.
`handleSubmit` checks the whole form and **switches to the section holding
the problem**. Every rule there restates a constraint an input already
carried (`required`, `min`, `max`) — with one addition: a blank custom word.
The terminology inputs never had `required`, and `updateRace` does not refuse
an empty string, so an operator could save a race whose word for its racing
groups was `""` while the docs promised "there is no way to save an empty
word". The inputs carry `required` now too, so the browser still points at
the field when it is on screen. `RaceFormSections.test.tsx` renders a problem
in a section that is not up and asserts the switch; note a test for the
*empty*-name case has to submit from another section or use whitespace,
because jsdom honours `required` on a rendered input before the form's own
check ever runs.

**What the issue asked for that is not here, and why.** Its "Track & Lanes"
and "Timer & Hardware" tabs describe track settings, which are per track in
System Settings — shared hardware in the room, not a race fact (#171's
reasoning) — so the race form only picks a track and says where the rest
lives. Its "Displays & Media" tab names a display theme (per install, in
System Settings → Appearance) and header text and sponsor images, which do
not exist. Its discoverability items — a one-click route from Race Control
and an explicit action on Home's race table — had already landed in #589.

### The settings page is sectioned, except the first time

`SystemSettings.tsx`, with the vocabulary in `features/settings/sections.ts`
and the nav in `SettingsNav.tsx`. The page was one 600px column holding an
organization name, two PINs, every track's name, geometry, lanes-in-service,
timer, model, remote start and historical records, a backup panel and two links
out. The documentation had already started writing it as though it were
sectioned — "Settings → Access", "Settings → Tracks → Lanes in service",
"Settings → Backup" — which is the tell that the page owed the reader those
sections. They are named after what the docs already called them.

**The first run gets no nav at all.** `sectionsFor(false)` returns an empty
list and the caller reads that as "render the lot": the same screen is the
setup wizard until it has been saved once, and somebody who has never seen the
app should meet every field in order rather than go hunting for the two they
have not filled in. It is also why Backup is absent there rather than merely
empty — offering to replace an install that does not exist yet is offering
nothing.

**Down the left, not across the top.** There is already a navigation row across
the top of every page, and a second row is what "One row of race navigation"
above was written to end. Under 768px the column becomes a wrapping row, since
the phone at the registration desk is a real device.

**Validation moved into `firstProblem`, and this is not decoration.** The
browser only validates the fields it is *rendering*, so with one section on
screen an empty organization name is not in the document and nothing native
fires — the save would go up missing a name. `handleSubmit` checks the whole
form and **switches to the section holding the problem**, because reporting
"your organization needs a name" over the track form is a dead end. The inputs
keep `required`/`min` as well: those still catch the value that *is* on screen,
and the browser points straight at it. The check also names the track at fault
by number, which the form never did even when everything was on screen at once.

**Backup is outside the `<form>`.** A Restore button under a submit button
saying **Save Settings** is one misclick from replacing the event —
`BackupPanel`'s own header has said so since #176, and `isFormSection` is now
where that is stated once.

**The two links out (`/timer-check`, `/activity`) are nav items, not a
footnote**, and the docs send people to them by that route. On the wizard,
where there is no nav, they stay as the strip under the form.

**A saved track's card carries its own `Check this timer →`**, to
`/timer-check#timer-<id>`. "Is my timer working" is a question about *one*
timer, and the diagnostics page renders a live panel per track — a three-track
venue arriving at the top of that page has to work out which panel is theirs,
which looks like nothing being wrong. `TimerDiagnostics` gives each section
`id="timer-<id>"` and scrolls to the fragment itself, because a router
navigation does not scroll to one the way a page load does, and the sections do
not exist until the tracks query has answered. The nav's general link stays:
before the first save a track has no id to point at, and the docs name that
route in two places.

A track's card is `TrackCard.tsx`, split under **The track** and **The timer** —
it was 200 lines of JSX inside a `.map()` with nothing saying which controls
were about the track and which about the device at the end of it. Lanes in
service and track records still save on click rather than on **Save Settings**,
and still say so.

**Advanced is the last form section, not folded into Backup** ([#659](https://github.com/dknowles2/trusty-track/issues/659)).
Debugging Mode used to sit at the foot of General, which put it near the
*top* of the page once the page was sectioned — the opposite of what an
operator opening Settings should meet first. Appending it to Backup was the
issue's other suggestion and does not fit this page's own split: Backup lives
**outside** the `<form>` specifically because a Restore button is destructive
and one misclick from a submit button is a real risk, where Debugging Mode is
an ordinary boolean with no such hazard. Pulling it out of the form to sit
beside Backup would solve a problem it does not have while creating one it
would — a field the "Save Settings" button no longer saves. So it is its own
`isFormSection` entry instead, ordered after Tracks and before Backup in both
`SECTIONS` and `FORM_SECTIONS`: last among the ordinary fields, still one
`<form>`, still one Save. On the first-run wizard, where `sectionsFor(false)`
renders every section in order with no nav, this reads as one more heading
near the foot of a long page rather than as a change in behavior — the
control itself has not moved relative to the fields around it, only relative
to General.

### Themes

Three independently configurable colour surfaces (#498) — **App** (the
operator's own screens), **Display** (the audience/projector views), and
**Printables** (pit passes, licences, heat sheets, certificates, results
sheets) — each pickable from seven purpose-built themes: Field Uniform
(default, unchanged), Under the Lights, Old Glory, Clear Sight, Sawdust &
Pine, Trail Colors, and Newsprint. Full user-facing detail —
what each is for, which is per-device versus per-install, the printing/ink
note — is `docs/reference/themes.md`; this section is the mechanism.

**A theme is one plain data record, not a stylesheet.** `frontend/src/
theming/themes.ts` is the one place a theme's colours live — `THEMES: readonly
Theme[]`, each with `app`/`display`/`printables` token maps and an `isDark`
flag per surface. `applyTheme` (`theming/applyTheme.ts`) redefines a surface's
CSS custom properties as inline styles on that surface's own root element and
sets its `data-theme` attribute; nothing generates a stylesheet, so there is
nothing else able to disagree with this file. `index.css` keeps Field
Uniform's own values as the pre-JS `:root` fallback (`themes.test.ts` pins
that the two agree), and `[data-theme="clear-sight"]` / `[data-theme=
"newsprint"]` selectors carry the two deviations that are not a token value
at all — Clear Sight's solid border and heavier type, Newsprint's header
rule in place of a filled bar.

**Three scoping roots, and `applyTheme` clears what it does not set.** The
App root is `document.body` (`theming/appTheme.ts`'s `applyStoredAppTheme`,
called first in `main.tsx` and again on a Settings save); the Display root is
`Observation.tsx`'s and `AwardCeremony.tsx`'s own top-level elements; the
Printables root is the shared `.printables-page` div each of `Printables.tsx`
/ `Certificate.tsx` / `HeatSheet.tsx` / `ResultsSheet.tsx` renders
(`features/printables/printablesTheme.ts` is the one helper all four call, so
there are not four copies of the resolve-and-cast). `applyTheme` takes every
token name a surface *could* hold and either sets it or calls
`removeProperty` — otherwise switching from Newsprint (which sets
`--print-decor-color`) to a theme that does not would leave a stale inline
override nothing clears.

**`MATCH_APP` always resolves against Field Uniform, everywhere, never
against a live App theme** (#528). The App theme lives only in each
device's own `localStorage` and never reaches the server, so nothing — not a
wall display, not a printed page, not even the settings page's own preview —
can know "the App picker's current value" for a device other than itself;
there is no App picker for either surface to defer to. `resolveSurfaceKey(setting)`
takes no App theme argument at all, and every caller (`Observation.tsx`,
`AwardCeremony.tsx`, the four Printables pages, and `AppearancePreview.tsx`)
resolves it the same way, so `MATCH_APP` always resolves to Field Uniform —
which is also why Field Uniform's Display definition is exactly today's
shipped `.projector-mode` palette: an install that has never opened Settings
renders identically to before this feature existed. The Display/Printables
pickers show this option as **"Field Uniform (default)"**, not "Match App
theme" — the old name promised a relationship the architecture cannot
deliver (the App theme is per-device, Display and Printables are
per-install), and it briefly meant something different in the settings
preview alone: before #528, `AppearancePreview.tsx` was the one caller
passing a real `appThemeKey`, so previewing the default showed whichever
theme the App picker's own (unsaved) selection happened to be, not what the
wall or the printer would actually render. The preview now resolves
Display/Printables exactly as they resolve everywhere else — showing the
operator a look they would not get was worse than showing them the truth.

**Per-device App theme, per-install Display and Printables.** `Organization.
display_theme` / `Organization.printables_theme` are `varchar` columns, server
default `'MATCH_APP'`, exposed on `initialConfig` and set through
`updateInitialConfig` alongside the org name and PINs — the same reasoning as
the Displays system already pushing view state from the operator's own list
(see "Telling an audience display what to show" in
[`displays.md`](displays.md)): walking to every wall
display to set the same theme on each defeats the point. The App theme is
`localStorage` only (`trustytrack.appTheme`, same shape as the PIN and the
finish chime) and is never sent to the server.

**No clear flag, unlike the PIN or the weight limit — because there is no
bare-null state to disambiguate.** `InitialConfigInput.display_theme` /
`.printables_theme` are `str | None = None`: absent means leave alone, same
as every other optional field here. What makes this *unlike* the PIN
(`""` clears it) and the weight limit (`clearWeightLimit` exists because
`null` is both "no limit" and "not supplied") is that this column's own "off"
state is the non-null string `"MATCH_APP"` — an operator resetting to the
default sends that value explicitly, which the absent-means-leave-alone rule
already handles with nothing extra. `_apply_themes` in `api/schema.py`
mirrors `_apply_pins`'s shape for exactly this reason.

**Plain `String`, not `SAEnum`, on the backend.** Unlike `TimerType` or
`ScoringStrategy`, nothing server-side branches on a theme key — the frontend
holds the one canonical vocabulary, the same relationship it has with a
timer's `TimerProfile`. A value from a build that no longer ships a theme (an
old device, a stale column) falls back to Field Uniform in `themeByKey`,
never a crash.

**`AwardArtwork`'s `variant` is derived from the active theme, not
hardcoded, on both ends that changed.** The Awards list (App surface) passes
`variant={appIsDark ? 'dark' : 'light'}`, reading this device's own
`localStorage` theme — Under the Lights is the only one of the seven with a
dark App surface, and without this its Awards list drew every trophy in blue
against a background nearly the same colour. `AwardCeremony`'s background
converged from a hardcoded `--scouting-blue` to `--display-bg-color` — the
one deliberate colour change this feature makes to an existing screen under
the *default* theme (stage 1's groundwork PR left it as a hardcoded literal
because no theme data existed yet to decide with). `resolvePalette` in
`artwork.tsx` now prefers a caller's own `palette.line` for `variant="dark"`
rather than always forcing white — needed because `--display-text-color` is
not pure white under Sawdust & Pine or Trail Colors.

**The demo denylist leaves `updateInitialConfig` refused, whole.** Themes are
cosmetic and harmless to try, but the mutation that carries them also sets
PINs and reconfigures tracks — real ways to break the demo for everyone else
— and it is one mutation, not one per field. Splitting Display/Printables
into their own mutation just to carve a demo exception was considered and
rejected as disproportionate complexity for a demo-only nicety. A demo
visitor still gets the real experience: the App theme is client-only and
always available, and the settings page's three-panel live preview needs no
mutation at all, so every theme's full App/Display/Printables rendering is
visible without persisting anything.

**Not attempted here: the ~140-file inline-style migration.** #498's own
"Required groundwork" section calls this out as its own milestone, separate
from adding the themes themselves. This feature converts the files Display
and Printables theming actually depends on (stage 1) plus a representative
slice of decoration (`--print-decor-strength` on the chequered band, the
licence wash and the certificate guilloche; Clear Sight's `.racer-card`
border) — most inline-styled screens still read literal colours and do not
respond to a theme. `docs/reference/themes.md` and the landing page say so
plainly, per the project's own honesty rule for partial coverage.

### Printables

Pit passes, driver's licences and check-in codes. `/race/:raceId/print`, from the roster's **Print** button.

**HTML the browser prints, not server-rendered PDFs** — the plan assumed PDFs. There is no PDF toolchain on a Pi, the branding already lives in the frontend, and a sheet of sixty is a CSS grid rather than a page-composition problem. The one thing a page cannot draw for itself is the QR code, so that is the only part the server renders: `GET /api/printables/barcode/{racer_id}.png`, registered **at both `/printables/...` and `/api/printables/...`** because the Vite dev proxy strips the prefix — the `/api`-only form works in production and 404s on the machine it is written on.

**Sheet-first.** Nobody prints one pit pass; they print sixty before check-in opens. The page is the sheet, the roster's selection arrives on `?racers=`, and an *empty* selection means the whole roster rather than nothing.

**The layout numbers live in `documents.ts`, not the stylesheet.** The page has to say "2 sheets of Letter" before the operator commits paper, so the card geometry is read by both TypeScript and CSS (as custom properties set inline) rather than kept in two places. `inPrintOrder` is the other rule worth knowing: car number ascending, unnumbered racers last — they are the ones still needing a number, which is easier to spot at the bottom of a stack than the middle.

The payload is `TT1:<race_id>:<racer_id>` — versioned because these live on paper and get scanned by a later version of the app, race-scoped because a bare racer id from last year's derby resolves to whoever holds that id now. `domain/printables.py` owns encode and decode; `features/printables/scanning.ts` is its mirror on the frontend, and **both pin the literal payload in a test** so neither can drift alone.

**The decoration is drawn, never fetched** (`components/PrintDecor.tsx`, and the gradients in `PrintSheet.css`). Same rule as the award artwork and the finish chime, for the same reason: these pages get printed on a laptop at a venue with no internet, and an image that 404s prints as a blank rectangle rather than as an error. Two things about how it is split. The flat repeating things — the chequered flag band under every card header, the licence's security wash — are **CSS gradients rather than SVG `<pattern>`s**: a sheet of pit passes is sixty cards, and sixty patterns is sixty copies of the same element id; a gradient has no id to collide. And **nothing in `PrintDecor` carries `role="img"`**, which is load-bearing rather than tidy — `Certificate.test.tsx` uses `svg[role="img"]` to tell a certificate that has award artwork from one that does not, so border furniture answering to that selector would break the distinction.

**Nothing in `PrintDecor` is scaled past about an inch, and the certificate is why.** Its background was first a giant outlined `DerbyCar`, and a recognisable object blown up to fill a page is clip art whatever it is drawn of — it also fought the award's own artwork, the one picture on that page that means anything. The background is texture instead: `.certificate::before` is a repeating-radial-gradient guilloche, masked to a band so it is clear of the recipient's name in the middle and of the frame at the edge. **Rings rather than rays** — a `repeating-conic-gradient` converges, so it crowds to a dark knot behind exactly the line that matters and reads as a sunburst. A print engine that ignores the mask gets the rings everywhere at 5%, which is survivable rather than wrong.

**One frame, and the corner ornaments are part of it.** The certificate carried a navy `double` border *and* an inset gold `outline` *and* four corner brackets, which is three concentric lines — at which point the ornament reads as a fourth frame rather than as ornament. Gold now appears once in the border region (the corners) and once under the recipient's name.

**The car is a wedge, and that took throwing away two drafts.** A silhouette with a flat deck and a squared rear block reads as a pickup truck at every size, however carefully the nose is tapered; what says "pinewood derby" is the single unbroken slope from tail to nose, slightly concave (a straight one is a doorstop). Judge a shape like this at the size it is *used* — a footer glyph is 26px, and detail that only works at 240px is a smudge there.

**Two contrast traps, both of which only appear on some racers' cards.** A portrait's ring is gold, and an initials placeholder takes its colour from the racer's *name* — one of those colours is that same gold, so the ring vanishes on exactly those cards unless a white gap ring sits inside it. The pit pass's car-number roundel is gold on the portrait for the same reason and needs the same treatment. Neither is visible in a screenshot of one card; both are visible on a sheet of sixty.

**`print-color-adjust` is stated over the document and everything in it**, not as a list of classes. The list had already reached four, and a decoration added later that nobody adds to it fails silently *and only on paper* — the screen preview is right and the print is white on white.

**Scanning is Chromium-only, by decision.** `CheckInScanner.tsx` decodes with the browser's own `BarcodeDetector` rather than adding a decode library — the same trade the browser-proxied serial timer already makes. Safari and Firefox get the car-number entry and a line saying why. That entry is **not** a fallback branch: it is on screen next to the viewfinder everywhere, because a creased code with a queue behind the table is the common case. It resolves only when exactly one racer holds the number — manual numbering allows duplicates, and picking the first would check in the wrong child.

A scan has **four** outcomes, not racer-or-nothing (`scanning.resolveScan`): the racer, not one of ours, a code from another race, or a racer deleted since printing. They are separate because the operator's next move differs for each.

**The heat sheet is a table, not a card** ([#173](https://github.com/dknowles2/trusty-track/issues/173)). `/race/:raceId/print/heat-sheet`, linked from the schedule rather than the roster's print menu, because it prints the *schedule*. `heatSheet.ts` holds the rules and shares only the stylesheet with the cards above — `DocumentSpec` and `perSheet` are card geometry and do not apply.

Two rules there, both about what paper needs that a screen does not: a lane's three states are **distinct** — an unadvanced championship slot reads "To be decided" because somebody will write a name in, an empty lane reads "—" because nobody is coming, and rendering both as blank loses that. And every row gets a column for every lane the **track** has rather than every lane the heat holds, so a heat short a lane still lines up with the rows above it. The blank **Result** column is deliberate: this sheet is what the announcer's table has when a screen is not there — the laptop runs flat, the timer stops talking, an auxiliary display drops off the wifi. Naming only the last of those is how the landing page ended up promising paper for a wifi failure two sections after boasting that nothing needs wifi.

**CSV lives in `utils/csv.ts`**, not in whichever page needed it. `RaceStats` had the only copy and it quoted every field without escaping an embedded quote, so a car named `The "Beast"` produced a malformed row and silently shifted every later column. Use `downloadCsv` / `filenameFor`; don't inline a third.

**The car label is a `DocumentSpec` card, not a heat-sheet-style document** ([#617](https://github.com/dknowles2/trusty-track/issues/617), stage 1 of 3). Unlike the heat sheet and the certificate — each a single full-page layout with its own module — a sheet of impound labels is exactly the "card repeated to a grid" shape `documents.ts` and `CarSticker.tsx` already model for pit passes, licences and check-in codes, so it is a fourth `DOCUMENTS` entry rather than a new print module. Sized for **Avery 5163** (2in x 4in shipping labels, 10 per Letter sheet, 2 columns x 5 rows): the vertical margin Avery's own template uses (0.5in top/bottom) already matches `PAGE_HEIGHT_IN`, but the horizontal one (0.156in each side) is narrower than the flat 0.5in every other document on this page assumes, so a literal 4in-wide card only clears the `widthIn * columns <= 7.5` check at one column. The card is 3.75in wide instead — two columns fill the 7.5in exactly, which keeps the sheet's count and grid (10 per sheet, 2x5) the same as Avery's, at the cost of a little unused margin inside each real die-cut label. No photo and no security wash, deliberately: this label goes under a car or on an impound box, not in a scout's pocket. The weight line and the "print before check-in" option (blank weight regardless of what is on file) are one card with a prop, not two components — the same shape `nameDisplay` already uses on the pit pass and the licence. Stage 3 (the docs pages) is follow-up work; stage 2 wired the card into the Printables picker, with `printBeforeCheckIn` set from an unchecked-by-default checkbox on the toolbar — a per-print option rather than a stored setting, deliberately unlike `?kind=` and `?racers=`, because the same sheet is printed twice on the day, blank before the scale opens and filled in afterwards, and a remembered choice would print the wrong one of the two half the time.

### Photo cropping

`frontend/src/components/ui/imageEdit.ts` and `ImageCropModal.tsx` — issue #619, stage 1 of 4. Photos are taken in a hurry at the check-in table: sideways, off-centre, with the car occupying a corner of the frame. Nothing in the app could fix that short of retaking the picture.

**Editing is client-side, on a canvas, before anything uploads.** `ImageCropModal` draws the rotated photo onto an offscreen canvas, lifts the crop rectangle off it, and hands back a `data:image/jpeg` URL through `onConfirm` — the same shape `uploadImage` already takes from `BulkPhotoUploadModal` and `CameraCapture`. The server never sees the original: nothing here talks to the network, and what does cross it later is already small (`outputSize` caps the longer edge at 1024px, since these travel over venue wifi as data URLs, not files).

**The geometry is pure, in `imageEdit.ts`; the pointer handling and the canvas draw are the component's job** — the same split `raceFlow.ts` and `useRaceFlow.ts` use. `rotateQuarter` turns a rotation state by 90° in either direction (four calls in the same direction is the identity); `rotatedSize` says how big the photo displays once that rotation is applied (width and height trade places on a quarter turn); `clampCrop` pulls a crop rectangle back to one locked to an aspect ratio, no smaller than `MIN_CROP_SIZE` on either edge, and never outside the image, preserving its centre as closely as the image's own edges allow — which is what makes it safe to call after either a move or a resize; `fitInitialCrop` is the largest centred crop of that aspect an image can hold; `outputSize` is the downscale. None of the four know about pointers, canvases, or React.

**Two aspect presets, `PORTRAIT_ASPECT = 1` and `CAR_ASPECT = 4 / 3`.** The square one is checked against two things already in the tree: `RacerAvatar` crops every racer photo to a circle inside a square box, and the pit pass's own portrait (`PrintSheet.css`'s `.pit-pass .print-photo`) is a circle in a 1.32in square — a square crop is exactly what both of those already assume, so nothing about them has to change once a later stage feeds them a cropped photo instead of a raw one. The car ratio has no such print box to match yet — nothing in `documents.ts` or `PrintPhoto.tsx` lays out a *car* photo today, only a racer's own portrait — so `4:3` is a landscape default for a car photographed side-on, not a value pinned against an existing layout. If a later stage adds a car photo box to a printable, check its ratio against `CAR_ASPECT` and adjust whichever is wrong rather than carrying two.

**The interaction is a draggable, resizable crop box** (corner handles, pointer events, `{ once: true }` on the pointerup listener so cleanup does not need to reference its own handler by name) rather than a zoom slider — closer to what an operator already expects from a phone's own photo picker, and it means `clampCrop`/`fitInitialCrop` are the only geometry a resize needs, with no separate zoom-to-crop conversion to keep in step. Touch-friendly hit targets (32px) for the iPad at the check-in desk. Arrow keys nudge the crop by a fixed step; Escape cancels through `Modal`'s own listener, so the modal does not carry a second copy of that rule.

**Stages 2–4 of #619 are someone else's work and not done here**: hooking `CameraCapture.tsx`'s capture flow into the modal, a rotate control on `RacerForm.tsx`'s existing photo preview, and the docs. `ImageCropModal` is standalone until then — nothing calls it yet.
