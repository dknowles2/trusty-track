# Timers

The reference for electronic finish lines: which models work, how detection
works, what each state means, and the remote start gate. For the setup
walkthrough, see [Connecting a Hardware Timer](../hardware-timer.md).

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

**None of these has run a real heat on real hardware yet** — including the
Micro Wizard. Recordings are the stronger evidence, but they are not a live
run. [Running the two-minute test](../hardware-timer.md#testing-your-timer-and-telling-us)
and sending the report is the most useful contribution a timer owner can
make. The timer check page shows each model's own evidence level in a yellow
note.

Other models are not supported yet. Adding one is a matter of describing how
the timer talks rather than writing code, so an issue naming the model —
with its manual, if you have it — genuinely helps.

## The four timer types

Chosen per track in **Settings → Tracks**, on the track's card under **The
timer**:

| Setting | What it means |
| --- | --- |
| **Fake Timer (Manual Control)** | No hardware. Trusty Track makes up times. See the [Fake Timer guide](../fake-timer.md) |
| **Plugged into this machine** | The timer's USB cable goes into the machine running Trusty Track. Prefer this when you have the choice — nothing depends on which laptop is open |
| **Plugged into the laptop running the browser** | The timer plugs into the computer you operate from, and the browser passes what it says along. Needs Chrome or Edge |
| **No timer — I'll enter results by hand** | There is no electronic timer at all. See [Race and Track Settings](race-settings.md#no-timer) |

## How detection works

- With **Serial Port** left blank, Trusty Track checks each USB socket in
  turn, asks whatever is plugged in to identify itself, and connects to the
  one that answers.
- A port entered by hand is used exactly as typed — no searching. Only USB
  ports are searched automatically, so a timer on a built-in serial port
  needs its path entered.
- On the browser connection, the browser asks you to pick the port the
  first time; identification then works the same way. If nothing
  recognisable answers within about ten seconds, a Micro Wizard is assumed.

### The Timer Model picker

**Detect automatically** works for seven of the eight models. Pick one
yourself when:

- **Yours is the NewBold family.** It never announces itself and talks at a
  different speed from every other supported timer; picking it is what makes
  the connection use that speed.
- **You would rather it did not ask.** Detection sends a short question to
  everything plugged in. Harmless as far as anyone knows, but picking a
  model skips the asking.

Picking a model does not say where the timer is plugged in. With the port
blank, Trusty Track still searches — for that timer only.

## One connection at a time

On the browser connection, whichever tab is connected *is* the timer. Opening
Race Control on a second device, or reloading a tab before its old connection
has closed, takes the timer over rather than sharing it: the newer connection
wins, and the older one is disconnected with a message saying another
connection took over. If a tab unexpectedly shows the timer as disconnected,
check whether it is open somewhere else too.

## What each state means

| State | What it means |
| --- | --- |
| **Ready** | The timer answered and is waiting for a heat. This is what you want. |
| **Not connected** | Trusty Track cannot see a timer. Check the cable, then search again — or, for a browser-connected timer, press **Connect Hardware Timer**. |
| **Port open, waiting for the timer to answer** | Something is plugged in but has not said what it is. Trusty Track keeps asking. If this never clears, whatever is plugged in is probably not the timer. |
| **Armed** | Lanes are set and the timer is waiting for the start gate. |
| **Staged** | The start gate is closed with cars behind it. |
| **Racing** | The gate opened and the timer is counting. |
| **Results overdue** | The race started but no finish was reported — usually a car that never reached the finish line. **Force Results** makes the timer report what it has. |
| **Fault** | The connection failed, or a heat's results could not be saved. The reason is shown on the page. If a heat just finished, its times are still shown — read them off the screen and enter them with **Override**. |

## The serial log

Beneath each timer on the check page, and on the race screen, is the
conversation between Trusty Track and the device. You never need to read it
— it exists so a problem can be *sent* rather than described. Lines marked
`→` are Trusty Track talking; `←` is the timer answering. Arrows going out
with nothing coming back means the cable or the port is wrong. Annotated
examples of a healthy conversation are in the
[design notes](../design.md#54-reading-the-serial-log).

## Test runs

**Start a test run** on the timer check page arms every lane with no heat
behind it: the same commands as a real heat, and **nothing recorded
anywhere** — no heat, no results, no log entry. It is refused while a real
heat is armed, so a bench test cannot disarm race day.

**Download the report** packages the timer's model, settings, and the full
serial conversation into a file. It contains nothing about your pack or
your racers, and it is exactly what a fix is built from.

## The remote start gate

Some tracks have a solenoid on the start gate, wired to the timer. A
**Release Start Gate** button appears on the race screen when **both** of
these hold:

1. **The track has the hardware** — the setting **This track has a remote
   start gate** on the track's card. The timer cannot report whether the
   release is fitted; on a Micro Wizard it is a separately-sold accessory,
   and without it the command is accepted and quietly ignored.
2. **The timer model has a command for it.** The Micro Wizard and the PDT
   do; the other six do not.

The button only appears while a heat is armed. Releasing the gate with no
heat armed would send cars down a track nothing is timing, and those runs
cannot be recovered.

**This has not been tested against hardware.** It is the only feature here
that moves something physical — try it with an empty track first.
