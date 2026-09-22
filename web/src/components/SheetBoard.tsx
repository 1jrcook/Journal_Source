import { useEffect, useRef, useState } from 'react';

type Task = { id: string; text: string; done: boolean; indent?: number };
type Row = {
  id: string;
  priority: string;
  project: string;
  tasks: Task[];
  goals: string;
  notes: string;
  archive: boolean;
};

function nid() {
  return Math.random().toString(16).slice(2, 10);
}

function blankRow(): Row {
  return { id: nid(), priority: '', project: '', tasks: [{ id: nid(), text: '', done: false }], goals: '', notes: '', archive: false };
}

async function putRows(rows: Row[]) {
  const res = await fetch('/api/sheet', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
    keepalive: true,
  });
  if (!res.ok) throw new Error('save');
}

/**
 * The digest spreadsheet, parked on the journal's right side.
 * JR writes what he wants to get done. The morning page reads it and does not fill it in.
 */
export default function SheetBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const pending = useRef<Row[] | null>(null);
  const timer = useRef<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const res = await fetch('/api/sheet', { credentials: 'include' });
        if (!res.ok) throw new Error('load');
        const body = await res.json();
        if (!stale) {
          setRows(Array.isArray(body.rows) ? body.rows : []);
          setErr('');
        }
      } catch {
        if (!stale) setErr('Spreadsheet unread');
      }
    })();
    return () => {
      stale = true;
      if (timer.current) window.clearTimeout(timer.current);
      if (pending.current) void putRows(pending.current).catch(() => {});
    };
  }, []);

  function commit(next: Row[]) {
    pending.current = next;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const snapshot = pending.current;
      pending.current = null;
      if (!snapshot) return;
      putRows(snapshot).then(() => setErr('')).catch(() => setErr('Could not save'));
    }, 280);
  }

  function update(mut: (cur: Row[]) => Row[]) {
    setRows((cur) => {
      const next = mut(cur ?? []);
      commit(next);
      return next;
    });
  }

  function focusTask(rowId: string, taskId: string) {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-row="${rowId}"] [data-task="${CSS.escape(taskId)}"]`)?.focus();
    });
  }

  if (err && !rows) {
    return (
      <div className="sheet-board">
        <div className="nav-header"><span className="nav-title">Spreadsheet</span></div>
        <p className="sheet-err">{err}</p>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="sheet-board">
        <div className="nav-header"><span className="nav-title">Spreadsheet</span></div>
      </div>
    );
  }

  return (
    <div className="sheet-board">
      <div className="nav-header">
        <span className="nav-title">Spreadsheet</span>
        <span className="grow" />
        <button type="button" className="sheet-add" onClick={() => update((cur) => [...cur, blankRow()])}>
          Add row
        </button>
      </div>
      <p className="sheet-hint">What you want to get done. The morning page reads this. It does not fill it in.</p>
      {err && <p className="sheet-err">{err}</p>}
      <div className="sheet-scroll">
        {rows.length === 0 && <div className="sheet-empty">No rows yet.</div>}
        {rows.map((row, i) => (
          <article
            key={row.id}
            className={`sheet-row${row.archive ? ' archived' : ''}`}
            data-row={row.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from == null || from === i) return;
              update((cur) => {
                const next = cur.slice();
                const moved = next.splice(from, 1)[0];
                if (!moved) return cur;
                next.splice(i, 0, moved);
                return next;
              });
            }}
          >
            <div className="sheet-row-top">
              <span
                className="sheet-grip"
                title="Drag to reorder"
                draggable
                onDragStart={(e) => {
                  dragFrom.current = i;
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                ⋮⋮
              </span>
              <input
                className="sheet-proj"
                value={row.project}
                placeholder="Project"
                onChange={(e) => {
                  const value = e.target.value;
                  update((cur) => cur.map((r) => (r.id === row.id ? { ...r, project: value } : r)));
                }}
              />
              <button
                type="button"
                className="sheet-arch"
                onClick={() => update((cur) => cur.map((r) => (r.id === row.id ? { ...r, archive: !r.archive } : r)))}
              >
                {row.archive ? 'Restore' : 'Archive'}
              </button>
            </div>
            {(row.tasks || []).map((task) => (
              <div key={task.id} className={`sheet-task${task.done ? ' done' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!task.done}
                  onChange={() =>
                    update((cur) =>
                      cur.map((r) =>
                        r.id === row.id
                          ? { ...r, tasks: r.tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)) }
                          : r,
                      ),
                    )
                  }
                />
                <input
                  type="text"
                  data-task={task.id}
                  value={task.text}
                  placeholder="Task"
                  onChange={(e) => {
                    const value = e.target.value;
                    update((cur) =>
                      cur.map((r) =>
                        r.id === row.id
                          ? { ...r, tasks: r.tasks.map((t) => (t.id === task.id ? { ...t, text: value } : t)) }
                          : r,
                      ),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const added = nid();
                      update((cur) =>
                        cur.map((r) => {
                          if (r.id !== row.id) return r;
                          const tasks = r.tasks.slice();
                          const at = tasks.findIndex((t) => t.id === task.id);
                          tasks.splice(at + 1, 0, { id: added, text: '', done: false });
                          return { ...r, tasks };
                        }),
                      );
                      focusTask(row.id, added);
                    } else if (e.key === 'Backspace' && task.text === '' && (row.tasks || []).length > 1) {
                      e.preventDefault();
                      const tasks = row.tasks;
                      const at = tasks.findIndex((t) => t.id === task.id);
                      const prev = tasks[Math.max(0, at - 1)];
                      update((cur) =>
                        cur.map((r) => (r.id === row.id ? { ...r, tasks: r.tasks.filter((t) => t.id !== task.id) } : r)),
                      );
                      if (prev) focusTask(row.id, prev.id);
                    }
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="sheet-task-add"
              onClick={() => {
                const added = nid();
                update((cur) =>
                  cur.map((r) => (r.id === row.id ? { ...r, tasks: [...(r.tasks || []), { id: added, text: '', done: false }] } : r)),
                );
                focusTask(row.id, added);
              }}
            >
              + Task
            </button>
            <label className="sheet-field">
              <span>Goals</span>
              <textarea
                rows={2}
                value={row.goals || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  update((cur) => cur.map((r) => (r.id === row.id ? { ...r, goals: value } : r)));
                }}
              />
            </label>
            <label className="sheet-field">
              <span>Notes</span>
              <textarea
                rows={2}
                value={row.notes || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  update((cur) => cur.map((r) => (r.id === row.id ? { ...r, notes: value } : r)));
                }}
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
}
