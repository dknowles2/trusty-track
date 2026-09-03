export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type AdvancementRacer = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  firstName: Scalars['String']['output'];
  isAdvancing: Scalars['Boolean']['output'];
  lastName: Scalars['String']['output'];
  racerId: Scalars['Int']['output'];
  racingGroupName: Scalars['String']['output'];
  rank: Scalars['Int']['output'];
  score: Scalars['Float']['output'];
};

export type AdvancementStatus = {
  advancingRacers: Array<AdvancementRacer>;
  alreadyAdvanced: Scalars['Boolean']['output'];
  contestedCut: Scalars['Boolean']['output'];
  fieldIsStale: Scalars['Boolean']['output'];
  fromBottom: Scalars['Boolean']['output'];
  isReady: Scalars['Boolean']['output'];
  numRacers?: Maybe<Scalars['Int']['output']>;
  requiresAdvancement: Scalars['Boolean']['output'];
  source?: Maybe<Scalars['String']['output']>;
};

export type AuditLogEntry = {
  action: Scalars['String']['output'];
  at: Scalars['String']['output'];
  details?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  noteworthy: Scalars['Boolean']['output'];
  outcome: Scalars['String']['output'];
  raceId?: Maybe<Scalars['Int']['output']>;
  role: Scalars['String']['output'];
  sourceIp?: Maybe<Scalars['String']['output']>;
  summary: Scalars['String']['output'];
};

export type Award = {
  artworkKey?: Maybe<Scalars['String']['output']>;
  fromBottom: Scalars['Boolean']['output'];
  id: Scalars['Int']['output'];
  kind: Scalars['String']['output'];
  name: Scalars['String']['output'];
  place?: Maybe<Scalars['Int']['output']>;
  placeContested: Scalars['Boolean']['output'];
  raceId: Scalars['Int']['output'];
  racingGroup?: Maybe<RacingGroup>;
  racingGroupId?: Maybe<Scalars['Int']['output']>;
  recipient?: Maybe<Racer>;
  sortOrder: Scalars['Int']['output'];
  source?: Maybe<Scalars['String']['output']>;
  votable: Scalars['Boolean']['output'];
  voteTally: Array<AwardVoteTally>;
};

export type AwardInput = {
  artworkKey?: InputMaybe<Scalars['String']['input']>;
  fromBottom?: Scalars['Boolean']['input'];
  kind?: Scalars['String']['input'];
  name: Scalars['String']['input'];
  place?: InputMaybe<Scalars['Int']['input']>;
  racerId?: InputMaybe<Scalars['Int']['input']>;
  racingGroupId?: InputMaybe<Scalars['Int']['input']>;
  sortOrder?: InputMaybe<Scalars['Int']['input']>;
  source?: InputMaybe<Scalars['String']['input']>;
  votable?: Scalars['Boolean']['input'];
};

export type AwardVoteTally = {
  raceId: Scalars['Int']['output'];
  racer?: Maybe<Racer>;
  racerId: Scalars['Int']['output'];
  voteCount: Scalars['Int']['output'];
};

export type Display = {
  assigned: Scalars['Boolean']['output'];
  connected: Scalars['Boolean']['output'];
  cycleSeconds: Scalars['Int']['output'];
  description: Scalars['String']['output'];
  displayId: Scalars['String']['output'];
  displayThemeSetting: Scalars['String']['output'];
  identifySeq: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  pacedByAPerson: Scalars['Boolean']['output'];
  raceId: Scalars['Int']['output'];
  slideDelta: Scalars['Int']['output'];
  slideSeq: Scalars['Int']['output'];
  view: DisplayView;
};

export type DisplayView =
  | 'AWARDS'
  | 'CYCLE'
  | 'PROJECTOR'
  | 'SLIDESHOW'
  | 'STANDINGS'
  | 'TIMING';

export type FreeRaceHeat = {
  createdAt: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  lanes: Array<HeatLane>;
  raceId: Scalars['Int']['output'];
  recorded: Scalars['Boolean']['output'];
};

export type FreeRaceLaneAssignment = {
  lane: Scalars['Int']['output'];
  racerId?: Maybe<Scalars['Int']['output']>;
};

export type FreeRaceLaneAssignmentInput = {
  lane: Scalars['Int']['input'];
  racerId?: InputMaybe<Scalars['Int']['input']>;
};

export type Heat = {
  globalHeatNumber: Scalars['Int']['output'];
  heatNumber: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  lanes: Array<HeatLane>;
  raceId: Scalars['Int']['output'];
  recordedAt?: Maybe<Scalars['String']['output']>;
  roundId: Scalars['Int']['output'];
  roundName?: Maybe<Scalars['String']['output']>;
  roundNumber: Scalars['Int']['output'];
  runOffPlacement?: Maybe<Scalars['Int']['output']>;
};

export type HeatHighlight = {
  globalHeatNumber: Scalars['Int']['output'];
  heatNumber: Scalars['Int']['output'];
  margin?: Maybe<Scalars['Float']['output']>;
  racerName?: Maybe<Scalars['String']['output']>;
  roundName: Scalars['String']['output'];
  time?: Maybe<Scalars['Float']['output']>;
  type: Scalars['String']['output'];
};

export type HeatLane = {
  lane: Scalars['Int']['output'];
  place?: Maybe<Scalars['Int']['output']>;
  placeholderSlot?: Maybe<Scalars['Int']['output']>;
  racerId?: Maybe<Scalars['Int']['output']>;
  skipped: Scalars['Boolean']['output'];
  time?: Maybe<Scalars['Float']['output']>;
};

export type HeatLaneInput = {
  lane: Scalars['Int']['input'];
  place?: InputMaybe<Scalars['Int']['input']>;
  placeholderSlot?: InputMaybe<Scalars['Int']['input']>;
  racerId?: InputMaybe<Scalars['Int']['input']>;
  skipped?: Scalars['Boolean']['input'];
  time?: InputMaybe<Scalars['Float']['input']>;
};

export type HeatPhase =
  | 'NOT_READY'
  | 'NO_HEAT'
  | 'RECORDED'
  | 'RUNNING'
  | 'WAITING';

export type HeatReorderItemInput = {
  heatId: Scalars['Int']['input'];
  newHeatNumber: Scalars['Int']['input'];
};

export type HeatReorderResponse = {
  heats: Array<Heat>;
  updatedCount: Scalars['Int']['output'];
};

export type HeatResultRow = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  globalHeatNumber: Scalars['Int']['output'];
  heatNumber: Scalars['Int']['output'];
  lane: Scalars['Int']['output'];
  place?: Maybe<Scalars['Int']['output']>;
  racerFirstName: Scalars['String']['output'];
  racerLastName: Scalars['String']['output'];
  roundName: Scalars['String']['output'];
  time?: Maybe<Scalars['Float']['output']>;
};

export type HeatSession = {
  heatId?: Maybe<Scalars['Int']['output']>;
  lanes: Array<LiveLane>;
  phase: HeatPhase;
  timerState: Scalars['String']['output'];
  trackId: Scalars['Int']['output'];
};

export type HistoricalTrackRecord = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  id: Scalars['Int']['output'];
  raceDate?: Maybe<Scalars['String']['output']>;
  raceName?: Maybe<Scalars['String']['output']>;
  racerName: Scalars['String']['output'];
  timeSeconds: Scalars['Float']['output'];
  trackId: Scalars['Int']['output'];
};

export type HistoricalTrackRecordInput = {
  carNumber?: InputMaybe<Scalars['Int']['input']>;
  raceDate?: InputMaybe<Scalars['String']['input']>;
  raceName?: InputMaybe<Scalars['String']['input']>;
  racerName: Scalars['String']['input'];
  timeSeconds: Scalars['Float']['input'];
};

export type InitialConfigInput = {
  checkinPin?: InputMaybe<Scalars['String']['input']>;
  clearTerminology?: Scalars['Boolean']['input'];
  debugMode?: Scalars['Boolean']['input'];
  displayTheme?: InputMaybe<Scalars['String']['input']>;
  nameDisplay?: InputMaybe<Scalars['String']['input']>;
  operatorPin?: InputMaybe<Scalars['String']['input']>;
  organizationName: Scalars['String']['input'];
  organizationPlural?: InputMaybe<Scalars['String']['input']>;
  organizationSingular?: InputMaybe<Scalars['String']['input']>;
  printablesTheme?: InputMaybe<Scalars['String']['input']>;
  racingGroupPlural?: InputMaybe<Scalars['String']['input']>;
  racingGroupSingular?: InputMaybe<Scalars['String']['input']>;
  tracks: Array<TrackInput>;
  vehicleArtworkKey?: InputMaybe<Scalars['String']['input']>;
  vehiclePlural?: InputMaybe<Scalars['String']['input']>;
  vehicleSingular?: InputMaybe<Scalars['String']['input']>;
};

export type InitialConfigStatus = {
  checkinPinSet: Scalars['Boolean']['output'];
  currentRaceId?: Maybe<Scalars['Int']['output']>;
  debugMode: Scalars['Boolean']['output'];
  demoMode: Scalars['Boolean']['output'];
  displayTheme: Scalars['String']['output'];
  initialized: Scalars['Boolean']['output'];
  isOperator: Scalars['Boolean']['output'];
  nameDisplay?: Maybe<Scalars['String']['output']>;
  organizationName?: Maybe<Scalars['String']['output']>;
  organizationPlural?: Maybe<Scalars['String']['output']>;
  organizationSingular?: Maybe<Scalars['String']['output']>;
  pinRequired: Scalars['Boolean']['output'];
  printablesTheme: Scalars['String']['output'];
  racingGroupPlural?: Maybe<Scalars['String']['output']>;
  racingGroupSingular?: Maybe<Scalars['String']['output']>;
  resolvedNameDisplay: Scalars['String']['output'];
  terminology: Terminology;
  tracks: Array<Track>;
  vehicleArtworkKey?: Maybe<Scalars['String']['output']>;
  vehiclePlural?: Maybe<Scalars['String']['output']>;
  vehicleSingular?: Maybe<Scalars['String']['output']>;
  version: Scalars['String']['output'];
};

export type LaneResult = {
  lane: Scalars['Int']['output'];
  place?: Maybe<Scalars['Int']['output']>;
  racerId?: Maybe<Scalars['Int']['output']>;
  time?: Maybe<Scalars['Float']['output']>;
};

export type LaneTimeStat = {
  avgTime?: Maybe<Scalars['Float']['output']>;
  heatCount: Scalars['Int']['output'];
  lane: Scalars['Int']['output'];
  relativeAdvantagePct?: Maybe<Scalars['Float']['output']>;
};

export type LeaderboardEntry = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  dropWorstRunsApplied: Scalars['Boolean']['output'];
  firstName: Scalars['String']['output'];
  heatsCompleted: Scalars['Int']['output'];
  lastName: Scalars['String']['output'];
  racerId: Scalars['Int']['output'];
  racerImageUrl?: Maybe<Scalars['String']['output']>;
  racingGroupDivision?: Maybe<Scalars['String']['output']>;
  racingGroupId?: Maybe<Scalars['Int']['output']>;
  racingGroupName: Scalars['String']['output'];
  rank: Scalars['Int']['output'];
  resolvedBy?: Maybe<Scalars['String']['output']>;
  score: Scalars['Float']['output'];
};

export type LiveLane = {
  lane: Scalars['Int']['output'];
  pending: Scalars['Boolean']['output'];
  place?: Maybe<Scalars['Int']['output']>;
  placeholderSlot?: Maybe<Scalars['Int']['output']>;
  racerId?: Maybe<Scalars['Int']['output']>;
  skipped: Scalars['Boolean']['output'];
  time?: Maybe<Scalars['Float']['output']>;
};

export type Mutation = {
  abortHeat: Scalars['Boolean']['output'];
  advanceDisplay?: Maybe<Display>;
  advanceRound: Scalars['Int']['output'];
  applyMasterRunningOrder: HeatReorderResponse;
  assignDisplay?: Maybe<Display>;
  bulkAssignPhotos: Scalars['Int']['output'];
  bulkAutoNumber: Scalars['Int']['output'];
  bulkCheckIn: Scalars['Boolean']['output'];
  bulkClearNumbers: Scalars['Boolean']['output'];
  bulkDeleteRacers: Scalars['Boolean']['output'];
  bulkMoveToRacingGroup: Scalars['Boolean']['output'];
  bulkSetExcludedFromStandings: Scalars['Boolean']['output'];
  castVote?: Maybe<Scalars['String']['output']>;
  checkInRacer?: Maybe<Racer>;
  createAward: Award;
  createInitialConfig: InitialConfigStatus;
  createPracticeRace: Race;
  createRace: Race;
  createRacer: Racer;
  createRacingGroup: RacingGroup;
  createRound: Array<Round>;
  createRoundWizard: Array<Round>;
  createRunOffHeat: RunOffHeat;
  createTrack: Track;
  createTrackRecord: HistoricalTrackRecord;
  deleteAward: Scalars['Boolean']['output'];
  deleteFreeRaceHeat: Scalars['Boolean']['output'];
  deleteHeat: Scalars['Boolean']['output'];
  deleteRace: Scalars['Boolean']['output'];
  deleteRacer: Scalars['Boolean']['output'];
  deleteRacingGroup: Scalars['Boolean']['output'];
  deleteRound: Scalars['Boolean']['output'];
  deleteRunOffHeat: Scalars['Boolean']['output'];
  deleteTrack: Scalars['Boolean']['output'];
  deleteTrackRecord: Scalars['Boolean']['output'];
  fakeTimerFinish: Scalars['Boolean']['output'];
  fakeTimerStart: Scalars['Boolean']['output'];
  forceResults: Scalars['Boolean']['output'];
  forgetDisplay: Scalars['Boolean']['output'];
  identifyDisplay?: Maybe<Display>;
  importRacers: Scalars['Int']['output'];
  populateRace: Scalars['String']['output'];
  prepareHeat: Scalars['Boolean']['output'];
  reconnectTimer: Scalars['Boolean']['output'];
  recordFreeRaceResult?: Maybe<FreeRaceHeat>;
  regenerateRound: Array<Heat>;
  releaseStartGate?: Maybe<Scalars['String']['output']>;
  renameDisplay?: Maybe<Display>;
  reorderAwards: Array<Award>;
  reorderHeats: HeatReorderResponse;
  resetTimer: Scalars['Boolean']['output'];
  setLaneOutages: Array<Scalars['Int']['output']>;
  startFreeRaceHeat: FreeRaceHeat;
  startTimerTest: Scalars['Boolean']['output'];
  updateAward?: Maybe<Award>;
  updateHeatResult?: Maybe<Heat>;
  updateInitialConfig: InitialConfigStatus;
  updateRace?: Maybe<Race>;
  updateRacer?: Maybe<Racer>;
  updateRacingGroup?: Maybe<RacingGroup>;
  updateTrack?: Maybe<Track>;
  updateTrackRecord: HistoricalTrackRecord;
  uploadImage: Scalars['String']['output'];
};


export type MutationAbortHeatArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationAdvanceDisplayArgs = {
  delta: Scalars['Int']['input'];
  displayId: Scalars['String']['input'];
};


export type MutationAdvanceRoundArgs = {
  raceId: Scalars['Int']['input'];
  roundId: Scalars['Int']['input'];
};


export type MutationApplyMasterRunningOrderArgs = {
  raceId: Scalars['Int']['input'];
};


export type MutationAssignDisplayArgs = {
  cycleSeconds?: InputMaybe<Scalars['Int']['input']>;
  displayId: Scalars['String']['input'];
  view: DisplayView;
};


export type MutationBulkAssignPhotosArgs = {
  assignments: Array<PhotoAssignmentInput>;
};


export type MutationBulkAutoNumberArgs = {
  racerIds: Array<Scalars['Int']['input']>;
};


export type MutationBulkCheckInArgs = {
  passedInspection?: Scalars['Boolean']['input'];
  racerIds: Array<Scalars['Int']['input']>;
};


export type MutationBulkClearNumbersArgs = {
  racerIds: Array<Scalars['Int']['input']>;
};


export type MutationBulkDeleteRacersArgs = {
  racerIds: Array<Scalars['Int']['input']>;
};


export type MutationBulkMoveToRacingGroupArgs = {
  racerIds: Array<Scalars['Int']['input']>;
  racingGroupId?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationBulkSetExcludedFromStandingsArgs = {
  excluded?: Scalars['Boolean']['input'];
  racerIds: Array<Scalars['Int']['input']>;
};


export type MutationCastVoteArgs = {
  awardId: Scalars['Int']['input'];
  ballotKey: Scalars['String']['input'];
  racerId: Scalars['Int']['input'];
};


export type MutationCheckInRacerArgs = {
  carImageUrl?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['Int']['input'];
  passedInspection: Scalars['Boolean']['input'];
  racerImageUrl?: InputMaybe<Scalars['String']['input']>;
  weight?: InputMaybe<Scalars['Float']['input']>;
};


export type MutationCreateAwardArgs = {
  award: AwardInput;
  raceId: Scalars['Int']['input'];
};


export type MutationCreateInitialConfigArgs = {
  config: InitialConfigInput;
};


export type MutationCreatePracticeRaceArgs = {
  startNew?: Scalars['Boolean']['input'];
};


export type MutationCreateRaceArgs = {
  race: RaceInput;
};


export type MutationCreateRacerArgs = {
  racer: RacerInput;
};


export type MutationCreateRacingGroupArgs = {
  raceId: Scalars['Int']['input'];
  racingGroup: RacingGroupInput;
};


export type MutationCreateRoundArgs = {
  raceId: Scalars['Int']['input'];
  roundData: RoundCreateInput;
};


export type MutationCreateRoundWizardArgs = {
  config: WizardConfigurationInput;
  raceId: Scalars['Int']['input'];
};


export type MutationCreateRunOffHeatArgs = {
  raceId: Scalars['Int']['input'];
  racerIds: Array<Scalars['Int']['input']>;
  settlesRoundId?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationCreateTrackArgs = {
  track: TrackInput;
};


export type MutationCreateTrackRecordArgs = {
  record: HistoricalTrackRecordInput;
  trackId: Scalars['Int']['input'];
};


export type MutationDeleteAwardArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteFreeRaceHeatArgs = {
  heatId: Scalars['Int']['input'];
};


export type MutationDeleteHeatArgs = {
  heatId: Scalars['Int']['input'];
};


export type MutationDeleteRaceArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteRacerArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteRacingGroupArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteRoundArgs = {
  roundId: Scalars['Int']['input'];
};


export type MutationDeleteRunOffHeatArgs = {
  heatId: Scalars['Int']['input'];
};


export type MutationDeleteTrackArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteTrackRecordArgs = {
  recordId: Scalars['Int']['input'];
};


export type MutationFakeTimerFinishArgs = {
  heatId: Scalars['Int']['input'];
  isFreeRace?: Scalars['Boolean']['input'];
};


export type MutationFakeTimerStartArgs = {
  heatId: Scalars['Int']['input'];
  isFreeRace?: Scalars['Boolean']['input'];
};


export type MutationForceResultsArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationForgetDisplayArgs = {
  displayId: Scalars['String']['input'];
};


export type MutationIdentifyDisplayArgs = {
  displayId: Scalars['String']['input'];
};


export type MutationImportRacersArgs = {
  csvData: Scalars['String']['input'];
  raceId: Scalars['Int']['input'];
};


export type MutationPopulateRaceArgs = {
  config: PopulateTestDataInput;
  raceId: Scalars['Int']['input'];
};


export type MutationPrepareHeatArgs = {
  heatId: Scalars['Int']['input'];
  isFreeRace?: Scalars['Boolean']['input'];
};


export type MutationReconnectTimerArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationRecordFreeRaceResultArgs = {
  heatId: Scalars['Int']['input'];
  lanes: Array<HeatLaneInput>;
};


export type MutationRegenerateRoundArgs = {
  roundId: Scalars['Int']['input'];
};


export type MutationReleaseStartGateArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationRenameDisplayArgs = {
  displayId: Scalars['String']['input'];
  name: Scalars['String']['input'];
};


export type MutationReorderAwardsArgs = {
  awardIds: Array<Scalars['Int']['input']>;
  raceId: Scalars['Int']['input'];
};


export type MutationReorderHeatsArgs = {
  heatUpdates: Array<HeatReorderItemInput>;
};


export type MutationResetTimerArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationSetLaneOutagesArgs = {
  lanes: Array<Scalars['Int']['input']>;
  trackId: Scalars['Int']['input'];
};


export type MutationStartFreeRaceHeatArgs = {
  laneAssignments: Array<FreeRaceLaneAssignmentInput>;
  raceId: Scalars['Int']['input'];
};


export type MutationStartTimerTestArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationUpdateAwardArgs = {
  award: AwardInput;
  id: Scalars['Int']['input'];
};


export type MutationUpdateHeatResultArgs = {
  heatId: Scalars['Int']['input'];
  lanes: Array<HeatLaneInput>;
};


export type MutationUpdateInitialConfigArgs = {
  config: InitialConfigInput;
};


export type MutationUpdateRaceArgs = {
  id: Scalars['Int']['input'];
  race: RaceUpdateInput;
};


export type MutationUpdateRacerArgs = {
  id: Scalars['Int']['input'];
  racer: RacerInput;
};


export type MutationUpdateRacingGroupArgs = {
  id: Scalars['Int']['input'];
  racingGroup: RacingGroupInput;
};


export type MutationUpdateTrackArgs = {
  id: Scalars['Int']['input'];
  track: TrackInput;
};


export type MutationUpdateTrackRecordArgs = {
  record: HistoricalTrackRecordInput;
  recordId: Scalars['Int']['input'];
};


export type MutationUploadImageArgs = {
  dataUrl: Scalars['String']['input'];
};

export type Organization = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  nameDisplay?: Maybe<Scalars['String']['output']>;
  organizationPlural?: Maybe<Scalars['String']['output']>;
  organizationSingular?: Maybe<Scalars['String']['output']>;
  races: Array<Race>;
  racingGroupPlural?: Maybe<Scalars['String']['output']>;
  racingGroupSingular?: Maybe<Scalars['String']['output']>;
  resolvedNameDisplay: Scalars['String']['output'];
  terminology: Terminology;
  vehicleArtworkKey?: Maybe<Scalars['String']['output']>;
  vehiclePlural?: Maybe<Scalars['String']['output']>;
  vehicleSingular?: Maybe<Scalars['String']['output']>;
};

export type PhotoAssignmentInput = {
  photoType: Scalars['String']['input'];
  racerId: Scalars['Int']['input'];
  url: Scalars['String']['input'];
};

export type PopulateTestDataInput = {
  addCarPhotos?: Scalars['Boolean']['input'];
  addRacerPhotos?: Scalars['Boolean']['input'];
  assignRacingGroups?: Scalars['Boolean']['input'];
  checkIn?: Scalars['Boolean']['input'];
  count?: Scalars['Int']['input'];
};

export type Query = {
  activeFreeRaceHeat?: Maybe<FreeRaceHeat>;
  advancementStatus: AdvancementStatus;
  auditLog: Array<AuditLogEntry>;
  displays: Array<Display>;
  freeRaceHeats: Array<FreeRaceHeat>;
  heatSession: HeatSession;
  initialConfig: InitialConfigStatus;
  networkAddresses: Array<Scalars['String']['output']>;
  organizations: Array<Organization>;
  practiceRace?: Maybe<Race>;
  race?: Maybe<Race>;
  raceStats?: Maybe<RaceStats>;
  racer?: Maybe<Racer>;
  racers: Array<Racer>;
  races: Array<Race>;
  randomFreeRaceLanes: Array<FreeRaceLaneAssignment>;
  rounds: Array<Round>;
  suggestDisplayName: Scalars['String']['output'];
  timerModels: Array<TimerModel>;
  timerStatus?: Maybe<TimerStatus>;
  tracks: Array<Track>;
  version: Scalars['String']['output'];
};


export type QueryActiveFreeRaceHeatArgs = {
  raceId: Scalars['Int']['input'];
};


export type QueryAdvancementStatusArgs = {
  raceId: Scalars['Int']['input'];
  roundId: Scalars['Int']['input'];
};


export type QueryAuditLogArgs = {
  beforeId?: InputMaybe<Scalars['Int']['input']>;
  limit?: Scalars['Int']['input'];
  raceId?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDisplaysArgs = {
  raceId: Scalars['Int']['input'];
};


export type QueryFreeRaceHeatsArgs = {
  limit?: Scalars['Int']['input'];
  raceId: Scalars['Int']['input'];
};


export type QueryHeatSessionArgs = {
  heatId?: InputMaybe<Scalars['Int']['input']>;
  trackId: Scalars['Int']['input'];
};


export type QueryRaceArgs = {
  raceId: Scalars['Int']['input'];
};


export type QueryRaceStatsArgs = {
  raceId: Scalars['Int']['input'];
};


export type QueryRacerArgs = {
  racerId: Scalars['Int']['input'];
};


export type QueryRacersArgs = {
  limit?: Scalars['Int']['input'];
  raceId?: InputMaybe<Scalars['Int']['input']>;
  skip?: Scalars['Int']['input'];
};


export type QueryRacesArgs = {
  limit?: Scalars['Int']['input'];
  skip?: Scalars['Int']['input'];
};


export type QueryRandomFreeRaceLanesArgs = {
  enabledLanes?: InputMaybe<Array<Scalars['Int']['input']>>;
  raceId: Scalars['Int']['input'];
  shuffle?: Scalars['Int']['input'];
};


export type QueryRoundsArgs = {
  raceId: Scalars['Int']['input'];
};


export type QuerySuggestDisplayNameArgs = {
  avoid?: InputMaybe<Scalars['String']['input']>;
  displayId: Scalars['String']['input'];
};


export type QueryTimerStatusArgs = {
  trackId: Scalars['Int']['input'];
};

export type Race = {
  autoAdvanceHeat: Scalars['Boolean']['output'];
  awards: Array<Award>;
  carNumberingStrategy: Scalars['String']['output'];
  championshipTrophies: Scalars['Int']['output'];
  checkedInCount: Scalars['Int']['output'];
  dateTime?: Maybe<Scalars['String']['output']>;
  dropWorstRuns: Scalars['Int']['output'];
  excludeRoundWinnersFromQualifyingStandings: Scalars['Boolean']['output'];
  globalStartNumber: Scalars['Int']['output'];
  heats: Array<Heat>;
  id: Scalars['Int']['output'];
  leaderboard: Array<LeaderboardEntry>;
  location?: Maybe<Scalars['String']['output']>;
  masterRunningOrder: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nameDisplay?: Maybe<Scalars['String']['output']>;
  organization: Organization;
  organizationId: Scalars['Int']['output'];
  organizationPlural?: Maybe<Scalars['String']['output']>;
  organizationSingular?: Maybe<Scalars['String']['output']>;
  racers: Array<Racer>;
  racingGroupPlural?: Maybe<Scalars['String']['output']>;
  racingGroupSingular?: Maybe<Scalars['String']['output']>;
  racingGroups: Array<RacingGroup>;
  registeredCount: Scalars['Int']['output'];
  resolvedNameDisplay: Scalars['String']['output'];
  rounds: Array<Round>;
  runOffHeats: Array<RunOffHeat>;
  scheduledRacerIds: Array<Scalars['Int']['output']>;
  scoringStrategy: Scalars['String']['output'];
  terminology: Terminology;
  tiebreaker: Scalars['String']['output'];
  track?: Maybe<Track>;
  trackId?: Maybe<Scalars['Int']['output']>;
  vehicleArtworkKey?: Maybe<Scalars['String']['output']>;
  vehiclePlural?: Maybe<Scalars['String']['output']>;
  vehicleSingular?: Maybe<Scalars['String']['output']>;
  votingOpen: Scalars['Boolean']['output'];
  weightLimitOz?: Maybe<Scalars['Float']['output']>;
};


export type RaceLeaderboardArgs = {
  includeAllRounds?: Scalars['Boolean']['input'];
  roundId?: InputMaybe<Scalars['Int']['input']>;
};

export type RaceChangeKind =
  | 'HEAT_RESULT'
  | 'OTHER'
  | 'RACER'
  | 'RACE_SETTINGS'
  | 'ROSTER'
  | 'SCHEDULE';

export type RaceInput = {
  carNumberingStrategy?: Scalars['String']['input'];
  championshipTrophies?: Scalars['Int']['input'];
  dateTime?: InputMaybe<Scalars['String']['input']>;
  dropWorstRuns?: Scalars['Int']['input'];
  globalStartNumber?: Scalars['Int']['input'];
  location?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  organizationId?: Scalars['Int']['input'];
  scoringStrategy?: Scalars['String']['input'];
  tiebreaker?: Scalars['String']['input'];
  trackId: Scalars['Int']['input'];
  weightLimitOz?: InputMaybe<Scalars['Float']['input']>;
};

export type RaceStateChangedEvent = {
  changedAt: Scalars['String']['output'];
  heat?: Maybe<Heat>;
  kind: RaceChangeKind;
  raceId: Scalars['Int']['output'];
  racer?: Maybe<Racer>;
  roundId?: Maybe<Scalars['Int']['output']>;
};

export type RaceStats = {
  heatResults: Array<HeatResultRow>;
  highlights: Array<HeatHighlight>;
  laneStats: Array<LaneTimeStat>;
  raceId: Scalars['Int']['output'];
  raceName: Scalars['String']['output'];
  racerStats: Array<RacerStat>;
  racingGroupStats: Array<RacingGroupStat>;
  scoringStrategy: Scalars['String']['output'];
  totalHeatsCompleted: Scalars['Int']['output'];
  totalHeatsScheduled: Scalars['Int']['output'];
  totalRacers: Scalars['Int']['output'];
  trackRecords: Array<TrackRecord>;
};

export type RaceUpdateInput = {
  autoAdvanceHeat?: InputMaybe<Scalars['Boolean']['input']>;
  carNumberingStrategy?: InputMaybe<Scalars['String']['input']>;
  championshipTrophies?: InputMaybe<Scalars['Int']['input']>;
  clearNameDisplay?: Scalars['Boolean']['input'];
  clearTerminology?: Scalars['Boolean']['input'];
  clearWeightLimit?: Scalars['Boolean']['input'];
  dateTime?: InputMaybe<Scalars['String']['input']>;
  dropWorstRuns?: InputMaybe<Scalars['Int']['input']>;
  excludeRoundWinnersFromQualifyingStandings?: InputMaybe<Scalars['Boolean']['input']>;
  globalStartNumber?: InputMaybe<Scalars['Int']['input']>;
  location?: InputMaybe<Scalars['String']['input']>;
  masterRunningOrder?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nameDisplay?: InputMaybe<Scalars['String']['input']>;
  organizationPlural?: InputMaybe<Scalars['String']['input']>;
  organizationSingular?: InputMaybe<Scalars['String']['input']>;
  racingGroupPlural?: InputMaybe<Scalars['String']['input']>;
  racingGroupSingular?: InputMaybe<Scalars['String']['input']>;
  scoringStrategy?: InputMaybe<Scalars['String']['input']>;
  tiebreaker?: InputMaybe<Scalars['String']['input']>;
  trackId?: InputMaybe<Scalars['Int']['input']>;
  vehicleArtworkKey?: InputMaybe<Scalars['String']['input']>;
  vehiclePlural?: InputMaybe<Scalars['String']['input']>;
  vehicleSingular?: InputMaybe<Scalars['String']['input']>;
  votingOpen?: InputMaybe<Scalars['Boolean']['input']>;
  weightLimitOz?: InputMaybe<Scalars['Float']['input']>;
};

export type Racer = {
  carImageUrl?: Maybe<Scalars['String']['output']>;
  carName?: Maybe<Scalars['String']['output']>;
  carNumber?: Maybe<Scalars['Int']['output']>;
  carPassedInspection: Scalars['Boolean']['output'];
  carWeight?: Maybe<Scalars['Float']['output']>;
  excludedFromStandings: Scalars['Boolean']['output'];
  firstName: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  lastName: Scalars['String']['output'];
  raceId: Scalars['Int']['output'];
  racerImageUrl?: Maybe<Scalars['String']['output']>;
  racingGroup?: Maybe<RacingGroup>;
  racingGroupId?: Maybe<Scalars['Int']['output']>;
};

export type RacerInput = {
  carImageUrl?: InputMaybe<Scalars['String']['input']>;
  carName?: InputMaybe<Scalars['String']['input']>;
  carNumber?: InputMaybe<Scalars['Int']['input']>;
  carPassedInspection?: Scalars['Boolean']['input'];
  carWeight?: InputMaybe<Scalars['Float']['input']>;
  excludedFromStandings?: Scalars['Boolean']['input'];
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  raceId?: InputMaybe<Scalars['Int']['input']>;
  racerImageUrl?: InputMaybe<Scalars['String']['input']>;
  racingGroupId?: InputMaybe<Scalars['Int']['input']>;
};

export type RacerStat = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  firstName: Scalars['String']['output'];
  heatsCompleted: Scalars['Int']['output'];
  heatsScheduled: Scalars['Int']['output'];
  lastName: Scalars['String']['output'];
  maxTime?: Maybe<Scalars['Float']['output']>;
  meanTime?: Maybe<Scalars['Float']['output']>;
  minTime?: Maybe<Scalars['Float']['output']>;
  racerId: Scalars['Int']['output'];
  racingGroupName: Scalars['String']['output'];
  stdDev?: Maybe<Scalars['Float']['output']>;
  timesPerLane: Array<TimesPerLane>;
};

export type RacingGroup = {
  carNumberRangeEnd?: Maybe<Scalars['Int']['output']>;
  carNumberRangeStart?: Maybe<Scalars['Int']['output']>;
  color: Scalars['String']['output'];
  division?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  raceId: Scalars['Int']['output'];
  racers: Array<Racer>;
};

export type RacingGroupInput = {
  carNumberRangeEnd?: InputMaybe<Scalars['Int']['input']>;
  carNumberRangeStart?: InputMaybe<Scalars['Int']['input']>;
  color?: Scalars['String']['input'];
  division?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};

export type RacingGroupStat = {
  avgScore?: Maybe<Scalars['Float']['output']>;
  bestRacerName?: Maybe<Scalars['String']['output']>;
  racerCount: Scalars['Int']['output'];
  racingGroupColor: Scalars['String']['output'];
  racingGroupId: Scalars['Int']['output'];
  racingGroupName: Scalars['String']['output'];
};

export type Round = {
  advancementFromBottom: Scalars['Boolean']['output'];
  advancementNumRacers?: Maybe<Scalars['Int']['output']>;
  advancementSource?: Maybe<Scalars['String']['output']>;
  advancementStatus: AdvancementStatus;
  balancedPhases?: Maybe<Scalars['Int']['output']>;
  disrupted: Scalars['Boolean']['output'];
  eliminationLosses?: Maybe<Scalars['Int']['output']>;
  heats: Array<Heat>;
  id: Scalars['Int']['output'];
  name?: Maybe<Scalars['String']['output']>;
  raceId: Scalars['Int']['output'];
  racingGroupId?: Maybe<Scalars['Int']['output']>;
  roundNumber: Scalars['Int']['output'];
  schedulingStrategy: Scalars['String']['output'];
};

export type RoundCreateInput = {
  advancementFromBottom?: Scalars['Boolean']['input'];
  advancementNumRacers?: InputMaybe<Scalars['Int']['input']>;
  advancementSource?: InputMaybe<Scalars['String']['input']>;
  balancedPhases?: InputMaybe<Scalars['Int']['input']>;
  eliminationLosses?: InputMaybe<Scalars['Int']['input']>;
  generalType?: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  runsPerLane?: Scalars['Int']['input'];
  schedulingStrategy?: Scalars['String']['input'];
};

export type RunOffHeat = {
  createdAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  lanes: Array<HeatLane>;
  placement?: Maybe<Scalars['Int']['output']>;
  raceId: Scalars['Int']['output'];
  recorded: Scalars['Boolean']['output'];
  settlesRoundId?: Maybe<Scalars['Int']['output']>;
};

export type SerialLogEntry = {
  data: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  timestamp: Scalars['String']['output'];
};

export type Subscription = {
  activeFreeRaceHeat?: Maybe<FreeRaceHeat>;
  currentlyRacing?: Maybe<Heat>;
  displayAssignment: Display;
  displays: Array<Display>;
  freeRaceHeat?: Maybe<FreeRaceHeat>;
  heatSession: HeatSession;
  heats: Array<Round>;
  leaderboard: Array<LeaderboardEntry>;
  onDeck: Array<Heat>;
  raceStateChanged: RaceStateChangedEvent;
  racesChanged: Scalars['Boolean']['output'];
  timerStatus: TimerStateChangedEvent;
  timingStats?: Maybe<TimingStats>;
};


export type SubscriptionActiveFreeRaceHeatArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionCurrentlyRacingArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionDisplayAssignmentArgs = {
  displayId: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  raceId: Scalars['Int']['input'];
};


export type SubscriptionDisplaysArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionFreeRaceHeatArgs = {
  heatId: Scalars['Int']['input'];
};


export type SubscriptionHeatSessionArgs = {
  heatId?: InputMaybe<Scalars['Int']['input']>;
  trackId: Scalars['Int']['input'];
};


export type SubscriptionHeatsArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionLeaderboardArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionOnDeckArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionRaceStateChangedArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionTimerStatusArgs = {
  trackId: Scalars['Int']['input'];
};


export type SubscriptionTimingStatsArgs = {
  raceId: Scalars['Int']['input'];
};

export type Terminology = {
  organizationPlural: Scalars['String']['output'];
  organizationSingular: Scalars['String']['output'];
  racingGroupPlural: Scalars['String']['output'];
  racingGroupSingular: Scalars['String']['output'];
  vehicleArtworkKey: Scalars['String']['output'];
  vehiclePlural: Scalars['String']['output'];
  vehicleSingular: Scalars['String']['output'];
};

export type TimerModel = {
  baudRate: Scalars['Int']['output'];
  dataBits: Scalars['Int']['output'];
  detectable: Scalars['Boolean']['output'];
  key: Scalars['String']['output'];
  name: Scalars['String']['output'];
  parity: Scalars['String']['output'];
  provenance: Scalars['String']['output'];
  stopBits: Scalars['Float']['output'];
};

export type TimerStateChangedEvent = {
  changedAt: Scalars['String']['output'];
  status: TimerStatus;
  trackId: Scalars['Int']['output'];
};

export type TimerStatus = {
  activeHeatId?: Maybe<Scalars['Int']['output']>;
  canRemoteStart: Scalars['Boolean']['output'];
  deviceName?: Maybe<Scalars['String']['output']>;
  deviceProvenance?: Maybe<Scalars['String']['output']>;
  hasCountdownClock: Scalars['Boolean']['output'];
  hasPhotoFinishTrigger: Scalars['Boolean']['output'];
  indicatesTimingStarted: Scalars['Boolean']['output'];
  laneCount?: Maybe<Scalars['Int']['output']>;
  lastError?: Maybe<Scalars['String']['output']>;
  pendingResults: Array<LaneResult>;
  port?: Maybe<Scalars['String']['output']>;
  racerByLane?: Maybe<Scalars['String']['output']>;
  serialLog: Array<SerialLogEntry>;
  state: Scalars['String']['output'];
  testRun: Scalars['Boolean']['output'];
};

export type TimesPerLane = {
  avgTime?: Maybe<Scalars['Float']['output']>;
  lane: Scalars['Int']['output'];
};

export type TimingStats = {
  globalHeatNumber: Scalars['Int']['output'];
  heatId: Scalars['Int']['output'];
  heatNumber: Scalars['Int']['output'];
  lanes: Array<TimingStatsLane>;
  recordBreak?: Maybe<TrackRecordBreak>;
  recordedAt?: Maybe<Scalars['String']['output']>;
  roundName: Scalars['String']['output'];
};

export type TimingStatsLane = {
  carName?: Maybe<Scalars['String']['output']>;
  laneNumber: Scalars['Int']['output'];
  place?: Maybe<Scalars['Int']['output']>;
  racerImageUrl?: Maybe<Scalars['String']['output']>;
  racerName: Scalars['String']['output'];
  time?: Maybe<Scalars['Float']['output']>;
};

export type Track = {
  historicalRecords: Array<HistoricalTrackRecord>;
  id: Scalars['Int']['output'];
  laneCount: Scalars['Int']['output'];
  laneOutages: Array<Scalars['Int']['output']>;
  lengthFeet?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  races: Array<Race>;
  remoteStartInstalled: Scalars['Boolean']['output'];
  reverseLanes: Scalars['Boolean']['output'];
  scaleRatio: Scalars['Float']['output'];
  serialPort?: Maybe<Scalars['String']['output']>;
  showScaleSpeed: Scalars['Boolean']['output'];
  timerProfile?: Maybe<Scalars['String']['output']>;
  timerType: Scalars['String']['output'];
};

export type TrackInput = {
  id?: InputMaybe<Scalars['Int']['input']>;
  laneCount?: Scalars['Int']['input'];
  lengthFeet?: InputMaybe<Scalars['Int']['input']>;
  name?: Scalars['String']['input'];
  remoteStartInstalled?: Scalars['Boolean']['input'];
  reverseLanes?: Scalars['Boolean']['input'];
  scaleRatio?: Scalars['Float']['input'];
  serialPort?: InputMaybe<Scalars['String']['input']>;
  showScaleSpeed?: Scalars['Boolean']['input'];
  timerProfile?: InputMaybe<Scalars['String']['input']>;
  timerType?: Scalars['String']['input'];
};

export type TrackRecord = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  raceDate?: Maybe<Scalars['String']['output']>;
  raceId?: Maybe<Scalars['Int']['output']>;
  raceName?: Maybe<Scalars['String']['output']>;
  racerName: Scalars['String']['output'];
  timeSeconds: Scalars['Float']['output'];
};

export type TrackRecordBreak = {
  newHolder: Scalars['String']['output'];
  newSeconds: Scalars['Float']['output'];
  previousHolder: Scalars['String']['output'];
  previousRaceName?: Maybe<Scalars['String']['output']>;
  previousSeconds: Scalars['Float']['output'];
};

export type WizardChampionshipRoundInput = {
  name?: Scalars['String']['input'];
  numTopRacers?: Scalars['Int']['input'];
  runsPerLane?: Scalars['Int']['input'];
  source?: Scalars['String']['input'];
};

export type WizardConfigurationInput = {
  championshipRounds: Array<WizardChampionshipRoundInput>;
  generalRound: WizardGeneralRoundInput;
};

export type WizardGeneralRoundInput = {
  runsPerLane?: Scalars['Int']['input'];
  type: Scalars['String']['input'];
};
