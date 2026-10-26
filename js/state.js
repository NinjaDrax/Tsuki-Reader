const KEY = 'tsuki.settings.v1';
export const THEMES = [
  { id: 'auto', name: 'Auto', bg: '#E4E5E9', fg: '#fff' },
  { id: 'light', name: 'Light', bg: '#E4E5E9', fg: '#fff' },
  { id: 'dark', name: 'Dark', bg: '#1F2024', fg: '#131417' },
  { id: 'amoled', name: 'AMOLED', bg: '#000', fg: '#0b0b0b' },
  { id: 'sepia', name: 'Sepia', bg: '#E8DCC3', fg: '#F6EFDD' },
  { id: 'ocean', name: 'Ocean', bg: '#CFE3EE', fg: '#F3FAFD' },
  { id: 'forest', name: 'Forest', bg: '#D4E5D3', fg: '#F4FAF3' },
  { id: 'rose', name: 'Rose', bg: '#F0D5DC', fg: '#FFF6F8' },
  { id: 'lavender', name: 'Lavender', bg: '#DDD6EE', fg: '#F8F6FF' },
  { id: 'sunset', name: 'Sunset', bg: '#2A1A17', fg: '#1D1210' }
];
const DEFAULTS = {
  theme: 'auto',
  cols: 0,            // 0 = automatic
  showTitles: true,
  view: 'grid',       // grid | list
  sort: 'name', sortDir: 1,
  status: 'all', kind: 'all', favOnly: false, collection: 'all',
  readMode: 'auto',   // auto | ltr | rtl | webtoon
  scale: 'fit',       // fit | width | height | orig
  double: false,
  readerBg: 'auto',   // auto | white | black | gray
  tapNav: true, tapInvert: false, keepAwake: true,
  night: 0,           // 0..60 dimming %
  docFont: 'serif', docSize: 19, docLine: 1.6, docWidth: 720, docTheme: 'auto', docAlign: 'left',
  doubleTap: true
};
let cur;
try { cur = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { cur = { ...DEFAULTS }; }
const subs = new Set();
export const settings = new Proxy(cur, {
  set(t, k, v) {
    t[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
    subs.forEach(f => f(k, v));
    return true;
  }
});
export const onSetting = f => { subs.add(f); return () => subs.delete(f); };

export function applyTheme() {
  let t = settings.theme;
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--frame').trim() || '#E4E5E9';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
