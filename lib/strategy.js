// 两套独立的策略判定（纯函数）。
//
// 输入是前复权日 K：最后一天等于实时价，历史价格已被统一缩放，
// 因此 MA 与买卖线本身就在「现价坐标」里，页面上的数字可以直接和行情软件对照。

import { sma, changeRate, toDateStr, daysBetween } from './indicator.js';

export const A_CODE = '512890';
export const A_PARK = '511260';
export const B_CODE = '515450';

export const B_TIERS = [
  { key: 'low', max: 20, target: 0.5, label: '低估区', hint: 'PE 分位 ≤ 20%，投入 B 预算 50%' },
  { key: 'fair', max: 40, target: 0.8, label: '合理偏低', hint: '分位 20%~40%，累计投入 80%' },
  { key: 'neutral', max: 60, target: 1, label: '中性', hint: '分位 40%~60%，投满 100%' },
  { key: 'expensive', max: Infinity, target: 1, label: '偏贵', hint: '分位 > 60%，停止加仓' },
];

export function tierOf(pePercentile) {
  if (pePercentile == null || Number.isNaN(Number(pePercentile))) return null;
  const v = Number(pePercentile);
  return B_TIERS.find((t) => v <= t.max) || B_TIERS[B_TIERS.length - 1];
}

/** 最新一根 K 线是否已收盘：盘中下探不算信号 */
export function sessionInfo(bars, now = new Date()) {
  const last = bars[bars.length - 1];
  const isToday = Boolean(last && last.date === toDateStr(now));
  const afterClose = now.getHours() * 60 + now.getMinutes() >= 15 * 60;
  return { lastDate: last?.date || '', isToday, provisional: isToday && !afterClose };
}

const lastOf = (bars) => bars[bars.length - 1];
const prevOf = (bars) => bars[bars.length - 2] || bars[bars.length - 1];

/**
 * 录入成本校正：录完买入后若发生分红，前复权历史会整体缩放，
 * 用「录入那天现在的价格 ÷ 录入时那天的价格」把成本同步缩放。
 */
function adjustedEntry(bars, aState) {
  let entry = Number(aState.entryPrice) || null;
  const saved = Number(aState.entryQfq) || null;
  if (!entry || !saved || !aState.entryDate) return entry;
  const bar = bars.find((b) => b.date === aState.entryDate);
  if (!bar || !(bar.close > 0) || !(saved > 0)) return entry;
  entry *= bar.close / saved;
  return entry;
}

export function evaluateA(bars, cfg, now = new Date()) {
  if (!Array.isArray(bars) || bars.length < 60) {
    return { ok: false, error: 'K 线不足 60 根，无法计算 MA60' };
  }

  const closes = bars.map((b) => b.close);
  const last = lastOf(bars);
  const prev = prevOf(bars);
  const price = last.close;

  const ma60 = sma(closes, 60);
  const { buyFactor, sellFactor, takeProfit } = cfg.settings;
  const buyLine = ma60 * buyFactor;
  const sellLine = ma60 * sellFactor;

  const session = sessionInfo(bars, now);
  const phase = cfg.aState.phase === 'HOLDING' ? 'HOLDING' : 'WAITING';
  const entry = phase === 'HOLDING' ? adjustedEntry(bars, cfg.aState) : null;

  const profit = entry ? price / entry - 1 : null;
  const buyHit = price < buyLine;
  const sellByMa = price >= sellLine;
  const sellByProfit = profit != null && profit >= takeProfit;

  let signal = 'HOLD';
  let reason = '';
  if (phase === 'WAITING' && buyHit) {
    signal = 'BUY';
    reason = `收盘 ${price.toFixed(3)} < 买入线 ${buyLine.toFixed(3)}`;
  } else if (phase === 'HOLDING' && sellByMa) {
    signal = 'SELL';
    reason = `收盘 ${price.toFixed(3)} ≥ 卖出线 ${sellLine.toFixed(3)}`;
  } else if (phase === 'HOLDING' && sellByProfit) {
    signal = 'SELL';
    reason = `浮盈 ${(profit * 100).toFixed(2)}% 已达 ${(takeProfit * 100).toFixed(0)}%`;
  }

  return {
    ok: true,
    code: A_CODE,
    phase,
    date: last.date,
    price,
    dayChange: changeRate(last.close, prev.close),
    ma60,
    buyLine,
    sellLine,
    needDrop: 1 - buyLine / price, // 正数=还需下跌；负数=已跌破
    gapToSell: sellLine / price - 1,
    entryPrice: entry,
    profit,
    gapToTakeProfit: entry ? (entry * (1 + takeProfit)) / price - 1 : null,
    signal,
    reason,
    actionable: signal !== 'HOLD' && !session.provisional,
    session,
  };
}

export function evaluateB(bars, cfg, now = new Date()) {
  if (!Array.isArray(bars) || bars.length < 120) {
    return { ok: false, error: 'K 线不足 120 根，无法计算 MA120' };
  }

  const closes = bars.map((b) => b.close);
  const last = lastOf(bars);
  const prev = prevOf(bars);
  const price = last.close;

  const ma120 = sma(closes, 120);
  const distMa = price / ma120 - 1;
  const session = sessionInfo(bars, now);

  const rawPe = cfg.bState.pePercentile;
  const pe = rawPe === null || rawPe === '' || Number.isNaN(Number(rawPe)) ? null : Number(rawPe);
  const tier = tierOf(pe);
  const mode = pe == null ? 'ma' : 'pe';

  const planB = Number(cfg.plan.b) || 0;
  const invested = Number(cfg.bState.invested) || 0;
  const remaining = Math.max(0, planB - invested);
  const targetAmount = tier ? planB * tier.target : planB;
  const gap = Math.max(0, Math.round(targetAmount - invested));

  const lastBuyDays = daysBetween(cfg.bState.lastBuyDate, last.date);
  const intervalOk = lastBuyDays == null || lastBuyDays >= 14;
  const nearMa = distMa <= 0.02;

  let advice;
  if (mode === 'pe') {
    if (tier.key === 'expensive') {
      advice = { tone: 'stop', title: '停止加仓', text: 'PE 分位高于 60%，不追高，等估值回落' };
    } else if (gap <= 0) {
      advice = { tone: 'hold', title: '该档已建满', text: `已投 ${Math.round(invested)}，等分位进入下一档` };
    } else if (!intervalOk) {
      advice = { tone: 'wait', title: '等间隔', text: `距上次买入 ${lastBuyDays} 天，规则要求间隔 2~4 周` };
    } else if (!nearMa) {
      advice = { tone: 'near', title: '估值到位，等回踩', text: `分位 ${pe.toFixed(1)}%，但高于 MA120 ${(distMa * 100).toFixed(1)}%` };
    } else {
      advice = { tone: 'buy', title: '可分批建仓', text: `本档可投 ¥${gap}，分 2~3 批` };
    }
  } else if (remaining <= 0) {
    advice = { tone: 'hold', title: 'B 仓已建满', text: '停止主动交易，分红优先还月供' };
  } else if (nearMa) {
    advice = {
      tone: 'buy',
      title: '回踩 MA120，可买一批',
      text: `剩余 ¥${Math.round(remaining)}，分 3 批约 ¥${Math.round(remaining / 3)}/批`,
    };
  } else {
    advice = {
      tone: 'wait',
      title: '未到 MA120 区域',
      text: `当前高于 MA120 ${(distMa * 100).toFixed(1)}%，继续等或不看价格只看估值`,
    };
  }

  return {
    ok: true,
    code: B_CODE,
    mode,
    date: last.date,
    price,
    dayChange: changeRate(last.close, prev.close),
    ma120,
    distMa,
    pe,
    tier,
    planB,
    invested,
    remaining,
    targetAmount,
    gap,
    lastBuyDays,
    intervalOk,
    nearMa,
    advice,
    session,
  };
}
