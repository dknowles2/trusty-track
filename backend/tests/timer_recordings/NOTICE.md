# Recorded timer sessions

The `.playback` files here are taken unmodified from
[DerbyNet](https://github.com/jeffpiazza/derbynet), `timer/testing/testdata/`,
which is MIT-licensed, © Jeff Piazza.

They are the closest thing this project has to a real timer. Everything else in
the timer test suite checks our profiles against lines *we* wrote down from
protocol documentation — which cannot catch a description that is confidently
wrong. These recordings are what the devices actually said, so replaying them
tests our reading of the protocol rather than our memory of it.

That distinction is not theoretical: replaying the FastTrack recording found
that our MicroWizard profile could not identify a K3, because that firmware
writes `Serial Number 15985` with a space and our pattern demanded the digits
immediately after `Number`. Auto-detection would have failed on the hardware,
and nothing we had written ourselves would ever have said so.

## Format

DerbyNet uses these to drive a simulated device:

- `##` — a comment.
- `#on <command>` … `#end` — what the device sends in reply to `<command>`.
- `#pause` — the simulator waits here.
- Anything else — output the device produces unprompted.

`backend/tests/test_timer_recordings.py` reads them with that grammar and feeds
every device line to the matching profile.

## What they do and do not prove

They prove our profiles read the traffic these three devices actually produce,
in the order they produce it. They do not prove a heat runs: the recordings
carry no timing, they simulate one scripted session each, and three of our
eight profiles have no recording at all.
