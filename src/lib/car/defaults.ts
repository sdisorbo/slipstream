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
    sideUpper: [P(0, 0.17), P(0.16, 0.2), P(0.3, 0.3), P(0.4, 0.52), P(0.5, 0.62), P(0.58, 0.98), P(0.68, 0.84), P(0.84, 0.55), P(1, 0.4)],
    sideLower: [P(0, 0.13), P(0.25, 0.11), P(0.55, 0.1), P(0.85, 0.14), P(1, 0.22)],
    planHalf: [P(0, 0.04), P(0.12, 0.07), P(0.3, 0.2), P(0.42, 0.36), P(0.62, 0.37), P(0.82, 0.22), P(1, 0.08)],
    squareness: 3.6,
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
  livery: { primary: "#d9202b", secondary: "#f2f2f4", accent: "#f2f2f4", number: 7, helmet: "#f2f2f4", helmetStripe: "#a20623" },
  driver: { name: "R. Vance" },
});
