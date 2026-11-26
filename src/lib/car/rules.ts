// Technical regulations the design has to satisfy.
export const RULES = {
  maxLength: 5.6,
  maxWidth: 2.0,
  maxHeight: 1.0,
  minMass: 760, // kg, with driver. Lighter cars get ballast.
  maxMass: 900, // kg. Heavier is illegal.
  frontWing: { maxSpan: 2.0, minSpan: 0.8, minChord: 0.15, maxChord: 0.45, maxPitch: 28, minHeight: 0.04, maxHeight: 0.35 },
  rearWing: { maxSpan: 1.1, minSpan: 0.6, minChord: 0.18, maxChord: 0.5, maxPitch: 30, minHeight: 0.6, maxHeight: 0.95 },
  body: { minLength: 3.4, maxLength: 5.0 },
  wheelbase: { min: 3.0, max: 3.6 },
  rideHeight: { min: 0.02, max: 0.09 },
  floor: { minWidth: 0.7, maxWidth: 1.4, minLength: 1.6, maxLength: 3.4 },
  bodyMaxHalfWidth: 0.5,
};
export const FIXED_MASS = 600; // powertrain, driver, suspension, wheels, brakes
export const FRONT_WHEEL = { dia: 0.66, width: 0.31 };
export const REAR_WHEEL = { dia: 0.72, width: 0.4 };
export const TRACK_WIDTH = { front: 1.5, rear: 1.45 };
