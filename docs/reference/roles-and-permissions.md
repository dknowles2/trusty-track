# Roles and permissions

What each kind of screen may do, how PINs work, and what the activity log
records. For the setup walkthrough, see
[Access and Your Network](../access-and-network.md).

## The three roles

Trusty Track decides what a screen may do from the PIN it holds, not from
who is using it:

| | Holds | Can | Cannot |
| --- | --- | --- | --- |
| **Display** | nothing | watch everything — standings, the live heat, timing, the roster; vote, while [voting is open](../awards.md#letting-people-vote) | change anything else at all |
| **Check-in desk** | the check-in PIN | add and edit racers, check them in, take and assign photos | touch the schedule, results, settings, or awards |
| **Operator** | the operator PIN | everything | — |

- With **no operator PIN set, there are no restrictions** — every screen is
  an operator. Setting the operator PIN is what turns access control on.
- Reading is open to everyone on the network by design; that is what a
  display is.
- Backups, restores, and the activity log are operator-only.
- **Casting a vote is the one thing a display may do.** It is not a fourth
  PIN or a credential of any kind — the operator turns voting on for the
  whole race, and any phone on the network may vote for a judged award while
  it is on. See [Letting people vote](../awards.md#letting-people-vote).

### What a screen shows for its own role

Every screen that mutates something greys out the buttons a device's
current role cannot use, rather than only saying so once one is pressed:
the roster (**Roster**), **Race Control**'s schedule, **Awards**, **System
Settings** (including the per-track lanes-in-service and track-records
panels, and Backup), the **Timer check** page, and Race Control's
**Displays** tab (both the display list and Scenes). Hovering a greyed-out
control explains which PIN would unlock it.

**Stats** and **Standings** make no change to the race at all, so there is
nothing on them to gate. **Voting** and the audience display itself
(**Live**, the awards ceremony) are the deliberate opposite case: a display
holds no PIN by design, and the one mutation it may run — casting a vote —
stays fully available, since that is the screen a display is meant to
reach with no credential.

This is presentation only. The check that actually matters runs on the
server for every mutation regardless of what a screen shows — see "The
three roles" above — so a control that is ever wrongly left enabled fails
safe into the humane refusal below, never into something being allowed that
should not be.

If a button *is* pressed and the role behind it cannot do that, the app
answers in one sentence — *"That needs the operator PIN. Enter it with the
lock icon in the top bar."*, or *check-in* for the lower PIN — rather than
naming the role or the underlying operation.

## How PINs behave

- A PIN is remembered **per device**: the laptop holds the operator PIN,
  the desk's tablet the check-in one, a wall display nothing. Click the
  open padlock to make a device forget its PIN.
- Entering a PIN reloads the page. Expected: the live connection has to be
  re-established with the new credential.
- Changing a PIN does not need the old one — type over it in **Settings →
  Access**. Leaving the box **blank keeps what is set** rather than
  clearing it; to turn a PIN off, use **Remove** beside it, then Save.
- **Forgetting the operator PIN locks everyone out, including whoever is
  sitting at the machine.** There is no recovery inside the app — see
  [If you forget the operator PIN](#if-you-forget-the-operator-pin) below.

### If you forget the operator PIN

Trusty Track works out a screen's role entirely from the PIN it was given —
never from where it is, so being physically at the machine gets no special
treatment. Without the operator PIN, the app itself is a locked door: no
button anywhere clears it, and there is nothing a person at the keyboard can
click that a stranger elsewhere on the network couldn't also click. Write the
PIN down somewhere durable before race day; that is far cheaper than the
alternative below.

There is still a way back in, but it means going around the app rather than
through it — editing the database file that stores the PIN, with the app
stopped:

1. Stop Trusty Track.
2. Find `trusty-track.db` in the data directory — `~/.trustytrack` by
   default, or wherever `TRUSTYTRACK_DATA_DIR` points if that's set.
3. Open it with any SQLite tool (for example, `sqlite3
   ~/.trustytrack/trusty-track.db`) and run:

   ```sql
   UPDATE groups SET operator_pin_hash = NULL;
   ```

   That clears the operator PIN only — leave `checkin_pin_hash` alone if a
   check-in PIN should keep working.
4. Restart Trusty Track. With no operator PIN set, every screen is an
   operator again, the same as an install that has never had one — set a
   new PIN from **Settings → Access** once you're back in.

This is a database edit, not a feature of the app, and it is the only way
back in short of restoring an earlier [backup](backups.md) taken before the
PIN was set.

## HTTPS, certificates, and plain HTTP

The macOS app, the Windows app, the Raspberry Pi installer and a from-source
install all serve **https://** by default, using a certificate Trusty Track
generates for itself. That is not about hiding your PIN from anyone — it is
what lets the camera and the check-in scanner turn on at all. A modern
browser refuses to open a camera except on a "secure" connection, and it only
counts `https://` and the machine's own `localhost` as secure — a plain
`http://192.168.1.42:8000` on a second device does not qualify, whatever
network it is on.

Because the certificate is one Trusty Track made up on the spot rather than
one a browser already trusts, every browser warns about it the first time —
"Your connection is not private" or similar. That is expected; the install
guides for [macOS/Windows](../user/install-windows.md#step-4-use-trusty-track)
and the [Raspberry Pi](../user/install-raspberry-pi.md#accepting-the-security-certificate-warning)
walk through clicking past it. Docker is the exception: the container image
serves plain `http://` from the start, with no certificate at all, so the
camera and scanner already only work on the machine running Docker itself —
see [Camera features need HTTPS away from the host
machine](../user/install-docker.md#accessing-from-other-devices-on-your-network).

### Turning HTTPS off

If the certificate warning is a bigger problem for your event than losing
the camera on a second device — a shared school iPad nobody wants to explain
"Advanced → Proceed anyway" to, say — you can opt out and serve plain HTTP
everywhere instead. Everything except photo capture and the check-in scanner
keeps working exactly the same on every device: the roster, Race Control,
standings, the audience displays.

- **macOS and Windows app:** the tray/menu-bar icon has a **Use Plain HTTP
  (no certificate warnings)** item. Click it, then quit and reopen Trusty
  Track — it does not take effect until the app restarts.
- **Raspberry Pi:** run the installer with the flag set —
  `sudo TRUSTYTRACK_HTTP_ONLY=1 ./scripts/install-pi.sh` — or, on an install
  that already exists, add `TRUSTYTRACK_HTTP_ONLY=1` to
  `/etc/trustytrack/env` and run `sudo systemctl restart trustytrack`.
- **From source:** set the same variable before `scripts/serve.sh` or
  `scripts/run_dev.sh` — `TRUSTYTRACK_HTTP_ONLY=1 ./scripts/serve.sh`.
- **Docker:** nothing to do — it is already plain HTTP.

Turning it back on undoes all of this: switch the toggle again (or unset the
variable) and restart. The default has not changed — this is an opt-out for
one event, not a setting anybody has to think about to get HTTPS.

## What is not protected

- **Traffic is encrypted by default, but not verified.** The self-signed
  certificate above still encrypts the connection — nobody merely watching
  the network sees a PIN in plain text — but it is Trusty Track's own
  certificate rather than one a browser already trusts, so it proves nothing
  about who is on the other end. With `TRUSTYTRACK_HTTP_ONLY` set, or on
  Docker's default plain HTTP, there is no encryption at all: a PIN travels
  as ordinary text, and anyone already on the network with the right tools
  could read it. Against the intended threat — casual mischief in the room —
  that changes little either way, but it is the honest position.
- **There are no user accounts.** One shared PIN per role. The log records
  which *role* did what and from which device, not which person.

## The activity log

**Settings → Activity log**, or `/activity`. Operator-only.

- **Every operation is recorded**: what, when, which role, and — kept out
  of the way until asked for — which device.
- **Heat results say how they arrived**: *recorded by the timer* or
  *entered by hand*. That is the distinction a disputed time turns on.
- **Refusals are recorded too**, in red, and each names which of three
  deliberately separate rules stopped it — a role limit ("That needs the
  operator PIN. Enter it with the lock icon in the top bar."), the public
  demo, or a locked race — so a role refusal reads differently from either
  of the other two, though nothing was deleted any of the three ways. Which
  *device* a role refusal came from is the log's own role column, next to
  it on the same line.
- **No PIN is ever written down.** Setting or changing one appears as an
  action; the PIN itself does not, under any spelling.
- The log is trimmed to its most recent 50,000 entries when the app starts
  — many events' worth. It travels inside a
  [backup](backups.md), and deleting a race does **not** delete its
  history: the record of a deletion would be worth little if it took the
  rest of the story with it. The page itself shows the most recent 200 at
  first; **Load older entries** at the foot of the page reaches further
  back, one page at a time.
