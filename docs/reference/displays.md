# Audience display views

What a screen on the wall can show, and how telling it what to show works.
For the setup walkthrough, see the
[Observation Displays guide](../observation-displays.md).

## The ten views

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
| **Check-in progress** | Who has checked in and who has not, grouped by den, on a screen at the entrance or the gym wall — see [below](#check-in-progress) |
| **QR code** | A large, scannable code that opens this race on a phone — see [below](#qr-code) |
| **Broadcast overlay** | A transparent graphic for streaming this race on OBS Studio — see [below](#broadcast-overlay) |
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
showing this race, whichever of the nine views above it was on — a break is
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

Notes on six of them:

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
- **Check-in progress** groups the roster by den, each with a progress bar
  and the count of cars still to come — see the next section.
- **QR code** points a phone at this race's own Live page by default, or at
  the [voting ballot](../awards.md#letting-people-vote) if you switch its row to **Voting
  ballot** — see the section after Check-in progress below.
- **Broadcast overlay** has a transparent background rather than a solid
  one, so it disappears everywhere it is not actively drawing a bar or a
  banner — see [below](#broadcast-overlay).

## Check-in progress

The gym-wall answer to "are there any more Wolves who haven't checked in?" —
one card per den, a progress bar and a count for each, and the cars still
pending listed by number and name underneath. It reads live off the same
check-in status the roster's own **Checked In / Edit** button sets, so a car
checked in at the desk drops off this screen within a second or two, on
every screen assigned to it.

**List everybody, or pending only.** By default a den's card lists every
car, a small ✓ against the ones already through. A large pack can switch a
screen to **Pending only** on its row in the Displays panel — the same
control **Standings only**'s paging/auto-scroll choice sits next to — which
drops the checked-in rows entirely and keeps the card down to the cars still
needed at the scale.

**Before anyone is registered, it says so** rather than showing an empty
grid of dens. Once every registered car is through, it says that too — "All
42 checked in!" — instead of leaving an empty list where the missing names
used to be.

**It keeps working once racing starts, quieter rather than gone.** A car
can arrive after the first heat and still join the schedule (see
[Mid-race changes](mid-race-changes.md)), so this screen has no reason to
disappear the moment racing begins — nothing on it could switch itself away
even if it should, since a display holds no PIN and can be told what to show
only from Race Control (see "How assignment works" below). Once the first
heat is recorded it shows a small note that racing is underway and cars can
still check in at the desk, and shrinks its own type a little to say, without
words, that the room's attention has moved on.

These screens are on a gym wall, in a room open to whoever walked in — worth
knowing if a child's full name showing there is a concern. **Names on public
screens**, in System Settings (with a per-race override on the race's edit
form), can show "Jordan M." or just "Jordan" instead of the full name across
every view above, and the same choice hides a racer's own photo when it is
set to anything but the default — see
[Race and track settings](race-settings.md#names-on-public-screens) for the
three choices and exactly where each one reaches.

## QR code

The answer to getting fifty parents in a crowded gym onto the right address
without walking around holding up a laptop screen: a large, high-contrast
code they can scan from their own seats, with the address printed underneath
for anyone whose camera cannot read it.

**Points at this race's own Live page by default.** Switch a screen's row to
**Voting ballot** instead and it points at the [voting page](../awards.md#letting-people-vote)
— the same address the Awards page's own **Copy** button and QR code share
— so a screen at the entrance can invite people to follow along, and the
same screen (or a second one) can be switched over once judging opens.

**The address is worked out the same way the Awards page's ballot share
step already does it.** The browser running Trusty Track usually shows
`localhost`, which means nothing to a phone on the venue wifi — Trusty Track
substitutes this machine's own network address instead, and says so plainly
if it could not find one to substitute (try typing the printed address into
a phone's browser to check it works before relying on it).

**A headline and a Wi-Fi line, both optional**, set on the race's own edit
form (**Edit race** from Home, or **Edit Details** on the Roster page):

- **QR code headline** — the call-to-action above the code, e.g. *"Scan to
  Vote for Best in Show!"* or *"See Live Results on Your Phone"*. Left
  blank, the screen shows a sensible default depending on which page the
  code opens.
- **Venue Wi-Fi guidance** — a line under the address, e.g. *"Connect to the
  guest Wi-Fi first"*. Left blank, nothing is shown — most venues have open
  wifi or none worth mentioning.

**A shortcut from the Awards page.** The Voting panel's **Project QR code**
button opens a brand-new display window already pointed at the ballot — for
when the screen you want to use is not already open, or you would rather not
hunt for it in the Displays list first.

## Broadcast overlay

Every other view on this page is meant to fill a screen on its own — a wall,
a projector, a phone. This one is meant to sit *on top of* something else:
camera video, in a streaming program like [OBS Studio](https://obsproject.com/),
for packs streaming the event to family who cannot be there. Step-by-step
setup instructions are in
[Access and your network](../access-and-network.md#streaming-your-event-with-obs-studio);
this section is what the overlay actually shows.

**Its background is transparent, not merely dark.** Every other full-screen
view paints a solid colour behind everything it draws; this one does not
paint anything behind its own panels at all, so whatever your streaming
software is compositing underneath it — the track, the crowd, a starting
gate camera — shows through everywhere the overlay itself is not actively
drawing something.

**A lower-third bar names the current heat and its line-up.** Round and
heat number (or, for a run-off, what it is racing off to decide), each
lane's car number and racer name, and a live status badge — *Ready*,
*Staged*, *Racing…* — the same one the operator's own screen shows.
Nothing is armed between heats, so the bar says **Between heats** rather
than sitting empty.

**A compact standings ticker, on by default.** The top five, by rank, along
the top of the screen — what fills the gap between heats a bar alone would
leave blank. Turn it off on the display's own row in **Race Control →
Displays** (**Heat only**) if you would rather the overlay showed nothing
but the bar.

**A finish banner reveals the result and lingers for ten seconds.** Longer
than the Projector view's own version of this (five seconds) — someone
watching a stream has had none of the lead-up a person standing at the
track has had, so the banner gets more time to actually be read. A broken
[track record](stats-and-exports.md#the-track-record) is called out on it
the same way it is everywhere else.

**No racer photographs.** Every other panel here is text — names, numbers,
times — by design: this is meant to be read at a glance over moving video,
and a stream is not the place to spend bandwidth on a picture nobody asked
for. Names still respect
[names on public screens](race-settings.md#names-on-public-screens) exactly
like every other view — a stream reaches further than a gym wall.

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

## Scenes: configuring every screen at once

Moving from check-in to racing, or racing to an intermission, or into the
awards ceremony, is normally several screens changed one at a time — the
projector to a different view, the lobby TV to another, the entrance kiosk
to a third. A **scene** does all of it in one click.

**Four built-in scenes are always available**, next to the Displays list:

- **Check-In** — the main screen shows check-in progress, and any others show racer photos.
- **Racing** — the main screen goes full-screen, the next shows the standings alone, and the rest show the ordinary standings.
- **Intermission** — every screen shows racer photos.
- **Awards** — the main screen shows the ceremony, and the rest show the standings.

Clicking one applies it right away, using whichever screens are currently
connected — first the one at the top of your Displays list, then the next,
and so on. Nothing is saved; pressing it again just reapplies the same
recipe to whichever screens answer at that moment.

**Save your own layout as a scene** once you have set the screens up the way
you like by hand — click **Save current layout as a scene**, on the same
panel, and give it a name ("Front of house", say). Applying it later puts
every screen it remembers back into that exact state — not just which view
each one shows, but every setting that view has (the seconds-per-page on a
scrolling standings screen, which page a QR code opens, whether check-in
lists everybody or only who is still missing). A saved scene can be renamed
or deleted from the same panel, and one screen's entry within it can be
edited without starting over.

**A screen the scene remembers but that has gone quiet is simply skipped.**
Applying a scene reports how many screens it reached ("5 of 6 updated") —
the one that did not is not connected right now, the same *Not connected*
state described above, and nothing about the other five is held up by it.

**Saved scenes do not survive a restart of the machine**, the same as a
screen's own assignment above — build the layout again, or resave it, after
the machine has been restarted. The four built-in scenes are always there,
restart or not, since they are not something you built.

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
