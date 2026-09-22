import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

export default function AskDialog() {
  const dialog = useStore((s) => s.dialog);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const el = input.current;
    if (el) {
      el.focus();
      const dot = el.value.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dialog.resolve(null);
        useStore.setState({ dialog: null });
      } else if (e.key === 'Enter' && dialog.value === undefined) {
        e.preventDefault();
        e.stopPropagation();
        dialog.resolve('');
        useStore.setState({ dialog: null });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dialog]);

  if (!dialog) return null;
  const hasInput = dialog.value !== undefined;
  const close = (value: string | null) => {
    dialog.resolve(value);
    useStore.setState({ dialog: null });
  };
  const confirm = () => close(hasInput ? (input.current?.value ?? '') : '');

  return (
    <div className="modal-bg ask-bg" onMouseDown={() => close(null)}>
      <div
        className="modal ask-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{dialog.title}</h2>
        {dialog.message && <p>{dialog.message}</p>}
        {hasInput && (
          <input
            ref={input}
            className="ask-input"
            type={dialog.password ? 'password' : 'text'}
            defaultValue={dialog.value}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
              }
            }}
          />
        )}
        <div className="ask-actions">
          <button type="button" className="btn secondary" onClick={() => close(null)}>Cancel</button>
          <button type="button" className={`btn ${dialog.danger ? 'danger' : ''}`} onClick={confirm}>
            {dialog.confirmLabel || (dialog.danger ? 'Delete' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  );
}
