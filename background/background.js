// 收盘后自动核对 A 仓信号：更新角标 + 信号触发时发一次通知。

import { fetchBars } from '../lib/api.js';
import { getConfig } from '../lib/store.js';
import { evaluateA, A_CODE } from '../lib/strategy.js';
import { toDateStr } from '../lib/indicator.js';

const ALARM = 'tv-check';
const NOTIFIED_KEY = 'tv_notified';

const BADGE = {
  BUY: { text: '买', color: '#e5484d' },
  SELL: { text: '卖', color: '#30a46c' },
  HOLDING: { text: '持', color: '#f0b429' },
};

/** 清掉旧版本遗留的行情缓存（旧缓存是后复权口径，复用会让价格翻倍） */
async function clearLegacyCache() {
  const all = await chrome.storage.local.get(null);
  const legacy = Object.keys(all).filter((k) => k.startsWith('tv_kline_'));
  if (legacy.length) await chrome.storage.local.remove(legacy);
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) {
    chrome.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: 30 });
  }
}

async function updateBadge(ev) {
  if (!ev || !ev.ok) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  // 盘中未收盘的信号不上角标，只有收盘确认（actionable）才显示买卖
  const key = ev.actionable
    ? ev.signal
    : ev.phase === 'HOLDING'
      ? 'HOLDING'
      : '';
  if (!key) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: BADGE[key].color });
  await chrome.action.setBadgeText({ text: BADGE[key].text });
  await chrome.action.setTitle({
    title: `${key === 'BUY' ? 'A 仓买点出现' : key === 'SELL' ? 'A 仓卖出信号' : 'A 仓持仓中'}｜${ev.reason || ''}`,
  });
}

async function maybeNotify(ev) {
  if (!ev?.ok || !ev.actionable) return;

  const key = `${toDateStr()}:${ev.signal}`;
  const stored = (await chrome.storage.local.get(NOTIFIED_KEY))[NOTIFIED_KEY] || {};
  if (stored[key]) return;

  stored[key] = Date.now();
  // 只保留最近 20 条去重记录
  const pruned = Object.fromEntries(
    Object.entries(stored).sort((a, b) => b[1] - a[1]).slice(0, 20),
  );
  await chrome.storage.local.set({ [NOTIFIED_KEY]: pruned });

  const isBuy = ev.signal === 'BUY';
  await chrome.notifications.create(`tv-${key}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: isBuy ? 'A 仓买点出现：512890' : 'A 仓卖出信号：512890',
    message: `${ev.reason}。${isBuy ? '卖出 511260，全仓买入 512890' : '卖出 512890，资金切回 511260'}`,
    priority: 2,
  });
}

async function runCheck() {
  try {
    const cfg = await getConfig();
    const a = await fetchBars(A_CODE, { limit: 400 });
    const ev = evaluateA(a.bars, cfg);
    await updateBadge(ev);
    await maybeNotify(ev);
  } catch (err) {
    console.warn('[trade-view] 检查失败：', err?.message || err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await clearLegacyCache();
  await ensureAlarm();
  runCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  await clearLegacyCache();
  await ensureAlarm();
  runCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runCheck();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'tv-refresh') {
    runCheck().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
