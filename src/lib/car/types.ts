import type { Curve, Envelope } from "./curve";
import type { MaterialId } from "./materials";

export interface WingDesign {
  section: Envelope; // airfoil, x = chord fraction (0 = leading edge), y = fraction of chord, as seen on the car
  chord: number; // m
  span: number; // m
  pitch: number; // deg, trailing edge raised above leading edge (= angle of attack for downforce)
  height: number; // m, height of the wing's leading edge above ground
  endplate: number; // m height of endplates
  elements: 1 | 2 | 3;
  material: MaterialId;
}

export interface CarDesign {
  name: string;
  body: {
    length: number; // m, nose tip to tail
    sideUpper: Curve; // x = 0 at nose .. 1 at tail ; y = height above ground (m)
    sideLower: Curve;
    planHalf: Curve; // half-width (m)
    squareness: number; // cross-section superellipse exponent
    material: MaterialId;
  };
  frontWing: WingDesign;
  rearWing: WingDesign;
  floor: {
    length: number;
    width: number;
    under: Curve; // x = 0 at inlet .. 1 at diffuser exit ; y = floor underside gap above ground (m) (before ride height)
    material: MaterialId;
  };
  wheelbase: number;
  rideHeight: number; // m
  livery: { primary: string; secondary: string; accent: string; number: number; helmet: string; helmetStripe: string };
  driver: { name: string };
}
