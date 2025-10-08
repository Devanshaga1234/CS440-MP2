import axios from 'axios';

const BASE_URL = '/fd';
const API_KEY = '11bae4eeb55a588482a49856b5fa63c6';

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

  const MAX_SCAN_PAGES = 200;
  const PAGE = 1000;
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
const UNIVERSE_LS_KEY = 'fd_symbol_universe_v10_sequential';

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
 
  async function fetchAllStocks(): Promise<any[]> {
    const allStocks: any[] = [];
    let page = 0;
    const limit = 1000;
    while (page < 100) {
      try {
        const data = await getWithRetry<any[]>('/api/v1/stock-symbols', { offset: page * limit, limit });
        if (!Array.isArray(data) || data.length === 0) break;
        allStocks.push(...data);
        console.log(`Loaded stocks page ${page + 1}: ${data.length} stocks. Total stocks: ${allStocks.length}`);
        if (data.length < limit) break;
        page++;
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        break;
      }
    }
    return allStocks;
  }

  async function fetchAllEtfs(): Promise<any[]> {
    const allEtfs: any[] = [];
    let page = 0;
    const limit = 1000;
    while (page < 100) {
      try {
        const data = await getWithRetry<any[]>('/api/v1/etf-symbols', { offset: page * limit, limit });
        if (!Array.isArray(data) || data.length === 0) break;
        allEtfs.push(...data);
        console.log(`Loaded ETFs page ${page + 1}: ${data.length} ETFs. Total ETFs: ${allEtfs.length}`);
        if (data.length < limit) break;
        page++;
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        break;
      }
    }
    return allEtfs;
  }

  const [stocks, etfs] = await Promise.all([fetchAllStocks(), fetchAllEtfs()]);
  
  console.log(`Processing ${stocks.length} stocks and ${etfs.length} ETFs`);
  
  let stockCount = 0;
  for (const r of stocks) {
    const sym = String(r.trading_symbol || r.symbol || r.ticker || '').toUpperCase();
    if (!sym || sym.length < 1 || sym.length > 10) continue;
    const name = r.registrant_name || r.name || r.company_name || r.description || '';
    if (!seen.has(sym)) { 
      seen.add(sym); 
      out.push({ symbol: sym, name: String(name), kind: 'stock' }); 
      stockCount++;
    }
  }
  
  let etfCount = 0;
  for (const r of etfs) {
    const sym = String(r.trading_symbol || r.symbol || r.ticker || '').toUpperCase();
    if (!sym || sym.length < 1 || sym.length > 10) continue;
    const name = r.description || r.name || r.fund_name || r.registrant_name || '';
    if (!seen.has(sym)) { 
      seen.add(sym); 
      out.push({ symbol: sym, name: String(name), kind: 'etf' }); 
      etfCount++;
    }
  }
  
  cachedUniverse = out;
  console.log(`Finished loading symbols. Total: ${out.length} symbols (${stockCount} stocks, ${etfCount} ETFs)`);
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
    
    filtered.sort((a, b) => {
      const aSymbol = a.symbol.toLowerCase();
      const bSymbol = b.symbol.toLowerCase();
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      
      if (aSymbol === q && bSymbol !== q) return -1;
      if (bSymbol === q && aSymbol !== q) return 1;
      
      if (aSymbol.startsWith(q) && !bSymbol.startsWith(q)) return -1;
      if (bSymbol.startsWith(q) && !aSymbol.startsWith(q)) return 1;
      
      if (aName === q && bName !== q) return -1;
      if (bName === q && aName !== q) return 1;
      
      if (aName.startsWith(q) && !bName.startsWith(q)) return -1;
      if (bName.startsWith(q) && !aName.startsWith(q)) return 1;
      
      const av = (a as any)[sortBy] || '';
      const bv = (b as any)[sortBy] || '';
      const cmp = String(av).localeCompare(String(bv));
      return direction === 'asc' ? cmp : -cmp;
    });
  } else {
    filtered.sort((a, b) => {
      const av = (a as any)[sortBy] || '';
      const bv = (b as any)[sortBy] || '';
      const cmp = String(av).localeCompare(String(bv));
      return direction === 'asc' ? cmp : -cmp;
    });
  }
  return filtered;
}


