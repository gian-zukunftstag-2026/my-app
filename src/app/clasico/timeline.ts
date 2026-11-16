/* Drehbuch der Szene: Laufwege, Ball, Kommentar und TV-Einblendungen.
   Koordinaten: Spielfeld 105 x 68 m, x = Länge (Barça spielt nach rechts), y = Breite.

   Es gibt zwei Zeiten:
   - Videozeit v (0–120 s), das was der Zuschauer sieht
   - Spielzeit s ("Story"), in der alle Laufwege geplant sind.
   Unwichtige Phasen laufen schneller ab (mehr Spielzeit pro Videosekunde),
   die Highlights normal bzw. in Zeitlupe. */

export const W = 1280;
export const H = 720;
export const DUR = 120; // Videolänge in Sekunden
export const STORY_END = 120;

export type V = [number, number];
export type KF = [number, number, number]; // [zeit, x, y]

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const smooth = (e0: number, e1: number, x: number) => {
  const u = clamp((x - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
};
export const rnd = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/* ------------------------------------------------------------------ */
/*  Tempo: Spielzeit pro Videosekunde                                   */
/* ------------------------------------------------------------------ */

const RAW_SPEED: [number, number, number][] = [
  [-1e9, 8, 1], // Spielaufbau (Echtzeit)
  [8, 20, 2], // Pässe zu Messi
  [20, 50, 2.5], // Dribbling an fünf Gegenspielern vorbei
  [50, 58, 2.2], // Pass auf Neymar, Ballannahme
  [58, 66, 1.6], // Übersteiger
  [66, 69, 1.2], // Regenbogen-Trick
  [69, 82, 2], // Flanke
  [82, 1e9, 1], // Zeitlupe, Tor, Jubel
];
const rawSpeed = (s: number) => RAW_SPEED.find(([a, b]) => s >= a && s < b)![2];
/** Geglättetes Tempo, damit es keine Ruckler beim Wechsel gibt. */
export const speedAt = (s: number) => {
  let sum = 0;
  for (let k = -4; k <= 4; k++) sum += rawSpeed(s + k * 0.2);
  return sum / 9;
};

const DS = 0.002;
let restVideo = 0;
for (let s = 7; s < STORY_END; s += DS) restVideo += DS / speedAt(s + DS / 2);
/** Spielzeit beim Videostart (negativ: vor dem eigentlichen Drehbuch kommt Spielaufbau). */
export const S0 = 7 - (DUR - restVideo);

const VSTEP = 0.01;
const S_TAB = new Float64Array(Math.ceil(DUR / VSTEP) + 2);
{
  let s = S0;
  let v = 0;
  let i = 0;
  while (i < S_TAB.length) {
    while (v < i * VSTEP && s < STORY_END + 5) {
      v += DS / speedAt(s + DS / 2);
      s += DS;
    }
    S_TAB[i++] = s;
  }
}
/** Videozeit → Spielzeit */
export function storyAt(v: number) {
  const f = clamp(v / VSTEP, 0, S_TAB.length - 2);
  const i = Math.floor(f);
  return lerp(S_TAB[i], S_TAB[i + 1], f - i);
}

/* ------------------------------------------------------------------ */
/*  Keyframes                                                          */
/* ------------------------------------------------------------------ */

/** Weiche Bewegung durch Keyframes (Hermite, ohne Überschwingen bei Pausen). */
export function track(k: KF[], t: number): V {
  const n = k.length;
  if (t <= k[0][0]) return [k[0][1], k[0][2]];
  if (t >= k[n - 1][0]) return [k[n - 1][1], k[n - 1][2]];
  let i = 0;
  while (i < n - 2 && t > k[i + 1][0]) i++;
  const same = (a: KF, b: KF) => a[1] === b[1] && a[2] === b[2];
  const tan = (j: number): V => {
    if (j <= 0 || j >= n - 1) return [0, 0];
    if (same(k[j], k[j - 1]) || same(k[j], k[j + 1])) return [0, 0];
    const dt = k[j + 1][0] - k[j - 1][0];
    return [(k[j + 1][1] - k[j - 1][1]) / dt, (k[j + 1][2] - k[j - 1][2]) / dt];
  };
  const a = k[i];
  const b = k[i + 1];
  const dt = b[0] - a[0];
  const u = (t - a[0]) / dt;
  const m0 = tan(i);
  const m1 = tan(i + 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return [
    h00 * a[1] + h10 * dt * m0[0] + h01 * b[1] + h11 * dt * m1[0],
    h00 * a[2] + h10 * dt * m0[1] + h01 * b[2] + h11 * dt * m1[1],
  ];
}

/** Skalare Keyframes mit Smoothstep (oder linear). */
export function sk(a: [number, number][], t: number, linear = false) {
  if (t <= a[0][0]) return a[0][1];
  for (let i = 0; i < a.length - 1; i++) {
    if (t <= a[i + 1][0]) {
      const u = (t - a[i][0]) / (a[i + 1][0] - a[i][0]);
      const e = linear ? u : u * u * (3 - 2 * u);
      return lerp(a[i][1], a[i + 1][1], e);
    }
  }
  return a[a.length - 1][1];
}

export function txt(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
  stroke?: string,
  weight = 800,
) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.strokeStyle = stroke;
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/* ------------------------------------------------------------------ */
/*  Spieler & Laufwege                                                 */
/* ------------------------------------------------------------------ */

export type Team = "B" | "R" | "BK" | "RK";
export type HairStyle = "short" | "slick" | "afro" | "long" | "mohawk" | "thin" | "bun";
export type Player = {
  id: string;
  name: string;
  num: number;
  team: Team;
  height: number;
  skin: string;
  hair: string;
  style: HairStyle;
  beard?: boolean;
  label?: boolean;
  path: KF[];
  down?: [number, number][];
};

const S1 = "#e2b28c";
const S2 = "#c48a64";
const S3 = "#8d5a3b";
const HD = "#1d140d";

export const PLAYERS: Player[] = [
  // ---------------- FC Barcelona ----------------
  { id: "bravo", name: "Bravo", num: 13, team: "BK", height: 1.84, skin: S1, hair: HD, style: "short", beard: true, path: [[0, 6, 34], [120, 8, 34]] },
  { id: "alves", name: "Alves", num: 22, team: "B", height: 1.72, skin: S3, hair: "#d8c27a", style: "mohawk", path: [[0, 42, 60], [50, 55, 60], [80, 62, 58], [100, 62, 58], [110, 88, 58]] },
  { id: "pique", name: "Piqué", num: 3, team: "B", height: 1.94, skin: S1, hair: "#4a3020", style: "slick", beard: true, path: [[0, 32, 42], [50, 45, 42], [120, 46, 42]] },
  { id: "masch", name: "Mascherano", num: 14, team: "B", height: 1.74, skin: S1, hair: HD, style: "short", path: [[0, 32, 26], [50, 45, 28], [120, 46, 28]] },
  { id: "alba", name: "Alba", num: 18, team: "B", height: 1.7, skin: S1, hair: HD, style: "short", path: [[0, 42, 8], [50, 62, 6], [76, 72, 6], [100, 74, 8], [110, 89, 56]] },
  { id: "busquets", name: "Busquets", num: 5, team: "B", height: 1.89, skin: S1, hair: HD, style: "short", beard: true, label: true, path: [[0, 45, 34], [9, 45, 34], [20, 50, 40], [50, 58, 38], [100, 60, 36], [110, 88, 57]] },
  { id: "rakitic", name: "Rakitić", num: 4, team: "B", height: 1.84, skin: S1, hair: "#3a2a1a", style: "slick", beard: true, path: [[0, 52, 50], [50, 66, 48], [80, 70, 46], [100, 70, 46], [110, 90, 63]] },
  { id: "iniesta", name: "Iniesta", num: 8, team: "B", height: 1.71, skin: "#ecc3a0", hair: "#3a2a1a", style: "thin", label: true, path: [[0, 50, 22], [9, 51, 20], [11, 52, 21], [17, 55, 24], [50, 68, 22], [80, 72, 22], [100, 72, 22], [109, 92, 58]] },
  {
    id: "messi", name: "Messi", num: 10, team: "B", height: 1.7, skin: S1, hair: "#3b2414", style: "short", beard: true, label: true,
    path: [
      [0, 48, 46], [14, 46, 42], [20, 45, 40],
      [23, 49, 37], [25, 52, 39], [28, 55, 36], [30, 58, 32], [33, 61, 35], [36, 65, 38],
      [39, 67, 33], [42, 71, 29], [45, 73, 33], [48, 77, 36], [50, 79, 34],
      [56, 80, 36], [66, 76, 35], [74, 75, 34], [100, 75, 34], [106, 92, 61], [120, 92, 61],
    ],
  },
  { id: "suarez", name: "Suárez", num: 9, team: "B", height: 1.82, skin: "#d4a07a", hair: HD, style: "short", label: true, path: [[0, 74, 52], [50, 88, 44], [80, 90, 40], [100, 90, 40], [107, 93, 64]] },
  {
    id: "neymar", name: "Neymar", num: 11, team: "B", height: 1.75, skin: S2, hair: HD, style: "mohawk", label: true,
    path: [
      [0, 66, 8], [20, 72, 9], [50, 81, 9], [53, 82, 9], [58, 83, 10],
      [59, 83.3, 11], [60, 82.8, 9.5], [61, 83.3, 11], [62, 82.8, 9.5], [63, 83.4, 11], [64, 82.8, 9.6], [65, 83.2, 10.5], [66, 83.5, 10],
      [67, 85, 8.3], [68, 87.5, 8.3], [69, 89, 10.8], [74, 93, 12], [76, 94, 13], [100, 94, 13], [107, 91, 59],
    ],
  },
  // ---------------- Real Madrid ----------------
  { id: "navas", name: "Navas", num: 1, team: "RK", height: 1.85, skin: "#c79670", hair: HD, style: "short", beard: true, label: true, path: [[0, 102, 34], [80, 101, 33], [99.9, 101, 33], [100, 105.2, 36.4], [120, 105.2, 36.4]], down: [[100, 120]] },
  { id: "carvajal", name: "Carvajal", num: 15, team: "R", height: 1.73, skin: S1, hair: HD, style: "short", path: [[0, 88, 16], [76, 91, 17], [120, 91, 17]] },
  { id: "kroos", name: "Kroos", num: 8, team: "R", height: 1.83, skin: "#ecc3a0", hair: "#b8925c", style: "short", label: true, path: [[0, 58, 36], [20, 54, 38], [23, 50, 37.5], [24, 49.5, 38.5], [30, 49.5, 38.5], [60, 62, 40], [120, 66, 40]], down: [[24, 30]] },
  { id: "modric", name: "Modrić", num: 19, team: "R", height: 1.72, skin: "#ecc3a0", hair: "#a8834f", style: "long", label: true, path: [[0, 60, 26], [20, 60, 30], [28.5, 57, 33], [30, 56.5, 31], [36, 56.5, 31], [60, 68, 30], [120, 70, 30]], down: [[30, 36]] },
  { id: "ramos", name: "Ramos", num: 4, team: "R", height: 1.84, skin: "#d9a37c", hair: HD, style: "slick", beard: true, label: true, path: [[0, 80, 40], [20, 72, 38], [34.5, 66, 37], [36, 65, 40], [42, 65, 40], [60, 82, 38], [120, 84, 38]], down: [[36, 42]] },
  { id: "pepe", name: "Pepe", num: 3, team: "R", height: 1.88, skin: "#b07a55", hair: HD, style: "thin", beard: true, label: true, path: [[0, 80, 28], [20, 76, 30], [40.5, 70, 30], [42, 69, 27], [48, 69, 27], [60, 80, 28], [120, 82, 30]], down: [[42, 48]] },
  { id: "marcelo", name: "Marcelo", num: 12, team: "R", height: 1.74, skin: S3, hair: HD, style: "afro", label: true, path: [[0, 82, 50], [20, 80, 42], [46.5, 76, 35], [48, 75, 38], [54, 75, 38], [70, 84, 46], [120, 86, 46]], down: [[48, 54]] },
  { id: "james", name: "James", num: 10, team: "R", height: 1.8, skin: "#d4a07a", hair: HD, style: "slick", path: [[0, 62, 50], [50, 70, 52], [120, 74, 52]] },
  { id: "bale", name: "Bale", num: 11, team: "R", height: 1.85, skin: S1, hair: "#2b1a10", style: "bun", beard: true, path: [[0, 64, 60], [50, 72, 58], [120, 76, 58]] },
  { id: "benzema", name: "Benzema", num: 9, team: "R", height: 1.85, skin: "#c08a62", hair: HD, style: "short", beard: true, path: [[0, 55, 46], [50, 64, 46], [120, 68, 46]] },
  {
    id: "ronaldo", name: "Ronaldo", num: 7, team: "R", height: 1.87, skin: "#d9a37c", hair: HD, style: "slick", label: true,
    path: [[0, 58, 14], [20, 66, 14], [50, 80, 13], [58, 85.5, 11], [66, 85, 11], [67.5, 84.8, 10.5], [68.5, 85.5, 11.5], [120, 85.5, 11.5]],
    down: [[68.5, 74]],
  },
];

const PMAP: Record<string, Player> = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
const PIDX: Record<string, number> = Object.fromEntries(PLAYERS.map((p, i) => [p.id, i]));

/* ------------------------------------------------------------------ */
/*  Spielaufbau vor dem Drehbuch (Spielzeit S0 … 8): Tiki-Taka          */
/* ------------------------------------------------------------------ */

const PRO_END = 8;

function prologuePos(id: string, s: number): V {
  const p = PMAP[id];
  const i = PIDX[id];
  const [bx, by] = track(p.path, PRO_END);
  const keeper = p.team === "BK" || p.team === "RK";
  const wander = 1 - smooth(3, PRO_END, s);
  // Mannschaften rücken im Laufe des Aufbaus nach vorne
  const shift = keeper ? 0 : (p.team === "B" ? -14 : -11) * (1 - smooth(S0, 2, s));
  const amp = keeper ? 0.8 : 1;
  const ox = amp * (4 * Math.sin(0.31 * s + i * 1.7) + 2.2 * Math.sin(0.83 * s + i * 2.9));
  const oy = amp * (3.5 * Math.sin(0.27 * s + i * 2.3) + 2 * Math.sin(0.71 * s + i * 0.7));
  let x = bx + shift + ox * wander;
  let y = by + oy * wander;
  // Real presst: die Spieler in Ballnähe laufen den Ballführenden an
  if (p.team === "R") {
    const b = ballAt(s);
    const d = Math.hypot(b.x - x, b.y - y);
    const w = 0.6 * Math.exp(-d / 11) * (1 - smooth(4, PRO_END, s));
    x += (b.x - x) * w;
    y += (b.y - y) * w;
  }
  return [x, clamp(y, 1, 67)];
}

export const pos = (id: string, s: number): V => (s < PRO_END ? prologuePos(id, s) : track(PMAP[id].path, s));

/* ------------------------------------------------------------------ */
/*  Ball                                                               */
/* ------------------------------------------------------------------ */

type Ref = string | V;
type Seg =
  | { t0: number; t1: number; k: "own"; who: string }
  | { t0: number; t1: number; k: "fly"; from: Ref; to: Ref; h: number; z0?: number; z1?: number }
  | { t0: number; t1: number; k: "fix"; p: V; z?: number };

export const BALL_REST: V = [106.9, 37.2];

/** Schussbewegungen: [Spieler, Spielzeit, Art]. */
export const KICKS: [string, number, "pass" | "flick" | "soft"][] = [
  ["busquets", 9, "pass"],
  ["iniesta", 17, "pass"],
  ["messi", 50, "pass"],
  ["neymar", 57.5, "soft"],
  ["neymar", 66, "flick"],
  ["neymar", 76, "pass"],
];

// Passfolge im Spielaufbau: [Empfänger, Flughöhe]
const TIKI: [string, number][] = [
  ["pique", 0],
  ["busquets", 0.2],
  ["alba", 0.3],
  ["iniesta", 0.2],
  ["masch", 0.2],
  ["pique", 0.2],
  ["alves", 4.5],
  ["rakitic", 0.2],
  ["messi", 0.2],
  ["iniesta", 0.2],
  ["busquets", 0.2],
];
const OWN = 2.7;
const PASS = 1.1;

const SEGS: Seg[] = [];
{
  let t = S0;
  for (let i = 0; i < TIKI.length; i++) {
    const [who, h] = TIKI[i];
    if (i > 0) {
      const from = TIKI[i - 1][0];
      SEGS.push({ t0: t, t1: t + PASS, k: "fly", from, to: who, h });
      KICKS.push([from, t, "pass"]);
      t += PASS;
    }
    if (i < TIKI.length - 1) {
      SEGS.push({ t0: t, t1: t + OWN, k: "own", who });
      t += OWN;
    } else {
      SEGS.push({ t0: t, t1: 9, k: "own", who }); // Busquets hat den Ball bis zum Pass auf Iniesta
    }
  }
}
SEGS.push(
  { t0: 9, t1: 11, k: "fly", from: "busquets", to: "iniesta", h: 0.2 },
  { t0: 11, t1: 17, k: "own", who: "iniesta" },
  { t0: 17, t1: 20, k: "fly", from: "iniesta", to: "messi", h: 0.6 },
  { t0: 20, t1: 50, k: "own", who: "messi" },
  { t0: 50, t1: 53, k: "fly", from: "messi", to: "neymar", h: 4.5 },
  { t0: 53, t1: 57.5, k: "own", who: "neymar" },
  { t0: 57.5, t1: 58, k: "fly", from: "neymar", to: [84.2, 10.3], h: 0 },
  { t0: 58, t1: 66, k: "fix", p: [84.2, 10.3] },
  { t0: 66, t1: 69, k: "fly", from: [84.2, 10.3], to: "neymar", h: 3.2 }, // Regenbogen über Ronaldo
  { t0: 69, t1: 76, k: "own", who: "neymar" },
  { t0: 76, t1: 100, k: "fix", p: [94.8, 13.5] }, // Flanke & Zeitlupe: im 3D-Teil berechnet
  { t0: 100, t1: 1e9, k: "fix", p: BALL_REST },
);

function ownBall(who: string, t: number): V {
  const p = pos(who, t);
  const q = pos(who, t + 0.2);
  let dx = q[0] - p[0];
  let dy = q[1] - p[1];
  const L = Math.hypot(dx, dy);
  if (L < 0.03) {
    dx = 1;
    dy = 0;
  } else {
    dx /= L;
    dy /= L;
  }
  const reach = 0.5 + 0.2 * Math.abs(Math.sin(t * 5));
  const w = Math.sin(t * 7) * 0.1;
  return [p[0] + dx * reach - dy * w, p[1] + dy * reach + dx * w];
}

const resolve = (r: Ref, t: number): V => (typeof r === "string" ? ownBall(r, t) : r);

export function ballAt(t: number): { x: number; y: number; z: number } {
  const s = SEGS.find((g) => t >= g.t0 && t < g.t1) ?? (t < SEGS[0].t0 ? SEGS[0] : SEGS[SEGS.length - 1]);
  if (s.k === "own") {
    const p = ownBall(s.who, t);
    return { x: p[0], y: p[1], z: 0 };
  }
  if (s.k === "fix") return { x: s.p[0], y: s.p[1], z: s.z ?? 0 };
  let u = (t - s.t0) / (s.t1 - s.t0);
  if (s.h < 1) u = 1 - Math.pow(1 - u, 1.6); // Flachpass rollt aus
  const a = resolve(s.from, s.t0);
  const b = resolve(s.to, s.t1);
  const z = lerp(s.z0 ?? 0, s.z1 ?? 0, u) + 4 * s.h * u * (1 - u);
  return { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), z };
}

/* ------------------------------------------------------------------ */
/*  Zeitlupe: Gelenkwinkel für Messi (τ = s − 82)                       */
/* ------------------------------------------------------------------ */

/** hx/hy = Hüfte (Meter, hx Richtung Tor), th = Körperneigung (Grad, negativ = nach hinten),
 *  kick/sup = Beinwinkel (rad, 0 = nach unten, positiv = nach vorne). */
export function messiBike(tau: number) {
  const bob = tau < 4.5 ? Math.sin(tau * 3) * 0.01 : 0;
  return {
    hx: sk([[0, 0], [5.5, 0.05], [9, 0.4]], tau),
    hy: sk([[0, 0.94], [4.5, 0.94], [5.5, 0.78], [7, 1.38], [7.6, 1.32], [9, 0.22], [18, 0.22]], tau) + bob,
    th: sk([[0, 0], [4.5, 0], [5.5, -10], [7, -118], [7.6, -135], [9, -95], [18, -95]], tau, true),
    kick: sk([[0, 0.1], [4.5, 0.1], [5.5, -0.5], [6.6, 0.6], [7, 1.25], [7.6, 2.0], [9, 1.0], [18, 1.0]], tau, true),
    sup: sk([[0, -0.1], [4.5, -0.1], [5.5, 0.5], [7, -0.2], [7.6, 0.3], [9, 0.5], [18, 0.5]], tau),
    armF: sk([[0, 0.3], [5.5, 0.6], [7, 2.2], [9, 1.6]], tau),
    armB: sk([[0, -0.3], [5.5, -0.8], [7, -1.6], [9, -1.2]], tau),
  };
}

/* ------------------------------------------------------------------ */
/*  TV-Einblendungen                                                   */
/* ------------------------------------------------------------------ */

export const GOAL_T = 94.9;

const CAPS: [number, number, string][] = [
  [S0 + 7, S0 + 16, "Barça hat den Ball – Tiki-Taka im Clásico"],
  [S0 + 18, S0 + 27, "Real presst hoch, doch Barça bleibt ruhig am Ball"],
  [S0 + 29, S0 + 38, "Busquets, Iniesta, Rakitić – der Ball läuft"],
  [S0 + 39.5, 14, "Busquets spielt auf Iniesta …"],
  [14, 20, "… und Iniesta findet Messi!"],
  [20, 44, "Messi tanzt durch die Abwehr: Kroos, Modrić, Ramos, Pepe …"],
  [44, 50.5, "… und Marcelo! FÜNF Gegenspieler!"],
  [50.5, 58, "Messi schickt Neymar auf den linken Flügel"],
  [58, 66, "Neymar gegen Cristiano Ronaldo – Übersteiger …"],
  [66, 71, "REGENBOGEN-TRICK! Ronaldo ist düpiert!"],
  [71, 81.8, "Neymar flankt … Messi steht 30 Meter vor dem Tor"],
  [82.5, 88, "Er wird doch nicht etwa …?!"],
  [88, 94.5, "FALLRÜCKZIEHER AUS 30 METERN!"],
  [94.5, 99.6, "… GENAU INS ECK! Navas ist chancenlos!"],
  [100.4, 111.5, "TOOOR für Barça! Was für ein Treffer von Lionel Messi!"],
];

export type Tag = { x: number; y: number; name: string; hl: boolean };

/** v = Videozeit, s = Spielzeit */
export function drawHud(ctx: CanvasRenderingContext2D, v: number, s: number, tags: Tag[]) {
  ctx.clearRect(0, 0, W, H);
  const cine = s >= 80 && s < 100;

  // Namensschilder über den Köpfen
  if (v > 7 && s < 80) {
    for (const g of tags) {
      ctx.font = `800 15px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const w = ctx.measureText(g.name).width + 16;
      ctx.fillStyle = g.hl ? "rgba(255,212,0,0.92)" : "rgba(8,12,28,0.72)";
      ctx.beginPath();
      ctx.roundRect(g.x - w / 2, g.y - 26, w, 22, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(g.x - 5, g.y - 4);
      ctx.lineTo(g.x + 5, g.y - 4);
      ctx.lineTo(g.x, g.y + 2);
      ctx.fill();
      txt(ctx, g.name, g.x, g.y - 15, 15, g.hl ? "#1b1b1b" : "#fff");
    }
  }

  // Kino-Balken in der Zeitlupe
  if (cine) {
    const bh = 56 * smooth(80, 81, s) * (1 - smooth(99.4, 100, s));
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, bh);
    ctx.fillRect(0, H - bh, W, bh);
    if (bh > 40) {
      if (Math.sin(s * 5) > -0.3) {
        ctx.fillStyle = "#e53935";
        ctx.beginPath();
        ctx.arc(W - 200, 28, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      txt(ctx, "ZEITLUPE", W - 120, 29, 22, "#fff");
    }
  }

  // Spielstand
  if (v > 6.5 && s < 112.5) {
    const a = smooth(6.5, 7.5, v) * (1 - smooth(111.5, 112.5, s));
    ctx.save();
    ctx.globalAlpha = a;
    const x = 28;
    const y = cine ? 70 : 24;
    ctx.fillStyle = "rgba(8,12,28,0.88)";
    ctx.beginPath();
    ctx.roundRect(x, y, 330, 46, 8);
    ctx.fill();
    ctx.fillStyle = "#004d98";
    ctx.fillRect(x + 10, y + 13, 10, 20);
    ctx.fillStyle = "#a50044";
    ctx.fillRect(x + 20, y + 13, 10, 20);
    txt(ctx, "FCB", x + 62, y + 24, 22, "#fff");
    const goal = s >= GOAL_T;
    txt(ctx, `${goal ? 1 : 0} – 0`, x + 140, y + 24, 24, goal ? "#ffd400" : "#fff");
    txt(ctx, "RMA", x + 218, y + 24, 22, "#fff");
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(x + 248, y + 13, 14, 20);
    const clock = 77 * 60 + 5 + v;
    const mm = Math.floor(clock / 60);
    const ss = Math.floor(clock % 60).toString().padStart(2, "0");
    txt(ctx, `${mm}:${ss}`, x + 298, y + 24, 18, "#9fb3d9", "center", undefined, 700);
    ctx.restore();
  }

  // Kommentar
  const c = v > 7 ? CAPS.find(([a, b]) => s >= a && s < b) : undefined;
  if (c) {
    const fade = 0.4 * speedAt(s);
    const a = Math.min(smooth(c[0], c[0] + fade, s), 1 - smooth(c[1] - fade, c[1], s));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `800 28px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = ctx.measureText(c[2]).width + 56;
    const y = cine ? H - 128 : H - 92;
    ctx.fillStyle = "rgba(8,12,28,0.85)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, y, w, 52, 10);
    ctx.fill();
    ctx.fillStyle = "#a50044";
    ctx.fillRect(W / 2 - w / 2, y + 48, w, 4);
    txt(ctx, c[2], W / 2, y + 26, 28, "#fff");
    ctx.restore();
  }

  // TOR!
  if (s >= GOAL_T && s < 100) {
    const k = s - GOAL_T;
    const sc = 1 + 0.1 * Math.sin(k * 10) * Math.exp(-k);
    ctx.save();
    ctx.translate(W / 2, 210);
    ctx.scale(sc, sc);
    txt(ctx, "TOOOOR!", 0, 0, 120, "#ffd400", "center", "#7a0030");
    ctx.restore();
  }

  // Jubel
  if (s >= 100 && s < 112) {
    for (let i = 0; i < 170; i++) {
      const sp = 90 + rnd(i + 7) * 150;
      const x = rnd(i) * W + Math.sin(s * 2 + i) * 30;
      const y = (((s - 100) * sp + rnd(i + 3) * (H + 40)) % (H + 40)) - 20;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s * 4 + i);
      ctx.fillStyle = ["#a50044", "#004d98", "#ffd400", "#ffffff"][i % 4];
      ctx.fillRect(-5, -3, 10, 6);
      ctx.restore();
    }
    if (s < 106) {
      const a = 1 - smooth(104.5, 106, s);
      const sc = 1 + 0.06 * Math.sin((s - 100) * 9);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, 150);
      ctx.scale(sc, sc);
      txt(ctx, "GOOOL!", 0, 0, 110, "#ffd400", "center", "#7a0030");
      txt(ctx, "LIONEL MESSI · 79'", 0, 78, 34, "#fff", "center", "rgba(0,0,0,0.8)");
      ctx.restore();
    }
  }

  // Intro
  if (v < 8) {
    const a = 1 - smooth(5.5, 7.5, v);
    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(5,8,20,0.2)");
    g.addColorStop(0.5, "rgba(5,8,20,0.75)");
    g.addColorStop(1, "rgba(5,8,20,0.2)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const sc = 1 + v * 0.01;
    ctx.translate(W / 2, H / 2);
    ctx.scale(sc, sc);
    txt(ctx, "EL CLÁSICO", 0, -70, 96, "#ffd400", "center", "#3a0018");
    txt(ctx, "FC Barcelona  vs.  Real Madrid", 0, 20, 40, "#fff", "center", "rgba(0,0,0,0.6)");
    txt(ctx, "Camp Nou · Saison 2014/15", 0, 74, 24, "#c9d6f0", "center", "rgba(0,0,0,0.6)", 600);
    ctx.fillStyle = "#004d98";
    ctx.fillRect(-160, 112, 160, 6);
    ctx.fillStyle = "#a50044";
    ctx.fillRect(0, 112, 160, 6);
    ctx.restore();
  }

  // Endstand
  if (s >= 112) {
    const a = smooth(112, 113.5, s);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(5,8,20,0.7)";
    ctx.fillRect(0, 0, W, H);
    txt(ctx, "ENDSTAND", W / 2, H / 2 - 120, 26, "#9fb3d9", "center", undefined, 700);
    txt(ctx, "FC BARCELONA", W / 2 - 110, H / 2 - 30, 44, "#fff", "right");
    txt(ctx, "1 : 0", W / 2, H / 2 - 30, 72, "#ffd400");
    txt(ctx, "REAL MADRID", W / 2 + 110, H / 2 - 30, 44, "#fff", "left");
    txt(ctx, "⚽  Messi 79'  –  Fallrückzieher aus 30 Metern", W / 2, H / 2 + 60, 30, "#fff", "center", undefined, 600);
    txt(ctx, "Vorlage: Neymar", W / 2, H / 2 + 105, 22, "#9fb3d9", "center", undefined, 600);
    ctx.restore();
  }

  // Blenden
  const fade = Math.max(
    1 - smooth(0, 0.8, v),
    1 - Math.abs(s - 82) / 0.45,
    1 - Math.abs(s - 100) / 0.45,
    smooth(DUR - 1.5, DUR, v),
  );
  if (fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(fade, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
  }
}
