// Format detection + openers for every supported file type.
import { natCmp } from './util.js';

export const KINDS = {
  cbz: 'comic', cbr: 'comic', cb7: 'comic', cbt: 'comic', zip: 'comic', rar: 'comic', '7z': 'comic', tar: 'comic',
  pdf: 'pdf', epub: 'epub', docx: 'docx', txt: 'text', md: 'md', markdown: 'md', text: 'text'
};
export const ACCEPT = Object.keys(KINDS).map(e => '.' + e).join(',');
export const extOf = n => (n.split('.').pop() || '').toLowerCase();
export const kindOf = n => KINDS[extOf(n)];
const IMG = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
const isImg = n => IMG[extOf(n)] && !/(^|\/)(__MACOSX|\.)/.test(n) && !/(^|\/)\._/.test(n);
const mime = n => IMG[extOf(n)] || 'application/octet-stream';

export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src;
    s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}
const V = p => new URL('../vendor/' + p, import.meta.url).href;
export const ensureJSZip = async () => { if (!window.JSZip) await loadScript(V('jszip.min.js')); return window.JSZip; };

/* ------------------------------------------------------------------ comics */
async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (b[0] === 0x50 && b[1] === 0x4B) return 'zip';
  if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72) return 'rar';
  if (b[0] === 0x37 && b[1] === 0x7A) return '7z';
  return 'other';
}
let LA;
async function archiveLib() {
  if (!LA) {
    const m = await import('../vendor/libarchive.js');
    LA = m.Archive;
    LA.init({ workerUrl: V('worker-bundle.js') });
  }
  return LA;
}

export function parseComicInfo(xml) {
  if (!xml) return {};
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  if (d.querySelector('parsererror')) return {};
  const g = t => (d.getElementsByTagName(t)[0]?.textContent || '').trim();
  const out = {
    title: g('Title'), series: g('Series'), number: g('Number'), volume: g('Volume'), summary: g('Summary'),
    year: parseInt(g('Year')) || 0, publisher: g('Publisher'), genre: g('Genre'),
    writer: g('Writer'), penciller: g('Penciller'), inker: g('Inker'), colorist: g('Colorist'),
    letterer: g('Letterer'), cover: g('CoverArtist'), tags: g('Tags') ? g('Tags').split(/\s*,\s*/) : [],
    manga: /RightToLeft/i.test(g('Manga'))
  };
  Object.keys(out).forEach(k => { if (!out[k] || (Array.isArray(out[k]) && !out[k].length)) delete out[k]; });
  return out;
}

/** Open any comic archive (cbz/cbr/cb7/cbt/zip/rar/7z/tar). Format is detected from magic bytes. */
export async function openComic(file) {
  const type = await sniff(file);
  let entries = [], infoXml = null;
  if (type === 'zip') {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(file);
    const all = Object.values(zip.files).filter(f => !f.dir);
    const ci = all.find(f => /(^|\/)comicinfo\.xml$/i.test(f.name));
    if (ci) infoXml = await ci.async('string');
    entries = all.filter(f => isImg(f.name)).map(f => ({ name: f.name, get: async () => new Blob([await f.async('uint8array')], { type: mime(f.name) }) }));
  } else {
    const A = await archiveLib();
    const arc = await A.open(file);
    const list = await arc.getFilesArray();
    const all = list.map(x => ({ name: x.path + x.file.name, f: x.file }));
    const ci = all.find(x => /(^|\/)comicinfo\.xml$/i.test(x.name));
    if (ci) { try { infoXml = await (await ci.f.extract()).text(); } catch {} }
    entries = all.filter(x => isImg(x.name)).map(x => ({
      name: x.name,
      get: async () => { const f = await x.f.extract(); return new Blob([f], { type: mime(x.name) }); }
    }));
  }
  entries.sort((a, b) => natCmp(a.name.toLowerCase(), b.name.toLowerCase()));
  if (!entries.length) throw new Error('No images found in this archive');
  return {
    kind: 'archive', count: entries.length, info: parseComicInfo(infoXml),
    names: entries.map(e => e.name),
    getBlob: i => entries[i].get(),
    ext: i => extOf(entries[i].name)
  };
}

/* --------------------------------------------------------------------- pdf */
let pdfjs;
export async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = V('pdf.worker.min.mjs');
  }
  return pdfjs;
}
export async function openPdf(file) {
  const lib = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data }).promise;
  let meta = {};
  try { const m = await doc.getMetadata(); meta = { title: m.info?.Title || '', writer: m.info?.Author || '' }; } catch {}
  const src = {
    kind: 'pdf', count: doc.numPages, info: meta, doc,
    async getBlob(i, targetWidth = 1400) {
      const page = await doc.getPage(i + 1);
      const v0 = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(.5, targetWidth / v0.width));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      return new Promise(r => c.toBlob(r, 'image/jpeg', .9));
    },
    async outline() {
      try {
        const o = await doc.getOutline();
        if (!o) return [];
        const out = [];
        const walk = async (items, depth) => {
          for (const it of items) {
            let pg = null;
            try {
              const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
              if (dest) pg = await doc.getPageIndex(dest[0]);
            } catch {}
            if (pg != null) out.push({ title: it.title, page: pg, depth });
            if (it.items?.length) await walk(it.items, depth + 1);
          }
        };
        await walk(o, 0);
        return out;
      } catch { return []; }
    }
  };
  return src;
}

/* -------------------------------------------------------------------- epub */
const parseXml = (s, type = 'application/xml') => new DOMParser().parseFromString(s, type);
function resolvePath(base, href) {
  const u = new URL(href, 'http://x/' + base);
  return decodeURIComponent(u.pathname.slice(1)) + (u.hash || '');
}
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';

export async function openEpub(file) {
  const JSZip = await ensureJSZip();
  const zip = await JSZip.loadAsync(file);
  const cont = parseXml(await zip.file('META-INF/container.xml').async('string'));
  const opfPath = cont.querySelector('rootfile').getAttribute('full-path');
  const opf = parseXml(await zip.file(opfPath).async('string'));
  const base = dirOf(opfPath);
  const man = {};
  opf.querySelectorAll('manifest > item').forEach(it => {
    man[it.getAttribute('id')] = { href: resolvePath(base, it.getAttribute('href')), type: it.getAttribute('media-type'), props: it.getAttribute('properties') || '' };
  });
  const spine = [...opf.querySelectorAll('spine > itemref')].map(r => man[r.getAttribute('idref')]).filter(Boolean)
    .filter(m => /html|xml/.test(m.type));
  const md = t => (opf.getElementsByTagName('dc:' + t)[0]?.textContent || opf.getElementsByTagNameNS('*', t)[0]?.textContent || '').trim();
  const info = { title: md('title'), writer: md('creator'), summary: md('description').replace(/<[^>]+>/g, ''), publisher: md('publisher') };
  const yr = parseInt(md('date')); if (yr) info.year = yr;

  // table of contents
  let toc = [];
  const navItem = Object.values(man).find(m => /\bnav\b/.test(m.props));
  const ncxItem = Object.values(man).find(m => m.type === 'application/x-dtbncx+xml');
  try {
    if (navItem) {
      const nd = parseXml(await zip.file(navItem.href).async('string'), 'text/html');
      const nav = nd.querySelector('nav[epub\\:type="toc"], nav#toc, nav') ;
      nav?.querySelectorAll('a').forEach(a => {
        const h = a.getAttribute('href'); if (!h) return;
        toc.push({ title: a.textContent.trim().replace(/\s+/g, ' '), href: resolvePath(dirOf(navItem.href), h), depth: Math.max(0, a.parentElement.closest('ol,ul') ? [...(function* (e) { while ((e = e.parentElement?.closest('ol,ul'))) yield e; })(a)].length - 1 : 0) });
      });
    } else if (ncxItem) {
      const nd = parseXml(await zip.file(ncxItem.href).async('string'));
      nd.querySelectorAll('navPoint').forEach(np => {
        const c = np.querySelector('content'); const t = np.querySelector('navLabel > text');
        if (!c || !t) return;
        let depth = 0, p = np.parentElement; while (p && p.tagName === 'navPoint') { depth++; p = p.parentElement; }
        toc.push({ title: t.textContent.trim(), href: resolvePath(dirOf(ncxItem.href), c.getAttribute('src')), depth });
      });
    }
  } catch {}
  const idxOf = path => spine.findIndex(s => s.href === path.split('#')[0]);
  toc = toc.map(t => ({ ...t, chapter: idxOf(t.href), frag: t.href.split('#')[1] || '' })).filter(t => t.chapter >= 0);

  // cover
  async function coverBlob() {
    let item = null;
    const metaCover = opf.querySelector('meta[name="cover"]');
    if (metaCover) item = man[metaCover.getAttribute('content')];
    item ||= Object.values(man).find(m => /cover-image/.test(m.props));
    item ||= Object.values(man).find(m => /^image\//.test(m.type) && /cover/i.test(m.href));
    if (!item) return null;
    const u8 = await zip.file(item.href).async('uint8array');
    return new Blob([u8], { type: item.type });
  }

  const urlCache = new Map();
  async function blobUrl(path) {
    if (urlCache.has(path)) return urlCache.get(path);
    const f = zip.file(path);
    if (!f) return null;
    const ext = extOf(path);
    const type = IMG[ext] || (ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream');
    const url = URL.createObjectURL(new Blob([await f.async('uint8array')], { type }));
    urlCache.set(path, url);
    return url;
  }

  async function chapterHtml(i) {
    const item = spine[i];
    const raw = await zip.file(item.href).async('string');
    let d = parseXml(raw, 'application/xhtml+xml');
    if (d.querySelector('parsererror')) d = parseXml(raw, 'text/html');
    d.querySelectorAll('script,style,link,iframe,object,embed,meta').forEach(n => n.remove());
    const dir = dirOf(item.href);
    for (const img of d.querySelectorAll('img')) {
      const s = img.getAttribute('src'); if (!s) continue;
      const u = await blobUrl(resolvePath(dir, s)); if (u) img.setAttribute('src', u);
      img.removeAttribute('srcset');
    }
    for (const im of d.querySelectorAll('image')) {
      const a = im.getAttribute('xlink:href') || im.getAttribute('href'); if (!a) continue;
      const u = await blobUrl(resolvePath(dir, a)); if (u) { im.setAttribute('href', u); im.setAttribute('xlink:href', u); }
    }
    d.querySelectorAll('[style]').forEach(n => n.removeAttribute('style'));
    d.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if (/^(https?:|mailto:)/i.test(h)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      else if (!h.startsWith('#')) a.setAttribute('data-epub', resolvePath(dir, h));
    });
    const body = d.body || d.getElementsByTagName('body')[0];
    return body ? body.innerHTML : '';
  }
  return { kind: 'epub', zip, spine, toc, info, count: spine.length, chapterHtml, coverBlob, idxOf };
}

/* -------------------------------------------------------------------- docx */
export async function openDocx(file) {
  await loadScript(V('mammoth.browser.min.js'));
  const buf = await file.arrayBuffer();
  const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
  let info = {};
  try {
    const JSZip = await ensureJSZip();
    const z = await JSZip.loadAsync(buf);
    const core = z.file('docProps/core.xml');
    if (core) {
      const d = parseXml(await core.async('string'));
      const g = t => d.getElementsByTagName(t)[0]?.textContent?.trim() || '';
      info = { title: g('dc:title'), writer: g('dc:creator'), summary: g('dc:description') };
    }
  } catch {}
  const html = res.value;
  // split into chapters at h1 if the doc has several, so navigation is useful
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  const chapters = [], toc = [];
  let curCh = null;
  [...tmp.childNodes].forEach(n => {
    if (n.nodeName === 'H1' && (curCh?.nodes.length || !curCh)) {
      curCh = { title: n.textContent.trim() || 'Chapter ' + (chapters.length + 1), nodes: [] };
      chapters.push(curCh);
    } else if (!curCh) { curCh = { title: 'Start', nodes: [] }; chapters.push(curCh); }
    curCh.nodes.push(n);
  });
  const out = chapters.length ? chapters : [{ title: 'Document', nodes: [] }];
  const htmls = out.map(c => c.nodes.map(n => n.outerHTML ?? (n.textContent ? `<p>${n.textContent}</p>` : '')).join(''));
  out.forEach((c, i) => toc.push({ title: c.title, chapter: i, frag: '', depth: 0 }));
  return { kind: 'html', info, count: out.length, toc: out.length > 1 ? toc : [], chapterHtml: async i => htmls[i], words: tmp.textContent.split(/\s+/).length };
}

/* ------------------------------------------------------------- text / md  */
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}
const escHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function openText(file, md = false) {
  const text = await readText(file);
  let html, toc = [];
  if (md) {
    await loadScript(V('marked.min.js'));
    html = window.marked.parse(text, { gfm: true, breaks: false });
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    // split by h1/h2 into chapters for navigation when long enough
    const heads = [...tmp.querySelectorAll('h1,h2')];
    if (heads.length > 1) {
      const rebuilt = []; let cur = null;
      [...tmp.childNodes].forEach(n => {
        if (/^H[12]$/.test(n.nodeName)) { cur = { title: n.textContent.trim(), html: n.outerHTML }; rebuilt.push(cur); }
        else { if (!cur) { cur = { title: 'Start', html: '' }; rebuilt.push(cur); } cur.html += n.outerHTML ?? escHtml(n.textContent || ''); }
      });
      return { kind: 'html', info: { title: tmp.querySelector('h1')?.textContent?.trim() || '' }, count: rebuilt.length, toc: rebuilt.map((c, i) => ({ title: c.title, chapter: i, frag: '', depth: 0 })), chapterHtml: async i => rebuilt[i].html, words: text.split(/\s+/).length };
    }
  } else {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const nonEmpty = lines.filter(l => l.trim());
    const avg = nonEmpty.reduce((a, l) => a + l.length, 0) / (nonEmpty.length || 1);
    const hardWrapped = avg > 45 && avg < 90;
    html = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => {
      p = escHtml(p.trim()); if (!p) return '';
      return '<p>' + (hardWrapped ? p.replace(/\n/g, ' ') : p.replace(/\n/g, '<br>')) + '</p>';
    }).join('\n');
  }
  return { kind: 'html', info: {}, count: 1, toc, chapterHtml: async () => html, words: text.split(/\s+/).length };
}

/* ---------------------------------------------------------- unified open */
export async function openBook(book, file) {
  switch (book.kind) {
    case 'comic': return openComic(file);
    case 'pdf': return openPdf(file);
    case 'epub': return openEpub(file);
    case 'docx': return openDocx(file);
    case 'md': return openText(file, true);
    default: return openText(file, false);
  }
}
