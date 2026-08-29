import { Fragment, useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';
import type { GetRaceDetailsQuery } from '../../../gql/operations';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';

import { useAlert } from '../../../context/AlertContext';

import { getContrastColor } from '../../../utils/colors';
import RacerForm, { RacerData, RacingGroup } from '../components/RacerForm';
import NoHeatsBadge from '../components/NoHeatsBadge';
import RacingGroupManager from '../components/RacingGroupManager';
import Modal from '../../../components/ui/Modal';
import RaceForm, { RaceFormData } from '../components/RaceForm';
import ImportRacersModal from '../components/ImportRacersModal';
import SetupChecklist from '../components/SetupChecklist';
import CheckInProgress from '../components/CheckInProgress';
import SortableHeader from '../components/SortableHeader';
import BulkPhotoUploadModal from '../components/BulkPhotoUploadModal';
import RacerAvatar from '../components/RacerAvatar';
import { Icon } from '@mdi/react';
import {
  mdiMagnify, mdiNumeric,
  mdiChevronDown, mdiLightningBolt, mdiFileUpload, mdiDotsHorizontal, mdiClose,
  mdiCheckDecagram, mdiPencil, mdiPlus, mdiAccountGroup, mdiCamera, mdiPrinter,
  mdiQrcodeScan
} from '@mdi/js';
import CheckInScanner from '../../printables/components/CheckInScanner';
import * as GQL from '../graphql/queries';
import { DEFAULT_SORT, nextSortState, sortRacers, type SortKey, type SortState } from '../rosterSort';
import { groupRacersByRacingGroup } from '../groupRacersByRacingGroup';

/**
 * The shapes the query actually returns, derived rather than restated.
 *
 * These were hand-written copies, and they had drifted: `carNumber` was
 * `number | string`, and every nullable field was declared optional rather than
 * nullable. A hand-written copy of a generated type agrees with the server
 * right up until the document changes, which is what `trackId` going missing
 * from this query demonstrated.
 */
type GQLRace = NonNullable<GetRaceDetailsQuery['race']>;
type GQLRacingGroup = GQLRace['racingGroups'][number];
type GQLRacer = GQLRace['racers'][number];

interface Race extends RaceFormData {
    id: number;
}

interface Racer extends RacerData {
  id: number;
}

export default function RaceDetails() {
  const { raceId } = useParams<{ raceId: string }>();
  const parsedRaceId = useMemo(() => raceId ? parseInt(raceId) : 0, [raceId]);
  const { showAlert, showConfirm } = useAlert();
  const navigate = useNavigate();

  // GraphQL Queries
  // Typed with the generated operation type on purpose. Untyped, `data` is
  // `any`, and reading a field the document does not select compiles happily
  // and is `undefined` at runtime — which is how `trackId` went missing from
  // this query and silently moved every edited race to the first track.
  const [raceDetailsResult, reexecuteRaceDetails] = useQuery<GetRaceDetailsQuery>({
    query: GQL.GET_RACE_DETAILS,
    variables: { raceId: parsedRaceId },
    pause: !parsedRaceId,
  });

  // Keep every open tab in sync; see useRaceStateChanged for which changes
  // still need a refetch.
  useRaceStateChanged(parsedRaceId, () =>
    reexecuteRaceDetails({ requestPolicy: 'network-only' })
  );

  const { data, fetching } = raceDetailsResult;

  // GraphQL Mutations
  const [, updateRaceMutation] = useMutation(GQL.UPDATE_RACE);
  const [, deleteRaceMutation] = useMutation(GQL.DELETE_RACE);
  const [, bulkAutoNumberMutation] = useMutation(GQL.BULK_AUTO_NUMBER);
  const [, bulkClearNumbersMutation] = useMutation(GQL.BULK_CLEAR_NUMBERS);
  const [, bulkCheckInMutation] = useMutation(GQL.BULK_CHECK_IN);
  const [, bulkMoveToRacingGroupMutation] = useMutation(GQL.BULK_MOVE_TO_RACING_GROUP);
  const [, bulkDeleteRacersMutation] = useMutation(GQL.BULK_DELETE_RACERS);
  const [, populateRaceMutation] = useMutation(GQL.POPULATE_RACE);

  // Mapped Data from Query
  const race = useMemo(() => {
    if (!data?.race) return null;
    return {
      id: data.race.id,
      name: data.race.name,
      // `RaceForm` drives controlled inputs from these, and React warns on a
      // null `value`. GraphQL sends null for an unset optional; the form's
      // vocabulary for the same thing is an empty string.
      date_time: data.race.dateTime ?? '',
      location: data.race.location ?? '',
      // Nullable in the schema: a race need not name a track. `RaceForm` reads
      // absence as "default to the first one", which is right when creating and
      // is exactly what made a *missing* value destructive when editing.
      track_id: data.race.trackId ?? undefined,
      scoring_strategy: data.race.scoringStrategy,
      car_numbering_strategy: data.race.carNumberingStrategy,
      global_start_number: data.race.globalStartNumber,
      championship_trophies: data.race.championshipTrophies,
      weight_limit_oz: data.race.weightLimitOz,
    } satisfies Race;
  }, [data]);

  const racers = useMemo<Racer[]>(() => {
    if (!data?.race?.racers) return [];
    return data.race.racers.map((r: GQLRacer) => ({
      id: r.id,
      first_name: r.firstName,
      last_name: r.lastName,
      car_number: r.carNumber ?? undefined,
      racing_group_id: r.racingGroupId ?? undefined,
      car_name: r.carName ?? undefined,
      car_passed_inspection: r.carPassedInspection,
      car_weight: r.carWeight ?? undefined,
      racer_image_url: r.racerImageUrl ?? undefined,
      car_image_url: r.carImageUrl ?? undefined,
    }));
  }, [data]);

  const racingGroups = useMemo<RacingGroup[]>(() => {
    if (!data?.race?.racingGroups) return [];
    return data.race.racingGroups.map((d: GQLRacingGroup) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      division: d.division ?? undefined,
      car_number_range_start: d.carNumberRangeStart ?? undefined,
      car_number_range_end: d.carNumberRangeEnd ?? undefined,
    }));
  }, [data]);

  const tracks = useMemo(() => data?.tracks || [], [data]);

  // Who is in a heat. Its emptiness doubles as "no round has been generated
  // yet", which is what keeps the "No heats" badge quiet while a roster is
  // still being built — before the first round, nobody is scheduled and
  // flagging everybody would say nothing.
  const scheduledRacerIds = useMemo(
    () => data?.race?.scheduledRacerIds ?? [],
    [data],
  );
  const anyHeatsScheduled = scheduledRacerIds.length > 0;

  // What the setup checklist reads (#199). Every number is one the page
  // already had, except the round count — see the query for why
  // `scheduledRacerIds` cannot stand in for it.
  const setupProgress = useMemo(
    () => ({
      racingGroupCount: data?.race?.racingGroups?.length ?? 0,
      racerCount: data?.race?.registeredCount ?? 0,
      checkedInCount: data?.race?.checkedInCount ?? 0,
      roundCount: data?.race?.rounds?.length ?? 0,
    }),
    [data],
  );

  const loading = fetching && !data;

  // Racer Form State
  const [showRacerForm, setShowRacerForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showRacingGroupManager, setShowRacingGroupManager] = useState(false);
  const [editingRacer, setEditingRacer] = useState<Racer | undefined>(undefined);
  const [racerFormTitle, setRacerFormTitle] = useState('Add New Racer');
  const [racerFormSubmitLabel, setRacerFormSubmitLabel] = useState('Save Racer');

  const [showBulkPhotoUpload, setShowBulkPhotoUpload] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Populate Modal
  const [showPopulateModal, setShowPopulateModal] = useState(false);
  const [populateCount, setPopulateCount] = useState(20);
  const [popAddRacerPhotos, setPopAddRacerPhotos] = useState(true);
  const [popAddCarPhotos, setPopAddCarPhotos] = useState(true);
  const [popAssignRacingGroups, setPopAssignRacingGroups] = useState(true);
  const [popCheckIn, setPopCheckIn] = useState(false);

  // Race Edit State
  const [isEditingRace, setIsEditingRace] = useState(false);

  // Roster View State
  const [isGroupedByRacingGroup, setIsGroupedByRacingGroup] = useState(false);
  const [isAddRacerDropdownOpen, setIsAddRacerDropdownOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isMoveToRacingGroupOpen, setIsMoveToRacingGroupOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // Selection State
  const [selectedRacerIds, setSelectedRacerIds] = useState<number[]>([]);

  // Handle click outside for dropdowns
  useEffect(() => {
    if (!isAddRacerDropdownOpen && !isMoreMenuOpen && !isMoveToRacingGroupOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Don't close if clicking the dropdown button or content
      if (target.closest('.dropdown') || target.classList.contains('split-btn-arrow')) {
        return;
      }
      setIsAddRacerDropdownOpen(false);
      setIsMoreMenuOpen(false);
      setIsMoveToRacingGroupOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddRacerDropdownOpen, isMoreMenuOpen, isMoveToRacingGroupOpen]);


  const refreshData = () => {
    reexecuteRaceDetails({ requestPolicy: 'network-only' });
  };

  const handleUpdateRace = async (formData: RaceFormData) => {
      try {
          const updateInput = formData;
          // Map snake_case to camelCase for GQL input
          const raceInput = {
              name: updateInput.name,
              dateTime: updateInput.date_time,
              location: updateInput.location,
              trackId: updateInput.track_id,
              scoringStrategy: updateInput.scoring_strategy,
              carNumberingStrategy: updateInput.car_numbering_strategy,
              globalStartNumber: updateInput.global_start_number,
              championshipTrophies: updateInput.championship_trophies,
              weightLimitOz: updateInput.weight_limit_oz ?? undefined,
              // Absent means "leave alone" for every field here, so turning
              // the weight check off has to be said explicitly (#205).
              clearWeightLimit: updateInput.weight_limit_oz == null,
          };
          const result = await updateRaceMutation({ id: parsedRaceId, race: raceInput });
          if (result.error) throw result.error;
          setIsEditingRace(false);
          refreshData();
      } catch (e: unknown) {
          console.error("Failed to update race", e);
          showAlert("Failed to update race details", "Error");
      }
  };

  const handleDeleteRace = async () => {
    const confirmed = await showConfirm(
        "Are you sure you want to delete this race?\n\nThis action cannot be undone and will delete all racers, racingGroups, rounds, heats, and results associated with it.",
        "Delete Race",
        "Delete",
        "danger"
    );

    if (!confirmed) {
        return;
    }

    try {
        const result = await deleteRaceMutation({ id: parsedRaceId });
        if (result.error) throw result.error;
        // Redirect to home
        window.location.href = '/';
    } catch (e: unknown) {
        console.error("Failed to delete race", e);
        showAlert("Failed to delete race", "Error");
    }
  };

  // Racer Actions
  const handleAddRacerClick = () => {
    setEditingRacer(undefined);
    setRacerFormTitle('Add New Racer');
    setRacerFormSubmitLabel('Save Racer');
    setShowRacerForm(true);
  };

  const handleCheckInClick = (racer: Racer) => {
      setEditingRacer(racer);
      setRacerFormTitle('Racer Check In');
      setRacerFormSubmitLabel('Save Check-in');
      setShowRacerForm(true);
  };

  // A scan identifies a racer; from there it is the same check-in the operator
  // would have reached by finding them in the roster.
  const handleScanned = (racerId: number) => {
      const racer = racers.find(r => r.id === racerId);
      if (!racer) return;
      setShowScanner(false);
      handleCheckInClick(racer);
  };

  const [, createRacerMutation] = useMutation(GQL.CREATE_RACER);
  const [, updateRacerMutation] = useMutation(GQL.UPDATE_RACER);

  const saveRacer = async (formData: RacerData) => {
      // Map snake_case to camelCase for GQL input
      const racerInput = {
          firstName: formData.first_name,
          lastName: formData.last_name,
          carNumber: formData.car_number,
          racingGroupId: formData.racing_group_id,
          carName: formData.car_name,
          carPassedInspection: formData.car_passed_inspection,
          carWeight: formData.car_weight,
          racerImageUrl: formData.racer_image_url,
          carImageUrl: formData.car_image_url,
          raceId: parsedRaceId
      };

      if (editingRacer) {
          const result = await updateRacerMutation({ id: editingRacer.id, racer: racerInput });
          if (result.error) throw result.error;
      } else {
          const result = await createRacerMutation({ racer: racerInput });
          if (result.error) throw result.error;
      }
      refreshData();
  };

  const handleRacerFormSubmit = async (formData: RacerData) => {
      try {
          await saveRacer(formData);
          setShowRacerForm(false);
      } catch (e: unknown) {
          console.error("Failed to save", e);
          showAlert("Failed to save racer", "Error");
      }
  };

  // "Save and add another" (#202). It rethrows where the ordinary save
  // swallows, because the form only clears itself on success — reporting a
  // failed save as done would throw away what the operator had typed.
  const handleRacerFormSubmitAndContinue = async (formData: RacerData) => {
      try {
          await saveRacer(formData);
      } catch (e: unknown) {
          console.error("Failed to save", e);
          showAlert("Failed to save racer", "Error");
          throw e;
      }
  };

  // Selection Handlers
  const toggleSelectAll = () => {
    if (selectedRacerIds.length === filteredRacers.length) {
      setSelectedRacerIds([]);
    } else {
      setSelectedRacerIds(filteredRacers.map(r => r.id));
    }
  };

  const toggleSelectRacer = (racerId: number) => {
    setSelectedRacerIds(prev =>
      prev.includes(racerId)
        ? prev.filter(id => id !== racerId)
        : [...prev, racerId]
    );
  };

  // Bulk Handlers
  //
  // The additive ones — auto-number, check in, move to racingGroup — leave the
  // selection standing after they succeed (#420). The desk works a queue:
  // select everyone, auto-number, then check in, and re-ticking select-all
  // between two clicks that both meant "these racers" is the friction the
  // selection bar exists to remove. Clear numbers and delete keep clearing
  // it — both remove data rather than adding to it, so a stale selection
  // there is a chance to repeat a destructive action by mistake rather than
  // a convenience.
  const handleBulkAutoNumber = async () => {
    try {
      const result = await bulkAutoNumberMutation({ racerIds: selectedRacerIds });
      if (result.error) throw result.error;
      refreshData();
      showAlert(`Successfully auto-numbered ${result.data.bulkAutoNumber} racers`, "Bulk Auto-Number Result");
    } catch {
      showAlert("Failed to bulk auto-number racers", "Error");
    }
  };

  const handleBulkClearNumbers = async () => {
    const confirmed = await showConfirm(
      `Are you sure you want to clear car numbers for ${selectedRacerIds.length} racers?`,
      "Clear Numbers",
      "Clear",
      "primary"
    );
    if (!confirmed) return;

    try {
      const result = await bulkClearNumbersMutation({ racerIds: selectedRacerIds });
      if (result.error) throw result.error;
      refreshData();
      setSelectedRacerIds([]);
    } catch {
      showAlert("Failed to clear racer numbers", "Error");
    }
  };

  const handleBulkCheckIn = async () => {
    const confirmed = await showConfirm(
      `Mark ${selectedRacerIds.length} racers as passed inspection and checked-in?`,
      "Bulk Check-In",
      "Check In",
      "primary"
    );
    if (!confirmed) return;

    try {
      const result = await bulkCheckInMutation({ racerIds: selectedRacerIds, passedInspection: true });
      if (result.error) throw result.error;
      refreshData();
      setIsMoreMenuOpen(false);
    } catch {
      showAlert("Failed to bulk check-in racers", "Error");
    }
  };

  const handleBulkMoveToRacingGroup = async (racingGroupId: number | null) => {
    try {
      const result = await bulkMoveToRacingGroupMutation({ racerIds: selectedRacerIds, racingGroupId });
      if (result.error) throw result.error;
      refreshData();
      setIsMoveToRacingGroupOpen(false);
      setIsMoreMenuOpen(false);
    } catch {
      showAlert("Failed to move racers to racingGroup", "Error");
    }
  };

  const handleBulkDelete = async () => {
    const scheduledSelected = selectedRacerIds.filter(id => scheduledRacerIds.includes(id));

    let message = `Are you sure you want to delete ${selectedRacerIds.length} racers? This action cannot be undone.`;
    if (scheduledSelected.length > 0) {
      message += "\n\nWARNING: Some selected racers are scheduled in heats. Affected unstarted rounds will be regenerated, and started heats will have empty lanes.";
    }

    const confirmed = await showConfirm(
      message,
      "Delete Racers",
      "Delete",
      "danger"
    );
    if (!confirmed) return;

    try {
      const result = await bulkDeleteRacersMutation({ racerIds: selectedRacerIds });
      if (result.error) throw result.error;
      refreshData();
      setSelectedRacerIds([]);
    } catch {
      showAlert("Failed to delete racers", "Error");
    }
  };

  // Sorted as well as filtered (#203). The API returns insertion order, which
  // is arbitrary to everyone except whoever typed it in; both the table and the
  // mobile cards read this, so there is one order rather than two.
  const filteredRacers = sortRacers(
    racers.filter(racer => {
        const searchLower = searchTerm.toLowerCase();
        const racingGroupName = racingGroups.find(d => d.id === racer.racing_group_id)?.name || '';

        return (
            (racer.first_name || '').toLowerCase().includes(searchLower) ||
            (racer.last_name || '').toLowerCase().includes(searchLower) ||
            (racer.car_number || '').toString().includes(searchLower) ||
            racingGroupName.toLowerCase().includes(searchLower)
        );
    }),
    racingGroups,
    sort,
  );

  const toggleSort = (key: SortKey) => setSort(current => nextSortState(current, key));

  // The grouped view, shared between the desktop table and the mobile cards
  // (#437) — both used to build this bucketing and sorting themselves, with
  // no test of either copy.
  const groupedRacers = useMemo(() => groupRacersByRacingGroup(filteredRacers, racingGroups), [filteredRacers, racingGroups]);

  const renderRacerCard = (racer: Racer) => {
    const racingGroup = racingGroups.find(d => d.id === racer.racing_group_id);
    const isSelected = selectedRacerIds.includes(racer.id);

    return (
      <div key={racer.id} className="racer-card" style={{
          backgroundColor: isSelected ? 'var(--surface-hover-color)' : 'var(--surface-color)',
          borderColor: isSelected ? 'var(--selection-accent-color)' : 'var(--divider-color)'
      }}>
              <div className="racer-card-header">
                  <RacerAvatar
                      racer={racer}
                      size="60px"
                      className="racer-card-photo"
                      style={{ marginRight: '15px' }}
                  />
              <div className="racer-card-name-group">
                  <span className="racer-card-name">{racer.first_name} {racer.last_name}</span>
                  <span className="racer-card-number">Car #{racer.car_number || '-'}</span>
              </div>
              <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelectRacer(racer.id)}
                  style={{ transform: 'scale(1.2)', marginLeft: '10px' }}
              />
          </div>

          <div className="racer-card-row">
              <span className="racer-card-label">Racing Group</span>
              <div className="racer-card-value">
                  {racer.racing_group_id ? (
                      <span style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: racingGroup?.color || 'var(--divider-color)',
                          color: getContrastColor(racingGroup?.color || '#eee'),
                          fontSize: '0.75rem',
                          fontWeight: 'bold'
                      }}>
                          {racingGroup?.name || 'Unknown'}
                      </span>
                  ) : '-'}
              </div>
          </div>

          <div className="racer-card-actions">
              <button
                  onClick={() => handleCheckInClick(racer)}
                  className="secondary-btn"
                  style={{
                      background: racer.car_passed_inspection ? 'var(--success-bg-color)' : 'var(--cub-scouting-gold)',
                      borderColor: racer.car_passed_inspection ? 'var(--success-accent-color)' : 'var(--border-color)',
                      color: racer.car_passed_inspection ? 'var(--success-color)' : 'var(--scouting-blue)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      flex: 1
                  }}
              >
                  {racer.car_passed_inspection ? (
                      <><Icon path={mdiCheckDecagram} size={0.7} /> Checked In / Edit</>
                  ) : (
                      'Check In'
                  )}
              </button>
              <NoHeatsBadge
                  racer={{ id: racer.id, carPassedInspection: racer.car_passed_inspection }}
                  scheduledRacerIds={scheduledRacerIds}
                  anyHeatsScheduled={anyHeatsScheduled}
              />
          </div>
      </div>
    );
  };

  if (loading && !race) return <p>Loading...</p>;

  return (
    <div className="container" style={{ padding: '2rem' }}>
      {/* What to do next, while anything is still outstanding (#199). It goes
          first because it is what a first-time operator needs before they need
          any of the settings below it, and it removes itself once the race is
          set up.

          This replaces a header row that had been left holding two spacer divs
          and nothing else when the per-page mode toggle was merged into the
          navigation — an empty bordered strip at the top of the page. */}
      <SetupChecklist
          progress={setupProgress}
          onAction={{
              racingGroups: () => setShowRacingGroupManager(true),
              racers: handleAddRacerClick,
              schedule: () => navigate(`/race/${parsedRaceId}/control`),
          }}
      />

      {/* Race Settings Summary (Read-Only for now, can be expanded) */}
      <div style={{ marginBottom: '2rem', background: 'var(--surface-tint-color)', padding: '1rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Race Settings</h3>
              <button onClick={() => setIsEditingRace(true)} className="secondary-btn" style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', fontSize: '0.85rem' }}>
                  <Icon path={mdiPencil} size={0.6} /> Edit Details
              </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div><strong>Scoring:</strong> {race?.scoring_strategy ? ({
                  'TIMED': 'Timed',
                  'POINTS': 'Points'
              }[race.scoring_strategy] || race.scoring_strategy) : '-'}</div>
              <div><strong>Car Numbering:</strong> {race?.car_numbering_strategy ? ({
                  'MANUAL': 'Manual',
                  'PER_GROUP': 'Per RacingGroup',
                  'GLOBAL': 'Global'
              }[race.car_numbering_strategy] || race.car_numbering_strategy) : '-'}</div>
              <div><strong>Championship Trophies:</strong> {race?.championship_trophies || 3}</div>
              <div><strong>Track:</strong> {Array.isArray(tracks) && tracks.find(t => t.id === race?.track_id)?.name || 'Unknown'}</div>
          </div>
      </div>

      {/* Edit Race Modal */}
      <Modal
          isOpen={isEditingRace}
          onClose={() => setIsEditingRace(false)}
          title="Edit Race Details"
      >
          {race && (
            <RaceForm
                initialData={race}
                onSubmit={handleUpdateRace}
                onCancel={() => setIsEditingRace(false)}
                onDelete={handleDeleteRace}
                submitLabel="Save Changes"
            />
          )}
      </Modal>

      {/* Roster Section

          Three controls on the first row rather than six. Manage racingGroups, photos
          and print are things an operator does once before an event, so they
          sit behind the overflow; add and scan are the two reached for over and
          over. Bulk Actions is gone entirely — it was a button that spent most
          of the day disabled, which is space spent saying "not yet". What it
          held is now a selection bar that exists only when something is
          selected. */}
      <div className="roster-header" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--divider-color)', paddingBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '1.4rem' }}>
                Racer Roster <span style={{ fontSize: '0.9rem', fontWeight: 'normal', color: 'var(--text-muted-color)', marginLeft: '8px' }}>({filteredRacers.length})</span>
            </h2>

            {/* How far check-in has got (#204). It lives here rather than only
                on Home, because this is the page the question gets asked on. */}
            {/* Counted from the racers the page already holds rather than
                read off `race.checkedInCount`. A check-in on another device
                arrives as a RACER event carrying that racer, which graphcache
                merges — so a derived count updates live, where the scalar on
                Race has nothing to recompute it and sits stale until a
                refetch. Same reasoning as #12. */}
            <CheckInProgress
                checkedIn={racers.filter(r => r.car_passed_inspection).length}
                registered={racers.length}
            />

            <div className="roster-controls" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
                <div className="dropdown" style={{ position: 'relative' }}>
                    <div className="split-btn-container">
                        <button className="secondary-btn split-btn-main" onClick={handleAddRacerClick} style={{ backgroundColor: 'var(--scouting-blue)', color: 'var(--on-primary-color)', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px', whiteSpace: 'nowrap' }}>
                            <Icon path={mdiPlus} size={0.7} /> Add Racer
                        </button>
                        <button
                            className="secondary-btn split-btn-arrow"
                            style={{ backgroundColor: 'var(--scouting-blue)', color: 'var(--on-primary-color)', padding: '6px 8px', height: '32px' }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsAddRacerDropdownOpen(!isAddRacerDropdownOpen);
                            }}
                            aria-label="More ways to add racers"
                        >
                            <Icon path={mdiChevronDown} size={0.7} />
                        </button>
                    </div>
                    {isAddRacerDropdownOpen && (
                        <div
                            className="dropdown-content"
                            style={{ display: 'block' }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={() => {
                                    setShowPopulateModal(true);
                                    setIsAddRacerDropdownOpen(false);
                                }}
                                title="Populate Test Data"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Icon path={mdiLightningBolt} size={0.7} color="var(--cub-scouting-gold)" /> Populate Test Data
                            </button>
                            <button
                                onClick={() => {
                                    setShowImportModal(true);
                                    setIsAddRacerDropdownOpen(false);
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Icon path={mdiFileUpload} size={0.7} /> Import from CSV
                            </button>
                        </div>
                    )}
                </div>

                <button
                    className="secondary-btn"
                    onClick={() => setShowScanner(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px', whiteSpace: 'nowrap' }}
                >
                    <Icon path={mdiQrcodeScan} size={0.7} /> Scan
                </button>

                <div className="dropdown" style={{ position: 'relative' }}>
                    <button
                        className="secondary-btn"
                        onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                        style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', fontSize: '0.85rem', height: '32px' }}
                        aria-label="More roster actions"
                        aria-expanded={isMoreMenuOpen}
                        data-testid="roster-more-menu"
                    >
                        <Icon path={mdiDotsHorizontal} size={0.8} />
                    </button>
                    {isMoreMenuOpen && (
                        <div className="dropdown-content" style={{ display: 'block', right: 0, left: 'auto', minWidth: '190px' }}>
                            <button
                                onClick={() => { setShowRacingGroupManager(true); setIsMoreMenuOpen(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Icon path={mdiAccountGroup} size={0.7} /> Manage Racing Groups
                            </button>
                            <button
                                onClick={() => { setShowBulkPhotoUpload(true); setIsMoreMenuOpen(false); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Icon path={mdiCamera} size={0.7} /> Upload Photos
                            </button>
                            {/* The selection carries over, but an empty one is
                                not an empty print run — the print page reads it
                                as the whole roster, which is what "print the pit
                                passes" means the morning of a race. */}
                            <button
                                onClick={() => {
                                    setIsMoreMenuOpen(false);
                                    navigate(
                                        selectedRacerIds.length > 0
                                            ? `/race/${parsedRaceId}/print?racers=${selectedRacerIds.join(',')}`
                                            : `/race/${parsedRaceId}/print`
                                    );
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Icon path={mdiPrinter} size={0.7} /> Print
                                {selectedRacerIds.length > 0 && ` (${selectedRacerIds.length})`}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <div className="search-container" style={{ display: 'flex', alignItems: 'center', position: 'relative', flex: '1 1 200px', maxWidth: '340px' }}>
                <Icon path={mdiMagnify} size={0.7} style={{ position: 'absolute', left: '10px', color: 'var(--text-faint-color)' }} />
                <input
                    type="text"
                    placeholder="Search racers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        padding: '6px 12px 6px 30px',
                        borderRadius: '20px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.85rem',
                        width: '100%',
                        height: '32px'
                    }}
                />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted-color)', fontWeight: 500, whiteSpace: 'nowrap' }}>Group by Racing Group</span>
                <span className="toggle-switch small">
                    <input
                        type="checkbox"
                        checked={isGroupedByRacingGroup}
                        onChange={e => setIsGroupedByRacingGroup(e.target.checked)}
                    />
                    <span className="slider"></span>
                </span>
            </label>
        </div>

        {selectedRacerIds.length > 0 && (
            <div
                data-testid="roster-selection-bar"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    marginTop: '0.75rem',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'var(--info-highlight-bg-color)',
                    border: '1px solid var(--info-highlight-border-color)'
                }}
            >
                <strong style={{ fontSize: '0.85rem', color: 'var(--scouting-blue)', whiteSpace: 'nowrap' }}>
                    {selectedRacerIds.length} selected
                </strong>
                <button
                    className="secondary-btn"
                    onClick={handleBulkCheckIn}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.8rem', height: '28px' }}
                    data-testid="bulk-check-in-btn"
                >
                    <Icon path={mdiCheckDecagram} size={0.6} /> Check In
                </button>
                <button
                    className="secondary-btn"
                    onClick={handleBulkAutoNumber}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.8rem', height: '28px' }}
                    data-testid="bulk-auto-number-btn"
                >
                    <Icon path={mdiNumeric} size={0.6} /> Auto number
                </button>
                <button
                    className="secondary-btn"
                    onClick={handleBulkClearNumbers}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.8rem', height: '28px' }}
                    data-testid="bulk-clear-numbers-btn"
                >
                    <Icon path={mdiPlus} size={0.6} style={{ transform: 'rotate(45deg)' }} /> Clear numbers
                </button>

                {/* Still a menu, because a pack has six racingGroups and they will not
                    fit on the bar. It opens downward now rather than flying out
                    sideways, so there is no space left to measure — the
                    hover-and-flip machinery went with it. */}
                <div className="dropdown" style={{ position: 'relative' }}>
                    <button
                        className="secondary-btn"
                        onClick={() => setIsMoveToRacingGroupOpen(!isMoveToRacingGroupOpen)}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.8rem', height: '28px' }}
                        data-testid="bulk-move-to-racing-group-expand-btn"
                        aria-expanded={isMoveToRacingGroupOpen}
                    >
                        <Icon path={mdiAccountGroup} size={0.6} /> Move to racingGroup
                        <Icon path={mdiChevronDown} size={0.5} />
                    </button>
                    {isMoveToRacingGroupOpen && (
                        <div className="dropdown-content" style={{ display: 'block', minWidth: '170px' }}>
                            {racingGroups.map(racingGroup => (
                                <button
                                    key={racingGroup.id}
                                    onClick={() => handleBulkMoveToRacingGroup(racingGroup.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                    data-testid={`bulk-move-to-racing-group-${racingGroup.id}`}
                                >
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: racingGroup.color }}></span>
                                    {racingGroup.name}
                                </button>
                            ))}
                            <button onClick={() => handleBulkMoveToRacingGroup(null)} data-testid="bulk-move-to-unassigned">Unassigned</button>
                        </div>
                    )}
                </div>

                <button
                    className="secondary-btn"
                    onClick={handleBulkDelete}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '0.8rem', height: '28px', color: 'var(--error)' }}
                    data-testid="bulk-delete-btn"
                >
                    Delete
                </button>

                <button
                    className="secondary-btn"
                    onClick={() => setSelectedRacerIds([])}
                    style={{ marginLeft: 'auto', background: 'transparent', padding: '4px 8px', height: '28px' }}
                    aria-label="Clear selection"
                    data-testid="clear-selection"
                >
                    <Icon path={mdiClose} size={0.7} />
                </button>
            </div>
        )}
      </div>

      <div style={{ overflowX: 'auto' }} className="desktop-only-table">
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }} className="responsive-table">
                <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'var(--on-primary-color)' }}>
                    <tr>
                        <th style={{ padding: '12px', textAlign: 'center', width: '40px' }}>
                            <input
                                type="checkbox"
                                data-testid="select-all-header"
                                checked={selectedRacerIds.length > 0 && selectedRacerIds.length === filteredRacers.length}
                                ref={el => {
                                    if (el) el.indeterminate = selectedRacerIds.length > 0 && selectedRacerIds.length < filteredRacers.length;
                                }}
                                onChange={toggleSelectAll}
                                style={{ transform: 'scale(1.2)' }}
                            />
                        </th>
                        <SortableHeader label="Car #" sortKey="car_number" sort={sort} onSort={toggleSort} />
                        {/* Photo is the one column with nothing to sort on. */}
                        <th style={{ padding: '12px', textAlign: 'center' }}>Photo</th>
                        <SortableHeader label="First Name" sortKey="first_name" sort={sort} onSort={toggleSort} />
                        <SortableHeader label="Last Name" sortKey="last_name" sort={sort} onSort={toggleSort} />
                        <SortableHeader label="Racing Group" sortKey="racingGroup" sort={sort} onSort={toggleSort} />
                        <SortableHeader label="Status / Edit" sortKey="status" sort={sort} onSort={toggleSort} align="center" />
                    </tr>
                </thead>
                <tbody>
                    {filteredRacers.length === 0 ? (
                        <tr><td data-label="Status" colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>
                            {searchTerm ? 'No racers found matching your search.' : 'No racers registered yet.'}
                        </td></tr>
                    ) : isGroupedByRacingGroup ? (
                        // Grouped View
                        groupedRacers.map(group => {
                            const { racingGroupName, racingGroupColor } = group;

                            return (
                                // A keyed Fragment, not <>: the shorthand takes
                                // no key, and a racingGroup header plus its rows have
                                // to be siblings of the other groups' rows for
                                // the table to be valid.
                                <Fragment key={`group-${group.racingGroupId}`}>
                                    <tr className="group-row" style={{ backgroundColor: 'var(--surface-tint-color)', borderTop: '2px solid var(--border-color)' }}>
                                        <td colSpan={7} style={{ padding: '12px', fontWeight: 'bold', fontSize: '1.1rem' }}>
                                            <span style={{
                                                display: 'inline-block',
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '50%',
                                                backgroundColor: racingGroupColor,
                                                marginRight: '8px'
                                            }}></span>
                                            {racingGroupName} ({group.items.length})
                                        </td>
                                    </tr>
                                    {group.items.map(racer => (
                                         <tr
                                            key={racer.id}
                                            className="racer-row"
                                            style={{
                                                borderBottom: '1px solid var(--divider-color)',
                                                backgroundColor: selectedRacerIds.includes(racer.id) ? 'var(--surface-hover-color)' : undefined
                                            }}
                                         >
                                             <td data-label="Select" style={{ padding: '12px', textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    className="row-checkbox"
                                                    data-testid={`racer-select-${racer.id}`}
                                                    checked={selectedRacerIds.includes(racer.id)}
                                                    onChange={() => toggleSelectRacer(racer.id)}
                                                    style={{
                                                        transform: 'scale(1.1)',
                                                        opacity: selectedRacerIds.includes(racer.id) ? 1 : 0
                                                    }}
                                                />
                                            </td>
                                            <td data-label="Car #" style={{ padding: '12px' }}>{racer.car_number || '-'}</td>
                                            <td data-label="Photo" style={{ padding: '12px', textAlign: 'center' }}>
                                                <RacerAvatar
                                                    racer={racer}
                                                    size="40px"
                                                    style={{ margin: '0 auto', border: '2px solid var(--surface-color)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                                />
                                            </td>
                                            <td data-label="First Name" style={{ padding: '12px' }}>{racer.first_name}</td>
                                            <td data-label="Last Name" style={{ padding: '12px' }}>{racer.last_name}</td>
                                            <td data-label="RacingGroup" style={{ padding: '12px' }}>
                                                {racer.racing_group_id ? (
                                                    <span style={{
                                                        padding: '4px 8px',
                                                        borderRadius: '12px',
                                                        backgroundColor: racingGroups.find(d => d.id === racer.racing_group_id)?.color || 'var(--divider-color)',
                                                        color: getContrastColor(racingGroups.find(d => d.id === racer.racing_group_id)?.color || '#eee'),
                                                        fontSize: '0.85rem',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {racingGroups.find(d => d.id === racer.racing_group_id)?.name || 'Unknown'}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td data-label="Status/Edit" style={{ padding: '12px', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handleCheckInClick(racer)}
                                                    style={{
                                                        background: racer.car_passed_inspection ? 'var(--success-bg-color)' : 'var(--cub-scouting-gold)',
                                                        border: `1px solid ${racer.car_passed_inspection ? 'var(--success-accent-color)' : 'var(--border-color)'}`,
                                                        borderRadius: '20px',
                                                        padding: '6px 12px',
                                                        cursor: 'pointer',
                                                        color: racer.car_passed_inspection ? 'var(--success-color)' : 'var(--scouting-blue)',
                                                        fontSize: '0.85rem',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '5px',
                                                        minWidth: '120px',
                                                        justifyContent: 'center'
                                                    }}
                                                >
                                                     {racer.car_passed_inspection ? (
                                                         <><Icon path={mdiCheckDecagram} size={0.7} /> Checked In / Edit</>
                                                     ) : (
                                                         'Check In'
                                                     )}
                                                 </button>
                                                 <NoHeatsBadge
                                                     racer={{ id: racer.id, carPassedInspection: racer.car_passed_inspection }}
                                                     scheduledRacerIds={scheduledRacerIds}
                                                     anyHeatsScheduled={anyHeatsScheduled}
                                                 />
                                            </td>
                                        </tr>
                                    ))}
                                </Fragment>
                            );
                        })
                    ) : (
                        // Standard View
                          filteredRacers.map(racer => (
                            <tr
                                key={racer.id}
                                className="racer-row"
                                style={{
                                    borderBottom: '1px solid var(--divider-color)',
                                    backgroundColor: selectedRacerIds.includes(racer.id) ? 'var(--surface-hover-color)' : undefined
                                }}
                            >
                                <td data-label="Select" style={{ padding: '12px', textAlign: 'center' }}>
                                    <span className="cell-value">
                                        <input
                                            type="checkbox"
                                            className="row-checkbox"
                                            data-testid={`racer-select-${racer.id}`}
                                            checked={selectedRacerIds.includes(racer.id)}
                                            onChange={() => toggleSelectRacer(racer.id)}
                                            style={{
                                                transform: 'scale(1.1)',
                                                opacity: selectedRacerIds.includes(racer.id) ? 1 : 0
                                            }}
                                        />
                                    </span>
                                </td>
                                <td data-label="Car #" style={{ padding: '12px' }}><span className="cell-value">{racer.car_number || '-'}</span></td>
                                <td data-label="Photo" style={{ padding: '12px', textAlign: 'center' }}>
                                    <span className="cell-value">
                                        <RacerAvatar
                                            racer={racer}
                                            size="40px"
                                            style={{ margin: '0 auto', border: '2px solid var(--surface-color)', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                        />
                                    </span>
                                </td>
                                <td data-label="First Name" style={{ padding: '12px' }}><span className="cell-value">{racer.first_name}</span></td>
                                <td data-label="Last Name" style={{ padding: '12px' }}><span className="cell-value">{racer.last_name}</span></td>
                                <td data-label="RacingGroup" style={{ padding: '12px' }}>
                                    <span className="cell-value">
                                        {racer.racing_group_id ? (
                                            <span style={{
                                                padding: '4px 8px',
                                                borderRadius: '12px',
                                                backgroundColor: racingGroups.find(d => d.id === racer.racing_group_id)?.color || 'var(--divider-color)',
                                                color: getContrastColor(racingGroups.find(d => d.id === racer.racing_group_id)?.color || '#eee'),
                                                fontSize: '0.85rem',
                                                fontWeight: 'bold'
                                            }}>
                                                {racingGroups.find(d => d.id === racer.racing_group_id)?.name || 'Unknown'}
                                            </span>
                                        ) : '-'}
                                    </span>
                                </td>
                                <td data-label="Status/Edit" style={{ padding: '12px', textAlign: 'center' }}>
                                    <span className="cell-value" style={{ display: 'flex', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => handleCheckInClick(racer)}
                                            style={{
                                                background: racer.car_passed_inspection ? 'var(--success-bg-color)' : 'var(--cub-scouting-gold)',
                                                border: `1px solid ${racer.car_passed_inspection ? 'var(--success-accent-color)' : 'var(--border-color)'}`,
                                                borderRadius: '20px',
                                                padding: '6px 12px',
                                                cursor: 'pointer',
                                                color: racer.car_passed_inspection ? 'var(--success-color)' : 'var(--scouting-blue)',
                                                fontSize: '0.85rem',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                minWidth: '120px',
                                                justifyContent: 'center'
                                            }}
                                        >
                                             {racer.car_passed_inspection ? (
                                                 <><Icon path={mdiCheckDecagram} size={0.7} /> Checked In / Edit</>
                                             ) : (
                                                 'Check In'
                                             )}
                                         </button>
                                         <NoHeatsBadge
                                             racer={{ id: racer.id, carPassedInspection: racer.car_passed_inspection }}
                                             scheduledRacerIds={scheduledRacerIds}
                                             anyHeatsScheduled={anyHeatsScheduled}
                                         />
                                    </span>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="mobile-only-cards">
          {filteredRacers.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', background: 'var(--surface-color)', borderRadius: '12px', border: '1px solid var(--divider-color)' }}>
                  {searchTerm ? 'No racers found matching your search.' : 'No racers registered yet.'}
              </div>
          ) : isGroupedByRacingGroup ? (
              // Mobile Grouped View
              groupedRacers.map(group => (
                  <div key={`mobile-group-${group.racingGroupId}`}>
                      <div className="mobile-racing-group-header" style={{ borderLeftColor: group.racingGroupColor }}>
                          {group.racingGroupName} ({group.items.length})
                      </div>
                      {group.items.map(racer => renderRacerCard(racer))}
                  </div>
              ))
          ) : (
              // Mobile Standard View
              filteredRacers.map(racer => renderRacerCard(racer))
          )}
      </div>

      {/* Racer Form Modal */}
      <Modal
         isOpen={showRacerForm}
         onClose={() => setShowRacerForm(false)}
         title={racerFormTitle}
      >
        <RacerForm
            key={editingRacer?.id ?? 'new'}
            initialData={editingRacer}
            raceId={race ? race.id : undefined}
            onSubmit={handleRacerFormSubmit}
            onCancel={() => setShowRacerForm(false)}
            submitLabel={racerFormSubmitLabel}
            weightLimitOz={data?.race?.weightLimitOz}
            // Only when adding: editing one racer has no "another" to go on
            // to, and check-in is a different act again.
            onSubmitAndContinue={editingRacer ? undefined : handleRacerFormSubmitAndContinue}
        />
      </Modal>

      {/* Check-in Scanner Modal. Mounted only while open so the camera is
          released the moment it closes. */}
      <Modal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        title="Scan to Check In"
      >
          {showScanner && (
              <CheckInScanner
                  raceId={parsedRaceId}
                  racers={racers}
                  onRacer={handleScanned}
                  onClose={() => setShowScanner(false)}
              />
          )}
      </Modal>

      {/* Racing Group Manager Modal */}
      <Modal
        isOpen={showRacingGroupManager}
        onClose={() => setShowRacingGroupManager(false)}
        title="Manage Racing Groups"
      >
          {race ? (
             <RacingGroupManager
                raceId={race.id}
                onUpdate={refreshData}
              />
          ) : <p>Loading race details...</p>}
      </Modal>

      {/* Import Racers Modal */}
      {race && (
          <ImportRacersModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            raceId={race.id}
            onImportSuccess={refreshData}
          />
      )}

      {/* Bulk Photo Upload Modal */}
      {showBulkPhotoUpload && (
          <BulkPhotoUploadModal
              isOpen={showBulkPhotoUpload}
              onClose={() => setShowBulkPhotoUpload(false)}
              onSuccess={refreshData}
              racers={racers}
          />
      )}

      {/* Populate Modal */}
      <Modal
        isOpen={showPopulateModal}
        onClose={() => setShowPopulateModal(false)}
        title="Populate Test Data"
      >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ color: 'var(--text-muted-color)', lineHeight: '1.5' }}>
                  Generate fake racers to test your race setup. You can specify how many racers to add.
                  They will be assigned random names, ranks, and images.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label htmlFor="pop-count" style={{ fontWeight: 'bold' }}>Number of Racers:</label>
                  <input
                      id="pop-count"
                      type="number"
                      min="1"
                      max="100"
                      value={populateCount}
                      onChange={(e) => setPopulateCount(parseInt(e.target.value) || 0)}
                      style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--input-border-color)' }}
                  />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                          type="checkbox"
                          checked={popAddRacerPhotos}
                          onChange={(e) => setPopAddRacerPhotos(e.target.checked)}
                      />
                      Add Racer Photos
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                          type="checkbox"
                          checked={popAddCarPhotos}
                          onChange={(e) => setPopAddCarPhotos(e.target.checked)}
                      />
                      Add Car Photos
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                          type="checkbox"
                          checked={popAssignRacingGroups}
                          onChange={(e) => setPopAssignRacingGroups(e.target.checked)}
                      />
                      Assign to Racing Groups
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                          type="checkbox"
                          checked={popCheckIn}
                          onChange={(e) => setPopCheckIn(e.target.checked)}
                      />
                      Check In Automatically
                  </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1rem' }}>
                  <button
                    onClick={async () => {
                        if (populateCount <= 0) {
                            showAlert("Please enter a valid count > 0", "Invalid Input");
                            return;
                        }

                        const btn = document.getElementById('do-populate-btn');
                        if (btn) {
                            btn.textContent = '⏳ Generating...';
                            (btn as HTMLButtonElement).disabled = true;
                        }

                        try {
                            const result = await populateRaceMutation({
                                raceId: parsedRaceId,
                                config: {
                                    count: populateCount,
                                    addRacerPhotos: popAddRacerPhotos,
                                    addCarPhotos: popAddCarPhotos,
                                    assignRacingGroups: popAssignRacingGroups,
                                    checkIn: popCheckIn
                                }
                            });
                            if (result.error) throw result.error;
                            refreshData();
                            setShowPopulateModal(false);
                        } catch {
                            console.error("Failed to populate racers");
                            showAlert("Failed to populate test racers", "Error");
                        } finally {
                            if (btn) {
                                btn.textContent = 'Generate';
                                (btn as HTMLButtonElement).disabled = false;
                            }
                        }
                    }}
                    id="do-populate-btn"
                    style={{ backgroundColor: 'var(--scouting-blue)', color: 'var(--on-primary-color)', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                  >
                      Generate
                  </button>
                  <button
                    onClick={() => setShowPopulateModal(false)}
                    style={{ backgroundColor: 'var(--surface-strong-color)', color: 'var(--text-muted-color)', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
              </div>
          </div>
      </Modal>
    </div>
  );
}
