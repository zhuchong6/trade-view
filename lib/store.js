// 配置与交易记录的持久化。
// 配置放 sync（体积小、跨设备同步），交易记录放 local（可能变长，避免 sync 配额）。

const CONFIG_KEY = 'tv_config';
const LOG_KEY = 'tv_log';
const LOG_LIMIT = 300;

export const DEFAULT_CONFIG = {
  plan: { a: 60000, b: 40000, c: 20000 },
  aState: { phase: 'WAITING', entryDate: '', entryPrice: null, entryQfq: null, shares: null },
  bState: { invested: 0, pePercentile: null, peUpdatedAt: '', lastBuyDate: '' },
  settings: { buyFactor: 0.97, sellFactor: 1.05, takeProfit: 0.1 },
};

const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

function merge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isPlainObject(patch)) return patch === undefined ? out : patch;
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export async function getConfig() {
  const stored = (await chrome.storage.sync.get(CONFIG_KEY))[CONFIG_KEY];
  return merge(DEFAULT_CONFIG, stored || {});
}

export async function saveConfig(patch) {
  const next = merge(await getConfig(), patch);
  await chrome.storage.sync.set({ [CONFIG_KEY]: next });
  return next;
}

export async function resetConfig() {
  await chrome.storage.sync.set({ [CONFIG_KEY]: DEFAULT_CONFIG });
  return merge(DEFAULT_CONFIG, {});
}

export async function getLog() {
  const list = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY];
  return Array.isArray(list) ? list : [];
}

export async function appendLog(entry) {
  const list = await getLog();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
    ...entry,
  };
  const next = [item, ...list].slice(0, LOG_LIMIT);
  await chrome.storage.local.set({ [LOG_KEY]: next });
  return item;
}

export async function removeLog(id) {
  const next = (await getLog()).filter((e) => e.id !== id);
  await chrome.storage.local.set({ [LOG_KEY]: next });
  return next;
}

export async function clearLog() {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}
