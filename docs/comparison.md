---
hide:
  - toc
---

# How Trusty Track compares

Several programs run Pinewood Derby races, and most packs would do fine with any
of them. Here is what the others are, and when one of them is the better pick.

Prices and versions were checked on each program's own site on 28 August 2026.
They move, so follow the links before you spend anything, and please
[tell us](https://github.com/dknowles2/trusty-track/issues) if something here has
gone stale or reads unfairly.

You can try Trusty Track without installing it. The
[demo](https://demo.trusty-track.com) is a real race, already set up. There is only
one of it, so anybody else looking at the same moment is in the same race as you,
and it resets itself once it has been quiet for a while. DerbyNet's playground gives
each visitor a private instance instead, which is the nicer arrangement and one we
have not built yet.

## The others

[**GrandPrix Race Manager**](https://www.grandprix-software-central.com/gprm/) is
the one you will hear named most often. It is on its twenty-sixth annual version,
covers Awana Grand Prix and Raingutter Regatta as well as Pinewood, and costs $60
for Lite or $80 for Pro. One Windows or Mac machine runs the event. If somebody in
your pack already knows this program, that is worth more than anything on this
page.

[**DerbyNet**](https://derbynet.org/) is free, MIT-licensed, and has been
developed in the open since 2015. It works much the way Trusty Track does: a small
server on one machine, with every other screen joining in a browser. Installing it
means unzipping a folder with Apache and PHP inside it and starting that server,
which is a couple of steps more than a double-click. Their
[playground](https://hosting.derbynet.org/playground.php) hands you a private
instance for a few hours if you want a look first.

Seven of Trusty Track's eight timer profiles are adapted from DerbyNet's protocol
notes, under its licence and credited in the source. A pack with an unusual timer
has Jeff Piazza to thank for that, not us.

[**Derby Magic Race Manager**](https://derbymagic.com/race-management/) costs $65
and runs on Windows. The Derby Magic Company sell tracks and timers too, so it is
the sensible choice if your track came from them and you would rather have one
phone number for the lot.

[**Derby Day!**](http://www.derbydaysoftware.com/) is free, Windows-only, takes up
to fifteen racers and does exactly one format: ladderless elimination. If that is
how your pack races, its narrowness is the point.

A spreadsheet is what plenty of packs use, and for a first year with fifteen cars
and a stopwatch it is a perfectly good answer.

## Side by side

| | **Trusty Track** | **GrandPrix RM** | **DerbyNet** | **Derby Magic** | **Derby Day!** |
| --- | --- | --- | --- | --- | --- |
| **Cost** | Free | $60 Lite, $80 Pro | Free | $65 | Free |
| **Licence** | Apache 2.0 | Proprietary | MIT | Proprietary | Proprietary |
| **Runs on** | macOS, Windows, Docker, Pi | Windows, macOS | Windows, macOS, Linux, Pi | Windows | Windows |
| **What you install** | One app | One app | A zip holding a bundled web server | One app | One app |
| **Other screens** | Any browser on the network | Single machine | Any browser on the network | Single machine | Single machine |
| **Timer models listed** | 8 | 6, plus custom in Pro | 8 | Their own | By hand or timer |
| **Race formats** | Perfect-N, championship, elimination, balanced, slowest | Several, more in Pro | Several | Several | Elimination only |
| **Racer limit** | None | None | None | None | 15 |
| **Racer and car photos** | Yes | Pro only | Yes | — | — |
| **Try before installing** | One shared demo | — | A private instance, a few hours | — | — |
| **Public since** | Jan 2026 | Version 26 | Jul 2015 | Long-established | Long-established |

A blank cell means their site does not say, not that the answer is no.

## When to pick something else

Trusty Track's repository is seven months old. DerbyNet's is eleven years old, and
GrandPrix Race Manager is on version twenty-six. Both have run into race-day
problems that have not come up here yet, and if your derby is next week and it is
your first, that history counts for more than any feature.

Five of the eight timer models listed here have never been connected to the actual
hardware. They were built from DerbyNet's written notes, and only the ones marked
*Tested* on the [front page](https://trusty-track.com/#timers) have been checked
against recordings of a real device. [Hardware Timer](hardware-timer.md) explains
what that means on the day, and how a bench test moves a timer across.

Support is a GitHub issue tracker read by one person who has a day job. Nobody
outside the project has reviewed any of this either, so everything above about
Trusty Track is the author's own account of it.

## When to pick this one

You install one application and open it. There is no server to start, no database
to create, and nothing to configure afterwards.

Every screen is a browser, so the check-in desk can work from a tablet while the
projector at the back is another tab, both reading the same event over the hall's
own wifi. The operator can change what any screen is showing without getting up.

It expects the day to go wrong. A racer turning up after the round has started, a
lane whose sensor dies mid-event, a car withdrawn between rounds, a time typed in
wrong and corrected later: each of those has a defined behaviour rather than a
workaround, and [Mid-race changes](reference/mid-race-changes.md) lists what
happens in each case.

Nothing leaves the building. No accounts, no cloud service, no internet needed on
race day, and children's names and photographs stay on your own machine.

The rules are also written down. When a parent asks why their child came fourth,
[Reference](reference/index.md) has the answer in full.

## Sources

- GrandPrix Race Manager — [product page](https://www.grandprix-software-central.com/gprm/)
  and [shop](https://grandprix-software-central.com/index.php/shopping/category/70-grandprix-race-manager)
- DerbyNet — [derbynet.org](https://derbynet.org/), the
  [source](https://github.com/jeffpiazza/derbynet), and the
  [playground](https://hosting.derbynet.org/playground.php)
- Derby Magic — [race management](https://derbymagic.com/race-management/) and
  [pricing](https://derbymagic.com/pricing-guide/)
- Derby Day! — [derbydaysoftware.com](http://www.derbydaysoftware.com/)

*Pinewood Derby is a registered trademark of the Boy Scouts of America. Awana
Grand Prix is a registered trademark of Awana Clubs International. Other names
belong to their owners, and Trusty Track is not affiliated with any of them.*
