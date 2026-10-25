/** Small engraved line icons for the desktop interface (drawn in the current text colour). */
import type { ReactElement, ReactNode } from 'react';

const I = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const IconOverview = () => (
  <I><circle cx="12" cy="12" r="9" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2" /><path d="M15.5 8.5 13 13l-4.5 2.5L11 11z" fill="currentColor" fillOpacity="0.25" /></I>
);
export const IconGoals = () => (
  <I><path d="M5 21V4" /><path d="M5 4h11l-2 3.5L16 11H5" fill="currentColor" fillOpacity="0.2" /><path d="M3 21h6" /></I>
);
export const IconEconomy = () => (
  <I><ellipse cx="9" cy="7" rx="5" ry="2.2" /><path d="M4 7v4c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V7" /><path d="M10 15.5c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2v-4c0-1.2-2.2-2.2-5-2.2" /><path d="M10 15.5v4c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2v-4" /></I>
);
export const IconMilitary = () => (
  <I><path d="M4 4l10 10M14 14l2 2M17 17l3 3M16 19l3-3" /><path d="M20 4 10 14M10 14l-2 2M7 17l-3 3M8 19l-3-3" /><path d="M4 4h3v3M20 4h-3v3" /></I>
);
export const IconDiplomacy = () => (
  <I><path d="M3 12l4-4 4 2 3-2 3 1 4 3" /><path d="M7 8 3 12l5 5c.8.8 2 .8 2.8 0l.7-.7M11 10l-2.5 2.5c-.6.6-.6 1.6 0 2.2s1.6.6 2.2 0L14 11.5l4.5 4.5c.7-.7.7-1.8 0-2.5" /></I>
);
export const IconPolitics = () => (
  <I><path d="M3 9h18L12 4z" fill="currentColor" fillOpacity="0.2" /><path d="M5 9v8M9.5 9v8M14.5 9v8M19 9v8" /><path d="M3 20h18M4 17h16" /></I>
);
export const IconResearch = () => (
  <I><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /><path d="M8 17.5h8l-1 2H9z" fill="currentColor" fillOpacity="0.25" /></I>
);
export const TAB_ICONS: Record<string, () => ReactElement> = {
  overview: IconOverview, politics: IconPolitics, goals: IconGoals, research: IconResearch, economy: IconEconomy, military: IconMilitary, diplomacy: IconDiplomacy,
};
