// Minimal stroke icon set (24x24, currentColor) so the HUD never depends on emoji fonts.
const wrap = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS = {
  logo: wrap('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  meteor: wrap('<circle cx="8.5" cy="15.5" r="4.5"/><path d="M12 12l8-8M14 15l6-4M9 10l4-7"/>'),
  plague: wrap('<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8V4.5M14 13.3l4.6 2.6M10 13.3l-4.6 2.6"/><path d="M8.2 5.6a6 6 0 0 1 7.6 0M19.3 13.6a6 6 0 0 1-3.8 6.6M4.7 13.6a6 6 0 0 0 3.8 6.6"/>'),
  oasis: wrap('<path d="M12 21c-4 0-6.5-2.5-6.5-6 0-4 6.5-11 6.5-11s6.5 7 6.5 11c0 3.5-2.5 6-6.5 6z"/><path d="M9.5 15.5c.4 1.4 1.4 2.3 2.8 2.5"/>'),
  dna: wrap('<path d="M7 3c0 6 10 6 10 12s-10 6-10 6"/><path d="M17 3c0 6-10 6-10 12M9 6.5h6M8 11h8M9 17.5h6"/>'),
  spawn: wrap('<circle cx="9" cy="9" r="3.5"/><circle cx="16" cy="15" r="2.5"/><circle cx="8" cy="17" r="1.5"/><path d="M18 4v4M16 6h4"/>'),
  eye: wrap('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  pause: wrap('<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>'),
  sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: wrap('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  cloud: wrap('<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.5 4.3 4.3 0 0 0 7 18z"/>'),
  rain: wrap('<path d="M7 14h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 5.5 4.3 4.3 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>'),
  storm: wrap('<path d="M7 13h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 4.5 4.3 4.3 0 0 0 7 13z"/><path d="M12.5 13l-2.5 4h3.5l-2 4"/>'),
  snow: wrap('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5"/>'),
  heat: wrap('<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>'),
  leaf: wrap('<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l7-7"/>'),
  people: wrap('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M14.5 14.3c2.6-.4 5 .9 5.8 4.2"/>'),
  flag: wrap('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  brain: wrap('<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.2A3 3 0 0 0 7 17.5a2.5 2.5 0 0 0 5 .5V5.5A2.2 2.2 0 0 0 9 4.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.2 3 3 0 0 1-2.5 4.8 2.5 2.5 0 0 1-5 .5"/>'),
  skull: wrap('<path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4 2.5 5v3h9v-3c1.3-1 2.5-2.6 2.5-5a7 7 0 0 0-7-7z"/><circle cx="9.3" cy="11" r="1.4"/><circle cx="14.7" cy="11" r="1.4"/><path d="M10.5 18v2M13.5 18v2"/>'),
  swords: wrap('<path d="M4 4l9 9M4 4v3.5M4 4h3.5M20 4l-9 9M20 4v3.5M20 4h-3.5M8 16l-3 3M16 16l3 3M7 14l3 3M17 14l-3 3"/>'),
  trade: wrap('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  target: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  sparkle: wrap('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  chart: wrap('<path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/>'),
  scroll: wrap('<path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7"/><path d="M7 4a2 2 0 0 0-2 2v1h4V6a2 2 0 0 0-2-2zM9 9h7M9 13h7M9 17h4"/>'),
  tree: wrap('<path d="M12 21v-5M12 3l-6 8h3l-3 5h12l-3-5h3z"/>'),
  heart: wrap('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  bolt: wrap('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
};

export const THOUGHT_ICON = {
  Foraging: 'leaf', Hunting: 'target', Fleeing: 'bolt', Socializing: 'people', Gathering: 'sparkle',
  Building: 'flag', Resting: 'moon', Wandering: 'eye', 'Waging war': 'swords', Defending: 'swords',
  Trading: 'trade', Courting: 'heart', Hoarding: 'leaf', Feasting: 'heart',
};

export const WEATHER_ICON = { Clear: 'sun', Cloudy: 'cloud', Rain: 'rain', Storm: 'storm', Snow: 'snow', Heatwave: 'heat' };
