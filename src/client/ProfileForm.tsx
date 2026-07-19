import { useState, type ReactNode } from 'react';
import { DEPARTMENTS, ROLES, TENURES, type Profile } from '../shared/contract';
import { btnPrimary } from './button';
import { ErrorText } from './Announce';

const FIELDS = [
  ['department', 'Department', DEPARTMENTS],
  ['role', 'Role', ROLES],
  ['tenure', 'Tenure', TENURES],
] as const;

/** The three-enum profile form — first-time screen and Edit-profile modal alike.
 *  `children` render beside the submit button (the modal's Cancel). */
export function ProfileForm({
  initial,
  submitLabel,
  onSave,
  error,
  children,
}: {
  initial: Profile | null;
  submitLabel: string;
  onSave: (p: Profile) => void;
  error?: string | null;
  children?: ReactNode;
}) {
  const [form, setForm] = useState<Profile>(
    initial ?? { department: DEPARTMENTS[0], role: ROLES[0], tenure: TENURES[0] },
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="space-y-4"
    >
      {FIELDS.map(([key, label, options]) => (
        <label key={key} className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
          <select
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value } as Profile)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 focus:border-indigo-500"
          >
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      ))}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          className={`${btnPrimary} flex-1 rounded-lg px-4 py-2.5`}
        >
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
