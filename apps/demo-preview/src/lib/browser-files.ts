/** Browser-local files for the owner-only preview. Production files use the authenticated API. */
const databaseName = 'roadops-files-v1';
function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Bu brauzer fayl saqlashni qo‘llamaydi. Boshqa brauzerda oching.')); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Fayl xotirasini ochib bo‘lmadi.'));
  });
}
export async function saveBrowserFile(file: Blob): Promise<string> {
  const db = await openFiles(), id = crypto.randomUUID();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(file, id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('Fayl saqlanmadi. Qurilmada bo‘sh joyni tekshiring.')); tx.onabort = tx.onerror;
  }); return 'browser-file:' + id; } finally { db.close(); }
}
export async function readBrowserFile(uri: string): Promise<Blob> {
  const db = await openFiles();
  try { return await new Promise<Blob>((resolve, reject) => {
    const req = db.transaction('files').objectStore('files').get(uri.replace(/^browser-file:/, ''));
    req.onsuccess = () => req.result instanceof Blob ? resolve(req.result) : reject(new Error('Fayl bu qurilmada topilmadi.'));
    req.onerror = () => reject(new Error('Faylni ochib bo‘lmadi.'));
  }); } finally { db.close(); }
}
