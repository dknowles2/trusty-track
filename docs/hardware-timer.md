# Connecting a Hardware Timer

Trusty Track can read finish times directly from an electronic finish line, so
nobody has to watch the lanes and write times down. This page covers plugging
one in and checking it works — ideally the week before the derby, not ten
minutes before the first heat.

If you have no timer, or you want to try the software first, use the
[Fake Timer](fake-timer.md) instead.

## What is supported

**Micro Wizard K1, K2 and K3** — sold as the FastTrack K-series. This is the
timer Trusty Track has been built against.

Seven more are described, adapted from
[DerbyNet](https://github.com/jeffpiazza/derbynet)'s definitions: the Derby
Timer, Bert Drake, PDT, The Judge, "The Champ" (SmartLine/BestTrack), the JIT
Racemaster, and the NewBold DT/TURBO/DerbyStick family. Six of the seven answer
an identifying question, so the server can find them on its own. The NewBold
family does not answer one, so it has to be picked by hand — see **Choosing the
model yourself** below.

## Choosing the model yourself

Leave **Timer Model** on *Detect automatically* and the server asks each timer
it knows about who it is, which is the right answer for six of the seven. Pick
a model when:

- **Yours is not found.** The NewBold DT/TURBO/DerbyStick family answers no
  identifying question, so it can only be reached this way — the picker marks
  it *must be chosen*. It also runs at 1200 baud with 7 data bits and 2 stop
  bits, and naming it is what gets the port opened that way; detection's
  fallback assumes the usual 9600 8-N-1 and would read noise.
- **You would rather it did not ask.** Detection writes a probe command to
  every port it tries. That is harmless as far as anyone knows, but an operator
  who already knows what they have has no reason to allow it.

Naming a model does not pin the port. With the serial port left blank the
server still looks for the timer — it just looks for *that* timer, rather than
trying seven models' probe commands on your hardware.

The setting sits under **Timer Type**, and only appears once you have chosen
something other than the fake timer, because a fake timer has no model.

**No heat has ever been run through any of them**, including the Micro Wizard.
Three — the Micro Wizard, the Derby Timer and the PDT — have been checked
against recordings of what those devices genuinely said, which is real evidence
and caught a real bug: our Micro Wizard description could not identify a K3,
because that firmware writes `Serial Number 15985` with a space. Auto-detection
would simply have failed on the hardware.

The rest have only been read against protocol documentation. The timer check
page says which is which for whichever device answers. This is the honest state
of things rather than false modesty: a description that is one character wrong
fails by silently never matching.

If you have one of these on a bench, the timer check page below will tell you
in about a minute whether it works, and that report is worth more than anything
else you could contribute right now.

Other models are not supported. Adding one is a matter of describing its serial
protocol rather than writing code for it, so opening an issue with the model
name and its protocol documentation is genuinely useful.

## Two ways to connect

Both are chosen per track in **System Settings**, under **Timer Type**.

### Plugged into the server

**Auto-Detect (Backend Connected).** The timer's USB cable goes into the
machine running Trusty Track — typically the Raspberry Pi at the venue.

Leave **Serial Port** blank. When the server starts it looks at each USB port
in turn, asks whatever is there to identify itself, and connects to the one
that answers. You do not need to know what a device path is.

Fill the port in only if you have a reason to: a timer on a built-in serial
port rather than USB, or a machine where you want to be certain which device
gets used. A port you enter by hand is used exactly as given and is never
probed.

### Plugged into the laptop running the browser

**Use Remote Proxy.** The timer's USB cable goes into the computer you are
operating from, and the browser passes the data through to the server. Nothing
extra to install.

This uses the browser's Web Serial support, so it needs **Chrome or Edge** —
Safari and Firefox do not have it. The browser will ask you to pick the serial
port the first time.

This mode identifies the timer for itself as well. Once you have picked the
port, the server asks whatever is on it to identify itself, exactly as it does
for a timer plugged into the server — so you do not have to tell it which model
you have. If nothing recognisable answers, it takes about ten seconds to work
through the models it knows before falling back to assuming a MicroWizard.

## Launching a heat from the screen

Some tracks have a solenoid fitted to the start gate, wired to the timer. Where
that is the case, an armed heat can be launched from the race screen instead of
by somebody standing at the track.

Nothing in a timer's protocol says whether the solenoid is there, so it is a
setting: **System Settings → the track → This track has a remote start gate**.
Tick it only if the hardware is actually fitted. On a Micro Wizard the gate
release is a separately-sold accessory, and the timer accepts the command and
does nothing without it.

Two things have to be true before the button appears, and the setting is only
one of them: the timer model also has to have a command for opening the gate.
The Micro Wizard and the PDT do; the other six have no such command described,
so ticking the box will not give you the button.

Where both hold, a **Release Start Gate** button appears on the timer panel
once a heat is armed — and only then. Releasing the gate with no heat armed
sends cars down a track nothing is timing, and those runs cannot be recovered.

**This has not been tested against hardware.** No profile here has, but this is
the only part that moves something physical, so it is worth saying twice. Try
it with an empty track before you try it with a queue.

## Checking it works

**System Settings → Check the timer connection**, or go to `/timer-check`.

This page shows every track's timer live: what state it is in, which device
answered, which port it was found on, and the raw conversation between the
server and the timer. You do not need a race set up to use it.

What the states mean:

| What you see | What it means |
| --- | --- |
| **Ready** | The timer answered and is waiting for a heat. This is what you want. |
| **Not connected** | No port is open. Check the cable, then press the button to search again. |
| **Port open, waiting for the timer to answer** | Something is on the port but it has not identified itself. The server keeps asking every few seconds. If it does not clear, the port is probably something other than the timer. |
| **Armed** | Lanes are set and the timer is waiting for the start gate. |
| **Staged** | The start gate is closed with cars behind it. |
| **Racing** | The gate opened and the timer is counting. |
| **Results overdue** | The race started but no finish was reported. See below. |
| **Fault** | The connection failed. The reason is shown on the page. |

### Reading the serial traffic

The log on that page shows every byte in both directions, annotated. A healthy
start-up looks roughly like this:

```
→ N1                                        enable new-format results
→ N2                                        enable gate feedback
← *                                         command acknowledged
← *                                         command acknowledged
```

Those two commands go out the moment the connection opens, which is why the log
usually starts there. If the server found the timer by searching the USB ports,
the timer announced itself during that search, before this log began — so the
question and the answer are not in it. If instead you entered a serial port by
hand, there was no search, and the server asks every few seconds until
something answers:

```
→ RV                                        request version
← Copyright (c) Micro Wizard 2002-2009      timer identified itself
```

Then, during a heat:

```
→ MG                                        clear lane masks
→ ME                                        mask lane 5
→ LR                                        arm / reset timer
← >                                         gate closed
← @                                         gate opened - race started
← A=3.452! B=3.501"                         results received
```

If you see commands going out (`→`) and nothing coming back, the cable or the
port is wrong. If you see traffic that never becomes results, the log is the
thing to attach to a bug report.

## When something goes wrong

**Nothing is found.** The page will say which ports it tried. Only USB ports
are searched — a timer on a built-in serial port has to have its path entered
by hand.

**"Results overdue".** The gate opened and the timer never reported a finish.
The Micro Wizard gives up roughly ten seconds after the gate opens, so this
usually means a car did not reach the finish line, or a lane sensor did not
see it. Use **Force Results** on the race screen to make the timer report what
it has, then enter anything missing by hand.

**The times are recorded against the wrong racers.** Stop and check the lane
numbering: lane 1 in Trusty Track must be the lane the timer calls `A`.

**A heat was armed and then the schedule changed.** The timer disarms itself
and says so rather than recording times against a field that has moved. Re-arm
the heat and run it again.


## If a lane stops working

A sensor fails, a connector comes loose, and one lane of the track stops
reporting. It happens, usually on the morning of the event.

**Settings → Tracks → Lanes in service.** Untick the lane on the track it
belongs to, and every round you generate from then on is scheduled around it — the remaining lanes are used,
everybody still races the same number of times, and the heats name the lanes
that actually exist rather than renumbering them.

![Lane 3 out of service, inside the track's own card](assets/screenshots/settings/01-lanes-in-service.png)

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

Unlike the rest of the track's settings, this applies as soon as you click it
rather than when you press **Save Settings** — a lane going out of service is
something that happens to you mid-event, not something you plan.

Tick the lane again when it is fixed, and the next round uses it.

A track with no working lanes generates no schedule at all, and the settings
page says so.
