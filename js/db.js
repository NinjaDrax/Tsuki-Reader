// IndexedDB wrapper: books (metadata), files (blobs), kv (misc)
let dbp;
function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('tsuki', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('books', { keyPath: 'id' });
      d.createObjectStore('files');
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function run(stores, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    const r = fn(...[].concat(stores).map(s => t.objectStore(s)));
    if (r && 'onsuccess' in r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
export const db = {
  allBooks: () => run('books', 'readonly', s => s.getAll()),
  getBook: id => run('books', 'readonly', s => s.get(id)),
  putBook: b => run('books', 'readwrite', s => s.put(b)),
  putFile: (id, blob) => run('files', 'readwrite', s => s.put(blob, id)),
  getFile: id => run('files', 'readonly', s => s.get(id)),
  delBook: id => run(['books', 'files'], 'readwrite', (b, f) => { b.delete(id); f.delete(id); }),
  kvGet: k => run('kv', 'readonly', s => s.get(k)),
  kvSet: (k, v) => run('kv', 'readwrite', s => s.put(v, k)),
  clear: () => run(['books', 'files', 'kv'], 'readwrite', (b, f, k) => { b.clear(); f.clear(); k.clear(); })
};
