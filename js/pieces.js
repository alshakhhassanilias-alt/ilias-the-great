// Chess pieces as SVG, drawn for this app. Text glyphs (♟ etc.) are unreliable: phones show
// the pawn as a black emoji whatever colour it is given, so white pawns came out black.
//
// Each piece sits in a 100x100 box. `body` is filled with the side's colour; `detail` marks
// (eye, mitre slit) use the contrasting colour.

const BASE = '<rect x="22" y="78" width="56" height="12" rx="5"/>';

const SHAPES = {
  p: {
    body: `<circle cx="50" cy="29" r="13"/>
      <path d="M37 46h26l-2 5h-22z"/>
      <path d="M41 51h18c0 9 5 17 10 27H31c5-10 10-18 10-27z"/>${BASE}`,
  },
  r: {
    body: `<path d="M28 16h9v8h7v-8h12v8h7v-8h9v20H28z"/>
      <path d="M33 39h34l-3 39H36z"/>${BASE}`,
  },
  n: {
    body: `<path d="M70 78H33c1-10 6-18 15-24 2-2 1-4-1-4-6 1-11 4-16 8-4-1-8-4-8-9 0-4 3-8 7-12 5-6 9-12 10-19l3-6 6 7c14 1 26 10 29 26 2 12-1 23-8 33z"/>${BASE}`,
    detail: '<circle cx="42" cy="34" r="3.2"/>',
  },
  b: {
    body: `<circle cx="50" cy="13" r="6"/>
      <path d="M50 19c13 9 17 23 11 35H39c-6-12-2-26 11-35z"/>
      <path d="M36 56h28l-2 5H38z"/>
      <path d="M40 61h20c1 7 4 12 8 17H32c4-5 7-10 8-17z"/>${BASE}`,
    detail: '<path d="M55 29l-9 12" stroke-width="3.4" stroke-linecap="round" fill="none"/>',
  },
  q: {
    body: `<circle cx="20" cy="26" r="5.5"/><circle cx="35" cy="17" r="5.5"/><circle cx="50" cy="13" r="5.5"/>
      <circle cx="65" cy="17" r="5.5"/><circle cx="80" cy="26" r="5.5"/>
      <path d="M20 30l12 30h36l12-30-14 14-6-24-10 22-10-22-6 24z"/>
      <path d="M31 62h38l-2 5H33z"/>
      <path d="M35 67h30l5 11H30z"/>${BASE}`,
  },
  k: {
    body: `<path d="M47 5h6v7h7v6h-7v8h-6v-8h-7v-6h7z"/>
      <path d="M50 27c14 0 22 6 22 14 0 8-7 14-10 20H38c-3-6-10-12-10-20 0-8 8-14 22-14z"/>
      <path d="M33 62h34l-2 5H35z"/>
      <path d="M37 67h26l5 11H32z"/>${BASE}`,
  },
};

const COLOURS = {
  w: { fill: '#fbfaf6', stroke: '#1f2023', detail: '#1f2023' },
  b: { fill: '#2a2b30', stroke: '#0c0c0e', detail: '#e9e7df' },
};

// The inside of one piece's SVG (no <svg> wrapper), for use inside a board or an icon.
export function pieceShape(type, color) {
  const s = SHAPES[type], c = COLOURS[color];
  return `<g fill="${c.fill}" stroke="${c.stroke}" stroke-width="3.2" stroke-linejoin="round">${s.body}</g>` +
    (s.detail ? `<g fill="${c.detail}" stroke="${c.detail}">${s.detail}</g>` : '');
}

// A standalone piece icon.
export function pieceIcon(type, color, size = 40) {
  return `<svg class="piece-icon" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${pieceShape(type, color)}</svg>`;
}
