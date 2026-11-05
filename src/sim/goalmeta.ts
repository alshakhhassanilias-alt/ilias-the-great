/** War goals: what a war is for (kept free of imports so events can build their options at load time). */
export type WarGoal = 1 | 2 | 3; // limited, total, defensive
export const GOALS_META: Record<WarGoal, { icon: string; title: string; desc: string; success: string }> = {
  1: { icon: '🎯', title: 'Limited war', desc: 'Take the border regions, then make peace. The public stays patient.', success: 'gain at least one region' },
  2: { icon: '🔥', title: 'Total war', desc: 'Break them completely. The army and nationalists are fired up, but the country tires faster and the world is alarmed.', success: 'gain three or more regions, or force a surrender' },
  3: { icon: '🛡', title: 'Defend and restore', desc: 'Hold the line and restore our borders. Support stays high while we defend.', success: 'lose no regions' },
};
