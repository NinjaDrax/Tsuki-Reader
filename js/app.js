import { icon } from './icons.js';
import { db } from './db.js';
import { $, $$, esc, natCmp, fmtSize, fmtDate, toast, modal, confirmDlg, promptDlg, choose, download, progress } from './util.js';
import { settings, onSetting, applyTheme, THEMES } from './state.js';
import { ACCEPT, kindOf, openBook } from './formats.js';
import { importFiles } from './importer.js';
import { startReader } from './reader.js';
import { startDocReader } from './docreader.js';

const root = $('#app');
let books = [];
let query = '';
let authorRole = 'all';
let destroyReader = null;
const scrollMem = new Map();
const coverUrls = new Map();

/* ------------------------------------------------------------- helpers */
const coverUrl = b => {
  if (!b.coverBlob) return '';
  let u = coverUrls.get(b.id);
  if (!u || u.blob !== b.coverBlob) {
    if (u) URL.revokeObjectURL(u.url);
    u = { blob: b.coverBlob, url: URL.createObjectURL(b.coverBlob) };
    coverUrls.set(b.id, u);
  }
  return u.url;
};
const byId = id => books.find(b => b.id === id);
const go = h => { location.hash = h; };
const kindGroup = b => b.kind === 'comic' ? 'comic' : b.kind === 'pdf' ? 'pdf' : b.kind === 'epub' ? 'epub' : 'doc';
const KIND_LABEL = { comic: 'Comic', pdf: 'PDF', epub: 'EPUB', docx: 'DOCX', text: 'TXT', md: 'MD' };

export function bookProgress(b) {
  if (b.status === 'read') return 1;
  if (b.status === 'new') return 0;
  if (b.kind === 'comic' || b.kind === 'pdf') return b.pages > 1 ? Math.min(1, (b.lastPage + 1) / b.pages) : 0;
  return b.progress || 0;
}
async function saveBook(b) { await db.putBook(b); }
async function reload() { books = await db.allBooks(); }
const seriesNum = b => parseFloat(b.number) || 0;

function sortBooks(list) {
  const d = settings.sortDir;
  const key = {
    name: (a, b) => natCmp(a.series ? a.series + ' ' + String(seriesNum(a)).padStart(5, '0') : a.title, b.series ? b.series + ' ' + String(seriesNum(b)).padStart(5, '0') : b.title),
    added: (a, b) => a.added - b.added,
    lastRead: (a, b) => a.lastRead - b.lastRead,
    year: (a, b) => (a.year || 0) - (b.year || 0),
    size: (a, b) => a.size - b.size,
    progress: (a, b) => bookProgress(a) - bookProgress(b)
  }[settings.sort] || (() => 0);
  return [...list].sort((a, b) => d * key(a, b) || natCmp(a.title, b.title));
}
function filtered(extra = true) {
  const q = query.trim().toLowerCase();
  let l = books.filter(b => {
    if (settings.status !== 'all' && b.status !== settings.status) return false;
    if (settings.kind !== 'all' && kindGroup(b) !== settings.kind) return false;
    if (settings.favOnly && !b.fav) return false;
    if (extra && settings.collection !== 'all' && !(b.collections || []).includes(settings.collection)) return false;
    if (q) {
      const hay = [b.title, b.series, b.filename, b.writer, b.penciller, b.inker, b.publisher, (b.tags || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return sortBooks(l);
}
async function collectionsList() { return (await db.kvGet('collections')) || []; }
async function saveCollections(c) { await db.kvSet('collections', c); }

function applyCols() {
  const w = Math.min(root.clientWidth || innerWidth, 1200);
  const n = settings.cols || Math.max(3, Math.min(8, Math.floor(w / 150)));
  document.documentElement.style.setProperty('--cols', n);
}
addEventListener('resize', applyCols);

/* ------------------------------------------------------------ components */
function cardHtml(b) {
  const pr = bookProgress(b);
  const badge = b.status === 'new' ? '<span class="badge">NEW</span>' : b.status === 'reading' ? '<span class="badge reading">READING</span>' : '';
  const typ = b.kind !== 'comic' ? `<span class="typ">${b.ext.toUpperCase()}</span>` : '';
  return `<div class="card ${settings.showTitles ? '' : 'notitle'}" data-id="${b.id}" title="${esc(b.title)}">
    <img loading="lazy" decoding="async" src="${coverUrl(b)}" alt="">${typ}<div class="shade"></div>${badge}${b.fav ? `<span class="fav" ${typ ? 'style="top:30px"' : ''}>${icon('star')}</span>` : ''}
    <div class="t">${esc(b.title)}</div><div class="bar"><i style="width:${Math.round(pr * 100)}%"></i></div></div>`;
}
function rowHtml(b) {
  const tag = b.status === 'new' ? '<span class="tg new">NEW</span>' : b.status === 'reading' ? '<span class="tg reading">READING</span>' : '<span class="tg read">READ</span>';
  return `<div class="row" data-id="${b.id}"><img class="th" loading="lazy" src="${coverUrl(b)}" alt="">
    <div class="tx"><div class="nm">${esc(b.filename)}</div><div class="meta"><span>${fmtSize(b.size)}</span><span>${new Date(b.mtime).toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' })}</span></div>
    <div class="tags"><span class="tg">${b.ext.toUpperCase()}</span>${tag}${b.fav ? `<span class="tg" style="background:#FFB300">★</span>` : ''}</div></div></div>`;
}
const topbar = (title, left = 'menu', right = '') =>
  `<div class="topbar"><button class="ib" data-act="${left}" aria-label="${left}">${icon(left === 'menu' ? 'menu' : 'back')}</button><h1>${esc(title)}</h1>${right || '<span style="width:48px"></span>'}</div>`;
const starBtn = () => `<button class="ib ${settings.favOnly ? 'on' : ''}" data-act="favonly" aria-label="Favorites">${icon(settings.favOnly ? 'star' : 'star_o')}</button>`;
const addBtn = `<button class="ib" data-act="add" aria-label="Add files">${icon('add')}</button>`;

function continueCard() {
  const c = [...books].filter(b => b.status === 'reading').sort((a, b) => b.lastRead - a.lastRead)[0];
  if (!c) return '';
  return `<div class="continue" data-read="${c.id}"><img src="${coverUrl(c)}" alt=""><div class="ct"><small>Continue</small><b>${esc(c.title)}</b><i><u style="width:${Math.round(bookProgress(c) * 100)}%"></u></i></div></div>`;
}
function emptyState() {
  return `<div class="empty">${icon('lib')}<h2>Your library is empty</h2><p>Add comics (CBZ, CBR, CB7, CBT) or books (PDF, EPUB, DOCX, TXT, MD).<br>Files stay on this device.</p>
    <button class="btn" data-act="add">${icon('add')} Add files</button><br><button class="btn tonal" data-act="addfolder">${icon('folder')} Add a folder</button></div>`;
}
function shell(inner, extra = '') {
  root.innerHTML = `<div class="sheet">${inner}${extra}</div>`;
  applyCols();
}
const pillTools = (view = true) => `
  <button class="ib" data-act="filter" aria-label="Filter">${icon('filter')}</button>
  ${view ? `<button class="ib" data-act="viewtoggle" aria-label="View">${icon(settings.view === 'grid' ? 'grid' : 'list')}</button>` : ''}
  <button class="ib" data-act="tune" aria-label="Display options">${icon('tune')}</button>`;

/* ---------------------------------------------------------------- views */
async function viewLibrary() {
  const cols = await collectionsList();
  const colName = settings.collection === 'all' ? 'All' : (cols.find(c => c.id === settings.collection)?.name || 'All');
  const title = settings.collection === 'all' ? 'All books' : colName;
  const list = filtered();
  shell(`${topbar(title, 'menu', addBtn + starBtn())}
    <div class="pill"><div class="sel" data-act="pickcol"><span class="dot"></span><span>${esc(colName)}</span>${icon('down')}</div>${pillTools()}</div>
    <div class="content" id="cnt">${!books.length ? emptyState() : !list.length ? `<div class="empty"><h2>Nothing here</h2><p>No books match the current filters.</p><button class="btn tonal" data-act="resetfilters">Reset filters</button></div>` :
      settings.view === 'grid' ? `<div class="grid">${list.map(cardHtml).join('')}</div>` : `<div class="list">${list.map(rowHtml).join('')}</div>`}</div>`, continueCard());
}

function groupView(title, groupsFn, iconName, { chips = '' } = {}) {
  const list = filtered();
  const groups = groupsFn(list);
  shell(`${topbar(title, 'menu', addBtn + starBtn())}
    <div class="pill"><button class="ib" data-act="filter">${icon('filter')}</button>${chips ? `<div class="chips">${chips}</div>` : `<input id="q" placeholder="Filter" value="${esc(query)}" aria-label="Filter">`}<span class="sep"></span><button class="ib" data-act="tune">${icon('tune')}</button></div>
    <div class="content" id="cnt">${!books.length ? emptyState() : !groups.length ? `<div class="empty"><h2>Nothing here</h2></div>` :
      groups.map(([name, items]) => `<div class="group"><div class="gh"><span class="gi">${icon(iconName)}</span><span class="gn">${esc(name)}</span>${items.length > 3 ? `<span class="more">+${items.length - 3} Books</span>` : ''}</div>
        <div class="row">${items.map(cardHtml).join('')}</div></div>`).join('')}</div>`, continueCard());
  const q = $('#q');
  if (q) q.oninput = () => { query = q.value; const pos = q.selectionStart; route(true).then(() => { const n = $('#q'); n?.focus(); n?.setSelectionRange(pos, pos); }); };
}
const sortedByNumber = items => [...items].sort((a, b) => seriesNum(a) - seriesNum(b) || natCmp(a.title, b.title));
function groupBy(list, keysOf, unknown = 'Unknown') {
  const m = new Map();
  list.forEach(b => { const ks = keysOf(b); (ks.length ? ks : [unknown]).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(b); }); });
  return m;
}
const viewSeries = () => groupView('Series', l => [...groupBy(l, b => b.series ? [b.series] : [], 'No series')].sort((a, b) => a[0] === 'No series' ? 1 : b[0] === 'No series' ? -1 : natCmp(a[0], b[0])).map(([k, v]) => [k, sortedByNumber(v)]), 'book');
const ROLES = [['all', 'All authors'], ['writer', 'Writer'], ['penciller', 'Penciller'], ['inker', 'Inker'], ['colorist', 'Colorist'], ['cover', 'Cover artist']];
function viewAuthors() {
  const split = s => (s || '').split(/\s*[,;&]\s*/).filter(Boolean);
  const keys = b => authorRole === 'all' ? [...new Set(['writer', 'penciller', 'inker', 'colorist', 'cover'].flatMap(r => split(b[r])))] : split(b[authorRole]);
  const chips = ROLES.map(([id, n]) => `<button class="chip ${authorRole === id ? 'sel' : ''}" data-role="${id}">${authorRole === id ? icon('check') : ''}${n}</button>`).join('');
  groupView('Authors', l => [...groupBy(l, keys)].sort((a, b) => a[0] === 'Unknown' ? -1 : b[0] === 'Unknown' ? 1 : natCmp(a[0], b[0])), 'person', { chips });
}
const viewYears = () => groupView('Years', l => [...groupBy(l, b => b.year ? [String(b.year)] : [], 'Unknown year')].sort((a, b) => natCmp(a[0], b[0])), 'cal');
const viewTags = () => groupView('Tags', l => [...groupBy(l, b => b.tags || [], 'Untagged')].sort((a, b) => natCmp(a[0], b[0])), 'hash');

async function viewCollections() {
  const cols = await collectionsList();
  const list = filtered(false);
  shell(`${topbar('Collections', 'menu', `<button class="ib" data-act="newcol">${icon('add')}</button>`)}
    <div class="content" id="cnt">${!cols.length ? `<div class="empty">${icon('lib')}<h2>No collections yet</h2><p>Group your books into your own shelves.</p><button class="btn" data-act="newcol">${icon('add')} New collection</button></div>` :
      cols.map(c => { const items = list.filter(b => (b.collections || []).includes(c.id)); return `<div class="group"><div class="gh"><span class="gi">${icon('lib')}</span><span class="gn">${esc(c.name)}</span>
        <button class="ib" style="width:36px;height:36px" data-rencol="${c.id}">${icon('edit', 20)}</button><button class="ib" style="width:36px;height:36px" data-delcol="${c.id}">${icon('del', 20)}</button></div>
        ${items.length ? `<div class="row">${items.map(cardHtml).join('')}</div>` : `<p style="color:var(--on2);margin:4px 8px 8px">Empty — add books from a book's details page.</p>`}</div>`; }).join('')}</div>`);
}

function viewFiles() {
  const list = filtered(false);
  const total = list.reduce((a, b) => a + b.size, 0);
  shell(`${topbar('My Files', 'menu', `<button class="ib" data-act="tune">${icon('tune')}</button>`)}
    <div class="content" id="cnt" style="padding-bottom:20px">
      <div class="cardbox"><h3>Add to library</h3>
        <div class="it" data-act="add">${icon('add')}<span>Add files…</span></div>
        <div class="it" data-act="addfolder">${icon('folder')}<span>Add a folder…</span></div>
        <div class="it" style="cursor:default">${icon('upload')}<span>…or drag &amp; drop files anywhere</span></div></div>
      <div class="cardbox" style="padding-bottom:6px"><h3>Library files</h3>${list.length ? `<div class="list">${list.map(rowHtml).join('')}</div>` : '<p style="text-align:center;color:var(--on2)">No files yet</p>'}</div>
    </div><div class="listfoot"><span>${list.length} files</span><span>${fmtSize(total)}</span></div>`);
}

/* details */
async function viewDetails(id) {
  const b = byId(id);
  if (!b) { go('/library'); return; }
  const pr = bookProgress(b);
  const cred = [['Writer', b.writer], ['Penciller', b.penciller], ['Inker', b.inker], ['Colorist', b.colorist], ['Letterer', b.letterer], ['Cover Artist', b.cover], ['Publisher', b.publisher]].filter(x => x[1]);
  const lastTxt = b.lastRead ? fmtDate(b.lastRead) : 'Never';
  const unit = b.kind === 'epub' ? 'Chapters' : b.kind === 'comic' || b.kind === 'pdf' ? 'Page Count' : 'Est. pages';
  const cur = b.kind === 'comic' || b.kind === 'pdf' ? (b.status === 'new' ? 0 : b.lastPage + 1) : Math.round(pr * b.pages);
  const cols = await collectionsList();
  shell(`<div class="content det" id="cnt" style="padding:0 0 10px">
    <div class="hd">${esc(b.title)}</div>
    <div class="top"><img class="cv" src="${coverUrl(b)}" alt="">
      <div class="info"><div class="box"><div class="r"><span class="tg">${b.ext.toUpperCase()}</span><b>${b.year || ''}</b></div><div class="r"><span>Size</span><b>${fmtSize(b.size)}</b></div></div>
        <div class="status ${b.status}"><span>${{ new: 'New', reading: 'Reading', read: 'Read' }[b.status]}</span>${icon('down')}<select id="st" aria-label="Status"><option value="new">New</option><option value="reading">Reading</option><option value="read">Read</option></select></div>
        <div class="btns"><button class="lb" data-act="addcol" aria-label="Collections">${icon('lib')}</button><button class="rb" data-read="${b.id}">${icon('book')}<span>${b.status === 'reading' ? 'Continue' : 'Read'}</span></button></div></div></div>
    <div class="tagbox" data-act="edit">${icon('hash')}<span>${(b.tags || []).length ? b.tags.map(t => '#' + esc(t)).join('  ') : 'No #tags'}</span>${icon('edit', 22)}</div>
    <div class="pg"><div class="n"><b>${cur}</b><small>/${b.pages}</small><div>${unit}</div></div><div class="m"><i style="width:${Math.round(pr * 100)}%"></i></div><div class="n"><div style="margin-top:22px">Last read</div><div>${lastTxt}</div></div></div>
    ${cred.length ? `<div class="cred">${cred.map(([k, v]) => `<div>${icon('person')}<div><small>${k}</small>${esc(v)}</div></div>`).join('')}</div>` : ''}
    ${b.series ? `<div style="padding:0 18px 6px;color:var(--on2)">Series: <b style="color:var(--on)">${esc(b.series)}${b.number ? ' #' + esc(b.number) : ''}</b></div>` : ''}
    ${(b.collections || []).length ? `<div style="padding:0 18px 6px;color:var(--on2)">Collections: ${(b.collections || []).map(c => esc(cols.find(x => x.id === c)?.name || '')).filter(Boolean).join(', ')}</div>` : ''}
    <div class="sum">${esc(b.summary || '')}</div></div>
    <div class="bottombar"><button class="ib" data-act="back">${icon('back')}</button><button class="ib" data-act="fav" style="${b.fav ? 'color:#FFB300' : ''}">${icon(b.fav ? 'star' : 'star_o')}</button>
      <button class="ib" data-act="savecover" aria-label="Save cover">${icon('image')}</button><button class="ib" data-act="edit" aria-label="Edit">${icon('edit')}</button>
      <button class="ib" data-act="sharefile" aria-label="Download / share">${icon('share')}</button><button class="ib" data-act="delete" aria-label="Delete">${icon('del')}</button></div>`);
  $('#st').value = b.status;
  $('#st').onchange = async e => {
    const v = e.target.value; b.status = v;
    if (v === 'new') { b.lastPage = 0; b.progress = 0; b.lastRead = 0; }
    if (v === 'read') { b.lastPage = Math.max(0, b.pages - 1); b.progress = 1; }
    if (v === 'reading' && !b.lastRead) b.lastRead = Date.now();
    await saveBook(b); viewDetails(id);
  };
}

/* settings */
async function viewSettings() {
  const est = (await navigator.storage?.estimate?.().catch(() => null)) || {};
  const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(settings[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (key, label, sub = '') => `<div class="opt" data-sw="${key}"><div class="l">${label}${sub ? `<small>${sub}</small>` : ''}</div><span class="sw ${settings[key] ? 'on' : ''}"></span></div>`;
  shell(`${topbar('Settings')}<div class="content set" id="cnt">
    <h4>Theme</h4><div class="themes">${THEMES.map(t => `<div class="th-sw ${settings.theme === t.id ? 'sel' : ''}" data-theme="${t.id}"><div class="pv" style="background:${t.bg}"><i style="background:${t.fg}"></i></div><p>${t.name}</p></div>`).join('')}</div>
    <h4>Library</h4><div style="padding:0 16px"><small style="color:var(--on2)">Columns</small>${seg('cols', [[0, 'Auto'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']])}</div>
    ${sw('showTitles', 'Show titles on covers')}
    <h4>Reader (comics &amp; PDF)</h4><div style="padding:0 16px"><small style="color:var(--on2)">Reading direction</small>${seg('readMode', [['auto', 'Auto'], ['ltr', 'Left→Right'], ['rtl', 'Manga RTL'], ['webtoon', 'Webtoon']])}
      <small style="color:var(--on2)">Page scale</small>${seg('scale', [['fit', 'Fit screen'], ['width', 'Fit width'], ['height', 'Fit height'], ['orig', 'Original']])}
      <small style="color:var(--on2)">Background</small>${seg('readerBg', [['auto', 'Theme'], ['white', 'White'], ['gray', 'Gray'], ['black', 'Black']])}</div>
    ${sw('double', 'Double-page spreads', 'Show two pages side by side in landscape')}
    ${sw('tapNav', 'Tap zones', 'Tap left / right edges to turn pages')}
    ${sw('tapInvert', 'Invert tap zones')}
    ${sw('doubleTap', 'Double-tap to zoom')}
    ${sw('keepAwake', 'Keep screen on while reading')}
    <div style="padding:6px 16px 0"><small style="color:var(--on2)">Night dimming: <span id="nv">${settings.night}</span>%</small><input type="range" min="0" max="60" value="${settings.night}" id="night"></div>
    <h4>Storage</h4><div class="opt"><div class="l">Library storage<small>${est.usage ? fmtSize(est.usage) + ' used' + (est.quota ? ' of ' + fmtSize(est.quota) : '') : 'Unknown'}</small></div></div>
    <div class="opt" data-act="persist"><div class="l">Protect storage<small>Ask the browser not to clear your library automatically</small></div></div>
    <div class="opt" data-act="wipe"><div class="l" style="color:#C62828">Delete entire library<small>Removes all books and reading progress from this device</small></div></div>
    <h4>About</h4><div class="opt"><div class="l">Tsuki Reader 1.0<small>Comics: CBZ · CBR · CB7 · CBT — Books: PDF · EPUB · DOCX · TXT · Markdown. Everything is free and stays on your device.</small></div></div>
  </div>`);
  const n = $('#night'); if (n) n.oninput = () => { settings.night = +n.value; $('#nv').textContent = n.value; };
}

/* ---------------------------------------------------------- dialogs */
function filterDlg() {
  const { el, close } = modal(`<h2>Filter</h2>
    <small style="color:var(--on2)">Status</small><div class="seg" data-k="status">${[['all', 'All'], ['new', 'New'], ['reading', 'Reading'], ['read', 'Read']].map(([v, l]) => `<button data-v="${v}" class="${settings.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <small style="color:var(--on2)">Type</small><div class="seg" data-k="kind">${[['all', 'All'], ['comic', 'Comics'], ['pdf', 'PDF'], ['epub', 'EPUB'], ['doc', 'Docs']].map(([v, l]) => `<button data-v="${v}" class="${settings.kind === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="opt" data-fav><div class="l">Favorites only</div><span class="sw ${settings.favOnly ? 'on' : ''}"></span></div>
    <div class="acts"><button class="btn text" data-reset>Reset</button><button class="btn" style="margin:0" data-ok>Done</button></div>`);
  el.querySelectorAll('.seg').forEach(s => s.onclick = e => { const v = e.target.dataset.v; if (v == null) return; settings[s.dataset.k] = v; s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === e.target)); });
  el.querySelector('[data-fav]').onclick = e => { settings.favOnly = !settings.favOnly; e.currentTarget.querySelector('.sw').classList.toggle('on', settings.favOnly); };
  el.querySelector('[data-reset]').onclick = () => { Object.assign(settings, {}); settings.status = 'all'; settings.kind = 'all'; settings.favOnly = false; close(); route(true); };
  el.querySelector('[data-ok]').onclick = () => { close(); route(true); };
}
function tuneDlg() {
  const { el, close } = modal(`<h2>Display &amp; sort</h2>
    <small style="color:var(--on2)">Sort by</small><div class="seg" data-k="sort" style="flex-wrap:wrap">${[['name', 'Name'], ['added', 'Added'], ['lastRead', 'Last read'], ['year', 'Year'], ['size', 'Size'], ['progress', 'Progress']].map(([v, l]) => `<button data-v="${v}" class="${settings.sort === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <small style="color:var(--on2)">Order</small><div class="seg" data-k="sortDir">${[[1, 'Ascending'], [-1, 'Descending']].map(([v, l]) => `<button data-v="${v}" class="${settings.sortDir === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <small style="color:var(--on2)">Columns</small><div class="seg" data-k="cols">${[[0, 'Auto'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']].map(([v, l]) => `<button data-v="${v}" class="${settings.cols === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="opt" data-titles><div class="l">Show titles</div><span class="sw ${settings.showTitles ? 'on' : ''}"></span></div>
    <div class="acts"><button class="btn" style="margin:0" data-ok>Done</button></div>`);
  el.querySelectorAll('.seg').forEach(s => s.onclick = e => { let v = e.target.dataset.v; if (v == null) return; settings[s.dataset.k] = +v === +v ? +v : v; s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === e.target)); });
  el.querySelector('[data-titles]').onclick = e => { settings.showTitles = !settings.showTitles; e.currentTarget.querySelector('.sw').classList.toggle('on', settings.showTitles); };
  el.querySelector('[data-ok]').onclick = () => { close(); route(true); };
}
async function editDlg(b) {
  const f = (k, label, v) => `<label class="field"><span>${label}</span><input data-f="${k}" value="${esc(v ?? '')}"></label>`;
  const { el, close } = modal(`<h2>Edit information</h2>${f('title', 'Title', b.title)}<div class="two">${f('series', 'Series', b.series)}${f('number', 'Number', b.number)}</div>
    <div class="two">${f('year', 'Year', b.year || '')}${f('publisher', 'Publisher', b.publisher)}</div>
    <div class="two">${f('writer', 'Writer', b.writer)}${f('penciller', 'Penciller', b.penciller)}</div><div class="two">${f('inker', 'Inker', b.inker)}${f('colorist', 'Colorist', b.colorist)}</div>${f('cover', 'Cover artist', b.cover)}
    ${f('tags', 'Tags (comma separated)', (b.tags || []).join(', '))}<label class="field"><span>Summary</span><textarea data-f="summary">${esc(b.summary || '')}</textarea></label>
    <div class="acts"><button class="btn text" data-c>Cancel</button><button class="btn" style="margin:0" data-s>Save</button></div>`);
  el.querySelector('[data-c]').onclick = () => close();
  el.querySelector('[data-s]').onclick = async () => {
    el.querySelectorAll('[data-f]').forEach(i => {
      const k = i.dataset.f, v = i.value.trim();
      if (k === 'year') b.year = parseInt(v) || 0;
      else if (k === 'tags') b.tags = v ? [...new Set(v.split(/\s*,\s*/).map(t => t.replace(/^#/, '')).filter(Boolean))] : [];
      else b[k] = v;
    });
    b.title ||= b.filename;
    await saveBook(b); close(); route(true);
  };
}
async function collectionDlg(b) {
  let cols = await collectionsList();
  const draw = () => cols.length ? cols.map(c => `<div class="opt" data-c="${c.id}"><div class="l">${esc(c.name)}</div><span class="sw ${(b.collections || []).includes(c.id) ? 'on' : ''}"></span></div>`).join('') : '<p style="color:var(--on2)">No collections yet.</p>';
  const { el, close } = modal(`<h2>Add to collection</h2><div id="cl">${draw()}</div><div class="acts"><button class="btn tonal" style="margin:0" data-n>${icon('add')} New</button><button class="btn" style="margin:0" data-ok>Done</button></div>`);
  const wire = () => el.querySelectorAll('[data-c]').forEach(o => o.onclick = async () => {
    const id = o.dataset.c; b.collections ||= [];
    b.collections = b.collections.includes(id) ? b.collections.filter(x => x !== id) : [...b.collections, id];
    o.querySelector('.sw').classList.toggle('on'); await saveBook(b);
  });
  wire();
  el.querySelector('[data-n]').onclick = async () => {
    const name = await promptDlg('New collection', 'Name'); if (!name) return;
    const c = { id: 'c' + Date.now().toString(36), name }; cols.push(c); await saveCollections(cols);
    b.collections = [...(b.collections || []), c.id]; await saveBook(b);
    el.querySelector('#cl').innerHTML = draw(); wire();
  };
  el.querySelector('[data-ok]').onclick = () => { close(); route(true); };
}
function drawer() {
  const items = [['library', 'All books', 'lib'], ['series', 'Series', 'book'], ['authors', 'Authors', 'person'], ['years', 'Years', 'cal'], ['tags', 'Tags', 'hash'], ['collections', 'Collections', 'folder'], ['files', 'My Files', 'phone2'], ['settings', 'Settings', 'settings']];
  const cur = (location.hash.split('/')[1] || 'library');
  const s = document.createElement('div');
  s.innerHTML = `<div class="scrim"></div><nav class="drawer"><div class="brand"><img src="icons/icon-192.png" alt="">Tsuki Reader</div>
    ${items.slice(0, 6).map(([id, n, i]) => `<a href="#/${id}" class="${cur === id ? 'act' : ''}">${icon(i)}${n}</a>`).join('')}<hr>
    ${items.slice(6).map(([id, n, i]) => `<a href="#/${id}" class="${cur === id ? 'act' : ''}">${icon(i)}${n}</a>`).join('')}
    <hr><a href="#" data-add>${icon('add')}Add files</a><a href="#" data-addf>${icon('folder')}Add folder</a><div class="ver">Comics · PDF · EPUB · DOCX · TXT · MD<br>All data stays on this device</div></nav>`;
  document.body.appendChild(s);
  const close = () => s.remove();
  s.querySelector('.scrim').onclick = close;
  s.querySelectorAll('a').forEach(a => a.addEventListener('click', e => { if (a.dataset.add != null) { e.preventDefault(); pickFiles(false); } if (a.dataset.addf != null) { e.preventDefault(); pickFiles(true); } close(); }));
}

/* ------------------------------------------------------------ importing */
function pickFiles(folder) {
  const i = document.createElement('input');
  i.type = 'file'; i.multiple = true; i.accept = folder ? '' : ACCEPT;
  if (folder) i.webkitdirectory = true;
  i.onchange = () => doImport(i.files);
  i.click();
}
export async function doImport(files, openAfter = false) {
  const arr = [...files];
  if (!arr.length) return;
  toast(`Importing ${arr.length} file${arr.length > 1 ? 's' : ''}…`, 1800);
  const r = await importFiles(arr, books);
  await reload();
  const parts = [];
  if (r.ok) parts.push(`${r.ok} added`);
  if (r.dup) parts.push(`${r.dup} already in library`);
  if (r.fail) parts.push(`${r.fail} failed`);
  if (r.skipped && !r.ok) parts.push(`${r.skipped} unsupported`);
  toast(parts.join(' · ') || 'Nothing to import', 3200);
  if (openAfter && r.ok) { const nb = [...books].sort((a, b) => b.added - a.added)[0]; if (nb) return go('/read/' + nb.id); }
  route(true);
}
addEventListener('dragover', e => { e.preventDefault(); });
addEventListener('drop', async e => {
  e.preventDefault();
  const files = [];
  const items = [...(e.dataTransfer?.items || [])];
  const walk = async entry => {
    if (entry.isFile) await new Promise(r => entry.file(f => { files.push(f); r(); }, r));
    else if (entry.isDirectory) { const rd = entry.createReader(); let batch; do { batch = await new Promise(r => rd.readEntries(r, () => r([]))); for (const x of batch) await walk(x); } while (batch.length); }
  };
  if (items.length && items[0].webkitGetAsEntry) { for (const it of items) { const en = it.webkitGetAsEntry(); if (en) await walk(en); } }
  else files.push(...(e.dataTransfer?.files || []));
  doImport(files);
});
if ('launchQueue' in window) {
  launchQueue.setConsumer(async p => {
    if (!p.files?.length) return;
    const fs = await Promise.all(p.files.map(h => h.getFile()));
    await reload(); doImport(fs, true);
  });
}

/* ------------------------------------------------------------- reading */
function neighbors(b) {
  let list;
  if (b.series) list = sortedByNumber(books.filter(x => x.series === b.series));
  else list = sortBooks(books);
  const i = list.findIndex(x => x.id === b.id);
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}
async function openReading(id) {
  const b = byId(id);
  if (!b) return go('/library');
  const ov = document.createElement('div');
  ov.className = 'reader'; ov.style.zIndex = 45;
  ov.innerHTML = `<div class="r-load"><div class="spin"></div></div>`;
  document.body.appendChild(ov);
  try {
    const file = await db.getFile(id);
    if (!file) throw new Error('File data missing — please re-import this book');
    const src = await openBook(b, file);
    ov.remove();
    const saveDeb = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => saveBook(b), 400); }; })();
    const ctx = {
      book: b, src,
      save: patch => { Object.assign(b, patch); saveDeb(); },
      flush: () => saveBook(b),
      exit: () => { if (history.length > 1) history.back(); else go('/book/' + id); },
      neighbors: () => neighbors(b),
      open: nid => { location.replace('#/read/' + nid); },
      cover: coverUrl(b)
    };
    destroyReader = (src.kind === 'archive' || src.kind === 'pdf') ? startReader(ctx) : startDocReader(ctx);
  } catch (e) {
    console.error(e); ov.remove();
    toast('Could not open: ' + e.message, 4500);
    if (history.length > 1) history.back(); else go('/library');
  }
}

/* --------------------------------------------------------------- router */
async function route(keepScroll = false) {
  const prevHash = route.cur;
  const hash = location.hash.slice(1) || '/library';
  const [, view, arg] = hash.split('/');
  if (!keepScroll && prevHash) { const c = $('#cnt'); if (c) scrollMem.set(prevHash, c.scrollTop); }
  if (!keepScroll || view === 'read') { destroyReader?.(); destroyReader = null; }
  const savedScroll = keepScroll ? ($('#cnt')?.scrollTop || 0) : (scrollMem.get(hash) || 0);
  route.cur = hash;
  document.title = 'Tsuki Reader';
  if (view === 'read') { if (!keepScroll) await openReading(arg); return; }
  switch (view) {
    case 'series': viewSeries(); break;
    case 'authors': viewAuthors(); break;
    case 'years': viewYears(); break;
    case 'tags': viewTags(); break;
    case 'collections': await viewCollections(); break;
    case 'files': viewFiles(); break;
    case 'book': await viewDetails(arg); break;
    case 'settings': await viewSettings(); break;
    default: await viewLibrary();
  }
  const c = $('#cnt'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = savedScroll; c.style.scrollBehavior = ''; }
}
addEventListener('hashchange', () => route());

/* --------------------------------------------------------------- events */
root.addEventListener('click', async e => {
  const t = e.target;
  const read = t.closest('[data-read]');
  if (read) return go('/read/' + read.dataset.read);
  const card = t.closest('.card, .list .row');
  if (card?.dataset.id) return go('/book/' + card.dataset.id);
  const role = t.closest('[data-role]');
  if (role) { authorRole = role.dataset.role; return route(true); }
  const th = t.closest('.th-sw');
  if (th) { settings.theme = th.dataset.theme; applyTheme(); return viewSettings(); }
  const seg = t.closest('[data-seg] button');
  if (seg) { const k = seg.parentElement.dataset.seg; const v = seg.dataset.v; settings[k] = +v === +v ? +v : v; applyCols(); return viewSettings(); }
  const sw = t.closest('[data-sw]');
  if (sw) { settings[sw.dataset.sw] = !settings[sw.dataset.sw]; sw.querySelector('.sw').classList.toggle('on'); applyCols(); return; }
  const rc = t.closest('[data-rencol]'), dc = t.closest('[data-delcol]');
  if (rc) { const cols = await collectionsList(); const c = cols.find(x => x.id === rc.dataset.rencol); const n = await promptDlg('Rename collection', 'Name', c.name); if (n) { c.name = n; await saveCollections(cols); route(true); } return; }
  if (dc) { if (await confirmDlg('Delete collection?', 'Books stay in your library.', 'Delete', true)) { let cols = await collectionsList(); cols = cols.filter(x => x.id !== dc.dataset.delcol); await saveCollections(cols); for (const b of books) if ((b.collections || []).includes(dc.dataset.delcol)) { b.collections = b.collections.filter(x => x !== dc.dataset.delcol); await saveBook(b); } if (settings.collection === dc.dataset.delcol) settings.collection = 'all'; route(true); } return; }
  const a = t.closest('[data-act]'); if (!a) return;
  const id = (location.hash.split('/')[1] === 'book') ? location.hash.split('/')[2] : null;
  const b = id ? byId(id) : null;
  switch (a.dataset.act) {
    case 'menu': return drawer();
    case 'back': return history.length > 1 ? history.back() : go('/library');
    case 'add': return pickFiles(false);
    case 'addfolder': return pickFiles(true);
    case 'favonly': settings.favOnly = !settings.favOnly; return route(true);
    case 'filter': return filterDlg();
    case 'tune': return tuneDlg();
    case 'viewtoggle': settings.view = settings.view === 'grid' ? 'list' : 'grid'; return route(true);
    case 'resetfilters': settings.status = 'all'; settings.kind = 'all'; settings.favOnly = false; settings.collection = 'all'; query = ''; return route(true);
    case 'pickcol': {
      const cols = await collectionsList();
      const r = await choose('Show', [{ id: 'all', label: 'All books' }, ...cols.map(c => ({ id: c.id, label: c.name }))], settings.collection);
      if (r) { settings.collection = r; route(true); } return;
    }
    case 'newcol': { const n = await promptDlg('New collection', 'Name'); if (n) { const cols = await collectionsList(); cols.push({ id: 'c' + Date.now().toString(36), name: n }); await saveCollections(cols); route(true); } return; }
    case 'fav': if (b) { b.fav = !b.fav; await saveBook(b); viewDetails(id); } return;
    case 'edit': if (b) editDlg(b); return;
    case 'addcol': if (b) collectionDlg(b); return;
    case 'savecover': if (b?.coverBlob) download(b.coverBlob, (b.title || 'cover') + '.jpg'); return;
    case 'sharefile': if (b) {
      const f = await db.getFile(b.id); if (!f) return;
      const file = new File([f], b.filename, { type: f.type || 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: b.title }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      download(file, b.filename);
    } return;
    case 'delete': if (b && await confirmDlg('Delete this book?', `“${b.title}” will be removed from this device.`, 'Delete', true)) { await db.delBook(b.id); await reload(); toast('Deleted'); go('/library'); } return;
    case 'persist': { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage protected' : 'Browser declined — try installing the app first'); return; }
    case 'wipe': if (await confirmDlg('Delete entire library?', 'This cannot be undone.', 'Delete everything', true)) { await db.clear(); books = []; toast('Library cleared'); route(true); } return;
  }
});

/* ---------------------------------------------------------------- start */
(async function init() {
  applyTheme();
  onSetting(k => { if (k === 'theme') applyTheme(); });
  await reload();
  // Auto-migrate: books flagged reading but missing numbers
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
