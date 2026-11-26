# Apex

Design your own Formula car, then race it every 30 minutes. Next.js + Supabase (same stack as Track).

```bash
npm install
npm run dev -- -p 3100
```

## Status: vertical slice 1 — design room
- `src/lib/car/` — pure model: curves (monotone cubic), shape/geometry, aero + mass, rules, flow field
- `src/components/design/` — 3D viewport (three.js), SVG sketch editor, design room UI
- Design autosaves to `localStorage` (`apex.design.v1`); Supabase persistence comes with the garage.

Next: deterministic physics core, practice lap on the oval, one lockstep race.
