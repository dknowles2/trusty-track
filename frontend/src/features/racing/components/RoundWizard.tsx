import React, { useState } from 'react';
import { useAlert } from '../../../context/AlertContext';
import { errorText } from '../../../utils/errors';
import { useMutation } from 'urql';
import { CREATE_ROUND_WIZARD } from '../graphql/queries';
import { ESTIMATED_HEAT_DURATION_MIN } from '../../../utils/constants';
import { minutesEstimate } from '../../../utils/duration';
import Modal from '../../../components/ui/Modal';
import { useTerminology } from '../../../context/TerminologyContext';
import { HowItsRacedFields, type RaceStyle } from './HowItsRacedFields';
import { WhichCarsRaceFields } from './WhichCarsRaceFields';
import { PickFieldByHandCheckbox } from './PickFieldByHandCheckbox';

interface RoundWizardProps {
  isOpen: boolean;
  onClose: () => void;
  raceId: number;
  racerCount: number;
  totalRacerCount?: number;
  racingGroupCount: number;
  laneCount: number;
  championshipTrophies: number;
  /** This race's learned pace (#591), so a round added mid-event previews
   * against how this event is actually running rather than the static
   * baseline. Defaults to the baseline for a race with no heats recorded
   * yet — the ordinary case for the very first round. */
  minutesPerHeat?: number;
  /**
   * Called once the mutation lands. `handPickRoundId` names a championship
   * round created with "I'll choose who races myself" checked (#711, #943)
   * — the same hand-off `RoundConfigModal`'s own submit makes, so the
   * caller can open the same `PickFieldModal` it already owns. Null when
   * nothing in this batch asked for it. Only the first such round is
   * reported: the picker shows one round at a time, the same limit a
   * single Add Round submission already has (it can only ever create one
   * championship round per click), so a wizard batch asking for the picker
   * on more than one round opens it for whichever comes first and leaves
   * the rest for the round's own "Pick by hand" button on the schedule.
   */
  onCreated: (handPickRoundId: number | null) => void | Promise<void>;
}

interface GeneralConfig {
  type: 'ALL' | 'EACH_GROUP';
  runsPerLane: number;
  /** "How it's raced" (#943) — the same choice `RoundConfigModal` offers a
   * general round. A championship round is always PPC (CLAUDE.md's
   * "Ladderless elimination": an elimination round cannot also be a
   * championship round), so this lives only on the general round's own
   * config, never per championship round below. */
  raceStyle: RaceStyle;
  eliminationLosses: number;
  balancedPhases: number;
}

interface ChampionshipConfig {
  id: string;
  name: string;
  source: 'ALL' | 'EACH_GROUP' | 'PREVIOUS';
  numTopRacers: number;
  runsPerLane: number;
  /** "Which cars race" — the Slowest Race bracket (#943). */
  fromBottom: boolean;
  /** "I'll choose who races myself" (#711, #943). */
  pickFieldByHand: boolean;
}

/** The general round's name a fresh wizard session would produce, absent an
 * operator's own choice — there is no Name field for it in step 1, so this
 * mirrors what `create_round_wizard` itself now names it (`crud.
 * default_general_round_name` for PPC, "Elimination Round"/"Balanced Round"
 * otherwise) closely enough for the step 3 preview. */
function generalRoundName(style: RaceStyle, type: 'ALL' | 'EACH_GROUP', org: string, group: string): string {
  if (style === 'ELIMINATION') return 'Elimination Round';
  if (style === 'BALANCED') return 'Balanced Round';
  return `${type === 'ALL' ? `All ${org}` : group} Round`;
}

/** The three default names a championship round card has ever carried on
 * its own, before an operator typed something else — used the same way
 * `RoundConfigModal.chooseDirection` decides whether flipping the direction
 * may still rename the round. */
function isDefaultChampionshipName(name: string): boolean {
  return name === 'Grand Finals' || name === 'New Championship Round' || name === 'Slowest Race';
}

function defaultChampionshipName(idx: number, fromBottom: boolean): string {
  if (fromBottom) return 'Slowest Race';
  return idx === 0 ? 'Grand Finals' : 'New Championship Round';
}

export const RoundWizard: React.FC<RoundWizardProps> = ({
  isOpen,
  onClose,
  raceId,
  racerCount,
  totalRacerCount,
  racingGroupCount,
  laneCount,
  championshipTrophies,
  minutesPerHeat = ESTIMATED_HEAT_DURATION_MIN,
  onCreated,
}) => {
  const { group, groupLower, groupsLower, org, orgLower, vehicleLower, vehiclesLower } = useTerminology();
  const [step, setStep] = useState(1);
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    type: 'ALL',
    runsPerLane: 1,
    raceStyle: 'PPC',
    eliminationLosses: 3,
    balancedPhases: Math.max(1, laneCount),
  });
  // Opening the wizard starts it over, which is what mounting already does —
  // the caller keys this on `isOpen`, so every open is a fresh component. The
  // effect this replaces reset four pieces of state and had to list
  // `laneCount` and `championshipTrophies` as dependencies, so a lane count
  // changing underneath would silently throw away a half-filled wizard.
  const [championshipRounds, setChampionshipRounds] = useState<ChampionshipConfig[]>([{
    id: 'champ-1',
    name: 'Grand Finals',
    source: 'ALL',
    // `Race.championship_trophies` is how many cars advance to the final — a
    // scheduling input the operator has already set on the race's own
    // settings (#775). This used to default to `Math.max(championshipTrophies,
    // laneCount)` "to fill a heat", which silently disagreed with that
    // setting on the very first screen that offers a number for it whenever
    // the track had more lanes than trophies. `RoundConfigModal` — the same
    // control reached later, from the add-round dialog — already defaults to
    // `championshipTrophies` alone; this now matches it.
    numTopRacers: championshipTrophies,
    runsPerLane: 1,
    fromBottom: false,
    pickFieldByHand: false,
  }]);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlert();

  // GraphQL Mutation
  const [, createRoundWizardMutation] = useMutation(CREATE_ROUND_WIZARD);

  /** Heats a PPC round of this many racers produces, per run.
   *
   * One heat per racer, not per lane-full of them — `generate_ppc` seeds lane 1
   * with every racer, and that is what fixes the count. Dividing by the lane
   * count is the arithmetic for a scheduler that packs racers into heats, which
   * PPC deliberately is not: every racer runs in every lane, so a 19-racer
   * round on a 3-lane track is 19 heats, not 7 (#140).
   *
   * This preview is where an operator decides whether their evening fits, and
   * it feeds the run-time estimate too, so being out by a factor of the lane
   * count is out by a factor of the lane count on both numbers.
   *
   * Only PPC's heat count can be known up front. Balanced and elimination
   * heats grow from results as the round is raced (`reference/round-styles.
   * md`'s "Schedule: Grows as results come in") — a championship round is
   * always PPC (see `ChampionshipConfig`'s own comment), so this only ever
   * applies to the general round when it is not `PPC`.
   */
  const heatsFor = (racers: number, runs: number) => racers * runs;

  const getRaceBreakdown = () => {
    const rounds: { name: string; heats: number | null; duration: number }[] = [];

    // General Round
    const generalHeats =
      generalConfig.raceStyle === 'PPC' ? heatsFor(racerCount, generalConfig.runsPerLane) : null;
    rounds.push({
      name: generalRoundName(generalConfig.raceStyle, generalConfig.type, org, group),
      heats: generalHeats,
      duration: generalHeats == null ? 0 : Math.ceil(generalHeats * minutesPerHeat)
    });

    // Championship Rounds — always PPC, so their heat count is always known.
    for (const round of championshipRounds) {
      let participatingRacers;
      if (round.source === 'ALL' || round.source === 'PREVIOUS') {
        participatingRacers = round.numTopRacers;
      } else {
        participatingRacers = round.numTopRacers * racingGroupCount;
      }
      const roundHeats = heatsFor(participatingRacers, round.runsPerLane);
      rounds.push({
        name: round.name,
        heats: roundHeats,
        duration: Math.ceil(roundHeats * minutesPerHeat)
      });
    }

    const totalHeats = rounds.reduce((sum, r) => sum + (r.heats ?? 0), 0);
    const totalDuration = rounds.reduce((sum, r) => sum + r.duration, 0);
    const hasUnknownHeats = rounds.some((r) => r.heats == null);

    return { rounds, totalHeats, totalDuration, hasUnknownHeats };
  };

  const { rounds: breakdown, totalHeats, totalDuration, hasUnknownHeats } = getRaceBreakdown();

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  /** Same rule as `RoundConfigModal.chooseStyle` — switching styles renames
   * the round for its new kind, but only while the name is still one the
   * wizard itself put there. Step 1 has no Name field of its own (the
   * general round is always named on the server), so this only decides what
   * the step 3 preview calls it. */
  const chooseGeneralStyle = (style: RaceStyle) => {
    setGeneralConfig((prev) => ({ ...prev, raceStyle: style }));
  };

  const handleAddChampionshipRound = () => {
    setChampionshipRounds(prev => [
      ...prev,
      {
        id: `champ-${Date.now()}`,
        name: 'New Championship Round',
        source: prev.length === 0 ? 'ALL' : 'PREVIOUS',
        numTopRacers: laneCount,
        runsPerLane: 1,
        fromBottom: false,
        pickFieldByHand: false,
      }
    ]);
  };

  const handleRemoveChampionshipRound = (id: string) => {
    setChampionshipRounds(prev => prev.filter(r => r.id !== id));
  };

  const updateChampionshipRound = (id: string, updates: Partial<ChampionshipConfig>) => {
    const nextRounds = championshipRounds.map(r => {
        if (r.id === id) return { ...r, ...updates };
        return r;
    });
    setChampionshipRounds(nextRounds);
  };

  /** Flip a round's direction, and swap its default name along with it —
   * but only if the operator has not typed their own. Mirrors
   * `RoundConfigModal.chooseDirection`. */
  const chooseChampionshipDirection = (id: string, nextFromBottom: boolean) => {
    setChampionshipRounds(prev => prev.map((r, idx) => {
      if (r.id !== id) return r;
      const name = isDefaultChampionshipName(r.name)
        ? defaultChampionshipName(idx, nextFromBottom)
        : r.name;
      return { ...r, fromBottom: nextFromBottom, name };
    }));
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const isElimination = generalConfig.raceStyle === 'ELIMINATION';
      const isBalanced = generalConfig.raceStyle === 'BALANCED';
      const config = {
        generalRound: {
          // "By {group}" is offered only alongside "Everyone races in every
          // lane" — `HowItsRacedFields`'s sibling Format picker is hidden for
          // the other two styles, so nothing on screen can set `type` to
          // anything but "ALL" while a style is chosen; sent explicitly all
          // the same, matching the backend's own belt-and-braces rule.
          type: generalConfig.raceStyle === 'PPC' ? generalConfig.type : 'ALL',
          runsPerLane: generalConfig.runsPerLane,
          schedulingStrategy: generalConfig.raceStyle,
          eliminationLosses: isElimination ? generalConfig.eliminationLosses : undefined,
          balancedPhases: isBalanced ? generalConfig.balancedPhases : undefined,
        },
        championshipRounds: championshipRounds.map((r) => ({
          name: r.name,
          source: r.source,
          numTopRacers: r.numTopRacers,
          runsPerLane: r.runsPerLane,
          advancementFromBottom: r.fromBottom,
        })),
      };

      const result = await createRoundWizardMutation({ raceId, config });

      if (result.error) {
          throw result.error;
      }

      // "I'll choose who races myself" (#711) — the round is created and
      // scheduled the usual way; this hands off to the picker once it has a
      // real round to hand off to, the same way `RaceControl.handleAddRound`
      // does for the Add Round dialog. Championship rounds are always the
      // tail of the returned list, in the order they were submitted, however
      // many general rounds (`EACH_GROUP` can create several) came first.
      const created = result.data?.createRoundWizard ?? [];
      const champCreated = created.slice(created.length - championshipRounds.length);
      const handPickIndex = championshipRounds.findIndex((r) => r.pickFieldByHand);
      const handPickRoundId =
        handPickIndex >= 0 ? champCreated[handPickIndex]?.id ?? null : null;

      await onCreated(handPickRoundId);
      onClose();
    } catch (error: unknown) {
      console.error('Failed to create rounds via wizard:', error);
      showAlert(errorText(error, 'The rounds could not be created.'), "Error");
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--wizard-text-color)',
    marginBottom: '0.5rem'
  };

  const stepIndicatorStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    color: active ? 'var(--accent-blue-color)' : 'var(--wizard-icon-muted-color)',
    fontWeight: active ? 500 : 400,
    fontSize: '0.875rem'
  });

  const stepNumberStyle = (active: boolean): React.CSSProperties => ({
    width: '1.5rem',
    height: '1.5rem',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    marginRight: '0.5rem',
    borderColor: active ? 'var(--accent-blue-color)' : 'var(--wizard-border-muted-color)',
    backgroundColor: active ? 'var(--accent-blue-bg-color)' : 'transparent',
    boxSizing: 'border-box'
  });

  const configCardStyle = (active: boolean): React.CSSProperties => ({
    border: '1px solid',
    borderRadius: '0.5rem',
    padding: '1rem',
    cursor: 'pointer',
    transition: 'background-color 0.2s, border-color 0.2s',
    borderColor: active ? 'var(--selection-accent-color)' : 'var(--wizard-border-color)',
    backgroundColor: active ? 'var(--accent-blue-bg-color)' : 'transparent',
    boxSizing: 'border-box'
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Race Schedule Wizard" maxWidth="650px">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header Description */}
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--wizard-text-subtle-color)', fontSize: '0.875rem', marginTop: '-1rem', marginBottom: '1.5rem' }}>
            Quickly generate a complete race schedule based on your settings.
          </p>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={stepIndicatorStyle(step >= 1)}>
              <span style={stepNumberStyle(step >= 1)}>1</span>
              Qualifying Rounds
            </div>
            <div style={{ width: '2rem', height: '1px', backgroundColor: 'var(--wizard-border-muted-color)', margin: '0 0.5rem' }}></div>
            <div style={stepIndicatorStyle(step >= 2)}>
              <span style={stepNumberStyle(step >= 2)}>2</span>
              Championships
            </div>
            <div style={{ width: '2rem', height: '1px', backgroundColor: 'var(--wizard-border-muted-color)', margin: '0 0.5rem' }}></div>
            <div style={stepIndicatorStyle(step >= 3)}>
              <span style={stepNumberStyle(step >= 3)}>3</span>
              Review
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', marginBottom: '1.5rem' }}>
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {racerCount < 2 && (
                <div
                  style={{
                    padding: '0.75rem',
                    backgroundColor: 'var(--caution-bg-color)',
                    border: '1px solid var(--caution-border-color)',
                    borderRadius: '0.5rem',
                    color: 'var(--caution-text-color)',
                    fontSize: '0.875rem',
                  }}
                >
                  At least 2 checked-in {vehiclesLower} are required to generate heats.
                </div>
              )}

              {totalRacerCount !== undefined && totalRacerCount > racerCount && (
                <div
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--wizard-text-muted-color)',
                  }}
                >
                  {racerCount} of {totalRacerCount} {vehiclesLower} checked in. Previews and heats only include checked-in {vehiclesLower}.
                </div>
              )}

              {/* How it's raced (#943) — the same choice, and the same
                  component, `RoundConfigModal`'s General tab offers. */}
              <HowItsRacedFields
                raceStyle={generalConfig.raceStyle}
                onChooseStyle={chooseGeneralStyle}
                laneCount={laneCount}
                balancedPhases={generalConfig.balancedPhases}
                onBalancedPhasesChange={(value) => setGeneralConfig({ ...generalConfig, balancedPhases: value })}
                eliminationLosses={generalConfig.eliminationLosses}
                onEliminationLossesChange={(value) => setGeneralConfig({ ...generalConfig, eliminationLosses: value })}
                labelStyle={labelStyle}
                mutedColor="var(--wizard-text-muted-color)"
              />

              {/* "By {group}" only makes sense alongside "Everyone races in
                  every lane" — an elimination or balanced round is always
                  the whole {org}, the same rule `RoundConfigModal` follows
                  by hiding its own Format picker for the other two styles. */}
              {generalConfig.raceStyle === 'PPC' && (
                <>
                  <div>
                    <label style={labelStyle}>Qualifying Round Type</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div
                        style={configCardStyle(generalConfig.type === 'ALL')}
                        onClick={() => setGeneralConfig({ ...generalConfig, type: 'ALL' })}
                      >
                        <div style={{ fontWeight: 500 }}>All {org}</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--wizard-text-muted-color)', marginTop: '0.25rem' }}>Every racer races against everyone else in the {orgLower}.</div>
                      </div>
                      <div
                        style={configCardStyle(generalConfig.type === 'EACH_GROUP')}
                        onClick={() => setGeneralConfig({ ...generalConfig, type: 'EACH_GROUP' })}
                      >
                        <div style={{ fontWeight: 500 }}>By {group}</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--wizard-text-muted-color)', marginTop: '0.25rem' }}>Racers only race against others in their own {groupLower} initially.</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Runs per lane</label>
                    <input
                      type="number"
                      min="1"
                      max="4"
                      className="form-control"
                      value={generalConfig.runsPerLane}
                      onChange={(e) => setGeneralConfig({ ...generalConfig, runsPerLane: parseInt(e.target.value) || 1 })}
                    />
                    <p style={{ fontSize: '0.75rem', color: 'var(--wizard-text-muted-color)', marginTop: '0.25rem' }}>How many times does each racer run in each lane? (Standard is 1)</p>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--wizard-heading-color)', margin: 0 }}>Championship Rounds</h3>
                <button onClick={handleAddChampionshipRound} style={{ background: 'none', color: 'var(--accent-blue-color)', fontSize: '0.875rem', padding: 0 }}>+ Add Round</button>
              </div>

              {championshipRounds.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--wizard-text-muted-color)', backgroundColor: 'var(--wizard-surface-alt-color)', borderRadius: '0.5rem', border: '1px dashed var(--wizard-border-muted-color)' }}>
                  No championship rounds configured.
                </div>
              )}

              {championshipRounds.map((round, idx) => (
                <div key={round.id} style={{ position: 'relative', border: '1px solid var(--wizard-border-color)', borderRadius: '0.5rem', padding: '1rem', backgroundColor: 'var(--wizard-surface-alt-color)' }}>
                  <button
                    onClick={() => handleRemoveChampionshipRound(round.id)}
                    style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'none', color: 'var(--wizard-icon-muted-color)', fontSize: '1.25rem', padding: '0 4px' }}
                    title="Remove Round"
                    data-testid="remove-round-btn"
                  >
                    &times;
                  </button>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Round Name</label>
                      <input
                        type="text"
                        className="form-control"
                        style={{ fontSize: '0.875rem' }}
                        value={round.name}
                        onChange={(e) => updateChampionshipRound(round.id, { name: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Which cars race (#943) — the same choice, and the same
                      component, `RoundConfigModal`'s Championship tab offers. */}
                  <div style={{ marginTop: '1rem' }}>
                    <WhichCarsRaceFields
                      fromBottom={round.fromBottom}
                      onChooseDirection={(value) => chooseChampionshipDirection(round.id, value)}
                      labelStyle={{ ...labelStyle, fontSize: '0.75rem' }}
                      mutedColor="var(--wizard-text-muted-color)"
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>
                        {round.fromBottom ? `Slowest ${vehiclesLower} from` : 'Top performers from'}
                      </label>
                      {idx === 0 ? (
                        <select
                          className="form-control"
                          style={{ fontSize: '0.875rem' }}
                          value={round.source}
                          onChange={(e) => updateChampionshipRound(round.id, { source: e.target.value as 'ALL' | 'EACH_GROUP' })}
                        >
                          <option value="ALL">Overall</option>
                          <option value="EACH_GROUP">Each {group}</option>
                        </select>
                      ) : (
                        <div
                          className="form-control"
                          style={{ fontSize: '0.875rem', backgroundColor: 'var(--wizard-chip-bg-color)', color: 'var(--wizard-text-muted-color)', display: 'flex', alignItems: 'center' }}
                        >
                          Previous championship round
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Number to pick</label>
                      <input
                        type="number"
                        min={round.fromBottom ? 1 : championshipTrophies}
                        className="form-control"
                        style={{ fontSize: '0.875rem' }}
                        value={round.numTopRacers}
                        onChange={(e) =>
                          updateChampionshipRound(round.id, {
                            numTopRacers: Math.max(
                              round.fromBottom ? 1 : championshipTrophies,
                              parseInt(e.target.value) || 1
                            )
                          })
                        }
                      />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: '0.75rem' }}>Runs per lane</label>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        style={{ fontSize: '0.875rem' }}
                        value={round.runsPerLane}
                        onChange={(e) => updateChampionshipRound(round.id, { runsPerLane: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>
                  {/* The trophy minimum is about handing out championship
                      trophies, which a slowest race does not do. */}
                  {!round.fromBottom && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--wizard-text-muted-color)', fontStyle: 'italic', marginTop: '0.5rem' }}>
                      Minimum pick count ({championshipTrophies}) enforced by trophy config.
                    </div>
                  )}

                  {/* I'll choose who races myself (#711, #943) — the same
                      checkbox `RoundConfigModal`'s Championship tab offers. */}
                  <div style={{ marginTop: '1rem' }}>
                    <PickFieldByHandCheckbox
                      checked={round.pickFieldByHand}
                      onChange={(value) => updateChampionshipRound(round.id, { pickFieldByHand: value })}
                      mutedColor="var(--wizard-text-muted-color)"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ backgroundColor: 'var(--accent-blue-bg-color)', padding: '1rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem', marginRight: '0.75rem' }}>⏱️</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--accent-blue-emphasis-color)' }}>Estimated Grand Total: {minutesEstimate(totalDuration)}</div>
                  <div style={{ color: 'var(--accent-blue-strong-color)', fontSize: '0.875rem' }}>Total Heats: {totalHeats}</div>
                  {hasUnknownHeats && (
                    <div style={{ color: 'var(--accent-blue-strong-color)', fontSize: '0.75rem', marginTop: '0.25rem', fontStyle: 'italic' }}>
                      Elimination and balanced rounds grow as results come in, so their heats aren&apos;t counted above.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid var(--wizard-border-color)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                {breakdown.map((roundInfo, idx) => (
                  <div key={idx} style={{
                    padding: '1rem',
                    borderBottom: idx === breakdown.length - 1 ? 'none' : '1px solid var(--wizard-border-color)',
                    backgroundColor: idx % 2 === 0 ? 'var(--surface-color)' : 'var(--wizard-surface-alt-color)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h4 style={{ fontWeight: 'bold', color: 'var(--wizard-heading-color)', margin: 0 }}>{idx + 1}. {roundInfo.name}</h4>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: 'var(--wizard-heading-color)', fontSize: '0.875rem' }}>
                          {roundInfo.heats == null ? 'Varies' : minutesEstimate(roundInfo.duration)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--wizard-text-muted-color)' }}>
                          {roundInfo.heats == null ? 'grows as results come in' : `${roundInfo.heats} ${roundInfo.heats === 1 ? 'heat' : 'heats'}`}
                        </div>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--wizard-text-subtle-color)', margin: '0.25rem 0 0 0' }}>
                      {idx === 0 ? (
                        generalConfig.raceStyle === 'ELIMINATION' ? "Racers are eliminated after too many losses; the last one left wins."
                        : generalConfig.raceStyle === 'BALANCED' ? 'Heats are matched by how well each racer has done so far.'
                        : generalConfig.type === 'ALL' ? 'All racers compete against each other.' : `Racers compete within their ${groupsLower}.`
                      ) : (
                        `${championshipRounds[idx-1].fromBottom ? 'The slowest' : 'Advances the top'} ${championshipRounds[idx-1].numTopRacers} racers${
                          championshipRounds[idx-1].source === 'EACH_GROUP' ? ` from each ${groupLower}` :
                          championshipRounds[idx-1].source === 'PREVIOUS' ? ` from ${championshipRounds[idx-2]?.name || 'previous round'}` :
                          ' overall'
                        }.`
                      )}
                      {' '}{(idx === 0 ? generalConfig.runsPerLane : championshipRounds[idx-1].runsPerLane) > 1 && `(${(idx === 0 ? generalConfig.runsPerLane : championshipRounds[idx-1].runsPerLane)} runs per lane)`}
                    </p>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '0.875rem', color: 'var(--wizard-text-muted-color)', fontStyle: 'italic' }}>
                * Previews are based on {racerCount} checked-in {racerCount === 1 ? vehicleLower : vehiclesLower}
                {totalRacerCount !== undefined && totalRacerCount > racerCount
                  ? ` (${totalRacerCount - racerCount} not checked in)`
                  : ''}
                . Only checked-in {vehiclesLower} are put into heats. You can still modify the schedule later, but the wizard assumes a clean slate.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--wizard-border-color)', paddingTop: '1.5rem' }}>
          {step > 1 ? (
            <button onClick={handleBack} className="secondary-btn" disabled={loading}>
              Back
            </button>
          ) : (
            <button onClick={onClose} className="secondary-btn" disabled={loading}>
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button onClick={handleNext} className="primary-btn">
              Next
            </button>
          ) : (
            <button
              onClick={handleCreate}
              className="primary-btn"
              disabled={loading || racerCount < 2}
            >
              {loading ? 'Generating schedule...' : 'Generate schedule'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
