# The race-day operator screen

Part of the Trusty Track agent guide; the index is in [`CLAUDE.md`](../../CLAUDE.md). Read this before touching `raceFlow.ts`, `heatSession`, `RaceExecution.tsx`, `RaceControl.tsx`, shortcuts or the chime.

---

### Race-day keys and the finish sound

`features/racing/shortcuts.ts` and `features/racing/chime.ts`, wired in `RaceExecution` ([#207](https://github.com/dknowles2/trusty-track/issues/207), [#208](https://github.com/dknowles2/trusty-track/issues/208)). Both are pure rules with the doing in the component, the same split as `raceFlow.ts`.

**Three keys, and each is printed on the button it mirrors.** Space advances, E opens the editor, Escape cancels the countdown. A screen somebody uses once a year cannot amortise a cheat sheet, so a fourth key is a cost rather than a feature.

**Space does not start a heat.** On a real timer the gate is released by hand, and on the fake one the control is a debugging panel rather than part of the flow — so there is no "start" for a key to mean.

**Nothing fires while typing, with a dialog open, or with a modifier held**, and `preventDefault` is called *only* once an action has been decided. Space scrolls a page and Escape closes things; taking either away from a keystroke we are going to ignore is worse than having no shortcut.

**The hooks sit above `RaceExecution`'s two early returns** — no heat, and a round whose field is undecided. A hook after them does not run on every render, which is what `react-hooks/rules-of-hooks` catches.

**The chime is an edge, not a state.** `RECORDED` persists for as long as the operator leaves the heat on screen and a payload arrives for every lane time and every check-in, so `shouldChime` compares the previous phase. A null previous phase is a page load, which is not a heat finishing.

**Off by default, remembered per device**, like the PIN: the operator's laptop wants it and a wall display does not. Switching it on plays it once — the only way to find out whether the machine is muted without waiting for a heat. It is two WebAudio oscillators rather than an asset, because these machines have no internet.

### What is on the track right now

`heatSession(trackId, heatId)` merges the heat row (schedule, and results once saved) with the `TimerManager`'s pending lane times, and reports a `phase` — `NO_HEAT`, `NOT_READY`, `WAITING`, `RUNNING`, `RECORDED`. The rule is `domain/heat_session.py`; the resolver loads the two sides and calls it.

Two things it settles, because they were getting it wrong in a render function:

- **A recorded heat ignores the timer.** Anything still pending belongs to a run that has already been superseded, and showing it would contradict the standings.
- **`pending` is a field.** A time from the timer is not in the database and an abort still loses it, so the screen must not present it as final.

`phase` is *not* the timer's state (`ARMED`, `FAULT`…), which is about the device and is still reported separately as `timerState`.

Also a subscription. It watches **two** channels — `timer_state:{track_id}` for lane times and arming, and `race_state:{race_id}` for a result being saved, which is what turns `RUNNING` into `RECORDED` and never comes from the timer. `pubsub.subscribe` takes several channels for this.

`RaceExecution.tsx` renders from it and merges nothing (issue #7). **`phase` is the answer to "what is this heat doing", not `timerState`** — a recorded heat whose timer has not caught up must not show as racing. Screens read `HeatSession` / `LiveLane` from `features/racing/types.ts`; the stored `heat.lanes` are what *edits and skips write against*, since those change the record rather than the live view.

Don't reintroduce a merge on the client; extend `domain/heat_session.py` instead.

**The current heat and On Deck show the same kind of picture** (#608). Both panels of `RaceExecution.tsx` render `RacerAvatar` — the racer's own portrait, falling back to initials — rather than the current heat showing faces while On Deck showed the car photo (falling back to a gold roundel carrying the car number). They sit side by side on one screen, and the audience display's own lane cards (`Observation.tsx`) were already faces throughout; the split was On Deck's alone. A face is what the person calling racers to the start line needs, and the car number stays as plain text beside the name for the wrangler staging by number — the car photo itself is one click away on the roster. The operator screen is not a public surface (see "Name display" in [`terminology-and-names.md`](terminology-and-names.md)), so this is unrelated to `shouldShowRacerPhoto`'s gating: both panels always show the portrait when one is on file.

### What the operator screen does between heats

Issue #13. `RaceExecution.tsx` used to encode the race-day flow as six `useEffect`s guarding each other with mirror state, two refs, a derived boolean and an `eslint-disable react-hooks/exhaustive-deps`. It is now one machine in `features/racing/raceFlow.ts`, with `useRaceFlow.ts` as the only wiring.

**`phase` is an input to this machine, not a state of it.** The issue originally proposed a client machine reading `IDLE → PREPARING → ARMED → RUNNING → RECORDED`, but that is the *heat's* state and the server has owned it since #7. What is left is genuinely local — a countdown to the next heat, and whether a round summary is up:

```
WATCHING ──recorded, times, a next heat, auto-advance on──> COUNTING_DOWN(n)
COUNTING_DOWN ──n reaches 0──> ADVANCE_TO_NEXT_HEAT, back to WATCHING
any ──a round's field is decided──> ROUND_SUMMARY ──dismissed──> WATCHING
```

The test for whether something belongs in `raceFlow.ts` rather than on the server: **it does not survive a refresh.**

**The screen stays on the heat it is showing; advancing is the toggle's job or the button's** (#130). `RaceControl` pins `selectedHeatId` to whatever the fallback landed on, adjusting it *during render* rather than in an effect — an effect would show the unpinned heat for a frame and then correct it, which is the flicker the `activeExecutionHeat` memo was written to avoid. It converges in one pass and is self-healing: a pinned heat that stops existing sends the memo back to the fallback, which then gets pinned.

Without that pin the fallback — "the first heat still to be run" — slid forward the moment a result landed, because recording a heat changes which heat that is. Three consequences, none of them obvious from reading the component:

- the recorded heat's **Edit** button went with it, leaving **Re-Run** — which *clears* the result — as the only route back to a mistyped time;
- **Next Heat** and **Cancel** were unreachable;
- and `raceFlow.ts` never observed the active heat as `RECORDED`, so `COUNTING_DOWN` was unreachable and **`autoAdvanceHeat` did nothing in either position** while the screen advanced regardless.

`raceFlow.test.ts` dispatches events directly and `RaceExecution.test.tsx` is handed a fixed heat, so neither could see it — this needs a real backend moving the data underneath, and it is pinned by two tests in `raceDay.spec.ts`.

`reduce` returns commands (`PREPARE_HEAT`, `ADVANCE_TO_NEXT_HEAT`) rather than performing them, which is what makes race-day behaviour assertable without rendering — `raceFlow.test.ts` dispatches event sequences and touches no DOM. Put a *rule* there and its *I/O* in `useRaceFlow.ts`; if you find yourself writing an `if` about the race in the hook or the component, it is in the wrong file.

Two things it settles that were previously accidents:

- **Cancelling a countdown is sticky, scoped to the heat.** Nothing the server can see changed when the operator clicked, so a machine that re-decided purely from the observation would start counting again on the next payload. Moving to another heat gets a countdown back.
- **A summary's presence and its id are separate fields.** `AdvancementStatus.roundId` is optional, so `hasRoundSummary` and `roundSummaryId` cannot be collapsed into one nullable number.

`roundCompletion.ts` is the matching piece for `RaceControl.tsx`: there is no event for "a round's field was just decided", so it is recovered by comparing one query result against the last. `seen === null` means "first look", where every decided round is history rather than news.

**`roundSummary` and `raceJustCompleted` reset when the thing they name stops being true, not only at their own two explicit call sites** ([#856](https://github.com/dknowles2/trusty-track/issues/856)). Re-running the *active* heat and dismissing via **Next Heat** each clear `roundSummary` directly, and the modal's own "×" (`flow.dismissSummary`) clears neither `roundSummary` nor `raceJustCompleted` at all — it only hides the modal, by design, so a dismissed summary does not spring back on the next payload (see "Cancelling is sticky" above). None of those three cover a *correction*: editing an earlier prelim result through Override (`handleUpdateResult`) resets a later championship round's field to placeholders (`.claude/rules/advancement-and-awards.md`), or clears the whole race's completeness, and that path never touched either flag. Confirmed reachable on a real backend, not merely theoretical: `raceDay.spec.ts`'s `a round summary can be raised again once its round is decided a second time` and `clearing a result un-completes a race whose summary was already shown` both provoke it end to end.

The fix is two lines, each adjusted **during render**, the same "adjust state while rendering" pattern `RaceControl` already uses to pin `selectedHeatId` and open the hand-pick picker — not inside an effect, which trips `react-hooks/set-state-in-effect` for exactly the reason given under "Edit race opens..." in [`frontend-screens.md`](frontend-screens.md): a bare `if (condition) setState()` in a `useEffect` fires on every render where the condition still holds. Both compare the *current* `race.rounds`/`race.heats` against the flag's own stored value and clear it once it is stale — they never *set* either flag (that stays the two completion-detecting effects' job), so dismissal remains sticky exactly as before.

**The `roundSummary`-is-never-cleared failure mode is subtler than a stale line-up on screen, and is why the regression test re-decides the round rather than just invalidating it once.** Even without this fix, `RaceControl`'s own completion-detecting effect *does* raise a fresh `roundSummary` object the next time the round is decided — it tracks `seenAdvancedRounds` independently and does not care what `roundSummary` currently holds. The actual break is one level down, in `raceFlow.ts`'s `haveSummarised`/`summarisedRoundId`: those only reset when `hasRoundSummary` (`!!roundSummary`) is observed to go *false*. If `roundSummary` never becomes falsy in between — because nothing cleared it — `hasRoundSummary` never dips, so a round that un-decides and is later re-decided is read by the guard as "the same summary I already showed" (same `roundSummaryId`) and the modal never reopens, even though `roundSummary` itself did get a fresh value. Fixing only "the content looks stale" and not "the flag genuinely returns to falsy" would leave this failure in place.

**Reproducing this on a real backend needs a live refetch of `race.rounds`, and `updateHeatResult` alone does not give you one.** `useRaceStateChanged` treats a `HEAT_RESULT` event carrying a `heat` payload as mergeable (#12) — the one heat's own fields update in the normalized cache, but nothing about the *round's* `advancementStatus` is in that payload, and no refetch fires. That is enough to keep `isRaceComplete` (a plain fold over `heat.lanes`) accurate live, which is why writing every heat through raw `updateHeatResult` calls is fine for provoking the `raceJustCompleted` half of this bug. It is not enough for `roundSummary`, which reads `race.rounds[].advancementStatus` — a field no per-heat merge ever touches. Two things do force the refetch that actually refreshes it: `handleUpdateResult`'s own explicit `reExecute({ requestPolicy: 'network-only' })` after a same-tab Edit/Override save, and the timer's own result path (`TimerManager._record_results` → `_publish_race_state(race_id)` with no `kind`, which defaults to `OTHER` and is never mergeable). The docs screenshot spec's `race-day.spec.ts` already leans on the second of these — see its own comment about writing results "behind the client's back" and reloading before reading the screen again. `raceDay.spec.ts`'s regression test for this issue does the same: every heat but the last is written raw, and the last is run through the fake timer on screen specifically so the round's own decided-or-not status is something this client actually observes.

**"Every heat that exists has run" is not "the race is over"** ([#874](https://github.com/dknowles2/trusty-track/issues/874)). `isRaceComplete` is exactly that plain fold, and a race built one round at a time from the **Add Round** dialog has no championship round at all the moment its sole preliminary finishes — the round wizard's own pre-created placeholder heats are the only reason the wizard-built races above never tripped this. Tightening the trigger — only announce completion once a round drawing its field from another round's standings (`advancementSource` set) exists — was tried and reverted: `raceDay.spec.ts`'s own `clearing a result un-completes a race` test races a **prelims-only** schedule (`createSchedule` with no championship argument) through the wizard and expects the summary to fire anyway, and that race produces the identical stored shape — one general round, fully raced, no advancement source — as one that is not done yet. There is no event, and no stored fact, for "the operator does not intend to add another round"; that is a plan in someone's head, not a database row, and the two cases cannot be told apart from what is stored. `hasTerminalRound` in `raceCompletion.ts` is the function that tried and failed at this as a gate — its docstring carries the fuller story.

**The fix is honesty, not suppression.** The modal still opens exactly when it always did (`isRaceComplete` unchanged), but `RaceControl` also computes `hasChampionshipRound` (`hasTerminalRound(race.rounds)`) and passes it down; `RaceExecution.tsx`'s summary modal reads it to choose between two framings. With a championship round already in the schedule, it is titled **"Race Complete!"** exactly as before. Without one, it is titled **"No More Heats Scheduled"**, the body copy says so rather than implying finality, and an **"Add a Championship Round"** link (to the Schedule tab) is offered ahead of — never instead of — the standings/awards/print links that always apply, since a prelims-only race really is done here and this modal cannot tell the two cases apart. `raceDay.spec.ts`'s regression test for #874 builds exactly the Add Round shape, checks the softened title and the extra link, then adds and races a championship round live and checks the modal reverts to the ordinary "Race Complete!" framing with the extra link gone.
