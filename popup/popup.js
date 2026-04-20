const fundInput = document.getElementById('fundInput');
const addBtn = document.getElementById('addBtn');
const fundList = document.getElementById('fundList');
const emptyTip = document.getElementById('emptyTip');
const loading = document.getElementById('loading');

// 存储键
const STORAGE_KEY = 'fund_list';
const HOLDINGS_KEY = 'fund_holdings';
const SETTINGS_KEY = 'fund_settings';

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

// 保存单只基金持仓
async function saveFundHolding(code, buyNav, shares) {
  const holdings = await getHoldings();
  if (buyNav && shares) {
    holdings[code] = { buyNav: parseFloat(buyNav), shares: parseFloat(shares) };
  } else {
    delete holdings[code];
  }
  await saveHoldings(holdings);
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

// 计算收益
function calculateProfit(fund, holding, colors) {
  if (!holding || !holding.buyNav || !holding.shares) {
    return null;
  }

  const buyNav = holding.buyNav;
  const shares = holding.shares;
  const currentNav = fund.currentNav ? parseFloat(fund.currentNav) : null;
  const estimatedNav = fund.estimatedNav ? parseFloat(fund.estimatedNav) : null;

  if (!currentNav) return null;

  // 历史收益 = (当前净值 - 买入净值) * 份额
  const totalProfit = (currentNav - buyNav) * shares;
  // 历史收益率
  const totalProfitRate = ((currentNav - buyNav) / buyNav) * 100;

  // 今日预估收益 = (估算净值 - 当前净值) * 份额
  let todayProfit = null;
  if (estimatedNav) {
    todayProfit = (estimatedNav - currentNav) * shares;
  }

  // 持仓市值
  const currentValue = currentNav * shares;
  // 持仓成本
  const costValue = buyNav * shares;

  const isProfit = totalProfit >= 0;

  return {
    totalProfit: totalProfit.toFixed(2),
    totalProfitRate: totalProfitRate.toFixed(2),
    todayProfit: todayProfit !== null ? todayProfit.toFixed(2) : null,
    currentValue: currentValue.toFixed(2),
    costValue: costValue.toFixed(2),
    buyNav: buyNav.toFixed(4),
    shares: shares.toFixed(2),
    isProfit,
    colorClass: isProfit ? 'profit' : 'loss',
  };
}

// 渲染基金卡片
async function renderFundCards(funds) {
  const holdings = await getHoldings();
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
    const profit = calculateProfit(fund, holding, colors);

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

    // 持仓信息区域
    let holdingHTML = '';
    if (profit) {
      const profitTextColor = profit.isProfit ? colors.profitText : colors.lossText;
      holdingHTML = `
        <div class="fund-holding" style="--profit-color: ${profitTextColor}">
          <div class="fund-holding-header">
            <span class="holding-tag">持仓</span>
            <button class="holding-edit" data-code="${fund.code}" title="编辑持仓">✎</button>
          </div>
          <div class="fund-holding-info">
            <div class="fund-info-item">
              <span class="fund-info-label">买入净值</span>
              <span class="fund-info-value">${profit.buyNav}</span>
            </div>
            <div class="fund-info-item">
              <span class="fund-info-label">持有份额</span>
              <span class="fund-info-value">${profit.shares}</span>
            </div>
            <div class="fund-info-item">
              <span class="fund-info-label">持仓成本</span>
              <span class="fund-info-value">${profit.costValue}</span>
            </div>
            <div class="fund-info-item">
              <span class="fund-info-label">持仓市值</span>
              <span class="fund-info-value">${profit.currentValue}</span>
            </div>
            <div class="fund-info-item profit-highlight">
              <span class="fund-info-label">历史收益</span>
              <span class="fund-info-value" style="color: ${profitTextColor}">${profit.isProfit ? '+' : ''}${profit.totalProfit} (${profit.isProfit ? '+' : ''}${profit.totalProfitRate}%)</span>
            </div>
            ${profit.todayProfit !== null ? `
            <div class="fund-info-item profit-highlight">
              <span class="fund-info-label">今日预估</span>
              <span class="fund-info-value" style="color: ${profitTextColor}">${parseFloat(profit.todayProfit) >= 0 ? '+' : ''}${profit.todayProfit}</span>
            </div>
            ` : ''}
          </div>
        </div>
      `;

      // 策略建议
      const advice = calculateStrategyAdvice(profit.totalProfitRate, strategy);
      if (advice) {
        holdingHTML += `
        <div class="strategy-advice ${advice.actionClass}">
          <span class="advice-icon">${advice.type === 'buy' ? '📈' : advice.type === 'hold' ? '⏸️' : '🔄'}</span>
          <span class="advice-text">${advice.text}</span>
          <span class="advice-detail">${advice.detail}</span>
        </div>`;
      }
    } else {
      holdingHTML = `
        <div class="fund-holding-empty">
          <button class="btn-add-holding" data-code="${fund.code}">+ 添加持仓</button>
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

// 显示持仓编辑弹窗
function showHoldingModal(code, existingHolding) {
  // 移除已有弹窗
  const existingModal = document.getElementById('holdingModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'holdingModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>编辑持仓 - ${code}</h3>
        <button class="modal-close" id="modalClose">×</button>
      </div>
      <div class="modal-body">
        <div class="modal-form-group">
          <label for="buyNavInput">持有成本</label>
          <input type="number" id="buyNavInput" step="0.0001" min="0" placeholder="如 1.5000" value="${existingHolding?.buyNav || ''}">
        </div>
        <div class="modal-form-group">
          <label for="sharesInput">持有份额</label>
          <input type="number" id="sharesInput" step="0.01" min="0" placeholder="如 1000.00" value="${existingHolding?.shares || ''}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-modal-cancel" id="modalCancel">取消</button>
        <button class="btn btn-modal-delete" id="modalDelete" style="${existingHolding ? '' : 'display:none'}">删除持仓</button>
        <button class="btn btn-modal-save" id="modalSave">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 绑定事件
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalDelete').addEventListener('click', async () => {
    await saveFundHolding(code, null, null);
    closeModal();
    await refreshAll();
  });
  document.getElementById('modalSave').addEventListener('click', async () => {
    const buyNav = document.getElementById('buyNavInput').value;
    const shares = document.getElementById('sharesInput').value;

    if (!buyNav || !shares || parseFloat(buyNav) <= 0 || parseFloat(shares) <= 0) {
      document.getElementById('buyNavInput').style.borderColor = !buyNav || parseFloat(buyNav) <= 0 ? '#ff4d4f' : '';
      document.getElementById('sharesInput').style.borderColor = !shares || parseFloat(shares) <= 0 ? '#ff4d4f' : '';
      return;
    }

    await saveFundHolding(code, buyNav, shares);
    closeModal();
    await refreshAll();
  });

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // 聚焦到第一个输入框
  document.getElementById('buyNavInput').focus();
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

  // 添加持仓按钮
  const addHoldingBtn = e.target.closest('.btn-add-holding');
  if (addHoldingBtn) {
    const code = addHoldingBtn.dataset.code;
    showHoldingModal(code, null);
    return;
  }

  // 编辑持仓按钮
  const editHoldingBtn = e.target.closest('.holding-edit');
  if (editHoldingBtn) {
    const code = editHoldingBtn.dataset.code;
    const holdings = await getHoldings();
    showHoldingModal(code, holdings[code]);
    return;
  }
});

// 打开设置页
document.getElementById('openSettings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// 初始化：每次打开popup刷新数据
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
