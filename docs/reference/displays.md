# Audience display views

What a screen on the wall can show, and how telling it what to show works.
For the setup walkthrough, see the
[Observation Displays guide](../observation-displays.md).

## The six views

Every screen with the Live page open can be switched between these, from
**Race Control → Displays** or by its own URL:

| View | What it shows |
| --- | --- |
| **Standings** | The live leaderboard, plus the Now Racing / On Deck / After That panels |
| **Last heat's times** | The most recently recorded heat: every car in finishing order, with place and time |
| **Cycle between both** | Standings and last heat's times, alternating on a timer you set |
| **Projector** | The full-screen, high-contrast layout: the live heat large on the left, top five standings on the right, and a brief results overlay after each heat |
| **Racer photos** | A slideshow of the check-in photos: headshot, car, name, number, den |
| **Awards ceremony** | The [ceremony](../awards.md#announcing-them), one award at a time. Unlike every other view, it only moves when a person does — either at the screen, or with the **‹** and **›** buttons on its row in the operator's list |

**Driving the ceremony.** A screen showing the ceremony gets **‹** and **›**
buttons on its row, so the operator can move it on without walking to it.
They send a *step* rather than a slide number, which is why the arrow keys
and a presenter remote at the screen keep working: both drivers move the
same ceremony, and neither jumps it somewhere the other did not expect. The
buttons are dead while the row says *Not connected* — a screen that is not
listening cannot be told anything.

When a heat [breaks the track record](stats-and-exports.md#the-track-record),
the Projector view's results overlay and the Last heat's times view both
carry a gold banner naming the new time and the record it beat. It fires
only for a record that stood before today's race.

Notes on two of them:

- **Racer photos** goes in car number order rather than shuffling. Families
  are watching for their own child, and in order everybody comes round once
  per cycle. Racers with no photo are skipped rather than shown blank, and a
  race with no photos yet says so. Set the seconds-per-racer on the
  display's row — about five suits a small pack.
- **Projector** hides the app's navigation entirely, whichever way it was
  reached.

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
- **Assignments and names do not survive a restart** of the machine running
  Trusty Track. Screens fall back to their URLs — the same behaviour as
  before they were assigned — and can be renamed and re-assigned from the
  list.

## Connection behaviour

Displays hold a live connection and update themselves; nobody refreshes
anything. If the wifi drops they reconnect on their own and catch up,
retrying for as long as it takes. What they cannot do is show a race they
cannot reach — see
[which network to use](../access-and-network.md#which-network-to-use).

A [free race](../free-race.md) heat takes the "Now Racing" spot like any
other — the audience sees a demonstration run, labelled **Exhibition** — and
the leaderboard beside it does not move.
