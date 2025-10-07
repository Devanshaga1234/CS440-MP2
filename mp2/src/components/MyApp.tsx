import { BrowserRouter, Routes, Route, NavLink, useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { searchSymbols, type SearchResult, getQuote, getDividends } from '../api/financialDataApi';
import { getLogoForSymbol } from '../api/logoApi';
import './MyApp.css';

const Header: React.FC = () => (
  <header className="header">
    <NavLink to="/" className="headerTitle">
      <h1>Market Explorer: Stocks & ETFs Directory</h1>
    </NavLink>
  </header>
);

const NavTabs: React.FC = () => (
  <nav className="nav">
    <NavLink to="/" className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : ''} end>Home</NavLink>
    <NavLink to="/list" className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : ''}>List</NavLink>
    <NavLink to="/gallery" className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : ''}>Gallery</NavLink>
  </nav>
);

 

const HomePage: React.FC = () => {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<any | null>(null);

  const fetchData = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    try {
      const [q, divs] = await Promise.all([getQuote(sym), getDividends(sym, 1)]);
      setQuote({ ...q, dividend: divs?.[0] });
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch');
      setQuote(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page homePage">
      <NavTabs />
      <div className="searchBar">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') fetchData(); }}
          placeholder="Search by symbol or name"
        />
        <button onClick={fetchData}>Search</button>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p>{error}</p>}
      {quote && (
        <div className="detailCard">
          <div className="detailHeader">
            <div className="detailSymbol">{quote.symbol}</div>
            {quote.name && <div className="detailName">{quote.name}</div>}
          </div>
          <div className="detailGrid oneCol">
            <div className="detailStat"><span className="label">Price</span><span className="value">${quote.price?.toFixed?.(2) ?? quote.price}</span></div>
            <div className="detailStat"><span className="label">Change</span><span className="value">{quote.change >= 0 ? '+' : ''}{quote.change?.toFixed?.(2) ?? quote.change} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent?.toFixed?.(2) ?? quote.changePercent}%)</span></div>
            <div className="detailStat"><span className="label">Volume</span><span className="value">{quote.volume?.toLocaleString?.() ?? quote.volume}</span></div>
            <div className="detailStat"><span className="label">Low</span><span className="value">${quote.dayLow?.toFixed?.(2) ?? quote.dayLow}</span></div>
            <div className="detailStat"><span className="label">High</span><span className="value">${quote.dayHigh?.toFixed?.(2) ?? quote.dayHigh}</span></div>
            <div className="detailStat"><span className="label">Open</span><span className="value">${quote.open?.toFixed?.(2) ?? quote.open}</span></div>
            <div className="detailStat"><span className="label">Close</span><span className="value">${quote.previousClose?.toFixed?.(2) ?? quote.previousClose}</span></div>
            {quote.dividend && (
              <div className="detailStat"><span className="label">Dividend</span><span className="value">${quote.dividend.amount?.toFixed?.(2) ?? quote.dividend.amount}</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const GalleryPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<string>(searchParams.get('q') || '');
  const [sortBy, setSortBy] = useState<'symbol' | 'name'>('symbol');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState<string>('');
  const [kind, setKind] = useState<'all' | 'stock' | 'etf'>('all');

  useEffect(() => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (query) p.set('q', query); else p.delete('q');
      return p;
    }, { replace: true });
  }, [query, setSearchParams]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await searchSymbols(query, sortBy, direction, prefix, kind);
        if (alive) setResults(data);
        if (alive) setBrokenLogos({});
        Promise.all(
          data.slice(0, 120).map(async (r) => ({ sym: r.symbol, url: await getLogoForSymbol(r.symbol, r.name, r.kind) }))
        ).then((pairs) => {
          if (!alive) return;
          const map: Record<string, string> = {};
          for (const p of pairs) if (p.url) map[p.sym] = p.url as string;
          setLogos(map);
        }).catch(() => {});
      } catch (e: any) {
        if (alive) setError(e?.message || 'Search failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [query, sortBy, direction, prefix, kind]);

  const onToggleDirection = () => setDirection(d => (d === 'asc' ? 'desc' : 'asc'));

  return (
    <div className="page listPage">
      <NavTabs />
      <div className="searchBar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by symbol or name" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'symbol' | 'name')}>
          <option value="symbol">Symbol</option>
          <option value="name">Name</option>
        </select>
        <button onClick={onToggleDirection} aria-label="toggle sort direction">{direction === 'asc' ? 'Asc' : 'Desc'}</button>
        <select value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          <option value="">All</option>
          {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map(ch => (
            <option key={ch} value={ch}>{ch}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'all' | 'stock' | 'etf')}>
          <option value="all">All Types</option>
          <option value="stock">Stock</option>
          <option value="etf">ETF</option>
        </select>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p>{error}</p>}
      <div className="gallery">
        {results.map((r) => (
          <div key={r.symbol} className="galleryCard" onClick={() => {
            const p = new URLSearchParams();
            p.set('src', 'gallery');
            if (query) p.set('q', query);
            p.set('sort', sortBy);
            p.set('dir', direction);
            if (prefix) p.set('prefix', prefix);
            p.set('kind', kind);
            navigate(`/detail/${r.symbol}?${p.toString()}`);
          }}>
            <div className="cardHeader">
              <span className="cardBadge">{r.kind.toUpperCase()}</span>
            </div>
            <div className="cardContent">
              {logos[r.symbol] && !brokenLogos[r.symbol] ? (
                <img
                  className="cardLogo"
                  src={logos[r.symbol]}
                  alt={`${r.symbol} logo`}
                  loading="lazy"
                  decoding="async"
                  onError={() => setBrokenLogos((m) => ({ ...m, [r.symbol]: true }))}
                />
              ) : (
                <div className="logoFallback">
                  <span>{r.symbol}</span>
                </div>
              )}
              <div className="cardSymbol">{r.symbol}</div>
              <div className="cardName">{r.name}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState<string>(searchParams.get('q') || '');
  const [sortBy, setSortBy] = useState<'symbol' | 'name'>('symbol');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState<string>('');
  const [kind, setKind] = useState<'all' | 'stock' | 'etf'>('all');

  useEffect(() => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (query) p.set('q', query); else p.delete('q');
      return p;
    }, { replace: true });
  }, [query, setSearchParams]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await searchSymbols(query, sortBy, direction, prefix, kind);
        if (alive) setResults(data);
        if (alive) setBrokenLogos({});
        Promise.all(data.slice(0, 120).map(async (r) => ({ sym: r.symbol, url: await getLogoForSymbol(r.symbol, r.name, r.kind) })))
          .then((pairs) => {
            if (!alive) return;
            const map: Record<string, string> = {};
            for (const p of pairs) if (p.url) map[p.sym] = p.url as string;
            setLogos(map);
          }).catch(() => {});
      } catch (e: any) {
        if (alive) setError(e?.message || 'Search failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [query, sortBy, direction, prefix, kind]);

  const onToggleDirection = () => setDirection(d => (d === 'asc' ? 'desc' : 'asc'));

  return (
    <div className="page">
      <NavTabs />
      <div className="searchBar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by symbol or name" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'symbol' | 'name')}>
          <option value="symbol">Symbol</option>
          <option value="name">Name</option>
        </select>
        <button onClick={onToggleDirection} aria-label="toggle sort direction">{direction === 'asc' ? 'Asc' : 'Desc'}</button>
        <select value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          <option value="">All</option>
          {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map(ch => (
            <option key={ch} value={ch}>{ch}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'all' | 'stock' | 'etf')}>
          <option value="all">All Types</option>
          <option value="stock">Stock</option>
          <option value="etf">ETF</option>
        </select>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p>{error}</p>}
      {!loading && !error && (
        <>
          <div className="listHeader">
            <span className="headerLogo">Logo</span>
            <span className="headerType">Type</span>
            <span className="headerTicker">Ticker</span>
            <span className="headerName">Name</span>
          </div>
          <ul className="list">
            {results.map((r) => (
              <li key={r.symbol} className="listItem" onClick={() => {
                const p = new URLSearchParams();
                p.set('src', 'list');
                if (query) p.set('q', query);
                p.set('sort', sortBy);
                p.set('dir', direction);
                if (prefix) p.set('prefix', prefix);
                p.set('kind', kind);
                navigate(`/detail/${r.symbol}?${p.toString()}`);
              }}>
                <span className="logoCell">
                  {logos[r.symbol] && !brokenLogos[r.symbol] ? (
                    <img className="inlineLogo" src={logos[r.symbol]} alt="" loading="lazy" decoding="async" onError={() => setBrokenLogos((m) => ({ ...m, [r.symbol]: true }))} />
                  ) : (
                    <span className="inlineLogoBox">{r.symbol}</span>
                  )}
                </span>
                <span className="badge">{r.kind.toUpperCase()}</span>
                <span className="symbol">{r.symbol}</span>
                <span className="name">{r.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

const DetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { symbol = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<any | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(undefined);
  const [prevNext, setPrevNext] = useState<{ prev?: string; next?: string; current?: { name?: string; kind?: 'stock' | 'etf' } }>({});

  useEffect(() => {
    let alive = true;
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [q, divs] = await Promise.all([getQuote(sym), getDividends(sym, 1)]);
        if (alive) setQuote({ ...q, dividend: divs?.[0] });
      } catch (e: any) {
        if (alive) setError(e?.message || 'Failed to fetch');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [symbol]);

  useEffect(() => {
    let alive = true;
    const sym = String(symbol || '').trim().toUpperCase();
    const q = searchParams.get('q') || '';
    const sortBy = (searchParams.get('sort') as 'symbol' | 'name') || 'symbol';
    const dir = (searchParams.get('dir') as 'asc' | 'desc') || 'asc';
    const prefix = searchParams.get('prefix') || '';
    const kind = (searchParams.get('kind') as 'all' | 'stock' | 'etf') || 'all';
    (async () => {
      const results = await searchSymbols(q, sortBy, dir, prefix, kind);
      const idx = results.findIndex(r => r.symbol === sym);
      const prev = idx > 0 ? results[idx - 1].symbol : undefined;
      const next = idx >= 0 && idx < results.length - 1 ? results[idx + 1].symbol : undefined;
      const me = idx >= 0 ? results[idx] : undefined;
      if (!alive) return;
      setPrevNext({ prev, next, current: me ? { name: me.name, kind: me.kind } : undefined });
      const logo = await getLogoForSymbol(sym, me?.name, me?.kind);
      if (!alive) return;
      setLogoUrl(logo);
    })();
    return () => { alive = false; };
  }, [symbol, searchParams]);

  const onBackToList = () => navigate('/list');
  const onBackToGallery = () => navigate('/gallery');

  const renderUnavailable = () => (
    <div className="detailCard">
      <div className="detailHeader">
        <div className="detailSymbol">{String(symbol).toUpperCase()}</div>
        {quote?.name && <div className="detailName">{quote.name}</div>}
      </div>
      <div className="detailBody">
        <p>Sorry, data unavailable.</p>
      </div>
    </div>
  );

  return (
    <div className="page detailPage">
      <NavTabs />
      <div className="detailActions">
        <button onClick={onBackToList}>Back to List</button>
        <button onClick={onBackToGallery}>Back to Gallery</button>
        <button disabled={!prevNext.prev} onClick={() => prevNext.prev && navigate(`/detail/${prevNext.prev}?${searchParams.toString()}`)}>Previous</button>
        <button disabled={!prevNext.next} onClick={() => prevNext.next && navigate(`/detail/${prevNext.next}?${searchParams.toString()}`)}>Next</button>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p>{error}</p>}
      {!loading && !error && (
        quote ? (
          <div className="detailCard">
            <div className="detailHeader">
              {logoUrl ? (
                <img className="detailLogo" src={logoUrl} alt="" />
              ) : (
                <div className="logoFallback"><span>{quote.symbol}</span></div>
              )}
              <div className="detailSymbol">{quote.symbol}</div>
              {quote.name && <div className="detailName">{quote.name}</div>}
            </div>
            <div className="detailGrid">
              <div className="detailStat"><span className="label">Price</span><span className="value">${quote.price?.toFixed?.(2) ?? quote.price}</span></div>
              <div className="detailStat"><span className="label">Change</span><span className="value">{quote.change >= 0 ? '+' : ''}{quote.change?.toFixed?.(2) ?? quote.change} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent?.toFixed?.(2) ?? quote.changePercent}%)</span></div>
              <div className="detailStat"><span className="label">Volume</span><span className="value">{quote.volume?.toLocaleString?.() ?? quote.volume}</span></div>
              <div className="detailStat"><span className="label">Low</span><span className="value">${quote.dayLow?.toFixed?.(2) ?? quote.dayLow}</span></div>
              <div className="detailStat"><span className="label">High</span><span className="value">${quote.dayHigh?.toFixed?.(2) ?? quote.dayHigh}</span></div>
              <div className="detailStat"><span className="label">Open</span><span className="value">${quote.open?.toFixed?.(2) ?? quote.open}</span></div>
              <div className="detailStat"><span className="label">Close</span><span className="value">${quote.previousClose?.toFixed?.(2) ?? quote.previousClose}</span></div>
              {quote.dividend && (
                <div className="detailStat"><span className="label">Dividend</span><span className="value">${quote.dividend.amount?.toFixed?.(2) ?? quote.dividend.amount}</span></div>
              )}
            </div>
          </div>
        ) : (
          renderUnavailable()
        )
      )}
    </div>
  );
};

const MyApp: React.FC = () => (
  <BrowserRouter basename="/CS440-MP2">
    <div className="container">
      <Header />
      <main className="main">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/list" element={<ListPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/detail/:symbol" element={<DetailPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>
    </div>
  </BrowserRouter>
);

export default MyApp;
