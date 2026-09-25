import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import LoadFailureBanner from '../components/LoadFailureBanner.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { navMatch, visibleNavigation } from '../config/navigation.js';
import { ConfirmDialog } from '../components/ui.jsx';
import NotificationBell from '../components/NotificationBell.jsx';

/**
 * Application shell.
 *
 * The structure follows Odoo's: a collapsible left rail, a compact control bar
 * carrying the breadcrumb, and the record area beneath it.
 *
 * The sidebar is an accordion rather than a flat list because the navigation is
 * twenty-seven links across nine groups. Rendering all of them at once made the
 * list taller than most screens, so a user scrolled the menu to find a screen
 * instead of reading it. Now one group is open - the one holding the current
 * page - and the rest are one click away.
 */

const COLLAPSED_KEY = 'si.nav.collapsed';
const OPEN_GROUPS_KEY = 'si.nav.openGroups';

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing - the preference simply does not persist */
  }
}

/**
 * One glyph per navigation group, drawn from primitives rather than path data
 * so they stay legible at 17px and need no icon dependency.
 */
const ICONS = {
  Dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  Masters: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="14" y2="18" />
    </>
  ),
  Orders: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </>
  ),
  Procurement: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <polyline points="2 3 5 3 8 15 19 15 21 7 6 7" />
    </>
  ),
  Stores: (
    <>
      <polyline points="3 8 12 3 21 8 21 17 12 22 3 17 3 8" />
      <line x1="3" y1="8" x2="12" y2="12.5" />
      <line x1="21" y1="8" x2="12" y2="12.5" />
    </>
  ),
  Processing: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <line x1="12" y1="5.5" x2="12" y2="2.5" />
      <line x1="12" y1="21.5" x2="12" y2="18.5" />
      <line x1="5.5" y1="12" x2="2.5" y2="12" />
      <line x1="21.5" y1="12" x2="18.5" y2="12" />
    </>
  ),
  'Plan Approval': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="8 12.5 11 15.5 16 9" />
    </>
  ),
  Cutting: (
    <>
      <circle cx="6.5" cy="18" r="2.3" />
      <circle cx="17.5" cy="18" r="2.3" />
      <line x1="8.2" y1="16.4" x2="19" y2="4" />
      <line x1="15.8" y1="16.4" x2="5" y2="4" />
    </>
  ),
  Administration: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
};

function NavIcon({ label }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[label] ?? <circle cx="12" cy="12" r="3.5" />}
    </svg>
  );
}

export default function AppLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY, false));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState(() => readStored(OPEN_GROUPS_KEY, []));

  const userMenuRef = useRef(null);

  const groups = useMemo(() => visibleNavigation(can), [can]);

  /*
   * WHERE AM I - asked once.
   *
   * Three things need the answer: the link that lights up, the group that
   * falls open, and the breadcrumb. They used to work it out separately, with
   * two copies of the same prefix loop and a third answer coming from React
   * Router's own `isActive`. Three matchers meant a path one of them handled
   * and the others did not - which is exactly how `/plan-approvals/:id` ended
   * up lighting no link at all.
   */
  const activeItem = useActiveItem(groups, location.pathname, location.search);

  /** The group holding the current page, which is the one worth opening. */
  const activeGroup = activeItem?.group ?? null;

  // Opening the current group is navigation state, not a stored preference: it
  // follows the address bar, including a link followed from another screen.
  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups([activeGroup]);
  }, [activeGroup]);

  useEffect(() => writeStored(OPEN_GROUPS_KEY, openGroups), [openGroups]);
  useEffect(() => writeStored(COLLAPSED_KEY, collapsed), [collapsed]);

  // A navigation closes the mobile drawer; on a phone the menu covers the page.
  useEffect(() => {
    setDrawerOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function onPointerDown(event) {
      if (!userMenuRef.current?.contains(event.target)) setUserMenuOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  /**
   * Typing in the filter box searches every group, so a user who knows the
   * screen name does not have to remember which group it sits under. The hint
   * is searched too: somebody who does not know the word "GRN" can type
   * "arrived" and still land on Goods Received.
   */
  const query = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const crumbs = useBreadcrumb(activeItem, location.pathname);

  /**
   * Collapsed, the sidebar is icons only and there is nowhere to show a group's
   * items - a flyout would be clipped by the scroll container. So a click on a
   * group icon expands the sidebar and opens that group, which is what the user
   * wanted to see anyway.
   *
   * One group open at a time: opening a group closes the others.
   */
  function toggleGroup(label) {
    if (collapsed) {
      setCollapsed(false);
      setOpenGroups([label]);
      return;
    }
    setOpenGroups((prev) => (prev.includes(label) ? [] : [label]));
  }

  async function handleLogout() {
    setBusy(true);
    await logout();
    setBusy(false);
    setConfirmingLogout(false);
    navigate('/login', { replace: true });
  }

  const shellClass = ['app-shell', collapsed ? 'nav-rail' : '', drawerOpen ? 'nav-drawer-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      <div className="nav-scrim" onClick={() => setDrawerOpen(false)} aria-hidden={!drawerOpen} />

      <nav className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">SI</span>
          <span className="brand-text">
            <strong>Sekawati Impex</strong>
          </span>
        </div>

        <div className="nav-filter">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a screen"
            aria-label="Filter navigation"
          />
        </div>

        <div className="nav-scroll">
          {shown.map((group) => {
            const isOpen = query ? true : openGroups.includes(group.label);
            return (
              <div className={`nav-group ${isOpen ? 'is-open' : ''}`} key={group.label}>
                <button
                  type="button"
                  className={`nav-group-toggle ${group.label === activeGroup ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={isOpen}
                  title={group.stage ? `Step ${group.stage} - ${group.label}` : group.label}
                >
                  {/* The pipeline position, at the START of the row where a
                      sequence reads - a numbered list, not a badge. It was on
                      the right beside the item count, and two numerals in two
                      pills said nothing about which was which: "Procurement 3
                      2" could as easily have been two items at stage 3. */}
                  <span className="nav-group-stage" aria-hidden="true">
                    {group.stage ?? ''}
                  </span>
                  <NavIcon label={group.label} />
                  <span className="nav-group-label">{group.label}</span>
                  <span className="nav-group-count">{group.items.length}</span>
                  <svg className="nav-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>

                {/* The inner wrapper is load-bearing: collapsing an auto height
                    with grid-template-rows needs exactly one child to clip. */}
                <div className="nav-items">
                  <div className="nav-items-inner">
                    {group.items.map((item) => {
                      /* A plain Link, not a NavLink. NavLink decides for
                         itself what "active" means, and it cannot know about
                         an entry's `covers` - so the class and the aria both
                         come from the one answer above, and they cannot
                         disagree with each other. */
                      const isActive = activeItem?.to === item.to;
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={`nav-link ${isActive ? 'active' : ''}`}
                          aria-current={isActive ? 'page' : undefined}
                          title={item.hint ? `${item.label} - ${item.hint}` : item.label}
                        >
                          <span className="nav-link-label">{item.label}</span>
                          {/* What the screen is FOR, in plain words, for staff
                              who do not know the trade name of the document. */}
                          {item.hint && <span className="nav-link-hint">{item.hint}</span>}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          {shown.length === 0 && <p className="nav-no-match">No screen matches that.</p>}
        </div>

        <div className="sidebar-footer">
          <span className="nav-role">{(user?.roles ?? []).map((r) => r.name).join(', ') || 'No role'}</span>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn nav-toggle-desktop"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>

          <button
            type="button"
            className="icon-btn nav-toggle-mobile"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>

          <nav className="breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((crumb, i) => (
              <span className="crumb" key={`${crumb}-${i}`}>
                {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
                <span className={i === crumbs.length - 1 ? 'crumb-current' : ''}>{crumb}</span>
              </span>
            ))}
          </nav>

          <NotificationBell />

          <div className="topbar-user" ref={userMenuRef}>
            <button
              type="button"
              className={`user-trigger ${userMenuOpen ? 'is-open' : ''}`}
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="avatar" aria-hidden="true">{initials(user?.fullName || user?.username)}</span>
              <span className="who">
                <strong>{user?.fullName}</strong>
                <span>{user?.employee?.empId ? `${user.employee.empId} · ` : ''}{user?.username}</span>
              </span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {userMenuOpen && (
              <div className="user-menu" role="menu">
                <div className="user-menu-head">
                  <strong>{user?.fullName}</strong>
                  <span>{(user?.roles ?? []).map((r) => r.name).join(', ') || 'No role'}</span>
                </div>
                <NavLink to="/change-password" className="user-menu-item" role="menuitem">
                  Change password
                </NavLink>
                <button
                  type="button"
                  className="user-menu-item danger"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setConfirmingLogout(true);
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content">
          <LoadFailureBanner />
          <Outlet />
        </main>
      </div>

      {confirmingLogout && (
        <ConfirmDialog
          title="Sign out"
          message="End this session and return to the sign-in screen?"
          confirmLabel="Sign out"
          busy={busy}
          onConfirm={handleLogout}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  );
}

/** Two letters for the avatar, from the full name where there is one. */
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Group / Screen / (what follows), read off the navigation config so the trail
 * never disagrees with the menu. A record id is shown as "Detail" rather than
 * as a raw uuid, which tells the reader nothing.
 */
function useBreadcrumb(active, pathname) {
  return useMemo(() => {
    if (!active) return ['Sekawati Impex'];

    const trail = active.group === active.label ? [active.label] : [active.group, active.label];
    /*
     * What is left after the part of the path the entry owns. For a plan
     * approval that is the id under `/plan-approvals`, not under `/approvals`
     * - which is why the matched prefix is carried here rather than recomputed
     * from `to`.
     */
    const rest = pathname.slice(active.path.length).split('/').filter(Boolean);
    if (rest.length > 0) {
      const last = rest[rest.length - 1];
      trail.push(UUID_RE.test(last) ? 'Detail' : last.charAt(0).toUpperCase() + last.slice(1));
    }
    return trail;
  }, [active, pathname]);
}

/**
 * The one navigation entry the current address belongs to.
 *
 * The longest match wins, so a more specific entry beats a shorter one that
 * merely prefixes it. `matchesQuery` keeps an entry that carries query
 * parameters from claiming the same path with different ones.
 *
 * Returns the entry's `to`, its labels and THE PREFIX THAT MATCHED - which is
 * not always `to`, since an entry may cover paths of its own. The breadcrumb
 * needs the prefix to know what part of the address is left over.
 */
function useActiveItem(groups, pathname, search) {
  return useMemo(() => {
    let best = null;
    for (const group of groups) {
      for (const item of group.items) {
        if (!matchesQuery(item.to, search)) continue;
        const path = navMatch(item, pathname);
        if (path && (!best || path.length > best.path.length)) {
          best = { path, to: item.to, label: item.label, group: group.label };
        }
      }
    }
    return best;
  }, [groups, pathname, search]);
}

/**
 * Whether a link's query string is the one currently showing.
 *
 * React Router's `isActive` compares paths and ignores the search string, so
 * Dyeing and Printing - which are the same path with a different `?process=` -
 * would both light up. This narrows it: a link that carries query parameters is
 * active only when the address bar carries the same ones.
 *
 * Links without a query string are unaffected, which is nearly all of them.
 */
function matchesQuery(to, currentSearch) {
  const [, linkQuery] = to.split('?');
  if (!linkQuery) return true;
  const current = new URLSearchParams(currentSearch);
  return [...new URLSearchParams(linkQuery)].every(([k, v]) => current.get(k) === v);
}
