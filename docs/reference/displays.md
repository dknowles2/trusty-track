# Audience display views

What a screen on the wall can show, and how telling it what to show works.
For the setup walkthrough, see the
[Observation Displays guide](../observation-displays.md).

## The seven views

Every screen with the Live page open can be switched between these, from
**Race Control → Displays** or by its own URL:

| View | What it shows |
| --- | --- |
| **Standings** | The live leaderboard, plus the Now Racing / On Deck / After That panels |
| **Last heat's times** | The most recently recorded heat: every car in finishing order, with place and time |
| **Cycle between both** | Standings and last heat's times, alternating on a timer you set |
| **Projector** | The full-screen, high-contrast layout: the live heat large on the left, top five standings on the right, and a brief results overlay after each heat |
| **Racer photos** | A slideshow of the check-in photos: headshot, car, name, number, den |
| **Standings only** | The leaderboard alone, filling the whole screen — no Now Racing / On Deck panels. For a pack whose standings are too long to share the screen with anything else |
| **Awards ceremony** | The [ceremony](../awards.md#announcing-them), one award at a time. Unlike every other view, it only moves when a person does — either at the screen, or with the **‹** and **›** buttons on its row in the operator's list |

**The ceremony only appears once you have awards.** A race with none is not
offered it, because the screen would land on a page saying there is nothing
to announce. Add the awards on the [Awards page](../awards.md) and the choice
appears the next time you open the Displays list.

**Driving the ceremony.** A screen showing the ceremony gets **‹** and **›**
buttons on its row, so the operator can move it on without walking to it.
They send a *step* rather than a slide number, which is why the arrow keys
and a presenter remote at the screen keep working: both drivers move the
same ceremony, and neither jumps it somewhere the other did not expect. The
buttons are dead while the row says *Not connected* — a screen that is not
listening cannot be told anything.

When a heat [breaks the track record](stats-and-exports.md#the-track-record),
the Projector view's results overlay and the Last heat's times view both
carry a banner, in the [theme](themes.md)'s own accent colour, naming the new
time and the record it beat. It fires only for a record that stood before
today's race.

When a track has [scale speed](race-settings.md#scale-speed) turned on, the
Projector view's results overlay and the Last heat's times view show it
too — a rough real-world MPH beside each recorded time, worked out from the
track's own length and scale ratio. A track with no length recorded, or
with scale speed turned off, shows the time alone.

### Lane colours

Set [lane colours](race-settings.md#lane-colours) on the track's own card in
System Settings and a small coloured dot appears beside every "Lane N" label
on these screens — the Standings view's Now Racing / On Deck / After That
cards, and the Projector view's own line-up. It matches whatever a lane is
called in the app, not the timer's own wiring: on a track whose timer cable
is [reversed](timers.md#reverse-lane-numbering), the dot still follows the
track's own lane number, the one painted on the ground.

The dot is always beside the lane number, never a fill behind it — a filled
badge would fight whichever [theme](themes.md) a screen is set to, so the
number stays readable either way. A track with no colours configured shows
the lane number alone, exactly as every track always has.

The colours every screen here uses — including the projector's high-contrast
dark background — come from whichever [theme](themes.md) Display is set to
in System Settings, not a fixed palette.

## Taking a break

A break called from Race Control (see
[Taking a Break](../race-day.md#taking-a-break)) takes over every screen
showing this race, whichever of the seven views above it was on — a break is
a fact about the race, not about which view a display happened to be
assigned.
Each screen shows a countdown, the break's name (or "Intermission" if none
was given), and a faint preview of the next heat's line-up, so a room that
has wandered off to the snack table still knows roughly when to come back and
for what.

The overlay clears itself the instant the countdown reaches zero, or sooner
if the operator clicks **End now** — there is nothing to acknowledge on the
display's own end. A paused break shows the time it was paused at rather than
counting down.

Notes on three of them:

- **Racer photos** goes in car number order rather than shuffling. Families
  are watching for their own child, and in order everybody comes round once
  per cycle. Racers with no photo are skipped rather than shown blank, and a
  race with no photos yet says so. Set the seconds-per-racer on the
  display's row — about five suits a small pack.
- **Projector** hides the app's navigation entirely, whichever way it was
  reached.
- **Standings only** moves through a leaderboard too long for one screen in
  one of two ways, chosen on the display's own row next to the seconds
  control: **Page cycling** flips to the next page after that many seconds,
  and **Auto-scroll** scrolls the whole list smoothly from top to bottom,
  pausing briefly at each end, over that many seconds per pass. Both keep
  going for as long as the screen is left open — walking away for an hour
  and coming back does not leave the list stuck partway through or drifted
  off schedule.

## Shortening a racer's name

These screens are on a gym wall, in a room open to whoever walked in — worth
knowing if a child's full name showing there is a concern. **Names on public
screens**, in System Settings (with a per-race override on the race's edit
form), can show "Jordan M." or just "Jordan" instead of the full name across
every view above, and the same choice hides a racer's own photo when it is
set to anything but the default — see
[Race and track settings](race-settings.md#names-on-public-screens) for the
three choices and exactly where each one reaches.

## Names, and telling one screen from another

Every screen gets a default name the moment it connects — an adjective and an
animal, like **Plucky Puffin** or **Brisk Badger** — so the Displays list is
usable before anyone has typed anything.

- **The name is tied to the screen, not drawn at random.** The same physical
  display gets the same name across a reload, a restart of the machine
  running Trusty Track, and a laptop swap — so a name you have been saying
  out loud all morning ("put the standings on Plucky Puffin") does not turn
  into a different animal an hour later.
- **No two screens in the same race share an animal.** If a fresh name would
  collide, the display gets a different one; only once every available
  animal is already taken does a screen get a number after its name.
- **Rename it any time**, the same as before — click the pencil. The **🎲**
  button next to the rename field offers another animal, for the rare case
  where the room has a real Badger in it and the coincidence is confusing.

### Identify

Each row has an **Identify** button. Press it and that screen's name flashes
across it in large type for a few seconds — press it, look up, and see which
physical screen just lit up. It is dead (greyed out) while the row says *Not
connected*, since there is no screen to flash a name on.

This works on the awards ceremony too, even though it is its own page rather
than a tab on the rest of the display — the projector at the front is usually
exactly the screen an operator wants to find.

A screen also names itself briefly, in a small corner badge, the moment it
first connects — plugging it in and opening it is the cheapest moment for
whoever is standing there to learn its name. The badge fades on its own.

## How assignment works

- **A screen registers itself** by having the Live page open. There is
  nothing to add and nothing to install; every open screen appears in the
  Displays list on its own.
- **An assignment wins over the screen's URL** — that is the point, since
  the operator is across the room. Until one arrives, the screen shows
  whatever its URL asks for.
- **A screen nobody assigns is untouched.** It follows its own URL exactly
  as before, so `?view=timing` and `?projector=true` keep working. There is
  no state where a screen cannot be reached from the operator's laptop.
- **Names stick.** Rename a display and the name survives a reload of that
  screen.
- **A screen that goes quiet stays listed**, marked *Not connected* — that
  is how you find out the projector at the back dropped off the wifi.
  Trusty Track cannot tell a switched-off screen from a dead network, so
  the row stays until you clear it with the ✕.
- **Assignments and a hand-typed name do not survive a restart** of the
  machine running Trusty Track. Screens fall back to their URLs — the same
  behaviour as before they were assigned — and can be renamed and
  re-assigned from the list. A screen's **default** name is the exception:
  it comes back the same, because it is derived from the screen itself
  rather than stored (see [Names, and telling one screen from
  another](#names-and-telling-one-screen-from-another) above).

## Two screens, one computer

A computer with two monitors — a projector next to an operator's own preview,
say — can drive both as separate screens. Opening the Live page a second time
on the same computer used to report the identical screen twice, because every
browser tab on one machine shares that machine's stored identity: assigning a
view to one moved both windows at once.

- **Race Control → Displays** has an **Open a new display window** button.
  It opens a second window that is already its own screen — nothing to type,
  and nothing for it to contend with the tab that opened it.
- **Reloading a display window keeps its identity.** A genuinely new tab or
  window, opened the ordinary way rather than with the button, still becomes
  a screen of its own on the list — it just does not carry over a name or
  assignment from the tab it was opened alongside.
- **A link with `?displayId=` in it always names a specific screen**, which
  is what the button's new window carries — useful if you ever want to bookmark
  a particular monitor's address rather than opening it fresh each time.

## Connection behaviour

Displays hold a live connection and update themselves; nobody refreshes
anything. If the wifi drops they reconnect on their own and catch up,
retrying for as long as it takes. What they cannot do is show a race they
cannot reach — see
[which network to use](../access-and-network.md#which-network-to-use).

A [free race](../free-race.md) heat takes the "Now Racing" spot like any
other — the audience sees a demonstration run, labelled **Exhibition** — and
the leaderboard beside it does not move.
