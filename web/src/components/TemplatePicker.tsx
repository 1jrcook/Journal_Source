import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { listTemplates, loadTemplateSettings } from '../lib/templates';

export default function TemplatePicker() {
  const mode = useStore((s) => s.templatePicker);
  const setMode = useStore((s) => s.setTemplatePicker);
  const tree = useStore((s) => s.tree);
  const insertTemplate = useStore((s) => s.insertTemplate);
  const useTemplateAsDaily = useStore((s) => s.useTemplateAsDaily);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('templates');
  const [items, setItems] = useState<{ path: string; title: string }[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!mode) return;
    setQ('');
    let cancel = false;
    loadTemplateSettings(tree).then((s) => {
      if (cancel) return;
      setFolder(s.folder || 'templates');
      setItems(listTemplates(tree, s.folder || 'templates'));
    });
    return () => {
      cancel = true;
    };
  }, [mode, tree]);

  const shown = useMemo(() => {
    const lc = q.trim().toLowerCase();
    return items.filter((t) => !lc || t.title.toLowerCase().includes(lc) || t.path.toLowerCase().includes(lc));
  }, [items, q]);

  useEffect(() => setSel(0), [q, mode, items]);

  if (!mode) return null;

  const run = (path: string) => {
    const go = mode === 'daily' ? useTemplateAsDaily(path) : insertTemplate(path);
    setMode(null);
    void go;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setMode(null);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && shown[sel]) {
      e.preventDefault();
      run(shown[sel].path);
    }
  };

  const heading = mode === 'daily' ? 'New daily note from template' : 'Insert template';
  const hint = mode === 'daily'
    ? 'Creates today’s daily note from the template. If today already exists, it opens that note.'
    : 'Inserts the template at the cursor. {{title}}, {{date}}, and {{time}} are filled in.';

  return (
    <div className="modal-bg" onClick={() => setMode(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          placeholder={`${heading}…`}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {shown.map((it, i) => (
            <div
              key={it.path}
              className={`palette-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(it.path)}
            >
              <span>{it.title}</span>
              <span className="kbd">{it.path}</span>
            </div>
          ))}
          {shown.length === 0 && (
            <div className="palette-item">
              No templates in {folder}. Add a markdown note there first.
            </div>
          )}
        </div>
        <div className="palette-footer">{hint}</div>
      </div>
    </div>
  );
}
