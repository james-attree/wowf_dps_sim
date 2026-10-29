// The meters' aria (#45): aria-valuemax is static in index.html (the GCD's
// from gcd.duration, combo points' from combo.max, energy's from energy.max;
// a test keeps them equal), and aria-valuenow, aria-valuetext and a changed
// max are written only when they change, so a screen reader is not told of a
// new value every frame.

// Sets each attribute in `attributes` whose value differs from the one there.
export function writeAria(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    const text = String(value);
    if (element.getAttribute(name) !== text) {
      element.setAttribute(name, text);
    }
  }
}

// The GCD remaining as the page shows it: seconds to one decimal, "0.6".
export function gcdReading(remaining) {
  return Math.max(remaining, 0).toFixed(1);
}

// The one "ready" test (#45, Scout): the GCD is ready when its reading is
// 0.0, so the meter's "Ready", #gcd-status and the shown "0.0s" agree. 0.04 s
// left reads 0.0 and is ready; 0.05 s reads 0.1 and is not.
export function gcdReady(remaining) {
  return Number(gcdReading(remaining)) === 0;
}

// The GCD meter's reading: its range is the sim GCD (simulation.gcdDuration,
// from gcd.duration). "0.6 seconds remaining", "1 second remaining", or
// "Ready" with none left.
export function gcdMeterAria({ gcd, gcdDuration }) {
  const now = gcdReading(gcd);
  const unit = Number(now) === 1 ? "1 second" : `${now} seconds`;
  return {
    "aria-valuemax": String(gcdDuration),
    "aria-valuenow": now,
    "aria-valuetext": gcdReady(gcd) ? "Ready" : `${unit} remaining`,
  };
}

export function applyGcdMeterAria(meter, simulation) {
  writeAria(meter, gcdMeterAria(simulation));
}
