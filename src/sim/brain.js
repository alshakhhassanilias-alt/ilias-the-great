// Lightweight feed-forward neural network with one recurrent memory neuron.
// Layout: inputs(NI) -> hidden(up to MAX_H, masked by genome.brainSize) -> outputs(NO)
export const NI = 14;
export const MAX_H = 12;
export const NO = 10;
export const INPUT_LABELS = [
  'Energy', 'Health', 'Food scent', 'Threat', 'Prey', 'Kin near', 'Enemies',
  'In tribe', 'Camp dist', 'Carrying', 'Daylight', 'Warmth', 'Bias', 'Memory',
];
export const OUTPUT_LABELS = [
  'Forage', 'Hunt', 'Flee', 'Social', 'Gather', 'Build', 'Rest', 'Wander', 'Speed', 'Memory',
];
export const W1 = NI * MAX_H;          // input->hidden
export const W2 = MAX_H * NO;          // hidden->output
export const WEIGHT_COUNT = W1 + MAX_H + W2 + NO;

// Innate "instinct" prior: primordial cells start with weak, noisy chemotaxis-style reflexes.
// Evolution sharpens or rewires them. Encoded as direct input->output tendencies that
// get projected through the hidden layer at birth.
const INSTINCT = [
  // [input, output, strength]
  [0, 0, -1.6],  // low energy -> forage
  [2, 0, 1.2],   // food scent -> forage
  [3, 2, 2.2],   // threat -> flee
  [4, 1, 1.4],   // prey seen -> hunt
  [0, 6, 0.6],   // high energy -> rest
  [5, 3, 0.8],   // kin -> socialize
  [9, 5, 1.6],   // carrying -> build
  [7, 4, 0.5],   // tribe -> gather
  [10, 6, -0.9], // night -> rest
  [12, 7, 0.4],  // bias -> wander
  [12, 8, 0.6],  // bias -> speed
];

export function randomWeights(rng, instinct = 0.7, noise = 0.9) {
  const w = new Float32Array(WEIGHT_COUNT);
  for (let i = 0; i < WEIGHT_COUNT; i++) w[i] = rng.gauss() * noise * 0.5;
  // route each instinct through two hidden neurons so they survive brain masking
  for (let k = 0; k < INSTINCT.length; k++) {
    const [inp, out, s] = INSTINCT[k];
    for (const h of [k % 3, (k + 1) % 3]) {
      w[inp * MAX_H + h] += s * instinct * 0.8;
      w[W1 + MAX_H + h * NO + out] += instinct * 0.9;
    }
  }
  return w;
}

const act = (x) => Math.tanh(x);

// Forward pass. Writes into provided scratch arrays to avoid GC churn.
export function think(weights, hiddenCount, input, hidden, output) {
  const b1 = W1;
  const w2 = W1 + MAX_H;
  const b2 = w2 + W2;
  for (let h = 0; h < MAX_H; h++) {
    if (h >= hiddenCount) { hidden[h] = 0; continue; }
    let s = weights[b1 + h];
    for (let i = 0; i < NI; i++) s += input[i] * weights[i * MAX_H + h];
    hidden[h] = act(s);
  }
  for (let o = 0; o < NO; o++) {
    let s = weights[b2 + o];
    for (let h = 0; h < hiddenCount; h++) s += hidden[h] * weights[w2 + h * NO + o];
    output[o] = act(s);
  }
}

// Structural "intelligence": counts effectively wired hidden neurons and how decisively
// they discriminate. Used for the population IQ telemetry.
export function intelligenceOf(weights, hiddenCount) {
  let wired = 0, mag = 0;
  for (let h = 0; h < hiddenCount; h++) {
    let inS = 0, outS = 0;
    for (let i = 0; i < NI; i++) inS += Math.abs(weights[i * MAX_H + h]);
    for (let o = 0; o < NO; o++) outS += Math.abs(weights[W1 + MAX_H + h * NO + o]);
    const m = Math.min(inS / NI, outS / NO);
    if (m > 0.15) wired++;
    mag += m;
  }
  return 40 + wired * 7 + Math.min(mag, 6) * 2.5;
}
