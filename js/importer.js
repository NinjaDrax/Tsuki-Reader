// Import files into the library: extract metadata, build cover, store blob.
import { db } from './db.js';
import { uid, makeThumb, progress, toast } from './util.js';
import { extOf, kindOf, openComic, openPdf, openEpub, openDocx, openText } from './formats.js';

export function parseName(filename) {
  let base = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let m = base.match(/^(.*?)\s*#\s*0*(\d+(?:\.\d+)?)\b/) || base.match(/^(.*\D)\s+0*(\d{1,4})$/);
  const yr = base.match(/\((19\d\d|20\d\d)\)/);
  const clean = s => s.replace(/\(.*?\)|\[.*?\]/g, '').replace(/[-–\s]+$/, '').trim();
  if (m && clean(m[1])) return { series: clean(m[1]), number: String(+m[2]), title: `${clean(m[1])} #${+m[2]}`, year: yr ? +yr[1] : 0 };
  return { series: '', number: '', title: clean(base) || base, year: yr ? +yr[1] : 0 };
}

function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }

export function textCover(title, label, author = '') {
  const c = document.createElement('canvas'); c.width = 360; c.height = 540;
  const x = c.getContext('2d'); const h = hue(title);
  const g = x.createLinearGradient(0, 0, 360, 540);
  g.addColorStop(0, `hsl(${h},55%,38%)`); g.addColorStop(1, `hsl(${(h + 40) % 360},60%,22%)`);
  x.fillStyle = g; x.fillRect(0, 0, 360, 540);
  x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.arc(300, 80, 150, 0, 7); x.fill();
  x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 0, 18, 540);
  x.fillStyle = 'rgba(255,255,255,.9)'; x.font = '600 22px system-ui,sans-serif'; x.textBaseline = 'top';
  x.fillText(label, 40, 36);
  x.fillStyle = '#fff'; x.font = '700 38px Georgia,serif';
  const words = title.split(/\s+/); const lines = []; let ln = '';
  for (const w of words) { const t = ln ? ln + ' ' + w : w; if (x.measureText(t).width > 290 && ln) { lines.push(ln); ln = w; } else ln = t; }
  if (ln) lines.push(ln);
  lines.slice(0, 6).forEach((l, i) => x.fillText(l + (i === 5 && lines.length > 6 ? '…' : ''), 40, 120 + i * 48));
  if (author) { x.font = '400 22px Georgia,serif'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(author.slice(0, 28), 40, 480); }
  return new Promise(r => c.toBlob(r, 'image/jpeg', .85));
}

export async function importFile(file) {
  const ext = extOf(file.name), kind = kindOf(file.name);
  if (!kind) throw new Error('Unsupported file type: .' + ext);
  const nm = parseName(file.name);
  const b = {
    id: uid(), filename: file.name, ext, kind, size: file.size, mtime: file.lastModified || Date.now(), added: Date.now(),
    title: nm.title, series: nm.series, number: nm.number, year: nm.year,
    tags: [], collections: [], bookmarks: [], status: 'new', lastPage: 0, lastRead: 0, fav: false, pages: 0, progress: 0
  };
  let cover = null;
  if (kind === 'comic') {
    const c = await openComic(file);
    b.pages = c.count; Object.assign(b, c.info);
    if (c.info.series && c.info.number && !c.info.title) b.title = `${c.info.series} #${c.info.number}`;
    cover = await makeThumb(await c.getBlob(0));
  } else if (kind === 'pdf') {
    const p = await openPdf(file);
    b.pages = p.count;
    if (p.info.title) b.title = p.info.title;
    if (p.info.writer) b.writer = p.info.writer;
    cover = await makeThumb(await p.getBlob(0, 480), 360);
    p.doc.destroy?.();
  } else if (kind === 'epub') {
    const e = await openEpub(file);
    Object.assign(b, Object.fromEntries(Object.entries(e.info).filter(([, v]) => v)));
    b.pages = e.count; b.chapters = e.count;
    const cb = await e.coverBlob();
    if (cb) { try { cover = await makeThumb(cb); } catch {} }
  } else {
    const d = kind === 'docx' ? await openDocx(file) : await openText(file, kind === 'md');
    Object.assign(b, Object.fromEntries(Object.entries(d.info).filter(([, v]) => v)));
    b.pages = Math.max(1, Math.round(d.words / 300));
  }
  if (!cover) cover = await textCover(b.title, ext.toUpperCase(), b.writer || '');
  b.coverBlob = cover;
  await db.putFile(b.id, file);
  await db.putBook(b);
  return b;
}

export async function importFiles(files, existing = []) {
  const list = [...files].filter(f => kindOf(f.name));
  const skipped = [...files].length - list.length;
  const have = new Set(existing.map(b => b.filename + '|' + b.size));
  let ok = 0, dup = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    progress(i / list.length);
    if (have.has(f.name + '|' + f.size)) { dup++; continue; }
    try { await importFile(f); ok++; have.add(f.name + '|' + f.size); }
    catch (e) { console.error(f.name, e); fail++; toast(`Couldn't import ${f.name}: ${e.message}`, 4000); await new Promise(r => setTimeout(r, 300)); }
  }
  progress(null);
  return { ok, dup, fail, skipped };
}
