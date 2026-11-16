import type { Metadata } from "next";
import Clasico3D from "./Clasico3D";

export const metadata: Metadata = {
  title: "El Clásico 3D – Messis Traumtor",
};

export default function ClasicoPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col items-center gap-6 px-4 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">El Clásico 2015 – Messis Traumtor in 3D</h1>
        <p className="text-neutral-400 mt-1">3D-Animation · 2:00 min · Klick aufs Bild für Play/Pause</p>
      </div>
      <Clasico3D />
    </main>
  );
}
