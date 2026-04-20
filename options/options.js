// 默认颜色
const DEFAULT_COLORS = {
  profit: '#fff1f0',
  profitBorder: '#ffa39e',
  profitText: '#cf1322',
  loss: '#f6ffed',
  lossBorder: '#b7eb8f',
  lossText: '#389e0d',
};

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

// 默认策略配置
const DEFAULT_STRATEGY = {
  enabled: true,
  lossBuyAmount: 40,     // 浮亏时建议买入金额
  holdThreshold: 10,      // 小盈利持有阈值(%)
  rebuildThreshold: 10,   // 高盈利重新建仓阈值(%)
};

// 颜色字段映射
const COLOR_FIELDS = [
  { id: 'profitBg', key: 'profit', textId: 'profitBgText' },
  { id: 'profitBorder', key: 'profitBorder', textId: 'profitBorderText' },
  { id: 'profitText', key: 'profitText', textId: 'profitTextText' },
  { id: 'lossBg', key: 'loss', textId: 'lossBgText' },
  { id: 'lossBorder', key: 'lossBorder', textId: 'lossBorderText' },
  { id: 'lossText', key: 'lossText', textId: 'lossTextText' },
];

// 加载已保存的设置
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['enabled', 'settings'], (result) => {
    document.getElementById('enabled').checked = result.enabled !== false;
    document.getElementById('notifications').checked = result.settings?.notifications !== false;
    
    const theme = result.settings?.theme || 'auto';
    document.getElementById('theme').value = theme;
    applyTheme(theme);  // 应用主题

    // 加载颜色设置
    const colors = result.settings?.colors || DEFAULT_COLORS;
    COLOR_FIELDS.forEach((field) => {
      const value = colors[field.key] || DEFAULT_COLORS[field.key];
      document.getElementById(field.id).value = value;
      document.getElementById(field.textId).value = value;
    });
    updatePreview(colors);

    // 加载策略配置
    const strategy = result.settings?.strategy || DEFAULT_STRATEGY;
    document.getElementById('strategyEnabled').checked = strategy.enabled !== false;
    document.getElementById('lossBuyAmount').value = strategy.lossBuyAmount ?? DEFAULT_STRATEGY.lossBuyAmount;
    document.getElementById('holdThreshold').value = strategy.holdThreshold ?? DEFAULT_STRATEGY.holdThreshold;
    document.getElementById('rebuildThreshold').value = strategy.rebuildThreshold ?? DEFAULT_STRATEGY.rebuildThreshold;

    // 策略开关控制区域显隐
    toggleStrategyConfigArea(strategy.enabled !== false);
  });
});

// 策略开关联动
document.getElementById('strategyEnabled').addEventListener('change', (e) => {
  toggleStrategyConfigArea(e.target.checked);
});

// 主题选择器 - 实时预览
document.getElementById('theme').addEventListener('change', (e) => {
  applyTheme(e.target.value);
});

function toggleStrategyConfigArea(enabled) {
  document.getElementById('strategyConfigArea').style.display = enabled ? '' : 'none';
}

// 颜色选择器与文本输入同步
COLOR_FIELDS.forEach((field) => {
  const colorInput = document.getElementById(field.id);
  const textInput = document.getElementById(field.textId);

  colorInput.addEventListener('input', () => {
    textInput.value = colorInput.value;
    updatePreviewFromInputs();
  });

  textInput.addEventListener('input', () => {
    const val = textInput.value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      colorInput.value = val;
      updatePreviewFromInputs();
    }
  });

  textInput.addEventListener('blur', () => {
    const val = textInput.value;
    if (!/^#[0-9a-fA-F]{6}$/.test(val)) {
      textInput.value = colorInput.value;
    }
  });
});

// 从输入框获取当前颜色
function getColorsFromInputs() {
  const colors = {};
  COLOR_FIELDS.forEach((field) => {
    colors[field.key] = document.getElementById(field.textId).value;
  });
  return colors;
}

// 更新预览
function updatePreview(colors) {
  const profitCard = document.getElementById('previewProfit');
  const lossCard = document.getElementById('previewLoss');

  profitCard.style.backgroundColor = colors.profit;
  profitCard.style.borderColor = colors.profitBorder;
  profitCard.querySelector('.preview-value').style.color = colors.profitText;

  lossCard.style.backgroundColor = colors.loss;
  lossCard.style.borderColor = colors.lossBorder;
  lossCard.querySelector('.preview-value').style.color = colors.lossText;
}

function updatePreviewFromInputs() {
  updatePreview(getColorsFromInputs());
}

// 恢复默认颜色
document.getElementById('resetColors').addEventListener('click', () => {
  COLOR_FIELDS.forEach((field) => {
    document.getElementById(field.id).value = DEFAULT_COLORS[field.key];
    document.getElementById(field.textId).value = DEFAULT_COLORS[field.key];
  });
  updatePreview(DEFAULT_COLORS);
});

// 保存设置
document.getElementById('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();

  const enabled = document.getElementById('enabled').checked;
  const notifications = document.getElementById('notifications').checked;
  const theme = document.getElementById('theme').value;
  const colors = getColorsFromInputs();

  // 获取策略配置
  const strategyEnabled = document.getElementById('strategyEnabled').checked;
  const lossBuyAmount = parseFloat(document.getElementById('lossBuyAmount').value) || DEFAULT_STRATEGY.lossBuyAmount;
  const holdThreshold = parseFloat(document.getElementById('holdThreshold').value) || DEFAULT_STRATEGY.holdThreshold;
  const rebuildThreshold = parseFloat(document.getElementById('rebuildThreshold').value) || DEFAULT_STRATEGY.rebuildThreshold;

  chrome.storage.sync.set(
    {
      enabled,
      settings: {
        notifications,
        theme,
        colors,
        strategy: {
          enabled: strategyEnabled,
          lossBuyAmount,
          holdThreshold,
          rebuildThreshold,
        },
      },
    },
    () => {
      const status = document.getElementById('status');
      status.textContent = '设置已保存';
      status.className = 'status success';
      setTimeout(() => {
        status.className = 'status';
      }, 2000);
    }
  );
});
