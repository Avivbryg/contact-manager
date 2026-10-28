import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import {
  getContactGroups,
  getContacts,
  getContact,
  batchDeleteContacts,
  buildContactUpdate,
  updateContact,
  GoogleContact,
  ContactGroup,
  modifyContactGroupMembers,
  createContactGroup,
  getUserGroupIds,
} from '../lib/contacts';
import { AuthExpiredError, googleSignIn, logout } from '../lib/auth';
import { syncQueue, useSyncState } from '../lib/syncQueue';
import {
  Stage,
  SortSession,
  SessionStats,
  loadSession,
  saveSession,
  loadSettings,
  saveSettings,
  loadWhatsAppPending,
  saveWhatsAppPending,
} from '../lib/session';
import { whatsAppUrl } from '../lib/phone';
import { RefreshCw, CheckCircle, Edit3, Trash2, Sparkles, Users, Smartphone, AlertTriangle, MessageCircle, Package, LogOut, StickyNote, Loader2, Briefcase } from 'lucide-react';
import SwipeCardDeck, { STAGE_LABELS } from './SwipeCardDeck';
import ContactEditor, { ContactDraft } from './ContactEditor';
import { knownCompanies } from '../lib/company';

const ContactsChart = lazy(() => import('./ContactsChart'));

// The box for contacts we can't place yet. It's a regular Google Contacts label.
export const BOX_NAME = "📦 פיצ'יפקעס";
const DELETE_UNDO_MS = 4000;
const EMPTY_STATS: SessionStats = { ok: 0, boxed: 0, edited: 0, deleted: 0 };


interface HistoryEntry {
  index: number;
  resourceName: string;
  stat: keyof SessionStats;
  // Reverses the Google-side change, when there is one that can be reversed
  revert?: () => void;
}

const userGroupIdSet = (groups: ContactGroup[]) =>
  new Set(groups.filter(g => g.groupType === 'USER_CONTACT_GROUP').map(g => g.resourceName));

const findBox = (groups: ContactGroup[]) =>
  groups.find(g => g.groupType === 'USER_CONTACT_GROUP' && (g.name === BOX_NAME || g.formattedName === BOX_NAME));

/** Sorting: contacts without any label. Unboxing: contacts in the box. */
const qualifiesFor = (stage: Stage, contact: GoogleContact, userGroupIds: Set<string>, boxId?: string) =>
  stage === 'sorting'
    ? getUserGroupIds(contact, userGroupIds).length === 0
    : !!boxId && contact.memberships.includes(boxId);

const shuffle = <T,>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Re-aligns a saved session with fresh data: drops deleted contacts and ones that no longer belong to the stage. */
const normalizeSession = (session: SortSession, contacts: GoogleContact[], groups: ContactGroup[]): SortSession | null => {
  const byRn = new Map(contacts.map(c => [c.resourceName, c]));
  const ids = userGroupIdSet(groups);
  const boxId = findBox(groups)?.resourceName;
  const done = session.order.slice(0, session.index).filter(rn => byRn.has(rn));
  const rest = session.order.slice(session.index).filter(rn => {
    const c = byRn.get(rn);
    return c && qualifiesFor(session.stage, c, ids, boxId);
  });
  if (rest.length === 0 && !session.active) return null;
  return { ...session, order: [...done, ...rest], index: done.length };
};

async function applyEdit(contact: GoogleContact, draft: ContactDraft, userGroupIds: Set<string>) {
  const { body, updatePersonFields } = buildContactUpdate(contact, draft);
  if (updatePersonFields) {
    await updateContact(contact.resourceName, body, updatePersonFields);
  }

  // Only user-created labels are moved between; system groups (e.g. myContacts) are never touched
  if (draft.contactGroupId !== undefined && draft.contactGroupId !== 'new') {
    const oldGroupId = getUserGroupIds(contact, userGroupIds)[0] || '';
    const newGroupId = draft.contactGroupId;
    if (oldGroupId !== newGroupId) {
      if (oldGroupId) await modifyContactGroupMembers(oldGroupId, [], [contact.resourceName]);
      if (newGroupId) await modifyContactGroupMembers(newGroupId, [contact.resourceName], []);
    }
  }
}

export default function PhoneContacts() {
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);

  const [session, setSession] = useState<SortSession | null>(() => loadSession());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ resourceName: string, name: string } | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [isReauthing, setIsReauthing] = useState(false);
  const sync = useSyncState();

  // Phone / Swiping Mode - defaults to true on mobile screens or touch devices
  const [isPhoneMode, setIsPhoneMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768 || ('ontouchstart' in window);
    }
    return true;
  });

  const [showChart, setShowChart] = useState(true);

  const userGroups = useMemo(
    () => contactGroups.filter(g => g.groupType === 'USER_CONTACT_GROUP'),
    [contactGroups]
  );
  const userGroupIds = useMemo(() => userGroupIdSet(contactGroups), [contactGroups]);
  const boxGroup = useMemo(() => findBox(contactGroups), [contactGroups]);
  const contactsByRn = useMemo(() => new Map(contacts.map(c => [c.resourceName, c])), [contacts]);
  const companies = useMemo(() => knownCompanies(contacts), [contacts]);

  const sortingCount = useMemo(
    () => contacts.filter(c => qualifiesFor('sorting', c, userGroupIds)).length,
    [contacts, userGroupIds]
  );
  const boxCount = useMemo(
    () => contacts.filter(c => qualifiesFor('unboxing', c, userGroupIds, boxGroup?.resourceName)).length,
    [contacts, userGroupIds, boxGroup]
  );

  const chartData = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassignedCount = 0;

    contacts.forEach(c => {
        const primaryGroup = getUserGroupIds(c, userGroupIds)[0];
        if (!primaryGroup) {
            unassignedCount++;
        } else {
            counts[primaryGroup] = (counts[primaryGroup] || 0) + 1;
        }
    });

    const data = Object.keys(counts).map(resourceName => ({
        name: userGroups.find(g => g.resourceName === resourceName)?.formattedName || resourceName,
        value: counts[resourceName]
    }));

    if (unassignedCount > 0) {
        data.push({
            name: 'ללא תווית',
            value: unassignedCount
        });
    }

    return data.sort((a, b) => b.value - a.value);
  }, [contacts, userGroups, userGroupIds]);

  const isFinished = !!session && session.index >= session.order.length;
  const current = session?.active && !isFinished ? contactsByRn.get(session.order[session.index]) ?? null : null;
  const nextContact = session && current
    ? session.order.slice(session.index + 1).map(rn => contactsByRn.get(rn)).find(Boolean) ?? null
    : null;

  // Refs for handlers that outlive a render (timers, document listeners, queued operations)
  const userGroupIdsRef = useRef(userGroupIds);
  userGroupIdsRef.current = userGroupIds;
  const contactsByRnRef = useRef(contactsByRn);
  contactsByRnRef.current = contactsByRn;
  const currentRnRef = useRef<string | null>(null);
  currentRnRef.current = current?.resourceName ?? null;
  const pendingDeleteRef = useRef<{ resourceName: string, name: string, timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => { saveSession(session); }, [session]);
  useEffect(() => { saveSettings(settings); }, [settings]);

  /** Loads groups and contacts from Google. */
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [groupsData, contactsData] = await Promise.all([
        getContactGroups(),
        getContacts()
      ]);
      setContactGroups(groupsData);
      setContacts(contactsData);
      setSession(s => s && normalizeSession(s, contactsData, groupsData));
    } catch (e) {
      console.error(e);
      if (e instanceof AuthExpiredError) {
        // Back to the login screen
        await logout();
      } else {
        alert(`נכשל בטעינת אנשי הקשר. ודא שיש הרשאות תקינות.\n\n${e instanceof Error ? e.message : ''}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ---- Optimistic local updates + background sync ----

  const patchContact = (resourceName: string, patch: (c: GoogleContact) => GoogleContact) =>
    setContacts(prev => prev.map(c => c.resourceName === resourceName ? patch(c) : c));

  const setMembership = (resourceName: string, groupId: string, member: boolean) => {
    patchContact(resourceName, c => ({
      ...c,
      memberships: member
        ? [...c.memberships.filter(m => m !== groupId), groupId]
        : c.memberships.filter(m => m !== groupId)
    }));
    syncQueue.enqueue(`${member ? 'add to' : 'remove from'} ${groupId}: ${resourceName}`, async () => {
      await modifyContactGroupMembers(groupId, member ? [resourceName] : [], member ? [] : [resourceName]);
    });
  };

  const queueEdit = (resourceName: string, edit: ContactDraft) => {
    syncQueue.enqueue(`edit ${resourceName}`, async () => {
      // Fresh copy: earlier label changes alter the etag, and the edit must not overwrite newer data
      const fresh = await getContact(resourceName);
      await applyEdit(fresh, edit, userGroupIdsRef.current);
    });
  };

  const commitPendingDelete = () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    deleteNow(pending.resourceName);
  };

  const deleteNow = (resourceName: string) => {
    setContacts(prev => prev.filter(c => c.resourceName !== resourceName));
    syncQueue.enqueue(`delete ${resourceName}`, () => batchDeleteContacts([resourceName]));
  };

  // ---- Session actions ----

  const record = (entry: Omit<HistoryEntry, 'index'>) => {
    if (!session) return;
    setHistory(h => [...h, { ...entry, index: session.index }]);
    setSession(s => s && { ...s, index: s.index + 1, stats: { ...s.stats, [entry.stat]: s.stats[entry.stat] + 1 } });
  };

  const handleOk = () => {
    if (!current || !session) return;
    const rn = current.resourceName;
    if (session.stage === 'unboxing' && boxGroup) {
      const boxId = boxGroup.resourceName;
      setMembership(rn, boxId, false);
      record({ resourceName: rn, stat: 'ok', revert: () => setMembership(rn, boxId, true) });
    } else {
      record({ resourceName: rn, stat: 'ok' });
    }
  };

  const handleBox = () => {
    if (!current || !session) return;
    const rn = current.resourceName;
    if (session.stage === 'sorting') {
      if (!boxGroup) {
        alert('הקופסה עוד לא מוכנה. נסה שוב בעוד רגע.');
        return;
      }
      const boxId = boxGroup.resourceName;
      setMembership(rn, boxId, true);
      record({ resourceName: rn, stat: 'boxed', revert: () => setMembership(rn, boxId, false) });
    } else {
      // Unboxing: stays in the box for another round
      record({ resourceName: rn, stat: 'boxed' });
    }
  };

  const handleDelete = () => {
    if (!current || !session) return;
    const rn = current.resourceName;
    const name = `${current.firstName} ${current.lastName}`.trim() || current.phone || 'איש קשר';

    if (settings.confirmDelete) {
      if (!confirm(`למחוק את ${name}?`)) return;
      deleteNow(rn);
    } else {
      // One pending delete at a time: a new delete sends the previous one right away
      commitPendingDelete();
      const timer = setTimeout(commitPendingDelete, DELETE_UNDO_MS);
      pendingDeleteRef.current = { resourceName: rn, name, timer };
      setPendingDelete({ resourceName: rn, name });
    }
    record({ resourceName: rn, stat: 'deleted' });
  };

  const handleUndo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    if (last.stat === 'deleted') {
      if (pendingDeleteRef.current?.resourceName === last.resourceName) {
        clearTimeout(pendingDeleteRef.current.timer);
        pendingDeleteRef.current = null;
        setPendingDelete(null);
      } else {
        alert('איש הקשר כבר נמחק ואי אפשר לבטל מכאן.');
        setHistory(h => h.slice(0, -1));
        return;
      }
    }
    last.revert?.();
    setHistory(h => h.slice(0, -1));
    setSession(s => s && { ...s, index: last.index, stats: { ...s.stats, [last.stat]: Math.max(0, s.stats[last.stat] - 1) } });
  };

  /** The undo bubble: cancels the pending delete even if the user already moved on. */
  const handleUndoPendingDelete = () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    const last = history[history.length - 1];
    if (last?.resourceName === pending.resourceName) {
      handleUndo();
      return;
    }
    clearTimeout(pending.timer);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    setHistory(h => h.filter(e => !(e.stat === 'deleted' && e.resourceName === pending.resourceName)));
    setSession(s => s && { ...s, stats: { ...s.stats, deleted: Math.max(0, s.stats.deleted - 1) } });
  };

  const handleStartEdit = () => {
    if (!current) return;
    setDraft({
        ...current,
        contactGroupId: getUserGroupIds(current, userGroupIds)[0] || '',
    });
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setDraft(null);
  };

  const handleCreateGroup = async (name: string) => {
    const created = await createContactGroup(name);
    const group = { ...created, groupType: created.groupType || 'USER_CONTACT_GROUP' };
    setContactGroups(prev => [...prev, group]);
    return group;
  };

  const handleSaveEdit = () => {
    if (!current || !draft) return;
    const rn = current.resourceName;
    const oldGroupId = getUserGroupIds(current, userGroupIds)[0] || '';
    const newGroupId = draft.contactGroupId;
    patchContact(rn, c => {
      let memberships = c.memberships;
      if (newGroupId !== undefined && newGroupId !== 'new' && newGroupId !== oldGroupId) {
        memberships = memberships.filter(m => m !== oldGroupId);
        if (newGroupId) memberships = [...memberships, newGroupId];
      }
      return {
        ...c,
        firstName: draft.firstName ?? c.firstName,
        lastName: draft.lastName ?? c.lastName,
        phone: draft.phone ?? c.phone,
        email: draft.email ?? c.email,
        note: draft.note ?? c.note,
        company: draft.company?.trim() ?? c.company,
        jobTitle: draft.jobTitle?.trim() ?? c.jobTitle,
        birthday: draft.birthday?.trim() ?? c.birthday,
        address: draft.address?.trim() ?? c.address,
        memberships
      };
    });
    queueEdit(rn, draft);
    record({ resourceName: rn, stat: 'edited' });
    closeEditor();
  };

  // ---- "So, who's this?" after returning from WhatsApp ----

  const openNote = (resourceName: string) => {
    setNoteDraft(contactsByRnRef.current.get(resourceName)?.note || '');
    setNoteFor(resourceName);
  };

  const handleWhatsAppOpen = () => {
    if (current) saveWhatsAppPending(current.resourceName);
  };

  const handleSaveNote = () => {
    if (!noteFor) return;
    const note = noteDraft.trim();
    if (note !== (contactsByRn.get(noteFor)?.note || '')) {
      patchContact(noteFor, c => ({ ...c, note }));
      queueEdit(noteFor, { note });
    }
    setNoteFor(null);
  };

  // Leaving the page (e.g. to WhatsApp) sends a pending delete; coming back asks who it was
  const visibilityHandlerRef = useRef<() => void>(() => {});
  visibilityHandlerRef.current = () => {
    if (document.visibilityState === 'hidden') {
      commitPendingDelete();
      return;
    }
    const rn = loadWhatsAppPending();
    if (!rn) return;
    saveWhatsAppPending(null);
    if (rn === currentRnRef.current) openNote(rn);
  };
  useEffect(() => {
    const handler = () => visibilityHandlerRef.current();
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // The phone may have discarded the tab while in WhatsApp: ask once the page reloads
  useEffect(() => {
    if (isLoading || !current) return;
    if (loadWhatsAppPending() === current.resourceName) {
      saveWhatsAppPending(null);
      openNote(current.resourceName);
    }
  }, [isLoading]);

  // Skip contacts that vanished (e.g. deleted elsewhere) while the session was saved
  useEffect(() => {
    // An empty list means loading failed, not that everyone was deleted - don't skip through the session
    if (isLoading || contacts.length === 0 || !session?.active || isFinished) return;
    if (!contactsByRn.has(session.order[session.index])) {
      setSession(s => s && { ...s, index: s.index + 1 });
    }
  }, [isLoading, session, contactsByRn, isFinished]);

  // ---- Starting and leaving ----

  const startSession = async (stage: Stage) => {
    let groups = contactGroups;
    if (stage === 'sorting' && !boxGroup) {
      setIsPreparing(true);
      try {
        const created = await createContactGroup(BOX_NAME);
        groups = [...contactGroups, { ...created, groupType: created.groupType || 'USER_CONTACT_GROUP' }];
        setContactGroups(groups);
      } catch (e) {
        console.error(e);
        if (e instanceof AuthExpiredError) await logout();
        else alert('לא הצלחתי ליצור את הקופסה בגוגל. נסה שוב.');
        return;
      } finally {
        setIsPreparing(false);
      }
    }

    const ids = userGroupIdSet(groups);
    const boxId = findBox(groups)?.resourceName;
    const order = contacts.filter(c => qualifiesFor(stage, c, ids, boxId)).map(c => c.resourceName);
    if (order.length === 0) {
      alert(stage === 'sorting' ? 'כל אנשי הקשר כבר מסודרים!' : 'הקופסה ריקה.');
      return;
    }
    setHistory([]);
    setSession({ stage, order: shuffle(order), index: 0, stats: EMPTY_STATS, active: true });
  };

  const handleSaveAndExit = () => {
    commitPendingDelete();
    closeEditor();
    setHistory([]);
    setSession(s => s && { ...s, active: false });
  };

  const handleFinish = () => {
    commitPendingDelete();
    setHistory([]);
    setSession(null);
  };

  const handleReauth = async () => {
    setIsReauthing(true);
    try {
      await googleSignIn();
      syncQueue.retry();
    } catch (e) {
      console.error(e);
      alert('ההתחברות נכשלה. נסה שוב.');
    } finally {
      setIsReauthing(false);
    }
  };

  // Keyboard: → OK, ← edit, ↓ box, ↑ delete, Ctrl+Z undo
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (!current || editing || noteFor) return;
    const actions: Record<string, () => void> = {
      ArrowRight: handleOk,
      ArrowLeft: handleStartEdit,
      ArrowDown: handleBox,
      ArrowUp: handleDelete,
    };
    if (actions[e.key]) {
      e.preventDefault();
      actions[e.key]();
    } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleUndo();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- Rendering ----

  const syncBanner = sync.failed > 0 && (
    <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-sm shrink-0">
      <div className="flex gap-2 mb-2 font-medium">
        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
        <span>
          {sync.authExpired
            ? `פג תוקף ההתחברות לגוגל. ${sync.failed} שינויים ממתינים לשמירה.`
            : `${sync.failed} שינויים לא נשמרו בגוגל.`}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={sync.authExpired ? handleReauth : () => syncQueue.retry()}
          disabled={isReauthing}
          className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg py-2 font-bold transition"
        >
          {sync.authExpired ? 'התחבר מחדש ושמור' : 'נסה שוב'}
        </button>
        {!sync.authExpired && (
          <button
            onClick={() => { if (confirm('לוותר על השינויים שלא נשמרו?')) syncQueue.discardFailed(); }}
            className="px-4 bg-white border border-amber-200 rounded-lg py-2 font-medium"
          >
            ותר
          </button>
        )}
      </div>
    </div>
  );

  if (isLoading) {
    return <div className="p-10 flex text-slate-500 justify-center h-full items-center"><RefreshCw className="animate-spin w-6 h-6 ml-2"/> מביא את הנתונים מגוגל...</div>;
  }

  // Finished a round
  if (session?.active && isFinished) {
    const { stats } = session;
    return (
        <div className="flex-1 flex flex-col overflow-y-auto">
          {syncBanner}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-lg p-8 text-center border border-slate-100">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
                 <Sparkles className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="font-bold text-2xl text-slate-800 mb-6">
                {session.stage === 'sorting' ? 'סיימת את סבב המיון!' : 'סיימת לעבור על הקופסה!'}
              </h3>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <StatTile value={stats.ok} label={STAGE_LABELS[session.stage].ok} color="emerald" />
                <StatTile value={stats.boxed} label={STAGE_LABELS[session.stage].box} color="amber" />
                <StatTile value={stats.edited} label="נערכו" color="blue" />
                <StatTile value={stats.deleted} label="נמחקו" color="rose" />
              </div>

              {sync.pending > 0 && (
                <p className="text-slate-500 mb-4 text-sm flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> שומר בגוגל ({sync.pending})...
                </p>
              )}

              {session.stage === 'sorting' && boxCount > 0 && (
                <button
                   onClick={() => startSession('unboxing')}
                   className="w-full mb-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl py-4 font-bold transition text-lg flex items-center justify-center gap-2"
                >
                  <Package className="w-5 h-5" /> פתח את הקופסה ({boxCount})
                </button>
              )}
              <button
                 onClick={handleFinish}
                 className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-4 font-medium transition text-lg"
              >
                למסך הראשי
              </button>
            </div>
          </div>
        </div>
    );
  }

  if (session?.active && current) {
    const labels = STAGE_LABELS[session.stage];
    const currentWhatsApp = current.phone ? whatsAppUrl(current.phone) : null;

    return (
      <div className="flex-1 flex flex-col overflow-y-auto w-full max-w-md mx-auto">
        {syncBanner}
        <div className="flex-1 p-3 sm:p-4 flex flex-col">
        <div className="flex justify-between items-center mb-3 px-1 shrink-0 gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-1.5">
              {session.stage === 'sorting' ? 'מיון' : <><Package className="w-5 h-5 text-amber-500" /> הקופסה</>}
            </h2>
            <button
              onClick={() => setIsPhoneMode(prev => !prev)}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border transition ${
                isPhoneMode
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
              title={isPhoneMode ? 'החלף לתצוגה רגילה' : 'החלף למצב החלקה'}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{isPhoneMode ? 'החלקה' : 'רגיל'}</span>
            </button>
            {sync.pending > 0 && (
              <span className="text-slate-400" title="שומר בגוגל">
                <Loader2 className="w-4 h-4 animate-spin" />
              </span>
            )}
          </div>
          <button
            onClick={handleSaveAndExit}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-1.5 rounded-full transition"
          >
            <LogOut className="w-4 h-4" /> שמור וצא
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {editing ? (
            <ContactEditor
              draft={draft || {}}
              onChange={setDraft}
              userGroups={userGroups}
              companies={companies}
              settings={settings}
              onSettingsChange={setSettings}
              onCreateGroup={handleCreateGroup}
              onSave={handleSaveEdit}
              onCancel={closeEditor}
            />
          ) : isPhoneMode ? (
            <SwipeCardDeck
              currentContact={current}
              nextContact={nextContact}
              currentIndex={session.index}
              totalCount={session.order.length}
              contactGroups={contactGroups}
              stage={session.stage}
              onOk={handleOk}
              onEdit={handleStartEdit}
              onBox={handleBox}
              onDelete={handleDelete}
              onUndo={handleUndo}
              canUndo={history.length > 0}
              onWhatsAppOpen={handleWhatsAppOpen}
            />
          ) : (
            /* Classic Card Mode (for Desktop / Non-Phone mode) */
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col items-center text-center flex-1">
              <div className="w-full flex justify-between flex-col h-full py-2">
                <div className="text-xs font-semibold text-slate-400 mb-2">{session.index + 1} מתוך {session.order.length}</div>
                <div className="flex-1 flex flex-col justify-center items-center">
                    <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-4xl font-bold mx-auto mb-6">
                    {current.firstName?.[0] || current.lastName?.[0] || '?'}
                    </div>
                    <h3 className="text-3xl font-bold text-slate-800 mb-1">{current.firstName} {current.lastName}</h3>
                    {(current.company || current.jobTitle) && (
                        <div className="flex items-center gap-1.5 text-slate-500 mb-2">
                            <Briefcase className="w-4 h-4 text-slate-400" />
                            {[current.jobTitle, current.company].filter(Boolean).join(' · ')}
                        </div>
                    )}
                    {currentWhatsApp ? (
                        <a
                            href={currentWhatsApp}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={handleWhatsAppOpen}
                            title="פתח צ'אט בוואטסאפ כדי לזהות את איש הקשר"
                            className="inline-flex items-center gap-2 text-lg text-slate-600 mb-1 font-mono bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 px-3 py-1 rounded-xl transition"
                            dir="ltr"
                        >
                            {current.phone}
                            <MessageCircle className="w-4 h-4 text-emerald-600" />
                        </a>
                    ) : (
                        <div className="text-lg text-slate-500 mb-1 font-mono" dir="ltr">{current.phone || 'אין מספר טלפון'}</div>
                    )}
                    <div className="text-slate-400 font-mono text-sm" dir="ltr">{current.email || 'אין אימייל'}</div>
                    {current.note && (
                        <div className="mt-3 flex items-start gap-1.5 text-sm text-slate-600 bg-amber-50/60 py-1.5 px-3 rounded-xl max-w-xs">
                            <StickyNote className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <span className="text-right">{current.note}</span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-4 gap-2 w-full mt-auto pt-8 shrink-0">
                  <ClassicButton onClick={handleOk} icon={<CheckCircle className="w-7 h-7 text-green-500" />} label={labels.ok} hint="→" className="bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700" />
                  <ClassicButton onClick={handleStartEdit} icon={<Edit3 className="w-7 h-7 text-blue-500" />} label="ערוך" hint="←" className="bg-slate-50 hover:bg-slate-100 border-slate-200 text-blue-700" />
                  <ClassicButton onClick={handleBox} icon={<Package className="w-7 h-7 text-amber-500" />} label={labels.box} hint="↓" className="bg-amber-50 hover:bg-amber-100 border-amber-100 text-amber-800" />
                  <ClassicButton onClick={handleDelete} icon={<Trash2 className="w-7 h-7 text-red-500" />} label="מחק" hint="↑" className="bg-red-50 hover:bg-red-100 border-red-100 text-red-700" />
                </div>
                {history.length > 0 && (
                  <button onClick={handleUndo} className="mt-3 text-sm text-slate-500 hover:text-slate-800">בטל פעולה אחרונה (Ctrl+Z)</button>
                )}
              </div>
            </div>
          )}
        </div>
        </div>

        {/* Delete undo bubble */}
        {pendingDelete && (
          <div className="fixed bottom-4 inset-x-4 max-w-md mx-auto z-40 bg-slate-900 text-white rounded-2xl shadow-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm truncate">נמחק: {pendingDelete.name}</span>
            <button onClick={handleUndoPendingDelete} className="text-amber-300 font-bold text-sm shrink-0">בטל</button>
          </div>
        )}

        {/* "So, who's this?" after WhatsApp */}
        {noteFor && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-4" onClick={() => setNoteFor(null)}>
            <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold text-slate-800 mb-1">אז מי זה?</h3>
              <p className="text-sm text-slate-500 mb-4">
                {(() => { const c = contactsByRn.get(noteFor); return c ? `${c.firstName} ${c.lastName}`.trim() || c.phone : ''; })()}
              </p>
              <textarea
                className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition resize-none"
                rows={3}
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                placeholder="איך אנחנו מכירים? למשל: חבר של יוסי מהצבא"
                autoFocus
              />
              <div className="flex gap-3 mt-4">
                <button onClick={handleSaveNote} className="flex-1 bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3 font-bold transition">שמור הערה</button>
                <button onClick={() => setNoteFor(null)} className="px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-3 font-medium transition">לא עכשיו</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Home screen
  const primaryStage: Stage = sortingCount > 0 ? 'sorting' : 'unboxing';
  const primaryCount = primaryStage === 'sorting' ? sortingCount : boxCount;
  const resumable = session && !session.active && session.index < session.order.length ? session : null;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto w-full max-w-md mx-auto">
      {syncBanner}
      <div className="flex-1 p-4 flex flex-col">
      <div className="text-center mt-3 mb-6 relative">
         <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
             <Users className="w-8 h-8" />
         </div>
         <h2 className="text-2xl font-bold text-slate-800">מוכנים לסדר?</h2>
         <p className="text-slate-500 mt-1.5 text-sm">
           קודם ממיינים מהר: מי שלא מזהים נכנס לקופסה. אחר כך פותחים את הקופסה בנחת.
         </p>

         {resumable && (
           <button
             onClick={() => setSession({ ...resumable, active: true })}
             className="w-full mt-5 py-4 rounded-2xl font-bold text-lg text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition shadow-md"
           >
             המשך מאיפה שהפסקת ({resumable.order.length - resumable.index} נותרו)
           </button>
         )}

         <button
           onClick={() => startSession(primaryStage)}
           disabled={primaryCount === 0 || isPreparing}
           className={`w-full mt-5 py-4 rounded-2xl font-bold text-lg text-white active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md ${
             primaryStage === 'sorting' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-500 hover:bg-amber-600'
           }`}
         >
           {isPreparing ? <Loader2 className="w-5 h-5 animate-spin" /> : primaryStage === 'sorting' ? <Sparkles className="w-5 h-5" /> : <Package className="w-5 h-5" />}
           {primaryStage === 'sorting'
             ? `${resumable ? 'סבב מיון חדש' : 'התחל מיון'} (${sortingCount} בלי תווית)`
             : boxCount > 0 ? `פתח את הקופסה (${boxCount})` : 'הכל מסודר!'}
         </button>

         {primaryStage === 'sorting' && boxCount > 0 && (
           <button
             onClick={() => startSession('unboxing')}
             className="w-full mt-3 py-3 rounded-2xl font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition flex items-center justify-center gap-2"
           >
             <Package className="w-4 h-4" /> פתח את הקופסה כבר עכשיו ({boxCount})
           </button>
         )}

         <button
           onClick={() => setShowChart(!showChart)}
           className="mt-3.5 text-xs text-blue-600 font-medium hover:text-blue-700 mx-auto block"
         >
             {showChart ? 'הסתר תרשים התפלגות' : 'הצג תרשים התפלגות'}
         </button>
      </div>

      {showChart && chartData.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 text-center">התפלגות אנשי קשר</h3>
              <Suspense fallback={<div className="h-48 flex items-center justify-center"><RefreshCw className="animate-spin w-5 h-5 text-slate-400"/></div>}>
                  <ContactsChart data={chartData} />
              </Suspense>
          </div>
      )}

      <label className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-6 flex items-center gap-3 text-sm text-slate-700 cursor-pointer">
          <input
              type="checkbox"
              className="w-4 h-4 accent-blue-600"
              checked={settings.confirmDelete}
              onChange={e => setSettings({ ...settings, confirmDelete: e.target.checked })}
          />
          <span>שאל אותי לפני כל מחיקה (במקום חלונית "בטל")</span>
      </label>
      </div>
    </div>
  );
}

function StatTile({ value, label, color }: { value: number; label: string; color: 'emerald' | 'amber' | 'blue' | 'rose' }) {
  const styles = {
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-600',
    amber: 'bg-amber-50 border-amber-100 text-amber-600',
    blue: 'bg-blue-50 border-blue-100 text-blue-600',
    rose: 'bg-rose-50 border-rose-100 text-rose-500',
  };
  return (
    <div className={`p-4 rounded-xl border ${styles[color]}`}>
      <div className="font-bold text-3xl mb-1">{value}</div>
      <div className="text-slate-600 text-sm font-medium">{label}</div>
    </div>
  );
}

function ClassicButton({ onClick, icon, label, hint, className }: { onClick: () => void; icon: React.ReactNode; label: string; hint: string; className: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 border py-4 rounded-2xl transition active:scale-95 ${className}`}
    >
      {icon}
      <span className="font-bold text-sm">{label}</span>
      <span className="text-[10px] opacity-60">{hint}</span>
    </button>
  );
}
