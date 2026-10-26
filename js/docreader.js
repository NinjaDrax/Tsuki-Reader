// Reflowable reader: EPUB, DOCX, TXT, Markdown.
import { icon } from './icons.js';
import { esc, toast, modal, confirmDlg, wakeLock, debounce } from './util.js';
import { settings } from './state.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DOC_THEMES = {
  white: { bg: '#ffffff', fg: '#1b1b1b', link: '#1a5fb4' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f20', link: '#8a4b0f' },
  gray: { bg: '#d9d9d9', fg: '#1d1d1d', link: '#124a8f' },
  dark: { bg: '#15161a', fg: '#d4d4d8', link: '#8ab4f8' },
  black: { bg: '#000000', fg: '#b9b9b9', link: '#7ca7e8' }
};
const FONTS = { serif: 'Georgia,"Iowan Old Style","Times New Roman",serif', sans: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace' };

export function startDocReader(ctx) {
  const { book, src } = ctx;
  const n = src.count;
  let ch = clamp(book.docPos?.ch || 0, 0, n - 1);
  let pending = book.docPos?.frac || 0;
  let frac = pending, destroyed = false, loading = false;
  const undoSt = [], redoSt = [];
  let bms = [...(book.docBookmarks || [])];
  let releaseLock = settings.keepAwake ? wakeLock() : null;

  const el = document.createElement('div');
  el.className = 'reader';
  el.innerHTML = `
    <iframe class="d-frame" title="Document" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
    <div class="r-load hidden"><div class="spin"></div></div>
    <div class="nightfilter" style="position:absolute;inset:0;z-index:4;pointer-events:none"></div>
    <div class="r-top">
      <button class="ib" data-a="exit" aria-label="Back">${icon('back')}</button>
      <div class="tt"><b>${esc(book.title)}</b><small></small></div>
      <button class="ib" data-a="info" aria-label="Info">${icon('info')}</button>
      <button class="ib" data-a="bm" aria-label="Bookmark">${icon('bm_o')}</button>
    </div>
    <div class="r-page-indicator"></div>
    <div class="r-sheet">
      <div class="tools">
        <button class="ib" data-a="toc" aria-label="Contents">${icon('toc')}</button>
        <button class="ib" data-a="search" aria-label="Search">${icon('search')}</button>
        <button class="ib" data-a="text" aria-label="Text settings">${icon('textsize')}</button>
        <button class="ib" data-a="theme" aria-label="Reading theme">${icon('palette')}</button>
        <button class="ib" data-a="cfg" aria-label="Settings">${icon('settings')}</button>
      </div>
      <div class="sl"><input type="range" min="0" max="1000" step="1" value="0" aria-label="Progress"></div>
      <div class="nav">
        <button class="ib" data-a="prevch" aria-label="Previous chapter">${icon('first')}</button>
        <button class="ib" data-a="undo" aria-label="Undo jump">${icon('undo')}</button>
        <div class="pgpill"></div>
        <button class="ib" data-a="redo" aria-label="Redo jump">${icon('redo')}</button>
        <button class="ib" data-a="nextch" aria-label="Next chapter">${icon('last')}</button>
      </div>
      <div class="handle"></div>
    </div>`;
  document.body.appendChild(el);
  const $r = s => el.querySelector(s);
  const frame = $r('iframe'), slider = $r('input[type=range]'), pill = $r('.pgpill'), loadEl = $r('.r-load'), indicator = $r('.r-page-indicator');

  /* ----------------------------------------------------------- theme/css */
  const themeKey = () => {
    if (settings.docTheme !== 'auto') return settings.docTheme;
    return ['dark', 'amoled', 'sunset'].includes(document.documentElement.dataset.theme) ? 'dark' : (document.documentElement.dataset.theme === 'sepia' ? 'sepia' : 'white');
  };
  const css = () => {
    const t = DOC_THEMES[themeKey()], w = settings.docWidth;
    return `html{background:${t.bg};color:${t.fg};-webkit-text-size-adjust:100%}
body{margin:0 auto;padding:84px 22px 170px;${w ? `max-width:${w}px;` : ''}font-family:${FONTS[settings.docFont] || FONTS.serif};font-size:${settings.docSize}px;line-height:${settings.docLine};text-align:${settings.docAlign};overflow-wrap:break-word;hyphens:auto}
p{margin:0 0 .9em;${settings.docAlign === 'justify' ? '' : ''}}
h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .6em;text-align:left}h1{font-size:1.7em}h2{font-size:1.4em}h3{font-size:1.2em}
a{color:${t.link}}
img,svg,video{max-width:100%;height:auto;display:block;margin:1em auto}
blockquote{border-left:3px solid ${t.fg}55;margin:1em 0;padding:.1em 0 .1em 1em;opacity:.9}
pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88em}
pre{white-space:pre-wrap;background:${t.fg}14;padding:.8em 1em;border-radius:8px;overflow:auto}
code{background:${t.fg}14;padding:.1em .3em;border-radius:4px}pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}td,th{border:1px solid ${t.fg}44;padding:.35em .65em}
hr{border:0;border-top:1px solid ${t.fg}44;margin:2em 0}
ul,ol{padding-left:1.4em}li{margin:.2em 0}
.endnav{text-align:center;margin:3em 0 1em}.endnav button{font:inherit;font-size:.9em;padding:.75em 1.6em;border:0;border-radius:2em;background:${t.link};color:${t.bg};cursor:pointer}
.endnav .end{opacity:.6}
::selection{background:${t.link}55}`;
  };
  function applyLook() {
    const t = DOC_THEMES[themeKey()];
    el.style.setProperty('--rbg', t.bg);
    const st = frame.contentDocument?.getElementById('u');
    if (st) st.textContent = css();
    $r('.nightfilter').style.background = `rgba(0,0,0,${settings.night / 100})`;
  }

  /* ------------------------------------------------------------ chapters */
  const chTitle = () => {
    const toc = src.toc || [];
    let best = null;
    for (const t of toc) if (t.chapter <= ch) best = t;
    return best?.title || (n > 1 ? `Chapter ${ch + 1}` : book.filename);
  };
  const overall = () => n === 1 ? frac : (ch + frac) / n;
  function updateUI() {
    const o = overall();
    slider.value = Math.round(o * 1000);
    pill.textContent = Math.round(o * 100) + '%';
    indicator.textContent = `${Math.round(o * 100)}% · ${n > 1 ? `${ch + 1}/${n}` : ''}`.replace(/ · $/, '');
    $r('.tt small').textContent = chTitle();
    $r('[data-a=undo]').disabled = !undoSt.length;
    $r('[data-a=redo]').disabled = !redoSt.length;
    $r('[data-a=prevch]').disabled = ch <= 0 && frac < .02;
    $r('[data-a=nextch]').disabled = ch >= n - 1;
    const near = bms.some(b => b.ch === ch && Math.abs(b.frac - frac) < .02);
    $r('[data-a=bm]').innerHTML = icon(near ? 'bm' : 'bm_o');
    $r('[data-a=prevch]').style.display = $r('[data-a=nextch]').style.display = n > 1 ? '' : 'none';
  }
  const persist = debounce(() => {
    const o = overall();
    const done = ch >= n - 1 && frac > .97;
    ctx.save({ docPos: { ch, frac }, progress: done ? 1 : o, lastRead: Date.now(), status: done ? 'read' : (o > 0.003 || ch > 0 ? 'reading' : book.status), docBookmarks: bms });
  }, 500);

  async function openChapter(i, where = 0) {
    if (destroyed) return;
    ch = clamp(i, 0, n - 1);
    pending = where;
    loading = true;
    loadEl.classList.remove('hidden');
    let html = '';
    try { html = await src.chapterHtml(ch); } catch (e) { console.error(e); html = '<p>Could not load this chapter.</p>'; }
    if (destroyed) return;
    const nextBtn = ch < n - 1 ? `<button id="nx">Next chapter ›</button>` : `<p class="end">— End —</p>`;
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="u">${css()}</style></head><body><div id="c">${html}</div><div class="endnav">${nextBtn}</div></body></html>`;
  }
  frame.addEventListener('load', async () => {
    if (destroyed) return;
    const d = frame.contentDocument, w = frame.contentWindow;
    if (!d || !d.body) return;
    // wait for images so scroll restore is accurate
    await Promise.race([Promise.all([...d.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))), new Promise(r => setTimeout(r, 1500))]);
    const max = () => Math.max(0, d.documentElement.scrollHeight - w.innerHeight);
    if (pending === 'end') w.scrollTo(0, max());
    else if (pending && typeof pending === 'object' && pending.frag) { (d.getElementById(pending.frag) || d.querySelector(`[name="${CSS.escape(pending.frag)}"]`))?.scrollIntoView(); }
    else w.scrollTo(0, (pending || 0) * max());
    frac = max() > 0 ? w.scrollY / max() : 0;
    loading = false; loadEl.classList.add('hidden');
    bindDoc(d, w);
    updateUI();
  });
  function bindDoc(d, w) {
    let down = null;
    w.addEventListener('scroll', () => {
      if (loading) return;
      const max = Math.max(1, d.documentElement.scrollHeight - w.innerHeight);
      frac = clamp(w.scrollY / max, 0, 1);
      updateUI(); persist();
    }, { passive: true });
    d.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    d.addEventListener('click', e => {
      const a = e.target.closest?.('a[href], a[data-epub]');
      if (e.target.id === 'nx') { e.preventDefault(); jump(ch + 1, 0); return; }
      if (a) {
        e.preventDefault();
        const ep = a.getAttribute('data-epub'), h = a.getAttribute('href') || '';
        if (ep && src.idxOf) { const i = src.idxOf(ep); if (i >= 0) jump(i, { frag: ep.split('#')[1] || '' }); }
        else if (h.startsWith('#')) { (d.getElementById(h.slice(1)) || d.querySelector(`[name="${CSS.escape(h.slice(1))}"]`))?.scrollIntoView({ behavior: 'smooth' }); }
        else if (/^(https?:|mailto:)/i.test(h)) window.open(h, '_blank', 'noopener');
        return;
      }
      if (w.getSelection()?.toString()) return;
      if (down && (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10)) return;
      const f = e.clientX / w.innerWidth;
      if (settings.tapNav && (f < .22 || f > .78)) { toggleUI(true); step(f < .22 ? (settings.tapInvert ? 1 : -1) : (settings.tapInvert ? -1 : 1)); }
      else toggleUI();
    });
    d.addEventListener('keydown', onKey);
  }
  function toggleUI(force) { el.classList.toggle('hideui', force ?? !el.classList.contains('hideui')); }
  function step(dir) {
    const d = frame.contentDocument, w = frame.contentWindow; if (!d) return;
    const max = Math.max(0, d.documentElement.scrollHeight - w.innerHeight), h = w.innerHeight * .88;
    if (dir > 0) { if (w.scrollY >= max - 6) { if (ch < n - 1) jump(ch + 1, 0, true); else toast('End of book'); } else w.scrollBy({ top: h, behavior: 'smooth' }); }
    else { if (w.scrollY <= 6) { if (ch > 0) jump(ch - 1, 'end', true); else toast('Start of book'); } else w.scrollBy({ top: -h, behavior: 'smooth' }); }
  }
  async function jump(i, where = 0, noUndo = false) {
    if (!noUndo) { undoSt.push({ ch, frac }); redoSt.length = 0; }
    if (i === ch && typeof where === 'number') {
      const d = frame.contentDocument, w = frame.contentWindow;
      const max = Math.max(0, d.documentElement.scrollHeight - w.innerHeight);
      w.scrollTo({ top: where * max }); return;
    }
    await openChapter(i, where);
  }

  /* ------------------------------------------------------------- dialogs */
  function tocDlg() {
    const toc = src.toc?.length ? src.toc : (n > 1 ? Array.from({ length: n }, (_, i) => ({ title: `Chapter ${i + 1}`, chapter: i, frag: '', depth: 0 })) : []);
    const { el: d, close } = modal(`<h2>Contents</h2>
      ${bms.length ? `<small style="color:var(--on2)">Bookmarks</small>${bms.map((b, i) => `<div class="opt" data-bm="${i}">${icon('bm', 20)}<div class="l">${esc(b.label)}<small>${Math.round(((b.ch + b.frac) / n) * 100)}%</small></div><button class="ib" data-del="${i}" style="width:36px;height:36px">${icon('close', 18)}</button></div>`).join('')}<hr style="border:0;border-top:1px solid var(--outline);margin:10px 0">` : ''}
      <div class="toc">${toc.length ? toc.map((t, i) => `<div class="opt ${t.chapter === ch ? 'sel' : ''}" data-t="${i}" style="padding-left:${6 + t.depth * 18}px"><div class="l">${esc(t.title)}</div></div>`).join('') : '<p style="color:var(--on2)">This document has no table of contents.</p>'}</div>`);
    d.addEventListener('click', e => {
      const del = e.target.closest('[data-del]'); if (del) { bms.splice(+del.dataset.del, 1); persist(); updateUI(); close(); tocDlg(); return; }
      const b = e.target.closest('[data-bm]'); if (b) { const m = bms[+b.dataset.bm]; close(); toggleUI(true); jump(m.ch, m.frac); return; }
      const t = e.target.closest('[data-t]'); if (t) { const x = toc[+t.dataset.t]; close(); toggleUI(true); jump(x.chapter, x.frag ? { frag: x.frag } : 0); }
    });
    d.querySelector('.sel')?.scrollIntoView({ block: 'center' });
  }
  function textDlg() {
    const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(settings[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const { el: d } = modal(`<h2>Text &amp; layout</h2>
      <small style="color:var(--on2)">Font size: <span data-o="docSize">${settings.docSize}</span> px</small><input type="range" min="12" max="40" value="${settings.docSize}" data-r="docSize">
      <small style="color:var(--on2)">Line spacing: <span data-o="docLine">${settings.docLine}</span></small><input type="range" min="1.2" max="2.4" step=".05" value="${settings.docLine}" data-r="docLine">
      <small style="color:var(--on2)">Font</small>${seg('docFont', [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']])}
      <small style="color:var(--on2)">Text width</small>${seg('docWidth', [[560, 'Narrow'], [720, 'Medium'], [900, 'Wide'], [0, 'Full']])}
      <small style="color:var(--on2)">Alignment</small>${seg('docAlign', [['left', 'Left'], ['justify', 'Justified']])}`);
    d.addEventListener('input', e => { const r = e.target.closest('[data-r]'); if (!r) return; const k = r.dataset.r; settings[k] = parseFloat(r.value); d.querySelector(`[data-o=${k}]`).textContent = r.value; keepPos(applyLook); });
    d.addEventListener('click', e => { const b = e.target.closest('.seg button'); if (!b) return; const k = b.parentElement.dataset.k; const v = b.dataset.v; settings[k] = +v === +v ? +v : v; b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); keepPos(applyLook); });
  }
  function keepPos(fn) {
    const d = frame.contentDocument, w = frame.contentWindow, f = frac;
    fn();
    requestAnimationFrame(() => { if (!d?.documentElement) return; const max = Math.max(0, d.documentElement.scrollHeight - w.innerHeight); w.scrollTo(0, f * max); });
  }
  function themeDlg() {
    const items = [['auto', 'Match app'], ['white', 'White'], ['sepia', 'Sepia'], ['gray', 'Gray'], ['dark', 'Dark'], ['black', 'Black']];
    const { el: d, close } = modal(`<h2>Reading theme</h2>${items.map(([v, l]) => `<div class="opt ${settings.docTheme === v ? 'sel' : ''}" data-v="${v}"><div class="l">${l}</div></div>`).join('')}`);
    d.addEventListener('click', e => { const o = e.target.closest('[data-v]'); if (!o) return; settings.docTheme = o.dataset.v; applyLook(); close(); });
  }
  function cfgDlg() {
    const sw = (k, l, sub = '') => `<div class="opt" data-sw="${k}"><div class="l">${l}${sub ? `<small>${sub}</small>` : ''}</div><span class="sw ${settings[k] ? 'on' : ''}"></span></div>`;
    const { el: d } = modal(`<h2>Reader settings</h2>${sw('tapNav', 'Tap zones', 'Tap screen edges to scroll by a page')}${sw('tapInvert', 'Invert tap zones')}${sw('keepAwake', 'Keep screen on')}
      <div style="padding:8px 4px 0"><small style="color:var(--on2)">Night dimming</small><input type="range" min="0" max="60" value="${settings.night}" data-night></div>
      <div class="opt" data-fs>${icon('fullscreen')}<div class="l">Fullscreen</div></div>`);
    d.addEventListener('click', e => {
      const s = e.target.closest('[data-sw]'); if (s) { const k = s.dataset.sw; settings[k] = !settings[k]; s.querySelector('.sw').classList.toggle('on', settings[k]); if (k === 'keepAwake') { releaseLock?.(); releaseLock = settings.keepAwake ? wakeLock() : null; } }
      if (e.target.closest('[data-fs]')) { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); }
    });
    d.querySelector('[data-night]').oninput = e => { settings.night = +e.target.value; applyLook(); };
  }
  let textIndex = null;
  async function searchDlg() {
    const { el: d } = modal(`<h2>Search in book</h2><label class="field"><span>Search text</span><input type="search" autofocus></label><div class="toc" id="res"></div>`);
    const inp = d.querySelector('input'), res = d.querySelector('#res');
    setTimeout(() => inp.focus(), 60);
    if (!textIndex) {
      res.innerHTML = '<p style="color:var(--on2)">Indexing…</p>';
      textIndex = [];
      for (let i = 0; i < n; i++) { try { const h = await src.chapterHtml(i); const t = document.createElement('div'); t.innerHTML = h; textIndex.push((t.textContent || '').replace(/\s+/g, ' ')); } catch { textIndex.push(''); } }
      res.innerHTML = '';
    }
    let timer;
    const run = () => {
      const q = inp.value.trim().toLowerCase(); if (q.length < 2) { res.innerHTML = ''; return; }
      const out = [];
      for (let i = 0; i < n && out.length < 60; i++) {
        const t = textIndex[i], lt = t.toLowerCase(); let p = 0, c = 0;
        while ((p = lt.indexOf(q, p)) >= 0 && c < 4 && out.length < 60) { out.push({ i, snip: t.slice(Math.max(0, p - 40), p + q.length + 60), pos: p / Math.max(1, t.length), q: inp.value.trim() }); p += q.length; c++; }
      }
      res.innerHTML = out.length ? out.map((r, k) => `<div class="opt" data-k="${k}"><div class="l"><small>Chapter ${r.i + 1}</small>…${esc(r.snip)}…</div></div>`).join('') : '<p style="color:var(--on2)">No matches</p>';
      res._out = out;
    };
    inp.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
    res.addEventListener('click', async e => {
      const o = e.target.closest('[data-k]'); if (!o) return; const r = res._out[+o.dataset.k];
      d.closest('.modal').remove(); toggleUI(true);
      await jump(r.i, r.pos);
      const w = frame.contentWindow; const wait = () => (loading ? setTimeout(wait, 100) : setTimeout(() => { try { w.find?.(r.q, false, false, true); } catch {} }, 120)); wait();
    });
  }
  function info() {
    const rows = [['Title', book.title], ['File', book.filename], ['Format', book.ext.toUpperCase()], ['Chapters', n], book.writer && ['Author', book.writer], book.publisher && ['Publisher', book.publisher], book.year && ['Year', book.year]].filter(Boolean);
    modal(`<h2>Information</h2>${rows.map(([k, v]) => `<div class="opt"><div class="l"><small>${esc(k)}</small>${esc(v)}</div></div>`).join('')}${book.summary ? `<p style="color:var(--on2)">${esc(book.summary)}</p>` : ''}`);
  }

  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
    switch (a.dataset.a) {
      case 'exit': await ctx.flush(); ctx.exit(); break;
      case 'info': info(); break;
      case 'bm': {
        const k = bms.findIndex(b => b.ch === ch && Math.abs(b.frac - frac) < .02);
        if (k >= 0) { bms.splice(k, 1); toast('Bookmark removed', 1200); }
        else { bms.push({ ch, frac, label: chTitle() }); toast('Bookmark added', 1200); }
        persist(); updateUI(); break;
      }
      case 'toc': tocDlg(); break;
      case 'search': searchDlg(); break;
      case 'text': textDlg(); break;
      case 'theme': themeDlg(); break;
      case 'cfg': cfgDlg(); break;
      case 'prevch': { const d = frame.contentDocument, w = frame.contentWindow; if (frac > .03 && d) jump(ch, 0); else if (ch > 0) jump(ch - 1, 0); break; }
      case 'nextch': if (ch < n - 1) jump(ch + 1, 0); break;
      case 'undo': if (undoSt.length) { const p = undoSt.pop(); redoSt.push({ ch, frac }); await jump(p.ch, p.frac, true); } break;
      case 'redo': if (redoSt.length) { const p = redoSt.pop(); undoSt.push({ ch, frac }); await jump(p.ch, p.frac, true); } break;
    }
  });
  slider.addEventListener('input', () => { pill.textContent = Math.round(slider.value / 10) + '%'; });
  slider.addEventListener('change', () => {
    const o = +slider.value / 1000;
    if (n === 1) return jump(0, o);
    const t = o * n, i = Math.min(n - 1, Math.floor(t));
    jump(i, t - i);
  });

  const onKey = e => {
    if (e.target?.matches?.('input,textarea,select') || document.querySelector('.modal')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' && !e.shiftKey) { e.preventDefault(); step(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); step(-1); }
    else if (k === 'ArrowDown') { frame.contentWindow.scrollBy({ top: 80 }); e.preventDefault(); }
    else if (k === 'ArrowUp') { frame.contentWindow.scrollBy({ top: -80 }); e.preventDefault(); }
    else if (k === 'Home') jump(0, 0);
    else if (k === 'End') jump(n - 1, 1);
    else if (k === 'm' || k === 'M') toggleUI();
    else if (k === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else { ctx.flush(); ctx.exit(); } }
  };
  addEventListener('keydown', onKey);
  const onHide = () => { if (document.visibilityState === 'hidden') ctx.flush(); };
  document.addEventListener('visibilitychange', onHide);
  addEventListener('pagehide', onHide);

  applyLook();
  updateUI();
  openChapter(ch, pending);

  return function destroy() {
    destroyed = true;
    removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', onHide);
    releaseLock?.();
    ctx.flush();
    el.remove();
  };
}
