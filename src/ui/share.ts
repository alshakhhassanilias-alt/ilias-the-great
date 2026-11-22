/**
 * A result card you can share: drawn as an SVG (no external images, no fonts to download), turned into a PNG, then
 * handed to the system share sheet (phones) or downloaded (desktops).
 */
export interface CardSpec { kicker: string; title: string; big: string; stars?: number; lines: string[]; foot: string; color?: string; won?: boolean }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function cardSvg(c: CardSpec): string {
  const W = 1200, H = 630;
  const gold = c.won === false ? '#ff8d77' : '#ffd86b';
  const stars = c.stars !== undefined ? [0, 1, 2].map((i) => `<text x="${W / 2 - 90 + i * 90}" y="350" font-size="86" text-anchor="middle" fill="${i < (c.stars ?? 0) ? gold : 'rgba(255,255,255,.15)'}">★</text>`).join('') : '';
  const lines = c.lines.slice(0, 4).map((l, i) => `<text x="${W / 2}" y="${c.stars !== undefined ? 420 + i * 40 : 360 + i * 44}" font-size="28" text-anchor="middle" fill="#d8ccb0">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="${c.color ?? '#5a3d12'}" stop-opacity=".9"/><stop offset="1" stop-color="#0d0b08"/></radialGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dd94"/><stop offset=".5" stop-color="#d3a54a"/><stop offset="1" stop-color="#9a6c21"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="url(#b)" stroke-width="3" rx="18"/>
  <rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="rgba(245,218,143,.25)" stroke-width="1" rx="12"/>
  <text x="${W / 2}" y="96" font-family="Georgia, serif" font-size="26" letter-spacing="8" text-anchor="middle" fill="#d6ab52">${esc(c.kicker.toUpperCase())}</text>
  <text x="${W / 2}" y="170" font-family="Georgia, serif" font-size="62" font-weight="700" text-anchor="middle" fill="#fbf0d6">${esc(c.title)}</text>
  <text x="${W / 2}" y="255" font-family="Georgia, serif" font-size="54" font-weight="700" letter-spacing="6" text-anchor="middle" fill="${gold}">${esc(c.big)}</text>
  ${stars}
  <g font-family="Georgia, serif">${lines}</g>
  <text x="${W / 2}" y="${H - 52}" font-family="Georgia, serif" font-size="22" letter-spacing="4" text-anchor="middle" fill="#8b7f64">${esc(c.foot)}</text>
</svg>`;
}

export async function cardPng(c: CardSpec): Promise<Blob> {
  const svg = new Blob([cardSvg(c)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svg);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('card')); img.src = url; });
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 630;
    cv.getContext('2d')!.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/** Share the card (system share sheet where there is one), or download it. Returns what happened. */
export async function shareCard(c: CardSpec, name: string, text: string): Promise<'shared' | 'saved' | 'failed'> {
  try {
    const blob = await cardPng(c);
    const file = new File([blob], `${name}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text, title: 'World Order' }); return 'shared'; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'saved';
  } catch { return 'failed'; }
}
