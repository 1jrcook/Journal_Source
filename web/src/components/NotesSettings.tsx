import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  listFolders,
  listTemplates,
  loadTemplateSettings,
  PERIOD_LABEL,
  PERIODS,
  saveNoteSettings,
  type FolderTemplate,
  type Period,
  type PeriodSpec,
  type TemplateSettings,
} from '../lib/templates';

const EMPTY: PeriodSpec = { enabled: false, format: '', folder: '', template: '' };

export default function NotesSettings() {
  const open = useStore((s) => s.notesSettingsOpen);
  const presetFolder = useStore((s) => s.notesSettingsFolder);
  const setOpen = useStore((s) => s.setNotesSettings);
  const tree = useStore((s) => s.tree);
  const notify = useStore((s) => s.notify);
  const [draft, setDraft] = useState<TemplateSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    loadTemplateSettings(tree).then((s) => {
      if (cancel) return;
      const next: TemplateSettings = {
        ...s,
        periodic: { ...s.periodic },
        folderTemplates: s.folderTemplates.map((row) => ({ ...row })),
      };
      if (presetFolder && !next.folderTemplates.some((row) => row.folder === presetFolder)) {
        next.folderTemplates = [...next.folderTemplates, { folder: presetFolder, template: '' }];
      }
      setDraft(next);
    });
    return () => {
      cancel = true;
    };
  }, [open, tree, presetFolder]);

  const folders = useMemo(() => listFolders(tree), [tree]);
  const templates = useMemo(
    () => (draft ? listTemplates(tree, draft.folder) : []),
    [tree, draft],
  );

  if (!open || !draft) return null;

  const setPeriod = (key: Period, patch: Partial<PeriodSpec>) => {
    setDraft({
      ...draft,
      periodic: { ...draft.periodic, [key]: { ...draft.periodic[key], ...patch } },
    });
  };
  const setRow = (i: number, patch: Partial<FolderTemplate>) => {
    const folderTemplates = draft.folderTemplates.map((row, n) => (n === i ? { ...row, ...patch } : row));
    setDraft({ ...draft, folderTemplates });
  };

  const save = async () => {
    const folderTemplates = draft.folderTemplates.filter((row) => row.template);
    setSaving(true);
    try {
      await saveNoteSettings({ ...draft, folderTemplates });
      notify('Template settings saved');
      setOpen(false);
    } catch (e: any) {
      notify(e?.message || 'Could not save template settings');
    } finally {
      setSaving(false);
    }
  };

  const folderOptions = (current: string) => {
    const all = current && !folders.includes(current) ? [current, ...folders] : folders;
    return all;
  };

  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal notes-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notes-head">
          <h2>Templates and periodic notes</h2>
          <button className="btn secondary" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div className="notes-body">
          <p className="notes-hint">
            Every markdown note in the template folder is a template. {'{{title}}'}, {'{{date}}'}, and {'{{time}}'} are filled in when a note is created.
          </p>
          <label className="notes-field">
            <span>Template folder</span>
            <select
              className="text-input"
              value={draft.folder}
              onChange={(e) => setDraft({ ...draft, folder: e.target.value })}
            >
              {folderOptions(draft.folder).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>

          <h3>Periodic notes</h3>
          <p className="notes-hint">
            Format uses dates like YYYY-MM-DD, weekly gggg-[W]ww, quarterly YYYY-[Q]Q. Opening a period creates the note from its template when it does not exist yet.
          </p>
          <div className="period-grid period-head">
            <span>Period</span>
            <span>On</span>
            <span>Format</span>
            <span>Folder</span>
            <span>Template</span>
          </div>
          {PERIODS.map((key) => {
            const spec = draft.periodic[key] ?? EMPTY;
            return (
              <div className="period-grid" key={key}>
                <span>{PERIOD_LABEL[key]}</span>
                <input
                  type="checkbox"
                  checked={spec.enabled}
                  onChange={(e) => setPeriod(key, { enabled: e.target.checked })}
                  aria-label={`${PERIOD_LABEL[key]} on`}
                />
                <input
                  className="text-input"
                  value={spec.format}
                  onChange={(e) => setPeriod(key, { format: e.target.value })}
                />
                <select
                  className="text-input"
                  value={spec.folder}
                  onChange={(e) => setPeriod(key, { folder: e.target.value })}
                >
                  <option value="">Vault root</option>
                  {folderOptions(spec.folder).map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <select
                  className="text-input"
                  value={spec.template}
                  onChange={(e) => setPeriod(key, { template: e.target.value })}
                >
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.path} value={t.path}>{t.title}</option>
                  ))}
                  {spec.template && !templates.some((t) => t.path === spec.template) && (
                    <option value={spec.template}>{spec.template}</option>
                  )}
                </select>
              </div>
            );
          })}

          <h3>Folder templates</h3>
          <p className="notes-hint">
            A new note in that folder uses the template. A subfolder uses the same template until it has one of its own. Notes created inside the template folder stay blank.
          </p>
          {draft.folderTemplates.map((row, i) => (
            <div className="period-grid folder-template-row" key={`${row.folder}-${i}`}>
              <select
                className="text-input"
                value={row.folder}
                onChange={(e) => setRow(i, { folder: e.target.value })}
              >
                <option value="">Vault root</option>
                {folderOptions(row.folder).map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <select
                className="text-input"
                value={row.template}
                onChange={(e) => setRow(i, { template: e.target.value })}
              >
                <option value="">Choose a template</option>
                {templates.map((t) => (
                  <option key={t.path} value={t.path}>{t.title}</option>
                ))}
                {row.template && !templates.some((t) => t.path === row.template) && (
                  <option value={row.template}>{row.template}</option>
                )}
              </select>
              <button
                className="btn secondary"
                onClick={() => setDraft({
                  ...draft,
                  folderTemplates: draft.folderTemplates.filter((_, n) => n !== i),
                })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="btn secondary"
            onClick={() => setDraft({
              ...draft,
              folderTemplates: [...draft.folderTemplates, { folder: presetFolder || '', template: '' }],
            })}
          >
            Add folder template
          </button>
        </div>
        <div className="notes-foot">
          <button className="btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
