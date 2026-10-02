export const STORAGE_KEY = 'randolf:signal-stack:v1';
const FIELDS = ['bestHeight', 'bestScore', 'bestCombo', 'gamesPlayed'];
export function sanitizeRecords(value) {
  return Object.fromEntries(FIELDS.map(key => [key,
    Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : 0]));
}
export function loadRecords(storage) {
  try {
    return sanitizeRecords(JSON.parse((storage ?? globalThis.localStorage).getItem(STORAGE_KEY)));
  } catch { return sanitizeRecords(null); }
}
export function saveRecords(records, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(sanitizeRecords(records)));
    return true;
  } catch { return false; }
}
