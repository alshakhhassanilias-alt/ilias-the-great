// Thin promise wrapper around the Stockfish web worker (UCI over postMessage).
// One search runs at a time; asking for a new one stops the current one first.

export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.lines = [];
    this.waiters = [];
    this.search = null;          // the running search: { resolve, info, stale }
    this.queued = null;          // the search to start once the running one ends
    this.worker.onmessage = (e) => this.#onLine(String(e.data));
    this.worker.onerror = (e) => { this.error = e.message || 'engine failed to load'; };
  }

  async init() {
    this.#send('uci');
    await this.#waitFor('uciok');
    this.#send('isready');
    await this.#waitFor('readyok');
  }

  setSkill(level) {
    this.#send(`setoption name Skill Level value ${level}`);
  }

  // Resolves with { bestmove, cp, mate, depth } (score from White's point of view),
  // or null if a newer analyse() call superseded this one.
  analyse(fen, movetime) {
    return new Promise((resolve) => {
      const next = { fen, movetime, resolve, info: {} };
      if (this.queued) this.queued.resolve(null);
      if (!this.search) return this.#start(next);
      this.queued = next;
      this.search.stale = true;
      this.#send('stop');
    });
  }

  terminate() {
    this.worker.terminate();
  }

  #start(search) {
    this.search = search;
    this.#send(`position fen ${search.fen}`);
    this.#send(`go movetime ${search.movetime}`);
  }

  #send(cmd) {
    this.worker.postMessage(cmd);
  }

  #waitFor(token) {
    return new Promise((resolve) => this.waiters.push({ token, resolve }));
  }

  #onLine(line) {
    this.waiters = this.waiters.filter((w) => {
      if (line !== w.token) return true;
      w.resolve();
      return false;
    });

    const s = this.search;
    if (!s) return;

    if (line.startsWith('info') && line.includes(' score ')) {
      const depth = /\bdepth (\d+)/.exec(line);
      const cp = /\bscore cp (-?\d+)/.exec(line);
      const mate = /\bscore mate (-?\d+)/.exec(line);
      const sign = s.fen.split(' ')[1] === 'w' ? 1 : -1;     // engine scores are for the side to move
      if (depth) s.info.depth = +depth[1];
      s.info.cp = cp ? sign * +cp[1] : null;
      s.info.mate = mate ? sign * +mate[1] : null;
    } else if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      this.search = null;
      s.resolve(s.stale ? null : { bestmove: best === '(none)' ? null : best, ...s.info });
      if (this.queued) {
        const next = this.queued;
        this.queued = null;
        this.#start(next);
      }
    }
  }
}
