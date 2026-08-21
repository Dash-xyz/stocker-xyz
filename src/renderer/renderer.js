const DEFAULT_WATCHLIST = [
  { symbol: 'sh600519', market: 'CN', label: '' },
  { symbol: 'sz000001', market: 'CN', label: '' },
  { symbol: 'hk00700', market: 'HK', label: '' },
  { symbol: 'hk09988', market: 'HK', label: '' },
  { symbol: 'usAAPL', market: 'US', label: '' },
  { symbol: 'usNVDA', market: 'US', label: '' },
  { symbol: 'usGOOG', market: 'US', label: '' },
  { symbol: 'usTSLA', market: 'US', label: '' }
];
const CURRENCY = { CN: 'CNY', HK: 'HKD', US: 'USD' };
const DEFAULT_SETTINGS = {
  interval: 15, minimizeToTray: true, autoStart: false, hideWindowFrame: false, globalShortcut: 'Ctrl+Space', quoteProvider: 'tencent', theme: 'dark', colorMode: 'monochrome', namePinyin: false,
  visibleColumns: ['name', 'price', 'percent', 'profitPercent'], marketIndex: 'sh000001', watchThresholds: { stock: 0, etf: 0, index: 0 }
};
const MARKET_INDEX_DEFS = [
  { group: '中国大陆', symbol: 'sh000001', label: '上证指数' },
  { group: '中国大陆', symbol: 'sz399001', label: '深证成指' },
  { group: '中国大陆', symbol: 'sz399006', label: '创业板指' },
  { group: '中国大陆', symbol: 'sh000300', label: '沪深300' },
  { group: '中国大陆', symbol: 'sh000905', label: '中证500' },
  { group: '中国大陆', symbol: 'sh000852', label: '中证1000' },
  { group: '香港', symbol: 'hkHSI', label: '恒生指数' },
  { group: '香港', symbol: 'hkHSTECH', label: '恒生科技指数' },
  { group: '香港', symbol: 'hkHSCEI', label: '恒生中国企业指数' },
  { group: '美国', symbol: 'usDJI', label: '道琼斯指数' },
  { group: '美国', symbol: 'usIXIC', label: '纳斯达克综合指数' },
  { group: '美国', symbol: 'usNDX', label: '纳斯达克100' },
  { group: '美国', symbol: 'usINX', label: '标普500' }
];
const COLUMN_DEFS = [
  { id: 'code', label: '代码', width: '82px' }, { id: 'name', label: '名称', width: 'minmax(140px, 1.5fr)' },
  { id: 'price', label: '现价', width: '92px' }, { id: 'open', label: '开盘', width: '88px' },
  { id: 'close', label: '收盘', width: '88px' }, { id: 'low', label: '最低', width: '88px' },
  { id: 'high', label: '最高', width: '88px' }, { id: 'amount', label: '交易额', width: '104px' },
  { id: 'change', label: '涨跌额', width: '88px' }, { id: 'percent', label: '涨跌幅', width: '88px' },
  { id: 'cost', label: '成本', width: '88px' }, { id: 'holdings', label: '持仓', width: '88px' },
  { id: 'profit', label: '净收益额', width: '104px' }, { id: 'profitPercent', label: '持仓盈亏%', width: '100px' }
];
const INDEX_COLUMN_IDS = ['name', 'price', 'change', 'percent', 'cost', 'holdings', 'profit', 'profitPercent'];
const $ = (selector) => document.querySelector(selector);
const MARKET_TAB_IDS = ['all', 'position', 'CN', 'HK', 'US', 'index'];
const legacyStoredSort = readStorage('stocker:sort', { field: 'manual', descending: false });
const storedSorts = readStorage('stocker:sort-by-market', {});
function normalizeSort(sort, market) {
  const field = sort?.field;
  const allowedColumns = market === 'index' ? INDEX_COLUMN_IDS : COLUMN_DEFS.map((column) => column.id);
  const normalizedField = field === 'manual' || allowedColumns.includes(field) ? field : 'manual';
  return {
    field: normalizedField,
    descending: normalizedField === 'manual' ? false : Boolean(sort?.descending)
  };
}
const initialSorts = Object.fromEntries(MARKET_TAB_IDS.map((market) => [market, normalizeSort(storedSorts[market] || legacyStoredSort, market)]));
let state = {
  watchlist: readStorage('stocker:watchlist', DEFAULT_WATCHLIST),
  settings: { ...DEFAULT_SETTINGS, ...readStorage('stocker:settings', {}) },
  quotes: readStorage('stocker:quotes', {}),
  lastUpdatedAt: Number(readStorage('stocker:last-updated-at', 0)) || 0,
  market: 'all', sortByMarket: initialSorts, selected: null, timer: null,
  search: { request: 0, results: [], timer: null },
  manageMarket: 'all', manageSelected: null, editingSymbol: null, editingKind: null
};
const WATCH_ALERT_STATE_KEY = 'stocker:watch-alert-state';
const WATCH_ALERT_NOTICE_KEY = 'stocker:watch-alert-notices';
const activeWatchAlerts = new Set();
let watchAlertStates = readStorage(WATCH_ALERT_STATE_KEY, {});
if (!watchAlertStates || typeof watchAlertStates !== 'object' || Array.isArray(watchAlertStates)) watchAlertStates = {};
let watchAlertNotices = normalizeWatchAlertNotices(readStorage(WATCH_ALERT_NOTICE_KEY, []));
const legacyDefaultColumns = ['name', 'price', 'percent'];
if (!Array.isArray(state.settings.visibleColumns) || state.settings.visibleColumns.join('|') === legacyDefaultColumns.join('|')) {
  state.settings.visibleColumns = [...DEFAULT_SETTINGS.visibleColumns];
  saveStorage('stocker:settings', state.settings);
}
state.settings.columnOrder = normalizeColumnOrder(state.settings.columnOrder);
state.settings.marketTabOrder = normalizeMarketTabOrder(state.settings.marketTabOrder);
state.settings.theme = state.settings.theme === 'light' ? 'light' : 'dark';
state.settings.indexOverrides = normalizeIndexOverrides(state.settings.indexOverrides);

function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveStorage(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function normalizeWatchAlertNotices(notices) {
  if (!Array.isArray(notices)) return [];
  return notices
    .filter((notice) => notice && typeof notice === 'object' && typeof notice.symbol === 'string' && typeof notice.name === 'string')
    .map((notice) => ({
      symbol: notice.symbol,
      market: typeof notice.market === 'string' ? notice.market : 'CN',
      name: notice.name,
      percent: Number(notice.percent),
      threshold: Number(notice.threshold),
      triggeredAt: Number(notice.triggeredAt) || Date.now()
    }))
    .filter((notice) => Number.isFinite(notice.percent) && Number.isFinite(notice.threshold))
    .slice(0, 20);
}
function normalizeColumnOrder(order) {
  const known = new Set(COLUMN_DEFS.map((column) => column.id));
  const ordered = Array.isArray(order) ? order.filter((id, index) => known.has(id) && order.indexOf(id) === index) : [];
  return [...ordered, ...COLUMN_DEFS.map((column) => column.id).filter((id) => !ordered.includes(id))];
}
function normalizeMarketTabOrder(order) {
  const ordered = Array.isArray(order) ? order.filter((market, index) => MARKET_TAB_IDS.includes(market) && order.indexOf(market) === index) : [];
  if (!ordered.includes('position') && ordered.includes('CN')) ordered.splice(ordered.indexOf('CN'), 0, 'position');
  return [...ordered, ...MARKET_TAB_IDS.filter((market) => !ordered.includes(market))];
}
function normalizeIndexOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
  return Object.fromEntries(Object.entries(overrides)
    .filter(([symbol, config]) => MARKET_INDEX_DEFS.some((index) => index.symbol === symbol) && config && typeof config === 'object')
    .map(([symbol, config]) => [symbol, {
      label: typeof config.label === 'string' ? config.label : '',
      costPrice: Number.isFinite(config.costPrice) ? config.costPrice : null,
      holdings: Number.isFinite(config.holdings) ? config.holdings : null,
      alertThreshold: Number.isFinite(config.alertThreshold) ? config.alertThreshold : null
    }]));
}
function normalizeSymbol(value, market) {
  const code = value.trim().toUpperCase().replace(/\s/g, '');
  if (market === 'CN') return /^(SH|SZ)/i.test(code) ? code.toLowerCase() : `${/^(6|68)/.test(code) ? 'sh' : 'sz'}${code.padStart(6, '0')}`;
  if (market === 'HK') return /^(HK)/i.test(code) ? code.toLowerCase() : `hk${code.replace(/^0+/, '').padStart(5, '0')}`;
  return /^US/i.test(code) ? `us${code.slice(2)}` : `us${code}`;
}
function cleanName(symbol) { return symbol.replace(/^(sh|sz|hk|us)/i, '').toUpperCase(); }
function formatPrice(value) { return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3, minimumFractionDigits: value < 100 ? 2 : 2 }) : '--'; }
function formatSigned(value, suffix = '') { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}` : '--'; }
function formatUpdateTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function renderLatestUpdateTime() { $('#sync-status').textContent = state.lastUpdatedAt ? formatUpdateTime(state.lastUpdatedAt) : '尚未更新'; }
function colorClass(value) { return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'; }
function displayName(item, quote = state.quotes[item.symbol] || {}) { return item.label || (state.settings.namePinyin && quote.pinyin ? quote.pinyin : quote.name) || item.originalName || cleanName(item.symbol); }
function originalName(item, quote = state.quotes[item.symbol] || {}) { return quote.name || item.originalName || item.label || cleanName(item.symbol); }
function savedNumber(value) { return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'; }
function saveWatchlist() { saveStorage('stocker:watchlist', state.watchlist); }
function currentSort() { return state.sortByMarket[state.market]; }
function saveSort() { saveStorage('stocker:sort-by-market', state.sortByMarket); }
function visibleColumnDefs() {
  const visible = state.market === 'index' ? INDEX_COLUMN_IDS : state.settings.visibleColumns;
  const order = state.market === 'index' ? INDEX_COLUMN_IDS : state.settings.columnOrder;
  return order.map((id) => COLUMN_DEFS.find((column) => column.id === id)).filter((column) => visible.includes(column.id));
}
function quoteGridTemplate() { return visibleColumnDefs().map((column) => column.width).join(' '); }
function formatAmount(value) { if (!Number.isFinite(value)) return '--'; if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿`; if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万`; return value.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function profitValue(item, quote) { return Number.isFinite(item.costPrice) && Number.isFinite(item.holdings) && Number.isFinite(quote.price) ? (quote.price - item.costPrice) * item.holdings : null; }
function profitPercentValue(item, quote) { return Number.isFinite(item.costPrice) && item.costPrice > 0 && Number.isFinite(quote.price) ? (quote.price - item.costPrice) / item.costPrice * 100 : null; }
function assetAlertCategory(item) {
  if (item.market === 'INDEX') return 'index';
  if (item.assetType === 'etf' || /(?:ETF|LOF|基金)/i.test(`${item.originalName || ''} ${item.label || ''}`)) return 'etf';
  return 'stock';
}
function indexItem(index) {
  const overrides = state.settings.indexOverrides[index.symbol] || {};
  return {
    symbol: index.symbol,
    market: 'INDEX',
    originalName: index.label,
    label: overrides.label || '',
    costPrice: Number.isFinite(overrides.costPrice) ? overrides.costPrice : null,
    holdings: Number.isFinite(overrides.holdings) ? overrides.holdings : null,
    alertThreshold: Number.isFinite(overrides.alertThreshold) ? overrides.alertThreshold : null
  };
}
function alertThresholdFor(item) {
  const override = Number(item.alertThreshold);
  if (Number.isFinite(override) && override > 0) return override;
  return Math.max(0, Number(state.settings.watchThresholds?.[assetAlertCategory(item)]) || 0);
}
function alertThresholdKey(threshold) { return (Math.round(Number(threshold) * 1e6) / 1e6).toFixed(6); }
function alertCategoryName(item) { return { stock: '个股', etf: 'ETF/基金', index: '指数' }[assetAlertCategory(item)]; }
function saveWatchAlertStates() { saveStorage(WATCH_ALERT_STATE_KEY, watchAlertStates); }
function saveWatchAlertNotices() { saveStorage(WATCH_ALERT_NOTICE_KEY, watchAlertNotices); }
function alertDirection(percent) { return percent > 0 ? '上涨' : percent < 0 ? '下跌' : '波动'; }
function watchAlertNoticeFor(item, quote, threshold) {
  return {
    symbol: item.symbol,
    market: item.market,
    name: displayName(item, quote),
    percent: Number(quote.percent),
    threshold,
    triggeredAt: Date.now()
  };
}
function renderWatchAlertPanel() {
  const panel = $('#watch-alert-panel');
  const list = $('#watch-alert-list');
  panel.hidden = watchAlertNotices.length === 0;
  if (panel.hidden) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren(...watchAlertNotices.map((notice) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'watch-alert-record';
    row.setAttribute('role', 'listitem');
    row.title = `查看 ${notice.name}`;
    const name = document.createElement('span');
    name.className = 'watch-alert-name';
    name.textContent = notice.name;
    const market = document.createElement('span');
    market.className = 'watch-alert-market';
    market.textContent = marketName(notice.market);
    const detail = document.createElement('span');
    detail.className = `watch-alert-detail ${colorClass(notice.percent)}`;
    detail.textContent = `${alertDirection(notice.percent)} ${formatSigned(notice.percent, '%')} | 阈值 ${notice.threshold}% | ${formatUpdateTime(notice.triggeredAt)}`;
    row.append(name, market, detail);
    row.addEventListener('click', () => {
      state.selected = notice.symbol;
      setMarket(notice.market === 'INDEX' ? 'index' : notice.market);
      if (notice.market === 'INDEX') state.settings.marketIndex = notice.symbol;
      render();
    });
    return row;
  }));
}
function addWatchAlertNotice(item, quote, threshold) {
  watchAlertNotices = [watchAlertNoticeFor(item, quote, threshold), ...watchAlertNotices.filter((notice) => notice.symbol !== item.symbol)].slice(0, 20);
  saveWatchAlertNotices();
  renderWatchAlertPanel();
}
function clearWatchAlertNotice(symbol) {
  const remaining = watchAlertNotices.filter((notice) => notice.symbol !== symbol);
  if (remaining.length === watchAlertNotices.length) return;
  watchAlertNotices = remaining;
  saveWatchAlertNotices();
  renderWatchAlertPanel();
}
function clearWatchAlertState(symbol, clearBackend = true) {
  activeWatchAlerts.delete(symbol);
  clearWatchAlertNotice(symbol);
  if (Object.hasOwn(watchAlertStates, symbol)) {
    delete watchAlertStates[symbol];
    saveWatchAlertStates();
  }
  if (clearBackend) window.__TAURI__.core.invoke('clear_watch_alert_breach', { symbol }).catch(console.error);
}
let alertToastTimer = null;
function showWatchAlertToast(title, body) {
  const toast = $('#watch-alert-toast');
  toast.textContent = `${title}：${body}`;
  toast.hidden = false;
  clearTimeout(alertToastTimer);
  alertToastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
}
async function evaluateWatchAlerts(quotes) {
  const items = [...state.watchlist, ...MARKET_INDEX_DEFS.map(indexItem)];
  const itemsBySymbol = new Map(items.map((item) => [item.symbol, item]));
  let newAlert = false;
  for (const quote of quotes) {
    const item = itemsBySymbol.get(quote.symbol);
    if (!item) continue;
    const threshold = alertThresholdFor(item);
    const percent = Number(quote.percent);
    // A malformed/stale quote must not reset an active breach and cause a duplicate alert later.
    if (!Number.isFinite(percent)) continue;
    const priorState = watchAlertStates[item.symbol];
    const thresholdKey = alertThresholdKey(threshold);
    const alreadyAlerted = priorState?.breached === true
      && (priorState.thresholdKey === thresholdKey || alertThresholdKey(priorState.threshold) === thresholdKey);
    const isBreached = threshold > 0 && Math.abs(percent) >= threshold;
    let isNewBreach;
    try {
      isNewBreach = await window.__TAURI__.core.invoke('evaluate_watch_alert_breach', {
        symbol: item.symbol, thresholdKey, isBreached, alreadyAlerted
      });
    } catch (error) {
      console.error(error);
      isNewBreach = isBreached && !alreadyAlerted;
    }
    if (!isBreached) {
      activeWatchAlerts.delete(item.symbol);
      if (Object.hasOwn(watchAlertStates, item.symbol)) {
        delete watchAlertStates[item.symbol];
        saveWatchAlertStates();
      }
      continue;
    }
    activeWatchAlerts.add(item.symbol);
    if (!alreadyAlerted) {
      watchAlertStates[item.symbol] = { breached: true, thresholdKey };
      saveWatchAlertStates();
    }
    if (!isNewBreach) continue;
    newAlert = true;
    const direction = alertDirection(percent);
    addWatchAlertNotice(item, quote, threshold);
    window.__TAURI__.core.invoke('show_watch_alert', {
      title: `盯盘提醒 · ${alertCategoryName(item)}`,
      body: `${displayName(item, quote)} ${direction} ${formatSigned(percent, '%')}，已达到 ${threshold}% 阈值`
    }).catch((error) => { console.error(error); showWatchAlertToast('盯盘提醒', `${displayName(item, quote)} ${direction} ${formatSigned(percent, '%')}，已达到 ${threshold}%`); });
    showWatchAlertToast('盯盘提醒', `${displayName(item, quote)} ${direction} ${formatSigned(percent, '%')}，已达到 ${threshold}%`);
  }
  syncTrayAlertState(newAlert);
}
function sortValue(item, column) {
  const quote = state.quotes[item.symbol] || {};
  if (column === 'code') return cleanName(item.symbol);
  if (column === 'name') return displayName(item, quote);
  if (column === 'close') return quote.previousClose;
  if (column === 'cost') return item.costPrice;
  if (column === 'holdings') return item.holdings;
  if (column === 'profit') return profitValue(item, quote);
  if (column === 'profitPercent') return profitPercentValue(item, quote);
  return quote[column];
}

function currentItems() {
  let items;
  if (state.market === 'index') {
    items = MARKET_INDEX_DEFS.map(indexItem);
  } else if (state.market === 'position') {
    items = [...state.watchlist, ...MARKET_INDEX_DEFS.map(indexItem)].filter((item) => Number.isFinite(item.costPrice));
  } else {
    items = state.watchlist.filter((item) => state.market === 'all' || item.market === state.market);
  }
  const sort = currentSort();
  if (sort.field === 'manual') return items;
  return items.sort((a, b) => {
    const one = sortValue(a, sort.field);
    const two = sortValue(b, sort.field);
    const oneMissing = one == null || (typeof one === 'number' && !Number.isFinite(one));
    const twoMissing = two == null || (typeof two === 'number' && !Number.isFinite(two));
    if (oneMissing || twoMissing) return oneMissing === twoMissing ? 0 : oneMissing ? 1 : -1;
    if (typeof one === 'string' || typeof two === 'string') {
      return (sort.descending ? -1 : 1) * String(one).localeCompare(String(two), 'zh-CN');
    }
    return (sort.descending ? -1 : 1) * (one - two);
  });
}
let ignoreHeaderClick = false;
let headerPointerDrag = null;
function moveColumn(source, target, after) {
  if (!source || source === target) return;
  const order = normalizeColumnOrder(state.settings.columnOrder);
  const sourceIndex = order.indexOf(source);
  if (sourceIndex < 0 || order.indexOf(target) < 0) return;
  order.splice(sourceIndex, 1);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, source);
  state.settings.columnOrder = order;
  saveStorage('stocker:settings', state.settings);
  ignoreHeaderClick = true;
  setTimeout(() => { ignoreHeaderClick = false; }, 120);
  render();
}
function clearHeaderDragState() {
  headerPointerDrag?.ghost?.remove();
  headerPointerDrag = null;
  document.querySelectorAll('.sort-head').forEach((header) => header.classList.remove('dragging', 'drag-over', 'drop-after'));
}
function updateHeaderDragTarget(event) {
  const drag = headerPointerDrag;
  if (!drag) return;
  drag.ghost.style.transform = `translate3d(${event.clientX + 12}px, ${event.clientY + 12}px, 0)`;
  document.querySelectorAll('.sort-head.drag-over').forEach((header) => header.classList.remove('drag-over', 'drop-after'));
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.sort-head');
  if (!target || target.dataset.column === drag.column) {
    drag.target = null;
    return;
  }
  const rect = target.getBoundingClientRect();
  drag.target = target.dataset.column;
  drag.after = event.clientX >= rect.left + rect.width / 2;
  target.classList.add('drag-over');
  target.classList.toggle('drop-after', drag.after);
}
function renderQuoteHead() {
  const head = $('#quote-head');
  const columns = visibleColumnDefs();
  const sort = currentSort();
  head.style.gridTemplateColumns = quoteGridTemplate();
  head.replaceChildren(...columns.map((column) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.dataset.column = column.id;
    cell.className = `sort-head${sort.field === column.id ? ' active' : ''}${sort.field === column.id && sort.descending ? ' desc' : ''}`;
    cell.setAttribute('aria-sort', sort.field === column.id ? (sort.descending ? 'descending' : 'ascending') : 'none');
    const label = document.createElement('span');
    label.textContent = column.label;
    cell.append(label);
    cell.addEventListener('click', () => {
      if (ignoreHeaderClick) return;
      sort.descending = sort.field === column.id ? !sort.descending : false;
      sort.field = column.id;
      saveSort();
      render();
    });
    cell.addEventListener('pointerdown', (event) => {
      if (state.market === 'index' || event.button !== 0) return;
      headerPointerDrag = { column: column.id, label: column.label, startX: event.clientX, startY: event.clientY, active: false, pointerId: event.pointerId, cell, target: null, after: false, ghost: null };
      cell.setPointerCapture(event.pointerId);
    });
    cell.addEventListener('pointermove', (event) => {
      if (!headerPointerDrag || headerPointerDrag.pointerId !== event.pointerId) return;
      if (!headerPointerDrag.active && Math.hypot(event.clientX - headerPointerDrag.startX, event.clientY - headerPointerDrag.startY) < 6) return;
      if (!headerPointerDrag.active) {
        headerPointerDrag.active = true;
        headerPointerDrag.cell.classList.add('dragging');
        const ghost = headerPointerDrag.cell.cloneNode(true);
        ghost.classList.add('column-drag-ghost');
        ghost.removeAttribute('data-column');
        ghost.disabled = true;
        ghost.style.width = `${headerPointerDrag.cell.getBoundingClientRect().width}px`;
        ghost.style.transform = `translate3d(${event.clientX + 12}px, ${event.clientY + 12}px, 0)`;
        document.body.append(ghost);
        headerPointerDrag.ghost = ghost;
      }
      updateHeaderDragTarget(event);
    });
    cell.addEventListener('pointerup', (event) => {
      if (!headerPointerDrag || headerPointerDrag.pointerId !== event.pointerId) return;
      const drag = headerPointerDrag;
      if (drag.active && drag.target) moveColumn(drag.column, drag.target, drag.after);
      clearHeaderDragState();
    });
    cell.addEventListener('pointercancel', clearHeaderDragState);
    cell.addEventListener('lostpointercapture', (event) => {
      if (headerPointerDrag?.pointerId === event.pointerId) clearHeaderDragState();
    });
    return cell;
  }));
}
function appendQuoteCell(row, column, item, quote) {
  const cell = document.createElement('div');
  cell.className = 'quote-cell';
  let value = '--';
  let className = '';
  if (column.id === 'code') value = cleanName(item.symbol);
  if (column.id === 'name') {
    cell.classList.add('quote-name');
    const badge = document.createElement('i'); badge.className = `market-badge ${item.market}`;
    const text = document.createElement('span'); text.textContent = displayName(item, quote);
    cell.append(badge, text); row.append(cell); return;
  }
  if (column.id === 'price') { value = formatPrice(quote.price); className = colorClass(quote.percent); }
  if (column.id === 'open') value = formatPrice(quote.open);
  if (column.id === 'close') value = formatPrice(quote.previousClose);
  if (column.id === 'low') value = formatPrice(quote.low);
  if (column.id === 'high') value = formatPrice(quote.high);
  if (column.id === 'amount') value = formatAmount(quote.amount);
  if (column.id === 'change') { value = formatSigned(quote.change); className = colorClass(quote.change); }
  if (column.id === 'percent') { value = formatSigned(quote.percent, '%'); className = colorClass(quote.percent); }
  if (column.id === 'cost') value = savedNumber(item.costPrice);
  if (column.id === 'holdings') value = savedNumber(item.holdings);
  if (column.id === 'profit') { const profit = profitValue(item, quote); value = formatSigned(profit); className = colorClass(profit); }
  if (column.id === 'profitPercent') { const profitPercent = profitPercentValue(item, quote); value = formatSigned(profitPercent, '%'); className = colorClass(profitPercent); }
  cell.textContent = value;
  if (className) cell.classList.add(className);
  row.append(cell);
}
function render() {
  const list = $('#quote-list');
  const items = currentItems();
  const isIndexView = state.market === 'index';
  const gridTemplate = quoteGridTemplate();
  renderQuoteHead();
  list.replaceChildren(...items.map((item) => {
    const quote = state.quotes[item.symbol] || {};
    const row = document.createElement('div');
    row.className = `quote-row${state.selected === item.symbol ? ' selected' : ''}`;
    row.style.gridTemplateColumns = gridTemplate;
    row.setAttribute('role', 'listitem');
    row.title = item.market === 'INDEX' ? '双击编辑指数设置' : '双击编辑，右键删除';
    visibleColumnDefs().forEach((column) => appendQuoteCell(row, column, item, quote));
    row.addEventListener('click', () => {
      state.selected = item.symbol;
      if (isIndexView) { state.settings.marketIndex = item.symbol; saveStorage('stocker:settings', state.settings); }
      render();
    });
    if (item.market === 'INDEX') {
      row.addEventListener('dblclick', () => openInstrumentEditor(item.symbol, 'index'));
    } else {
      row.addEventListener('dblclick', () => openInstrumentEditor(item.symbol));
      row.addEventListener('contextmenu', (event) => { event.preventDefault(); if (confirm(`删除 ${displayName(item, quote)}？`)) removeStock(item.symbol); });
    }
    return row;
  }));
  $('#empty-state').hidden = Boolean(items.length);
  renderSummary();
}
function escapeHtml(text) { const holder = document.createElement('span'); holder.textContent = text; return holder.innerHTML; }
function renderMarketIndexOptions() {
  const selector = $('#market-index');
  const groups = new Map();
  MARKET_INDEX_DEFS.forEach((index) => {
    if (!groups.has(index.group)) groups.set(index.group, []);
    groups.get(index.group).push(index);
  });
  selector.replaceChildren(...[...groups].map(([group, indexes]) => {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = group;
    indexes.forEach((index) => {
      const option = document.createElement('option');
      option.value = index.symbol;
      option.textContent = index.label;
      optionGroup.append(option);
    });
    return optionGroup;
  }));
}
function renderSummary() {
  const index = MARKET_INDEX_DEFS.find((item) => item.symbol === state.settings.marketIndex) || MARKET_INDEX_DEFS[0];
  const quote = state.quotes[index.symbol] || {};
  $('#market-index').value = index.symbol;
  $('#summary-price').textContent = formatPrice(quote.price);
  $('#summary-change').textContent = formatSigned(quote.change);
  $('#summary-percent').textContent = formatSigned(quote.percent, '%');
  ['summary-change', 'summary-percent'].forEach((id) => { const target = $(`#${id}`); target.className = colorClass(quote.percent); });
}
let refreshPromise = null;
async function performQuoteRefresh() {
  const symbols = [...new Set([...state.watchlist.map((item) => item.symbol), ...MARKET_INDEX_DEFS.map((index) => index.symbol)])];
  if (!symbols.length) return;
  $('#refresh-button').classList.add('spinning');
  $('#sync-status').classList.remove('error');
  $('#sync-status').textContent = '正在刷新...';
  try {
    const result = await window.__TAURI__.core.invoke('fetch_quotes', { symbols });
    result.quotes.forEach((quote) => { state.quotes[quote.symbol] = quote; });
    await evaluateWatchAlerts(result.quotes);
    saveStorage('stocker:quotes', state.quotes);
    state.lastUpdatedAt = Number(result.fetchedAt) || Date.now();
    saveStorage('stocker:last-updated-at', state.lastUpdatedAt);
    renderLatestUpdateTime();
    render();
  } catch (error) {
    $('#sync-status').textContent = '行情服务暂不可用';
    $('#sync-status').classList.add('error');
    console.error(error);
  } finally { $('#refresh-button').classList.remove('spinning'); }
}
function refreshQuotes() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performQuoteRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
function scheduleRefresh() {
  clearInterval(state.timer);
  if (state.settings.interval > 0) state.timer = setInterval(refreshQuotes, state.settings.interval * 1000);
}
function syncTrayBehavior() {
  window.__TAURI__.core.invoke('set_minimize_to_tray', { enabled: Boolean(state.settings.minimizeToTray) }).catch(console.error);
}
function syncTrayAlertState(newAlert = false) {
  window.__TAURI__.core.invoke('set_tray_alert_active', { active: activeWatchAlerts.size > 0, newAlert }).catch(console.error);
}
function setAutoStart(enabled) { return window.__TAURI__.core.invoke('set_auto_start', { enabled }); }
function setGlobalShortcut(shortcut) { return window.__TAURI__.core.invoke('set_global_shortcut', { shortcut }); }
function setWindowDecorations(decorations) { return window.__TAURI__.core.invoke('set_window_decorations', { decorations }); }
function applyDisplaySettings() { document.documentElement.dataset.theme = state.settings.theme; document.documentElement.dataset.colorMode = state.settings.colorMode; document.documentElement.dataset.windowFrame = state.settings.hideWindowFrame ? 'frameless' : 'system'; }
function renderVisibleColumnSettings() {
  const container = $('#visible-columns');
  container.replaceChildren(...COLUMN_DEFS.map((column) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'visible-column'; input.value = column.id; input.checked = state.settings.visibleColumns.includes(column.id);
    label.append(input, document.createTextNode(column.label));
    return label;
  }));
}
function openSettingsDialog() {
  $('#refresh-interval').value = state.settings.interval;
  $('#minimize-to-tray').checked = Boolean(state.settings.minimizeToTray);
  $('#auto-start').checked = Boolean(state.settings.autoStart);
  $('#hide-window-frame').checked = Boolean(state.settings.hideWindowFrame);
  $('#global-shortcut').value = state.settings.globalShortcut;
  $('#auto-start-error').hidden = true;
  $('#global-shortcut-error').hidden = true;
  $('#window-frame-error').hidden = true;
  $('#stock-provider').value = state.settings.quoteProvider;
  $('#app-theme').value = state.settings.theme;
  document.querySelector(`input[name="color-mode"][value="${state.settings.colorMode}"]`).checked = true;
  $('#name-pinyin').checked = Boolean(state.settings.namePinyin);
  ['stock', 'etf', 'index'].forEach((category) => {
    $(`#watch-threshold-${category}`).value = Number(state.settings.watchThresholds?.[category]) || '';
  });
  renderVisibleColumnSettings();
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}
function marketName(market) { return { CN: 'A股', HK: '港股', US: '美股', INDEX: '指数' }[market] || market; }
function renderAssetResults() {
  const list = $('#asset-results-list');
  list.replaceChildren(...state.search.results.map((asset) => {
    const added = state.watchlist.some((item) => item.symbol === asset.symbol);
    const row = document.createElement('div');
    row.className = 'asset-result-row';
    row.setAttribute('role', 'listitem');
    const code = document.createElement('span'); code.className = 'asset-result-code'; code.textContent = asset.code;
    const name = document.createElement('span'); name.className = 'asset-result-name'; name.textContent = asset.name;
    const market = document.createElement('span'); market.className = 'asset-result-market'; market.textContent = marketName(asset.market);
    const action = document.createElement('button'); action.className = `asset-result-action${added ? ' added remove' : ''}`; action.textContent = added ? '移除' : '添加';
    action.addEventListener('click', () => { if (added) removeStock(asset.symbol); else addAsset(asset); renderAssetResults(); });
    row.append(code, name, market, action);
    return row;
  }));
  if (!state.search.results.length && $('#asset-search').value.trim()) {
    const empty = document.createElement('div'); empty.className = 'asset-no-results'; empty.textContent = '没有匹配的股票'; list.append(empty);
  }
}
function addAsset(asset) {
  if (state.watchlist.some((item) => item.symbol === asset.symbol)) return;
  state.watchlist.push({ symbol: asset.symbol, market: asset.market, originalName: asset.name, assetType: asset.assetType || 'stock', label: '', costPrice: null, holdings: null, alertThreshold: null });
  state.selected = asset.symbol;
  saveWatchlist();
  render();
  refreshQuotes();
}
async function searchAssets() {
  const input = $('#asset-search');
  const query = input.value.trim();
  const clear = $('#clear-asset-search');
  clear.hidden = !query;
  state.search.request += 1;
  const request = state.search.request;
  if (!query) {
    state.search.results = [];
    $('#asset-search-status').textContent = '输入名称、拼音或代码搜索股票和 ETF';
    $('#asset-search-status').classList.remove('error');
    renderAssetResults();
    return;
  }
  $('#asset-search-status').textContent = '正在搜索...';
  $('#asset-search-status').classList.remove('error');
  try {
    const results = await window.__TAURI__.core.invoke('search_assets', { query, market: $('#asset-market').value });
    if (request !== state.search.request) return;
    state.search.results = results;
    $('#asset-search-status').textContent = results.length ? `找到 ${results.length} 个匹配结果` : '没有匹配的证券';
    renderAssetResults();
  } catch (error) {
    if (request !== state.search.request) return;
    state.search.results = [];
    $('#asset-search-status').textContent = '搜索服务暂不可用';
    $('#asset-search-status').classList.add('error');
    renderAssetResults();
    console.error(error);
  }
}
function queueAssetSearch() { clearTimeout(state.search.timer); state.search.timer = setTimeout(searchAssets, 180); }
function openAssetSearch() {
  const input = $('#asset-search');
  if (!$('#stock-dialog').open) $('#stock-dialog').showModal();
  setTimeout(() => input.focus(), 50);
}
function managedItems() { return state.watchlist.filter((item) => state.manageMarket === 'all' || item.market === state.manageMarket); }
function renderManage() {
  const items = managedItems();
  const list = $('#manage-watchlist');
  list.replaceChildren(...items.map((item) => {
    const quote = state.quotes[item.symbol] || {};
    const row = document.createElement('div');
    row.className = `manage-row${state.manageSelected === item.symbol ? ' selected' : ''}`;
    row.setAttribute('role', 'listitem');
    row.title = '双击编辑标的';
    const columns = [
      [cleanName(item.symbol), 'manage-code'], [originalName(item, quote), ''], [item.label || '—', 'manage-meta'],
      [savedNumber(item.costPrice), 'manage-meta'], [savedNumber(item.holdings), 'manage-meta']
    ];
    columns.forEach(([text, className]) => { const cell = document.createElement('span'); cell.className = className; cell.textContent = text; row.append(cell); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'manage-delete'; remove.title = '删除'; remove.setAttribute('aria-label', `删除 ${displayName(item, quote)}`); remove.textContent = '×';
    remove.addEventListener('click', (event) => { event.stopPropagation(); if (confirm(`删除 ${displayName(item, quote)}？`)) removeStock(item.symbol); });
    row.append(remove);
    row.addEventListener('click', () => { state.manageSelected = item.symbol; renderManage(); });
    row.addEventListener('dblclick', () => openInstrumentEditor(item.symbol));
    return row;
  }));
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'manage-empty'; empty.textContent = '该市场还没有自选股票'; list.append(empty); }
  document.querySelectorAll('.manage-market-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.manageMarket === state.manageMarket));
  const selectedIndex = items.findIndex((item) => item.symbol === state.manageSelected);
  $('#move-watchlist-up').disabled = selectedIndex <= 0;
  $('#move-watchlist-down').disabled = selectedIndex < 0 || selectedIndex >= items.length - 1;
}
function moveManagedStock(delta) {
  const items = managedItems();
  const currentIndex = items.findIndex((item) => item.symbol === state.manageSelected);
  const target = currentIndex + delta;
  if (currentIndex < 0 || target < 0 || target >= items.length) return;
  const sourceIndex = state.watchlist.findIndex((item) => item.symbol === items[currentIndex].symbol);
  const targetIndex = state.watchlist.findIndex((item) => item.symbol === items[target].symbol);
  [state.watchlist[sourceIndex], state.watchlist[targetIndex]] = [state.watchlist[targetIndex], state.watchlist[sourceIndex]];
  saveWatchlist();
  render();
  renderManage();
}
function openManageDialog() {
  state.manageMarket = state.market;
  const items = managedItems();
  state.manageSelected = items.some((item) => item.symbol === state.selected) ? state.selected : items[0]?.symbol || null;
  renderManage();
  $('#manage-dialog').showModal();
}
function openInstrumentEditor(symbol, kind = 'watchlist') {
  const item = kind === 'index'
    ? MARKET_INDEX_DEFS.find((index) => index.symbol === symbol) && indexItem(MARKET_INDEX_DEFS.find((index) => index.symbol === symbol))
    : state.watchlist.find((entry) => entry.symbol === symbol);
  if (!item) return;
  state.editingSymbol = symbol;
  state.editingKind = kind;
  $('#instrument-title').textContent = `${kind === 'index' ? '编辑指数' : '编辑自选'} ${cleanName(item.symbol)}`;
  $('#instrument-original-name').textContent = originalName(item);
  $('#instrument-label').value = item.label || '';
  $('#instrument-cost').value = Number.isFinite(item.costPrice) ? item.costPrice : '';
  $('#instrument-holdings').value = Number.isFinite(item.holdings) ? item.holdings : '';
  $('#instrument-alert-threshold').value = Number.isFinite(item.alertThreshold) ? item.alertThreshold : '';
  $('#instrument-alert-category').textContent = alertCategoryName(item);
  $('#instrument-dialog').showModal();
  setTimeout(() => $('#instrument-label').focus(), 50);
}
function removeStock(symbol) {
  state.watchlist = state.watchlist.filter((item) => item.symbol !== symbol);
  clearWatchAlertState(symbol);
  syncTrayAlertState();
  if (state.selected === symbol) state.selected = null;
  if (state.manageSelected === symbol) state.manageSelected = managedItems()[0]?.symbol || null;
  saveWatchlist();
  render();
  if ($('#manage-dialog').open) renderManage();
}

let ignoreMarketTabClick = false;
let marketTabPointerDrag = null;
function marketTabs() { return [...document.querySelectorAll('.market-tabs button')]; }
function applyMarketTabOrder() {
  const nav = document.querySelector('.market-tabs');
  const tabsByMarket = new Map(marketTabs().map((tab) => [tab.dataset.market, tab]));
  state.settings.marketTabOrder.forEach((market) => nav.append(tabsByMarket.get(market)));
}
function moveMarketTab(source, target, after) {
  if (!source || source === target) return;
  const order = normalizeMarketTabOrder(state.settings.marketTabOrder);
  const sourceIndex = order.indexOf(source);
  if (sourceIndex < 0 || order.indexOf(target) < 0) return;
  order.splice(sourceIndex, 1);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, source);
  state.settings.marketTabOrder = order;
  saveStorage('stocker:settings', state.settings);
  ignoreMarketTabClick = true;
  setTimeout(() => { ignoreMarketTabClick = false; }, 120);
  applyMarketTabOrder();
}
function clearMarketTabDragState() {
  marketTabPointerDrag?.ghost?.remove();
  marketTabPointerDrag = null;
  marketTabs().forEach((tab) => tab.classList.remove('dragging', 'drag-over', 'drop-after'));
}
function updateMarketTabDragTarget(event) {
  const drag = marketTabPointerDrag;
  if (!drag) return;
  drag.ghost.style.transform = `translate3d(${event.clientX + 10}px, ${event.clientY + 10}px, 0)`;
  marketTabs().forEach((tab) => tab.classList.remove('drag-over', 'drop-after'));
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.market-tabs button');
  if (!target || target.dataset.market === drag.market) {
    drag.target = null;
    return;
  }
  const rect = target.getBoundingClientRect();
  drag.target = target.dataset.market;
  drag.after = event.clientX >= rect.left + rect.width / 2;
  target.classList.add('drag-over');
  target.classList.toggle('drop-after', drag.after);
}
function initializeMarketTabs() {
  applyMarketTabOrder();
  marketTabs().forEach((button) => {
    button.addEventListener('click', () => { if (!ignoreMarketTabClick) setMarket(button.dataset.market); });
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      marketTabPointerDrag = { market: button.dataset.market, startX: event.clientX, startY: event.clientY, active: false, pointerId: event.pointerId, tab: button, target: null, after: false, ghost: null };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', (event) => {
      if (!marketTabPointerDrag || marketTabPointerDrag.pointerId !== event.pointerId) return;
      if (!marketTabPointerDrag.active && Math.hypot(event.clientX - marketTabPointerDrag.startX, event.clientY - marketTabPointerDrag.startY) < 6) return;
      if (!marketTabPointerDrag.active) {
        marketTabPointerDrag.active = true;
        marketTabPointerDrag.tab.classList.add('dragging');
        const ghost = marketTabPointerDrag.tab.cloneNode(true);
        ghost.classList.add('market-tab-drag-ghost');
        ghost.disabled = true;
        ghost.style.width = `${marketTabPointerDrag.tab.getBoundingClientRect().width}px`;
        document.body.append(ghost);
        marketTabPointerDrag.ghost = ghost;
      }
      updateMarketTabDragTarget(event);
    });
    button.addEventListener('pointerup', (event) => {
      if (!marketTabPointerDrag || marketTabPointerDrag.pointerId !== event.pointerId) return;
      const drag = marketTabPointerDrag;
      if (drag.active && drag.target) moveMarketTab(drag.market, drag.target, drag.after);
      clearMarketTabDragState();
    });
    button.addEventListener('pointercancel', clearMarketTabDragState);
    button.addEventListener('lostpointercapture', (event) => {
      if (marketTabPointerDrag?.pointerId === event.pointerId) clearMarketTabDragState();
    });
  });
}
function setMarket(market) {
  const tabs = [...document.querySelectorAll('.market-tabs button')];
  const activeTab = tabs.find((tab) => tab.dataset.market === market);
  if (!activeTab) return;
  state.market = market;
  tabs.forEach((tab) => tab.classList.toggle('active', tab === activeTab));
  render();
  if (state.market === 'index') refreshQuotes();
}
initializeMarketTabs();
function minimizeMainWindow() {
  return window.__TAURI__.core.invoke('minimize_main_window');
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.repeat && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    minimizeMainWindow().catch(console.error);
    return;
  }
  if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  if (document.querySelector('dialog[open]') || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  const tabs = [...document.querySelectorAll('.market-tabs button')];
  const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.dataset.market === state.market));
  const offset = event.key === 'ArrowLeft' ? -1 : 1;
  const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
  event.preventDefault();
  setMarket(tabs[nextIndex].dataset.market);
  tabs[nextIndex].focus();
});
$('#refresh-button').addEventListener('click', refreshQuotes); $('#add-button').addEventListener('click', openAssetSearch);
$('#edit-watchlist-button').addEventListener('click', openManageDialog);
$('#settings-button').addEventListener('click', openSettingsDialog);
$('#window-minimize').addEventListener('click', () => minimizeMainWindow().catch(console.error));
$('#window-maximize').addEventListener('click', async () => {
  try {
    const maximized = await window.__TAURI__.core.invoke('toggle_maximize_main_window');
    $('#window-maximize').title = maximized ? '还原窗口' : '最大化';
    $('#window-maximize').setAttribute('aria-label', $('#window-maximize').title);
  } catch (error) { console.error(error); }
});
$('#window-close').addEventListener('click', () => window.__TAURI__.core.invoke('close_main_window').catch(console.error));
function shortcutFromKeyboardEvent(event) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const key = event.code === 'Space' ? 'Space'
    : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
      : /^Digit\d$/.test(event.code) ? event.code.slice(5)
        : /^F\d{1,2}$/.test(event.code) ? event.code
          : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Tab', 'Enter'].includes(event.code) ? event.code
            : event.key.length === 1 ? event.key.toUpperCase() : null;
  if (!key) return null;
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean);
  return modifiers.length ? [...modifiers, key].join('+') : null;
}
$('#global-shortcut').addEventListener('keydown', (event) => {
  event.preventDefault();
  const shortcut = shortcutFromKeyboardEvent(event);
  const error = $('#global-shortcut-error');
  if (!shortcut) { error.textContent = '快捷键必须包含 Ctrl、Alt、Shift 或 Meta。'; error.hidden = false; return; }
  $('#global-shortcut').value = shortcut;
  error.hidden = true;
});
$('#reset-global-shortcut').addEventListener('click', () => { $('#global-shortcut').value = 'Ctrl+Space'; $('#global-shortcut-error').hidden = true; });
$('#market-index').addEventListener('change', () => {
  state.settings.marketIndex = $('#market-index').value;
  saveStorage('stocker:settings', state.settings);
  renderSummary();
  refreshQuotes();
});
$('#clear-watch-alerts').addEventListener('click', () => {
  watchAlertNotices = [];
  saveWatchAlertNotices();
  renderWatchAlertPanel();
});
window.addEventListener('stocker:open-settings', openSettingsDialog);
document.querySelectorAll('[data-dialog-dismiss]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$('#asset-search').addEventListener('input', queueAssetSearch);
$('#asset-market').addEventListener('change', searchAssets);
$('#clear-asset-search').addEventListener('click', () => { $('#asset-search').value = ''; searchAssets(); $('#asset-search').focus(); });
document.querySelectorAll('.manage-market-tabs button').forEach((button) => button.addEventListener('click', () => {
  state.manageMarket = button.dataset.manageMarket;
  state.manageSelected = managedItems()[0]?.symbol || null;
  renderManage();
}));
$('#move-watchlist-up').addEventListener('click', () => moveManagedStock(-1));
$('#move-watchlist-down').addEventListener('click', () => moveManagedStock(1));
$('#instrument-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const numberOrNull = (selector) => { const value = $(selector).value.trim(); return value === '' ? null : Number(value); };
  if (state.editingKind === 'index') {
    const index = MARKET_INDEX_DEFS.find((entry) => entry.symbol === state.editingSymbol);
    if (!index) return;
    state.settings.indexOverrides[state.editingSymbol] = {
      label: $('#instrument-label').value.trim(),
      costPrice: numberOrNull('#instrument-cost'),
      holdings: numberOrNull('#instrument-holdings'),
      alertThreshold: numberOrNull('#instrument-alert-threshold')
    };
    saveStorage('stocker:settings', state.settings);
    $('#instrument-dialog').close();
    render();
    refreshQuotes();
    return;
  }
  const item = state.watchlist.find((entry) => entry.symbol === state.editingSymbol);
  if (!item) return;
  item.label = $('#instrument-label').value.trim();
  item.costPrice = numberOrNull('#instrument-cost');
  item.holdings = numberOrNull('#instrument-holdings');
  item.alertThreshold = numberOrNull('#instrument-alert-threshold');
  saveWatchlist();
  $('#instrument-dialog').close();
  render();
  renderManage();
  refreshQuotes();
});
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const visibleColumns = [...document.querySelectorAll('input[name="visible-column"]:checked')].map((input) => input.value);
  const autoStart = $('#auto-start').checked;
  const globalShortcut = $('#global-shortcut').value.trim();
  const hideWindowFrame = $('#hide-window-frame').checked;
  const autoStartError = $('#auto-start-error');
  const globalShortcutError = $('#global-shortcut-error');
  const windowFrameError = $('#window-frame-error');
  autoStartError.hidden = true;
  globalShortcutError.hidden = true;
  windowFrameError.hidden = true;
  if (!globalShortcut) { globalShortcutError.textContent = '请按下一个包含修饰键的组合键。'; globalShortcutError.hidden = false; return; }
  if (globalShortcut !== state.settings.globalShortcut) {
    try { await setGlobalShortcut(globalShortcut); } catch (error) {
      globalShortcutError.textContent = `无法注册快捷键：${String(error)}`;
      globalShortcutError.hidden = false;
      return;
    }
  }
  if (hideWindowFrame !== Boolean(state.settings.hideWindowFrame)) {
    try { await setWindowDecorations(!hideWindowFrame); } catch (error) {
      windowFrameError.textContent = `无法更新窗框：${String(error)}`;
      windowFrameError.hidden = false;
      return;
    }
  }
  if (autoStart !== Boolean(state.settings.autoStart)) {
    try { await setAutoStart(autoStart); } catch (error) {
      autoStartError.textContent = `无法更新开机启动：${String(error)}`;
      autoStartError.hidden = false;
      return;
    }
  }
  state.settings.interval = Number($('#refresh-interval').value);
  state.settings.minimizeToTray = $('#minimize-to-tray').checked;
  state.settings.autoStart = autoStart;
  state.settings.hideWindowFrame = hideWindowFrame;
  state.settings.globalShortcut = globalShortcut;
  state.settings.quoteProvider = $('#stock-provider').value;
  state.settings.theme = $('#app-theme').value;
  state.settings.colorMode = document.querySelector('input[name="color-mode"]:checked').value;
  state.settings.namePinyin = $('#name-pinyin').checked;
  state.settings.watchThresholds = Object.fromEntries(['stock', 'etf', 'index'].map((category) => {
    const value = Number($(`#watch-threshold-${category}`).value);
    return [category, Number.isFinite(value) && value > 0 ? value : 0];
  }));
  state.settings.visibleColumns = visibleColumns.length ? visibleColumns : ['name'];
  saveStorage('stocker:settings', state.settings);
  applyDisplaySettings(); scheduleRefresh(); syncTrayBehavior(); render(); $('#settings-dialog').close();
});
renderMarketIndexOptions(); applyDisplaySettings(); render(); renderWatchAlertPanel(); renderLatestUpdateTime(); scheduleRefresh(); syncTrayBehavior(); setGlobalShortcut(state.settings.globalShortcut).catch(console.error); setWindowDecorations(!state.settings.hideWindowFrame).catch(console.error); refreshQuotes();
