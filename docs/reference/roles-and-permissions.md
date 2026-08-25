# Roles and permissions

What each kind of screen may do, how PINs work, and what the activity log
records. For the setup walkthrough, see
[Access and Your Network](../access-and-network.md).

## The three roles

Trusty Track decides what a screen may do from the PIN it holds, not from
who is using it:

| | Holds | Can | Cannot |
| --- | --- | --- | --- |
| **Display** | nothing | watch everything — standings, the live heat, timing, the roster | change anything at all |
| **Check-in desk** | the check-in PIN | add and edit racers, check them in, take and assign photos | touch the schedule, results, settings, or awards |
| **Operator** | the operator PIN | everything | — |

- With **no operator PIN set, there are no restrictions** — every screen is
  an operator. Setting the operator PIN is what turns access control on.
- Reading is open to everyone on the network by design; that is what a
  display is.
- Backups, restores, and the activity log are operator-only.

## How PINs behave

- A PIN is remembered **per device**: the laptop holds the operator PIN,
  the desk's tablet the check-in one, a wall display nothing. Click the
  open padlock to make a device forget its PIN.
- Entering a PIN reloads the page. Expected: the live connection has to be
  re-established with the new credential.
- Changing a PIN does not need the old one — type over it in **Settings →
  Access**. Leaving the box **blank keeps what is set** rather than
  clearing it; to turn a PIN off, use **Remove** beside it, then Save.
- Forgot the operator PIN? Anyone at the machine running Trusty Track can
  remove it the same way. There is no recovery from another device — which
  is the point — but the person at the machine is never locked out.

## What is not protected

- **Traffic is not encrypted.** Plain HTTP on a local network; someone
  already on it with the right tools could read a PIN as it goes past.
  Against the intended threat — casual mischief in the room — that changes
  little, but it is the honest position.
- **There are no user accounts.** One shared PIN per role. The log records
  which *role* did what and from which device, not which person.

## The activity log

**Settings → See what has happened**, or `/activity`. Operator-only.

- **Every operation is recorded**: what, when, which role, and — kept out
  of the way until asked for — which device.
- **Heat results say how they arrived**: *recorded by the timer* or
  *entered by hand*. That is the distinction a disputed time turns on.
- **Refusals are recorded too**, in red: a check-in device trying to delete
  a round appears in the log, though nothing was deleted.
- **No PIN is ever written down.** Setting or changing one appears as an
  action; the PIN itself does not, under any spelling.
- The log is trimmed to its most recent 50,000 entries when the app starts
  — many events' worth. It travels inside a
  [backup](backups.md), and deleting a race does **not** delete its
  history: the record of a deletion would be worth little if it took the
  rest of the story with it.
