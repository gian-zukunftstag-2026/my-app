"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  BALL_REST,
  DUR,
  GOAL_T,
  H,
  KICKS,
  PLAYERS,
  S0,
  STORY_END,
  W,
  ballAt,
  clamp,
  drawHud,
  lerp,
  messiBike,
  pos,
  rnd,
  smooth,
  speedAt,
  storyAt,
  type Player,
  type Tag,
} from "./timeline";

/* ------------------------------------------------------------------ */
/*  Konstanten & kleine Helfer                                         */
/* ------------------------------------------------------------------ */

const X0 = 52.5; // Spielfeldmitte → Weltursprung
const Y0 = 34;
const HIP = 0.94; // Hüfthöhe einer 1,80 m großen Figur
const BALL_R = 0.11;
const TAU = Math.PI * 2;

const bump = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));
const angLerp = (a: number, b: number, u: number) => {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * u;
};

type Pose3 = {
  bx: number; by: number; bz: number; pitch: number; roll: number; twist: number;
  legL: number; legR: number; kneeL: number; kneeR: number; legSpread: number;
  armL: number; armR: number; elbowL: number; elbowR: number; spreadL: number; spreadR: number;
  headPitch: number;
};

const basePose = (): Pose3 => ({
  bx: 0, by: HIP, bz: 0, pitch: 0, roll: 0, twist: 0,
  legL: 0, legR: 0, kneeL: 0.06, kneeR: 0.06, legSpread: 0.03,
  armL: 0, armR: 0, elbowL: -0.25, elbowR: -0.25, spreadL: 0.08, spreadR: 0.08,
  headPitch: 0,
});

function mixPose(a: Pose3, b: Pose3, u: number): Pose3 {
  const r = { ...a };
  for (const k of Object.keys(a) as (keyof Pose3)[]) r[k] = lerp(a[k], b[k], u);
  return r;
}

/* ------------------------------------------------------------------ */
/*  Spielerfigur (anatomisch modelliert, Maße für 1,80 m)              */
/* ------------------------------------------------------------------ */

const lathe = (pts: [number, number][], seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

function makeGeos() {
  return {
    // Rumpf (Taille → Schultern → Halsansatz)
    torso: lathe([[0.138, 0], [0.145, 0.06], [0.156, 0.14], [0.172, 0.24], [0.178, 0.32], [0.168, 0.38], [0.14, 0.43], [0.09, 0.465], [0.055, 0.475]]),
    pelvis: lathe([[0.148, -0.13], [0.162, -0.06], [0.166, 0.03], [0.15, 0.13]]),
    shortsLeg: new THREE.CylinderGeometry(0.098, 0.106, 0.2, 18),
    neck: new THREE.CylinderGeometry(0.05, 0.057, 0.12, 14),
    collar: new THREE.TorusGeometry(0.06, 0.013, 8, 24),
    // Kopf
    head: new THREE.SphereGeometry(0.105, 32, 24),
    jaw: new THREE.SphereGeometry(0.076, 24, 16),
    ear: new THREE.SphereGeometry(0.026, 12, 10),
    nose: new THREE.ConeGeometry(0.016, 0.045, 10),
    eyeW: new THREE.SphereGeometry(0.0145, 12, 10),
    iris: new THREE.SphereGeometry(0.0085, 10, 8),
    brow: new THREE.BoxGeometry(0.036, 0.009, 0.012),
    mouth: new THREE.BoxGeometry(0.04, 0.007, 0.012),
    hairCap: new THREE.SphereGeometry(0.112, 28, 16, 0, TAU, 0, Math.PI * 0.52),
    hairLong: new THREE.SphereGeometry(0.113, 28, 18, 0, TAU, 0, Math.PI * 0.78),
    hairAfro: new THREE.SphereGeometry(0.135, 24, 18),
    hairBun: new THREE.SphereGeometry(0.038, 14, 10),
    ridge: new THREE.BoxGeometry(0.034, 0.05, 0.17),
    beard: new THREE.SphereGeometry(0.082, 24, 12, 0, TAU, Math.PI * 0.45, Math.PI * 0.55),
    // Arme
    shoulder: new THREE.SphereGeometry(0.066, 18, 14),
    sleeve: new THREE.CylinderGeometry(0.066, 0.057, 0.17, 18),
    upperArm: new THREE.CapsuleGeometry(0.046, 0.2, 6, 14),
    elbow: new THREE.SphereGeometry(0.043, 14, 10),
    forearm: lathe([[0.032, -0.25], [0.039, -0.16], [0.046, -0.05], [0.043, 0]], 16),
    hand: new THREE.BoxGeometry(0.052, 0.085, 0.027),
    thumb: new THREE.CapsuleGeometry(0.011, 0.03, 4, 8),
    // Beine
    thigh: lathe([[0.055, -0.43], [0.066, -0.32], [0.08, -0.17], [0.088, -0.05], [0.082, 0]], 20),
    knee: new THREE.SphereGeometry(0.056, 16, 12),
    shin: lathe([[0.035, -0.4], [0.039, -0.32], [0.052, -0.2], [0.059, -0.11], [0.053, -0.03], [0.05, 0]], 20),
    sockBand: new THREE.CylinderGeometry(0.057, 0.058, 0.035, 18),
    boot: new THREE.BoxGeometry(0.088, 0.062, 0.19),
    toe: new THREE.SphereGeometry(0.046, 16, 10),
    sole: new THREE.BoxGeometry(0.094, 0.016, 0.262),
  };
}
type Geos = ReturnType<typeof makeGeos>;

type Kit = {
  jersey: THREE.Texture;
  sleeve: THREE.Texture | null;
  shirt: string;
  trim: string;
  shorts: string;
  socks: string;
  boots: string;
};

class Humanoid {
  root = new THREE.Group();
  body = new THREE.Group();
  chest = new THREE.Group();
  head = new THREE.Group();
  sh: THREE.Group[] = [];
  el: THREE.Group[] = [];
  hip: THREE.Group[] = [];
  kn: THREE.Group[] = [];
  foot: THREE.Object3D[] = [];

  constructor(G: Geos, p: Player, k: Kit) {
    const mat = (c: string, rough = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    const shirt = k.sleeve ? new THREE.MeshStandardMaterial({ map: k.sleeve, roughness: 0.7 }) : mat(k.shirt, 0.7);
    const trim = mat(k.trim, 0.6);
    const shorts = mat(k.shorts, 0.7);
    const socks = mat(k.socks, 0.8);
    const skin = mat(p.skin, 0.55);
    const lip = mat(new THREE.Color(p.skin).multiplyScalar(0.6).getStyle(), 0.5);
    const hair = mat(p.hair, 0.95);
    const boots = mat(k.boots, 0.3);
    const sole = mat("#f1f1f1", 0.5);
    const white = mat("#f5f5f5", 0.3);
    const dark = mat("#1a120c", 0.4);
    const jersey = new THREE.MeshStandardMaterial({ map: k.jersey, roughness: 0.7 });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z);
      me.castShadow = cast;
      parent.add(me);
      return me;
    };

    this.root.add(this.body);
    this.root.scale.setScalar(p.height / 1.8);

    // Becken & Oberkörper
    add(this.body, G.pelvis, shorts).scale.set(1.08, 1, 0.82);
    this.chest.position.y = 0.11;
    this.body.add(this.chest);
    add(this.chest, G.torso, jersey).scale.set(1.12, 1, 0.74);
    add(this.chest, G.collar, trim, 0, 0.465, 0, false).rotation.x = Math.PI / 2;
    add(this.chest, G.neck, skin, 0, 0.5, 0);

    // Kopf mit Gesicht
    this.head.position.y = 0.55;
    this.chest.add(this.head);
    add(this.head, G.head, skin, 0, 0.1, 0).scale.set(0.92, 1.1, 1.0);
    add(this.head, G.jaw, skin, 0, 0.045, 0.022).scale.set(0.95, 0.8, 1);
    for (const s of [1, -1]) {
      add(this.head, G.ear, skin, 0.097 * s, 0.1, -0.005, false).scale.set(0.45, 1, 0.75);
      add(this.head, G.eyeW, white, 0.036 * s, 0.112, 0.086, false);
      add(this.head, G.iris, dark, 0.036 * s, 0.112, 0.097, false);
      add(this.head, G.brow, mat(p.hair, 0.9), 0.036 * s, 0.137, 0.094, false).rotation.z = -0.12 * s;
    }
    add(this.head, G.nose, skin, 0, 0.088, 0.104, false).rotation.x = Math.PI / 2;
    add(this.head, G.mouth, lip, 0, 0.047, 0.094, false);
    switch (p.style) {
      case "afro":
        add(this.head, G.hairAfro, hair, 0, 0.13, -0.02).scale.set(1, 0.9, 1);
        break;
      case "long":
        add(this.head, G.hairLong, hair, 0, 0.106, -0.008).scale.set(0.98, 1.08, 1.04);
        break;
      case "mohawk":
        add(this.head, G.hairCap, hair, 0, 0.106, -0.006).scale.set(0.95, 0.95, 1.02);
        add(this.head, G.ridge, hair, 0, 0.205, -0.01);
        break;
      case "thin":
        add(this.head, G.hairCap, mat(new THREE.Color(p.hair).lerp(new THREE.Color(p.skin), 0.55).getStyle(), 0.9), 0, 0.104, -0.012).scale.set(0.95, 0.92, 1.02);
        break;
      case "bun":
        add(this.head, G.hairCap, hair, 0, 0.108, -0.006).scale.set(0.96, 1, 1.03);
        add(this.head, G.hairBun, hair, 0, 0.2, -0.07);
        break;
      case "slick":
        add(this.head, G.hairCap, hair, 0, 0.115, -0.004).scale.set(0.96, 1.05, 1.05);
        break;
      default:
        add(this.head, G.hairCap, hair, 0, 0.107, -0.008).scale.set(0.96, 1, 1.03);
    }
    if (p.beard) add(this.head, G.beard, hair, 0, 0.075, 0.012, false).scale.set(0.98, 1, 1.02);

    for (const s of [1, -1]) {
      // Index 0 = links (+X), 1 = rechts (−X); Figur schaut nach +Z
      const sh = new THREE.Group();
      sh.position.set(0.205 * s, 0.385, 0);
      this.chest.add(sh);
      add(sh, G.shoulder, shirt);
      add(sh, G.sleeve, shirt, 0, -0.075, 0);
      add(sh, G.upperArm, skin, 0, -0.2, 0);
      const el = new THREE.Group();
      el.position.y = -0.32;
      sh.add(el);
      add(el, G.elbow, skin);
      add(el, G.forearm, skin);
      add(el, G.hand, skin, 0, -0.3, 0.004);
      add(el, G.thumb, skin, -0.024 * s, -0.28, 0.018).rotation.z = 0.5 * s;

      const hp = new THREE.Group();
      hp.position.set(0.093 * s, -0.02, 0);
      this.body.add(hp);
      add(hp, G.shortsLeg, shorts, 0, -0.085, 0);
      add(hp, G.thigh, skin);
      const kn = new THREE.Group();
      kn.position.y = -0.43;
      hp.add(kn);
      add(kn, G.knee, skin);
      add(kn, G.shin, socks);
      add(kn, G.sockBand, trim, 0, -0.07, 0, false);
      const ft = new THREE.Group();
      ft.position.y = -0.42;
      kn.add(ft);
      add(ft, G.boot, boots, 0, -0.03, 0.03);
      add(ft, G.toe, boots, 0, -0.036, 0.12).scale.set(0.95, 0.66, 1.15);
      add(ft, G.sole, sole, 0, -0.066, 0.035);
      const tip = new THREE.Object3D();
      tip.position.set(0, -0.03, 0.12);
      ft.add(tip);

      this.sh.push(sh);
      this.el.push(el);
      this.hip.push(hp);
      this.kn.push(kn);
      this.foot.push(tip);
    }
  }

  apply(p: Pose3) {
    this.body.position.set(p.bx, p.by, p.bz);
    this.body.rotation.set(p.pitch, 0, p.roll);
    this.chest.rotation.set(0, p.twist, 0);
    this.hip[0].rotation.set(p.legL, 0, p.legSpread);
    this.hip[1].rotation.set(p.legR, 0, -p.legSpread);
    this.kn[0].rotation.x = p.kneeL;
    this.kn[1].rotation.x = p.kneeR;
    this.sh[0].rotation.set(p.armL, 0, 0.1 + p.spreadL);
    this.sh[1].rotation.set(p.armR, 0, -0.1 - p.spreadR);
    this.el[0].rotation.x = p.elbowL;
    this.el[1].rotation.x = p.elbowR;
    this.head.rotation.set(p.headPitch, -p.twist * 0.8, 0);
  }
}

/* ------------------------------------------------------------------ */
/*  Texturen                                                           */
/* ------------------------------------------------------------------ */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 8;
  return tx;
}

function pitchTexture() {
  const S = 24;
  const PW = 121;
  const PH = 84;
  return canvasTex(PW * S, PH * S, (c) => {
    const P = (v: number) => (v + 8) * S;
    c.fillStyle = "#2b772f";
    c.fillRect(0, 0, PW * S, PH * S);
    for (let i = -2; i < 16; i++) {
      if (i % 2 === 0) {
        c.fillStyle = "#33873a";
        c.fillRect(P(i * 7.5), 0, 7.5 * S, PH * S);
      }
    }
    for (let i = 0; i < 90000; i++) {
      c.fillStyle = rnd(i) < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.035)";
      c.fillRect(rnd(i * 3.1 + 1) * PW * S, rnd(i * 7.3 + 2) * PH * S, 2, 3);
    }
    c.strokeStyle = "rgba(255,255,255,0.92)";
    c.fillStyle = "rgba(255,255,255,0.92)";
    c.lineWidth = 0.12 * S;
    const rect = (x: number, y: number, w: number, h: number) => c.strokeRect(P(x), P(y), w * S, h * S);
    const arc = (x: number, y: number, r: number, a0 = 0, a1 = TAU) => {
      c.beginPath();
      c.arc(P(x), P(y), r * S, a0, a1);
      c.stroke();
    };
    const dot = (x: number, y: number) => {
      c.beginPath();
      c.arc(P(x), P(y), 0.22 * S, 0, TAU);
      c.fill();
    };
    rect(0, 0, 105, 68);
    c.beginPath();
    c.moveTo(P(52.5), P(0));
    c.lineTo(P(52.5), P(68));
    c.stroke();
    arc(52.5, 34, 9.15);
    dot(52.5, 34);
    dot(11, 34);
    dot(94, 34);
    rect(0, 34 - 20.16, 16.5, 40.32);
    rect(88.5, 34 - 20.16, 16.5, 40.32);
    rect(0, 34 - 9.16, 5.5, 18.32);
    rect(99.5, 34 - 9.16, 5.5, 18.32);
    const a = Math.acos(5.5 / 9.15);
    arc(11, 34, 9.15, -a, a);
    arc(94, 34, 9.15, Math.PI - a, Math.PI + a);
    arc(0, 0, 1, 0, Math.PI / 2);
    arc(105, 0, 1, Math.PI / 2, Math.PI);
    arc(0, 68, 1, -Math.PI / 2, 0);
    arc(105, 68, 1, Math.PI, Math.PI * 1.5);
  });
}

function jerseyTexture(p: Player) {
  return canvasTex(512, 256, (c) => {
    if (p.team === "B") {
      for (let i = 0; i < 12; i++) {
        c.fillStyle = i % 2 ? "#a50044" : "#004d98";
        c.fillRect((i * 512) / 12, 0, 512 / 12 + 1, 256);
      }
    } else {
      c.fillStyle = p.team === "R" ? "#f5f5f5" : p.team === "RK" ? "#2bb673" : "#e8c400";
      c.fillRect(0, 0, 512, 256);
      if (p.team === "R") {
        c.fillStyle = "#c9a227";
        c.fillRect(124, 0, 5, 256);
        c.fillRect(383, 0, 5, 256);
      }
    }
    c.fillStyle = p.team === "R" ? "#c9a227" : "#101828";
    c.fillRect(0, 0, 512, 12);
    const ink = p.team === "B" ? "#ffd400" : p.team === "R" ? "#1b2a5a" : "#111";
    c.fillStyle = ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "800 30px system-ui, sans-serif";
    c.fillText(p.name.toUpperCase(), 256, 48);
    c.font = "900 120px system-ui, sans-serif";
    c.fillText(String(p.num), 256, 150);
    c.font = "900 44px system-ui, sans-serif";
    c.fillText(String(p.num), 22, 120);
    c.fillText(String(p.num), 512 + 22 - 512, 120);
    c.beginPath();
    c.arc(470, 70, 14, 0, TAU);
    c.fillStyle = p.team === "B" ? "#ffd400" : "#c9a227";
    c.fill();
  });
}

function sleeveTexture() {
  const tx = canvasTex(128, 32, (c) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? "#a50044" : "#004d98";
      c.fillRect(i * 16, 0, 16, 32);
    }
  });
  return tx;
}

function ballTexture() {
  return canvasTex(256, 128, (c) => {
    c.fillStyle = "#fafafa";
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = "#151515";
    const spots: [number, number][] = [[32, 64], [96, 30], [96, 98], [160, 64], [224, 30], [224, 98], [0, 20], [128, 10], [128, 118]];
    for (const [x, y] of spots) {
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2;
        c.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
      }
      c.closePath();
      c.fill();
    }
  });
}

function crowdTexture() {
  const tx = canvasTex(512, 512, (c) => {
    c.fillStyle = "#151826";
    c.fillRect(0, 0, 512, 512);
    const cols = ["#a50044", "#004d98", "#a50044", "#004d98", "#edbb00", "#e8e8e8", "#3a3f55"];
    const skins = ["#e2b28c", "#c48a64", "#8d5a3b", "#ecc3a0"];
    for (let r = 0; r < 32; r++) {
      c.fillStyle = "#0e1019";
      c.fillRect(0, r * 16 + 14, 512, 2);
      for (let k = 0; k < 64; k++) {
        if (rnd(r * 97 + k) < 0.06) continue; // leere Plätze
        const x = k * 8 + (r % 2) * 4;
        const y = r * 16;
        c.fillStyle = cols[Math.floor(rnd(r * 131 + k * 7) * cols.length)];
        c.fillRect(x + 1, y + 7, 6, 8);
        c.fillStyle = skins[Math.floor(rnd(r * 17 + k * 3) * skins.length)];
        c.beginPath();
        c.arc(x + 4, y + 5, 2.4, 0, TAU);
        c.fill();
      }
    }
  });
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

function adTexture() {
  const tx = canvasTex(1024, 64, (c) => {
    const words = ["EL CLÁSICO", "CAMP NOU", "TEMPORADA 2014/15", "FÚTBOL"];
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? "#a50044" : "#004d98";
      c.fillRect(i * 256, 0, 256, 64);
      c.fillStyle = "#fff";
      c.font = "800 26px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(words[i], i * 256 + 128, 33);
    }
  });
  tx.wrapS = THREE.RepeatWrapping;
  return tx;
}

function netTexture() {
  const tx = canvasTex(32, 32, (c) => {
    c.clearRect(0, 0, 32, 32);
    c.strokeStyle = "rgba(255,255,255,0.9)";
    c.lineWidth = 2;
    c.strokeRect(1, 1, 30, 30);
  });
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

/** Viereck mit beliebigen Ecken (a=unten links, b=unten rechts, c=oben rechts, d=oben links). */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, sx: number, sy: number, cell = 0.14) {
  const g = new THREE.PlaneGeometry(1, 1, sx, sy);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const lu = a.distanceTo(b);
  const lv = a.distanceTo(d);
  const bot = new THREE.Vector3();
  const top = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    bot.lerpVectors(a, b, u);
    top.lerpVectors(d, c, u);
    bot.lerp(top, v);
    p.setXYZ(i, bot.x, bot.y, bot.z);
    uv.setXY(i, (u * lu) / cell, (v * lv) / cell);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/*  Welt aufbauen                                                      */
/* ------------------------------------------------------------------ */

function buildWorld(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#070b1e");
  scene.fog = new THREE.Fog("#070b1e", 160, 420);
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 1200);

  // Licht
  scene.add(new THREE.HemisphereLight("#c9d8ff", "#1c3a1c", 1.15));
  const sun = new THREE.DirectionalLight("#fffaf0", 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -32;
  sc.right = 32;
  sc.top = 32;
  sc.bottom = -32;
  sc.near = 1;
  sc.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight("#b8c8ff", 0.7);
  fill.position.set(60, 50, 40);
  scene.add(fill);

  // Boden & Spielfeld
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: "#1d4a22", roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);
  const pitchTex = pitchTexture();
  pitchTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(121, 84), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  // Werbebanden
  const ad = adTexture();
  const board = (w: number, d: number, x: number, z: number, len: number) => {
    const t = ad.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 16, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), new THREE.MeshBasicMaterial({ map: t }));
    m.position.set(x, 0.45, z);
    m.castShadow = true;
    scene.add(m);
  };
  board(118, 0.15, 0, -38.5, 118);
  board(118, 0.15, 0, 38.5, 118);
  board(0.15, 76, -58, 0, 76);
  board(0.15, 76, 58, 0, 76);

  // Tribünen
  const crowd = crowdTexture();
  const crowdTex: THREE.Texture[] = [];
  const darkMat = new THREE.MeshStandardMaterial({ color: "#11131c", roughness: 0.9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: "#fff6d8" });
  const stand = (inner: THREE.Vector3, out: THREE.Vector3, length: number) => {
    const run = 40;
    const rise = 34;
    const slopeLen = Math.hypot(run, rise);
    const mid = inner.clone().addScaledVector(out, run / 2).add(new THREE.Vector3(0, rise / 2, 0));
    const t = crowd.clone();
    t.needsUpdate = true;
    t.repeat.set(length / 12, slopeLen / 12);
    crowdTex.push(t);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(length, slopeLen),
      new THREE.MeshStandardMaterial({ map: t, emissive: "#ffffff", emissiveMap: t, emissiveIntensity: 0.28, roughness: 1 }),
    );
    m.position.copy(mid);
    const n = out.clone().multiplyScalar(-rise).add(new THREE.Vector3(0, run, 0)).normalize();
    m.lookAt(mid.clone().add(n));
    scene.add(m);

    const alongX = Math.abs(out.z) > 0.5;
    const box = (w: number, h: number, d: number, o: number, y: number, mt: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : d, h, alongX ? d : w), mt);
      b.position.copy(inner).addScaledVector(out, o);
      b.position.y = y;
      scene.add(b);
    };
    box(length, 1.6, 0.4, 0, 0.8, darkMat); // Stirnwand unten
    box(length, 0.6, 22, run - 6, rise + 9, darkMat); // Dach
    box(length * 0.9, 0.35, 0.8, run - 16.5, rise + 8.6, lampMat); // Flutlichtband
  };
  stand(new THREE.Vector3(0, 1.5, -43), new THREE.Vector3(0, 0, -1), 210);
  stand(new THREE.Vector3(0, 1.5, 43), new THREE.Vector3(0, 0, 1), 210);
  stand(new THREE.Vector3(-62, 1.5, 0), new THREE.Vector3(-1, 0, 0), 170);
  stand(new THREE.Vector3(62, 1.5, 0), new THREE.Vector3(1, 0, 0), 170);

  // Tore
  const white = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 });
  const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 });
  const postG = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 14);
  const barG = new THREE.CylinderGeometry(0.06, 0.06, 7.44, 14);
  let backNet: THREE.BufferGeometry | null = null;
  let backBase: Float32Array | null = null;
  const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const s of [1, -1]) {
    const xl = 52.5 * s;
    const xb = 54.5 * s;
    for (const z of [-3.66, 3.66]) {
      const p = new THREE.Mesh(postG, white);
      p.position.set(xl, 1.22, z);
      p.castShadow = true;
      scene.add(p);
    }
    const bar = new THREE.Mesh(barG, white);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(xl, 2.44, 0);
    bar.castShadow = true;
    scene.add(bar);
    const back = quad(V3(xb, 0, -3.66), V3(xb, 0, 3.66), V3(xb, 2.2, 3.66), V3(xb, 2.2, -3.66), 30, 10);
    scene.add(new THREE.Mesh(back, netMat));
    scene.add(new THREE.Mesh(quad(V3(xl, 2.44, -3.66), V3(xl, 2.44, 3.66), V3(xb, 2.2, 3.66), V3(xb, 2.2, -3.66), 4, 4), netMat));
    for (const z of [-3.66, 3.66]) {
      scene.add(new THREE.Mesh(quad(V3(xl, 0, z), V3(xb, 0, z), V3(xb, 2.2, z), V3(xl, 2.44, z), 4, 4), netMat));
    }
    if (s === 1) {
      backNet = back;
      backBase = Float32Array.from(back.attributes.position.array as Float32Array);
    }
  }

  // Flutlichtmasten
  const mastMat = new THREE.MeshStandardMaterial({ color: "#2a2e3a", roughness: 0.7 });
  for (const [x, z] of [[-85, -62], [85, -62], [-85, 62], [85, 62]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 60, 10), mastMat);
    mast.position.set(x, 30, z);
    scene.add(mast);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 1), lampMat);
    lamp.position.set(x * 0.97, 61, z * 0.97);
    lamp.lookAt(0, 0, 0);
    scene.add(lamp);
  }

  // Spieler
  const G = makeGeos();
  const bootCols = ["#e8442f", "#111111", "#f4f4f4", "#ff8a00", "#2f6bff", "#c7ff2e"];
  const barcaSleeve = sleeveTexture();
  const models: Record<string, Humanoid> = {};
  PLAYERS.forEach((p, i) => {
    const jersey = jerseyTexture(p);
    const kit: Kit =
      p.team === "B"
        ? { jersey, sleeve: barcaSleeve, shirt: "#004d98", trim: "#ffd400", shorts: "#004d98", socks: "#0a3f7a", boots: bootCols[i % 6] }
        : p.team === "R"
          ? { jersey, sleeve: null, shirt: "#f5f5f5", trim: "#c9a227", shorts: "#f5f5f5", socks: "#f5f5f5", boots: bootCols[(i + 2) % 6] }
          : p.team === "RK"
            ? { jersey, sleeve: null, shirt: "#2bb673", trim: "#14532d", shorts: "#1d1d1d", socks: "#2bb673", boots: "#111111" }
            : { jersey, sleeve: null, shirt: "#e8c400", trim: "#1d1d1d", shorts: "#1d1d1d", socks: "#e8c400", boots: "#111111" };
    const h = new Humanoid(G, p, kit);
    models[p.id] = h;
    scene.add(h.root);
  });

  // Ball
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }));
  ball.castShadow = true;
  scene.add(ball);

  return { scene, camera, sun, models, ball, crowdTex, backNet: backNet!, backBase: backBase! };
}

/* ------------------------------------------------------------------ */
/*  Drehbuch-Logik in 3D                                               */
/* ------------------------------------------------------------------ */

type BallP = { x: number; y: number; h: number }; // Spielfeld-Koordinaten + Höhe

function createDirector(world: ReturnType<typeof buildWorld>) {
  const { camera, sun, models, ball, crowdTex, backNet, backBase } = world;

  // zurückgelegte Strecke je Spieler (für den Laufrhythmus)
  const DT = 0.05;
  const T0 = S0 - 1;
  const NS = Math.ceil((STORY_END + 2 - T0) / DT) + 3;
  const dist: Record<string, Float32Array> = {};
  for (const p of PLAYERS) {
    const arr = new Float32Array(NS);
    let prev = pos(p.id, T0);
    for (let i = 1; i < NS; i++) {
      const cur = pos(p.id, T0 + i * DT);
      arr[i] = arr[i - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      prev = cur;
    }
    dist[p.id] = arr;
  }
  const distAt = (id: string, t: number) => {
    const f = clamp((t - T0) / DT, 0, NS - 2);
    const i = Math.floor(f);
    return lerp(dist[id][i], dist[id][i + 1], f - i);
  };

  // Messis Fallrückzieher-Pose
  const bikePose = (tau: number): Pose3 => {
    const m = messiBike(tau);
    const p = basePose();
    p.by = m.hy;
    p.bz = -m.hx;
    p.pitch = (m.th * Math.PI) / 180;
    p.legR = -m.kick;
    p.kneeR = 0.15;
    p.legL = -m.sup;
    p.kneeL = 0.45;
    p.armR = -m.armF;
    p.armL = -m.armB;
    p.elbowL = p.elbowR = -0.35;
    return p;
  };
  const keeperDive = (tau: number): Pose3 => {
    const d = smooth(10.6, 12.5, tau);
    const f = smooth(12.5, 14, tau);
    const p = basePose();
    p.by = lerp(lerp(HIP - 0.12, 1.3, d), 0.3, f);
    p.bx = 2.0 * d + 0.5 * f + Math.sin(tau * 1.5) * 0.12 * (1 - d);
    p.roll = -1.2 * d - 0.37 * f;
    p.pitch = 0.2 * (1 - d);
    p.legL = p.legR = lerp(-0.25, 0.1, d);
    p.kneeL = p.kneeR = lerp(0.55, 0.15, d);
    p.legSpread = lerp(0.18, 0.08, d);
    p.armL = p.armR = lerp(-0.5, -2.9, d);
    p.elbowL = p.elbowR = lerp(-0.5, -0.1, d);
    p.spreadL = p.spreadR = lerp(0.35, 0.1, d);
    return p;
  };

  // Treffpunkt beim Fallrückzieher aus der echten Figur berechnen
  const messi = models.messi;
  messi.root.position.set(75 - X0, 0, 0);
  messi.root.rotation.y = -Math.PI / 2;
  messi.apply(bikePose(7));
  messi.root.updateMatrixWorld(true);
  const fw = new THREE.Vector3();
  messi.foot[1].getWorldPosition(fw);
  const C: BallP = { x: fw.x + X0 - 0.05, y: fw.z + Y0, h: fw.y + 0.07 };
  const N0 = ballAt(75.999);
  const CORNER: BallP = { x: 105.15, y: 37.4, h: 2.28 };

  const bulge = (t: number) => (t < GOAL_T ? 0 : 0.55 * Math.exp(-Math.max(0, t - 95.3) * 1.6) * Math.min(1, (t - GOAL_T) * 2.5));

  const ball3 = (t: number): BallP => {
    if (t < 76 || t >= 100) {
      const b = ballAt(t);
      return { x: b.x, y: b.y, h: b.z + BALL_R };
    }
    if (t < 89) {
      const s = t < 82 ? t - 76 : 6 + ((t - 82) * 3) / 7;
      const u = s / 9;
      return { x: lerp(N0.x, C.x, u), y: lerp(N0.y, C.y, u), h: lerp(BALL_R, C.h, u) + 4 * 9 * u * (1 - u) };
    }
    if (t < 94.8) {
      const u = (t - 89) / 5.8;
      return { x: lerp(C.x, CORNER.x, u), y: lerp(C.y, CORNER.y, u) - Math.sin(Math.PI * u) * 1.2, h: lerp(C.h, CORNER.h, u) + 4 * 2.2 * u * (1 - u) };
    }
    if (t < 95.4) {
      const u = (t - 94.8) / 0.6;
      return { x: lerp(CORNER.x, BALL_REST[0], u) + bulge(t), y: lerp(CORNER.y, BALL_REST[1], u), h: lerp(CORNER.h, 1.95, u) };
    }
    const u = smooth(95.4, 96.4, t);
    return { x: BALL_REST[0] + bulge(t), y: BALL_REST[1], h: lerp(1.95, BALL_R, u) + Math.abs(Math.sin(u * TAU)) * 0.25 * (1 - u) };
  };

  const yawAt = (p: Player, t: number) => {
    const [x, y] = pos(p.id, t);
    const a = pos(p.id, t - 0.25);
    const b = pos(p.id, t + 0.25);
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const speed = Math.hypot(vx, vy) / 0.5;
    const bl = ball3(t);
    const ballYaw = Math.atan2(bl.x - x, bl.y - y);
    return angLerp(ballYaw, Math.atan2(vx, vy), smooth(0.6, 1.6, speed));
  };

  const updatePlayer = (p: Player, idx: number, t: number) => {
    const h = models[p.id];
    if (t >= 82 && t < 100 && (p.id === "messi" || p.id === "navas")) {
      const tau = t - 82;
      if (p.id === "messi") {
        h.root.position.set(75 - X0, 0, 0);
        h.root.rotation.y = -Math.PI / 2;
        h.apply(bikePose(tau));
      } else {
        h.root.position.set(104.2 - X0, 0, 0);
        h.root.rotation.y = -Math.PI / 2;
        h.apply(keeperDive(tau));
      }
      return;
    }

    const [x, y] = pos(p.id, t);
    const a = pos(p.id, t - 0.1);
    const b = pos(p.id, t + 0.1);
    const speed = Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2;
    const down = p.down?.find(([d0, d1]) => t >= d0 - 0.1 && t < d1 + 0.1);
    const yaw = down ? yawAt(p, down[0] - 0.3) : yawAt(p, t);
    h.root.position.set(x - X0, 0, y - Y0);
    h.root.rotation.y = yaw;

    // Laufanimation (Tempo so, wie es im Video zu sehen ist)
    const amp = clamp((speed * speedAt(t)) / 7, 0, 1);
    const ph = (distAt(p.id, t) * TAU) / 2.3;
    const s = Math.sin(ph);
    let pose = basePose();
    pose.legL = -s * 0.85 * amp;
    pose.legR = s * 0.85 * amp;
    pose.kneeL = 0.06 + Math.max(0, Math.cos(ph)) * 1.35 * amp;
    pose.kneeR = 0.06 + Math.max(0, -Math.cos(ph)) * 1.35 * amp;
    pose.armL = s * 0.75 * amp;
    pose.armR = -s * 0.75 * amp;
    pose.elbowL = pose.elbowR = -0.25 - 1.1 * amp;
    pose.spreadL = pose.spreadR = 0.08 + 0.08 * amp;
    pose.twist = -s * 0.16 * amp;
    pose.pitch = 0.2 * amp;
    pose.by = HIP - 0.05 * amp + Math.abs(Math.cos(ph)) * 0.07 * amp + Math.sin(t * 2.2 + idx) * 0.006 * (1 - amp);

    // Torwart-Grundstellung
    if (p.team === "BK" || p.team === "RK") {
      const st = basePose();
      st.by = HIP - 0.12;
      st.legL = st.legR = -0.25;
      st.kneeL = st.kneeR = 0.55;
      st.legSpread = 0.18;
      st.pitch = 0.2;
      st.armL = st.armR = -0.5;
      st.elbowL = st.elbowR = -0.5;
      st.spreadL = st.spreadR = 0.35;
      pose = mixPose(st, pose, smooth(0.5, 2.5, speed));
    }

    // Schüsse & Tricks
    for (const [who, te, kind] of KICKS) {
      if (who !== p.id || Math.abs(t - te) > 0.8) continue;
      if (kind === "flick") {
        pose.legR += 0.9 * bump(t, te, 0.12);
        pose.kneeR += 1.6 * bump(t, te, 0.15);
      } else {
        const k = kind === "soft" ? 0.5 : 1;
        pose.legR += k * (0.9 * bump(t, te - 0.28, 0.13) - 1.5 * bump(t, te + 0.02, 0.13));
        pose.kneeR += k * 1.1 * bump(t, te - 0.28, 0.14);
        pose.armL -= k * 0.6 * bump(t, te, 0.2);
        pose.armR += k * 0.4 * bump(t, te, 0.2);
        pose.pitch -= k * 0.1 * bump(t, te, 0.2);
      }
    }

    // Jubel / Enttäuschung
    if (t > 100.5 && p.team === "B" && x > 84 && y > 50 && speed < 2.5) {
      const j = Math.abs(Math.sin(t * 5.5 + idx * 1.7));
      const cel = smooth(0, 1, 2.5 - speed);
      const c = { ...pose };
      if (p.id === "messi") {
        c.armL = c.armR = -2.9;
        c.spreadL = c.spreadR = 0.15;
        c.elbowL = c.elbowR = -0.1;
        c.headPitch = -0.1;
      } else {
        c.by += j * 0.35;
        c.armL = c.armR = -2.8;
        c.elbowL = c.elbowR = -0.2;
        c.spreadL = c.spreadR = 0.3;
      }
      pose = mixPose(pose, c, cel);
    }
    if (t > 95.5 && p.team === "R") {
      pose.headPitch = 0.45 * smooth(95.5, 97, t);
      if (amp < 0.2) {
        pose.armL = pose.armR = 0.2;
        pose.spreadL = pose.spreadR = 0.5;
        pose.elbowL = pose.elbowR = -1.6;
      }
    }

    // Am Boden
    if (down) {
      const f = smooth(down[0], down[0] + 0.5, t) * (1 - smooth(down[1] - 0.8, down[1], t));
      const lying = basePose();
      lying.by = 0.25;
      lying.pitch = -1.45;
      lying.legL = -0.25;
      lying.legR = 0.1;
      lying.kneeL = 0.6;
      lying.kneeR = 0.2;
      lying.armL = lying.armR = 0.4;
      lying.spreadL = lying.spreadR = 1.2;
      lying.headPitch = 0.3;
      pose = mixPose(pose, lying, f);
    }

    h.apply(pose);
  };

  // Kamera
  const focus = (t: number) => {
    let fx = 0;
    let fy = 0;
    let fh = 0;
    const n = 8;
    for (let k = 0; k < n; k++) {
      const tt = Math.max(S0, t - k * 0.14 * speedAt(t));
      if (tt >= 100) {
        const m = pos("messi", tt);
        fx += m[0];
        fy += m[1];
        fh += 1;
      } else {
        const b = ball3(tt);
        fx += b.x;
        fy += b.y;
        fh += Math.min(b.h, 3);
      }
    }
    return new THREE.Vector3(fx / n - X0, Math.max(0.8, fh / n), fy / n - Y0);
  };

  const setCam = (t: number, v: number) => {
    const F = focus(t);
    let p: THREE.Vector3;
    let l: THREE.Vector3;
    let fov: number;
    if (v < 6) {
      const a = -2.3 + v * 0.14;
      const R = lerp(72, 50, smooth(0, 6, v));
      p = new THREE.Vector3(Math.cos(a) * R, lerp(48, 22, smooth(0, 6, v)), Math.sin(a) * R);
      l = new THREE.Vector3(0, 0, 0);
      fov = 40;
    } else if (t < 20) {
      p = new THREE.Vector3(F.x - 2, 16, F.z - 36);
      l = F;
      fov = 30;
    } else if (t < 50) {
      p = new THREE.Vector3(F.x - 9, 6.5, F.z - 15);
      l = F;
      fov = 38;
    } else if (t < 56) {
      p = new THREE.Vector3(F.x - 8, 9, F.z - 15);
      l = F;
      fov = 32;
    } else if (t < 72) {
      p = new THREE.Vector3(F.x - 6, 3.4, F.z + 10);
      l = new THREE.Vector3(F.x + 0.5, 1.0, F.z);
      fov = 42;
    } else if (t < 82) {
      p = new THREE.Vector3(48, 6, -30);
      l = F;
      fov = 45;
    } else if (t < 89.4) {
      const k = t - 82;
      p = new THREE.Vector3(75 - X0 + 3 - k * 0.3, 1.0 + k * 0.04, 10.5 - k * 0.3);
      l = new THREE.Vector3(75 - X0 + 0.3, 1.2 + k * 0.12, 0);
      fov = 42;
    } else if (t < 95.5) {
      const b = ball3(t);
      const bx = b.x - X0;
      const bz = b.y - Y0;
      p = new THREE.Vector3(bx - 5.5, Math.max(0.6, b.h + 0.4), bz + 5.5);
      l = new THREE.Vector3(bx + 3, b.h * 0.9, bz);
      fov = 45;
    } else if (t < 100) {
      p = new THREE.Vector3(60, 3.2, 8.5);
      l = new THREE.Vector3(53.5, 1.4, 2.5);
      fov = 42;
    } else if (t < 106.5) {
      p = new THREE.Vector3(F.x - 7, 2.6, F.z - 7.5);
      l = new THREE.Vector3(F.x, 1.2, F.z);
      fov = 40;
    } else if (t < 112) {
      // Nahaufnahme: Messi von vorne
      const m = models.messi.root.position;
      const k = t - 106.5;
      p = new THREE.Vector3(m.x + 2.6 - k * 0.12, 1.45 + k * 0.03, m.z - 2.6 + k * 0.12);
      l = new THREE.Vector3(m.x, 1.45, m.z);
      fov = 34;
    } else {
      const a = 0.6 + (t - 112) * 0.06;
      p = new THREE.Vector3(Math.cos(a) * 66, 30 + (t - 112) * 2.5, Math.sin(a) * 66);
      l = new THREE.Vector3(0, 0, 0);
      fov = 45;
    }
    // Spielkameras bleiben innerhalb des Stadions (vor den Banden)
    if (v >= 6 && t < 80) {
      p.x = clamp(p.x, -56, 56);
      p.z = clamp(p.z, -37, 37);
    }
    camera.position.copy(p);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(l);
    // Schatten folgen dem Geschehen
    const sf = v < 6 || t >= 112 ? new THREE.Vector3(0, 0, 0) : l;
    sun.target.position.set(sf.x, 0, sf.z);
    sun.position.set(sf.x - 25, 60, sf.z - 30);
  };

  let prevBall: THREE.Vector3 | null = null;
  const tmp = new THREE.Vector3();

  /** t = Spielzeit, v = Videozeit */
  return (t: number, v: number): Tag[] => {
    PLAYERS.forEach((p, i) => updatePlayer(p, i, t));

    // Ball
    const b = ball3(t);
    ball.position.set(b.x - X0, b.h, b.y - Y0);
    if (prevBall) {
      tmp.subVectors(ball.position, prevBall);
      const len = tmp.length();
      if (len > 1e-4 && len < 5) {
        const axis = new THREE.Vector3(tmp.z, 0, -tmp.x).normalize();
        if (axis.lengthSq() > 0) ball.rotateOnWorldAxis(axis, len / BALL_R);
      }
    }
    prevBall = ball.position.clone();

    // Tornetz beult sich aus
    const bul = bulge(t);
    const pa = backNet.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = backBase[i * 3 + 1];
      const z = backBase[i * 3 + 2];
      const d2 = (z - (BALL_REST[1] - Y0)) ** 2 + (y - 1.95) ** 2;
      pa.setX(i, backBase[i * 3] + bul * Math.exp(-d2 / 0.6));
    }
    pa.needsUpdate = true;

    // Fans springen nach dem Tor
    const jump = t > GOAL_T && t < 112 ? Math.abs(Math.sin(t * 9)) * 0.006 : 0;
    for (const c of crowdTex) c.offset.y = jump;

    setCam(t, v);

    // Namensschilder
    const tags: Tag[] = [];
    if (v > 7 && t < 80) {
      for (const p of PLAYERS) {
        if (!p.label) continue;
        const h = models[p.id];
        tmp.set(h.root.position.x, 1.85 * h.root.scale.y + 0.25, h.root.position.z).project(camera);
        if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) continue;
        tags.push({ x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H, name: p.name.toUpperCase(), hl: p.id === "messi" });
      }
    }
    return tags;
  };
}

/* ------------------------------------------------------------------ */
/*  Komponente                                                         */
/* ------------------------------------------------------------------ */

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export default function Clasico3D() {
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const recRef = useRef<{ rec: MediaRecorder; ctx: CanvasRenderingContext2D } | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const gl = glRef.current;
    const hud = hudRef.current?.getContext("2d");
    if (!gl || !hud) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
    } catch {
      queueMicrotask(() => setError("WebGL ist in diesem Browser nicht verfügbar."));
      return;
    }
    // Startzeit per URL, z. B. /clasico?t=85
    const startT = Number(new URLSearchParams(window.location.search).get("t"));
    if (startT > 0) tRef.current = clamp(startT, 0, DUR - 0.01);
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const world = buildWorld(renderer);
    const update = createDirector(world);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        tRef.current += dt;
        if (tRef.current >= DUR) {
          tRef.current = DUR;
          playingRef.current = false;
          setPlaying(false);
          if (recRef.current?.rec.state === "recording") recRef.current.rec.stop();
        }
      }
      const vv = Math.min(tRef.current, DUR - 0.001);
      const tt = storyAt(vv);
      const tags = update(tt, vv);
      renderer.render(world.scene, world.camera);
      drawHud(hud, vv, tt, tags);
      const r = recRef.current;
      if (r) {
        r.ctx.drawImage(gl, 0, 0, W, H);
        r.ctx.drawImage(hud.canvas, 0, 0);
      }
      setT(tRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      world.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            (m as THREE.MeshStandardMaterial).map?.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, []);

  const toggle = () => {
    if (recording) return;
    if (tRef.current >= DUR) tRef.current = 0;
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  };

  const restart = () => {
    if (recording) return;
    tRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
  };

  const record = () => {
    if (recording) return;
    const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) {
      alert("Dein Browser unterstützt keine Videoaufnahme. Bitte Chrome oder Firefox verwenden.");
      return;
    }
    const comp = document.createElement("canvas");
    comp.width = W;
    comp.height = H;
    const ctx = comp.getContext("2d")!;
    const rec = new MediaRecorder(comp.captureStream(30), { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `el-clasico-messi-3d.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      recRef.current = null;
      setRecording(false);
    };
    recRef.current = { rec, ctx };
    tRef.current = 0;
    rec.start(1000);
    playingRef.current = true;
    setPlaying(true);
    setRecording(true);
  };

  return (
    <div className="w-full max-w-[1280px] flex flex-col gap-3">
      <div className="relative w-full aspect-video rounded-xl overflow-hidden shadow-2xl bg-black cursor-pointer" onClick={toggle}>
        <canvas ref={glRef} width={W} height={H} className="absolute inset-0 w-full h-full" />
        <canvas ref={hudRef} width={W} height={H} className="absolute inset-0 w-full h-full pointer-events-none" />
        {error && <p className="absolute inset-0 grid place-items-center text-red-300">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={toggle}
          disabled={recording}
          className="rounded-lg bg-[#004d98] px-5 py-2 font-semibold hover:brightness-110 disabled:opacity-40"
        >
          {playing ? "⏸ Pause" : "▶ Abspielen"}
        </button>
        <button
          onClick={restart}
          disabled={recording}
          className="rounded-lg bg-neutral-700 px-4 py-2 font-semibold hover:brightness-110 disabled:opacity-40"
        >
          ⟲ Von vorne
        </button>
        <input
          type="range"
          min={0}
          max={DUR}
          step={0.1}
          value={t}
          disabled={recording}
          onChange={(e) => {
            tRef.current = Number(e.target.value);
            setT(tRef.current);
          }}
          className="flex-1 min-w-40 accent-[#a50044]"
        />
        <span className="tabular-nums text-neutral-300 w-24 text-right">
          {fmt(t)} / {fmt(DUR)}
        </span>
        <button
          onClick={record}
          disabled={recording}
          className="rounded-lg bg-[#a50044] px-4 py-2 font-semibold hover:brightness-110 disabled:opacity-60"
        >
          {recording ? `● Aufnahme läuft … ${fmt(DUR - t)}` : "● Als Video speichern"}
        </button>
      </div>
      {recording && (
        <p className="text-sm text-neutral-400">
          Die Aufnahme läuft in Echtzeit (2 Minuten). Lass diesen Tab bitte im Vordergrund – danach startet der Download
          automatisch.
        </p>
      )}
    </div>
  );
}
