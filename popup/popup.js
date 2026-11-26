import { fetchBars } from '../lib/api.js';
import { getConfig } from '../lib/store.js';
import { evaluateA, evaluateB, A_CODE, B_CODE } from '../lib/strategy.js';
import { fmtPrice, fmtPct, fmtPercentValue, fmtMoney, fmtClock, escapeHtml } from '../lib/indicator.js';

const app = document.getElementById('app');
const errorBox = document.getElementById('error');
const stamp = document.getElementById('stamp');
let busy = false;

const cell = (label, value, cls = '') => `<div><i>${label}</i><b class="${cls}">${value}</b></div>`;

function priceBlock(it) {
  const cls = it.dayChange >= 0 ? 'up' : 'down';
  return `
    <div class="price">
      <span class="num">${fmtPrice(it.price)}</span>
      <span class="chg ${cls}">${fmtPct(it.dayChange)}</span>
    </div>
    <div class="sub">前复权口径 · ${it.date}${it.session?.provisional ? ' 盘中' : ' 收盘'}</div>`;
}

function verdict(tone, badge, text) {
  return `<div class="verdict ${tone}"><span class="badge">${badge}</span><span>${escapeHtml(text)}</span></div>`;
}

function renderA(ev) {
  if (!ev.ok) return `<p class="skeleton">${escapeHtml(ev.error)}</p>`;

  const holding = ev.phase === 'HOLDING';
  const pending = ev.session.provisional && ev.signal !== 'HOLD';

  const stateText = pending ? '盘中待确认' : ev.signal === 'BUY' ? '买点' : ev.signal === 'SELL' ? '卖出' : holding ? '持仓中' : '等待买点';
  const stateCls = pending ? 'hold' : holding ? 'hold' : '';

  const grid = holding
    ? [
        cell('持仓成本', fmtPrice(ev.entryPrice)),
        cell('浮盈', fmtPct(ev.profit)),
        cell('卖出线', fmtPrice(ev.sellLine), 'sell'),
        cell('距卖出', fmtPct(ev.gapToSell)),
      ].join('')
    : [
        cell('MA60', fmtPrice(ev.ma60)),
        cell('买入线', fmtPrice(ev.buyLine), 'buy'),
        cell('卖出线', fmtPrice(ev.sellLine), 'sell'),
        cell('距买点', fmtPct(ev.needDrop)),
      ].join('');

  let tone = '';
  let badge = '不操作';
  let text = '';
  if (ev.signal === 'BUY') {
    tone = 'buy';
    badge = '买点';
    text = `卖 511260，全仓买 512890。${ev.reason}`;
  } else if (ev.signal === 'SELL') {
    tone = 'sell';
    badge = '卖出';
    text = `卖出 512890，切回 511260。${ev.reason}`;
  } else if (holding) {
    badge = '持有';
    text = `距卖出线 ${fmtPct(ev.gapToSell)}，浮盈 ${fmtPct(ev.profit)}，先到先卖`;
  } else {
    text = `收盘价还需下跌 ${fmtPct(ev.needDrop)} 跌破 ${fmtPrice(ev.buyLine)}`;
  }
  if (pending) {
    tone = 'stop';
    badge = '待确认';
    text = `盘中已触及，收盘确认后才算信号`;
  }

  return `
    <section class="card">
      <div class="head">
        <b class="tag a">A</b><span class="name">512890 红利低波</span>
        <span class="state ${stateCls}">${stateText}</span>
      </div>
      ${priceBlock(ev)}
      <div class="grid">${grid}</div>
      ${verdict(tone, badge, text)}
    </section>`;
}

function renderB(ev) {
  if (!ev.ok) return `<p class="skeleton">${escapeHtml(ev.error)}</p>`;

  const grid = [
    cell('PE 分位', ev.pe == null ? '未录' : fmtPercentValue(ev.pe)),
    cell('MA120', fmtPrice(ev.ma120)),
    cell('偏离', fmtPct(ev.distMa)),
    cell('本档可投', ev.gap > 0 ? fmtMoney(ev.gap) : '已满'),
  ].join('');

  const tone = ev.advice.tone === 'buy' ? 'buy' : ev.advice.tone === 'stop' ? 'stop' : '';
  return `
    <section class="card">
      <div class="head">
        <b class="tag b">B</b><span class="name">515450 红利低波50</span>
        <span class="state">${ev.tier ? ev.tier.label : '按 MA120'}</span>
      </div>
      ${priceBlock(ev)}
      <div class="grid">${grid}</div>
      ${verdict(tone, ev.advice.title, ev.advice.text)}
    </section>`;
}

async function load(force = false) {
  if (busy) return;
  busy = true;
  errorBox.hidden = true;
  try {
    const cfg = await getConfig();
    const [a, b] = await Promise.all([
      fetchBars(A_CODE, { limit: 400, force }),
      fetchBars(B_CODE, { limit: 200, force }),
    ]);

    const evA = evaluateA(a.bars, cfg);
    const evB = evaluateB(b.bars, cfg);

    app.innerHTML = renderA(evA) + renderB(evB);
    stamp.textContent = `${fmtClock(a.updatedAt)}${a.source ? ` · ${a.source}` : ''}${a.stale ? ' 缓存' : ''}`;

    if (a.stale || b.stale) {
      errorBox.hidden = false;
      errorBox.textContent = `行情接口不可达（腾讯、东财都失败），展示 ${fmtClock(a.updatedAt)} 的缓存。检查网络或代理后点右上角刷新。`;
    }
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = `行情接口不可达：${err.message}。请检查网络/代理，或稍后点刷新重试。`;
    app.innerHTML = '<p class="skeleton">暂无数据</p>';
  } finally {
    busy = false;
  }
}

document.getElementById('refresh').addEventListener('click', () => load(true));
document.getElementById('open-dash').addEventListener('click', () => openDashboard(''));
document.getElementById('open-log').addEventListener('click', () => openDashboard('trade'));

function openDashboard(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/dashboard.html${hash ? `#${hash}` : ''}`) });
  window.close();
}

load();
