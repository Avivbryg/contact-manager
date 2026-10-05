import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  getContactGroups,
  getContacts,
  batchDeleteContacts,
  buildContactUpdate,
  updateContact,
  GoogleContact,
  ContactGroup,
  modifyContactGroupMembers,
  createContactGroup,
  getUserGroupIds,
  BATCH_DELETE_LIMIT,
  MY_CONTACTS
} from '../lib/contacts';
import { AuthExpiredError, googleSignIn, logout } from '../lib/auth';
import { RefreshCw, CheckCircle, Edit3, Trash2, Sparkles, Loader2, Users, Smartphone, AlertTriangle } from 'lucide-react';
import SwipeCardDeck from './SwipeCardDeck';

const ContactsChart = lazy(() => import('./ContactsChart'));

type ContactDraft = Partial<GoogleContact> & { contactGroupId?: string };
type DilutionChange = { type: 'edit' | 'delete', updated?: ContactDraft };

interface CommitResult {
  deleted: number;
  edited: number;
  failed: Record<string, DilutionChange>;
  authExpired: boolean;
}

const userGroupIdSet = (groups: ContactGroup[]) =>
  new Set(groups.filter(g => g.groupType === 'USER_CONTACT_GROUP').map(g => g.resourceName));

async function applyEdit(contact: GoogleContact, draft: ContactDraft, userGroupIds: Set<string>) {
  const { body, updatePersonFields } = buildContactUpdate(contact, draft);
  if (updatePersonFields) {
    await updateContact(contact.resourceName, body, updatePersonFields);
  }

  // Only user-created groups are moved between; system groups (e.g. myContacts) are never touched
  if (draft.contactGroupId !== undefined && draft.contactGroupId !== 'new') {
    const oldGroupId = getUserGroupIds(contact, userGroupIds)[0] || '';
    const newGroupId = draft.contactGroupId;
    if (oldGroupId !== newGroupId) {
      if (oldGroupId) await modifyContactGroupMembers(oldGroupId, [], [contact.resourceName]);
      if (newGroupId) await modifyContactGroupMembers(newGroupId, [contact.resourceName], []);
    }
  }
}

/**
 * Applies pending changes to Google. Changes that fail are returned so they can be retried;
 * once the token expires, the remaining changes are not attempted.
 */
async function commitChanges(changes: Record<string, DilutionChange>, contacts: GoogleContact[], groups: ContactGroup[]): Promise<CommitResult> {
  const result: CommitResult = { deleted: 0, edited: 0, failed: {}, authExpired: false };
  const handleError = (e: unknown, label: string) => {
    if (e instanceof AuthExpiredError) result.authExpired = true;
    else console.error(label, e);
  };

  const toDelete = Object.keys(changes).filter(rn => changes[rn].type === 'delete');
  for (let i = 0; i < toDelete.length; i += BATCH_DELETE_LIMIT) {
    const chunk = toDelete.slice(i, i + BATCH_DELETE_LIMIT);
    if (result.authExpired) {
      chunk.forEach(rn => { result.failed[rn] = changes[rn]; });
      continue;
    }
    try {
      await batchDeleteContacts(chunk);
      result.deleted += chunk.length;
    } catch (e) {
      handleError(e, 'Failed to delete');
      chunk.forEach(rn => { result.failed[rn] = changes[rn]; });
    }
  }

  const userGroupIds = userGroupIdSet(groups);
  for (const [resourceName, change] of Object.entries(changes)) {
    if (change.type !== 'edit' || !change.updated) continue;
    const contact = contacts.find(c => c.resourceName === resourceName);
    if (!contact) continue;
    if (result.authExpired) {
      result.failed[resourceName] = change;
      continue;
    }
    try {
      await applyEdit(contact, change.updated, userGroupIds);
      result.edited++;
    } catch (e) {
      handleError(e, 'Failed to edit');
      result.failed[resourceName] = change;
    }
  }

  return result;
}

export default function PhoneContacts() {
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Dilution Mode State
  const [dilutionActive, setDilutionActive] = useState(false);
  const [dilutionIndex, setDilutionIndex] = useState(0);
  const [dilutionOrder, setDilutionOrder] = useState<number[]>([]);
  const [dilutionChanges, setDilutionChanges] = useState<Record<string, DilutionChange>>({});
  const [dilutionHistory, setDilutionHistory] = useState<{ index: number, resourceName: string, previousChange?: DilutionChange }[]>([]);
  const [dilutionEditing, setDilutionEditing] = useState(false);
  const [dilutionDraft, setDilutionDraft] = useState<ContactDraft | null>(null);
  const [dilutionProcessing, setDilutionProcessing] = useState(false);
  const [dilutionStats, setDilutionStats] = useState<{ deleted: number, edited: number, reviewed: number, total: number } | null>(null);
  // Changes that failed to save, kept so the user can retry instead of losing them
  const [failedChanges, setFailedChanges] = useState<Record<string, DilutionChange>>({});
  const [needsReauth, setNeedsReauth] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Phone / Swiping Mode - defaults to true on mobile screens or touch devices
  const [isPhoneMode, setIsPhoneMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768 || ('ontouchstart' in window);
    }
    return true;
  });

  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroupLoading, setIsCreatingGroupLoading] = useState(false);
  const [showChart, setShowChart] = useState(true);

  const userGroups = React.useMemo(
    () => contactGroups.filter(g => g.groupType === 'USER_CONTACT_GROUP'),
    [contactGroups]
  );
  const userGroupIds = React.useMemo(() => userGroupIdSet(contactGroups), [contactGroups]);

  // "myContacts" is shown as the bucket of contacts that have no user-created group
  const isContactInSelectedGroup = React.useCallback((c: GoogleContact, groupId: string | null) => {
      if (!groupId) return true;
      if (!c.memberships.includes(groupId)) return false;
      if (groupId === MY_CONTACTS) return getUserGroupIds(c, userGroupIds).length === 0;
      return true;
  }, [userGroupIds]);

  const selectableGroups = React.useMemo(() => {
      const myContacts = contactGroups.find(g => g.resourceName === MY_CONTACTS);
      const sorted = [...userGroups].sort((a, b) => a.formattedName.localeCompare(b.formattedName));
      return (myContacts ? [myContacts, ...sorted] : sorted).map(group => ({
          group,
          count: contacts.filter(c => isContactInSelectedGroup(c, group.resourceName)).length
      }));
  }, [contactGroups, userGroups, contacts, isContactInSelectedGroup]);

  const chartData = React.useMemo(() => {
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
            name: 'לא משוייכים',
            value: unassignedCount
        });
    }

    return data.sort((a, b) => b.value - a.value);
  }, [contacts, userGroups, userGroupIds]);

  /** Loads groups and contacts from Google. Returns the fresh data, or null on failure. */
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [groupsData, contactsData] = await Promise.all([
        getContactGroups(),
        getContacts()
      ]);
      setContactGroups(groupsData);
      setContacts(contactsData);

      if (!selectedGroupId && groupsData.some(g => g.resourceName === MY_CONTACTS)) {
          setSelectedGroupId(MY_CONTACTS);
      }
      return { groups: groupsData, contacts: contactsData };
    } catch (e) {
      console.error(e);
      if (e instanceof AuthExpiredError) {
        // Back to the login screen
        await logout();
      } else {
        alert(`נכשל בטעינת אנשי הקשר. ודא שיש הרשאות תקינות.\n\n${e instanceof Error ? e.message : ''}`);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCommitDilution = async () => {
    if (dilutionProcessing) return;
    setDilutionProcessing(true);
    const result = await commitChanges(dilutionChanges, contacts, contactGroups);

    setDilutionStats({ deleted: result.deleted, edited: result.edited, reviewed: dilutionIndex, total: dilutionOrder.length });
    setFailedChanges(result.failed);
    setNeedsReauth(result.authExpired);

    setDilutionChanges({});
    setDilutionActive(false);
    setDilutionIndex(0);
    setDilutionHistory([]);
    setDilutionProcessing(false);

    // With an expired token, reloading would fail and send the user to login, losing the failed changes
    if (!result.authExpired) loadData();
  };

  const handleRetryFailed = async () => {
    setIsRetrying(true);
    try {
      if (needsReauth) {
        await googleSignIn();
        setNeedsReauth(false);
      }
      // Reload so edits are applied against fresh etags and current group memberships
      const data = await loadData();
      if (!data) return;

      const result = await commitChanges(failedChanges, data.contacts, data.groups);
      setDilutionStats(prev => prev && { ...prev, deleted: prev.deleted + result.deleted, edited: prev.edited + result.edited });
      setFailedChanges(result.failed);
      setNeedsReauth(result.authExpired);
      if (!result.authExpired && (result.deleted || result.edited)) loadData();
    } catch (e) {
      console.error('Retry failed:', e);
      alert('השמירה נכשלה. נסה שנית.');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCloseStats = () => {
    const failedCount = Object.keys(failedChanges).length;
    if (failedCount > 0 && !confirm(`${failedCount} שינויים לא נשמרו ויאבדו. להמשיך?`)) return;
    setFailedChanges({});
    setNeedsReauth(false);
    setDilutionStats(null);
    if (needsReauth) loadData();
  };

  const startDilution = () => {
    const listToDilute = contacts.filter(c => isContactInSelectedGroup(c, selectedGroupId));
    
    if (listToDilute.length === 0) {
      alert('אין אנשי קשר בקבוצה זו לדילול.');
      return;
    }

    // Map global indices for the ones we want
    const order = listToDilute.map(c => contacts.findIndex(x => x.resourceName === c.resourceName)).filter(i => i !== -1);
    
    // Shuffle
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    setDilutionOrder(order);
    setDilutionIndex(0);
    setDilutionHistory([]);
    setDilutionEditing(false);
    setDilutionDraft(null);
    setDilutionActive(true);
  };

  const handleApprove = () => {
    if (dilutionIndex >= dilutionOrder.length) return;
    const currentContact = contacts[dilutionOrder[dilutionIndex]];
    if (!currentContact) return;
    setDilutionHistory(prev => [...prev, { index: dilutionIndex, resourceName: currentContact.resourceName }]);
    setDilutionIndex(i => i + 1);
  };

  const handleStartEdit = () => {
    if (dilutionIndex >= dilutionOrder.length) return;
    const currentContact = contacts[dilutionOrder[dilutionIndex]];
    if (!currentContact) return;
    setDilutionEditing(true);
    setDilutionDraft({
        ...currentContact,
        contactGroupId: getUserGroupIds(currentContact, userGroupIds)[0] || '',
    });
  };

  const handleDelete = () => {
    if (dilutionIndex >= dilutionOrder.length) return;
    const currentContact = contacts[dilutionOrder[dilutionIndex]];
    if (!currentContact) return;
    setDilutionHistory(prev => [...prev, { 
      index: dilutionIndex, 
      resourceName: currentContact.resourceName,
      previousChange: dilutionChanges[currentContact.resourceName]
    }]);
    setDilutionChanges(prev => ({...prev, [currentContact.resourceName]: { type: 'delete' }}));
    setDilutionIndex(i => i + 1);
  };

  const handleUndo = () => {
    if (dilutionHistory.length === 0) return;
    const lastAction = dilutionHistory[dilutionHistory.length - 1];
    setDilutionHistory(prev => prev.slice(0, -1));
    setDilutionChanges(prev => {
      const updated = { ...prev };
      if (lastAction.previousChange) {
        updated[lastAction.resourceName] = lastAction.previousChange;
      } else {
        delete updated[lastAction.resourceName];
      }
      return updated;
    });
    setDilutionIndex(lastAction.index);
  };

  // Keyboard navigation during dilution mode
  useEffect(() => {
    if (!dilutionActive || dilutionEditing || dilutionProcessing) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleCommitDilution();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleApprove();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleStartEdit();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleDelete();
      } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dilutionActive, dilutionEditing, dilutionProcessing, dilutionIndex, dilutionOrder, dilutionChanges, contacts, contactGroups]);

  if (isLoading) {
    return <div className="p-10 flex text-slate-500 justify-center h-full items-center"><RefreshCw className="animate-spin w-6 h-6 ml-2"/> מביא את הנתונים מגוגל...</div>;
  }

  if (dilutionStats) {
    return (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-lg p-8 text-center border border-slate-100">
            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
               <Sparkles className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="font-bold text-2xl text-slate-800 mb-6">סיכום תהליך הדילול</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                <div className="text-red-500 font-bold text-4xl mb-1">{dilutionStats.deleted}</div>
                <div className="text-slate-600 text-sm font-medium">נמחקו</div>
              </div>
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <div className="text-blue-500 font-bold text-4xl mb-1">{dilutionStats.edited}</div>
                <div className="text-slate-600 text-sm font-medium">נערכו</div>
              </div>
            </div>
            <p className="text-slate-500 mb-6 bg-slate-50 p-4 rounded-xl text-sm font-medium">
              סה״כ עברת על {dilutionStats.reviewed} אנשי קשר מתוך {dilutionStats.total}.
            </p>
            {Object.keys(failedChanges).length > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-sm mb-6 text-right">
                <div className="flex gap-2 mb-3 font-medium">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
                  <span>
                    {needsReauth
                      ? `פג תוקף ההתחברות לגוגל, ו-${Object.keys(failedChanges).length} שינויים לא נשמרו. התחבר מחדש כדי לשמור אותם.`
                      : `${Object.keys(failedChanges).length} שינויים נכשלו בשמירה.`}
                  </span>
                </div>
                <button
                  onClick={handleRetryFailed}
                  disabled={isRetrying}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl py-3 font-bold transition flex items-center justify-center gap-2"
                >
                  {isRetrying && <RefreshCw className="animate-spin w-4 h-4" />}
                  {needsReauth ? 'התחבר מחדש ושמור' : 'נסה שוב'}
                </button>
              </div>
            )}
            <button
               onClick={handleCloseStats}
               className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-4 font-medium transition text-lg"
            >
              למסך הראשי
            </button>
          </div>
        </div>
    );
  }

  if (dilutionActive) {
    const isFinished = dilutionIndex >= dilutionOrder.length;
    const currentContact = !isFinished ? contacts[dilutionOrder[dilutionIndex]] : null;
    const nextContact = dilutionIndex + 1 < dilutionOrder.length ? contacts[dilutionOrder[dilutionIndex + 1]] : null;

    return (
      <div className="flex-1 p-3 sm:p-4 flex flex-col overflow-y-auto w-full max-w-md mx-auto">
        <div className="flex justify-between items-center mb-3 px-1 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800">מצב דילול</h2>
            <button
              onClick={() => setIsPhoneMode(prev => !prev)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                isPhoneMode 
                  ? 'bg-blue-50 text-blue-700 border-blue-200' 
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
              title={isPhoneMode ? 'החלף לתצוגה רגילה' : 'החלף למצב סמארטפון (החלקת כרטיסיות)'}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{isPhoneMode ? 'מצב סמארטפון (החלקה)' : 'מצב רגיל'}</span>
            </button>
          </div>
          {!isFinished && (
            <div className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-bold border border-slate-200">
              {dilutionIndex + 1} / {dilutionOrder.length}
            </div>
          )}
        </div>

        {dilutionProcessing ? (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10 text-center flex-1 flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-6" />
            <h3 className="text-xl font-bold text-slate-800 mb-2">שומר שינויים...</h3>
            <p className="text-slate-500">מעדכן את החשבון גוגל שלך.</p>
          </div>
        ) : isFinished ? (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 text-center flex-1 flex flex-col items-center justify-center">
            <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-10 h-10 text-yellow-500" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-4">כל הכבוד סיימנו!</h3>
            <p className="text-slate-600 mb-8 text-lg">סיימת לעבור על רשימת הדילול הנוכחית. ישנם {Object.keys(dilutionChanges).length} עדכונים בהמתנה לשמירה.</p>
            <button 
                onClick={handleCommitDilution}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-4 font-bold text-lg transition shadow-md"
            >
                שמור לחשבון הגוגל שלי
            </button>
          </div>
        ) : currentContact ? (
          <div className="flex-1 flex flex-col min-h-0">
            {dilutionEditing ? (
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col flex-1">
                <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">עריכת פרטי איש קשר</h3>
                <div className="flex-1 space-y-3 overflow-y-auto px-1 pb-4">
                    <input 
                    className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition" 
                    value={dilutionDraft?.firstName || ''} 
                    onChange={e => setDilutionDraft({...dilutionDraft, firstName: e.target.value})}
                    placeholder="שם פרטי"
                    />
                    <input 
                    className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition" 
                    value={dilutionDraft?.lastName || ''} 
                    onChange={e => setDilutionDraft({...dilutionDraft, lastName: e.target.value})}
                    placeholder="שם משפחה"
                    />
                    <input 
                    className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition text-right" 
                    value={dilutionDraft?.phone || ''} 
                    onChange={e => setDilutionDraft({...dilutionDraft, phone: e.target.value})}
                    placeholder="טלפון"
                    dir="ltr"
                    />
                    <input 
                    className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition text-right" 
                    value={dilutionDraft?.email || ''} 
                    onChange={e => setDilutionDraft({...dilutionDraft, email: e.target.value})}
                    placeholder="אימייל"
                    dir="ltr"
                    />
                    
                    <div className="pb-4">
                        <label className="block text-sm text-slate-500 mb-2 font-medium text-right">קטגוריה (גוגל):</label>
                        <select 
                        className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
                        value={dilutionDraft?.contactGroupId === 'new' ? 'new' : dilutionDraft?.contactGroupId || ''}
                        onChange={e => {
                            if (e.target.value === 'new') {
                                setIsCreatingGroup(true);
                                setDilutionDraft({...dilutionDraft, contactGroupId: 'new'});
                            } else {
                                setIsCreatingGroup(false);
                                setDilutionDraft({...dilutionDraft, contactGroupId: e.target.value});
                            }
                        }}
                        >
                        <option value="">ללא קטגוריה</option>
                        {userGroups.map(group => (
                            <option key={group.resourceName} value={group.resourceName}>{group.formattedName}</option>
                        ))}
                        <option value="new">אחר (צור קבוצה חדשה)...</option>
                        </select>

                        {isCreatingGroup && (
                            <div className="mt-3 flex gap-2">
                                <input 
                                    className="flex-1 border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition"
                                    placeholder="שם הקבוצה החדשה"
                                    value={newGroupName}
                                    onChange={e => setNewGroupName(e.target.value)}
                                    autoFocus
                                />
                                <button
                                    disabled={!newGroupName.trim() || isCreatingGroupLoading}
                                    onClick={async () => {
                                        try {
                                            setIsCreatingGroupLoading(true);
                                            const newGroup = await createContactGroup(newGroupName.trim());
                                            setContactGroups(prev => [...prev, newGroup]);
                                            setDilutionDraft({...dilutionDraft, contactGroupId: newGroup.resourceName});
                                            setIsCreatingGroup(false);
                                            setNewGroupName('');
                                        } catch(e) {
                                            alert('שגיאה ביצירת קבוצה');
                                        } finally {
                                            setIsCreatingGroupLoading(false);
                                        }
                                    }}
                                    className="px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium transition flex items-center justify-center min-w-[80px]"
                                >
                                    {isCreatingGroupLoading ? <RefreshCw className="animate-spin w-5 h-5"/> : 'שמור'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex gap-3 pt-2 shrink-0 mt-auto">
                  <button 
                    disabled={isCreatingGroup || dilutionDraft?.contactGroupId === 'new'}
                    onClick={() => {
                        setDilutionHistory(prev => [...prev, {
                          index: dilutionIndex,
                          resourceName: currentContact.resourceName,
                          previousChange: dilutionChanges[currentContact.resourceName]
                        }]);
                        setDilutionChanges(prev => ({...prev, [currentContact.resourceName]: { type: 'edit', updated: dilutionDraft }}));
                        setDilutionEditing(false);
                        setDilutionDraft(null);
                        setIsCreatingGroup(false);
                        setDilutionIndex(i => i + 1);
                    }}
                    className="flex-1 bg-slate-900 disabled:opacity-50 text-white rounded-xl py-3.5 font-bold transition hover:bg-slate-800"
                  >שמור לסוף תהליך</button>
                  <button 
                    onClick={() => {
                        setDilutionEditing(false);
                        setDilutionDraft(null);
                        setIsCreatingGroup(false);
                    }}
                    className="flex-none px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-3.5 font-medium transition"
                  >ביטול</button>
                </div>
              </div>
            ) : isPhoneMode ? (
              /* Tinder-Style Swiping Deck for Mobile / Phone Mode */
              <SwipeCardDeck
                currentContact={currentContact}
                nextContact={nextContact}
                currentIndex={dilutionIndex}
                totalCount={dilutionOrder.length}
                contactGroups={contactGroups}
                onApprove={handleApprove}
                onEdit={handleStartEdit}
                onDelete={handleDelete}
                onSaveAndExit={handleCommitDilution}
                onUndo={handleUndo}
                canUndo={dilutionHistory.length > 0}
              />
            ) : (
              /* Classic Card Mode (for Desktop / Non-Phone mode) */
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col items-center text-center flex-1">
                <div className="w-full flex justify-between flex-col h-full py-2">
                  <div className="flex-1 flex flex-col justify-center items-center">
                      <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-4xl font-bold mx-auto mb-6">
                      {currentContact.firstName?.[0] || currentContact.lastName?.[0] || '?'}
                      </div>
                      <h3 className="text-3xl font-bold text-slate-800 mb-2">{currentContact.firstName} {currentContact.lastName}</h3>
                      <div className="text-lg text-slate-500 mb-1 font-mono" dir="ltr">{currentContact.phone || 'אין מספר טלפון'}</div>
                      <div className="text-slate-400 font-mono text-sm" dir="ltr">{currentContact.email || 'אין אימייל'}</div>
                  </div>

                  <div className="flex gap-3 w-full mt-auto pt-8 shrink-0">
                  <button 
                      onClick={handleApprove} 
                      className="flex-1 flex flex-col items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 py-4 rounded-2xl transition active:scale-95"
                  >
                      <CheckCircle className="w-7 h-7 text-green-500" />
                      <span className="font-bold text-base">תקין (השאר)</span>
                  </button>
                  <button 
                      onClick={handleStartEdit} 
                      className="flex-1 flex flex-col items-center justify-center gap-2 bg-slate-50 border border-slate-200 text-blue-700 py-4 rounded-2xl transition active:scale-95"
                  >
                      <Edit3 className="w-7 h-7 text-blue-500" />
                      <span className="font-bold text-base">ערוך</span>
                  </button>
                  <button 
                      onClick={handleDelete} 
                      className="flex-1 flex flex-col items-center justify-center gap-2 bg-red-50 border border-red-100 text-red-700 py-4 rounded-2xl transition active:scale-95"
                  >
                      <Trash2 className="w-7 h-7 text-red-500" />
                      <span className="font-bold text-base">מחק!</span>
                  </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Early exit */}
        {currentContact && !dilutionProcessing && !dilutionEditing && Object.keys(dilutionChanges).length > 0 && (
            <div className="mt-3 flex justify-center shrink-0">
                <button onClick={handleCommitDilution} className="w-full text-center bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 font-medium py-3 px-4 rounded-xl transition text-sm">
                שמור שינויים שבוצעו ויציאה ({Object.keys(dilutionChanges).length})
                </button>
            </div>
        )}
      </div>
    );
  }

  const filteredCount = contacts.filter(c => isContactInSelectedGroup(c, selectedGroupId)).length;

  return (
    <div className="flex-1 p-4 flex flex-col overflow-y-auto w-full max-w-md mx-auto">
      <div className="text-center mt-3 mb-6 relative">
         <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
             <Users className="w-8 h-8" />
         </div>
         <h2 className="text-2xl font-bold text-slate-800">מוכנים לנקות?</h2>
         <p className="text-slate-500 mt-1.5 text-sm">מסננים אנשי קשר שאינם רלוונטיים, עורכים פרטים שגויים, ושומרים הכל בחזרה לגוגל בסוף.</p>

         {/* Start Button at Top */}
         <button 
           onClick={startDilution}
           disabled={filteredCount === 0}
           className="w-full mt-5 py-4 rounded-2xl font-bold text-lg text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
         >
           <Sparkles className="w-5 h-5" /> התחל סינון עכשיו ({filteredCount})
         </button>

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
      
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
          <label className="block text-sm font-semibold text-slate-800 mb-3">בחר קבוצה לדילול (אופציונלי):</label>
          <div className="relative">
              <select 
                  className="w-full appearance-none bg-slate-50 border border-slate-200 text-slate-700 py-3.5 px-4 pr-10 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                  value={selectedGroupId || ''}
                  onChange={(e) => setSelectedGroupId(e.target.value || null)}
              >
                  <option value="">כל אנשי הקשר בגוגל</option>
                  {selectableGroups.map(({ group, count }) => (
                      <option key={group.resourceName} value={group.resourceName}>
                          {group.resourceName === MY_CONTACTS ? 'ללא קבוצה' : group.formattedName} ({count})
                      </option>
                  ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
              </div>
          </div>

          <div className="mt-5 text-center px-4 py-3 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
              נמצאו {filteredCount} אנשי קשר לדילול.
          </div>
      </div>

      <button 
        onClick={startDilution}
        disabled={filteredCount === 0}
        className="w-full py-4 rounded-2xl font-bold text-lg text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md mt-auto mb-4"
      >
        <Sparkles className="w-6 h-6" /> התחל דילול עכשיו!
      </button>
    </div>
  );
}
