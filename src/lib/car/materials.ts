export type MaterialId = "carbon" | "titanium" | "aluminum" | "steel" | "fiberglass" | "magnesium";

export interface Material {
  id: MaterialId;
  name: string;
  density: number; // kg/m^3
  costPerKg: number; // $ / kg
  /** shell thickness multiplier needed for equal stiffness (1 = carbon baseline) */
  thicknessMul: number;
  /** 0..1 how much punishment it takes before cracking */
  toughness: number;
  note: string;
}

export const MATERIALS: Record<MaterialId, Material> = {
  carbon: { id: "carbon", name: "Carbon fiber", density: 1600, costPerKg: 220, thicknessMul: 1.0, toughness: 0.55, note: "Lightest and stiffest. Shatters in big hits." },
  magnesium: { id: "magnesium", name: "Magnesium alloy", density: 1800, costPerKg: 60, thicknessMul: 1.35, toughness: 0.5, note: "Very light, mid-priced, brittle." },
  titanium: { id: "titanium", name: "Titanium", density: 4500, costPerKg: 140, thicknessMul: 0.7, toughness: 0.85, note: "Strong and tough, pricey and dense." },
  aluminum: { id: "aluminum", name: "Aluminum", density: 2700, costPerKg: 18, thicknessMul: 1.3, toughness: 0.7, note: "Cheap and forgiving. Heavy." },
  fiberglass: { id: "fiberglass", name: "Fiberglass", density: 1900, costPerKg: 12, thicknessMul: 1.7, toughness: 0.6, note: "Budget composite. Bulky shell." },
  steel: { id: "steel", name: "Steel", density: 7850, costPerKg: 6, thicknessMul: 0.5, toughness: 0.95, note: "Practically indestructible. Very heavy." },
};

export const MATERIAL_LIST = Object.values(MATERIALS);
