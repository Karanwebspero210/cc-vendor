const EventEmitter = require('events');
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
  }

  process(name, concurrency, handler) {
    if (typeof concurrency === 'function') {
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
      progress: (v) => {
        if (typeof v === 'number') job._progress = v;
        this.emit('progress', job, job._progress);
        return job._progress;
      },
      getState: async () => {
        if (this.waiting.find(j => j.id === id)) return 'waiting';
        if ([...this.active].find(j => j.id === id)) return 'active';
        if ([...this.completed].find(j => j.id === id)) return 'completed';
        if ([...this.failed].find(j => j.id === id)) return 'failed';
        return 'unknown';
      }
    };
    this.jobs.push(job);
    this.waiting.push(job);
    this.emit('waiting', job.id);
    setImmediate(() => this._drain());
    return job;
  }

  async getJobs(statuses) {
    const map = {
      waiting: this.waiting,
      active: [...this.active],
      completed: [...this.completed],
      failed: [...this.failed]
    };
    const result = [];
    for (const s of statuses) {
      result.push(...(map[s] || []));
    }
    return result;
  }

  async close() { /* no-op */ }

  async _drain() {
    // Try process waiting jobs if processor exists
    for (let i = 0; i < this.waiting.length; ) {
      const job = this.waiting[i];
      const proc = this.processors.get(job.name);
      if (!proc) { i++; continue; }
      // move job to active
      this.waiting.splice(i, 1);
      this.active.add(job);
      this.emit('active', job);
      proc.handler(job)
        .then((result) => {
          this.active.delete(job);
          this.completed.add(job);
          this.emit('completed', job, result);
        })
        .catch((err) => {
          this.active.delete(job);
          this.failed.add(job);
          this.emit('failed', job, err);
        });
    }
  }
}

module.exports = InMemoryQueue;
