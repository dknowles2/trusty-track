/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import * as Types from './schema';

export type AwardInput = {
  denId?: number | null | undefined;
  kind?: string;
  name: string;
  place?: number | null | undefined;
  racerId?: number | null | undefined;
  sortOrder?: number | null | undefined;
  source?: string | null | undefined;
};

export type DenInput = {
  carNumberRangeEnd?: number | null | undefined;
  carNumberRangeStart?: number | null | undefined;
  color?: string;
  name: string;
  rank?: string | null | undefined;
};

export type DisplayView =
  | 'AWARDS'
  | 'CYCLE'
  | 'PROJECTOR'
  | 'SLIDESHOW'
  | 'STANDINGS'
  | 'TIMING';

export type HeatLaneInput = {
  lane: number;
  place?: number | null | undefined;
  placeholderSlot?: number | null | undefined;
  racerId?: number | null | undefined;
  skipped?: boolean;
  time?: number | null | undefined;
};

export type HeatPhase =
  | 'NOT_READY'
  | 'NO_HEAT'
  | 'RECORDED'
  | 'RUNNING'
  | 'WAITING';

export type HeatReorderItemInput = {
  heatId: number;
  newHeatNumber: number;
};

export type PhotoAssignmentInput = {
  photoType: string;
  racerId: number;
  url: string;
};

export type PopulateTestDataInput = {
  addCarPhotos?: boolean;
  addRacerPhotos?: boolean;
  assignDens?: boolean;
  checkIn?: boolean;
  count?: number;
};

export type RaceInput = {
  carNumberingStrategy?: string;
  championshipTrophies?: number;
  dateTime?: string | null | undefined;
  globalStartNumber?: number;
  groupId?: number;
  location?: string | null | undefined;
  name: string;
  scoringStrategy?: string;
  trackId: number;
  weightLimitOz?: number | null | undefined;
};

export type RaceUpdateInput = {
  autoAdvanceHeat?: boolean | null | undefined;
  carNumberingStrategy?: string | null | undefined;
  championshipTrophies?: number | null | undefined;
  clearWeightLimit?: boolean;
  dateTime?: string | null | undefined;
  globalStartNumber?: number | null | undefined;
  location?: string | null | undefined;
  name?: string | null | undefined;
  scoringStrategy?: string | null | undefined;
  trackId?: number | null | undefined;
  weightLimitOz?: number | null | undefined;
};

export type RacerInput = {
  carImageUrl?: string | null | undefined;
  carName?: string | null | undefined;
  carNumber?: number | null | undefined;
  carPassedInspection?: boolean;
  carWeight?: number | null | undefined;
  denId?: number | null | undefined;
  firstName: string;
  lastName: string;
  raceId?: number | null | undefined;
  racerImageUrl?: string | null | undefined;
};

export type RoundCreateInput = {
  advancementFromBottom?: boolean;
  advancementNumRacers?: number | null | undefined;
  advancementSource?: string | null | undefined;
  balancedPhases?: number | null | undefined;
  eliminationLosses?: number | null | undefined;
  generalType?: string;
  name?: string | null | undefined;
  runsPerLane?: number;
  schedulingStrategy?: string;
};

export type WizardChampionshipRoundInput = {
  name?: string;
  numTopRacers?: number;
  runsPerLane?: number;
  source?: string;
};

export type WizardConfigurationInput = {
  championshipRounds: Array<WizardChampionshipRoundInput>;
  generalRound: WizardGeneralRoundInput;
};

export type WizardGeneralRoundInput = {
  runsPerLane?: number;
  type: string;
};

export type CacheTestGetRacesQueryVariables = Exact<{ [key: string]: never; }>;


export type CacheTestGetRacesQuery = { races: Array<{ id: number, name: string }> };

export type CacheTestCreateRaceMutationVariables = Exact<{ [key: string]: never; }>;


export type CacheTestCreateRaceMutation = { createRace: { id: number } };

export type GetInitialConfigQueryVariables = Exact<{ [key: string]: never; }>;


export type GetInitialConfigQuery = { initialConfig: { initialized: boolean, version: string } };

export type CreateInitialConfigMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateInitialConfigMutation = { createInitialConfig: { initialized: boolean } };

export type UpdateInitialConfigMutationVariables = Exact<{ [key: string]: never; }>;


export type UpdateInitialConfigMutation = { updateInitialConfig: { initialized: boolean } };

export type RaceAwardsQueryVariables = Exact<{
  raceId: number;
}>;


export type RaceAwardsQuery = { race: { id: number, name: string, awards: Array<{ id: number, name: string, kind: string, sortOrder: number, source: string | null, place: number | null, denId: number | null, den: { id: number, name: string } | null, recipient: { id: number, firstName: string, lastName: string, carNumber: number | null, racerImageUrl: string | null } | null }>, rounds: Array<{ id: number, name: string | null, roundNumber: number }>, dens: Array<{ id: number, name: string, color: string }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null }> } | null };

export type CreateAwardMutationVariables = Exact<{
  raceId: number;
  award: Types.AwardInput;
}>;


export type CreateAwardMutation = { createAward: { id: number } };

export type UpdateAwardMutationVariables = Exact<{
  id: number;
  award: Types.AwardInput;
}>;


export type UpdateAwardMutation = { updateAward: { id: number } | null };

export type DeleteAwardMutationVariables = Exact<{
  id: number;
}>;


export type DeleteAwardMutation = { deleteAward: boolean };

export type ReorderAwardsMutationVariables = Exact<{
  raceId: number;
  awardIds: Array<number> | number;
}>;


export type ReorderAwardsMutation = { reorderAwards: Array<{ id: number, sortOrder: number }> };

export type GetTracksQueryVariables = Exact<{ [key: string]: never; }>;


export type GetTracksQuery = { tracks: Array<{ id: number, name: string }> };

export type GetRacesNavQueryVariables = Exact<{ [key: string]: never; }>;


export type GetRacesNavQuery = { races: Array<{ id: number, name: string }> };

export type GetRaceDetailsQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceDetailsQuery = { race: { id: number, name: string, dateTime: string | null, location: string | null, trackId: number | null, scoringStrategy: string, carNumberingStrategy: string, globalStartNumber: number, championshipTrophies: number, weightLimitOz: number | null, registeredCount: number, checkedInCount: number, scheduledRacerIds: Array<number>, dens: Array<{ id: number, name: string, color: string, rank: string | null, carNumberRangeStart: number | null, carNumberRangeEnd: number | null }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, denId: number | null, carName: string | null, carPassedInspection: boolean, carWeight: number | null, racerImageUrl: string | null, carImageUrl: string | null }>, leaderboard: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, denName: string, score: number, heatsCompleted: number, racerImageUrl: string | null, rank: number }>, rounds: Array<{ id: number }> } | null, tracks: Array<{ id: number, name: string, laneCount: number }> };

export type GetRaceDensQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceDensQuery = { race: { id: number, dens: Array<{ id: number, name: string, color: string, rank: string | null, carNumberRangeStart: number | null, carNumberRangeEnd: number | null }> } | null };

export type UpdateRaceMutationVariables = Exact<{
  id: number;
  race: Types.RaceUpdateInput;
}>;


export type UpdateRaceMutation = { updateRace: { id: number, name: string, dateTime: string | null, location: string | null, trackId: number | null, scoringStrategy: string, carNumberingStrategy: string, globalStartNumber: number, championshipTrophies: number, weightLimitOz: number | null } | null };

export type DeleteRaceMutationVariables = Exact<{
  id: number;
}>;


export type DeleteRaceMutation = { deleteRace: boolean };

export type CreateRacerMutationVariables = Exact<{
  racer: Types.RacerInput;
}>;


export type CreateRacerMutation = { createRacer: { id: number } };

export type UpdateRacerMutationVariables = Exact<{
  id: number;
  racer: Types.RacerInput;
}>;


export type UpdateRacerMutation = { updateRacer: { id: number } | null };

export type DeleteRacerMutationVariables = Exact<{
  id: number;
}>;


export type DeleteRacerMutation = { deleteRacer: boolean };

export type CheckInRacerMutationVariables = Exact<{
  id: number;
  passedInspection: boolean;
  weight: number;
  racerImageUrl?: string | null | undefined;
  carImageUrl?: string | null | undefined;
}>;


export type CheckInRacerMutation = { checkInRacer: { id: number, carPassedInspection: boolean, carWeight: number | null } | null };

export type ImportRacersMutationVariables = Exact<{
  raceId: number;
  csvData: string;
}>;


export type ImportRacersMutation = { importRacers: number };

export type CreateDenMutationVariables = Exact<{
  raceId: number;
  den: Types.DenInput;
}>;


export type CreateDenMutation = { createDen: { id: number, name: string } };

export type UpdateDenMutationVariables = Exact<{
  id: number;
  den: Types.DenInput;
}>;


export type UpdateDenMutation = { updateDen: { id: number, name: string } | null };

export type DeleteDenMutationVariables = Exact<{
  id: number;
}>;


export type DeleteDenMutation = { deleteDen: boolean };

export type BulkAutoNumberMutationVariables = Exact<{
  racerIds: Array<number> | number;
}>;


export type BulkAutoNumberMutation = { bulkAutoNumber: number };

export type BulkClearNumbersMutationVariables = Exact<{
  racerIds: Array<number> | number;
}>;


export type BulkClearNumbersMutation = { bulkClearNumbers: boolean };

export type BulkCheckInMutationVariables = Exact<{
  racerIds: Array<number> | number;
  passedInspection: boolean;
}>;


export type BulkCheckInMutation = { bulkCheckIn: boolean };

export type BulkMoveToDenMutationVariables = Exact<{
  racerIds: Array<number> | number;
  denId?: number | null | undefined;
}>;


export type BulkMoveToDenMutation = { bulkMoveToDen: boolean };

export type BulkDeleteRacersMutationVariables = Exact<{
  racerIds: Array<number> | number;
}>;


export type BulkDeleteRacersMutation = { bulkDeleteRacers: boolean };

export type CreateRaceMutationVariables = Exact<{
  race: Types.RaceInput;
}>;


export type CreateRaceMutation = { createRace: { id: number } };

export type PopulateRaceMutationVariables = Exact<{
  raceId: number;
  config: Types.PopulateTestDataInput;
}>;


export type PopulateRaceMutation = { populateRace: string };

export type UploadImageMutationVariables = Exact<{
  dataUrl: string;
}>;


export type UploadImageMutation = { uploadImage: string };

export type BulkAssignPhotosMutationVariables = Exact<{
  assignments: Array<Types.PhotoAssignmentInput> | Types.PhotoAssignmentInput;
}>;


export type BulkAssignPhotosMutation = { bulkAssignPhotos: number };

export type CreatePracticeRaceMutationVariables = Exact<{ [key: string]: never; }>;


export type CreatePracticeRaceMutation = { createPracticeRace: { id: number, name: string } };

export type GetRacesQueryVariables = Exact<{ [key: string]: never; }>;


export type GetRacesQuery = { races: Array<{ id: number, name: string, dateTime: string | null, location: string | null, registeredCount: number, checkedInCount: number }> };

export type LeaderboardSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type LeaderboardSubscriptionSubscription = { leaderboard: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, denId: number | null, denName: string, score: number, heatsCompleted: number, racerImageUrl: string | null, rank: number }> };

export type OnDeckSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type OnDeckSubscriptionSubscription = { onDeck: Array<{ id: number, heatNumber: number, globalHeatNumber: number, roundNumber: number, roundName: string | null, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null }> }> };

export type CurrentlyRacingSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type CurrentlyRacingSubscriptionSubscription = { currentlyRacing: { id: number, heatNumber: number, globalHeatNumber: number, roundNumber: number, roundName: string | null, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null }> } | null };

export type TimingStatsSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type TimingStatsSubscriptionSubscription = { timingStats: { heatId: number, roundName: string, heatNumber: number, globalHeatNumber: number, lanes: Array<{ laneNumber: number, racerName: string, carName: string | null, time: number | null, place: number | null, racerImageUrl: string | null }> } | null };

export type ActiveFreeRaceHeatSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type ActiveFreeRaceHeatSubscriptionSubscription = { activeFreeRaceHeat: { id: number, createdAt: string, lanes: Array<{ lane: number, racerId: number | null }> } | null };

export type DisplayAssignmentSubscriptionVariables = Exact<{
  displayId: string;
  raceId: number;
}>;


export type DisplayAssignmentSubscription = { displayAssignment: { displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number } };

export type DisplaysSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type DisplaysSubscription = { displays: Array<{ displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number }> };

export type GetDisplaysQueryVariables = Exact<{
  raceId: number;
}>;


export type GetDisplaysQuery = { displays: Array<{ displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number }> };

export type AssignDisplayMutationVariables = Exact<{
  displayId: string;
  view: Types.DisplayView;
  cycleSeconds?: number | null | undefined;
}>;


export type AssignDisplayMutation = { assignDisplay: { displayId: string, view: Types.DisplayView, cycleSeconds: number, description: string, pacedByAPerson: boolean, connected: boolean, name: string, raceId: number } | null };

export type RenameDisplayMutationVariables = Exact<{
  displayId: string;
  name: string;
}>;


export type RenameDisplayMutation = { renameDisplay: { displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number } | null };

export type ForgetDisplayMutationVariables = Exact<{
  displayId: string;
}>;


export type ForgetDisplayMutation = { forgetDisplay: boolean };

export type GetPrintablesQueryVariables = Exact<{
  raceId: number;
}>;


export type GetPrintablesQuery = { race: { id: number, name: string, dateTime: string | null, location: string | null, dens: Array<{ id: number, name: string, color: string }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, carName: string | null, denId: number | null, racerImageUrl: string | null }> } | null };

export type GetHeatSheetQueryVariables = Exact<{
  raceId: number;
}>;


export type GetHeatSheetQuery = { race: { id: number, name: string, dateTime: string | null, location: string | null, trackId: number | null, rounds: Array<{ id: number, name: string | null, roundNumber: number, advancementSource: string | null }>, heats: Array<{ id: number, heatNumber: number, roundId: number, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null }> }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null }> } | null, tracks: Array<{ id: number, laneCount: number }> };

export type GetResultsSheetQueryVariables = Exact<{
  raceId: number;
}>;


export type GetResultsSheetQuery = { race: { id: number, name: string, dateTime: string | null, location: string | null, scoringStrategy: string, leaderboard: Array<{ racerId: number, rank: number, firstName: string, lastName: string, carNumber: number | null, denName: string, score: number, heatsCompleted: number }>, awards: Array<{ id: number, name: string, kind: string, sortOrder: number, recipient: { id: number, firstName: string, lastName: string, carNumber: number | null } | null }> } | null };

export type CreateRoundWizardMutationVariables = Exact<{
  raceId: number;
  config: Types.WizardConfigurationInput;
}>;


export type CreateRoundWizardMutation = { createRoundWizard: Array<{ id: number, roundNumber: number, name: string | null }> };

export type FakeTimerStartMutationVariables = Exact<{
  heatId: number;
  isFreeRace?: boolean | null | undefined;
}>;


export type FakeTimerStartMutation = { fakeTimerStart: boolean };

export type FakeTimerFinishMutationVariables = Exact<{
  heatId: number;
  isFreeRace?: boolean | null | undefined;
}>;


export type FakeTimerFinishMutation = { fakeTimerFinish: boolean };

export type TimerReadinessSubscriptionVariables = Exact<{
  trackId: number;
}>;


export type TimerReadinessSubscription = { timerStatus: { status: { state: string, deviceName: string | null, deviceProvenance: string | null } } };

export type TimerStatusSubscriptionVariables = Exact<{
  trackId: number;
}>;


export type TimerStatusSubscription = { timerStatus: { status: { state: string, deviceName: string | null, canRemoteStart: boolean, laneCount: number | null, activeHeatId: number | null, lastError: string | null, racerByLane: string | null, pendingResults: Array<{ lane: number, time: number | null, place: number | null, racerId: number | null }>, serialLog: Array<{ direction: string, data: string, timestamp: string }> } } };

export type HeatSessionSubscriptionVariables = Exact<{
  trackId: number;
  heatId?: number | null | undefined;
}>;


export type HeatSessionSubscription = { heatSession: { trackId: number, heatId: number | null, phase: Types.HeatPhase, timerState: string, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null, time: number | null, place: number | null, skipped: boolean, pending: boolean }> } };

export type PrepareHeatMutationVariables = Exact<{
  heatId: number;
  isFreeRace?: boolean | null | undefined;
}>;


export type PrepareHeatMutation = { prepareHeat: boolean };

export type AbortHeatMutationVariables = Exact<{
  trackId: number;
}>;


export type AbortHeatMutation = { abortHeat: boolean };

export type ForceResultsMutationVariables = Exact<{
  trackId: number;
}>;


export type ForceResultsMutation = { forceResults: boolean };

export type ReconnectTimerMutationVariables = Exact<{
  trackId: number;
}>;


export type ReconnectTimerMutation = { reconnectTimer: boolean };

export type ReleaseStartGateMutationVariables = Exact<{
  trackId: number;
}>;


export type ReleaseStartGateMutation = { releaseStartGate: string | null };

export type GetRaceControlDataQueryVariables = Exact<{
  id: number;
}>;


export type GetRaceControlDataQuery = { initialConfig: { debugMode: boolean }, race: { id: number, name: string, championshipTrophies: number, scoringStrategy: string, autoAdvanceHeat: boolean, registeredCount: number, checkedInCount: number, track: { id: number, laneCount: number, timerType: string } | null, dens: Array<{ id: number, name: string }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, racerImageUrl: string | null, carImageUrl: string | null }>, heats: Array<{ id: number, heatNumber: number, roundNumber: number, roundId: number, roundName: string | null, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null, time: number | null, place: number | null, skipped: boolean }> }>, rounds: Array<{ id: number, roundNumber: number, name: string | null, advancementSource: string | null, advancementFromBottom: boolean, schedulingStrategy: string, advancementStatus: { isReady: boolean, requiresAdvancement: boolean, alreadyAdvanced: boolean, fieldIsStale: boolean, source: string | null, numRacers: number | null, fromBottom: boolean, advancingRacers: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, denName: string, score: number, rank: number, isAdvancing: boolean }> } }> } | null };

export type CreateRoundMutationVariables = Exact<{
  raceId: number;
  roundData: Types.RoundCreateInput;
}>;


export type CreateRoundMutation = { createRound: Array<{ id: number }> };

export type RegenerateRoundMutationVariables = Exact<{
  roundId: number;
}>;


export type RegenerateRoundMutation = { regenerateRound: Array<{ id: number }> };

export type DeleteRoundMutationVariables = Exact<{
  roundId: number;
}>;


export type DeleteRoundMutation = { deleteRound: boolean };

export type DeleteHeatMutationVariables = Exact<{
  heatId: number;
}>;


export type DeleteHeatMutation = { deleteHeat: boolean };

export type ReorderHeatsMutationVariables = Exact<{
  heatUpdates: Array<Types.HeatReorderItemInput> | Types.HeatReorderItemInput;
}>;


export type ReorderHeatsMutation = { reorderHeats: { updatedCount: number } };

export type UpdateHeatResultMutationVariables = Exact<{
  heatId: number;
  lanes: Array<Types.HeatLaneInput> | Types.HeatLaneInput;
}>;


export type UpdateHeatResultMutation = { updateHeatResult: { id: number } | null };

export type UpdateRaceAutoAdvanceMutationVariables = Exact<{
  id: number;
  race: Types.RaceUpdateInput;
}>;


export type UpdateRaceAutoAdvanceMutation = { updateRace: { id: number, autoAdvanceHeat: boolean } | null };

export type SetLaneOutagesMutationVariables = Exact<{
  trackId: number;
  lanes: Array<number> | number;
}>;


export type SetLaneOutagesMutation = { setLaneOutages: Array<number> };

export type ActivityLogQueryVariables = Exact<{
  raceId?: number | null | undefined;
  limit: number;
  beforeId?: number | null | undefined;
}>;


export type ActivityLogQuery = { auditLog: Array<{ id: number, at: string, action: string, role: string, outcome: string, summary: string, noteworthy: boolean, raceId: number | null, sourceIp: string | null, details: string | null }> };

export type DiagnosticTracksQueryVariables = Exact<{ [key: string]: never; }>;


export type DiagnosticTracksQuery = { tracks: Array<{ id: number, name: string, timerType: string, serialPort: string | null, laneCount: number }> };

export type DiagnosticTimerStatusSubscriptionVariables = Exact<{
  trackId: number;
}>;


export type DiagnosticTimerStatusSubscription = { timerStatus: { trackId: number, status: { state: string, deviceName: string | null, deviceProvenance: string | null, port: string | null, laneCount: number | null, lastError: string | null, testRun: boolean, pendingResults: Array<{ lane: number, time: number | null, place: number | null }>, serialLog: Array<{ direction: string, data: string, timestamp: string }> } } };

export type DiagnosticReconnectTimerMutationVariables = Exact<{
  trackId: number;
}>;


export type DiagnosticReconnectTimerMutation = { reconnectTimer: boolean };

export type DiagnosticResetTimerMutationVariables = Exact<{
  trackId: number;
}>;


export type DiagnosticResetTimerMutation = { resetTimer: boolean };

export type DiagnosticStartTimerTestMutationVariables = Exact<{
  trackId: number;
}>;


export type DiagnosticStartTimerTestMutation = { startTimerTest: boolean };

export type DiagnosticForceResultsMutationVariables = Exact<{
  trackId: number;
}>;


export type DiagnosticForceResultsMutation = { forceResults: boolean };

export type GetRaceStatsQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceStatsQuery = { raceStats: { raceId: number, raceName: string, scoringStrategy: string, totalHeatsScheduled: number, totalHeatsCompleted: number, totalRacers: number, laneStats: Array<{ lane: number, avgTime: number | null, heatCount: number, relativeAdvantagePct: number | null }>, racerStats: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, denName: string, heatsCompleted: number, heatsScheduled: number, minTime: number | null, maxTime: number | null, meanTime: number | null, stdDev: number | null, timesPerLane: Array<{ lane: number, avgTime: number | null }> }>, highlights: Array<{ type: string, roundName: string, heatNumber: number, globalHeatNumber: number, racerName: string | null, time: number | null, margin: number | null }>, denStats: Array<{ denId: number, denName: string, denColor: string, racerCount: number, avgScore: number | null, bestRacerName: string | null }>, heatResults: Array<{ roundName: string, heatNumber: number, globalHeatNumber: number, lane: number, carNumber: number | null, racerFirstName: string, racerLastName: string, time: number | null, place: number | null }> } | null };
