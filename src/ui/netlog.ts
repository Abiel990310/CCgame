import { netlogText } from '../net/netlog';
import './coop.css';

/** The connection log in a box the player can copy from or screenshot. */
export function showNetLog(): void {
  const root = document.createElement('div');
  root.className = 'modal netlog';
  const inner = document.createElement('div');
  inner.className = 'modal-inner';
  const title = document.createElement('h2');
  title.textContent = 'Connection log';
  const blurb = document.createElement('p');
  blurb.className = 'blurb';
  blurb.textContent = 'Send this, or a screenshot of it, to whoever is fixing the game. It shows how far each connection got.';
  const pre = document.createElement('pre');
  pre.className = 'netlog-text';
  pre.textContent = netlogText();
  const row = document.createElement('div');
  row.className = 'start-row';
  const copy = document.createElement('button');
  copy.className = 'primary-btn';
  copy.textContent = 'Copy';
  const close = document.createElement('button');
  close.className = 'ghost-btn';
  close.textContent = 'Close';
  row.append(copy, close);
  inner.append(title, blurb, pre, row);
  root.appendChild(inner);
  document.body.appendChild(root);

  const done = (): void => {
    root.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    done();
  };
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', done);
  root.addEventListener('click', (e) => {
    if (e.target === root) done();
  });
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(pre.textContent ?? '').then(
      () => (copy.textContent = 'Copied'),
      () => (copy.textContent = 'Select and copy it'),
    );
  });
}

/** A small link-style button that opens the log, to sit beside an error. */
export function netLogButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'netlog-link';
  b.textContent = 'Show connection log';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    showNetLog();
  });
  return b;
}
