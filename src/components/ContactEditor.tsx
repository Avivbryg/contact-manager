import React, { useMemo, useState } from 'react';
import { RefreshCw, Lightbulb } from 'lucide-react';
import { ContactGroup, GoogleContact, parseBirthday } from '../lib/contacts';
import { suggestCompany } from '../lib/company';
import { Settings } from '../lib/session';

export type ContactDraft = Partial<GoogleContact> & { contactGroupId?: string };

interface ContactEditorProps {
  draft: ContactDraft;
  onChange: (draft: ContactDraft) => void;
  userGroups: ContactGroup[];
  companies: string[];
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onCreateGroup: (name: string) => Promise<ContactGroup>;
  onSave: () => void;
  onCancel: () => void;
}

const INPUT = 'w-full border border-slate-200 px-4 py-3 rounded-xl bg-slate-50 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition';

export default function ContactEditor({
  draft,
  onChange,
  userGroups,
  companies,
  settings,
  onSettingsChange,
  onCreateGroup,
  onSave,
  onCancel,
}: ContactEditorProps) {
  const [isCreatingGroup, setIsCreatingGroup] = useState(draft.contactGroupId === 'new');
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroupLoading, setIsCreatingGroupLoading] = useState(false);

  const set = (patch: ContactDraft) => onChange({ ...draft, ...patch });

  const suggestion = useMemo(
    () => draft.company ? null : suggestCompany({ firstName: draft.firstName || '', lastName: draft.lastName || '', email: draft.email || '' }, companies),
    [draft.company, draft.firstName, draft.lastName, draft.email, companies]
  );

  const birthdayInvalid = !!draft.birthday?.trim() && !parseBirthday(draft.birthday);

  const createGroup = async () => {
    try {
      setIsCreatingGroupLoading(true);
      const group = await onCreateGroup(newGroupName.trim());
      set({ contactGroupId: group.resourceName });
      setIsCreatingGroup(false);
      setNewGroupName('');
    } catch {
      alert('שגיאה ביצירת תווית');
    } finally {
      setIsCreatingGroupLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col flex-1">
      <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">עריכת פרטי איש קשר</h3>
      <div className="flex-1 space-y-3 overflow-y-auto px-1 pb-4">
        <div className="flex gap-2">
          <input className={INPUT} value={draft.firstName || ''} onChange={e => set({ firstName: e.target.value })} placeholder="שם פרטי" />
          <input className={INPUT} value={draft.lastName || ''} onChange={e => set({ lastName: e.target.value })} placeholder="שם משפחה" />
        </div>
        <input className={`${INPUT} text-right`} value={draft.phone || ''} onChange={e => set({ phone: e.target.value })} placeholder="טלפון" dir="ltr" />

        <div>
          <input
            className={INPUT}
            value={draft.company || ''}
            onChange={e => set({ company: e.target.value })}
            placeholder="חברה"
            list="known-companies"
          />
          <datalist id="known-companies">
            {companies.map(company => <option key={company} value={company} />)}
          </datalist>
          {suggestion && (
            <button
              onClick={() => set({ company: suggestion })}
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-full px-2.5 py-1 transition"
            >
              <Lightbulb className="w-3.5 h-3.5" /> הצעה: {suggestion}
            </button>
          )}
        </div>
        <input className={INPUT} value={draft.jobTitle || ''} onChange={e => set({ jobTitle: e.target.value })} placeholder="תפקיד" />

        <textarea
          className={`${INPUT} resize-none`}
          rows={2}
          value={draft.note || ''}
          onChange={e => set({ note: e.target.value })}
          placeholder="איך אנחנו מכירים?"
        />

        {settings.showEmail && (
          <input className={`${INPUT} text-right`} value={draft.email || ''} onChange={e => set({ email: e.target.value })} placeholder="אימייל" dir="ltr" />
        )}
        {settings.showBirthday && (
          <div>
            <input
              className={`${INPUT} ${birthdayInvalid ? 'border-red-300 focus:ring-red-400' : ''}`}
              value={draft.birthday || ''}
              onChange={e => set({ birthday: e.target.value })}
              placeholder="יום הולדת (יום/חודש/שנה)"
              inputMode="numeric"
            />
            {birthdayInvalid && <p className="text-xs text-red-500 mt-1">פורמט: 15/3 או 15/3/1990</p>}
          </div>
        )}
        {settings.showAddress && (
          <input className={INPUT} value={draft.address || ''} onChange={e => set({ address: e.target.value })} placeholder="כתובת" />
        )}

        <div>
          <label className="block text-sm text-slate-500 mb-2 font-medium text-right">תווית (גוגל):</label>
          <select
            className="w-full border border-slate-200 px-4 py-3 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
            value={draft.contactGroupId || ''}
            onChange={e => {
              setIsCreatingGroup(e.target.value === 'new');
              set({ contactGroupId: e.target.value });
            }}
          >
            <option value="">ללא תווית</option>
            {userGroups.map(group => (
              <option key={group.resourceName} value={group.resourceName}>{group.formattedName}</option>
            ))}
            <option value="new">אחר (צור תווית חדשה)...</option>
          </select>

          {isCreatingGroup && (
            <div className="mt-3 flex gap-2">
              <input
                className={`flex-1 ${INPUT}`}
                placeholder="שם התווית החדשה"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                autoFocus
              />
              <button
                disabled={!newGroupName.trim() || isCreatingGroupLoading}
                onClick={createGroup}
                className="px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium transition flex items-center justify-center min-w-[80px]"
              >
                {isCreatingGroupLoading ? <RefreshCw className="animate-spin w-5 h-5" /> : 'שמור'}
              </button>
            </div>
          )}
        </div>

        <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <span>שדות נוספים:</span>
          <FieldToggle label="אימייל" checked={settings.showEmail} onChange={v => onSettingsChange({ ...settings, showEmail: v })} />
          <FieldToggle label="יום הולדת" checked={settings.showBirthday} onChange={v => onSettingsChange({ ...settings, showBirthday: v })} />
          <FieldToggle label="כתובת" checked={settings.showAddress} onChange={v => onSettingsChange({ ...settings, showAddress: v })} />
        </div>
      </div>

      <div className="flex gap-3 pt-2 shrink-0 mt-auto">
        <button
          disabled={isCreatingGroup || draft.contactGroupId === 'new' || birthdayInvalid}
          onClick={onSave}
          className="flex-1 bg-slate-900 disabled:opacity-50 text-white rounded-xl py-3.5 font-bold transition hover:bg-slate-800"
        >שמור והמשך</button>
        <button
          onClick={onCancel}
          className="flex-none px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl py-3.5 font-medium transition"
        >ביטול</button>
      </div>
    </div>
  );
}

function FieldToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" className="w-3.5 h-3.5 accent-blue-600" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
