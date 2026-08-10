# Connecting a Hardware Timer

Trusty Track can read finish times directly from an electronic finish line, so
nobody has to watch the lanes and write times down.

If you have no timer, or you want to try the software first, use the
[Fake Timer](fake-timer.md) instead.

> [!TIP]
> Do this the week before the derby, not ten minutes before the first heat.
> The whole page below exists so that a problem surfaces on your bench, with
> time to fix it, rather than at the track with a queue behind the gate.

## The short version

For most people, connecting a timer is four steps:

1. Plug the timer's USB cable into the machine running Trusty Track.
2. In **System Settings**, set the track's **Timer Type** to
   **Plugged into this machine**. Leave **Serial Port** blank.
3. Open **System Settings → Check the timer connection**.
4. When it says **Ready**, you are done.

Everything else on this page is for when that did not work, or your setup is
different: the timer plugs into your laptop instead of the server, your model
has to be picked by hand, your track has a remote-controlled start gate, or a
lane dies on the morning of the event.

## Which timers work

| Timer | Found automatically? | How well tested |
| --- | --- | --- |
| **Micro Wizard K1 / K2 / K3** (FastTrack) | Yes | Checked against recordings of a real device |
| Derby Timer | Yes | Checked against recordings of a real device |
| PDT | Yes | Checked against recordings of a real device |
| Bert Drake | Yes | Protocol documentation only |
| The Judge | Yes | Protocol documentation only |
| "The Champ" (SmartLine / BestTrack) | Yes | Protocol documentation only |
| JIT Racemaster | Yes | Protocol documentation only |
| NewBold DT / TURBO / DerbyStick | **No — pick it by hand** | Protocol documentation only |

The Micro Wizard is the timer Trusty Track has been built against. The other
seven descriptions are adapted from
[DerbyNet](https://github.com/jeffpiazza/derbynet)'s definitions.

> [!WARNING]
> **None of these has run a real heat on real hardware yet** — including the
> Micro Wizard. Recordings are the stronger evidence, but they are not a live
> run. If you own one of these timers,
> [testing it and sending us the result](#testing-your-timer-and-telling-us)
> takes about two minutes and is the most useful thing you could contribute.

Other models are not supported yet. Adding one is a matter of describing how
the timer talks rather than writing code — so opening an issue naming the
model, with its manual if you have it, genuinely helps.

## Two ways to connect

Both are chosen per track in **System Settings**, under **Timer Type**.

![A track's timer settings: the connection under Timer Type, the model picker beneath it, and the remote start gate setting at the bottom](assets/screenshots/timers/01-timer-settings.png)
_Everything about a track's timer lives on the track's own card in System Settings: how it connects, which model it is, and whether a remote start gate is fitted._

### Plugged into the machine running Trusty Track

**Plugged into this machine.** The timer's USB cable goes into the machine
running Trusty Track — typically the Raspberry Pi at the venue. This is the
setup to prefer when you have the choice: nothing depends on which laptop is
open or which browser it runs.

Leave **Serial Port** blank. When the server starts it checks each USB socket
in turn, asks whatever is plugged in to identify itself, and connects to the
one that answers. You do not need to know anything about ports or paths.

Fill the port in only if you have a reason to: a timer on a built-in serial
port rather than USB, or a machine where you want to be certain which device
gets used. A port you enter by hand is used exactly as you typed it — the app
does not go looking elsewhere.

### Plugged into the laptop running the browser

**Plugged into the laptop running the browser.** The timer's USB cable goes
into the computer you are operating from, and the browser passes what it says
along. Nothing extra to install.

> [!NOTE]
> This uses the browser's Web Serial support, so it needs **Chrome or Edge** —
> Safari and Firefox do not have it.

The browser asks you to pick the serial port the first time. After that, the
server identifies the timer exactly as it does when plugged in directly, so
you do not have to tell it which model you have. If nothing recognisable
answers, it takes about ten seconds to work through the models it knows before
falling back to assuming a Micro Wizard.

## Checking it works

**System Settings → Check the timer connection**, or go to `/timer-check`.

This page shows every track's timer live: what state it is in, which device
answered, and where it was found. You do not need a race set up to use it.

![The timer check page with a healthy timer: Ready in green, the identified device, its provenance note, the test panel, and the serial traffic beneath](assets/screenshots/timers/02-timer-check-ready.png)
_A healthy timer: **Ready**, the device it identified itself as, and — in the yellow note — how well that device's support has actually been tested._

| What you see | What it means |
| --- | --- |
| **Ready** | The timer answered and is waiting for a heat. This is what you want. |
| **Not connected** | Trusty Track cannot see a timer. Check the cable, then press the button to search again. |
| **Port open, waiting for the timer to answer** | Something is plugged in, but it has not said what it is. Trusty Track keeps asking every few seconds. If this never clears, whatever is plugged in is probably not the timer. |
| **Armed** | Lanes are set and the timer is waiting for the start gate. |
| **Staged** | The start gate is closed with cars behind it. |
| **Racing** | The gate opened and the timer is counting. |
| **Results overdue** | The race started but no finish was reported. See [below](#when-something-goes-wrong). |
| **Fault** | The connection failed. The reason is shown on the page. |

### The scrolling text at the bottom

Beneath each timer, the page shows the conversation between Trusty Track and
the device. **You never need to read it.** It exists so a problem can be
*sent* rather than described — if the timer misbehaves,
[run the test below](#testing-your-timer-and-telling-us) and download the
report, and the conversation goes with it.

The one thing it tells you with no decoding: lines marked `→` are Trusty
Track talking, lines marked `←` are the timer answering. Arrows going out
with nothing ever coming back means the cable or the port is wrong.

For the technically curious, annotated examples of a healthy conversation are
in the [design notes](design.md#54-reading-the-serial-log).

## When something goes wrong

**Nothing is found.** The timer check page says which ports it tried. Only USB
ports are searched — a timer on a built-in serial port has to have its path
entered by hand.

**"Results overdue".** The gate opened and the timer never reported a finish.
The Micro Wizard gives up roughly ten seconds after the gate opens, so this
usually means a car did not reach the finish line, or a lane sensor did not
see it. Use **Force Results** on the race screen to make the timer report what
it has, then enter anything missing by hand.

**The times are recorded against the wrong racers.** Stop and check the lane
numbering: lane 1 in Trusty Track must be the lane the timer calls `A`.

**A heat was armed and then the schedule changed.** The timer disarms itself
and says so, rather than recording times against a field that has moved.
Re-arm the heat and run it again.

## Testing your timer and telling us

The timer check page can run your timer through a pretend heat — no race set
up, nothing recorded anywhere — and then package everything that happened
into a file you can send us. This is how a timer goes from "described from
documentation" to "known to work", and it takes about two minutes:

![The test panel mid-run, showing the instruction to close the start gate](assets/screenshots/timers/03-test-run-armed.png)
_The test walks you through it one step at a time — here it is waiting for a hand on the gate._

1. On the timer check page, press **Start a test run** under your track.
2. Do what the page asks: close the start gate, open it, then trip each
   finish-line sensor by hand — a wave over each lane works.
3. The times appear as the timer reports them. If a lane never fires, press
   **Finish with what it has** — a missing lane is worth reporting too.
4. Press **Download the report**, then **Report a problem**, and attach the
   downloaded file to the issue that opens.

![A finished test: a time and place for each lane, with Download the report and Report a problem alongside](assets/screenshots/timers/04-test-run-results.png)
_A finished test. If the times match what the timer's own display showed, it works; either way, the report is the thing to send._

The report holds the full conversation between Trusty Track and your timer,
which is exactly what a fix is built from — often it can be turned into a
permanent test, so the fix stays fixed. It contains nothing about your pack
or your racers.

If the test looks right, that is worth a word too: "it works" moves a timer
out of the untested column.

## Choosing the model yourself

Most people never touch this. Leave **Timer Model** on *Detect automatically*
and the server asks each timer it knows about who it is, which works for seven
of the eight models. Pick one yourself when:

- **Yours is the NewBold family.** It never announces itself, so it can only
  be reached this way — the picker marks it *must be chosen*. It also talks at
  a different speed from every other supported timer, and picking it is what
  makes the connection use that speed; automatic detection assumes the usual
  one and would hear only noise.
- **You would rather it did not ask.** Detection works by asking: it sends a
  short question to everything plugged in and waits for an answer. That is
  harmless as far as anyone knows, but if you already know what you have,
  picking it skips the asking.

Picking a model does not tell the app where the timer is plugged in. With the
serial port left blank it still goes looking — it just looks for *that* timer,
instead of asking about every model it knows.

The setting sits under **Timer Type**, and only appears once you have chosen
something other than the fake timer, because a fake timer has no model.

## Launching a heat from the screen

Some tracks have a solenoid fitted to the start gate, wired to the timer.
Where that is the case, an armed heat can be launched from the race screen
instead of by somebody standing at the track.

Two things have to be true before the button appears:

1. **The track has the hardware.** The timer cannot tell us whether the
   release is fitted, so it is a setting: **System Settings → the track →
   This track has a remote start gate**. Tick it only if the hardware is
   actually there — on a Micro Wizard the gate release is a separately-sold
   accessory, and without it the timer accepts the command and quietly does
   nothing.
2. **The timer model has a command for opening the gate.** The Micro Wizard
   and the PDT do; the other six have no such command described, so ticking
   the box will not give you the button.

Where both hold, a **Release Start Gate** button appears on the timer panel
once a heat is armed — and only then. Releasing the gate with no heat armed
sends cars down a track nothing is timing, and those runs cannot be recovered.

> [!WARNING]
> **This has not been tested against hardware.** No timer description here
> has, but this is the only part that moves something physical, so it is
> worth saying twice. Try it with an empty track before you try it with a
> queue.

## If a lane stops working

A sensor fails, a connector comes loose, and one lane of the track stops
reporting. It happens, usually on the morning of the event.

**Settings → Tracks → Lanes in service.** Untick the lane on the track it
belongs to, and every round you generate from then on is scheduled around it:
the remaining lanes are used, everybody still races the same number of times,
and the heats name the lanes that actually exist rather than renumbering them.

![Lane 3 out of service, inside the track's own card](assets/screenshots/settings/01-lanes-in-service.png)

Unlike the rest of the track's settings, this applies as soon as you click it
rather than when you press **Save Settings** — a lane going out of service is
something that happens to you mid-event, not something you plan.

Tick the lane again when it is fixed, and the next round uses it. A track with
no working lanes generates no schedule at all, and the settings page says so.

### What happens to the round you are in the middle of

It depends on how far it has got:

| The round | What happens |
| --- | --- |
| Not started | Rebuilt for the lanes that remain — everybody gets an equal schedule |
| Part-way through | Completed heats keep their results; the dead lane is dropped from the heats still to come |
| Finished | Left alone |

The middle case has a consequence, and Trusty Track handles it rather than
hiding it. Racers who were due to run in the lane that failed now race one
fewer time than everybody else.

- **If your race is scored on times** (the default), that is fine. Standings
  use each racer's *average*, so somebody with four heats and somebody with
  five are compared on the same footing.
- **If your race is scored on points**, it is not fine — points add up, so a
  racer with one fewer heat would have a lower total, and lower is better.
  Trusty Track leaves that round out of the standings and says so on the
  standings page. The round still runs and you can still look at its results;
  it just does not decide the trophies.
