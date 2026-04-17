// 默认颜色
const DEFAULT_COLORS = {
  profit: '#fff1f0',
  profitBorder: '#ffa39e',
  profitText: '#cf1322',
  loss: '#f6ffed',
  lossBorder: '#b7eb8f',
  lossText: '#389e0d',
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
    document.getElementById('theme').value = result.settings?.theme || 'auto';

    // 加载颜色设置
    const colors = result.settings?.colors || DEFAULT_COLORS;
    COLOR_FIELDS.forEach((field) => {
      const value = colors[field.key] || DEFAULT_COLORS[field.key];
      document.getElementById(field.id).value = value;
      document.getElementById(field.textId).value = value;
    });
    updatePreview(colors);
  });
});

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

  chrome.storage.sync.set(
    {
      enabled,
      settings: {
        notifications,
        theme,
        colors,
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
