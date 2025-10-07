import axios from 'axios';

const LOGOKIT_IMG_BASE = 'https://img.logokit.com';
// Use dev proxy to avoid CORS during local development
const LOGOKIT_API_BASE = process.env.NODE_ENV === 'development' ? '/logokit' : 'https://api.logokit.com';

export const LOGOKIT_PK: string = process.env.REACT_APP_LOGOKIT_PK || 'pk_fr7d058e3daf4d68ca8901';

export function buildLogoUrl(target: string, opts?: { fallback?: 'monogram' | 'monogram-light'; size?: number }): string {
  const safe = encodeURIComponent(String(target || '').trim());
  const params = new URLSearchParams();
  params.set('token', LOGOKIT_PK);
  if (opts?.fallback) params.set('fallback', opts.fallback);
  if (opts?.size) params.set('size', String(opts.size));
  return `${LOGOKIT_IMG_BASE}/${safe}?${params.toString()}`;
}

export function buildTickerLogoUrl(symbol: string, opts?: { fallback?: 'monogram' | 'monogram-light'; size?: number }): string {
  const sym = encodeURIComponent(String(symbol || '').trim().toUpperCase());
  const params = new URLSearchParams();
  params.set('token', LOGOKIT_PK);
  if (opts?.size) params.set('size', String(opts.size));
  return `${LOGOKIT_IMG_BASE}/ticker/${sym}?${params.toString()}`;
}

export function logoUrlFromNameOrSymbol(name?: string, symbol?: string): string {
  const target = (name || symbol || '').trim() || 'unknown';
  return buildLogoUrl(target, { fallback: 'monogram' });
}

export async function getLogoForSymbol(symbol: string, name?: string, kind?: 'stock' | 'etf'): Promise<string | undefined> {
  const sym = String(symbol || '').trim().toUpperCase();
  if (kind === 'stock') {
    return buildTickerLogoUrl(sym);
  }
  try {
    const resp = await axios.get(`${LOGOKIT_API_BASE}/brands`, {
      params: { symbol: sym },
      headers: { Authorization: `Bearer ${LOGOKIT_PK}` },
    });
    const data: any = resp?.data;
    const first = Array.isArray(data) ? data[0] : data;
    if (first) {
      if (typeof first.logo === 'string') return String(first.logo);
      if (typeof first.logo_url === 'string') return String(first.logo_url);
      const domain = first.domain || first.website || first.url;
      if (typeof domain === 'string' && domain) return buildLogoUrl(domain, { fallback: 'monogram' });
    }
  } catch {}
  return undefined;
}


