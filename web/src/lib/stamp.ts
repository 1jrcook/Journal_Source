/** Bangkok date and time, for the Ctrl+T / Cmd+T insert. */

export function jrStamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[Number(g('month')) - 1] || g('month');
  return `${g('day')} ${mon} ${g('year')}, ${g('hour')}:${g('minute')}`;
}

function nativeSet(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

/** Insert the stamp at the caret. Returns false when focus is not a text field. */
export function insertJrStamp(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const text = `${jrStamp()} `;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && (!el.type || el.type === 'text' || el.type === 'search'))) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    nativeSet(el, el.value.slice(0, start) + text + el.value.slice(end));
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return true;
  }
  const editable = el.isContentEditable ? el : (el.closest('[contenteditable="true"]') as HTMLElement | null);
  if (!editable) return false;
  editable.focus();
  return document.execCommand('insertText', false, text);
}
