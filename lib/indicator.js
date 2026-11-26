// 指标与格式化工具，全部为纯函数。

export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
  return sum / period;
}

/** 与入参等长的 MA 序列，前置不足周期的位置为 null */
export function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 当前值在样本中的分位（0~100），用于价格分位参考 */
export function percentileRank(values, value) {
  if (!Array.isArray(values) || !values.length) return null;
  let below = 0;
  for (const v of values) if (v <= value) below += 1;
  return (below / values.length) * 100;
}

export function changeRate(current, base) {
  if (!base) return null;
  return current / base - 1;
}

export function fmtPrice(n, digits = 3) {
  if (n == null || Number.isNaN(n)) return '--';
  return Number(n).toFixed(digits);
}

export function fmtPct(x, digits = 2) {
  if (x == null || Number.isNaN(x)) return '--';
  const v = x * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function fmtPercentValue(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '--';
  return `${Number(v).toFixed(digits)}%`;
}

export function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return '--';
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

export function toDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtClock(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const a = new Date(`${fromDate}T00:00:00`);
  const b = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
