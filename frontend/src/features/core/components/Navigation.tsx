import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useSubscription } from 'urql';
import { GET_RACES_NAV, INITIAL_CONFIG_QUERY, RACES_CHANGED } from '../graphql/queries';
import type { GetInitialConfigStatusQuery } from '../../../gql/operations';
import { activeNavLink } from '../activeNavLink';
import { CREATE_RACE } from '../../management/graphql/queries';
import Modal from '../../../components/ui/Modal';
import RaceSetupWizard from '../../management/components/RaceSetupWizard';
import { buildCreateRaceInput, type RaceSetupData } from '../../management/raceInput';
import { useAlert } from '../../../context/AlertContext';
import { Icon } from '@mdi/react';
import { mdiFlagCheckered, mdiChevronUp, mdiChevronDown, mdiPlus, mdiCog, mdiAccountGroup, mdiMedal, mdiVideo, mdiMenu, mdiClose, mdiTrophy, mdiChartBar } from '@mdi/js';
import LockedBadge from './LockedBadge';
import logoUrl from '../../../assets/logo_transparent.png';
import { UnlockButton } from './UnlockButton';
import { useChrome } from '../../../context/ChromeContext';

// The JS breakpoint used to be a strict `< 768`, one pixel narrower than the
// CSS `@media (max-width: 768px)` rules (`.mobile-hide`, the settings nav's
// own column-to-row collapse) it is meant to track — invisible while the two
// never had to agree about the same pixel, and #952's own 768px verification
// width is exactly the pixel that exposed it. Inclusive, to match the CSS.
const MOBILE_BREAKPOINT = 768;

// The race-selector pill sits directly on the nav's own `--scouting-blue`
// background with nothing else behind it, so an opaque `color-mix` against
// that same custom property renders the same colour as alpha-compositing
// white at the same weight would -- but as a single resolved value rather
// than a paint-time blend of a translucent layer under anti-aliased bold
// text. That was tried as the fix for dknowles2/trusty-track#918's ~40-image
// pill-glyph-only drift (two bootstrap passes against fresh CI runs had found
// the signature confined to the glyphs and never the pill's flat fill or
// border) and it did NOT close the gap: the identical signature, at a larger
// magnitude, reproduced against a baseline generated from this exact code --
// see .claude/rules/documentation.md's screenshot section for the
// measurements. Left in because it removes one candidate mechanism cleanly
// and is not wrong on its own terms, not because it fixed anything. Keep
// these as `color-mix` against `--scouting-blue` (never a hardcoded hex) so
// a themed install (#498) still renders the right colour.
const PILL_BACKGROUND = 'color-mix(in srgb, #ffffff 10%, var(--scouting-blue))';
const PILL_BACKGROUND_HOVER = 'color-mix(in srgb, #ffffff 20%, var(--scouting-blue))';
const PILL_BORDER = '1px solid color-mix(in srgb, #ffffff 20%, var(--scouting-blue))';

export default function Navigation() {
  const { hidden: chromeHidden } = useChrome();
  const { showAlert } = useAlert();
  const [{ data: navData, fetching: racesFetching }, reexecuteRacesNav] = useQuery({ query: GET_RACES_NAV });
  const races: { id: number; name: string; isLocked: boolean }[] = navData?.races || [];

  // #300: a race created, renamed or deleted in another tab (or another
  // device on the same network) left this list, and the browser tab's title
  // that reads off it, stale until a reload — `GET_RACES_NAV` was fetched
  // once on mount and nothing here ever asked again. `racesChanged` carries
  // no payload worth caching, so a signal on it means "go re-fetch" rather
  // than something to merge.
  const [racesChangedResult] = useSubscription({ query: RACES_CHANGED });
  useEffect(() => {
    if (racesChangedResult.data !== undefined) {
      reexecuteRacesNav({ requestPolicy: 'network-only' });
    }
  }, [racesChangedResult.data, reexecuteRacesNav]);

  const [{ data: configData }] = useQuery<GetInitialConfigStatusQuery>({ query: INITIAL_CONFIG_QUERY });
  const version = configData?.initialConfig?.version || '0.0.0';
  // Only shown when the install has a PIN. An event that never turned
  // enforcement on sees no lock at all, which is the point of it being off by
  // default (#15).
  const pinRequired = !!configData?.initialConfig?.pinRequired;
  const isOperator = configData?.initialConfig?.isOperator !== false;

  const [, createRaceMutation] = useMutation(CREATE_RACE);

  const [isRaceDropdownOpen, setIsRaceDropdownOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_BREAKPOINT);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setIsMobileMenuOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // The drawer's own entry for the race already on screen — scrolled into
  // view whenever the drawer opens, so a phone with several races does not
  // leave the operator hunting for the one they are already in (#952).
  const activeRaceRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isMobileMenuOpen) activeRaceRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isMobileMenuOpen]);

  const match = location.pathname.match(/\/race\/(\d+)/);
  const raceId = match ? match[1] : null;
  const activeRace = raceId ? races.find((r: { id: number; name: string; isLocked: boolean }) => r.id === parseInt(raceId)) : null;

  // Being on a race's own URL and having no answer from `GET_RACES_NAV` yet
  // (its first request in flight, or a background refetch that a
  // `createRace`/`racesChanged` cache invalidation just triggered) is not the
  // same as there being no race to select — the address bar already says
  // otherwise. `forgetRaceList` invalidates rather than splices, so there is
  // a real, if normally brief, window where `races` does not yet contain the
  // race whose page is on screen. "Select a Race" is only true once we can
  // actually rule the race out, i.e. once a request has *answered* and it is
  // still missing — not while one is still in flight.
  const raceContextUnresolved = !!raceId && !activeRace && (navData === undefined || racesFetching);

  const links: { to: string; label: string; icon: string }[] = [];
  if (raceId) {
      links.push(
        // The one row of race navigation. There used to be a second — a
        // Roster/Standings/Awards/Stats toggle rendered by four of these pages
        // — which put Standings and Stats on screen twice, in different words,
        // two rows apart. `Roster` is what this page is called on itself and
        // what an operator calls it, so the label came across with the merge.
        { to: `/race/${raceId}`, label: 'Roster', icon: mdiAccountGroup },
        { to: `/race/${raceId}/control`, label: 'Control', icon: mdiFlagCheckered },
        { to: `/race/${raceId}/standings`, label: 'Standings', icon: mdiTrophy },
        { to: `/race/${raceId}/awards`, label: 'Awards', icon: mdiMedal },
        { to: `/race/${raceId}/stats`, label: 'Stats', icon: mdiChartBar },
        { to: `/race/${raceId}/observation`, label: 'Live', icon: mdiVideo }
      );
  }

  // The URL still counts, because a display nobody has assigned anything
  // reaches projector mode that way — but an *assigned* full-screen view
  // changes no URL at all, so the view itself has to say so (#175).
  const isProjectorMode = new URLSearchParams(location.search).get('projector') === 'true';

  // The bottom tab bar (#952): one row of race navigation, reused rather than
  // a second hand-written list of the six views — "One row of race
  // navigation" above is what that rule is for. It shares the whole-nav
  // hide with the header, through the same `isProjectorMode`/`chromeHidden`
  // check the `return null` below makes, so an assigned full-screen display
  // on a phone gets no tab bar either.
  const showTabBar = isMobile && !!raceId && !isProjectorMode && !chromeHidden;

  // `position: fixed` does not reserve space in the document's own flow, so
  // without this the tab bar sits on top of whatever the page's last ~60px
  // of content is — a fixed footer needs the page to leave room for it, the
  // same `document.body.style` pattern `Modal.tsx` already uses for its own
  // scroll lock.
  useEffect(() => {
    document.body.style.paddingBottom = showTabBar ? '60px' : '';
    return () => { document.body.style.paddingBottom = ''; };
  }, [showTabBar]);

  const handleCreateRace = async (data: RaceSetupData) => {
    try {
      const raceInput = buildCreateRaceInput(data);
      const result = await createRaceMutation({ race: raceInput });
      if (result.error) throw result.error;

      const newRace = result.data.createRace;
      setShowCreateModal(false);
      navigate(`/race/${newRace.id}`);
    } catch (e) {
      console.error("Failed to create race", e);
      showAlert("Failed to create race", "Error");
    }
  };

  if (isProjectorMode || chromeHidden) return null;

  return (
    <>
      <nav style={{ backgroundColor: 'var(--scouting-blue)', color: 'var(--on-primary-color)', position: 'relative', zIndex: 1000, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem' }}>

          {/* Left: Logo & Home. The wordmark drops out once the mobile race
              pill needs the room — a phone under a race would otherwise show
              nothing that says which race it is in (#952). */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none', color: 'inherit', flexShrink: 0 }}>
            <img src={logoUrl} alt="Trusty Track Logo" style={{ height: '32px', width: 'auto' }} />
            {!(isMobile && raceId) && (
              <span style={{ fontSize: '1.2rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>Trusty Track</span>
            )}
          </Link>

          {/* Center, mobile: the race's own name, standing in for the row and
              the pill that are both hidden below 768px (#952). Opens the same
              drawer the hamburger does, scrolled to this race's own entry —
              there is no second "which race" surface to keep in step with
              this one. */}
          {isMobile && raceId && (
            <button
              data-testid="race-selector-pill-mobile"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open race menu"
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: 'none',
                border: 'none',
                color: 'var(--on-primary-color)',
                fontWeight: 'bold',
                fontSize: '0.95rem',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeRace ? activeRace.name : raceContextUnresolved ? '' : 'Select a Race'}
              </span>
              {activeRace?.isLocked && <LockedBadge size="small" />}
              <Icon path={mdiChevronDown} size={0.6} color="var(--on-primary-color)" style={{ opacity: 0.8, flexShrink: 0 }} />
            </button>
          )}

          {/* Center: Race Switcher (Hidden on Mobile) */}
          {!isMobile && (
            <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center' }}>
            <button
              data-testid="race-selector-pill"
              onClick={() => setIsRaceDropdownOpen(!isRaceDropdownOpen)}
              style={{
                background: PILL_BACKGROUND,
                border: PILL_BORDER,
                color: 'var(--on-primary-color)',
                padding: '5px 16px',
                borderRadius: '20px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = PILL_BACKGROUND_HOVER}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = PILL_BACKGROUND}
            >
              <Icon path={mdiFlagCheckered} size={0.8} color="var(--on-primary-color)" />
              {activeRace ? activeRace.name : raceContextUnresolved ? '' : 'Select a Race'}
              {activeRace?.isLocked && <LockedBadge size="small" />}
              <Icon path={isRaceDropdownOpen ? mdiChevronUp : mdiChevronDown} size={0.6} color="var(--on-primary-color)" style={{ opacity: 0.8 }} />
            </button>

            {isRaceDropdownOpen && (
              <>
                <div
                  onClick={() => setIsRaceDropdownOpen(false)}
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1001 }}
                />
                <div style={{
                  position: 'absolute',
                  top: '120%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'var(--surface-color)',
                  borderRadius: '10px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                  minWidth: '220px',
                  zIndex: 1002,
                  overflow: 'hidden',
                  padding: '6px',
                  border: '1px solid var(--divider-color)'
                }}>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {races.map((r: { id: number; name: string; isLocked: boolean }) => (
                      <Link
                        key={r.id}
                        to={`/race/${r.id}`}
                        onClick={() => setIsRaceDropdownOpen(false)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 18px',
                          textDecoration: 'none',
                          color: raceId === r.id.toString() ? 'var(--scouting-blue)' : 'var(--text-heading-alt-color)',
                          backgroundColor: raceId === r.id.toString() ? 'var(--surface-hover-color)' : 'transparent',
                          fontWeight: raceId === r.id.toString() ? 'bold' : '500',
                          fontSize: '0.9rem',
                          borderRadius: '6px',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => ! (raceId === r.id.toString()) && (e.currentTarget.style.backgroundColor = 'var(--surface-alt-color)')}
                        onMouseLeave={(e) => ! (raceId === r.id.toString()) && (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {r.name}
                        {r.isLocked && <LockedBadge size="small" />}
                      </Link>
                    ))}
                    {races.length === 0 && (
                      <div style={{ padding: '15px', color: 'var(--text-faint-color)', fontStyle: 'italic', fontSize: '0.9rem', textAlign: 'center' }}>No races found</div>
                    )}
                  </div>

                  {/* New Race Option */}
                  <div style={{ borderTop: '1px solid var(--divider-color)', marginTop: '4px', paddingTop: '4px' }}>
                    <button
                      onClick={() => {
                        setIsRaceDropdownOpen(false);
                        setShowCreateModal(true);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 18px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--scouting-blue)',
                        fontWeight: 'bold',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Icon path={mdiPlus} size={0.7} /> New Race...
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>
          )}

          {/* Right: Settings (Hidden on Mobile). The version stamp and the
              GitHub link used to live here too, as a stray 0.7rem two-line
              block with nothing else in the header at that size — "GitHub"
              read as a label floating below the header's own baseline in
              every screenshot (#946). Both are still reachable: the System
              Settings footer carries "Trusty Track v… • GitHub", and the
              mobile drawer's own footer keeps its version stamp. */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexShrink: 0 }}>
              {pinRequired && <UnlockButton isOperator={isOperator} />}
              <Link
                to="/system-settings"
                title="System Settings"
                style={{
                  textDecoration: 'none',
                  color: location.pathname === '/system-settings' ? 'var(--cub-scouting-gold)' : 'var(--on-primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: location.pathname === '/system-settings' ? 'rgba(255,255,255,0.15)' : 'transparent',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => ! (location.pathname === '/system-settings') && (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                onMouseLeave={(e) => ! (location.pathname === '/system-settings') && (e.currentTarget.style.background = 'transparent')}
              >
                <Icon path={mdiCog} size={0.9} />
                <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Settings</span>
              </Link>
            </div>
          )}

          {/* Mobile: Hamburger Menu Button */}
          {isMobile && (
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open Menu"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--on-primary-color)',
                padding: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Icon path={mdiMenu} size={1.2} />
            </button>
          )}
        </div>

        {/* Mobile Menu Drawer */}
        {isMobile && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setIsMobileMenuOpen(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'var(--overlay-backdrop-color)',
                zIndex: 2000,
                opacity: isMobileMenuOpen ? 1 : 0,
                visibility: isMobileMenuOpen ? 'visible' : 'hidden',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(4px)'
              }}
            />
            {/* Drawer */}
            <div
              data-testid="mobile-drawer"
              style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '280px',
              backgroundColor: 'var(--surface-color)',
              zIndex: 2001,
              boxShadow: '-5px 0 25px rgba(0,0,0,0.1)',
              transform: isMobileMenuOpen ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              visibility: isMobileMenuOpen ? 'visible' : 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Drawer Header */}
              <div style={{
                padding: '1.5rem',
                borderBottom: '1px solid var(--divider-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--scouting-blue)',
                color: 'var(--on-primary-color)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <img src={logoUrl} alt="Logo" style={{ height: '24px' }} />
                  <span style={{ fontWeight: 'bold' }}>Trusty Track</span>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-label="Close Menu"
                  style={{ background: 'none', border: 'none', color: 'var(--on-primary-color)', padding: '4px', cursor: 'pointer' }}
                >
                  <Icon path={mdiClose} size={1} />
                </button>
              </div>

              {/* Drawer Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-faint-color)', margin: '1rem 0 0.5rem 0.5rem', letterSpacing: '1px' }}>Races</h3>
                {races.map((r: { id: number; name: string; isLocked: boolean }) => (
                  <div key={r.id} ref={raceId === r.id.toString() ? activeRaceRowRef : undefined}>
                    <Link
                      to={`/race/${r.id}`}
                      onClick={() => setIsMobileMenuOpen(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '12px 16px',
                        textDecoration: 'none',
                        color: raceId === r.id.toString() ? 'var(--scouting-blue)' : 'var(--text-heading-alt-color)',
                        backgroundColor: raceId === r.id.toString() ? 'var(--surface-hover-color)' : 'transparent',
                        fontWeight: raceId === r.id.toString() ? 'bold' : '500',
                        borderRadius: '8px',
                        marginBottom: '4px'
                      }}
                    >
                      {r.name}
                      {r.isLocked && <LockedBadge size="small" />}
                    </Link>
                    {/* If this is the active race, show its sub-links */}
                    {raceId === r.id.toString() && (
                      <div style={{ marginLeft: '1rem', borderLeft: '2px solid var(--surface-hover-color)', paddingLeft: '0.5rem' }}>
                        {links.map(link => {
                          const isActive = link.to === activeNavLink(location.pathname, links);
                          return (
                          <Link
                            key={link.to}
                            to={link.to}
                            onClick={() => setIsMobileMenuOpen(false)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 16px',
                              textDecoration: 'none',
                              color: isActive ? 'var(--scouting-blue)' : 'var(--text-muted-color)',
                              fontSize: '0.9rem',
                              fontWeight: isActive ? 'bold' : '500'
                            }}
                          >
                            <Icon path={link.icon} size={0.7} />
                            {link.label}
                          </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    setShowCreateModal(true);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--scouting-blue)',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '0.5rem'
                  }}
                >
                  <Icon path={mdiPlus} size={0.8} /> New Race...
                </button>
              </div>

              {/* Drawer Footer - Pinned Settings */}
              <div style={{ borderTop: '1px solid var(--divider-color)', padding: '1rem' }}>
                {/* The drawer is a second navigation surface, not a mirror of
                    the header — a phone at the check-in desk only ever sees
                    this one, so the lock has to be reachable from here too. */}
                {pinRequired && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '0.8rem' }}>
                    <UnlockButton isOperator={isOperator} />
                  </div>
                )}
                <Link
                  to="/system-settings"
                  onClick={() => setIsMobileMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    textDecoration: 'none',
                    color: location.pathname === '/system-settings' ? 'var(--cub-scouting-gold)' : 'var(--scouting-blue)',
                    backgroundColor: location.pathname === '/system-settings' ? 'var(--highlight-blue-tint-color)' : 'transparent',
                    fontWeight: 'bold',
                    borderRadius: '8px'
                  }}
                >
                  <Icon path={mdiCog} size={0.9} />
                  System Settings
                </Link>
                <div
                  data-testid="app-version"
                  style={{ marginTop: '0.8rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-faint-color)' }}
                >
                  v{version}
                </div>
              </div>
            </div>
          </>
        )}
      </nav>

      {/* Secondary Header: Race Navigation (Hidden on Mobile) */}
      {raceId && !isMobile && (
        <div data-testid="race-nav" style={{
          backgroundColor: 'var(--surface-color)',
          borderBottom: '1px solid var(--border-color)',
          padding: '0.75rem 0',
          display: 'flex',
          justifyContent: 'center',
          gap: '2.5rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          position: 'relative',
          zIndex: 999
        }}>
          {links.map(link => {
            const isActive = link.to === activeNavLink(location.pathname, links);
            return (
              <Link
                key={link.to}
                to={link.to}
                style={{
                  textDecoration: 'none',
                  color: isActive ? 'var(--scouting-blue)' : 'var(--text-muted-color)',
                  fontWeight: 'bold',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  padding: '4px 8px',
                  borderBottom: `2px solid ${isActive ? 'var(--cub-scouting-gold)' : 'transparent'}`,
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
                onMouseEnter={(e) => !isActive && (e.currentTarget.style.color = 'var(--text-color)')}
                onMouseLeave={(e) => !isActive && (e.currentTarget.style.color = 'var(--text-muted-color)')}
               >
                <Icon path={link.icon} size={0.7} />
                {link.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom tab bar: the same one row of race navigation as the desktop
          secondary header above, `links` and all, just laid out for a thumb
          rather than a pointer (#952). Sharing `showTabBar` with the
          body-padding effect is what keeps the two in step — there is no
          second flag saying whether the bar is on screen. */}
      {showTabBar && (
        <nav
          data-testid="mobile-tab-bar"
          aria-label="Race navigation"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            display: 'flex',
            backgroundColor: 'var(--surface-color)',
            borderTop: '1px solid var(--border-color)',
            boxShadow: '0 -1px 4px rgba(0,0,0,0.08)',
          }}
        >
          {links.map(link => {
            const isActive = link.to === activeNavLink(location.pathname, links);
            return (
              <Link
                key={link.to}
                to={link.to}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  padding: '6px 2px 8px',
                  textDecoration: 'none',
                  color: isActive ? 'var(--scouting-blue)' : 'var(--text-muted-color)',
                  fontWeight: isActive ? 'bold' : '500',
                  fontSize: '0.65rem',
                }}
              >
                <Icon path={link.icon} size={0.75} />
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}

      {/* Create Race Modal */}
      <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create New Race Event"
          maxWidth="680px"
      >
          <RaceSetupWizard
              onSubmit={handleCreateRace}
              onCancel={() => setShowCreateModal(false)}
          />
      </Modal>
    </>
  );
}
