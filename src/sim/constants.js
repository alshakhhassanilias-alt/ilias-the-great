// Shared world / simulation constants (used by worker, renderer and headless tests).
export const WORLD_SIZE = 256;          // world units, centered at origin
export const HALF = WORLD_SIZE / 2;
export const TERRAIN_RES = 161;         // height samples per side
export const FOOD_RES = 64;             // resource grid cells per side
export const FOOD_CELL = WORLD_SIZE / FOOD_RES;
export const SEA_LEVEL = 0;

export const TICKS_PER_SECOND = 20;     // simulation rate at 1x speed
export const DAY_TICKS = 600;           // one full day/night
export const SEASON_DAYS = 3;
export const SEASON_TICKS = DAY_TICKS * SEASON_DAYS;
export const YEAR_TICKS = SEASON_TICKS * 4;

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const WEATHERS = ['Clear', 'Cloudy', 'Rain', 'Storm', 'Snow', 'Heatwave'];

export const BIOME = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, ROCK: 5, SNOW: 6 };

// Intents chosen by the neural network (output neurons 0..7)
export const INTENTS = ['Foraging', 'Hunting', 'Fleeing', 'Socializing', 'Gathering', 'Building', 'Resting', 'Wandering'];
export const INTENT = { FORAGE: 0, HUNT: 1, FLEE: 2, SOCIAL: 3, GATHER: 4, BUILD: 5, REST: 6, WANDER: 7 };
// Situational overrides (rendered as thoughts too)
export const ACTION = {
  ...INTENT,
  WAR: 8, DEFEND: 9, TRADE: 10, MATE: 11, HOARD: 12, EAT_STORE: 13,
};
export const ACTION_LABELS = [
  'Foraging', 'Hunting', 'Fleeing', 'Socializing', 'Gathering', 'Building', 'Resting', 'Wandering',
  'Waging war', 'Defending', 'Trading', 'Courting', 'Hoarding', 'Feasting',
];

export const MAX_CREATURES = 520;
export const CREATURE_STRIDE = 12;      // floats per creature in render snapshots
export const FLAG = {
  INFECTED: 1, CARNIVORE: 2, OMNIVORE: 4, TRIBE: 8, CARRY: 16, ATTACK: 32, YOUNG: 64, SLEEP: 128,
};
