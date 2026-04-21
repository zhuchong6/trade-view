const fundInput = document.getElementById('fundInput');
const addBtn = document.getElementById('addBtn');
const fundList = document.getElementById('fundList');
const emptyTip = document.getElementById('emptyTip');
const loading = document.getElementById('loading');

// 存储键
const STORAGE_KEY = 'fund_list';
const HOLDINGS_KEY = 'fund_holdings';
const SETTINGS_KEY = 'fund_settings';

// ========== 主题管理 ==========
function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    // auto: 移除属性，让 CSS 媒体查询自动处理
    document.documentElement.removeAttribute('data-theme');
  }
}

async function initTheme() {
  const result = await new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], resolve);
  });
  const theme = result.settings?.theme || 'auto';
  applyTheme(theme);
}

// 监听设置变化（当在 options 页面修改时实时更新）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings?.newValue?.theme) {
    applyTheme(changes.settings.newValue.theme);
  }
});

// 默认颜色配置（中国市场风格：红涨绿跌）
const DEFAULT_COLORS = {
  profit: '#fff1f0',    // 盈利卡片背景
  profitBorder: '#ffa39e', // 盈利卡片边框
  profitText: '#cf1322',   // 盈利文字颜色
  loss: '#f6ffed',      // 亏损卡片背景
  lossBorder: '#b7eb8f',   // 亏损卡片边框
  lossText: '#389e0d',     // 亏损文字颜色
};

// 获取颜色设置
async function getColorSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([SETTINGS_KEY], (result) => {
      resolve(result[SETTINGS_KEY]?.colors || DEFAULT_COLORS);
    });
  });
}

// 获取策略配置
async function getStrategySettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([SETTINGS_KEY], (result) => {
      resolve(result[SETTINGS_KEY]?.strategy || {
        enabled: true,
        lossBuyAmount: 40,
        holdThreshold: 10,
        rebuildThreshold: 10,
      });
    });
  });
}

// 计算策略建议
function calculateStrategyAdvice(profitRate, strategy) {
  if (!strategy.enabled || profitRate === null) return null;

  const rate = parseFloat(profitRate);

  if (rate < 0) {
    // 浮亏 → 建议买
    return {
      type: 'buy',
      text: `建议买入 ¥${strategy.lossBuyAmount}`,
      detail: `浮亏 ${rate.toFixed(2)}%，逢低补仓`,
      actionClass: 'advice-buy',
    };
  } else if (rate < strategy.holdThreshold) {
    // 盈利 < 阈值 → 不买
    return {
      type: 'hold',
      text: '建议持有',
      detail: `盈利 ${rate.toFixed(2)}%，未达止盈线`,
      actionClass: 'advice-hold',
    };
  } else {
    // 盈利 >= 阈值 → 重新建仓
    return {
      type: 'rebuild',
      text: '建议重新建仓',
      detail: `盈利 ${rate.toFixed(2)}%，考虑止盈重置成本`,
      actionClass: 'advice-rebuild',
    };
  }
}

// 获取存储的基金代码列表
async function getFundCodes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

// 保存基金代码列表
async function saveFundCodes(codes) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: codes }, resolve);
  });
}

// 获取持仓数据
async function getHoldings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([HOLDINGS_KEY], (result) => {
      resolve(result[HOLDINGS_KEY] || {});
    });
  });
}

// 保存持仓数据
async function saveHoldings(holdings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [HOLDINGS_KEY]: holdings }, resolve);
  });
}

// 保存单只基金持仓（兼容旧格式）
async function saveFundHolding(code, buyNav, shares) {
  const holdings = await getHoldings();
  if (buyNav && shares) {
    holdings[code] = { buyNav: parseFloat(buyNav), shares: parseFloat(shares) };
  } else {
    delete holdings[code];
  }
  await saveHoldings(holdings);
}

// 迁移旧格式到新格式：{buyNav, shares} -> {records: [{amount, nav, date}]}
function migrateHoldingFormat(holding) {
  if (!holding) return null;
  // 已经是新格式
  if (holding.records && Array.isArray(holding.records)) return holding;
  // 旧格式：{buyNav, shares} -> 转为新格式
  if (holding.buyNav && holding.shares) {
    return {
      records: [{
        amount: parseFloat((holding.buyNav * holding.shares).toFixed(2)),
        nav: holding.buyNav,
        date: '',
      }]
    };
  }
  return null;
}

// 获取规范化后的持仓（自动迁移）
async function getNormalizedHoldings() {
  const holdings = await getHoldings();
  const normalized = {};
  for (const code of Object.keys(holdings)) {
    const migrated = migrateHoldingFormat(holdings[code]);
    if (migrated) {
      normalized[code] = migrated;
    }
  }
  return normalized;
}

// 保存买入记录
async function saveBuyRecord(code, amount, nav, date) {
  const holdings = await getNormalizedHoldings();
  if (!holdings[code]) {
    holdings[code] = { records: [] };
  }
  holdings[code].records.push({
    amount: parseFloat(amount),
    nav: parseFloat(nav),
    date: date || '',
  });
  await saveHoldings(holdings);
}

// 删除单条买入记录
async function deleteBuyRecord(code, index) {
  const holdings = await getNormalizedHoldings();
  if (!holdings[code] || !holdings[code].records) return;
  holdings[code].records.splice(index, 1);
  if (holdings[code].records.length === 0) {
    delete holdings[code];
  }
  await saveHoldings(holdings);
}

// 从 records 计算汇总持仓信息
function calculateHoldingFromRecords(records) {
  if (!records || records.length === 0) return null;
  let totalAmount = 0;
  let totalShares = 0;
  for (const r of records) {
    totalAmount += r.amount;
    totalShares += r.nav > 0 ? r.amount / r.nav : 0;
  }
  const avgNav = totalShares > 0 ? totalAmount / totalShares : 0;
  return {
    totalAmount: totalAmount,
    totalShares: totalShares,
    avgNav: avgNav,
  };
}

// 通过 background 获取基金数据
async function fetchFundData(code) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'fetchFund', code },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response);
      }
    );
  });
}

// 批量获取基金数据
async function fetchAllFunds(codes) {
  showLoading(true);
  const results = [];
  for (const code of codes) {
    const data = await fetchFundData(code);
    if (data) {
      results.push(data);
    }
  }
  showLoading(false);
  return results;
}

// 计算收益（支持新格式 records 和旧格式 buyNav/shares）
function calculateProfit(fund, holding) {
  if (!holding) return null;

  const currentNav = fund.currentNav ? parseFloat(fund.currentNav) : null;
  const estimatedNav = fund.estimatedNav ? parseFloat(fund.estimatedNav) : null;
  if (!currentNav) return null;

  let buyNav, shares, costValue, totalAmount;

  if (holding.records && Array.isArray(holding.records) && holding.records.length > 0) {
    // 新格式：从 records 计算
    const summary = calculateHoldingFromRecords(holding.records);
    if (!summary) return null;
    buyNav = summary.avgNav;
    shares = summary.totalShares;
    costValue = summary.totalAmount;
    totalAmount = summary.totalAmount;
  } else if (holding.buyNav && holding.shares) {
    // 旧格式兼容
    buyNav = holding.buyNav;
    shares = holding.shares;
    costValue = buyNav * shares;
    totalAmount = costValue;
  } else {
    return null;
  }

  // 历史收益 = (当前净值 - 买入净值) * 份额
  const totalProfit = (currentNav - buyNav) * shares;
  // 历史收益率
  const totalProfitRate = ((currentNav - buyNav) / buyNav) * 100;

  // 基于预估净值的收益率（策略判断用，优先用预估净值）
  const effectiveNav = estimatedNav || currentNav;
  const estimatedProfitRate = ((effectiveNav - buyNav) / buyNav) * 100;

  // 今日预估收益 = (估算净值 - 当前净值) * 份额
  let todayProfit = null;
  if (estimatedNav) {
    todayProfit = (estimatedNav - currentNav) * shares;
  }

  // 持仓市值
  const currentValue = currentNav * shares;

  const isProfit = totalProfit >= 0;

  return {
    totalProfit: totalProfit.toFixed(2),
    totalProfitRate: totalProfitRate.toFixed(2),
    estimatedProfitRate: estimatedProfitRate.toFixed(2),
    todayProfit: todayProfit !== null ? todayProfit.toFixed(2) : null,
    currentValue: currentValue.toFixed(2),
    costValue: costValue.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    buyNav: buyNav.toFixed(4),
    shares: shares.toFixed(2),
    isProfit,
    colorClass: isProfit ? 'profit' : 'loss',
  };
}

// 渲染基金卡片
async function renderFundCards(funds) {
  const holdings = await getNormalizedHoldings();
  const colors = await getColorSettings();
  const strategy = await getStrategySettings();

  fundList.innerHTML = '';
  if (funds.length === 0) {
    emptyTip.style.display = 'block';
    return;
  }
  emptyTip.style.display = 'none';

  funds.forEach((fund) => {
    const card = document.createElement('div');
    card.className = 'fund-card';
    card.dataset.code = fund.code;

    const holding = holdings[fund.code];
    const profit = calculateProfit(fund, holding);

    // 卡片盈利/亏损背景色
    if (profit) {
      card.classList.add(profit.colorClass);
      const bgColor = profit.isProfit ? colors.profit : colors.loss;
      const borderColor = profit.isProfit ? colors.profitBorder : colors.lossBorder;
      card.style.backgroundColor = bgColor;
      card.style.borderColor = borderColor;
    }

    // 涨跌样式
    const changeClass = fund.estimatedChange > 0 ? 'up' : fund.estimatedChange < 0 ? 'down' : 'flat';
    const changePrefix = fund.estimatedChange > 0 ? '+' : '';

    // 是否支持实时估值
    const hasNoEstimate = fund.hasRealTimeEstimate === false;
    const noEstimateTip = hasNoEstimate ? '<span class="no-estimate-tip" title="该基金不支持实时估值">(不支持)</span>' : '';

    // 当前净值（用于买入弹窗预填）
    const currentNavForBuy = fund.currentNav || '';

    // 持仓信息区域 - 紧凑一行式
    let holdingHTML = '';
    if (profit) {
      const profitTextColor = profit.isProfit ? colors.profitText : colors.lossText;
      const todayProfitStr = profit.todayProfit !== null
        ? '<div class="holding-today">今日预估 ' + (parseFloat(profit.todayProfit) >= 0 ? '+' : '') + profit.todayProfit + '</div>'
        : '';
      const profitSign = profit.isProfit ? '+' : '';

      holdingHTML = ''
        + '<div class="fund-holding-compact" style="--profit-color: ' + profitTextColor + '">'
        +   '<div class="holding-actions">'
        +     '<button class="btn-buy-record" data-code="' + fund.code + '" data-nav="' + currentNavForBuy + '" title="买入">+ 买入</button>'
        +     '<button class="holding-edit" data-code="' + fund.code + '" title="编辑持仓">✎</button>'
        +   '</div>'
        +   '<div class="holding-row">'
        +     '<span class="holding-label">投入 ' + profit.costValue + '</span>'
        +     '<span class="holding-divider">|</span>'
        +     '<span class="holding-label">市值 ' + profit.currentValue + '</span>'
        +     '<span class="holding-divider">|</span>'
        +     '<span class="holding-profit">收益 <strong>' + profitSign + profit.totalProfit + '</strong> (' + profitSign + profit.totalProfitRate + '%)</span>'
        +   '</div>'
        +   '<div class="holding-detail-row">'
        +     '<span class="holding-label">份额 ' + profit.shares + '</span>'
        +     '<span class="holding-divider">|</span>'
        +     '<span class="holding-label">成本净值 ' + profit.buyNav + '</span>'
        +   '</div>'
        +   todayProfitStr
        + '</div>';

      // 策略建议
      const advice = calculateStrategyAdvice(profit.totalProfitRate, strategy);
      if (advice) {
        var iconMap = { buy: '[+]', hold: '[-]', rebuild: '[r]' };
        holdingHTML += ''
          + '<div class="strategy-advice ' + advice.actionClass + '">'
          +   '<span class="advice-icon">' + (iconMap[advice.type] || '') + '</span>'
          +   '<span class="advice-text">' + advice.text + '</span>'
          +   '<span class="advice-detail">' + advice.detail + '</span>'
          + '</div>';
      }
    } else {
      holdingHTML = `
        <div class="fund-holding-empty">
          <button class="btn-buy-record" data-code="${fund.code}" data-nav="${currentNavForBuy}">+ 买入</button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="fund-header">
        <div style="display:flex;align-items:center;overflow:hidden;">
          <span class="fund-name" title="${fund.name}">${fund.name}</span>
          <span class="fund-code">${fund.code}</span>
        </div>
        <button class="fund-delete" data-code="${fund.code}" title="删除">×</button>
      </div>
      <div class="fund-info">
        <div class="fund-info-item">
          <span class="fund-info-label">当前净值</span>
          <span class="fund-info-value">${fund.currentNav ?? '--'}</span>
        </div>
        <div class="fund-info-item">
          <span class="fund-info-label">累计净值</span>
          <span class="fund-info-value">${fund.totalNav ?? '--'}</span>
        </div>
        <div class="fund-info-item">
          <span class="fund-info-label">今日估值 ${noEstimateTip}</span>
          <span class="fund-info-value ${changeClass}">${hasNoEstimate ? (fund.currentNav ?? '--') : (fund.estimatedNav ?? '--')}</span>
        </div>
        <div class="fund-info-item">
          <span class="fund-info-label">预估涨跌 ${noEstimateTip}</span>
          <span class="fund-info-value ${changeClass}">${hasNoEstimate ? '不支持' : (fund.estimatedChange != null ? changePrefix + fund.estimatedChange + '%' : '--')}</span>
        </div>
      </div>
      ${holdingHTML}
      <div class="fund-update-time">净值日期: ${fund.navDate ?? '--'}</div>
    `;
    fundList.appendChild(card);
  });
}

// 显示买入弹窗
function showBuyModal(code, currentNav) {
  const existingModal = document.getElementById('holdingModal');
  if (existingModal) existingModal.remove();

  // 默认日期为今天
  const today = new Date().toISOString().split('T')[0];

  const modal = document.createElement('div');
  modal.id = 'holdingModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>买入 - ${code}</h3>
        <button class="modal-close" id="modalClose">×</button>
      </div>
      <div class="modal-body">
        <div class="modal-form-group">
          <label for="buyAmountInput">买入金额 (元)</label>
          <input type="number" id="buyAmountInput" step="0.01" min="0.01" placeholder="如 100.00" autofocus>
        </div>
        <div class="modal-form-group">
          <label for="buyNavInput">买入净值</label>
          <input type="number" id="buyNavInput" step="0.0001" min="0.0001" placeholder="如 1.5000" value="${currentNav || ''}">
          <div class="modal-hint">默认为当前净值，可手动修改</div>
        </div>
        <div class="modal-form-group">
          <label for="buyDateInput">买入日期</label>
          <input type="date" id="buyDateInput" value="${today}">
        </div>
        <div id="buyPreview" class="buy-preview"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-modal-cancel" id="modalCancel">取消</button>
        <button class="btn btn-modal-save" id="modalSave">确认买入</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 实时预览份额
  const amountInput = document.getElementById('buyAmountInput');
  const navInput = document.getElementById('buyNavInput');
  const preview = document.getElementById('buyPreview');

  function updatePreview() {
    const amount = parseFloat(amountInput.value);
    const nav = parseFloat(navInput.value);
    if (amount > 0 && nav > 0) {
      const shares = (amount / nav).toFixed(2);
      preview.innerHTML = `<span class="preview-shares">预计份额: ${shares}</span>`;
    } else {
      preview.innerHTML = '';
    }
  }

  amountInput.addEventListener('input', updatePreview);
  navInput.addEventListener('input', updatePreview);

  // 绑定事件
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', async () => {
    const amount = document.getElementById('buyAmountInput').value;
    const nav = document.getElementById('buyNavInput').value;
    const date = document.getElementById('buyDateInput').value;

    if (!amount || parseFloat(amount) <= 0) {
      document.getElementById('buyAmountInput').style.borderColor = '#ff4d4f';
      return;
    }
    if (!nav || parseFloat(nav) <= 0) {
      document.getElementById('buyNavInput').style.borderColor = '#ff4d4f';
      return;
    }

    await saveBuyRecord(code, amount, nav, date);
    closeModal();
    await refreshAll();
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.getElementById('buyAmountInput').focus();
}

// 显示持仓详情弹窗（查看/删除买入记录）
async function showHoldingModal(code) {
  const existingModal = document.getElementById('holdingModal');
  if (existingModal) existingModal.remove();

  const holdings = await getNormalizedHoldings();
  const holding = holdings[code];
  const records = holding?.records || [];

  const modal = document.createElement('div');
  modal.id = 'holdingModal';
  modal.className = 'modal-overlay';

  // 生成记录列表HTML
  let recordsHTML = '';
  if (records.length > 0) {
    recordsHTML = records.map((r, i) => `
      <div class="record-item">
        <div class="record-info">
          <span class="record-amount">¥${r.amount.toFixed(2)}</span>
          <span class="record-nav">净值 ${r.nav.toFixed(4)}</span>
          <span class="record-shares">份额 ${(r.amount / r.nav).toFixed(2)}</span>
          <span class="record-date">${r.date || '--'}</span>
        </div>
        <button class="btn-record-delete" data-code="${code}" data-index="${i}" title="删除此记录">×</button>
      </div>
    `).join('');
  } else {
    recordsHTML = '<div class="no-records">暂无买入记录</div>';
  }

  // 汇总信息
  const summary = calculateHoldingFromRecords(records);
  const summaryHTML = summary ? `
    <div class="records-summary">
      <span>总投入 ¥${summary.totalAmount.toFixed(2)}</span>
      <span>|</span>
      <span>总份额 ${summary.totalShares.toFixed(2)}</span>
      <span>|</span>
      <span>成本净值 ${summary.avgNav.toFixed(4)}</span>
    </div>
  ` : '';

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>持仓详情 - ${code}</h3>
        <button class="modal-close" id="modalClose">×</button>
      </div>
      <div class="modal-body">
        ${summaryHTML}
        <div class="records-list">${recordsHTML}</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-modal-cancel" id="modalCancel">关闭</button>
        <button class="btn btn-modal-delete" id="modalDeleteAll">清空持仓</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 绑定事件
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);

  // 清空全部持仓
  document.getElementById('modalDeleteAll').addEventListener('click', async () => {
    if (!confirm('确定清空该基金的所有持仓记录？')) return;
    await saveFundHolding(code, null, null);
    closeModal();
    await refreshAll();
  });

  // 删除单条记录
  modal.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.btn-record-delete');
    if (deleteBtn) {
      const recordCode = deleteBtn.dataset.code;
      const recordIndex = parseInt(deleteBtn.dataset.index);
      await deleteBuyRecord(recordCode, recordIndex);
      closeModal();
      await refreshAll();
    }
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

function closeModal() {
  const modal = document.getElementById('holdingModal');
  if (modal) modal.remove();
}

// 显示/隐藏加载状态
function showLoading(show) {
  loading.style.display = show ? 'flex' : 'none';
}

// 添加基金
async function addFund() {
  const code = fundInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    fundInput.style.borderColor = '#ff4d4f';
    fundInput.focus();
    setTimeout(() => { fundInput.style.borderColor = ''; }, 1500);
    return;
  }

  const codes = await getFundCodes();
  if (codes.includes(code)) {
    fundInput.value = '';
    return;
  }

  codes.push(code);
  await saveFundCodes(codes);
  fundInput.value = '';

  await refreshAll();
}

// 删除基金
async function deleteFund(code) {
  let codes = await getFundCodes();
  codes = codes.filter((c) => c !== code);
  await saveFundCodes(codes);
  // 同时删除持仓
  await saveFundHolding(code, null, null);
  await refreshAll();
}

// 刷新所有基金数据
async function refreshAll() {
  const codes = await getFundCodes();
  if (codes.length === 0) {
    renderFundCards([]);
    return;
  }
  const funds = await fetchAllFunds(codes);
  renderFundCards(funds);
}

// 事件绑定
addBtn.addEventListener('click', addFund);

fundInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFund();
});

fundList.addEventListener('click', async (e) => {
  // 删除按钮
  const deleteBtn = e.target.closest('.fund-delete');
  if (deleteBtn) {
    deleteFund(deleteBtn.dataset.code);
    return;
  }

  // 买入按钮
  const buyBtn = e.target.closest('.btn-buy-record');
  if (buyBtn) {
    const code = buyBtn.dataset.code;
    const nav = buyBtn.dataset.nav;
    showBuyModal(code, nav);
    return;
  }

  // 编辑持仓按钮
  const editHoldingBtn = e.target.closest('.holding-edit');
  if (editHoldingBtn) {
    const code = editHoldingBtn.dataset.code;
    showHoldingModal(code);
    return;
  }
});

// 打开设置页
document.getElementById('openSettings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// 初始化：每次打开popup刷新数据
initTheme();
refreshAll();
fetchMarketIndices();

// ==================== 市场指数功能 ====================

// 获取市场指数数据（通过 background script）
async function fetchMarketIndex(indexType) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'fetchMarketIndex', indexType },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response);
      }
    );
  });
}

// 更新单个指数显示
function updateIndexDisplay(elementId, data) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const valueEl = el.querySelector('.index-value');
  const changeEl = el.querySelector('.index-change');

  if (!data || !data.value) {
    valueEl.textContent = '--';
    changeEl.textContent = '--';
    changeEl.className = 'index-change flat';
    return;
  }

  valueEl.textContent = data.value;

  if (data.change !== null && data.change !== undefined) {
    const prefix = parseFloat(data.change) > 0 ? '+' : '';
    changeEl.textContent = prefix + data.change + '%';
    
    // 移除旧样式，添加新样式
    changeEl.className = 'index-change ' + (parseFloat(data.change) > 0 ? 'up' : parseFloat(data.change) < 0 ? 'down' : 'flat');
  } else {
    changeEl.textContent = '--';
    changeEl.className = 'index-change flat';
  }
}

// 获取所有市场指数
async function fetchMarketIndices() {
  const [shData, nasdaqData] = await Promise.all([
    fetchMarketIndex('sh'),
    fetchMarketIndex('nasdaq')
  ]);

  updateIndexDisplay('shIndex', shData);
  updateIndexDisplay('nasdaqIndex', nasdaqData);
}
