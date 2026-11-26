import type { CarDesign, WingDesign } from "./types";

const P = (x: number, y: number) => ({ x, y });

const frontAirfoil = () => ({
  upper: [P(0, 0.008), P(0.25, 0.0), P(0.6, -0.025), P(1, -0.03)],
  lower: [P(0, -0.008), P(0.25, -0.085), P(0.6, -0.075), P(1, -0.045)],
});

export const defaultFrontWing = (): WingDesign => ({
  section: frontAirfoil(),
  chord: 0.28,
  span: 1.8,
  pitch: 6,
  height: 0.09,
  endplate: 0.2,
  elements: 2,
  material: "carbon",
});

export const defaultRearWing = (): WingDesign => ({
  section: frontAirfoil(),
  chord: 0.4,
  span: 1.0,
  pitch: 13,
  height: 0.82,
  endplate: 0.3,
  elements: 2,
  material: "carbon",
});

export const defaultDesign = (): CarDesign => ({
  name: "Apex One",
  body: {
    length: 4.8,
    sideUpper: [P(0, 0.2), P(0.16, 0.27), P(0.38, 0.5), P(0.52, 0.72), P(0.62, 0.8), P(0.8, 0.5), P(1, 0.3)],
    sideLower: [P(0, 0.15), P(0.25, 0.12), P(0.55, 0.1), P(0.85, 0.14), P(1, 0.22)],
    planHalf: [P(0, 0.035), P(0.12, 0.06), P(0.3, 0.15), P(0.48, 0.34), P(0.62, 0.33), P(0.82, 0.2), P(1, 0.07)],
    squareness: 2.6,
    material: "carbon",
  },
  frontWing: defaultFrontWing(),
  rearWing: defaultRearWing(),
  floor: {
    length: 2.7,
    width: 1.15,
    under: [P(0, 0.04), P(0.3, 0.0), P(0.55, 0.0), P(1, 0.1)],
    material: "carbon",
  },
  wheelbase: 3.4,
  rideHeight: 0.04,
  livery: { primary: "#a20623", secondary: "#1c1c20", accent: "#f2f2f4", number: 7, helmet: "#f2f2f4", helmetStripe: "#a20623" },
  driver: { name: "R. Vance" },
});
