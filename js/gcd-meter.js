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

// The GCD meter's reading: its range is the sim GCD (simulation.gcdDuration,
// from gcd.duration). "0.6 seconds remaining", or "Ready" with none left.
export function gcdMeterAria({ gcd, gcdDuration }) {
  const now = gcd.toFixed(1);
  return {
    "aria-valuemax": String(gcdDuration),
    "aria-valuenow": now,
    "aria-valuetext": Number(now) > 0 ? `${now} seconds remaining` : "Ready",
  };
}

export function applyGcdMeterAria(meter, simulation) {
  writeAria(meter, gcdMeterAria(simulation));
}
