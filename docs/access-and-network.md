# Access and your network

Trusty Track runs on one machine at your venue and serves everything else over
the local network. That is what makes it work without internet — and it means
anyone who can reach that network can reach the app.

By default, so can anyone who wants to change it.

## What the risk actually is

Not hackers. A pack meeting is a room full of children with phones, and the
address is on the projector. Without a PIN, anything the operator can do,
anyone in the building can do — including deleting the race in the middle of
it.

Setting a PIN takes about ten seconds and removes essentially all of that.

## The three kinds of screen

Trusty Track decides what a screen may do from the PIN it holds, not from who
is using it. There are three:

| | Holds | Can |
| --- | --- | --- |
| **Displays** | nothing | watch the race — standings, the live heat, timing |
| **Check-in desk** | the check-in PIN | add and edit racers, check them in, take photos |
| **Operator** | the operator PIN | everything |

A display needs no setup at all. Point a browser at the address and it works,
which is the behaviour you want on a screen taped to a wall. Exactly what
each role can and cannot do is in
[Roles and permissions](reference/roles-and-permissions.md).

## Setting the PINs

**Settings → Access.**

- **Operator PIN** — required for the rest to mean anything. Setting it is what
  turns access control on.
- **Check-in PIN** — optional. Worth setting if the registration desk runs on a
  device of its own: that device can add racers and check them in, and nothing
  else, so a tablet left on the table cannot delete a round. The Access panel
  says as much beside the box.

> [!TIP]
> Pick something you will not have to think about at 8am. It is protecting the
> race from a bored ten-year-old, not from an attacker.

Leaving both blank keeps the old behaviour: no PIN, no restrictions. That is
deliberate, so upgrading between events never locks you out of your own race.

## Entering a PIN on a device

A padlock appears in the header once a PIN is set. Click it, type the PIN, and
that device remembers it.

Each device is separate — your laptop holds the operator PIN, the check-in
tablet holds the check-in one, and the displays hold nothing. Click the open
padlock to make a device forget its PIN again.

> [!NOTE]
> The page reloads when you enter a PIN. That is expected: the live connection
> has to be re-established with the new credential.

### Changing or removing a PIN

![The Access panel with an operator PIN set](assets/screenshots/settings/03-access-pins.png)

**Settings → Access.** Type a new PIN over the old one to change it — you do
not need the old one, and leaving the box blank keeps whatever is set rather
than clearing it.

To turn a PIN off, click **Remove** beside it and then **Save Settings**. The
box greys out and says what will happen; **Keep** puts it back if you change
your mind before saving.

### If you forget the operator PIN

Anyone who can reach the machine running Trusty Track can remove it, using
**Remove** as above. There is no recovery from another device, which is the
point of a PIN — but it also means the person at the machine is never locked
out of their own event.

## Which network to use

In rough order of preference.

**A dedicated access point.** A cheap travel router, not connected to anything
else, with the Pi plugged into it. Nothing else is on the network, so the PIN is
the second line of defence rather than the only one. This is also the most
reliable option — see the note on wifi below.

**Wired, where the screens allow it.** Ethernet to the displays removes the
single largest source of trouble on race day.

**The venue's wifi.** Works, and is what most packs will use. Set a PIN.

> [!WARNING]
> A school or church guest network often isolates clients from each other, so
> the displays cannot reach the Pi at all. Test this before the event, not on
> the morning.

### About wifi and the displays

The audience displays hold a live connection to the machine running Trusty Track. If wifi drops, they
reconnect on their own and catch up — that is handled, and they will keep
retrying for as long as it takes rather than giving up.

What they cannot do is show a race they cannot reach. If the displays matter to
your event, a dedicated access point is worth the twenty pounds.

## What is not protected

Being straight about the limits:

- **Reading is open to everyone**, by design. Anyone on the network can see the
  standings, the roster and the live heat. That is what a display is.
- **Traffic is not encrypted**, and **there are no user accounts** — one
  shared PIN per role, which is the right size for a pack derby. The honest
  detail is in
  [Roles and permissions](reference/roles-and-permissions.md#what-is-not-protected).

## The activity log

**Settings → See what has happened**, or `/activity`.

Every operation anyone performs is recorded: what it was, when, which role did
it, and — kept out of the way until you ask for it — which device. It is the
answer to "who deleted that round", which until now had none.

![The activity log](assets/screenshots/settings/04-activity-log.png)
_The timeline, newest first. Each line carries the time, what was done, and which role did it; the details beneath name what it was done to._

Three things worth knowing:

- **Heat results say how they arrived** — *recorded by the timer*, or
  *entered by hand*. That is the distinction a disputed time turns on.
- **Refusals are recorded too**, in red — a check-in device trying to delete
  a round appears, though nothing was deleted.
- **No PIN is ever written down.**

The log is operator-only. The rest of the rules — how long it keeps, what
survives a race deletion — are in
[Roles and permissions](reference/roles-and-permissions.md#the-activity-log).
