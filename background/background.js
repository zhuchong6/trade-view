// 天天基金 API 基础地址
const FUND_ESTIMATE_API = 'https://fundgz.1234567.com.cn/js/';
const FUND_INFO_API = 'https://fund.eastmoney.com/pingzhongdata/';

// 插件安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('Trade View 插件已安装');
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchFund' && message.code) {
    fetchFundData(message.code)
      .then((data) => {
        sendResponse(data);
      })
      .catch((err) => {
        console.error('获取基金数据失败:', err);
        sendResponse(null);
      });
    return true; // 保持消息通道开启，异步发送响应
  }
});

// 获取基金数据
async function fetchFundData(code) {
  try {
    // 并行请求估值数据和详细信息
    const [estimateData, infoData] = await Promise.allSettled([
      fetchEstimateData(code),
      fetchFundInfo(code),
    ]);

    const est = estimateData.status === 'fulfilled' ? estimateData.value : null;
    const info = infoData.status === 'fulfilled' ? infoData.value : null;

    // 判断是否有估值数据（某些基金如FOF、新发基金不支持实时估值）
    const hasEstimateData = est && est.dwjz;

    return {
      code,
      name: est?.name || info?.name || code,
      currentNav: est?.dwjz ?? info?.currentNav ?? null,
      totalNav: info?.totalNav ?? est?.dwjz ?? null,
      estimatedNav: hasEstimateData ? est?.gsz : null,
      estimatedChange: hasEstimateData && est?.gszzl != null ? parseFloat(est.gszzl) : null,
      navDate: est?.jzrq ?? info?.navDate ?? null,
      hasRealTimeEstimate: hasEstimateData,
    };
  } catch (err) {
    console.error(`基金 ${code} 数据获取失败:`, err);
    return null;
  }
}

// 获取估值数据（天天基金估值接口，JSONP格式）
async function fetchEstimateData(code) {
  try {
    const url = `${FUND_ESTIMATE_API}${code}.js?rt=${Date.now()}`;
    const response = await fetch(url);
    const text = await response.text();

    // 解析 JSONP: jsonpgz({"fundcode":"000001","name":"...",...}); 或 jsonpgz(); (空数据)
    const match = text.match(/jsonpgz\((.*)\)/);
    if (match) {
      const jsonStr = match[1].trim();
      // 如果括号内为空，说明该基金不支持估值查询（如FOF基金）
      if (!jsonStr) {
        return null;
      }
      try {
        const data = JSON.parse(jsonStr);
        return {
          name: data.name,
          dwjz: data.dwjz,        // 单位净值
          gsz: data.gsz,           // 估算值
          gszzl: data.gszzl,       // 估算涨跌幅
          jzrq: data.jzrq,         // 净值日期
          gztime: data.gztime,     // 估值时间
        };
      } catch (e) {
        return null;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// 获取基金详细信息（累计净值等，JS变量格式）
async function fetchFundInfo(code) {
  try {
    const url = `${FUND_INFO_API}${code}.js?v=${Date.now()}`;
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://fund.eastmoney.com/',
      },
    });
    const text = await response.text();

    let name = null;
    let totalNav = null;
    let currentNav = null;
    let navDate = null;

    // 提取基金名称: var fS_name = "华夏成长混合"
    const nameMatch = text.match(/var\s+fS_name\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      name = nameMatch[1];
    }

    // 提取单位净值趋势: 尝试多种变量名
    const nwPatterns = [
      /var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/,
      /var\s+Data_StockRecentPerformance\s*=\s*(\[[\s\S]*?\]);/,
    ];

    for (const pattern of nwPatterns) {
      const nwMatch = text.match(pattern);
      if (nwMatch) {
        try {
          const trendData = JSON.parse(nwMatch[1]);
          if (Array.isArray(trendData) && trendData.length > 0) {
            const lastEntry = trendData[trendData.length - 1];
            // 支持两种格式：数组 [timestamp, value] 或对象 {x: timestamp, y: value}
            let navValue = null;
            let timestamp = null;

            if (Array.isArray(lastEntry) && lastEntry.length >= 2) {
              timestamp = lastEntry[0];
              navValue = lastEntry[1];
            } else if (typeof lastEntry === 'object' && lastEntry !== null && 'y' in lastEntry) {
              timestamp = lastEntry.x || null;
              navValue = lastEntry.y;
            }

            if (navValue != null && !isNaN(parseFloat(navValue))) {
              currentNav = parseFloat(navValue).toFixed(4);
              if (timestamp) {
                navDate = new Date(timestamp).toISOString().split('T')[0];
              }
            }
          }
        } catch (e) {
          // 解析失败，跳过
        }
        break;
      }
    }

    // 处理累计净值的格式（支持对象格式 {x, y} 和数组格式 [timestamp, value]）
    const acwMatch = text.match(/var\s+Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (acwMatch) {
      try {
        const trendData = JSON.parse(acwMatch[1]);
        if (Array.isArray(trendData) && trendData.length > 0) {
          const lastEntry = trendData[trendData.length - 1];

          let acNavValue = null;
          if (Array.isArray(lastEntry) && lastEntry.length >= 2) {
            acNavValue = lastEntry[1];
          } else if (typeof lastEntry === 'object' && lastEntry !== null && 'y' in lastEntry) {
            acNavValue = lastEntry.y;
          }

          if (acNavValue != null && !isNaN(parseFloat(acNavValue))) {
            totalNav = parseFloat(acNavValue).toFixed(4);
          }
        }
      } catch (e) {
        // 解析失败，跳过
      }
    }

    return { name, totalNav, currentNav, navDate };
  } catch (err) {
    return null;
  }
}

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // 页面加载完成后的逻辑
  }
});
