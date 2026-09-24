/**
 * The bell in the top bar - work waiting for you, and decisions on your work.
 *
 * The unread count is polled once a minute and whenever the screen changes,
 * so a Director who approves something sees the maker's badge clear on the
 * maker's next click rather than at the next login. Opening the panel loads
 * the latest thirty; clicking one marks it read and opens the document.
 *
 * Settings (email / WhatsApp) live behind the gear in the panel. Channels the
 * server has no keys for are shown as unavailable rather than hidden, so
 * nobody wonders why ticking "WhatsApp" does nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { notifications as api } from '../services/erp.js';
import { fmtDateTime } from '../utils/format.js';
import { Alert, Field, Modal, TextInput } from './ui.jsx';

const POLL_MS = 60_000;

export default function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef(null);

  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const r = await api.unreadCount();
      setUnread(r?.unread ?? 0);
    } catch {
      // The bell is a convenience; a failed poll must never become an error
      // banner on whatever screen the person is actually using.
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(id);
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
  }, [location.pathname, refreshCount]);

  // Close on an outside click or Escape, like the user menu beside it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setRows(null);
      try {
        const r = await api.list({ limit: 30 });
        setRows(r.rows ?? []);
        setUnread(r.unread ?? 0);
      } catch {
        setRows([]);
      }
    }
  }

  async function openOne(n) {
    setOpen(false);
    if (!n.readAt) {
      api.markRead([n.id]).then(refreshCount).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    await api.markRead().catch(() => {});
    setRows((r) => (r ?? []).map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
  }

  return (
    <div className="notify" ref={ref}>
      <button
        type="button"
        className={`icon-btn notify-trigger ${open ? 'is-open' : ''}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notify-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notify-panel" role="dialog" aria-label="Notifications">
          <div className="notify-head">
            <strong>Notifications</strong>
            <span className="notify-head-actions">
              {unread > 0 && (
                <button type="button" className="link-button" onClick={markAll}>
                  Mark all read
                </button>
              )}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setOpen(false);
                  setSettings(true);
                }}
              >
                Settings
              </button>
            </span>
          </div>

          <div className="notify-list">
            {rows === null && <div className="notify-empty">Loading…</div>}
            {rows?.length === 0 && (
              <div className="notify-empty">Nothing yet. Approvals waiting for you and decisions on your documents appear here.</div>
            )}
            {rows?.map((n) => (
              <button
                type="button"
                key={n.id}
                className={`notify-item ${n.readAt ? '' : 'is-unread'}`}
                onClick={() => openOne(n)}
              >
                <span className="notify-title">{n.title}</span>
                {n.body && <span className="notify-body">{n.body}</span>}
                <span className="notify-time">{fmtDateTime(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {settings && <NotificationSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

function NotificationSettings({ onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .preferences()
      .then((p) => setPrefs({ ...p, whatsappNumber: p.whatsappNumber ?? '' }))
      .catch((e) => setError(e.message));
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const p = await api.setPreferences({
        notifyByEmail: prefs.notifyByEmail,
        notifyByWhatsapp: prefs.notifyByWhatsapp,
        whatsappNumber: prefs.whatsappNumber || null,
      });
      setPrefs({ ...p, whatsappNumber: p.whatsappNumber ?? '' });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Notification settings"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !prefs}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>
        {saved && <Alert kind="success">Saved.</Alert>}
        <p style={{ marginTop: 0 }}>
          You always see notifications here in the app. These add other places to be told.
        </p>
        {prefs && (
          <>
            <Field
              label="Email"
              hint={
                !prefs.channels?.email
                  ? 'Email is not set up on the server yet.'
                  : prefs.email
                    ? `Sent to ${prefs.email}.`
                    : 'Your user has no email address - ask an administrator to add one.'
              }
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(prefs.notifyByEmail)}
                  onChange={(e) => setPrefs((p) => ({ ...p, notifyByEmail: e.target.checked }))}
                />{' '}
                Email me
              </label>
            </Field>
            <Field
              label="WhatsApp"
              hint={!prefs.channels?.whatsapp ? 'WhatsApp is not set up on the server yet.' : 'Country code first, digits only - 919876543210.'}
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(prefs.notifyByWhatsapp)}
                  onChange={(e) => setPrefs((p) => ({ ...p, notifyByWhatsapp: e.target.checked }))}
                />{' '}
                Send to WhatsApp
              </label>
              <TextInput
                inputMode="numeric"
                placeholder="919876543210"
                value={prefs.whatsappNumber}
                onChange={(e) => setPrefs((p) => ({ ...p, whatsappNumber: e.target.value }))}
                style={{ marginTop: 6 }}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
