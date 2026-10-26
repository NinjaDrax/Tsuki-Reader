// Page-based reader: comics (CBZ/CBR/CB7/CBT) and PDF pages.
import { icon } from './icons.js';
import { esc, toast, modal, choose, confirmDlg, download, wakeLock, makeThumb, fmtSize } from './util.js';
import { settings } from './state.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function startReader(ctx) {
  const { book, src } = ctx;
  const count = src.count;
  const isPdf = src.kind === 'pdf';
  let mode = book.readMode || (settings.readMode !== 'auto' ? settings.readMode : (book.manga ? 'rtl' : isPdf ? 'webtoon' : 'ltr'));
  let scale = book.scale || settings.scale;
  let dbl = book.dbl ?? settings.double;
  let idx = book.status === 'read' ? 0 : clamp(book.lastPage || 0, 0, count - 1);
  let spreadLen = 1, tok = 0, z = 1, tx = 0, ty = 0, destroyed = false, initial = true;
  const undoSt = [], redoSt = [];
  const bookmarks = new Set(book.bookmarks || []);
  const cache = new Map();
  let stage = null, inner = null, web = null, io = null;
  let wps = [];
  const loaded = new Set();
  let releaseLock = settings.keepAwake ? wakeLock() : null;

  const el = document.createElement('div');
  el.className = 'reader';
  el.innerHTML = `
    <div class="r-top">
      <button class="ib" data-a="exit" aria-label="Back">${icon('back')}</button>
      <div class="tt"><b>${esc(book.title)}</b><small>${esc(book.filename)}</small></div>
      <button class="ib" data-a="info" aria-label="Info">${icon('info')}</button>
      <button class="ib" data-a="bm" aria-label="Bookmark">${icon('bm_o')}</button>
    </div>
    <div class="r-load hidden"><div class="spin"></div></div>
    <div class="nightfilter"></div>
    <div class="r-page-indicator"></div>
    <div class="r-sheet">
      <div class="tools">
        <button class="ib" data-a="scale" aria-label="Page scale">${icon('fit')}</button>
        <button class="ib" data-a="dir" aria-label="Reading direction">${icon('swap')}</button>
        <button class="ib" data-a="dbl" aria-label="Double page">${icon('book')}</button>
        <button class="ib" data-a="pages" aria-label="All pages">${icon('list')}</button>
        <button class="ib" data-a="cfg" aria-label="Reader settings">${icon('settings')}</button>
        <button class="ib" data-a="save" aria-label="Save image">${icon('image')}</button>
      </div>
      <div class="sl"><input type="range" min="0" max="${Math.max(0, count - 1)}" step="1" value="${idx}" aria-label="Page"></div>
      <div class="nav">
        <button class="ib" data-a="prevbook" aria-label="Previous book">${icon('first')}</button>
        <button class="ib" data-a="undo" aria-label="Undo jump">${icon('undo')}</button>
        <div class="pgpill" data-a="goto" role="button" tabindex="0"></div>
        <button class="ib" data-a="redo" aria-label="Redo jump">${icon('redo')}</button>
        <button class="ib" data-a="nextbook" aria-label="Next book">${icon('last')}</button>
      </div>
      <div class="handle"></div>
    </div>`;
  document.body.appendChild(el);
  const $r = s => el.querySelector(s);
  const slider = $r('input[type=range]');
  const pill = $r('.pgpill');
  const indicator = $r('.r-page-indicator');
  const loadEl = $r('.r-load');
  const nbr = ctx.neighbors();

  /* ---------------------------------------------------------- loading */
  const renderW = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2.5);
    if (mode === 'webtoon') return clamp(Math.min(innerWidth, scale === 'fit' ? 900 : innerWidth) * dpr, 800, 2000);
    return clamp(Math.max(innerWidth, innerHeight * .75) * dpr * (isPdf ? 1.4 : 1), 900, 2800);
  };
  function load(i) {
    if (i < 0 || i >= count) return Promise.resolve(null);
    let p = cache.get(i);
    if (!p) {
      p = (async () => {
        const blob = await src.getBlob(i, renderW());
        const url = URL.createObjectURL(blob);
        const im = new Image(); im.src = url;
        try { await im.decode(); } catch {}
        return { url, w: im.naturalWidth, h: im.naturalHeight };
      })();
      p.catch(() => cache.delete(i));
      cache.set(i, p);
    }
    return p;
  }
  function drop(i) { const p = cache.get(i); if (p) { cache.delete(i); p.then(r => r && URL.revokeObjectURL(r.url)).catch(() => {}); } }
  const trimPaged = () => { for (const k of [...cache.keys()]) if (Math.abs(k - idx) > 6) drop(k); };
  const landscape = () => innerWidth > innerHeight * 1.05;

  /* ------------------------------------------------------------- UI */
  function bgClass() {
    el.classList.remove('bg-black', 'bg-gray', 'bg-white');
    const b = settings.readerBg;
    if (b !== 'auto') el.classList.add('bg-' + b);
    else { const dark = ['dark', 'amoled', 'sunset'].includes(document.documentElement.dataset.theme); el.classList.add(dark ? 'bg-black' : 'bg-white'); }
  }
  function night() { $r('.nightfilter').style.background = `rgba(0,0,0,${settings.night / 100})`; }
  function updateUI() {
    const shown = mode === 'webtoon' ? idx + 1 : (spreadLen > 1 ? `${idx + 1}-${idx + spreadLen}` : idx + 1);
    pill.textContent = `${shown} / ${count}`;
    indicator.textContent = pill.textContent;
    slider.value = idx;
    slider.style.direction = mode === 'rtl' ? 'rtl' : 'ltr';
    $r('[data-a=undo]').disabled = !undoSt.length;
    $r('[data-a=redo]').disabled = !redoSt.length;
    $r('[data-a=prevbook]').disabled = !nbr.prev;
    $r('[data-a=nextbook]').disabled = !nbr.next;
    $r('[data-a=bm]').innerHTML = icon(bookmarks.has(idx) ? 'bm' : 'bm_o');
    $r('[data-a=dbl]').style.display = mode === 'webtoon' ? 'none' : '';
    $r('[data-a=dbl]').style.color = dbl ? 'var(--new)' : '';
  }
  function toggleUI(force) { el.classList.toggle('hideui', force ?? !el.classList.contains('hideui')); }
  let spinT;
  const setLoading = on => { clearTimeout(spinT); if (on) spinT = setTimeout(() => loadEl.classList.remove('hidden'), 180); else loadEl.classList.add('hidden'); };

  function saveProgress() {
    if (initial) return;
    const last = idx + spreadLen - 1 >= count - 1;
    const patch = { lastPage: idx, lastRead: Date.now(), bookmarks: [...bookmarks] };
    if (last) { patch.status = 'read'; patch.progress = 1; }
    else { patch.status = 'reading'; patch.progress = (idx + 1) / count; }
    ctx.save(patch);
  }

  /* --------------------------------------------------- paged stage */
  function buildPaged() {
    teardownStages();
    stage = document.createElement('div');
    stage.className = 'r-stage ' + ({ fit: 'fit', width: 'fitw', height: 'fith', orig: 'orig' }[scale] || 'fit');
    stage.innerHTML = '<div class="inner"></div>';
    inner = stage.firstChild;
    el.insertBefore(stage, el.firstChild);
    bindStage();
  }
  const applyT = anim => {
    inner.style.transition = anim ? 'transform .2s ease' : 'none';
    inner.style.transform = `translate(${tx}px,${ty}px) scale(${z})`;
  };
  function bounds() {
    const W = stage.clientWidth, H = stage.clientHeight;
    return { minX: Math.min(0, W - inner.offsetWidth * z), minY: Math.min(0, H - inner.offsetHeight * z) };
  }
  function clampT() { const b = bounds(); tx = clamp(tx, b.minX, 0); ty = clamp(ty, b.minY, 0); }
  function resetZoom(bottom) {
    z = 1; tx = 0; ty = 0;
    if (bottom) { const b = bounds(); ty = b.minY; }
    applyT(false);
  }
  function scrollWithin(dir) {
    if (z > 1.01) return false;
    const H = stage.clientHeight, max = Math.max(0, inner.offsetHeight - H);
    if (max < 6) return false;
    const cur = -ty;
    if (dir > 0 && cur < max - 6) { ty = -Math.min(max, cur + H * .85); applyT(true); return true; }
    if (dir < 0 && cur > 6) { ty = -Math.max(0, cur - H * .85); applyT(true); return true; }
    return false;
  }
  async function show(i, opt = {}) {
    if (destroyed) return;
    i = clamp(i, 0, count - 1);
    const my = ++tok;
    setLoading(true);
    let pages = [i];
    try {
      const first = await load(i);
      if (my !== tok) return;
      if (dbl && landscape() && i > 0 && i + 1 < count && first && first.w <= first.h) {
        const nx = await load(i + 1);
        if (my !== tok) return;
        if (nx && nx.w <= nx.h) pages = [i, i + 1];
      }
      const order = mode === 'rtl' ? [...pages].reverse() : pages;
      const items = await Promise.all(order.map(load));
      if (my !== tok) return;
      idx = i; spreadLen = pages.length;
      inner.innerHTML = items.map(p => p ? `<img src="${p.url}" alt="" draggable="false">` : '').join('');
      stage.classList.toggle('dbl', pages.length > 1);
      await Promise.all([...inner.querySelectorAll('img')].map(im => im.decode?.().catch(() => {})));
      resetZoom(opt.bottom);
    } catch (e) {
      console.error(e); toast('Could not load page ' + (i + 1));
    }
    setLoading(false);
    if (my !== tok) return;
    updateUI(); saveProgress(); initial = false;
    [idx + spreadLen, idx + spreadLen + 1, idx - 1, idx + spreadLen + 2].forEach(n => load(n));
    trimPaged();
  }

  /* -------------------------------------------------- stepping logic */
  const baseDir = v => (mode === 'rtl' ? -v : v);
  const tapDir = v => baseDir(v) * (settings.tapInvert ? -1 : 1);
  async function step(dir) {
    if (mode === 'webtoon') {
      web.scrollBy({ top: dir * web.clientHeight * .85, behavior: 'smooth' });
      return;
    }
    if (scrollWithin(dir)) return;
    if (dir > 0) {
      const nxt = idx + spreadLen;
      if (nxt >= count) return atEnd();
      await show(nxt);
    } else {
      if (idx <= 0) return toast('First page');
      let t = idx - 1;
      if (dbl && landscape() && idx - 2 >= 1) {
        const [a, b] = await Promise.all([load(idx - 2), load(idx - 1)]);
        if (a && b && a.w <= a.h && b.w <= b.h) t = idx - 2;
      }
      await show(t, { bottom: true });
    }
    if (!el.classList.contains('hideui')) { /* keep UI if user opened it */ }
  }
  async function atEnd() {
    saveProgress();
    if (nbr.next) {
      if (await confirmDlg('You finished this book', `Open next: “${nbr.next.title}”?`, 'Open next')) { await ctx.flush(); ctx.open(nbr.next.id); }
    } else toast('End of book');
  }
  async function jump(i) {
    i = clamp(i, 0, count - 1);
    if (i === idx) return;
    undoSt.push(idx); redoSt.length = 0;
    await goTo(i);
  }
  async function goTo(i) { if (mode === 'webtoon') scrollToPage(i); else await show(i); }

  /* ----------------------------------------------------- gestures */
  function bindStage() {
    const ptrs = new Map(); let g = null, lastTap = null, pend = null, lastWheel = 0;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    stage.addEventListener('pointerdown', e => {
      stage.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) g = { x0: e.clientX, y0: e.clientY, t0: Date.now(), tx0: tx, ty0: ty, moved: false, pinch: false };
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; g = { pinch: true, d0: dist(a, b), z0: z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx0: tx, ty0: ty, moved: true }; }
    });
    stage.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId) || !g) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const nz = clamp(g.z0 * dist(a, b) / g.d0, 1, 6);
        tx = g.cx - (g.cx - g.tx0) * nz / g.z0; ty = g.cy - (g.cy - g.ty0) * nz / g.z0; z = nz;
        clampT(); applyT(false);
      } else if (!g.pinch) {
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
        if (g.moved && (z > 1.01 || inner.offsetHeight > stage.clientHeight + 6)) {
          tx = z > 1.01 ? g.tx0 + dx : 0; ty = g.ty0 + dy; clampT(); applyT(false);
        }
      }
    });
    const end = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (g && !g.pinch && ptrs.size === 0) {
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = Date.now() - g.t0;
        if (!g.moved && dt < 400 && e.type === 'pointerup') tap(e.clientX, e.clientY);
        else if (g.moved && z <= 1.01 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) { toggleUI(true); step(dx < 0 ? baseDir(1) : baseDir(-1)); }
      }
      if (ptrs.size === 0) { g = null; if (z < 1.05) resetZoom(); }
      else if (ptrs.size === 1) g = { x0: [...ptrs.values()][0].x, y0: [...ptrs.values()][0].y, t0: 0, tx0: tx, ty0: ty, moved: true, pinch: false };
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    function tap(x, y) {
      const now = Date.now();
      if (settings.doubleTap && lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
        clearTimeout(pend); lastTap = null;
        if (z > 1.05) { z = 1; tx = 0; ty = 0; } else { const nz = 2.5; tx = x - x * nz; ty = y - y * nz; z = nz; clampT(); }
        applyT(true); return;
      }
      lastTap = { t: now, x, y };
      pend = setTimeout(() => single(x), settings.doubleTap ? 280 : 0);
    }
    function single(x) {
      const f = x / stage.clientWidth;
      if (settings.tapNav && z <= 1.05 && (f < .3 || f > .7)) { toggleUI(true); step(f < .3 ? tapDir(-1) : tapDir(1)); }
      else toggleUI();
    }
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const nz = clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 6);
        tx = e.clientX - (e.clientX - tx) * nz / z; ty = e.clientY - (e.clientY - ty) * nz / z; z = nz; clampT(); applyT(false); return;
      }
      const b = bounds(), canScroll = z > 1.01 || b.minY < -6;
      const now = Date.now();
      if (canScroll) {
        const before = ty; ty = clamp(ty - e.deltaY, b.minY, 0); if (z > 1.01) tx = clamp(tx - e.deltaX, b.minX, 0); applyT(false);
        if (ty === before && now - lastWheel > 450 && z <= 1.01) { lastWheel = now; step(e.deltaY > 0 ? 1 : -1); }
      } else if (now - lastWheel > 350 && Math.abs(e.deltaY) > 4) { lastWheel = now; step(e.deltaY > 0 ? 1 : -1); }
    }, { passive: false });
  }

  /* ------------------------------------------------------ webtoon */
  function buildWeb() {
    teardownStages();
    web = document.createElement('div');
    web.className = 'r-web' + (scale === 'fit' ? ' narrow' : '');
    web.style.overflowAnchor = 'none';
    web.style.touchAction = 'pan-y pinch-zoom';
    wps = [];
    for (let i = 0; i < count; i++) {
      const wp = document.createElement('div');
      wp.className = 'wp'; wp.dataset.i = i;
      wp.innerHTML = `<div class="ph">${i + 1}</div>`;
      web.appendChild(wp); wps.push(wp);
    }
    el.insertBefore(web, el.firstChild);
    io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) loadWp(+en.target.dataset.i); }), { root: web, rootMargin: '1600px 0px' });
    wps.forEach(w => io.observe(w));
    let raf = 0;
    web.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; onWebScroll(); }); }, { passive: true });
    let down = null;
    web.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    web.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || Date.now() - down.t > 450; down = null;
      if (moved) return;
      const f = e.clientY / web.clientHeight;
      if (settings.tapNav && f < .22) { toggleUI(true); web.scrollBy({ top: -web.clientHeight * .85, behavior: 'smooth' }); }
      else if (settings.tapNav && f > .78) { toggleUI(true); web.scrollBy({ top: web.clientHeight * .85, behavior: 'smooth' }); }
      else toggleUI();
    });
  }
  async function loadWp(i) {
    if (loaded.has(i) || destroyed) return;
    loaded.add(i);
    try {
      const p = await load(i);
      if (!p || !loaded.has(i)) return;
      const wp = wps[i];
      const oldH = wp.offsetHeight;
      const im = new Image(); im.src = p.url; im.alt = ''; im.draggable = false;
      wp.innerHTML = ''; wp.style.minHeight = '0'; wp.style.height = '';
      wp.appendChild(im);
      const above = wp.offsetTop + oldH <= web.scrollTop + 2;
      if (above) web.scrollTop += wp.offsetHeight - oldH;
    } catch { loaded.delete(i); }
  }
  function unloadWp(i) {
    const wp = wps[i]; if (!wp || !loaded.has(i)) return;
    loaded.delete(i);
    wp.style.height = wp.offsetHeight + 'px';
    wp.innerHTML = `<div class="ph">${i + 1}</div>`;
    drop(i);
  }
  function currentWeb() {
    const y = web.scrollTop + web.clientHeight * .3;
    let lo = 0, hi = count - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (wps[m].offsetTop <= y) lo = m; else hi = m - 1; }
    return lo;
  }
  function onWebScroll() {
    const c = currentWeb();
    if (web.scrollTop + web.clientHeight >= web.scrollHeight - 4 && c >= count - 1) { /* bottom */ }
    if (c !== idx) {
      idx = c; spreadLen = 1; updateUI(); saveProgress();
      for (const k of [...loaded]) if (Math.abs(k - idx) > 14) unloadWp(k);
    } else if (web.scrollTop + web.clientHeight >= web.scrollHeight - 4) saveProgress();
    initial = false;
  }
  function scrollToPage(i) {
    i = clamp(i, 0, count - 1);
    idx = i; spreadLen = 1;
    web.scrollTop = wps[i].offsetTop;
    updateUI();
    requestAnimationFrame(() => { web.scrollTop = wps[i].offsetTop; });
    setTimeout(() => { if (!destroyed && Math.abs(currentWeb() - i) > 0) web.scrollTop = wps[i].offsetTop; }, 350);
    saveProgress();
  }
  function teardownStages() {
    io?.disconnect(); io = null;
    stage?.remove(); web?.remove(); stage = inner = web = null;
    loaded.clear(); wps = [];
    for (const k of [...cache.keys()]) drop(k);
  }
  function rebuild() {
    const keep = idx;
    if (mode === 'webtoon') { buildWeb(); scrollToPage(keep); initial = false; }
    else { buildPaged(); show(keep); }
    updateUI();
  }

  /* ---------------------------------------------------- thumbnails */
  const thumbs = new Map();
  let thumbQ = Promise.resolve();
  function thumb(i, hd) {
    const key = i + (hd ? 'h' : '');
    if (!thumbs.has(key)) {
      thumbs.set(key, new Promise(res => {
        thumbQ = thumbQ.then(async () => {
          try {
            const blob = await src.getBlob(i, hd ? 520 : 300);
            const t = await makeThumb(blob, hd ? 520 : 260, .8);
            res(URL.createObjectURL(t));
          } catch { res(''); }
        });
      }));
    }
    return thumbs.get(key);
  }
  function pagesSheet() {
    let hd = false, onlyBm = false;
    const pg = document.createElement('div');
    pg.className = 'pages';
    pg.innerHTML = `<div class="ph"><button class="ib" data-p="close" aria-label="Close">${icon('close')}</button><h2>Pages</h2>
      <button class="ib" data-p="bm" aria-label="Bookmarked only">${icon('bm_o')}</button><button class="hd" data-p="hd" aria-label="High quality thumbnails">${icon('hd')}</button></div><div class="body"></div>`;
    document.body.appendChild(pg);
    const body = pg.querySelector('.body');
    let obs;
    const draw = () => {
      obs?.disconnect(); body.innerHTML = '';
      body.style.setProperty('--pc', hd ? 2 : 3);
      const list = []; for (let i = 0; i < count; i++) if (!onlyBm || bookmarks.has(i)) list.push(i);
      if (!list.length) body.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--on2);padding:40px 0">No bookmarks yet</p>';
      obs = new IntersectionObserver(es => es.forEach(async en => {
        if (!en.isIntersecting) return; obs.unobserve(en.target);
        const u = await thumb(+en.target.dataset.i, hd);
        if (u) en.target.insertAdjacentHTML('afterbegin', `<img src="${u}" alt="">`);
      }), { root: body, rootMargin: '400px' });
      list.forEach(i => {
        const t = document.createElement('div');
        t.className = 'th' + (i === idx ? ' cur' : ''); t.dataset.i = i;
        t.innerHTML = `<span class="no">${i + 1}</span>${bookmarks.has(i) ? `<span class="bm">${icon('bm', 20)}</span>` : ''}`;
        body.appendChild(t); obs.observe(t);
      });
      body.querySelector('.cur')?.scrollIntoView({ block: 'center' });
    };
    draw();
    const close = () => { obs?.disconnect(); pg.remove(); };
    pg.addEventListener('click', e => {
      const b = e.target.closest('[data-p]'), t = e.target.closest('.th');
      if (t) { close(); toggleUI(true); jump(+t.dataset.i); return; }
      if (!b) return;
      if (b.dataset.p === 'close') close();
      if (b.dataset.p === 'hd') { hd = !hd; b.classList.toggle('on', hd); draw(); }
      if (b.dataset.p === 'bm') { onlyBm = !onlyBm; b.innerHTML = icon(onlyBm ? 'bm' : 'bm_o'); draw(); }
    });
    pg._close = close;
    return pg;
  }

  /* -------------------------------------------------------- actions */
  async function setMode(m) {
    if (m === mode) return;
    mode = m; ctx.save({ readMode: m }); rebuild();
  }
  async function setScale(s) {
    scale = s; ctx.save({ scale: s });
    if (mode === 'webtoon') rebuild();
    else { stage.className = 'r-stage ' + ({ fit: 'fit', width: 'fitw', height: 'fith', orig: 'orig' }[scale]) + (spreadLen > 1 ? ' dbl' : ''); resetZoom(); }
  }
  async function saveImage() {
    try {
      const blob = await src.getBlob(idx, 2600);
      const ext = src.ext ? src.ext(idx) : 'jpg';
      download(blob, `${book.title.replace(/[^\w\-. ]+/g, '_')}-p${idx + 1}.${ext === 'jpeg' ? 'jpg' : ext}`);
    } catch (e) { toast('Could not save image'); }
  }
  function info() {
    const rows = [['Title', book.title], ['File', book.filename], ['Format', book.ext.toUpperCase()], ['Size', fmtSize(book.size)], ['Pages', count], book.series && ['Series', book.series + (book.number ? ' #' + book.number : '')], book.year && ['Year', book.year], book.writer && ['Writer', book.writer], book.publisher && ['Publisher', book.publisher]].filter(Boolean);
    modal(`<h2>Information</h2>${rows.map(([k, v]) => `<div class="opt"><div class="l"><small>${esc(k)}</small>${esc(v)}</div></div>`).join('')}${book.summary ? `<p style="color:var(--on2)">${esc(book.summary)}</p>` : ''}`);
  }
  function cfg() {
    const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${settings[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sw = (k, l, sub = '') => `<div class="opt" data-sw="${k}"><div class="l">${l}${sub ? `<small>${sub}</small>` : ''}</div><span class="sw ${settings[k] ? 'on' : ''}"></span></div>`;
    const { el: d } = modal(`<h2>Reader settings</h2><small style="color:var(--on2)">Background</small>${seg('readerBg', [['auto', 'Theme'], ['white', 'White'], ['gray', 'Gray'], ['black', 'Black']])}
      ${sw('tapNav', 'Tap zones', 'Tap the screen edges to turn pages')}${sw('tapInvert', 'Invert tap zones')}${sw('doubleTap', 'Double-tap to zoom')}${sw('keepAwake', 'Keep screen on')}
      <div style="padding:8px 4px 0"><small style="color:var(--on2)">Night dimming</small><input type="range" min="0" max="60" value="${settings.night}" data-night></div>
      <div class="opt" data-fs>${icon('fullscreen')}<div class="l">Fullscreen</div></div>`);
    d.addEventListener('click', e => {
      const b = e.target.closest('.seg button'); if (b) { settings[b.parentElement.dataset.k] = b.dataset.v; b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); bgClass(); }
      const s = e.target.closest('[data-sw]'); if (s) {
        const k = s.dataset.sw; settings[k] = !settings[k]; s.querySelector('.sw').classList.toggle('on', settings[k]);
        if (k === 'keepAwake') { releaseLock?.(); releaseLock = settings.keepAwake ? wakeLock() : null; }
      }
      if (e.target.closest('[data-fs]')) toggleFs();
    });
    d.querySelector('[data-night]').oninput = e => { settings.night = +e.target.value; night(); };
  }
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); };

  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
    switch (a.dataset.a) {
      case 'exit': await ctx.flush(); ctx.exit(); break;
      case 'info': info(); break;
      case 'bm': bookmarks.has(idx) ? bookmarks.delete(idx) : bookmarks.add(idx); ctx.save({ bookmarks: [...bookmarks] }); updateUI(); toast(bookmarks.has(idx) ? 'Bookmark added' : 'Bookmark removed', 1200); break;
      case 'scale': { const r = await choose('Page scale', [{ id: 'fit', label: 'Fit screen', icon: 'fit' }, { id: 'width', label: 'Fit width', icon: 'swap' }, { id: 'height', label: 'Fit height', icon: 'phone' }, { id: 'orig', label: 'Original size', icon: 'move' }], scale); if (r) setScale(r); break; }
      case 'dir': { const r = await choose('Reading direction', [{ id: 'ltr', label: 'Left to right', sub: 'Western comics & books' }, { id: 'rtl', label: 'Right to left', sub: 'Manga' }, { id: 'webtoon', label: 'Vertical scroll', sub: 'Webtoon / long strip / continuous PDF' }], mode); if (r) setMode(r); break; }
      case 'dbl': dbl = !dbl; ctx.save({ dbl }); toast(dbl ? 'Double-page on (landscape only)' : 'Double-page off', 1600); updateUI(); show(idx); break;
      case 'pages': pagesSheet(); break;
      case 'cfg': cfg(); break;
      case 'save': saveImage(); break;
      case 'undo': if (undoSt.length) { redoSt.push(idx); await goTo(undoSt.pop()); updateUI(); } break;
      case 'redo': if (redoSt.length) { undoSt.push(idx); await goTo(redoSt.pop()); updateUI(); } break;
      case 'prevbook': if (nbr.prev) { await ctx.flush(); ctx.open(nbr.prev.id); } break;
      case 'nextbook': if (nbr.next) { await ctx.flush(); ctx.open(nbr.next.id); } break;
      case 'goto': {
        const { el: d, close } = modal(`<h2>Go to page</h2><label class="field"><span>1 – ${count}</span><input type="number" min="1" max="${count}" value="${idx + 1}"></label><div class="acts"><button class="btn" style="margin:0">Go</button></div>`, { center: true });
        const inp = d.querySelector('input'); setTimeout(() => { inp.focus(); inp.select(); }, 50);
        const go = () => { close(); toggleUI(true); jump(+inp.value - 1); };
        d.querySelector('button').onclick = go; inp.onkeydown = ev => { if (ev.key === 'Enter') go(); };
        break;
      }
    }
  });
  slider.addEventListener('input', () => { const v = +slider.value; pill.textContent = `${v + 1} / ${count}`; });
  slider.addEventListener('change', () => jump(+slider.value));

  const onKey = e => {
    if (e.target.matches('input,textarea,select') || document.querySelector('.modal,.pages')) { if (e.key === 'Escape') document.querySelector('.pages')?._close?.(); return; }
    const k = e.key;
    const rt = baseDir(1);
    if (k === 'ArrowRight') { e.preventDefault(); step(rt); }
    else if (k === 'ArrowLeft') { e.preventDefault(); step(-rt); }
    else if (k === 'ArrowDown' && mode !== 'webtoon') { e.preventDefault(); step(1); }
    else if (k === 'ArrowUp' && mode !== 'webtoon') { e.preventDefault(); step(-1); }
    else if (k === ' ' || k === 'PageDown') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (k === 'PageUp') { e.preventDefault(); step(-1); }
    else if (k === 'Home') jump(0);
    else if (k === 'End') jump(count - 1);
    else if (k === 'f' || k === 'F') toggleFs();
    else if (k === 'm' || k === 'M') toggleUI();
    else if (k === 'b' || k === 'B') el.querySelector('[data-a=bm]').click();
    else if ((k === '+' || k === '=') && stage) { z = clamp(z * 1.25, 1, 6); tx = stage.clientWidth / 2 * (1 - z); ty = stage.clientHeight / 2 * (1 - z); clampT(); applyT(true); }
    else if (k === '-' && stage) { z = clamp(z / 1.25, 1, 6); if (z < 1.05) { z = 1; tx = ty = 0; } else { clampT(); } applyT(true); }
    else if (k === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else { ctx.flush(); ctx.exit(); } }
  };
  addEventListener('keydown', onKey);
  let rz;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (mode !== 'webtoon' && !destroyed) show(idx); }, 200); };
  addEventListener('resize', onResize);
  const onHide = () => { if (document.visibilityState === 'hidden') ctx.flush(); };
  document.addEventListener('visibilitychange', onHide);
  addEventListener('pagehide', onHide);

  /* ---------------------------------------------------------- init */
  bgClass(); night();
  if (mode === 'webtoon') { buildWeb(); scrollToPage(idx); initial = false; if (idx === 0) initial = true; } else { buildPaged(); show(idx); }
  updateUI();
  setTimeout(() => { if (!destroyed && !el.classList.contains('hideui') && initial) { /* leave bars visible until first interaction */ } }, 0);

  return function destroy() {
    destroyed = true;
    removeEventListener('keydown', onKey); removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', onHide);
    releaseLock?.();
    document.querySelector('.pages')?._close?.();
    ctx.flush();
    teardownStages();
    thumbs.forEach(p => p.then(u => u && URL.revokeObjectURL(u)));
    if (src.doc?.destroy) src.doc.destroy().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.remove();
  };
}
