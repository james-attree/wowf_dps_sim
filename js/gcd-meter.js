// The meter's range is the sim GCD (simulation.gcdDuration, from gcd.duration).
export function applyGcdMeterAria(meter, simulation) {
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", String(simulation.gcdDuration));
  meter.setAttribute("aria-valuenow", simulation.gcd.toFixed(1));
}
