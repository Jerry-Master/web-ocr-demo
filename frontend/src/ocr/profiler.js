export class Profiler {
  constructor() {
    this.times = {}
  }

  start(name) {
    this.times[name + "start"] = performance.now()
  }

  end(name) {
    if (!this.times[name]) {
      this.times[name] = 0
    }
    this.times[name] += performance.now() - this.times[name + "start"]
    delete this.times[name + "start"]
  }

  reset() {
    this.times = {}
  }

  report() {
    return this.times
  }
}