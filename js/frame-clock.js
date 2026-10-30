import { k } from "../data/constants.js";

// Turns the browser's animation-frame timestamps into seconds of fight time
// for the event core, for the live page (js/main.js). It reads no clock: the
// host hands it each frame's timestamp in milliseconds, so it runs in Node
// under test. The event core takes any time, so there is no step and no
// carry: a seed gives the same fight live as it does in runFight, however
// uneven the frames are (whole-step counting went with the fixed-step engine,
// #234).
//
// One frame feeds the fight at most k("sim.maxFrameTime") seconds. A frame
// that arrives later than that, such as the first one after a hidden tab or a
// long pause, is cut to the cap and the rest is dropped, never caught up.
export class FrameClock {
  constructor() {
    // Timestamp of the previous frame, or null before the first frame and
    // after restart(). The first frame only sets it, so it gives no time.
    this.lastTimestamp = null;
  }

  // Forget the previous timestamp. The host calls this on resume, so the time
  // spent paused is not counted: the next frame gives no time.
  restart() {
    this.lastTimestamp = null;
  }

  // The seconds of fight time for the frame at `timestamp` (milliseconds):
  // the time since the previous frame, at most k("sim.maxFrameTime"). The
  // first frame, and the first after restart(), give 0. A timestamp that does
  // not move forward gives 0.
  seconds(timestamp) {
    if (!Number.isFinite(timestamp)) {
      throw new RangeError(
        `FrameClock.seconds needs a finite timestamp in milliseconds. Got ${timestamp}.`,
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
