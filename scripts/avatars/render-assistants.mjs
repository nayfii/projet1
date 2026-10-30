// Renders the AI assistants' 3D characters (one per provider + Auto) into public/avatars/assistants.
// Dev-only: `node scripts/avatars/render-assistants.mjs` (needs the dev dependency `three` and Chromium).
//
// Every character shares one recipe: the same head-and-shoulders framing, soft clay materials,
// diffuse studio light with a rim light (so it reads on near-black), and a blank glass visor.
// The face (eyes, mouth) is NOT baked in: the app draws it live on the visor so it can blink,
// think and talk. This script prints each visor's box (relative to the image) for that overlay.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const threeDir = path.join(root, "node_modules/three");
const outDir = path.join(root, "public/avatars/assistants");
fs.mkdirSync(outDir, { recursive: true });

/** The cast. Body colours are the product's pastel family (globals.css --pastel-*). */
const PERSONAS = [
  { id: "openai", body: "#93dcbb", accent: "#4fae86", head: "pill", crest: "antenna" },
  { id: "anthropic", body: "#f4b994", accent: "#d9825a", head: "soft-square", crest: "ears" },
  { id: "google", body: "#a6c3f4", accent: "#6f93e0", head: "tall-square", crest: "halo" },
  { id: "auto", body: "#ebe9f6", accent: "#a99ff0", head: "pill", crest: "orb" },
];

const SIZE = 512;

const page = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style>
<script type="importmap">{"imports":{"three":"http://avatars.local/three/build/three.module.js","three/addons/":"http://avatars.local/three/examples/jsm/"}}</script>
</head><body><canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script type="module">
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(2);
renderer.setSize(${SIZE}, ${SIZE}, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setClearColor(0x000000, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

function clay(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45,
    sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ffffff"), envMapIntensity: 0.9, ...opts,
  });
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

window.renderPersona = (p) => {
  const scene = new THREE.Scene();
  scene.environment = envMap;

  // Studio light: soft key from the upper left, fill from the right, a cool rim from behind.
  const key = new THREE.DirectionalLight("#fff8f0", 1.7); key.position.set(-2.5, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight("#f0f2ff", 0.55); fill.position.set(3, 0.5, 2.5); scene.add(fill);
  const rim = new THREE.DirectionalLight("#ffffff", 2.2); rim.position.set(0.5, 2.5, -4); scene.add(rim);
  const rim2 = new THREE.DirectionalLight("#dfe3ff", 1.2); rim2.position.set(-3, -0.5, -3); scene.add(rim2);
  scene.add(new THREE.HemisphereLight("#ffffff", "#2a2a35", 0.35));

  const body = clay(p.body);
  const accent = clay(p.accent, { roughness: 0.42 });
  const dark = new THREE.MeshPhysicalMaterial({ color: "#2b2d36", roughness: 0.55, clearcoat: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#07080c", roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4,
  });

  const g = new THREE.Group();
  scene.add(g);

  // Head: a soft rounded block for everyone (a "pill" is the roundest), so the glass visor sits flat on the face.
  const shapes = { pill: [1.7, 1.42, 1.34, 0.66], "soft-square": [1.66, 1.4, 1.32, 0.52], "tall-square": [1.62, 1.5, 1.32, 0.46] };
  const [headW, headH, headD, radius] = shapes[p.head];
  const head = new THREE.Mesh(new RoundedBoxGeometry(headW, headH, headD, 12, radius), body);
  const faceZ = headD / 2 - 0.035;
  head.position.y = 0.42;
  g.add(head);

  // Visor: a glass plate following the front of the head.
  const vw = headW * (p.head === "pill" ? 0.7 : 0.74), vh = headH * 0.5;
  const visorGeo = new THREE.ExtrudeGeometry(roundedRect(vw, vh, vh * 0.42), {
    depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 6, curveSegments: 24,
  });
  const visor = new THREE.Mesh(visorGeo, glass);
  visor.position.set(0, head.position.y - 0.02, faceZ - 0.02);
  g.add(visor);

  // Neck and shoulders (the crop keeps the top of the shoulders, like a portrait).
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.4, 48), accent);
  neck.position.y = -0.42; g.add(neck);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), body);
  torso.scale.set(1.25, 0.62, 0.78); torso.position.y = -1.08; g.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 24, 64), accent);
  collar.rotation.x = Math.PI / 2; collar.position.y = -0.55; g.add(collar);

  // Signature detail per character.
  const top = head.position.y + headH / 2;
  if (p.crest === "antenna") {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.32, 24), dark);
    stem.position.y = top + 0.12; g.add(stem);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 48, 32), accent);
    ball.position.y = top + 0.32; g.add(ball);
  } else if (p.crest === "ears") {
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 48), accent);
      pod.rotation.z = Math.PI / 2; pod.position.set(s * (headW / 2 + 0.03), head.position.y, 0); g.add(pod);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 24), body);
      cap.scale.set(0.45, 1, 1); cap.position.set(s * (headW / 2 + 0.12), head.position.y, 0); g.add(cap);
    }
  } else if (p.crest === "halo") {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 24, 96), accent);
    halo.rotation.x = Math.PI / 2.25; halo.position.y = top + 0.2; g.add(halo);
    for (const s of [-1, 1]) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 24), accent);
      stud.scale.set(0.6, 1, 1); stud.position.set(s * (headW / 2 + 0.02), head.position.y, 0); g.add(stud);
    }
  } else if (p.crest === "orb") {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 48, 32), clay(p.accent, { emissive: new THREE.Color(p.accent), emissiveIntensity: 0.35 }));
    orb.position.y = top + 0.3; g.add(orb);
    for (const s of [-1, 1]) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 24), accent);
      stud.scale.set(0.6, 1, 1); stud.position.set(s * (headW / 2 - 0.02), head.position.y, 0); g.add(stud);
    }
  }

  g.rotation.y = -0.08;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0.55, 7.4);
  camera.lookAt(0, 0.12, 0);
  renderer.render(scene, camera);

  // Visor box on the image, for the live face drawn by the app.
  visor.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(visor);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) corners.push(new THREE.Vector3(x, y, box.max.z).project(camera));
  const xs = corners.map((c) => (c.x + 1) / 2), ys = corners.map((c) => (1 - c.y) / 2);
  const face = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { image: canvas.toDataURL("image/webp", 0.92), face };
};
// A generic person, used as the result in test mode (no image model called). Same light and
// framing as the assistants, on the solid background personal avatars are generated with.
window.renderPerson = () => {
  const scene = new THREE.Scene();
  scene.environment = envMap;
  scene.background = new THREE.Color("#1c1c21");
  const key = new THREE.DirectionalLight("#fff8f0", 1.6); key.position.set(-2.5, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight("#f0f2ff", 0.5); fill.position.set(3, 0.5, 2.5); scene.add(fill);
  const rim = new THREE.DirectionalLight("#dfe3ff", 1.6); rim.position.set(0.5, 2.5, -4); scene.add(rim);
  scene.add(new THREE.HemisphereLight("#ffffff", "#2a2a35", 0.35));
  const skin = clay("#efc3a2", { roughness: 0.55, sheen: 0.6 });
  const hair = clay("#4a3428", { roughness: 0.6 });
  const dark = new THREE.MeshPhysicalMaterial({ color: "#1d1512", roughness: 0.2, clearcoat: 1 });
  const white = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const g = new THREE.Group(); scene.add(g);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), skin); head.scale.set(0.82, 0.92, 0.8); head.position.y = 0.4; g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
  cap.scale.set(0.87, 0.82, 0.86); cap.position.set(0, 0.52, -0.04); cap.rotation.x = -0.22; g.add(cap);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 24), skin); ear.scale.set(0.6, 1, 0.8); ear.position.set(s * 0.8, 0.32, -0.02); g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.105, 48, 32), dark); eye.scale.set(1, 1.15, 0.6); eye.position.set(s * 0.29, 0.38, 0.72); g.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), white); shine.position.set(s * 0.29 - 0.035, 0.43, 0.79); g.add(shine);
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 8, 16), hair); brow.rotation.z = Math.PI / 2 + s * 0.12; brow.position.set(s * 0.3, 0.6, 0.7); g.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 24), clay("#e6b08e")); nose.position.set(0, 0.22, 0.8); g.add(nose);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 16, 48, Math.PI), clay("#b5525f", { roughness: 0.4 }));
  smile.rotation.z = Math.PI; smile.position.set(0, 0.05, 0.73); g.add(smile);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 48), skin); neck.position.y = -0.48; g.add(neck);
  const top = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), clay("#8d93b8", { roughness: 0.7 })); top.scale.set(1.2, 0.6, 0.76); top.position.y = -1.1; g.add(top);
  g.rotation.y = -0.1;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0.5, 7.2); camera.lookAt(0, 0.12, 0);
  renderer.render(scene, camera);
  scene.background = null;
  return canvas.toDataURL("image/webp", 0.9);
};
window.ready = true;
</script></body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const tab = await browser.newPage();
await tab.route("http://avatars.local/**", (route) => {
  const rel = new URL(route.request().url()).pathname.replace(/^\/three\//, "");
  route.fulfill({ path: path.join(threeDir, rel), contentType: "text/javascript" });
});
await tab.route("http://page.local/", (route) => route.fulfill({ body: page, contentType: "text/html" }));
await tab.goto("http://page.local/");
await tab.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });

const faces = {};
for (const persona of PERSONAS) {
  const { image, face } = await tab.evaluate((p) => window.renderPersona(p), persona);
  fs.writeFileSync(path.join(outDir, `${persona.id}.webp`), Buffer.from(image.split(",")[1], "base64"));
  faces[persona.id] = Object.fromEntries(Object.entries(face).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
}
const person = await tab.evaluate(() => window.renderPerson());
fs.writeFileSync(path.join(root, "public/avatars/test-person.webp"), Buffer.from(person.split(",")[1], "base64"));
await browser.close();
console.log(JSON.stringify(faces, null, 2));
