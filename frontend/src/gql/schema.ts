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
  denName: Scalars['String']['output'];
  firstName: Scalars['String']['output'];
  isAdvancing: Scalars['Boolean']['output'];
  lastName: Scalars['String']['output'];
  racerId: Scalars['Int']['output'];
  rank: Scalars['Int']['output'];
  score: Scalars['Float']['output'];
};

export type AdvancementStatus = {
  advancingRacers: Array<AdvancementRacer>;
  alreadyAdvanced: Scalars['Boolean']['output'];
  isReady: Scalars['Boolean']['output'];
  numRacers?: Maybe<Scalars['Int']['output']>;
  requiresAdvancement: Scalars['Boolean']['output'];
  source?: Maybe<Scalars['String']['output']>;
};

export type Den = {
  carNumberRangeEnd?: Maybe<Scalars['Int']['output']>;
  carNumberRangeStart?: Maybe<Scalars['Int']['output']>;
  color: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  raceId: Scalars['Int']['output'];
  racers: Array<Racer>;
  rank?: Maybe<Scalars['String']['output']>;
};

export type DenInput = {
  carNumberRangeEnd?: InputMaybe<Scalars['Int']['input']>;
  carNumberRangeStart?: InputMaybe<Scalars['Int']['input']>;
  color?: Scalars['String']['input'];
  name: Scalars['String']['input'];
  rank?: InputMaybe<Scalars['String']['input']>;
};

export type DenStat = {
  avgScore?: Maybe<Scalars['Float']['output']>;
  bestRacerName?: Maybe<Scalars['String']['output']>;
  denColor: Scalars['String']['output'];
  denId: Scalars['Int']['output'];
  denName: Scalars['String']['output'];
  racerCount: Scalars['Int']['output'];
};

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

export type Group = {
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  races: Array<Race>;
};

export type Heat = {
  globalHeatNumber: Scalars['Int']['output'];
  heatNumber: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  lanes: Array<HeatLane>;
  raceId: Scalars['Int']['output'];
  roundId: Scalars['Int']['output'];
  roundName?: Maybe<Scalars['String']['output']>;
  roundNumber: Scalars['Int']['output'];
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

export type InitialConfigInput = {
  debugMode?: Scalars['Boolean']['input'];
  groupName: Scalars['String']['input'];
  tracks: Array<TrackInput>;
};

export type InitialConfigStatus = {
  currentRaceId?: Maybe<Scalars['Int']['output']>;
  debugMode: Scalars['Boolean']['output'];
  groupName?: Maybe<Scalars['String']['output']>;
  initialized: Scalars['Boolean']['output'];
  tracks: Array<Track>;
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
  denId?: Maybe<Scalars['Int']['output']>;
  denName: Scalars['String']['output'];
  firstName: Scalars['String']['output'];
  heatsCompleted: Scalars['Int']['output'];
  lastName: Scalars['String']['output'];
  racerId: Scalars['Int']['output'];
  racerImageUrl?: Maybe<Scalars['String']['output']>;
  rank: Scalars['Int']['output'];
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
  advanceRound: Scalars['Int']['output'];
  bulkAssignPhotos: Scalars['Int']['output'];
  bulkAutoNumber: Scalars['Int']['output'];
  bulkCheckIn: Scalars['Boolean']['output'];
  bulkClearNumbers: Scalars['Boolean']['output'];
  bulkDeleteRacers: Scalars['Boolean']['output'];
  bulkMoveToDen: Scalars['Boolean']['output'];
  checkInRacer?: Maybe<Racer>;
  createDen: Den;
  createInitialConfig: InitialConfigStatus;
  createRace: Race;
  createRacer: Racer;
  createRound: Array<Round>;
  createRoundWizard: Array<Round>;
  createTrack: Track;
  deleteDen: Scalars['Boolean']['output'];
  deleteFreeRaceHeat: Scalars['Boolean']['output'];
  deleteHeat: Scalars['Boolean']['output'];
  deleteRace: Scalars['Boolean']['output'];
  deleteRacer: Scalars['Boolean']['output'];
  deleteRound: Scalars['Boolean']['output'];
  deleteTrack: Scalars['Boolean']['output'];
  fakeTimerFinish: Scalars['Boolean']['output'];
  fakeTimerStart: Scalars['Boolean']['output'];
  forceResults: Scalars['Boolean']['output'];
  importRacers: Scalars['Int']['output'];
  populateRace: Scalars['String']['output'];
  prepareHeat: Scalars['Boolean']['output'];
  reconnectTimer: Scalars['Boolean']['output'];
  recordFreeRaceResult?: Maybe<FreeRaceHeat>;
  regenerateRound: Array<Heat>;
  releaseStartGate?: Maybe<Scalars['String']['output']>;
  reorderHeats: HeatReorderResponse;
  resetTimer: Scalars['Boolean']['output'];
  startFreeRaceHeat: FreeRaceHeat;
  updateDen?: Maybe<Den>;
  updateHeatResult?: Maybe<Heat>;
  updateInitialConfig: InitialConfigStatus;
  updateRace?: Maybe<Race>;
  updateRacer?: Maybe<Racer>;
  updateTrack?: Maybe<Track>;
  uploadImage: Scalars['String']['output'];
};


export type MutationAbortHeatArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationAdvanceRoundArgs = {
  raceId: Scalars['Int']['input'];
  roundId: Scalars['Int']['input'];
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


export type MutationBulkMoveToDenArgs = {
  denId?: InputMaybe<Scalars['Int']['input']>;
  racerIds: Array<Scalars['Int']['input']>;
};


export type MutationCheckInRacerArgs = {
  carImageUrl?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['Int']['input'];
  passedInspection: Scalars['Boolean']['input'];
  racerImageUrl?: InputMaybe<Scalars['String']['input']>;
  weight?: InputMaybe<Scalars['Float']['input']>;
};


export type MutationCreateDenArgs = {
  den: DenInput;
  raceId: Scalars['Int']['input'];
};


export type MutationCreateInitialConfigArgs = {
  config: InitialConfigInput;
};


export type MutationCreateRaceArgs = {
  race: RaceInput;
};


export type MutationCreateRacerArgs = {
  racer: RacerInput;
};


export type MutationCreateRoundArgs = {
  raceId: Scalars['Int']['input'];
  roundData: RoundCreateInput;
};


export type MutationCreateRoundWizardArgs = {
  config: WizardConfigurationInput;
  raceId: Scalars['Int']['input'];
};


export type MutationCreateTrackArgs = {
  track: TrackInput;
};


export type MutationDeleteDenArgs = {
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


export type MutationDeleteRoundArgs = {
  roundId: Scalars['Int']['input'];
};


export type MutationDeleteTrackArgs = {
  id: Scalars['Int']['input'];
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


export type MutationReorderHeatsArgs = {
  heatUpdates: Array<HeatReorderItemInput>;
};


export type MutationResetTimerArgs = {
  trackId: Scalars['Int']['input'];
};


export type MutationStartFreeRaceHeatArgs = {
  laneAssignments: Array<FreeRaceLaneAssignmentInput>;
  raceId: Scalars['Int']['input'];
};


export type MutationUpdateDenArgs = {
  den: DenInput;
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


export type MutationUpdateTrackArgs = {
  id: Scalars['Int']['input'];
  track: TrackInput;
};


export type MutationUploadImageArgs = {
  dataUrl: Scalars['String']['input'];
};

export type PhotoAssignmentInput = {
  photoType: Scalars['String']['input'];
  racerId: Scalars['Int']['input'];
  url: Scalars['String']['input'];
};

export type PopulateTestDataInput = {
  addCarPhotos?: Scalars['Boolean']['input'];
  addRacerPhotos?: Scalars['Boolean']['input'];
  assignDens?: Scalars['Boolean']['input'];
  checkIn?: Scalars['Boolean']['input'];
  count?: Scalars['Int']['input'];
};

export type Query = {
  activeFreeRaceHeat?: Maybe<FreeRaceHeat>;
  advancementStatus: AdvancementStatus;
  freeRaceHeats: Array<FreeRaceHeat>;
  groups: Array<Group>;
  heatSession: HeatSession;
  initialConfig: InitialConfigStatus;
  race?: Maybe<Race>;
  raceStats?: Maybe<RaceStats>;
  racer?: Maybe<Racer>;
  racers: Array<Racer>;
  races: Array<Race>;
  randomFreeRaceLanes: Array<FreeRaceLaneAssignment>;
  rounds: Array<Round>;
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
  raceId: Scalars['Int']['input'];
};


export type QueryRoundsArgs = {
  raceId: Scalars['Int']['input'];
};


export type QueryTimerStatusArgs = {
  trackId: Scalars['Int']['input'];
};

export type Race = {
  autoAdvanceHeat: Scalars['Boolean']['output'];
  carNumberingStrategy: Scalars['String']['output'];
  championshipTrophies: Scalars['Int']['output'];
  checkedInCount: Scalars['Int']['output'];
  dateTime?: Maybe<Scalars['String']['output']>;
  dens: Array<Den>;
  globalStartNumber: Scalars['Int']['output'];
  group: Group;
  groupId: Scalars['Int']['output'];
  heats: Array<Heat>;
  id: Scalars['Int']['output'];
  leaderboard: Array<LeaderboardEntry>;
  location?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  racers: Array<Racer>;
  registeredCount: Scalars['Int']['output'];
  rounds: Array<Round>;
  scheduledRacerIds: Array<Scalars['Int']['output']>;
  scoringStrategy: Scalars['String']['output'];
  track?: Maybe<Track>;
  trackId?: Maybe<Scalars['Int']['output']>;
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
  globalStartNumber?: Scalars['Int']['input'];
  groupId?: Scalars['Int']['input'];
  location?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  scoringStrategy?: Scalars['String']['input'];
  trackId: Scalars['Int']['input'];
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
  denStats: Array<DenStat>;
  heatResults: Array<HeatResultRow>;
  highlights: Array<HeatHighlight>;
  laneStats: Array<LaneTimeStat>;
  raceId: Scalars['Int']['output'];
  raceName: Scalars['String']['output'];
  racerStats: Array<RacerStat>;
  scoringStrategy: Scalars['String']['output'];
  totalHeatsCompleted: Scalars['Int']['output'];
  totalHeatsScheduled: Scalars['Int']['output'];
  totalRacers: Scalars['Int']['output'];
};

export type RaceUpdateInput = {
  autoAdvanceHeat?: InputMaybe<Scalars['Boolean']['input']>;
  carNumberingStrategy?: InputMaybe<Scalars['String']['input']>;
  championshipTrophies?: InputMaybe<Scalars['Int']['input']>;
  dateTime?: InputMaybe<Scalars['String']['input']>;
  globalStartNumber?: InputMaybe<Scalars['Int']['input']>;
  location?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  scoringStrategy?: InputMaybe<Scalars['String']['input']>;
  trackId?: InputMaybe<Scalars['Int']['input']>;
};

export type Racer = {
  carImageUrl?: Maybe<Scalars['String']['output']>;
  carName?: Maybe<Scalars['String']['output']>;
  carNumber?: Maybe<Scalars['Int']['output']>;
  carPassedInspection: Scalars['Boolean']['output'];
  carWeight?: Maybe<Scalars['Float']['output']>;
  den?: Maybe<Den>;
  denId?: Maybe<Scalars['Int']['output']>;
  firstName: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  lastName: Scalars['String']['output'];
  raceId: Scalars['Int']['output'];
  racerImageUrl?: Maybe<Scalars['String']['output']>;
};

export type RacerInput = {
  carImageUrl?: InputMaybe<Scalars['String']['input']>;
  carName?: InputMaybe<Scalars['String']['input']>;
  carNumber?: InputMaybe<Scalars['Int']['input']>;
  carPassedInspection?: Scalars['Boolean']['input'];
  carWeight?: InputMaybe<Scalars['Float']['input']>;
  denId?: InputMaybe<Scalars['Int']['input']>;
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  raceId?: InputMaybe<Scalars['Int']['input']>;
  racerImageUrl?: InputMaybe<Scalars['String']['input']>;
};

export type RacerStat = {
  carNumber?: Maybe<Scalars['Int']['output']>;
  denName: Scalars['String']['output'];
  firstName: Scalars['String']['output'];
  heatsCompleted: Scalars['Int']['output'];
  heatsScheduled: Scalars['Int']['output'];
  lastName: Scalars['String']['output'];
  maxTime?: Maybe<Scalars['Float']['output']>;
  meanTime?: Maybe<Scalars['Float']['output']>;
  minTime?: Maybe<Scalars['Float']['output']>;
  racerId: Scalars['Int']['output'];
  stdDev?: Maybe<Scalars['Float']['output']>;
  timesPerLane: Array<TimesPerLane>;
};

export type Round = {
  advancementNumRacers?: Maybe<Scalars['Int']['output']>;
  advancementSource?: Maybe<Scalars['String']['output']>;
  advancementStatus: AdvancementStatus;
  heats: Array<Heat>;
  id: Scalars['Int']['output'];
  name?: Maybe<Scalars['String']['output']>;
  raceId: Scalars['Int']['output'];
  roundNumber: Scalars['Int']['output'];
  schedulingStrategy: Scalars['String']['output'];
};

export type RoundCreateInput = {
  advancementNumRacers?: InputMaybe<Scalars['Int']['input']>;
  advancementSource?: InputMaybe<Scalars['String']['input']>;
  generalType?: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  runsPerLane?: Scalars['Int']['input'];
  schedulingStrategy?: Scalars['String']['input'];
};

export type SerialLogEntry = {
  data: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  timestamp: Scalars['String']['output'];
};

export type Subscription = {
  activeFreeRaceHeat?: Maybe<FreeRaceHeat>;
  currentlyRacing?: Maybe<Heat>;
  freeRaceHeat?: Maybe<FreeRaceHeat>;
  heatSession: HeatSession;
  heats: Array<Round>;
  leaderboard: Array<LeaderboardEntry>;
  onDeck: Array<Racer>;
  raceStateChanged: RaceStateChangedEvent;
  timerStatus: TimerStateChangedEvent;
  timingStats?: Maybe<TimingStats>;
};


export type SubscriptionActiveFreeRaceHeatArgs = {
  raceId: Scalars['Int']['input'];
};


export type SubscriptionCurrentlyRacingArgs = {
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
  laneCount?: Maybe<Scalars['Int']['output']>;
  lastError?: Maybe<Scalars['String']['output']>;
  pendingResults: Array<LaneResult>;
  port?: Maybe<Scalars['String']['output']>;
  racerByLane?: Maybe<Scalars['String']['output']>;
  serialLog: Array<SerialLogEntry>;
  state: Scalars['String']['output'];
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
  id: Scalars['Int']['output'];
  laneCount: Scalars['Int']['output'];
  lengthFeet?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  races: Array<Race>;
  remoteStartInstalled: Scalars['Boolean']['output'];
  serialPort?: Maybe<Scalars['String']['output']>;
  timerType: Scalars['String']['output'];
};

export type TrackInput = {
  laneCount?: Scalars['Int']['input'];
  lengthFeet?: InputMaybe<Scalars['Int']['input']>;
  name?: Scalars['String']['input'];
  remoteStartInstalled?: Scalars['Boolean']['input'];
  serialPort?: InputMaybe<Scalars['String']['input']>;
  timerType?: Scalars['String']['input'];
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
