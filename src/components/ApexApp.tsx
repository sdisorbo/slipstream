"use client";

import { useState } from "react";
import DesignRoom from "@/components/design/DesignRoom";
import PracticeRoom from "@/components/practice/PracticeRoom";

export default function ApexApp() {
  const [view, setView] = useState<"design" | "practice">("design");
  return view === "design" ? <DesignRoom onNav={setView} /> : <PracticeRoom onBack={() => setView("design")} />;
}
