import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const natCmp = (a, b) => coll.compare(a, b);

export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 2);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '') + ' ' + u[i];
}
export function fmtDate(t) {
  if (!t) return 'Never';
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastEl;
export function toast(msg, ms = 2600) {
  toastEl?.remove();
  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.textContent = msg;
  document.body.appendChild(toastEl);
  setTimeout(() => toastEl?.remove(), ms);
}

let progEl;
export function progress(frac) {
  if (frac == null || frac >= 1) { progEl?.remove(); progEl = null; return; }
  if (!progEl) {
    progEl = document.createElement('div');
    progEl.className = 'prog';
    progEl.innerHTML = '<i></i>';
    document.body.appendChild(progEl);
  }
  progEl.firstChild.style.width = Math.round(frac * 100) + '%';
}

/** Generic modal / bottom sheet. Returns {el, close}. */
export function modal(html, { center = false, onClose } = {}) {
  const m = document.createElement('div');
  m.className = 'modal' + (center ? ' center' : '');
  m.innerHTML = `<div class="dlg">${html}</div>`;
  const close = v => { m.remove(); onClose?.(v); };
  m.addEventListener('pointerdown', e => { if (e.target === m) close(); });
  document.body.appendChild(m);
  return { el: m.firstChild, root: m, close };
}

export function confirmDlg(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const { el, close } = modal(`<h2>${esc(title)}</h2><p style="color:var(--on2);margin:0">${esc(text)}</p>
      <div class="acts"><button class="btn text" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : ''}" style="margin:0" data-r="1">${esc(okLabel)}</button></div>`,
      { center: true, onClose: () => res(false) });
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { res(b.dataset.r === '1'); close(); });
  });
}

export function promptDlg(title, label, value = '') {
  return new Promise(res => {
    const { el, close } = modal(`<h2>${esc(title)}</h2><label class="field"><span>${esc(label)}</span><input value="${esc(value)}" autofocus></label>
      <div class="acts"><button class="btn text" data-r="0">Cancel</button><button class="btn" style="margin:0" data-r="1">OK</button></div>`,
      { center: true, onClose: () => res(null) });
    const inp = el.querySelector('input');
    setTimeout(() => inp.focus(), 50);
    inp.onkeydown = e => { if (e.key === 'Enter') { res(inp.value.trim()); close(); } };
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { res(b.dataset.r === '1' ? inp.value.trim() : null); close(); });
  });
}

/** Choice sheet: items [{id,label,sub,icon}] -> resolves id */
export function choose(title, items, current) {
  return new Promise(res => {
    const { el, close } = modal(`<h2>${esc(title)}</h2>` + items.map(i =>
      `<div class="opt ${i.id === current ? 'sel' : ''}" data-id="${esc(i.id)}">${i.icon ? icon(i.icon) : ''}<div class="l">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div></div>`).join(''),
      { onClose: () => res(undefined) });
    el.querySelectorAll('.opt').forEach(o => o.onclick = () => { res(o.dataset.id); close(); });
  });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export function wakeLock() {
  let lock;
  const req = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch {} };
  const vis = () => { if (document.visibilityState === 'visible') req(); };
  req();
  document.addEventListener('visibilitychange', vis);
  return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.().catch(() => {}); };
}

/** Shrink an image blob/url to a JPEG blob of given width. */
export async function makeThumb(src, width = 360, quality = .82) {
  const bmp = src instanceof Blob ? await createImageBitmap(src) : src;
  const w = Math.min(width, bmp.width), h = Math.round(bmp.height * w / bmp.width);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise(r => c.toBlob(r, 'image/jpeg', quality));
}
