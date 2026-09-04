/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import * as Types from './schema';

export type AwardInput = {
  artworkKey?: string | null | undefined;
  fromBottom?: boolean;
  kind?: string;
  name: string;
  place?: number | null | undefined;
  racerId?: number | null | undefined;
  racingGroupId?: number | null | undefined;
  sortOrder?: number | null | undefined;
  source?: string | null | undefined;
  votable?: boolean;
};

export type DisplayView =
  | 'AWARDS'
  | 'CYCLE'
  | 'PROJECTOR'
  | 'SLIDESHOW'
  | 'STANDINGS'
  | 'STANDINGS_ONLY'
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

export type HistoricalTrackRecordInput = {
  carNumber?: number | null | undefined;
  raceDate?: string | null | undefined;
  raceName?: string | null | undefined;
  racerName: string;
  timeSeconds: number;
};

export type InitialConfigInput = {
  checkinPin?: string | null | undefined;
  clearTerminology?: boolean;
  debugMode?: boolean;
  displayTheme?: string | null | undefined;
  nameDisplay?: string | null | undefined;
  operatorPin?: string | null | undefined;
  organizationName: string;
  organizationPlural?: string | null | undefined;
  organizationSingular?: string | null | undefined;
  printablesTheme?: string | null | undefined;
  racingGroupPlural?: string | null | undefined;
  racingGroupSingular?: string | null | undefined;
  tracks: Array<TrackInput>;
  vehicleArtworkKey?: string | null | undefined;
  vehiclePlural?: string | null | undefined;
  vehicleSingular?: string | null | undefined;
};

export type PhotoAssignmentInput = {
  photoType: string;
  racerId: number;
  url: string;
};

export type PopulateTestDataInput = {
  addCarPhotos?: boolean;
  addRacerPhotos?: boolean;
  assignRacingGroups?: boolean;
  checkIn?: boolean;
  count?: number;
};

export type RaceInput = {
  carNumberingStrategy?: string;
  championshipTrophies?: number;
  dateTime?: string | null | undefined;
  dropWorstRuns?: number;
  globalStartNumber?: number;
  location?: string | null | undefined;
  name: string;
  organizationId?: number;
  scoringStrategy?: string;
  tiebreaker?: string;
  trackId: number;
  weightLimitOz?: number | null | undefined;
};

export type RaceUpdateInput = {
  autoAdvanceHeat?: boolean | null | undefined;
  carNumberingStrategy?: string | null | undefined;
  championshipTrophies?: number | null | undefined;
  clearNameDisplay?: boolean;
  clearTerminology?: boolean;
  clearWeightLimit?: boolean;
  dateTime?: string | null | undefined;
  dropWorstRuns?: number | null | undefined;
  excludeRoundWinnersFromQualifyingStandings?: boolean | null | undefined;
  globalStartNumber?: number | null | undefined;
  isLocked?: boolean | null | undefined;
  location?: string | null | undefined;
  masterRunningOrder?: boolean | null | undefined;
  name?: string | null | undefined;
  nameDisplay?: string | null | undefined;
  oneTrophyPerRacer?: boolean | null | undefined;
  organizationPlural?: string | null | undefined;
  organizationSingular?: string | null | undefined;
  racingGroupPlural?: string | null | undefined;
  racingGroupSingular?: string | null | undefined;
  scoringStrategy?: string | null | undefined;
  tiebreaker?: string | null | undefined;
  trackId?: number | null | undefined;
  vehicleArtworkKey?: string | null | undefined;
  vehiclePlural?: string | null | undefined;
  vehicleSingular?: string | null | undefined;
  votingOpen?: boolean | null | undefined;
  weightLimitOz?: number | null | undefined;
};

export type RacerInput = {
  carImageUrl?: string | null | undefined;
  carName?: string | null | undefined;
  carNumber?: number | null | undefined;
  carPassedInspection?: boolean;
  carWeight?: number | null | undefined;
  excludedFromStandings?: boolean;
  firstName: string;
  lastName: string;
  raceId?: number | null | undefined;
  racerImageUrl?: string | null | undefined;
  racingGroupId?: number | null | undefined;
};

export type RacingGroupInput = {
  carNumberRangeEnd?: number | null | undefined;
  carNumberRangeStart?: number | null | undefined;
  color?: string;
  division?: string | null | undefined;
  name: string;
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

export type ScrollBehavior =
  | 'PAGING'
  | 'SMOOTH';

export type TrackInput = {
  id?: number | null | undefined;
  laneCount?: number;
  lengthFeet?: number | null | undefined;
  name?: string;
  remoteStartInstalled?: boolean;
  reverseLanes?: boolean;
  scaleRatio?: number;
  serialPort?: string | null | undefined;
  showScaleSpeed?: boolean;
  timerProfile?: string | null | undefined;
  timerType?: string;
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

export type CacheTestCreatePracticeRaceMutationVariables = Exact<{ [key: string]: never; }>;


export type CacheTestCreatePracticeRaceMutation = { createPracticeRace: { id: number } };

export type GetInitialConfigQueryVariables = Exact<{ [key: string]: never; }>;


export type GetInitialConfigQuery = { initialConfig: { initialized: boolean, version: string } };

export type CreateInitialConfigMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateInitialConfigMutation = { createInitialConfig: { initialized: boolean } };

export type UpdateInitialConfigMutationVariables = Exact<{ [key: string]: never; }>;


export type UpdateInitialConfigMutation = { updateInitialConfig: { initialized: boolean } };

export type CacheTestRaceTerminologyQueryVariables = Exact<{
  raceId: number;
}>;


export type CacheTestRaceTerminologyQuery = { race: { id: number, terminology: { racingGroupSingular: string } } | null };

export type CacheTestUpdateInitialConfigMutationVariables = Exact<{
  config: Types.InitialConfigInput;
}>;


export type CacheTestUpdateInitialConfigMutation = { updateInitialConfig: { initialized: boolean } };

export type CacheTestUpdateInitialConfigAloneMutationVariables = Exact<{
  config: Types.InitialConfigInput;
}>;


export type CacheTestUpdateInitialConfigAloneMutation = { updateInitialConfig: { initialized: boolean } };

export type RaceAwardsQueryVariables = Exact<{
  raceId: number;
}>;


export type RaceAwardsQuery = { race: { id: number, name: string, votingOpen: boolean, isLocked: boolean, resolvedNameDisplay: string, awards: Array<{ id: number, name: string, kind: string, sortOrder: number, source: string | null, place: number | null, fromBottom: boolean, racingGroupId: number | null, artworkKey: string | null, votable: boolean, placeContested: boolean, position: number | null, racingGroup: { id: number, name: string } | null, recipient: { id: number, firstName: string, lastName: string, carNumber: number | null, racerImageUrl: string | null } | null, voteTally: Array<{ racerId: number, voteCount: number, racer: { id: number, carNumber: number | null, carName: string | null } | null }>, passedOver: Array<{ racerId: number, awardId: number, racer: { id: number, firstName: string, lastName: string, carNumber: number | null } | null, award: { id: number, name: string } | null }>, duplicateOf: { id: number, name: string } | null }>, rounds: Array<{ id: number, name: string | null, roundNumber: number }>, racingGroups: Array<{ id: number, name: string, color: string }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, carImageUrl: string | null }> } | null };

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

export type UpdateRaceVotingMutationVariables = Exact<{
  id: number;
  race: Types.RaceUpdateInput;
}>;


export type UpdateRaceVotingMutation = { updateRace: { id: number, votingOpen: boolean } | null };

export type VotingBallotQueryVariables = Exact<{
  raceId: number;
}>;


export type VotingBallotQuery = { race: { id: number, name: string, votingOpen: boolean, awards: Array<{ id: number, name: string, kind: string, votable: boolean }>, racers: Array<{ id: number, carNumber: number | null, carName: string | null, carImageUrl: string | null }> } | null };

export type CastVoteMutationVariables = Exact<{
  awardId: number;
  racerId: number;
  ballotKey: string;
}>;


export type CastVoteMutation = { castVote: string | null };

export type NetworkAddressesQueryVariables = Exact<{ [key: string]: never; }>;


export type NetworkAddressesQuery = { networkAddresses: Array<string> };

export type GetTracksQueryVariables = Exact<{ [key: string]: never; }>;


export type GetTracksQuery = { tracks: Array<{ id: number, name: string, timerType: string }> };

export type GetRacesNavQueryVariables = Exact<{ [key: string]: never; }>;


export type GetRacesNavQuery = { races: Array<{ id: number, name: string, isLocked: boolean }> };

export type RacesChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type RacesChangedSubscription = { racesChanged: boolean };

export type GetInitialConfigStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type GetInitialConfigStatusQuery = { initialConfig: { initialized: boolean, version: string, debugMode: boolean, pinRequired: boolean, isOperator: boolean, demoMode: boolean, terminology: { racingGroupSingular: string, racingGroupPlural: string, organizationSingular: string, organizationPlural: string, vehicleSingular: string, vehiclePlural: string, vehicleArtworkKey: string } } };

export type GetRaceTerminologyQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceTerminologyQuery = { race: { id: number, terminology: { racingGroupSingular: string, racingGroupPlural: string, organizationSingular: string, organizationPlural: string, vehicleSingular: string, vehiclePlural: string, vehicleArtworkKey: string } } | null };

export type GetRaceDetailsQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceDetailsQuery = { race: { id: number, name: string, dateTime: string | null, location: string | null, trackId: number | null, scoringStrategy: string, tiebreaker: string, dropWorstRuns: number, carNumberingStrategy: string, globalStartNumber: number, championshipTrophies: number, weightLimitOz: number | null, masterRunningOrder: boolean, racingGroupSingular: string | null, racingGroupPlural: string | null, organizationSingular: string | null, organizationPlural: string | null, vehicleSingular: string | null, vehiclePlural: string | null, vehicleArtworkKey: string | null, excludeRoundWinnersFromQualifyingStandings: boolean, oneTrophyPerRacer: boolean, nameDisplay: string | null, resolvedNameDisplay: string, isLocked: boolean, registeredCount: number, checkedInCount: number, scheduledRacerIds: Array<number>, racingGroups: Array<{ id: number, name: string, color: string, division: string | null, carNumberRangeStart: number | null, carNumberRangeEnd: number | null }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, racingGroupId: number | null, carName: string | null, carPassedInspection: boolean, carWeight: number | null, racerImageUrl: string | null, carImageUrl: string | null, excludedFromStandings: boolean }>, leaderboard: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, racingGroupName: string, score: number, heatsCompleted: number, racerImageUrl: string | null, rank: number }>, rounds: Array<{ id: number }> } | null, tracks: Array<{ id: number, name: string, laneCount: number }> };

export type GetRaceRacingGroupsQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceRacingGroupsQuery = { race: { id: number, racingGroups: Array<{ id: number, name: string, color: string, division: string | null, carNumberRangeStart: number | null, carNumberRangeEnd: number | null }> } | null };

export type UpdateRaceMutationVariables = Exact<{
  id: number;
  race: Types.RaceUpdateInput;
}>;


export type UpdateRaceMutation = { updateRace: { id: number, name: string, dateTime: string | null, location: string | null, trackId: number | null, scoringStrategy: string, tiebreaker: string, dropWorstRuns: number, carNumberingStrategy: string, globalStartNumber: number, championshipTrophies: number, weightLimitOz: number | null, masterRunningOrder: boolean, racingGroupSingular: string | null, racingGroupPlural: string | null, organizationSingular: string | null, organizationPlural: string | null, vehicleSingular: string | null, vehiclePlural: string | null, vehicleArtworkKey: string | null, excludeRoundWinnersFromQualifyingStandings: boolean, oneTrophyPerRacer: boolean, nameDisplay: string | null, resolvedNameDisplay: string, terminology: { racingGroupSingular: string, racingGroupPlural: string, organizationSingular: string, organizationPlural: string, vehicleSingular: string, vehiclePlural: string, vehicleArtworkKey: string } } | null };

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

export type PreviewGprmImportMutationVariables = Exact<{
  raceId: number;
  fileData: string;
}>;


export type PreviewGprmImportMutation = { previewGprmImport: { canImport: boolean, groups: Array<{ name: string, division: string | null }>, racers: Array<{ firstName: string, lastName: string, carNumber: number | null, carName: string | null, carWeight: number | null, passedInspection: boolean, group: string | null, excludedFromStandings: boolean, sourceId: string | null }>, problems: Array<{ message: string, blocking: boolean, sourceId: string | null }> } };

export type ConfirmGprmImportMutationVariables = Exact<{
  raceId: number;
  fileData: string;
}>;


export type ConfirmGprmImportMutation = { confirmGprmImport: number };

export type CreateRacingGroupMutationVariables = Exact<{
  raceId: number;
  racingGroup: Types.RacingGroupInput;
}>;


export type CreateRacingGroupMutation = { createRacingGroup: { id: number, name: string } };

export type UpdateRacingGroupMutationVariables = Exact<{
  id: number;
  racingGroup: Types.RacingGroupInput;
}>;


export type UpdateRacingGroupMutation = { updateRacingGroup: { id: number, name: string } | null };

export type DeleteRacingGroupMutationVariables = Exact<{
  id: number;
}>;


export type DeleteRacingGroupMutation = { deleteRacingGroup: boolean };

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

export type BulkSetExcludedFromStandingsMutationVariables = Exact<{
  racerIds: Array<number> | number;
  excluded: boolean;
}>;


export type BulkSetExcludedFromStandingsMutation = { bulkSetExcludedFromStandings: boolean };

export type BulkMoveToRacingGroupMutationVariables = Exact<{
  racerIds: Array<number> | number;
  racingGroupId?: number | null | undefined;
}>;


export type BulkMoveToRacingGroupMutation = { bulkMoveToRacingGroup: boolean };

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

export type CreatePracticeRaceMutationVariables = Exact<{
  startNew?: boolean | null | undefined;
}>;


export type CreatePracticeRaceMutation = { createPracticeRace: { id: number, name: string } };

export type GetRacesQueryVariables = Exact<{ [key: string]: never; }>;


export type GetRacesQuery = { races: Array<{ id: number, name: string, dateTime: string | null, location: string | null, registeredCount: number, checkedInCount: number, isLocked: boolean }>, practiceRace: { id: number, name: string } | null };

export type LeaderboardSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type LeaderboardSubscriptionSubscription = { leaderboard: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, racingGroupId: number | null, racingGroupName: string, racingGroupDivision: string | null, score: number, heatsCompleted: number, racerImageUrl: string | null, rank: number, resolvedBy: string | null, dropWorstRunsApplied: boolean }> };

export type OnDeckSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type OnDeckSubscriptionSubscription = { onDeck: Array<{ id: number, heatNumber: number, globalHeatNumber: number, roundNumber: number, roundName: string | null, runOffPlacement: number | null, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null }> }> };

export type CurrentlyRacingSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type CurrentlyRacingSubscriptionSubscription = { currentlyRacing: { id: number, heatNumber: number, globalHeatNumber: number, roundNumber: number, roundName: string | null, runOffPlacement: number | null, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null }> } | null };

export type TimingStatsSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type TimingStatsSubscriptionSubscription = { timingStats: { heatId: number, recordedAt: string | null, roundName: string, heatNumber: number, globalHeatNumber: number, lanes: Array<{ laneNumber: number, racerName: string, carName: string | null, time: number | null, place: number | null, racerImageUrl: string | null, scaleMph: number | null }>, recordBreak: { newSeconds: number, newHolder: string, previousSeconds: number, previousHolder: string, previousRaceName: string | null } | null } | null };

export type ActiveFreeRaceHeatSubscriptionSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type ActiveFreeRaceHeatSubscriptionSubscription = { activeFreeRaceHeat: { id: number, createdAt: string, lanes: Array<{ lane: number, racerId: number | null }> } | null };

export type DisplayAssignmentSubscriptionVariables = Exact<{
  displayId: string;
  raceId: number;
}>;


export type DisplayAssignmentSubscription = { displayAssignment: { displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, scrollBehavior: Types.ScrollBehavior, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number, slideSeq: number, slideDelta: number, identifySeq: number, displayThemeSetting: string } };

export type DisplaysSubscriptionVariables = Exact<{
  raceId: number;
}>;


export type DisplaysSubscription = { displays: Array<{ displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, scrollBehavior: Types.ScrollBehavior, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number, slideSeq: number, slideDelta: number, identifySeq: number }> };

export type GetDisplaysQueryVariables = Exact<{
  raceId: number;
}>;


export type GetDisplaysQuery = { displays: Array<{ displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, scrollBehavior: Types.ScrollBehavior, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number, slideSeq: number, slideDelta: number, identifySeq: number }> };

export type RaceAwardCountQueryVariables = Exact<{
  raceId: number;
}>;


export type RaceAwardCountQuery = { race: { id: number, awards: Array<{ id: number }> } | null };

export type SuggestDisplayNameQueryVariables = Exact<{
  displayId: string;
  avoid?: string | null | undefined;
}>;


export type SuggestDisplayNameQuery = { suggestDisplayName: string };

export type AssignDisplayMutationVariables = Exact<{
  displayId: string;
  view: Types.DisplayView;
  cycleSeconds?: number | null | undefined;
  scrollBehavior?: Types.ScrollBehavior | null | undefined;
}>;


export type AssignDisplayMutation = { assignDisplay: { displayId: string, view: Types.DisplayView, cycleSeconds: number, scrollBehavior: Types.ScrollBehavior, description: string, pacedByAPerson: boolean, connected: boolean, name: string, raceId: number } | null };

export type AdvanceDisplayMutationVariables = Exact<{
  displayId: string;
  delta: number;
}>;


export type AdvanceDisplayMutation = { advanceDisplay: { displayId: string, slideSeq: number, slideDelta: number } | null };

export type IdentifyDisplayMutationVariables = Exact<{
  displayId: string;
}>;


export type IdentifyDisplayMutation = { identifyDisplay: { displayId: string, identifySeq: number } | null };

export type RenameDisplayMutationVariables = Exact<{
  displayId: string;
  name: string;
}>;


export type RenameDisplayMutation = { renameDisplay: { displayId: string, name: string, view: Types.DisplayView, cycleSeconds: number, scrollBehavior: Types.ScrollBehavior, description: string, pacedByAPerson: boolean, connected: boolean, assigned: boolean, raceId: number, slideSeq: number, slideDelta: number, identifySeq: number } | null };

export type ForgetDisplayMutationVariables = Exact<{
  displayId: string;
}>;


export type ForgetDisplayMutation = { forgetDisplay: boolean };

export type GetPrintablesQueryVariables = Exact<{
  raceId: number;
}>;


export type GetPrintablesQuery = { initialConfig: { printablesTheme: string }, race: { id: number, name: string, dateTime: string | null, location: string | null, resolvedNameDisplay: string, racingGroups: Array<{ id: number, name: string, color: string }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, carName: string | null, carWeight: number | null, racingGroupId: number | null, racerImageUrl: string | null }> } | null };

export type GetHeatSheetQueryVariables = Exact<{
  raceId: number;
}>;


export type GetHeatSheetQuery = { initialConfig: { printablesTheme: string }, race: { id: number, name: string, dateTime: string | null, location: string | null, trackId: number | null, resolvedNameDisplay: string, rounds: Array<{ id: number, name: string | null, roundNumber: number, advancementSource: string | null }>, heats: Array<{ id: number, heatNumber: number, roundId: number, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null }> }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null }> } | null, tracks: Array<{ id: number, laneCount: number }> };

export type GetResultsSheetQueryVariables = Exact<{
  raceId: number;
}>;


export type GetResultsSheetQuery = { initialConfig: { printablesTheme: string }, race: { id: number, name: string, dateTime: string | null, location: string | null, scoringStrategy: string, resolvedNameDisplay: string, leaderboard: Array<{ racerId: number, rank: number, firstName: string, lastName: string, carNumber: number | null, racingGroupName: string, score: number, heatsCompleted: number }>, racers: Array<{ id: number, excludedFromStandings: boolean }>, awards: Array<{ id: number, name: string, kind: string, sortOrder: number, recipient: { id: number, firstName: string, lastName: string, carNumber: number | null } | null }> } | null };

export type GetCertificatesQueryVariables = Exact<{
  raceId: number;
}>;


export type GetCertificatesQuery = { initialConfig: { printablesTheme: string }, race: { id: number, name: string, dateTime: string | null, location: string | null, resolvedNameDisplay: string, awards: Array<{ id: number, name: string, kind: string, sortOrder: number, artworkKey: string | null, recipient: { id: number, firstName: string, lastName: string, carNumber: number | null } | null }> } | null };

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


export type GetRaceControlDataQuery = { initialConfig: { debugMode: boolean }, race: { id: number, name: string, championshipTrophies: number, scoringStrategy: string, autoAdvanceHeat: boolean, registeredCount: number, checkedInCount: number, isLocked: boolean, masterRunningOrder: boolean, track: { id: number, laneCount: number, timerType: string, laneOutages: Array<number> } | null, racingGroups: Array<{ id: number, name: string }>, racers: Array<{ id: number, firstName: string, lastName: string, carNumber: number | null, racerImageUrl: string | null }>, heats: Array<{ id: number, heatNumber: number, roundNumber: number, roundId: number, roundName: string | null, recordedAt: string | null, lanes: Array<{ lane: number, racerId: number | null, placeholderSlot: number | null, time: number | null, place: number | null, skipped: boolean }> }>, rounds: Array<{ id: number, roundNumber: number, name: string | null, advancementSource: string | null, advancementFromBottom: boolean, schedulingStrategy: string, racingGroupId: number | null, advancementStatus: { isReady: boolean, requiresAdvancement: boolean, alreadyAdvanced: boolean, fieldIsStale: boolean, contestedCut: boolean, source: string | null, numRacers: number | null, fromBottom: boolean, advancingRacers: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, racingGroupName: string, score: number, rank: number, isAdvancing: boolean }> } }> } | null };

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

export type ApplyMasterRunningOrderMutationVariables = Exact<{
  raceId: number;
}>;


export type ApplyMasterRunningOrderMutation = { applyMasterRunningOrder: { updatedCount: number } };

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

export type CreateRunOffHeatMutationVariables = Exact<{
  raceId: number;
  racerIds: Array<number> | number;
  settlesRoundId?: number | null | undefined;
}>;


export type CreateRunOffHeatMutation = { createRunOffHeat: { id: number, settlesRoundId: number | null, recorded: boolean, placement: number | null, lanes: Array<{ lane: number, racerId: number | null }> } };

export type DeleteRunOffHeatMutationVariables = Exact<{
  heatId: number;
}>;


export type DeleteRunOffHeatMutation = { deleteRunOffHeat: boolean };

export type GetRunOffHeatsQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRunOffHeatsQuery = { race: { id: number, isLocked: boolean, runOffHeats: Array<{ id: number, settlesRoundId: number | null, recorded: boolean, placement: number | null, lanes: Array<{ lane: number, racerId: number | null }> }> } | null };

export type StartIntermissionMutationVariables = Exact<{
  raceId: number;
  durationSeconds: number;
  label?: string | null | undefined;
}>;


export type StartIntermissionMutation = { startIntermission: { id: number, intermission: { active: boolean, remainingSeconds: number, paused: boolean, label: string | null, endsAt: string | null } } };

export type ExtendIntermissionMutationVariables = Exact<{
  raceId: number;
  seconds: number;
}>;


export type ExtendIntermissionMutation = { extendIntermission: { id: number, intermission: { active: boolean, remainingSeconds: number, paused: boolean, label: string | null, endsAt: string | null } } };

export type PauseIntermissionMutationVariables = Exact<{
  raceId: number;
}>;


export type PauseIntermissionMutation = { pauseIntermission: { id: number, intermission: { active: boolean, remainingSeconds: number, paused: boolean, label: string | null, endsAt: string | null } } };

export type ResumeIntermissionMutationVariables = Exact<{
  raceId: number;
}>;


export type ResumeIntermissionMutation = { resumeIntermission: { id: number, intermission: { active: boolean, remainingSeconds: number, paused: boolean, label: string | null, endsAt: string | null } } };

export type EndIntermissionMutationVariables = Exact<{
  raceId: number;
}>;


export type EndIntermissionMutation = { endIntermission: { id: number, intermission: { active: boolean, remainingSeconds: number, paused: boolean, label: string | null, endsAt: string | null } } };

export type GetRaceIntermissionQueryVariables = Exact<{
  raceId: number;
}>;


export type GetRaceIntermissionQuery = { race: { id: number, intermission: { active: boolean, remainingSeconds: number, paused: boolean, label: string | null, endsAt: string | null } } | null };

export type SetLaneOutagesMutationVariables = Exact<{
  trackId: number;
  lanes: Array<number> | number;
}>;


export type SetLaneOutagesMutation = { setLaneOutages: Array<number> };

export type CreateTrackRecordMutationVariables = Exact<{
  trackId: number;
  record: Types.HistoricalTrackRecordInput;
}>;


export type CreateTrackRecordMutation = { createTrackRecord: { id: number, trackId: number, timeSeconds: number, racerName: string, carNumber: number | null, raceName: string | null, raceDate: string | null } };

export type UpdateTrackRecordMutationVariables = Exact<{
  recordId: number;
  record: Types.HistoricalTrackRecordInput;
}>;


export type UpdateTrackRecordMutation = { updateTrackRecord: { id: number, trackId: number, timeSeconds: number, racerName: string, carNumber: number | null, raceName: string | null, raceDate: string | null } };

export type DeleteTrackRecordMutationVariables = Exact<{
  recordId: number;
}>;


export type DeleteTrackRecordMutation = { deleteTrackRecord: boolean };

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


export type DiagnosticTimerStatusSubscription = { timerStatus: { trackId: number, status: { state: string, deviceName: string | null, deviceProvenance: string | null, port: string | null, laneCount: number | null, lastError: string | null, testRun: boolean, indicatesTimingStarted: boolean, hasCountdownClock: boolean, hasPhotoFinishTrigger: boolean, pendingResults: Array<{ lane: number, time: number | null, place: number | null }>, serialLog: Array<{ direction: string, data: string, timestamp: string }> } } };

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


export type GetRaceStatsQuery = { raceStats: { raceId: number, raceName: string, scoringStrategy: string, totalHeatsScheduled: number, totalHeatsCompleted: number, totalRacers: number, topScaleMph: number | null, laneStats: Array<{ lane: number, avgTime: number | null, heatCount: number, relativeAdvantagePct: number | null }>, racerStats: Array<{ racerId: number, firstName: string, lastName: string, carNumber: number | null, racingGroupName: string, heatsCompleted: number, heatsScheduled: number, minTime: number | null, maxTime: number | null, meanTime: number | null, stdDev: number | null, timesPerLane: Array<{ lane: number, avgTime: number | null }> }>, highlights: Array<{ type: string, roundName: string, heatNumber: number, globalHeatNumber: number, racerName: string | null, time: number | null, margin: number | null }>, racingGroupStats: Array<{ racingGroupId: number, racingGroupName: string, racingGroupColor: string, racerCount: number, avgScore: number | null, bestRacerName: string | null }>, heatResults: Array<{ roundName: string, heatNumber: number, globalHeatNumber: number, lane: number, carNumber: number | null, racerFirstName: string, racerLastName: string, time: number | null, place: number | null }>, trackRecords: Array<{ timeSeconds: number, racerName: string, carNumber: number | null, raceId: number | null, raceName: string | null, raceDate: string | null }> } | null };
