import { k } from "../data/constants.js";

// Turns the browser's animation-frame timestamps into whole engine steps, for
// the live page (js/main.js), or into seconds for the event core (seconds()). It reads no clock: the host hands it each frame's
// timestamp in milliseconds, so it runs in Node under test.
//
// Every step the page gives the engine is k("sim.fixedStep") long, the same
// step Simulation.run takes. A seed therefore gives the same fight live as it
// does in runFight, however uneven the frames are. Frame time that does not
// fill a step carries over to the next frame.
//
// One frame feeds the fight at most k("sim.maxFrameTime") seconds. A frame
// that arrives later than that, such as the first one after a hidden tab or a
// long pause, is cut to the cap and the rest is dropped, never caught up.
export class FrameClock {
  constructor() {
    // Timestamp of the previous frame, or null before the first frame and
    // after restart(). The first frame only sets it, so it takes no steps.
    this.lastTimestamp = null;
    // Seconds of fight time that did not fill a whole step yet. Always less
    // than one step.
    this.carry = 0;
  }

  // Forget the previous timestamp. The host calls this on resume, so the time
  // spent paused is not counted: the next frame takes no steps. The carry is
  // fight time, not paused time, so it stays.
  restart() {
    this.lastTimestamp = null;
  }

  // The number of whole steps of k("sim.fixedStep") the engine takes for the
  // frame at `timestamp` (milliseconds). At most
  // k("sim.maxFrameTime") / k("sim.fixedStep"). A timestamp that does not
  // move forward takes no steps.
  steps(timestamp) {
    const elapsed = this.#elapsed(timestamp, "steps");
    const stepSize = k("sim.fixedStep");
    const available = this.carry + elapsed;
    const count = Math.floor(available / stepSize);
    this.carry = available - count * stepSize;
    return count;
  }

  // The seconds of fight time for the frame at `timestamp` (milliseconds), for
  // an engine that takes any time (the event core, #198): the time since the
  // previous frame, at most k("sim.maxFrameTime"), with no steps and no
  // carry. The first frame, and the first after restart(), give 0. A
  // timestamp that does not move forward gives 0. Use steps() or seconds()
  // on one clock, not both.
  seconds(timestamp) {
    return this.#elapsed(timestamp, "seconds");
  }

  #elapsed(timestamp, method) {
    if (!Number.isFinite(timestamp)) {
      throw new RangeError(
        `FrameClock.${method} needs a finite timestamp in milliseconds. Got ${timestamp}.`,
      );
    }
    const previous = this.lastTimestamp;
    this.lastTimestamp = timestamp;
    if (previous === null) {
      return 0;
    }
    return Math.min(
      Math.max(0, (timestamp - previous) / k("sim.msPerSecond")),
      k("sim.maxFrameTime"),
    );
  }
}
