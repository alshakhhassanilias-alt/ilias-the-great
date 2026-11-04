/**
 * The game's own icon set: engraved line glyphs on a 24-unit grid, drawn in the current text colour with a soft
 * tinted fill, so every screen speaks one visual language instead of a mix of emoji from whatever font the device has.
 */
import { memo, type ReactNode } from 'react';

const F = { fill: 'currentColor', fillOpacity: 0.22 } as const;
const D = { fill: 'currentColor', stroke: 'none' } as const;
export const GLYPHS: Record<string, ReactNode> = {
  alert: <><path d="M12 3.5 2.8 19.5h18.4z" {...F} /><path d="M12 9.5v4.5" /><circle cx="12" cy="16.8" r=".9" {...D} /></>,
  hourglass: <><path d="M7 3h10M7 21h10" /><path d="M8 3v2.5c0 1.6.9 2.8 2.2 3.8L12 10.7l1.8-1.4C15.1 8.3 16 7.1 16 5.5V3" /><path d="M8 21v-2.5c0-1.6.9-2.8 2.2-3.8L12 13.3l1.8 1.4c1.3 1 2.2 2.2 2.2 3.8V21" /><path d="M9.5 20h5l-2.5-3.5z" {...D} fillOpacity={0.5} /></>,
  handshake: <><path d="M2.5 11.5 6.5 7.5l3.5 1.5 2.5-1.5 3.5 1 5.5 4" /><path d="M6.5 7.5 2.5 11.5l5.5 5.5c.8.8 2 .8 2.8 0l.7-.7" /><path d="M10.5 10 8 12.5c-.6.6-.6 1.6 0 2.2s1.6.6 2.2 0L13.5 11.5l4.5 4.5c.7-.7.7-1.8 0-2.5" /><path d="M13.6 17.4l.7.7c.6.6 1.6.6 2.2 0" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" {...F} /><circle cx="12" cy="12" r="1.6" {...D} /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /><circle cx="12" cy="12" r="6.4" {...F} /></>,
  sparkle: <><path d="M11 3l1.9 5.4L18.3 10l-5.4 1.9L11 17.3l-1.9-5.4L3.7 10l5.4-1.6z" {...F} /><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" {...D} fillOpacity={0.6} /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.6 1 2.5h6c0-.9.2-1.7 1-2.5A6 6 0 0 0 12 3z" {...F} /><path d="M12 7.5v3l1.5 1.5" /></>,
  clipboard: <><path d="M6.5 5H5v16h14V5h-1.5" /><path d="M8.5 3.5h7v3h-7z" {...F} /><path d="M8 11h8M8 14.5h8M8 18h5" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.8 8.2 13.2 13.2 8.2 15.8 10.8 10.8z" {...F} /><circle cx="12" cy="12" r="1" {...D} /><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21" /></>,
  flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.4 15h9.2l2 3.6a1 1 0 0 1-.9 1.4H6.3a1 1 0 0 1-.9-1.4z" {...F} /><circle cx="11" cy="17" r=".8" {...D} /><circle cx="13.6" cy="18.2" r=".6" {...D} /></>,
  factory: <><path d="M3 21V11.5l5 3V11.5l5 3V11.5l5 3V5h3v16z" {...F} /><path d="M3 21h18" /><path d="M6.5 18h2M11.5 18h2M16.5 18h2" /><path d="M18.5 5c0-1.5 1-2 2-2" /></>,
  law: <><path d="M6 3h9l4 4v14H6z" {...F} /><path d="M15 3v4h4" /><path d="M9 10h7M9 13h7M9 16h3.5" /><circle cx="15.5" cy="17.5" r="2" /></>,
  coin: <><circle cx="12" cy="12" r="9" {...F} /><path d="M12 6.5v11M14.8 9c0-1.2-1.2-1.8-2.8-1.8S9.2 7.9 9.2 9.2s1.2 1.7 2.8 2.1 2.8.9 2.8 2.3-1.2 2-2.8 2-2.9-.7-2.9-2" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.4 8.1-8 9-4.6-.9-8-4-8-9V6z" {...F} /><path d="M12 7v10M8.5 11h7" /></>,
  olive: <><path d="M5 20C9 15.5 13 11 19.5 4.5" /><path d="M9.5 15c-2.2.1-3.4-1-3.6-3 2.2-.1 3.4 1 3.6 3zM12.4 11.9c-2.2.1-3.4-1-3.6-3 2.2-.1 3.4 1 3.6 3zM15.4 8.8c-2.2.1-3.4-1-3.6-3 2.2-.1 3.4 1 3.6 3zM10.4 14.2c-.1 2.2 1 3.4 3 3.6.1-2.2-1-3.4-3-3.6zM13.4 11.1c-.1 2.2 1 3.4 3 3.6.1-2.2-1-3.4-3-3.6z" {...F} /></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" {...F} /><path d="M8 11.5h2.2l1.2-2 1.6 4 1.2-2H16" /></>,
  scissors: <><circle cx="6" cy="6.5" r="2.6" {...F} /><circle cx="6" cy="17.5" r="2.6" {...F} /><path d="M8.2 8 20 17.5M8.2 16 20 6.5" /></>,
  globe: <><circle cx="12" cy="12" r="9" {...F} /><path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18" /><path d="M4.6 7.5h14.8M4.6 16.5h14.8" /></>,
  crown: <><path d="M3.5 18.5 2.5 8l5.2 4 4.3-6.5 4.3 6.5 5.2-4-1 10.5z" {...F} /><path d="M3.5 21h17" /><circle cx="12" cy="13.5" r="1.2" {...D} /></>,
  flag: <><path d="M5 21V3.5" /><path d="M5 4.5c3.5-1.8 6.5 1.8 10 0s4.5 0 4.5 0v8.5s-1-1.8-4.5 0-6.5-1.8-10 0" {...F} /></>,
  finish: <><path d="M5 21V3.5" /><path d="M5 4h14v9H5z" {...F} /><path d="M5 8.5h14M9.7 4v9M14.3 4v9" /><path d="M5 4h4.7v4.5H5zM14.3 4H19v4.5h-4.7zM9.7 8.5h4.6V13H9.7z" {...D} fillOpacity={0.55} /></>,
  rise: <><path d="M3 18l6-6 4 4 8-8" /><path d="M15 8h6v6" /><path d="M3 21h18" /><path d="M3 18l6-6 4 4 8-8v13H3z" {...F} stroke="none" /></>,
  percent: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.6" {...F} /><circle cx="17" cy="17" r="2.6" {...F} /></>,
  bridge: <><path d="M2 18h20M4 18v-6M20 18v-6" /><path d="M2 12c3 0 6-4.5 10-4.5S19 12 22 12" /><path d="M8 18v-4.8M12 18v-6.4M16 18v-4.8" /><path d="M2 18h20v2.5H2z" {...F} stroke="none" /></>,
  sunrise: <><path d="M3 18h18M5.5 21h13" /><path d="M6 18a6 6 0 0 1 12 0z" {...F} /><path d="M12 6.5V3.5M5.6 9.6 4 8M18.4 9.6 20 8M2 14h2M20 14h2" /></>,
  drop: <><path d="M12 3c3 4.4 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 3-6.6 6-11z" {...F} /><path d="M9.4 14.6a2.8 2.8 0 0 0 2.6 2.9" /></>,
  star: <><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.7l-5.3 2.9 1.1-6-4.4-4.1 6-.8z" {...F} /></>,
  wrench: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" {...F} /></>,
  briefcase: <><path d="M3 8h18v12H3z" {...F} /><path d="M8.5 8V5h7v3M3 13h18M11 13v2h2v-2" /></>,
  medal: <><path d="M8 3l4 6 4-6" /><circle cx="12" cy="15" r="6" {...F} /><path d="M12 11.8l1 2.1 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z" {...D} fillOpacity={0.7} /></>,
  speech: <><path d="M4 4.5h16v11H10l-5 4.5v-4.5H4z" {...F} /><path d="M8 9h8M8 12h5" /></>,
  wheat: <><path d="M12 21V8" /><path d="M12 9c-2.8 0-4-1.8-4-4 2.8 0 4 1.8 4 4zM12 9c2.8 0 4-1.8 4-4-2.8 0-4 1.8-4 4zM12 13.2c-2.8 0-4-1.8-4-4 2.8 0 4 1.8 4 4zM12 13.2c2.8 0 4-1.8 4-4-2.8 0-4 1.8-4 4zM12 17.4c-2.8 0-4-1.8-4-4 2.8 0 4 1.8 4 4zM12 17.4c2.8 0 4-1.8 4-4-2.8 0-4 1.8-4 4z" {...F} /></>,
  crane: <><path d="M6 21V5h1.5v16M3 21h8" /><path d="M6 5l14 0M7.5 8.5 20 5" /><path d="M17 5v5" /><path d="M15.5 10h3v2.5h-3z" {...F} /><path d="M7.5 5 6 3h1.5z" /></>,
  scale: <><path d="M12 4v16M7 20h10M5 7h14" /><path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0z" {...F} /><path d="M19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" {...F} /></>,
  people: <><circle cx="9" cy="8" r="3" {...F} /><path d="M3.5 19c.5-3.5 2.6-5.5 5.5-5.5s5 2 5.5 5.5" /><circle cx="17" cy="9" r="2.3" /><path d="M15.5 14c2.7 0 4.5 1.8 5 5" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" {...F} /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>,
  key: <><circle cx="8" cy="15" r="4" {...F} /><path d="M11 12l9-9M17 6l2 2M15 8l1.5 1.5" /></>,
  book: <><path d="M4 5c3-1.5 5.5-1.5 8 0 2.5-1.5 5-1.5 8 0v14c-3-1.5-5.5-1.5-8 0-2.5-1.5-5-1.5-8 0z" {...F} /><path d="M12 5v14" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" {...D} fillOpacity={0.7} /></>,
  check: <><circle cx="12" cy="12" r="9" {...F} /><path d="M8 12.5l2.7 2.7L16.5 9" /></>,
  sword: <><path d="M14.5 3.5H20.5v6L10 20l-2-2z" {...F} /><path d="M6 15l3 3M4 21l3.5-3.5M4.5 14.5l5 5" /></>,
  speaker: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={0.22} /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={0.22} /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  bolt: <><path d="M13.5 2.5 5 13.5h6l-1.5 8 9-11.5h-6z" fill="currentColor" fillOpacity={0.22} /></>,
  pick: <><path d="M4 8c4-4.5 11-4.5 16 0-4.5-1.5-11-1.5-16 0z" fill="currentColor" fillOpacity={0.22} /><path d="M12 6.5 6 21" /></>,
  chip: <><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity={0.22} /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9 3.5v3M12 3.5v3M15 3.5v3M9 17.5v3M12 17.5v3M15 17.5v3M3.5 9h3M3.5 12h3M3.5 15h3M17.5 9h3M17.5 12h3M17.5 15h3" /></>,
  dna: <><path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12" /><path d="M8.5 6.5h7M8.5 17.5h7M10 9.2h4M10 14.8h4" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" {...F} /><circle cx="12" cy="12" r="3" /></>,
};
export type GlyphName = keyof typeof GLYPHS;

/** One glyph. `name` may be any key of GLYPHS; unknown names render nothing. */
export const Glyph = memo(function Glyph({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const g = GLYPHS[name];
  if (!g) return null;
  return (
    <svg className={`glyph ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{g}</svg>
  );
});

/** Which glyph stands for what, in one place. */
export const FACTION_GLYPH: Record<string, string> = { labour: 'wrench', business: 'briefcase', military: 'medal', nationalists: 'flag', liberals: 'speech', regions: 'wheat' };
export const FOCUS_GLYPH: Record<string, string> = { industry: 'factory', science: 'flask', diplomacy: 'olive', rearm: 'shield', welfare: 'heart', reform: 'scissors' };
export const SECTOR_GLYPH: Record<string, string> = { agri: 'wheat', energy: 'bolt', mining: 'pick', heavy: 'factory', manuf: 'gear', tech: 'chip', arms: 'shield', services: 'briefcase' };
export const BRANCH_GLYPH = ['factory', 'bolt', 'chip', 'dna', 'shield'];
export const SCEN_GLYPH: Record<string, string> = { poland: 'rise', argentina: 'percent', turkey: 'bridge', ukraine: 'shield', india: 'crown', japan: 'sunrise', saudi: 'drop', nigeria: 'star', tutorial: 'book' };
