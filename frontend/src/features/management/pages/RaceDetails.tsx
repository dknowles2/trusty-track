import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from 'urql';
import { useRaceStateChanged } from '../../core/hooks/useRaceStateChanged';

import { useAlert } from '../../../context/AlertContext';

import { getContrastColor } from '../../../utils/colors';
import RacerForm, { RacerData, Den } from '../components/RacerForm';
import DenManager from '../components/DenManager';
import Modal from '../../../components/ui/Modal';
import RaceForm, { RaceFormData } from '../components/RaceForm';
import ImportRacersModal from '../components/ImportRacersModal';
import BulkPhotoUploadModal from '../components/BulkPhotoUploadModal';
import RacerAvatar from '../components/RacerAvatar';
import RaceModeToggle from '../../racing/components/RaceModeToggle';
import Icon from '@mdi/react';
import {
  mdiMagnify, mdiNumeric,
  mdiChevronDown, mdiLightningBolt, mdiFileUpload,
  mdiCheckDecagram, mdiPencil, mdiPlus, mdiAccountGroup, mdiCamera, mdiPrinter,
  mdiQrcodeScan
} from '@mdi/js';
import CheckInScanner from '../../printables/components/CheckInScanner';
import * as GQL from '../graphql/queries';

interface GQLDen {
    id: number;
    name: string;
    color: string;
    rank?: string;
    carNumberRangeStart?: number;
    carNumberRangeEnd?: number;
}

interface GQLRacer {
    id: number;
    firstName: string;
    lastName: string;
    carNumber?: number | string;
    denId?: number;
    carName?: string;
    carPassedInspection: boolean;
    carWeight?: number;
    racerImageUrl?: string;
    carImageUrl?: string;
}

interface Race extends RaceFormData {
    id: number;
    track_id: number;
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
  const [raceDetailsResult, reexecuteRaceDetails] = useQuery({
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
  const [, bulkMoveToDenMutation] = useMutation(GQL.BULK_MOVE_TO_DEN);
  const [, bulkDeleteRacersMutation] = useMutation(GQL.BULK_DELETE_RACERS);
  const [, populateRaceMutation] = useMutation(GQL.POPULATE_RACE);

  // Mapped Data from Query
  const race = useMemo(() => {
    if (!data?.race) return null;
    return {
      id: data.race.id,
      name: data.race.name,
      date_time: data.race.dateTime,
      location: data.race.location,
      track_id: data.race.trackId,
      scoring_strategy: data.race.scoringStrategy,
      car_numbering_strategy: data.race.carNumberingStrategy,
      global_start_number: data.race.globalStartNumber,
      championship_trophies: data.race.championshipTrophies,
    } as Race;
  }, [data]);

  const racers = useMemo<Racer[]>(() => {
    if (!data?.race?.racers) return [];
    return data.race.racers.map((r: GQLRacer) => ({
      id: r.id,
      first_name: r.firstName,
      last_name: r.lastName,
      car_number: r.carNumber,
      den_id: r.denId,
      car_name: r.carName,
      car_passed_inspection: r.carPassedInspection,
      car_weight: r.carWeight,
      racer_image_url: r.racerImageUrl,
      car_image_url: r.carImageUrl,
    }));
  }, [data]);

  const dens = useMemo<Den[]>(() => {
    if (!data?.race?.dens) return [];
    return data.race.dens.map((d: GQLDen) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      rank: d.rank,
      car_number_range_start: d.carNumberRangeStart,
      car_number_range_end: d.carNumberRangeEnd,
    }));
  }, [data]);

  const tracks = useMemo(() => data?.tracks || [], [data]);

  const loading = fetching && !data;

  // Racer Form State
  const [showRacerForm, setShowRacerForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDenManager, setShowDenManager] = useState(false);
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
  const [popAssignDens, setPopAssignDens] = useState(true);
  const [popCheckIn, setPopCheckIn] = useState(false);

  // Race Edit State
  const [isEditingRace, setIsEditingRace] = useState(false);

  // Roster View State
  const [isGroupedByDen, setIsGroupedByDen] = useState(false);
  const [isAddRacerDropdownOpen, setIsAddRacerDropdownOpen] = useState(false);
  const [isBulkMenuOpen, setIsBulkMenuOpen] = useState(false);
  const [isMoveToDenOpen, setIsMoveToDenOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Selection State
  const [selectedRacerIds, setSelectedRacerIds] = useState<number[]>([]);
  const moveDenTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [denMenuSide, setDenMenuSide] = useState<'left' | 'right'>('left');
  const denMenuContainerRef = useRef<HTMLDivElement>(null);

  // Handle click outside for dropdowns
  useEffect(() => {
    if (!isAddRacerDropdownOpen && !isBulkMenuOpen && !isMoveToDenOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Don't close if clicking the dropdown button or content
      if (target.closest('.dropdown') || target.classList.contains('split-btn-arrow')) {
        return;
      }
      setIsAddRacerDropdownOpen(false);
      setIsBulkMenuOpen(false);
      setIsMoveToDenOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddRacerDropdownOpen, isBulkMenuOpen, isMoveToDenOpen]);


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
        "Are you sure you want to delete this race?\n\nThis action cannot be undone and will delete all racers, dens, rounds, heats, and results associated with it.",
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

  const handleRacerFormSubmit = async (formData: RacerData) => {
      try {
          // Map snake_case to camelCase for GQL input
          const racerInput = {
              firstName: formData.first_name,
              lastName: formData.last_name,
              carNumber: formData.car_number,
              denId: formData.den_id,
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
           setShowRacerForm(false);
           refreshData();
      } catch (e: unknown) {
          console.error("Failed to save", e);
          showAlert("Failed to save racer", "Error");
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
  const handleBulkAutoNumber = async () => {
    try {
      const result = await bulkAutoNumberMutation({ racerIds: selectedRacerIds });
      if (result.error) throw result.error;
      refreshData();
      showAlert(`Successfully auto-numbered ${result.data.bulkAutoNumber} racers`, "Bulk Auto-Number Result");
      setSelectedRacerIds([]);
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
      setSelectedRacerIds([]);
      setIsBulkMenuOpen(false);
    } catch {
      showAlert("Failed to bulk check-in racers", "Error");
    }
  };

  const handleBulkMoveToDen = async (denId: number | null) => {
    try {
      const result = await bulkMoveToDenMutation({ racerIds: selectedRacerIds, denId });
      if (result.error) throw result.error;
      refreshData();
      setSelectedRacerIds([]);
      setIsMoveToDenOpen(false);
      setIsBulkMenuOpen(false);
    } catch {
      showAlert("Failed to move racers to den", "Error");
    }
  };

  const handleBulkDelete = async () => {
    const scheduledRacerIds = data?.race?.scheduledRacerIds || [];
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

  const handleMoveDenMouseEnter = () => {
    if (moveDenTimeoutRef.current) clearTimeout(moveDenTimeoutRef.current);

    // Calculate which side has more room, defaulting to right
    if (denMenuContainerRef.current) {
        const rect = denMenuContainerRef.current.getBoundingClientRect();
        const spaceOnRight = window.innerWidth - rect.right;

        // Default to right, flip to left only if it doesn't fit on the right
        if (spaceOnRight >= 190) {
            setDenMenuSide('right');
        } else {
            setDenMenuSide('left');
        }
    }

    moveDenTimeoutRef.current = setTimeout(() => {
      setIsMoveToDenOpen(true);
    }, 200); // Brief delay
  };

  const handleMoveDenMouseLeave = () => {
    if (moveDenTimeoutRef.current) clearTimeout(moveDenTimeoutRef.current);
    moveDenTimeoutRef.current = setTimeout(() => {
      setIsMoveToDenOpen(false);
    }, 300); // Slightly longer delay for leaving to be more forgiving
  };

  const filteredRacers = racers.filter(racer => {
      const searchLower = searchTerm.toLowerCase();
      const denName = dens.find(d => d.id === racer.den_id)?.name || '';

      return (
          (racer.first_name || '').toLowerCase().includes(searchLower) ||
          (racer.last_name || '').toLowerCase().includes(searchLower) ||
          (racer.car_number || '').toString().includes(searchLower) ||
          denName.toLowerCase().includes(searchLower)
      );
  });

  const renderRacerCard = (racer: Racer) => {
    const den = dens.find(d => d.id === racer.den_id);
    const isSelected = selectedRacerIds.includes(racer.id);

    return (
      <div key={racer.id} className="racer-card" style={{
          backgroundColor: isSelected ? '#f0f7ff' : 'white',
          borderColor: isSelected ? '#3b82f6' : '#eee'
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
              <span className="racer-card-label">Den</span>
              <div className="racer-card-value">
                  {racer.den_id ? (
                      <span style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: den?.color || '#eee',
                          color: getContrastColor(den?.color || '#eee'),
                          fontSize: '0.75rem',
                          fontWeight: 'bold'
                      }}>
                          {den?.name || 'Unknown'}
                      </span>
                  ) : '-'}
              </div>
          </div>

          <div className="racer-card-actions">
              <button
                  onClick={() => handleCheckInClick(racer)}
                  className="secondary-btn"
                  style={{
                      background: racer.car_passed_inspection ? '#e8f5e9' : 'var(--cub-scouting-gold)',
                      borderColor: racer.car_passed_inspection ? '#4caf50' : '#ddd',
                      color: racer.car_passed_inspection ? '#2e7d32' : 'var(--scouting-blue)',
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
          </div>
      </div>
    );
  };

  if (loading && !race) return <p>Loading...</p>;

  return (
    <div className="container" style={{ padding: '2rem' }}>
      {/* Header Section */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div style={{ minWidth: '160px' }} />

          <RaceModeToggle />

          <div style={{ minWidth: '160px' }} />
      </div>

      {/* Race Settings Summary (Read-Only for now, can be expanded) */}
      <div style={{ marginBottom: '2rem', background: '#f9f9f9', padding: '1rem', borderRadius: '8px' }}>
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
                  'PER_GROUP': 'Per Den',
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

      {/* Roster Section */}
      <div className="roster-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>
            Racer Roster <span style={{ fontSize: '0.9rem', fontWeight: 'normal', color: '#666', marginLeft: '8px' }}>({filteredRacers.length})</span>
        </h2>
        <div className="roster-controls" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div className="search-container" style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <Icon path={mdiMagnify} size={0.7} style={{ position: 'absolute', left: '10px', color: '#999' }} />
                <input
                    type="text"
                    placeholder="Search racers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        padding: '6px 12px 6px 30px',
                        borderRadius: '20px',
                        border: '1px solid #ddd',
                        fontSize: '0.85rem',
                        width: '160px',
                        height: '32px'
                    }}
                />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px', borderRight: '1px solid #eee', height: '24px', marginRight: '4px' }}>
                <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: 500 }}>Group by Den</span>
                <label className="toggle-switch small">
                    <input
                        type="checkbox"
                        checked={isGroupedByDen}
                        onChange={e => setIsGroupedByDen(e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>

            <button className="secondary-btn" onClick={() => setShowDenManager(true)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px' }}>
                <Icon path={mdiAccountGroup} size={0.7} /> Manage Dens
            </button>

            <div className="dropdown" style={{ position: 'relative' }}>
                <button
                    className="secondary-btn"
                    onClick={() => setIsBulkMenuOpen(!isBulkMenuOpen)}
                    disabled={selectedRacerIds.length === 0}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        height: '32px',
                        backgroundColor: selectedRacerIds.length > 0 ? 'var(--scouting-blue)' : undefined,
                        color: selectedRacerIds.length > 0 ? 'white' : undefined,
                        opacity: selectedRacerIds.length === 0 ? 0.5 : 1
                    }}
                >
                    <Icon path={mdiNumeric} size={0.7} /> Bulk Actions {selectedRacerIds.length > 0 && `(${selectedRacerIds.length})`}
                    <Icon path={mdiChevronDown} size={0.6} />
                </button>
                {isBulkMenuOpen && (
                    <div className="dropdown-content" style={{ display: 'block', right: 0, left: 'auto', minWidth: '180px', overflow: 'visible' }}>
                        <button
                            onClick={handleBulkAutoNumber}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            data-testid="bulk-auto-number-btn"
                        >
                            <Icon path={mdiNumeric} size={0.7} /> Auto number
                        </button>
                        <button
                            onClick={handleBulkClearNumbers}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            data-testid="bulk-clear-numbers-btn"
                        >
                            <Icon path={mdiPlus} size={0.7} style={{ transform: 'rotate(45deg)' }} /> Clear numbers
                        </button>
                        <button
                            onClick={handleBulkCheckIn}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            data-testid="bulk-check-in-btn"
                        >
                            <Icon path={mdiCheckDecagram} size={0.7} /> Bulk Check-In
                        </button>
                        <div
                            ref={denMenuContainerRef}
                            style={{ position: 'relative' }}
                            onMouseEnter={handleMoveDenMouseEnter}
                            onMouseLeave={handleMoveDenMouseLeave}
                        >
                            <button
                                onClick={(e) => { e.stopPropagation(); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', width: '100%' }}
                                data-testid="bulk-move-to-den-expand-btn"
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon path={mdiAccountGroup} size={0.7} /> Move to den
                                </span>
                                <Icon path={mdiChevronDown} size={0.6} style={{ transform: 'rotate(-90deg)' }} />
                            </button>
                            {isMoveToDenOpen && (
                                <div className="dropdown-content" style={{
                                    display: 'block',
                                    position: 'absolute',
                                    [denMenuSide === 'left' ? 'right' : 'left']: '100%',
                                    top: 0,
                                    margin: 0,
                                    boxShadow: denMenuSide === 'left' ? '-2px 2px 10px rgba(0,0,0,0.1)' : '2px 2px 10px rgba(0,0,0,0.1)'
                                }}>
                                    {dens.map(den => (
                                        <button
                                            key={den.id}
                                            onClick={() => handleBulkMoveToDen(den.id)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                            data-testid={`bulk-move-to-den-${den.id}`}
                                        >
                                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: den.color }}></span>
                                            {den.name}
                                        </button>
                                    ))}
                                    <button onClick={() => handleBulkMoveToDen(null)} data-testid="bulk-move-to-unassigned">Unassigned</button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={handleBulkDelete}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d32f2f' }}
                            data-testid="bulk-delete-btn"
                        >
                             Delete
                        </button>
                    </div>
                )}
            </div>

            <button
                className="secondary-btn"
                onClick={() => setShowScanner(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px' }}
            >
                <Icon path={mdiQrcodeScan} size={0.7} /> Scan
            </button>

            <button
                className="secondary-btn"
                onClick={() => setShowBulkPhotoUpload(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px' }}
            >
                <Icon path={mdiCamera} size={0.7} /> Upload Photos
            </button>

            {/* The selection carries over, but an empty one is not an empty
                print run — the print page reads it as the whole roster, which
                is what "print the pit passes" means the morning of a race. */}
            <button
                className="secondary-btn"
                onClick={() => navigate(
                    selectedRacerIds.length > 0
                        ? `/race/${parsedRaceId}/print?racers=${selectedRacerIds.join(',')}`
                        : `/race/${parsedRaceId}/print`
                )}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px' }}
            >
                <Icon path={mdiPrinter} size={0.7} /> Print
                {selectedRacerIds.length > 0 && ` (${selectedRacerIds.length})`}
            </button>

            <div className="dropdown" style={{ position: 'relative' }}>
                <div className="split-btn-container">
                    <button className="secondary-btn split-btn-main" onClick={handleAddRacerClick} style={{ backgroundColor: 'var(--scouting-blue)', color: 'white', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.85rem', height: '32px' }}>
                        <Icon path={mdiPlus} size={0.7} /> Add Racer
                    </button>
                    <button
                        className="secondary-btn split-btn-arrow"
                        style={{ backgroundColor: 'var(--scouting-blue)', color: 'white', padding: '6px 8px', height: '32px' }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsAddRacerDropdownOpen(!isAddRacerDropdownOpen);
                        }}
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
                            <Icon path={mdiLightningBolt} size={0.7} color="#fcd116" /> Populate Test Data
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
        </div>
      </div>

      <div style={{ overflowX: 'auto' }} className="desktop-only-table">
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }} className="responsive-table">
                <thead style={{ backgroundColor: 'var(--scouting-blue)', color: 'white' }}>
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
                        <th style={{ padding: '12px', textAlign: 'left' }}>Car #</th>
                        <th style={{ padding: '12px', textAlign: 'center' }}>Photo</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>First Name</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Last Name</th>
                        <th style={{ padding: '12px', textAlign: 'left' }}>Den</th>
                        <th style={{ padding: '12px', textAlign: 'center' }}>Status / Edit</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredRacers.length === 0 ? (
                        <tr><td data-label="Status" colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>
                            {searchTerm ? 'No racers found matching your search.' : 'No racers registered yet.'}
                        </td></tr>
                    ) : isGroupedByDen ? (
                        // Grouped View
                        Object.values(filteredRacers.reduce((acc, racer) => {
                            const denId = racer.den_id || -1;
                            if (!acc[denId]) acc[denId] = { denId, items: [] };
                            acc[denId].items.push(racer);
                            return acc;
                        }, {} as Record<number, { denId: number, items: Racer[] }>))
                        .sort((a, b) => {
                             // Sort groups logic
                             if (a.denId === -1) return 1; // Unassigned last
                             if (b.denId === -1) return -1;
                             const denA = dens.find((d: Den) => d.id === a.denId);
                             const denB = dens.find((d: Den) => d.id === b.denId);
                             return (denA?.name || '').localeCompare(denB?.name || '');
                        })
                        .map(group => {
                            const den = dens.find(d => d.id === group.denId);
                            const denName = group.denId === -1 ? "Unassigned" : (den?.name || 'Unknown Den');
                            const denColor = group.denId === -1 ? "#eee" : (den?.color || '#eee');

                            return (
                                <>
                                    <tr key={`header-${group.denId}`} className="group-row" style={{ backgroundColor: '#f9f9f9', borderTop: '2px solid #ddd' }}>
                                        <td colSpan={7} style={{ padding: '12px', fontWeight: 'bold', fontSize: '1.1rem' }}>
                                            <span style={{
                                                display: 'inline-block',
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '50%',
                                                backgroundColor: denColor,
                                                marginRight: '8px'
                                            }}></span>
                                            {denName} ({group.items.length})
                                        </td>
                                    </tr>
                                    {group.items.map(racer => (
                                         <tr
                                            key={racer.id}
                                            className="racer-row"
                                            style={{
                                                borderBottom: '1px solid #eee',
                                                backgroundColor: selectedRacerIds.includes(racer.id) ? '#f0f7ff' : undefined
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
                                                    style={{ margin: '0 auto', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                                />
                                            </td>
                                            <td data-label="First Name" style={{ padding: '12px' }}>{racer.first_name}</td>
                                            <td data-label="Last Name" style={{ padding: '12px' }}>{racer.last_name}</td>
                                            <td data-label="Den" style={{ padding: '12px' }}>
                                                {racer.den_id ? (
                                                    <span style={{
                                                        padding: '4px 8px',
                                                        borderRadius: '12px',
                                                        backgroundColor: dens.find(d => d.id === racer.den_id)?.color || '#eee',
                                                        color: getContrastColor(dens.find(d => d.id === racer.den_id)?.color || '#eee'),
                                                        fontSize: '0.85rem',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {dens.find(d => d.id === racer.den_id)?.name || 'Unknown'}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td data-label="Status/Edit" style={{ padding: '12px', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handleCheckInClick(racer)}
                                                    style={{
                                                        background: racer.car_passed_inspection ? '#e8f5e9' : 'var(--cub-scouting-gold)',
                                                        border: `1px solid ${racer.car_passed_inspection ? '#4caf50' : '#ddd'}`,
                                                        borderRadius: '20px',
                                                        padding: '6px 12px',
                                                        cursor: 'pointer',
                                                        color: racer.car_passed_inspection ? '#2e7d32' : 'var(--scouting-blue)',
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
                                            </td>
                                        </tr>
                                    ))}
                                </>
                            );
                        })
                    ) : (
                        // Standard View
                          filteredRacers.map(racer => (
                            <tr
                                key={racer.id}
                                className="racer-row"
                                style={{
                                    borderBottom: '1px solid #eee',
                                    backgroundColor: selectedRacerIds.includes(racer.id) ? '#f0f7ff' : undefined
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
                                            style={{ margin: '0 auto', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                        />
                                    </span>
                                </td>
                                <td data-label="First Name" style={{ padding: '12px' }}><span className="cell-value">{racer.first_name}</span></td>
                                <td data-label="Last Name" style={{ padding: '12px' }}><span className="cell-value">{racer.last_name}</span></td>
                                <td data-label="Den" style={{ padding: '12px' }}>
                                    <span className="cell-value">
                                        {racer.den_id ? (
                                            <span style={{
                                                padding: '4px 8px',
                                                borderRadius: '12px',
                                                backgroundColor: dens.find(d => d.id === racer.den_id)?.color || '#eee',
                                                color: getContrastColor(dens.find(d => d.id === racer.den_id)?.color || '#eee'),
                                                fontSize: '0.85rem',
                                                fontWeight: 'bold'
                                            }}>
                                                {dens.find(d => d.id === racer.den_id)?.name || 'Unknown'}
                                            </span>
                                        ) : '-'}
                                    </span>
                                </td>
                                <td data-label="Status/Edit" style={{ padding: '12px', textAlign: 'center' }}>
                                    <span className="cell-value" style={{ display: 'flex', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => handleCheckInClick(racer)}
                                            style={{
                                                background: racer.car_passed_inspection ? '#e8f5e9' : 'var(--cub-scouting-gold)',
                                                border: `1px solid ${racer.car_passed_inspection ? '#4caf50' : '#ddd'}`,
                                                borderRadius: '20px',
                                                padding: '6px 12px',
                                                cursor: 'pointer',
                                                color: racer.car_passed_inspection ? '#2e7d32' : 'var(--scouting-blue)',
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
              <div style={{ padding: '20px', textAlign: 'center', background: 'white', borderRadius: '12px', border: '1px solid #eee' }}>
                  {searchTerm ? 'No racers found matching your search.' : 'No racers registered yet.'}
              </div>
          ) : isGroupedByDen ? (
              // Mobile Grouped View
              Object.values(filteredRacers.reduce((acc, racer) => {
                  const denId = racer.den_id || -1;
                  if (!acc[denId]) acc[denId] = { denId, items: [] };
                  acc[denId].items.push(racer);
                  return acc;
              }, {} as Record<number, { denId: number, items: Racer[] }>))
              .sort((a, b) => {
                   if (a.denId === -1) return 1;
                   if (b.denId === -1) return -1;
                   const denA = dens.find(d => d.id === a.denId);
                   const denB = dens.find(d => d.id === b.denId);
                   return (denA?.name || '').localeCompare(denB?.name || '');
              })
              .map(group => {
                  const den = dens.find(d => d.id === group.denId);
                  const denName = group.denId === -1 ? "Unassigned" : (den?.name || 'Unknown Den');
                  const denColor = group.denId === -1 ? "#eee" : (den?.color || '#eee');

                  return (
                      <div key={`mobile-group-${group.denId}`}>
                          <div className="mobile-den-header" style={{ borderLeftColor: denColor }}>
                              {denName} ({group.items.length})
                          </div>
                          {group.items.map(racer => renderRacerCard(racer))}
                      </div>
                  );
              })
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
            initialData={editingRacer}
            raceId={race ? race.id : undefined}
            onSubmit={handleRacerFormSubmit}
            onCancel={() => setShowRacerForm(false)}
            submitLabel={racerFormSubmitLabel}
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

      {/* Den Manager Modal */}
      <Modal
        isOpen={showDenManager}
        onClose={() => setShowDenManager(false)}
        title="Manage Dens"
      >
          {race ? (
             <DenManager
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
              <p style={{ color: '#666', lineHeight: '1.5' }}>
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
                      style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
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
                          checked={popAssignDens}
                          onChange={(e) => setPopAssignDens(e.target.checked)}
                      />
                      Assign to Dens
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
                                    assignDens: popAssignDens,
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
                    style={{ backgroundColor: 'var(--scouting-blue)', color: 'white', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                  >
                      Generate
                  </button>
                  <button
                    onClick={() => setShowPopulateModal(false)}
                    style={{ backgroundColor: '#e0e0e0', color: '#666', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
              </div>
          </div>
      </Modal>
    </div>
  );
}
