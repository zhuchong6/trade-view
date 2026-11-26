// 行情数据：前复权日 K（三位小数）。
//
// 为什么要用前复权：前复权序列的最后一天等于真实成交价，历史价格被统一缩放，
// 所以 MA60 算出来天然就是「现价坐标」，跟行情软件里的数字可直接比较。
//
// 为什么要两个接口：腾讯的区间接口（带起止日期）返回三位小数但不含当天，
// 只传条数的接口含当天却被截成两位小数。所以「区间接口补历史 + 实时快照补今天」。
//
// 数据源：腾讯为主，东方财富为备（东财在部分网络下直接不可达）。

const TENCENT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const TENCENT_SNAP = 'https://qt.gtimg.cn/q=';
const EASTMONEY = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const CACHE_PREFIX = 'tv_qfq_v2_'; // 前缀带口径标识，旧缓存不能复用
const OPEN_TTL = 3 * 60 * 1000;
const CLOSED_TTL = 6 * 60 * 60 * 1000;

const marketOf = (code) => (/^[569]/.test(code) ? 'sh' : 'sz');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isMarketSession(now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 10;
}

/** 实时快照：三位小数，含当天收盘价 */
async function fetchSnapshot(code) {
  const sym = `${marketOf(code)}${code}`;
  const res = await fetch(`${TENCENT_SNAP}${sym}&_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`快照 HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);
  const matched = text.match(/="([^"]*)"/);
  if (!matched) throw new Error('快照格式异常');
  const f = matched[1].split('~');
  const price = Number(f[3]);
  if (!(price > 0)) throw new Error('快照无有效价格');
  const stamp = String(f[30] || '');
  const date = stamp.length >= 8 ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : '';
  return {
    date,
    open: Number(f[5]) || price,
    close: price,
    high: Number(f[33]) || price,
    low: Number(f[34]) || price,
    volume: (Number(f[6]) || 0) * 100,
    prevClose: Number(f[4]) || price,
  };
}

async function fromTencent(code, limit) {
  const sym = `${marketOf(code)}${code}`;
  const end = new Date();
  const start = new Date(end.getTime() - Math.ceil(limit * 1.9) * 86400000);
  const url =
    `${TENCENT}?param=${sym},day,${ymd(start)},${ymd(end)},${limit},qfq&_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`腾讯 HTTP ${res.status}`);
  const json = await res.json();
  const node = json?.data?.[sym];
  if (!node) throw new Error('腾讯无此代码');
  const key = Object.keys(node).find((k) => k.endsWith('day'));
  const rows = node[key];
  if (!Array.isArray(rows) || !rows.length) throw new Error('腾讯返回空数据');

  const bars = rows.map((r) => ({
    date: r[0],
    open: Number(r[1]),
    close: Number(r[2]),
    high: Number(r[3]),
    low: Number(r[4]),
    volume: Number(r[5]) || 0,
  }));

  // 区间接口不含当天，用实时快照补上（也是三位小数）
  try {
    const snap = await fetchSnapshot(code);
    const last = bars[bars.length - 1];
    if (snap.date && last && snap.date > last.date) {
      bars.push({ date: snap.date, open: snap.open, close: snap.close, high: snap.high, low: snap.low, volume: snap.volume });
    }
  } catch {
    // 快照失败不影响历史数据，最多看不到当天这一根
  }

  return bars;
}

async function fromEastmoney(code, limit) {
  const secid = `${/^[569]/.test(code) ? 1 : 0}.${code}`;
  const url =
    `${EASTMONEY}?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
    `&klt=101&fqt=1&lmt=${limit}&end=20500101&_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`东财 HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.data?.klines;
  if (!Array.isArray(rows) || !rows.length) throw new Error('东财返回空数据');
  return rows.map((line) => {
    const p = String(line).split(',');
    return {
      date: p[0],
      open: Number(p[1]),
      close: Number(p[2]),
      high: Number(p[3]),
      low: Number(p[4]),
      volume: Number(p[5]) || 0,
    };
  });
}

const PROVIDERS = [
  { name: '腾讯', fn: fromTencent },
  { name: '东财', fn: fromEastmoney },
];

/**
 * 取前复权日 K，腾讯失败自动切东财。
 * @returns {Promise<{bars: Array, updatedAt: string, stale: boolean, source: string, error?: string}>}
 */
export async function fetchBars(code, { limit = 400, force = false } = {}) {
  const key = `${CACHE_PREFIX}${code}`;
  const cached = (await chrome.storage.local.get(key))[key] || null;
  const ttl = isMarketSession() ? OPEN_TTL : CLOSED_TTL;

  if (!force && cached && cached.bars.length >= limit && Date.now() - cached.ts < ttl) {
    return { bars: cached.bars, updatedAt: cached.updatedAt, stale: false, source: cached.source || '' };
  }

  const errors = [];
  for (const provider of PROVIDERS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const bars = await provider.fn(code, limit);
        const payload = { ts: Date.now(), updatedAt: new Date().toISOString(), source: provider.name, bars };
        await chrome.storage.local.set({ [key]: payload });
        return { bars, updatedAt: payload.updatedAt, stale: false, source: provider.name };
      } catch (err) {
        errors.push(`${provider.name}:${err.message}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  const message = errors.join(' / ');
  if (cached) {
    return { bars: cached.bars, updatedAt: cached.updatedAt, stale: true, source: cached.source || '', error: message };
  }
  throw new Error(message || '行情获取失败');
}
