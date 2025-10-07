import axios from 'axios';

const BASE_URL = '/fd';
const API_KEY = process.env.REACT_APP_FINANCIALDATA_API_KEY || '69d88fba77fd52259be201d482e4cccf';

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  if (process.env.NODE_ENV === 'development') {
    config.params = { ...(config.params || {}), key: API_KEY };
  }
  return config;
});

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent?: number;
  volume?: number;
  dayLow?: number;
  dayHigh?: number;
  open?: number;
  previousClose?: number;
}

export interface DividendItem {
  symbol: string;
  amount: number;
  type?: string;
  declarationDate?: string;
  exDate?: string;
  recordDate?: string;
  paymentDate?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWithRetry<T = any>(path: string, params?: Record<string, any>, maxAttempts: number = 3): Promise<T> {
  let attempt = 0;
  let backoff = 300;
  while (true) {
    try {
      if (process.env.NODE_ENV === 'development') {
        const { data } = await api.get<T>(path, { params });
        return data as T;
      } else {
        // Use CORS proxy for production
        const queryParams = new URLSearchParams({ ...(params || {}), key: API_KEY });
        const fullUrl = `https://financialdata.net${path}?${queryParams.toString()}`;
        const { data } = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(fullUrl)}`);
        return data as T;
      }
    } catch (err: any) {
      if (err?.response?.status === 429 && attempt < maxAttempts - 1) {
        await sleep(backoff);
        backoff = Math.min(2000, backoff * 2);
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

function extractNameFromRow(row: any): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const candidates = [
    row.name,
    row.registrant_name,
    
  ];
  const found = candidates.find((v) => typeof v === 'string' && String(v).trim().length > 0);
  return found ? String(found).trim() : undefined;
}

function normalizeSymbol(sym: string | undefined | null): string {
  return String(sym || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function findNameInRows(rows: any[], symbol: string): string | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const want = normalizeSymbol(symbol);
  for (const r of rows) {
    const have = normalizeSymbol(r?.trading_symbol || r?.identifier || r?.symbol);
    if (!have) continue;
    if (have === want || have.startsWith(want) || want.startsWith(have)) {
      const nm = extractNameFromRow(r);
      if (nm) return nm;
    }
  }
  return undefined;
}

async function fetchPrices(symbol: string): Promise<any[]> {
  const attempts: Array<{ path: string; params: Record<string, any> }> = [];
  const paramKeys = ['identifier', 'trading_symbol', 'symbol', 'ticker'];
  for (const pk of paramKeys) attempts.push({ path: '/api/v1/stock-prices', params: { [pk]: symbol, limit: 2 } });
  for (const pk of paramKeys) attempts.push({ path: '/api/v1/etf-prices', params: { [pk]: symbol, limit: 2 } });
  for (const { path, params } of attempts) {
    try {
      const data = await getWithRetry<any[]>(path, params).catch(() => []);
      if (Array.isArray(data) && data.length > 0) return data;
    } catch {}
  }

  const MAX_SCAN_PAGES = 5;
  const PAGE = 500;
  async function scan(path: string): Promise<any[]> {
    const matches: any[] = [];
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const offset = page * PAGE;
      try {
        const rows = await getWithRetry<any[]>(path, { offset, limit: PAGE }).catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const r of rows) {
          const have = normalizeSymbol(r?.trading_symbol || r?.identifier || r?.symbol);
          if (have === normalizeSymbol(symbol)) matches.push(r);
        }
        if (rows.length < PAGE) break;
      } catch {}
    }
    const getDate = (r: any): number => {
      const raw = r?.trade_date || r?.date || r?.timestamp || r?.datetime || r?.as_of_date;
      const t = raw ? Date.parse(String(raw)) : 0;
      return Number.isFinite(t) ? t : 0;
    };
    matches.sort((a, b) => getDate(b) - getDate(a));
    return matches.slice(0, 2);
  }
  const etf = await scan('/api/v1/etf-prices');
  if (etf.length) return etf;
  const stk = await scan('/api/v1/stock-prices');
  if (stk.length) return stk;
  return [];
}

function pickNumber(row: any, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && v !== '') {
      const num = Number(v);
      if (!Number.isNaN(num)) return num;
    }
  }
  return undefined;
}

export async function getQuote(symbol: string): Promise<Quote> {
  const safeSymbol = (symbol || '').trim().toUpperCase();
  
  try {
    let arr: any[] = await fetchPrices(safeSymbol);
    if (arr.length === 0) {
      throw new Error(`No price data available for ${safeSymbol}`);
    }
    
    const latest: any = arr[0] || {};
    const prev: any = arr[1] || {};
    const price = pickNumber(latest, ['close', 'adj_close', 'price', 'last', 'last_price', 'nav']) ?? 0;
    const prevClose = pickNumber(prev, ['close', 'adj_close', 'price', 'last', 'last_price', 'nav']) ?? price;
    const change = price - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : undefined;
    
    let name: string | undefined = extractNameFromRow(latest) || extractNameFromRow(prev);
    if (!name) {
      try {
        name = await getSymbolName(safeSymbol);
      } catch {}
    }
    
    return {
      symbol: safeSymbol,
      name,
      price,
      change,
      changePercent,
      volume: pickNumber(latest, ['volume', 'vol']) ?? undefined,
      dayLow: pickNumber(latest, ['low', 'day_low', 'nav_low']) ?? undefined,
      dayHigh: pickNumber(latest, ['high', 'day_high', 'nav_high']) ?? undefined,
      open: pickNumber(latest, ['open', 'nav_open']) ?? undefined,
      previousClose: prevClose,
    };
  } catch (error) {
    console.error(`Error getting quote for ${safeSymbol}:`, error);
    throw error;
  }
}

const financialDataApi = { getQuote };
export default financialDataApi;

const symbolNameCache: Record<string, string> = {};

let cachedUniverse: Array<{ symbol: string; name: string; kind: 'stock' | 'etf' }> | null = null;
const UNIVERSE_LS_KEY = 'fd_symbol_universe_v1';
const PAGE_SIZE = 500;

async function getSymbolName(symbol: string): Promise<string | undefined> {
  if (symbolNameCache[symbol]) return symbolNameCache[symbol];
  
  if (!cachedUniverse) {
    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(UNIVERSE_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) {
            cachedUniverse = parsed;
          }
        }
      }
    } catch {}
  }
  
  if (cachedUniverse && cachedUniverse.length > 0) {
    const found = cachedUniverse.find(item => item.symbol === symbol);
    if (found?.name) {
      symbolNameCache[symbol] = found.name;
      return found.name;
    }
  }
  
  if (!cachedUniverse || cachedUniverse.length === 0) {
    try {
      const uni = await loadSymbolUniverse();
      const found = uni.find(item => item.symbol === symbol && item.name);
      if (found?.name) {
        symbolNameCache[symbol] = found.name;
        return found.name;
      }
    } catch {}
  }
  try {
    const [stocksA, stocksB, stocksC, stocksD] = await Promise.all([
      getWithRetry<any[]>('/api/v1/stock-symbols', { identifier: symbol, limit: 5 }).catch(() => []),
      getWithRetry<any[]>('/api/v1/stock-symbols', { trading_symbol: symbol, limit: 5 }).catch(() => []),
      getWithRetry<any[]>('/api/v1/stock-symbols', { q: symbol, limit: 5 }).catch(() => []),
      getWithRetry<any[]>('/api/v1/stock-symbols', { search: symbol, limit: 5 }).catch(() => []),
    ]);
    const stocks = [stocksA, stocksB, stocksC, stocksD].find((x) => Array.isArray(x) && x.length > 0) || [];
    
    const stockName = findNameInRows(stocks as any[], symbol);
    if (stockName) { symbolNameCache[symbol] = stockName; return stockName; }
  } catch {}
  
  try {
    const [etfsA, etfsB, etfsC, etfsD] = await Promise.all([
      getWithRetry<any[]>('/api/v1/etf-symbols', { identifier: symbol, limit: 5 }).catch(() => []),
      getWithRetry<any[]>('/api/v1/etf-symbols', { trading_symbol: symbol, limit: 5 }).catch(() => []),
      getWithRetry<any[]>('/api/v1/etf-symbols', { q: symbol, limit: 5 }).catch(() => []),
      getWithRetry<any[]>('/api/v1/etf-symbols', { search: symbol, limit: 5 }).catch(() => []),
    ]);
    const etfs = [etfsA, etfsB, etfsC, etfsD].find((x) => Array.isArray(x) && x.length > 0) || [];
    
    const etfName = findNameInRows(etfs as any[], symbol);
    if (etfName) { symbolNameCache[symbol] = etfName; return etfName; }
  } catch {}
  
  return undefined;
}

export async function getDividends(symbol: string, limit: number = 20): Promise<DividendItem[]> {
  const safeSymbol = (symbol || '').trim().toUpperCase();
  
  try {
    const data = await getWithRetry<any[]>('/api/v1/dividends', { identifier: safeSymbol, limit });
    const arr: any[] = Array.isArray(data) ? data : [];
    return arr.map((d) => ({
      symbol: String(d.trading_symbol || safeSymbol).toUpperCase(),
      amount: Number(d.amount ?? 0),
      type: d.type,
      declarationDate: d.declaration_date,
      exDate: d.ex_date,
      recordDate: d.record_date,
      paymentDate: d.payment_date,
    }));
  } catch (error) {
    console.error(`Error getting dividends for ${safeSymbol}:`, error);
    return [];
  }
}

export async function loadSymbolUniverse(): Promise<Array<{ symbol: string; name: string; kind: 'stock' | 'etf' }>> {
  if (cachedUniverse) return cachedUniverse;
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(UNIVERSE_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          cachedUniverse = parsed;
          return parsed;
        }
      }
    }
  } catch {}
  const out: Array<{ symbol: string; name: string; kind: 'stock' | 'etf' }> = [];
  const seen = new Set<string>();
  let offset = 0;
  let pagesFetched = 0;
  const MAX_PAGES = 10; 

  async function fetchStockSymbolsPage(off: number): Promise<any[]> {
    const tries = [
      getWithRetry<any[]>('/api/v1/stock-symbols', { offset: off, limit: PAGE_SIZE }),
      getWithRetry<any[]>('/api/v1/stock-symbols', { start: off, limit: PAGE_SIZE }),
      getWithRetry<any[]>('/api/v1/stock-symbols', { offset: off, page_size: PAGE_SIZE }),
    ];
    for (const p of tries) {
      try { const d = await p; if (Array.isArray(d) && d.length) return d; } catch {}
    }
    return [] as any[];
  }

  async function fetchEtfSymbolsPage(off: number): Promise<any[]> {
    const tries = [
      getWithRetry<any[]>('/api/v1/etf-symbols', { offset: off, limit: PAGE_SIZE }),
      getWithRetry<any[]>('/api/v1/etf-symbols', { start: off, limit: PAGE_SIZE }),
      getWithRetry<any[]>('/api/v1/etf-symbols', { offset: off, page_size: PAGE_SIZE }),
    ];
    for (const p of tries) {
      try { const d = await p; if (Array.isArray(d) && d.length) return d; } catch {}
    }
    return [] as any[];
  }

  while (pagesFetched < MAX_PAGES) { 
    const [stocks, etfs] = await Promise.all([
      fetchStockSymbolsPage(offset),
      fetchEtfSymbolsPage(offset),
    ]);
    if (Array.isArray(stocks)) {
      for (const r of stocks) {
        const sym = String(r.trading_symbol || '').toUpperCase();
        if (!sym) continue;
        if (!seen.has(sym)) { seen.add(sym); out.push({ symbol: sym, name: r.registrant_name || '', kind: 'stock' }); }
      }
    }
    if (Array.isArray(etfs)) {
      for (const r of etfs) {
        const sym = String(r.trading_symbol || '').toUpperCase();
        if (!sym) continue;
        if (!seen.has(sym)) { seen.add(sym); out.push({ symbol: sym, name: r.description || '', kind: 'etf' }); }
      }
    }
    const stocksLen = Array.isArray(stocks) ? stocks.length : 0;
    const etfsLen = Array.isArray(etfs) ? etfs.length : 0;
    if (stocksLen < PAGE_SIZE && etfsLen < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    pagesFetched += 1;
  }
  cachedUniverse = out;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UNIVERSE_LS_KEY, JSON.stringify(out));
    }
  } catch {}
  return out;
}

export interface SearchResult { symbol: string; name: string; kind: 'stock' | 'etf' }

export async function searchSymbols(
  query: string,
  sortBy: 'symbol' | 'name' = 'symbol',
  direction: 'asc' | 'desc' = 'asc',
  startsWith?: string,
  kind: 'all' | 'stock' | 'etf' = 'all'
): Promise<SearchResult[]> {
  const universe = await loadSymbolUniverse();
  const q = query.trim().toLowerCase();
  const prefix = (startsWith || '').trim().toLowerCase();
  let filtered = universe;
  if (kind !== 'all') {
    filtered = filtered.filter(r => r.kind === kind);
  }
  if (prefix) {
    filtered = filtered.filter(r => {
      const target = (sortBy === 'name' ? r.name : r.symbol) || '';
      return String(target).trim().toLowerCase().startsWith(prefix);
    });
  }
  if (q) {
    filtered = filtered.filter(r => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }
  filtered.sort((a, b) => {
    const av = (a as any)[sortBy] || '';
    const bv = (b as any)[sortBy] || '';
    const cmp = String(av).localeCompare(String(bv));
    return direction === 'asc' ? cmp : -cmp;
  });
  return filtered;
}


