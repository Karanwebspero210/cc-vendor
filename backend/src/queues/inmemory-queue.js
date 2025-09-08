const EventEmitter = require("events");
let nextId = 1;

class InMemoryQueue extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.jobs = [];
    this.processors = new Map();
    this.waiting = [];
    this.active = new Set();
    this.completed = new Set();
    this.failed = new Set();
    this._paused = false;
  }

  process(name, concurrency, handler) {
    if (typeof concurrency === "function") {
      handler = concurrency; // name-only signature
      concurrency = 1;
    }
    this.processors.set(name, { concurrency, handler });
    // Try to process any waiting jobs
    setImmediate(() => this._drain());
  }

  async add(name, data = {}, opts = {}) {
    const id = opts.jobId || String(nextId++);
    const job = {
      id,
      name,
      data,
      opts,
      _progress: 0,
      timestamp: Date.now(),
      processedOn: null,
      finishedOn: null,
      failedReason: null,
      returnvalue: undefined,
      attemptsMade: 0,
      delay: opts.delay || 0,
      progress: (v) => {
        if (typeof v === "number") job._progress = v;
        this.emit("progress", job, job._progress);
        return job._progress;
      },
      getState: async () => {
        if (this.waiting.find((j) => j.id === id)) return "waiting";
        if ([...this.active].find((j) => j.id === id)) return "active";
        if ([...this.completed].find((j) => j.id === id)) return "completed";
        if ([...this.failed].find((j) => j.id === id)) return "failed";
        return "unknown";
      },
      remove: async () => {
        this.waiting = this.waiting.filter((j) => j.id !== id);
        this.active.delete(job);
        this.completed.delete(job);
        this.failed.delete(job);
        this.jobs = this.jobs.filter((j) => j.id !== id);
      },
      retry: async () => {
        // Only failed jobs can be retried
        if (![...this.failed].find((j) => j.id === id)) return;
        this.failed.delete(job);
        job.failedReason = null;
        job.returnvalue = undefined;
        job.processedOn = null;
        job.finishedOn = null;
        job._progress = 0;
        job.attemptsMade += 1;
        this.waiting.push(job);
        setImmediate(() => this._drain());
      },
    };
    this.jobs.push(job);
    this.waiting.push(job);
    this.emit("waiting", job.id);
    setImmediate(() => this._drain());
    return job;
  }

  async getJob(jobId) {
    return this.jobs.find((j) => j.id === jobId) || null;
  }

  async getJobs(statuses) {
    const map = {
      waiting: this.waiting,
      active: [...this.active],
      completed: [...this.completed],
      failed: [...this.failed],
    };
    const result = [];
    for (const s of statuses) {
      result.push(...(map[s] || []));
    }
    return result;
  }

  async getWaiting() {
    return this.waiting;
  }
  async getActive() {
    return [...this.active];
  }
  async getCompleted() {
    return [...this.completed];
  }
  async getFailed() {
    return [...this.failed];
  }

  async getJobCounts() {
    return {
      waiting: this.waiting.length,
      active: this.active.size,
      completed: this.completed.size,
      failed: this.failed.size,
      delayed: 0,
      paused: this._paused ? 1 : 0,
    };
  }

  async getWorkers() {
    // In-memory queue has no separate workers
    return [];
  }

  async clean(_grace = 0, status = "completed") {
    const allowed = ["completed", "failed", "waiting", "active"];
    if (!allowed.includes(status)) return [];
    let removed = [];
    if (status === "completed") {
      removed = [...this.completed];
      this.completed.clear();
    } else if (status === "failed") {
      removed = [...this.failed];
      this.failed.clear();
    } else if (status === "waiting") {
      removed = [...this.waiting];
      this.waiting = [];
    } else if (status === "active") {
      removed = [...this.active];
      this.active.clear();
    }
    // Also remove from master list
    const removedIds = new Set(removed.map((j) => j.id));
    this.jobs = this.jobs.filter((j) => !removedIds.has(j.id));
    return removed;
  }

  async pause() {
    this._paused = true;
  }
  async resume() {
    this._paused = false;
    setImmediate(() => this._drain());
  }
  async isPaused() {
    return this._paused;
  }

  async close() {
    /* no-op */
  }

  async _drain() {
    // Try process waiting jobs if processor exists
    for (let i = 0; i < this.waiting.length; ) {
      if (this._paused) break;
      const job = this.waiting[i];
      const proc = this.processors.get(job.name);
      if (!proc) {
        i++;
        continue;
      }
      // move job to active
      this.waiting.splice(i, 1);
      this.active.add(job);
      this.emit("active", job);
      job.processedOn = Date.now();
      Promise.resolve(proc.handler(job))
        .then((result) => {
          this.active.delete(job);
          this.completed.add(job);
          job.finishedOn = Date.now();
          job.returnvalue = result;
          this.emit("completed", job, result);
        })
        .catch((err) => {
          this.active.delete(job);
          this.failed.add(job);
          job.finishedOn = Date.now();
          job.failedReason = err?.message || String(err);
          this.emit("failed", job, err);
        });
    }
  }
}

module.exports = InMemoryQueue;
