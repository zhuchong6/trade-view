import { fetchBars } from '../lib/api.js';
import { getConfig, saveConfig, getLog, appendLog, removeLog, clearLog } from '../lib/store.js';
import { evaluateA, evaluateB, A_CODE, B_CODE } from '../lib/strategy.js';
import { fmtPrice, fmtPct, fmtPercentValue, fmtMoney, fmtClock, toDateStr, escapeHtml } from '../lib/indicator.js';

const $ = (sel) => document.querySelector(sel);

const S = { cfg: null, barsA: [], barsB: [], evA: null, evB: null, log: [], updatedAt: '', source: '', error: '' };

const SIDE_META = {
  'A-BUY': { label: 'A 买入', code: A_CODE, cls: 'a-buy' },
  'A-SELL': { label: 'A 卖出', code: A_CODE, cls: 'a-sell' },
  'B-BUY': { label: 'B 买入', code: B_CODE, cls: 'b-buy' },
};

const cell = (label, value, cls = '') => `<div><i>${label}</i><b class="${cls}">${value}</b></div>`;

async function load(force = false) {
  try {
    S.cfg = await getConfig();
    const [a, b] = await Promise.all([
      fetchBars(A_CODE, { limit: 400, force }),
      fetchBars(B_CODE, { limit: 200, force }),
    ]);
    S.barsA = a.bars;
    S.barsB = b.bars;
    S.updatedAt = a.updatedAt;
    S.source = a.source || '';
    S.error = [a, b].filter((x) => x.stale).length ? 'stale' : '';
    S.log = await getLog();
    reevaluate();
    render();
  } catch (err) {
    S.error = err.message;
    $('#panel-a').innerHTML = `<p class="skeleton">行情接口不可达：${escapeHtml(err.message)}<br />检查网络/代理后点「刷新」。</p>`;
    $('#panel-b').innerHTML = '';
  }
}

function reevaluate() {
  S.evA = evaluateA(S.barsA, S.cfg);
  S.evB = evaluateB(S.barsB, S.cfg);
}

function render() {
  $('#panel-a').innerHTML = cardA(S.evA);
  $('#panel-b').innerHTML = cardB(S.evB);
  renderLog();
  $('#stamp').textContent = `数据 ${fmtClock(S.updatedAt)}${S.source ? ` · ${S.source}` : ''}${S.error === 'stale' ? '（缓存）' : ''}`;
}

function priceBlock(ev) {
  return `
    <div class="price">
      <span class="num">${fmtPrice(ev.price)}</span>
      <span class="chg ${ev.dayChange >= 0 ? 'up' : 'down'}">${fmtPct(ev.dayChange)}</span>
    </div>
    <div class="sub">前复权口径 · ${ev.date}${ev.session.provisional ? ' 盘中' : ' 收盘'} · 数字与行情软件一致</div>`;
}

function verdict(tone, badge, text) {
  return `<div class="verdict ${tone}"><span class="badge">${badge}</span><span>${escapeHtml(text)}</span></div>`;
}

function cardA(ev) {
  if (!ev || !ev.ok) return `<p class="skeleton">${escapeHtml(ev?.error || '暂无数据')}</p>`;

  const holding = ev.phase === 'HOLDING';
  const pending = ev.session.provisional && ev.signal !== 'HOLD';
  const stateText = pending ? '盘中待确认' : ev.signal === 'BUY' ? '买点' : ev.signal === 'SELL' ? '卖出' : holding ? '持仓中' : '等待买点';
  const stateCls = pending ? 'hold' : ev.signal === 'BUY' ? 'buy' : ev.signal === 'SELL' ? 'sell' : holding ? 'hold' : '';

  const grid = holding
    ? [
        cell('持仓成本', fmtPrice(ev.entryPrice)),
        cell('浮盈', fmtPct(ev.profit), ev.profit >= 0 ? '' : 'muted'),
        cell('卖出线', fmtPrice(ev.sellLine), 'sell'),
        cell('距卖出线', fmtPct(ev.gapToSell)),
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
    tone = 'buy'; badge = '买点';
    text = `卖 511260，全仓买入 512890。次日执行，不因跳空取消。`;
  } else if (ev.signal === 'SELL') {
    tone = 'sell'; badge = '卖出';
    text = `卖出 512890，切回 511260 继续等待。`;
  } else if (holding) {
    badge = '持有';
    text = `不加仓。距卖出线 ${fmtPct(ev.gapToSell)}，浮盈 ${fmtPct(ev.profit)}，两者先到先卖。`;
  } else {
    text = `收盘价需跌破 ${fmtPrice(ev.buyLine)}（还需 ${fmtPct(ev.needDrop)}）。A 仓资金停泊 511260。`;
  }
  if (pending) {
    tone = 'stop'; badge = '待确认';
    text = '盘中已触及阈值，收盘确认后才算信号，现在不动。';
  }

  return `
    <header class="panel-head">
      <div class="title"><span class="tag a">A</span>波段增值仓 <span class="name">512890 ↔ 511260</span></div>
      <span class="state ${stateCls}">${stateText}</span>
    </header>
    ${priceBlock(ev)}
    <div class="grid">${grid}</div>
    ${verdict(tone, badge, text)}
    <div class="quick">
      <button class="btn sm" data-act="A-BUY">记买入</button>
      <button class="btn sm ghost" data-act="A-SELL">记卖出</button>
    </div>`;
}

function cardB(ev) {
  if (!ev || !ev.ok) return `<p class="skeleton">${escapeHtml(ev?.error || '暂无数据')}</p>`;

  const grid = [
    cell('PE 分位', ev.pe == null ? '未录' : fmtPercentValue(ev.pe), ev.pe == null ? 'muted' : ''),
    cell('MA120', fmtPrice(ev.ma120)),
    cell('偏离', fmtPct(ev.distMa)),
    cell('本档可投', ev.gap > 0 ? fmtMoney(ev.gap) : '已满'),
  ].join('');

  const tone = ev.advice.tone === 'buy' ? 'buy' : ev.advice.tone === 'stop' ? 'stop' : '';
  const pe = ev.pe;

  const tier =
    pe == null
      ? `<div class="tierbar"><div class="tierbar-track"><span></span><span></span><span></span><span></span></div>
          <div class="tierbar-labels"><span>0</span><span>20 低估</span><span>40 偏低</span><span>60 中性</span><span>100 偏贵</span></div></div>`
      : `<div class="tierbar"><div class="tierbar-track"><span></span><span></span><span></span><span></span>
          <i class="marker" style="left:${Math.min(100, Math.max(0, pe))}%"></i></div>
          <div class="tierbar-labels"><span>0</span><span>20</span><span>40</span><span>60</span><span>100</span></div></div>`;

  return `
    <header class="panel-head">
      <div class="title"><span class="tag b">B</span>月供现金流仓 <span class="name">515450</span></div>
      <span class="state ${ev.advice.tone === 'stop' ? 'hold' : ''}">${ev.tier ? ev.tier.label : '按 MA120'}</span>
    </header>
    ${priceBlock(ev)}
    <div class="grid">${grid}</div>
    ${verdict(tone, ev.advice.title, ev.advice.text)}
    <div class="pe-row">
      <label for="pe-input">PE-TTM 近 5 年分位</label>
      <input id="pe-input" type="number" min="0" max="100" step="0.1" placeholder="录入" value="${pe ?? ''}" />
      <span class="unit">%</span>
      <button class="btn sm" id="pe-save">保存</button>
      <span class="hint">${S.cfg.bState.peUpdatedAt ? `更新于 ${S.cfg.bState.peUpdatedAt}` : '未录入时按 MA120 判断'}</span>
    </div>
    ${tier}
    <div class="quick">
      <button class="btn sm" data-act="B-BUY">记买入</button>
    </div>`;
}

function renderLog() {
  if (!S.log.length) {
    $('#log-body').innerHTML = '<tr><td colspan="6" class="empty">还没有记录。触发信号后记一笔，方便复盘。</td></tr>';
    return;
  }
  $('#log-body').innerHTML = S.log
    .map((e) => {
      const meta = SIDE_META[e.side] || { label: e.side, code: '', cls: '' };
      const t = new Date(e.ts);
      const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      const clock = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return `<tr>
        <td>${date} ${clock}</td>
        <td><span class="side ${meta.cls}">${escapeHtml(meta.label)}</span> <span class="hint">${meta.code}</span></td>
        <td class="num">${fmtPrice(e.price)}</td>
        <td class="num">${e.amount ? fmtMoney(e.amount) : '--'}</td>
        <td class="hint">${escapeHtml(e.trigger || e.note || '--')}</td>
        <td class="num"><button class="link-btn" data-del="${e.id}">删除</button></td>
      </tr>`;
    })
    .join('');
}

/* ---------- 交互 ---------- */

async function savePe() {
  const input = $('#pe-input');
  const raw = input.value.trim();
  const value = raw === '' ? null : Number(raw);
  if (value !== null && (Number.isNaN(value) || value < 0 || value > 100)) {
    input.focus();
    return;
  }
  S.cfg = await saveConfig({ bState: { pePercentile: value, peUpdatedAt: value == null ? '' : toDateStr() } });
  reevaluate();
  render();
}

function openTrade(side) {
  const form = $('#trade-form');
  form.reset();
  form.side.value = side;
  form.price.value = (side === 'B-BUY' ? S.evB?.price : S.evA?.price)?.toFixed(3) || '';
  const hints = {
    'A-BUY': '填你实际成交的实时价即可，记录后 A 仓切为「持仓中」。',
    'A-SELL': '记录后 A 仓切回「等待买点」。',
    'B-BUY': '记录后累加 B 仓已投金额。',
  };
  $('#trade-hint').textContent = hints[side] || '';
  $('#dlg-trade').showModal();
}

async function submitTrade(e) {
  e.preventDefault();
  const form = e.target;
  const side = form.side.value;
  const price = Number(form.price.value);
  const amount = Number(form.amount.value) || 0;
  const note = form.note.value.trim();
  const today = toDateStr();
  if (!(price > 0)) return;

  await appendLog({
    side,
    code: SIDE_META[side].code,
    price,
    amount,
    note,
    trigger: triggerText(side),
    tradeDate: today,
  });

  if (side === 'A-BUY') {
    S.cfg = await saveConfig({
      aState: {
        phase: 'HOLDING',
        // 记当日 K 线日期和当日收盘价，之后若分红导致前复权历史缩放，用它校正成本
        entryDate: S.evA?.date || today,
        entryPrice: price,
        entryQfq: S.evA?.price || price,
        shares: amount ? amount / price : null,
      },
    });
  } else if (side === 'A-SELL') {
    S.cfg = await saveConfig({ aState: { phase: 'WAITING', entryDate: '', entryPrice: null, entryQfq: null, shares: null } });
  } else if (side === 'B-BUY') {
    S.cfg = await saveConfig({
      bState: { invested: Math.round((Number(S.cfg.bState.invested) || 0) + amount), lastBuyDate: today },
    });
  }

  S.log = await getLog();
  reevaluate();
  render();
  $('#dlg-trade').close();
}

function triggerText(side) {
  if (side === 'A-BUY' && S.evA?.ok) return `现价 ${fmtPrice(S.evA.price)} / 买入线 ${fmtPrice(S.evA.buyLine)}`;
  if (side === 'A-SELL' && S.evA?.ok) return `现价 ${fmtPrice(S.evA.price)} / 卖出线 ${fmtPrice(S.evA.sellLine)}`;
  if (side === 'B-BUY' && S.evB?.ok) {
    return S.evB.mode === 'pe' ? `PE 分位 ${fmtPercentValue(S.evB.pe)}` : `偏离 MA120 ${fmtPct(S.evB.distMa)}`;
  }
  return '';
}

async function submitSettings(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const num = (k, d) => {
    const v = Number(f.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  S.cfg = await saveConfig({
    plan: { a: num('planA', 0), b: num('planB', 0) },
    settings: {
      buyFactor: num('buyFactor', 0.97),
      sellFactor: num('sellFactor', 1.05),
      takeProfit: num('takeProfit', 10) / 100,
    },
  });
  reevaluate();
  render();
  $('#dlg-settings').close();
}

function openSettings() {
  const f = $('#settings-form');
  f.planA.value = S.cfg.plan.a;
  f.planB.value = S.cfg.plan.b;
  f.buyFactor.value = S.cfg.settings.buyFactor;
  f.sellFactor.value = S.cfg.settings.sellFactor;
  f.takeProfit.value = Math.round(S.cfg.settings.takeProfit * 100);
  $('#dlg-settings').showModal();
}

/* ---------- 绑定 ---------- */

document.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) return openTrade(act);

  if (e.target.id === 'pe-save') return savePe();

  const delId = e.target.dataset?.del;
  if (delId) {
    S.log = await removeLog(delId);
    renderLog();
  }
});

$('#btn-refresh').addEventListener('click', () => load(true));
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-settings-cancel').addEventListener('click', () => $('#dlg-settings').close());
$('#settings-form').addEventListener('submit', submitSettings);
$('#btn-add-trade').addEventListener('click', () => openTrade('A-BUY'));
$('#btn-trade-cancel').addEventListener('click', () => $('#dlg-trade').close());
$('#trade-form').addEventListener('submit', submitTrade);

$('#btn-clear-log').addEventListener('click', async () => {
  if (!S.log.length || !window.confirm('清空全部记录？')) return;
  await clearLog();
  S.log = [];
  renderLog();
});

load().then(() => {
  if (location.hash === '#trade') openTrade('A-BUY');
});
