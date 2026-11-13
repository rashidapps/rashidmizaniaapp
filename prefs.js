// تفضيلات خفيفة في LocalStorage (ليست بديلاً عن IndexedDB).
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
export const getLastBackupAt = () => get('mz.lastBackupAt');
export const setLastBackupAt = iso => set('mz.lastBackupAt', iso);
export const installHintHidden = () => get('mz.hideInstall') === '1';
export const hideInstallHint = () => set('mz.hideInstall', '1');
