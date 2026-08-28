# Race and track settings

Every field on the race form and the track card, and what each one does.

## The race

Set when you create a race (**+ Create New Race** on Home) and editable
afterwards from the Roster page.

| Field | What it does |
| --- | --- |
| **Event Name** | Names the race everywhere. Must be unique |
| **Date & Time / Location** | Shown on the Home page and printed on pit passes |
| **Scoring** | **Timed** or **Points** — see [Scoring](scoring.md). Choose before racing starts |
| **Championship Trophies** | How many cars the wizard puts into the final. About the racing, not the physical trophies — those live on the [Awards](../awards.md) page |
| **Check car weights at inspection** | See [the weight check](#the-weight-check) below |
| **Track / Timer** | Which track this race runs on |
| **Car Numbering** | See [car numbering](#car-numbering) below |

**Auto-advance**, on the race screen itself, is also remembered per race:
when on, the screen moves to the next heat ten seconds after results land.

### The weight check

On by default at 5.0 oz — the near-universal pack rule. When a weight over
the limit is typed at check-in, the box turns red and says so.

- **It is a warning, never a refusal.** The car can still be checked in.
  The inspector at the table decides; the app makes the rule visible at the
  moment it matters.
- **The tolerance is half a hundredth of an ounce.** Desk scales disagree in
  the last decimal place: a car displaying 5.00 always passes a 5.0 limit,
  and one displaying 5.01 never does.
- **A weight of zero means "not weighed"**, not "very light" — no tick, no
  warning.
- Turn the check off entirely if your pack does not weigh cars.

### Car numbering

| Choice | How numbers are handed out |
| --- | --- |
| **Per Den** | **Auto number** fills from each den's own range — 100–199 for the first den, 200–299 for the next. The ranges are on each den in Manage Dens, and can be changed or cleared |
| **Global** | Sequentially from one starting number, den regardless |
| **Manual** | You type every number yourself; **Auto number** leaves the race alone. Duplicates are allowed — which is why the check-in scanner's car number box only matches when exactly one racer holds the number |

## The track

Tracks live in **System Settings** and are shared between races — the track
is hardware in the room, so a venue running two races has the same track in
both.

| Field | What it does |
| --- | --- |
| **Track Name** | Names it in race forms and settings |
| **Lanes** | How many lanes the track has. Schedules are built for this — lowering it mid-event brings existing heats into line, see [turning down a track's lane count](mid-race-changes.md#turning-down-a-tracks-lane-count) |
| **Length (Feet)** | Recorded for reference |
| **Timer Type** | Fake, plugged into this machine, or plugged into the laptop running the browser — see [Timers](timers.md#the-three-timer-types) |
| **Serial Port** | Almost always blank. Fill it only to force a specific port; it is then used exactly as typed |
| **Timer Model** | Almost always *Detect automatically*. See [the model picker](timers.md#the-timer-model-picker) |
| **This track has a remote start gate** | Enables the on-screen gate release, if the timer supports it — see [the remote start gate](timers.md#the-remote-start-gate) |
| **Lanes in service** | Untick a lane that has stopped working. Unlike the rest of the card, this **saves the moment you click it** — see [a lane stops working](mid-race-changes.md#a-lane-stops-working) |
| **Track records from past years** | Records from before Trusty Track, entered by hand for the Stats page's record board. Saves as soon as you add one — see [the track record](stats-and-exports.md#the-track-record) |

## The organization

**Organization Name** in System Settings — your pack's name, shown in the
header and printed on documents. The **Access** panel on the same page holds
the PINs; see [Roles and permissions](roles-and-permissions.md).
