// The 3D stage: Milky behind a desk, posed and animated procedurally.
//
// Poses are snapshots of every bone's local transform. "neutral" is built from the T-pose with a
// few world-space rotations, "feetUp" comes from js/feetup.js, and emotions are small tweaks on top
// of neutral. At runtime the poses are blended and a little breathing, swaying and talking motion
// is layered over the top.
//
// Bone names are the ones three.js sees, which is the Blender name with the dots stripped
// ("arm1.L" in Blender is "arm1L" here).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FEET_UP } from './feetup.js';

const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const OUTLINE = 0x231451;
// Emotions that have their own face texture: add a name here once assets/faces/<name>.png exists.
// Use the same size and layout as the face texture inside the model (1024 x 748).
const CUSTOM_FACES = [];
const MODEL_HEIGHT = 1.53; // world units; her T-pose is scaled to this tall

// Blender's Constant colour ramps for the three shiny slipper materials.
// Their Fac input is the grayscale value of the diffuse lighting response.
// GLTF exports these materials as unlit, so rebuild the diffuse-to-ramp-to-raw-RGB
// path in a custom Lambert shader at runtime.
const SHINY_RAMPS = {
  blueshiny: [
    [0.000, 0xc2cae2],
    [0.077, 0xb8c5e2],
    [0.221, 0xd3e5fd],
    [0.820, 0xdfecfd],
    [0.831, 0xffffff],
  ],
  purpleshiny: [
    [0.000, 0xa5a4d1],
    [0.077, 0x8f8fca],
    [0.221, 0xa3a6e1],
    [0.820, 0xbdbfe9],
    [0.831, 0xffffff],
  ],
  purpleshiny2: [
    [0.000, 0xa5a4d1],
    [0.077, 0x8f8fca],
    [0.221, 0xa3a6e1],
    [0.796, 0xbdbfe9],
    [0.828, 0xa3a6e1],
    [0.903, 0xbdbfe9],
  ],
};

function createConstantRampMaterial(sourceMaterial, stops) {
  // Use Lambert diffuse lighting to calculate the input to the ramp.
  // The ramp output then replaces the lighting and is displayed as raw RGB.
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: sourceMaterial.side,
    opacity: sourceMaterial.opacity,
    transparent: sourceMaterial.transparent,
    alphaTest: sourceMaterial.alphaTest,
    depthWrite: sourceMaterial.depthWrite,
    depthTest: sourceMaterial.depthTest,
    blending: sourceMaterial.blending,
    vertexColors: sourceMaterial.vertexColors,
    flatShading: sourceMaterial.flatShading,
    fog: sourceMaterial.fog,
  });

  material.name = sourceMaterial.name;
  material.toneMapped = false;

  // Convert supplied sRGB hex colors into linear RGB for shader output.
  const colors = stops.map(([position, hex]) => {
    const color = new THREE.Color(hex);

    return {
      position,
      rgb: color.toArray().map((v) => v.toFixed(7)),
    };
  });

  const last = colors[colors.length - 1];

  // Constant interpolation: each stop's color is retained until the next stop.
  const branches = colors.slice(1).map((stop, index) => {
    const previous = colors[index];
    const keyword = index === 0 ? 'if' : 'else if';

    return `${keyword} (rampFac < ${stop.position.toFixed(3)}) {
      rampColor = vec3(${previous.rgb.join(', ')});
    }`;
  }).join('\n');

  material.onBeforeCompile = (shader) => {
    // Calculate the diffuse lighting response before applying the ColorRamp.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>

      vec3 diffuseShaderRGB = max(reflectedLight.directDiffuse, vec3(0.0));

      // Blender's Color-to-Fac conversion uses grayscale luminance.
      float rampFac = dot(
        diffuseShaderRGB,
        vec3(0.2126729, 0.7151522, 0.0721750)
      );

      vec3 rampColor = vec3(${last.rgb.join(', ')});

      ${branches}`
    );

    // Output the ColorRamp result directly, without applying lighting again.
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
      'vec3 outgoingLight = rampColor;'
    );
  };

  material.customProgramCacheKey = () =>
    `blender-diffuse-constant-ramp-${material.name}-${stops.map(
      ([position, hex]) => `${position}:${hex}`
    ).join('|')}`;

  material.needsUpdate = true;

  return material;
}

// World-space rotation recipes. Each step is [bone, axis, degrees], applied parent-first.
// swing(bone, from, to) is the step that turns a bone currently pointing along `from` to point
// along `to`; arms are described that way because it is easier to say where they point than
// which way they bend.
const swing = (bone, from, to) => {
  const a = from.clone().normalize();
  const b = to.clone().normalize();

  return [
    bone,
    new THREE.Vector3().crossVectors(a, b).normalize(),
    Math.acos(a.dot(b)) / DEG,
  ];
};

// Arms: upper arms hang forward and a little out, forearms rest flat on the desk.
// `side` is +1 for her left arm (screen right) and -1 for her right.
function neutralRecipe() {
  const steps = [];

  for (const side of [1, -1]) {
    const sfx = side === 1 ? 'L' : 'R';

    const out = new THREE.Vector3(side, 0, 0);
    const upper = new THREE.Vector3(side * 0.2, -0.52, 0.8);
    const fore = new THREE.Vector3(side * 0.07, -0.03, 0.99);

    steps.push(swing(`arm1${sfx}`, out, upper));
    steps.push(swing(`arm2${sfx}`, upper, fore));
  }

  steps.push(['head', Z, 3]);

  return steps;
}

const EMOTION_RECIPES = {
  sad: [
    ['spine2', X, 9],
    ['neck', X, 10],
    ['head', X, 14],
    ['arm1L', X, -9],
    ['arm1R', X, -9],
  ],

  uneasy: [
    ['spine2', Z, 4],
    ['head', Z, -9],
    ['head', Y, 14],
    ['shoulderL', Z, 9],
    ['shoulderR', Z, -9],
    ['arm2L', X, -16],
    ['arm2R', X, -16],
  ],
};

export class Stage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(20, 2, 0.1, 100);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));

    const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);

    // Place the sun high and to the camera's left, aimed diagonally across the scene.
    sun.position.set(-3.5, 6.5, 4.5);
    sun.target.position.set(0.45, 1.4, 0);

    this.sun = sun;

    this.scene.add(sun, sun.target);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);

    this.bones = {};
    this.rest = null;
    this.poses = {};

    this.feet = 0;
    this.feetTarget = 0;

    this.emotion = 'neutral';
    this.emo = {
      sad: 0,
      uneasy: 0,
    };

    this.talking = false;
    this.talk = 0;
    this.pulse = 0;
    this.t = 0;

    this.faces = {};
    this.headMat = null;
    this.baseHeadMap = null;

    this.ready = false;

    this._buildDesk();

    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);

    this._resize();
  }

  // ---------- scene dressing ----------

  _buildDesk() {
    const g = new THREE.Group();

    const w = 1.15;
    const h = 1.08;
    const d = 0.62;

    const geo = new THREE.BoxGeometry(w, h, d);

    const mats = [
      new THREE.MeshLambertMaterial({ color: 0xa6a3ad }),
      new THREE.MeshLambertMaterial({ color: 0xa6a3ad }),
      new THREE.MeshLambertMaterial({ color: 0xc4c1ca }),
      new THREE.MeshLambertMaterial({ color: 0x8f8c97 }),
      new THREE.MeshLambertMaterial({ color: 0x9a97a2 }),
      new THREE.MeshLambertMaterial({ color: 0x9a97a2 }),
    ];

    const box = new THREE.Mesh(geo, mats);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: OUTLINE }),
    );

    box.add(edges);
    g.add(box);

    box.position.y = h / 2;
    g.position.set(0.68, 0.0, 0.42);

    this.desk = g;

    this.scene.add(g);
  }

  // ---------- loading ----------

  async load(modelUrl) {
    const m = await new GLTFLoader().loadAsync(modelUrl);

    const model = m.scene;

    this.model = model;

    this.holder.add(model);

    const shinyMaterialCache = new Map();

    model.traverse((o) => {
      if (o.isBone || o.type === 'Bone') {
        this.bones[o.name] = o;
      }

      if (o.isMesh) {
        o.frustumCulled = false;

        const sourceMaterials = Array.isArray(o.material)
          ? o.material
          : [o.material];

        const renderMaterials = sourceMaterials.map((mt) => {
          if (mt.name === 'face') {
            this.headMat = mt;
          }

          const stops = SHINY_RAMPS[mt.name];

          if (!stops) {
            return mt;
          }

          if (!shinyMaterialCache.has(mt)) {
            shinyMaterialCache.set(
              mt,
              createConstantRampMaterial(mt, stops)
            );
          }

          return shinyMaterialCache.get(mt);
        });

        o.material = Array.isArray(o.material)
          ? renderMaterials
          : renderMaterials[0];
      }
    });

    if (this.headMat) {
      this.baseHeadMap = this.headMat.map;
    }

    // Scale her to MODEL_HEIGHT, feet on y = 0, centred on x = 0.
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);

    const k = MODEL_HEIGHT / (box.max.y - box.min.y);

    model.scale.setScalar(k);

    model.position.set(
      -((box.min.x + box.max.x) / 2) * k,
      -box.min.y * k,
      0
    );

    this.k = k;

    this.rest = this._snapshot();

    this.poses.rest = this.rest;

    this._prepSilhouette();

    // Neutral: relaxed, arms on the desk.
    this._reset();

    this._applyRecipe(neutralRecipe());

    this.poses.neutral = this._snapshot();

    // FeetUp: stored rotations on top of the rest pose.
    this._reset();

    for (const [name, q] of Object.entries(FEET_UP.q)) {
      this.bones[name]?.quaternion.fromArray(q);
    }

    this.bones.pelvis.position.y -= FEET_UP.pelvisDrop / this.k;

    this.model.updateMatrixWorld(true);

    this.poses.feetUp = this._snapshot();

    // Emotions, as tweaks on top of neutral.
    for (const [name, recipe] of Object.entries(EMOTION_RECIPES)) {
      this._reset();

      this._applyPose(this.poses.neutral);

      this._applyRecipe(recipe);

      this.poses[name] = this._snapshot();
    }

    this._applyPose(this.poses.neutral);

    this._placeModel();

    this._anchorHead();

    this.ready = true;

    this._frameCamera();

    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  _placeModel() {
    this.holder.position.set(0.93, 0.21, 0);
  }

  _frameCamera() {
    const cam = this.camera;

    const k = Math.max(1, 1.8 / cam.aspect);

    const target = new THREE.Vector3(
      0.45 + (k - 1) * 0.45,
      1.4 + (k - 1) * 0.12,
      0
    );

    cam.position.set(
      target.x,
      1.9 + (k - 1) * 0.3,
      3.1 * k
    );

    cam.lookAt(target);

    cam.updateProjectionMatrix();
  }

  // ---------- pose plumbing ----------

  _snapshot() {
    const out = {};

    for (const [n, b] of Object.entries(this.bones)) {
      out[n] = {
        p: b.position.clone(),
        q: b.quaternion.clone(),
        s: b.scale.clone(),
      };
    }

    return out;
  }

  _applyPose(pose) {
    for (const [n, v] of Object.entries(pose)) {
      const b = this.bones[n];

      if (!b) continue;

      b.position.copy(v.p);
      b.quaternion.copy(v.q);
      b.scale.copy(v.s);
    }

    this.model.updateMatrixWorld(true);
  }

  _reset() {
    this._applyPose(this.rest);
  }

  _applyRecipe(steps) {
    const pq = new THREE.Quaternion();
    const wq = new THREE.Quaternion();

    for (const [name, axis, deg] of steps) {
      const b = this.bones[name];

      if (!b) {
        console.warn('no bone', name);
        continue;
      }

      b.parent.updateWorldMatrix(true, false);

      b.parent.getWorldQuaternion(pq);

      wq.setFromAxisAngle(axis, deg * DEG);

      b.quaternion
        .premultiply(pq)
        .premultiply(wq)
        .premultiply(pq.clone().invert());

      b.updateMatrixWorld(true);
    }
  }

  // ---------- public controls ----------

  setFeet(up) {
    this.feetTarget = up ? 1 : 0;
  }

  setTalking(on) {
    this.talking = !!on;
  }

  blip() {
    this.pulse = 1;
  }

  setEmotion(name) {
    name = (name || 'neutral').toLowerCase();

    this.emotion = this.poses[name] && name in this.emo
      ? name
      : 'neutral';

    this._applyFace(this.emotion);
  }

  // Optional custom face textures.
  async _applyFace(name) {
    if (!this.headMat) return;

    if (name === 'neutral') {
      this.headMat.map = this.baseHeadMap;
      this.headMat.needsUpdate = true;
      return;
    }

    if (!CUSTOM_FACES.includes(name)) {
      this.headMat.map = this.baseHeadMap;
      this.headMat.needsUpdate = true;
      return;
    }

    if (this.faces[name] === undefined) {
      this.faces[name] = null;

      try {
        const tex = await new THREE.TextureLoader().loadAsync(
          `./assets/faces/${name}.png`
        );

        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;

        tex.wrapS = this.baseHeadMap.wrapS;
        tex.wrapT = this.baseHeadMap.wrapT;

        tex.magFilter = this.baseHeadMap.magFilter;
        tex.minFilter = this.baseHeadMap.minFilter;

        this.faces[name] = tex;
      } catch {
        // No custom face for this emotion.
      }
    }

    if (this.emotion !== name) return;

    this.headMat.map = this.faces[name] || this.baseHeadMap;
    this.headMat.needsUpdate = true;
  }

  // ---------- per-frame ----------

  _resize() {
    const p = this.canvas.parentElement;

    const w = Math.max(2, p.clientWidth);
    const h = Math.max(2, p.clientHeight);

    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.ready) {
      this._frameCamera();
    }
  }

  _tick(ms) {
    const dt = Math.min(0.05, (ms / 1000) - this.t || 0.016);

    this.t = ms / 1000;

    if (!this.ready) return;

    const t = this.t;

    const ease = 1 - Math.pow(0.0015, dt);

    this.feet += (this.feetTarget - this.feet) *
      (1 - Math.pow(0.02, dt));

    for (const n of Object.keys(this.emo)) {
      const goal = this.emotion === n ? 1 : 0;

      this.emo[n] += (goal - this.emo[n]) * ease;
    }

    this.talk += ((this.talking ? 1 : 0) - this.talk) * ease;

    this.pulse = Math.max(0, this.pulse - dt * 7);

    this._blend();

    this._overlay(t);

    this.renderer.render(this.scene, this.camera);

    if (this.onFrame) {
      this.onFrame();
    }
  }

  // ---------- screen-space silhouette ----------

  _prepSilhouette() {
    const parts = [];

    let total = 0;

    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;

      const g = o.geometry;
      const count = g.attributes.position.count;

      const si = g.attributes.skinIndex;
      const sw = g.attributes.skinWeight;

      const all = [];
      const head = [];

      const step = Math.max(2, Math.round(count / 400));

      for (let i = 0; i < count; i++) {
        if (i % step === 0) {
          all.push(i);
        }

        if (!si) continue;

        let best = 0;
        let bw = -1;

        for (let c = 0; c < 4; c++) {
          const w = sw.getComponent(i, c);

          if (w > bw) {
            bw = w;
            best = c;
          }
        }

        if (o.skeleton.bones[si.getComponent(i, best)]?.name === 'head') {
          head.push(i);
        }
      }

      parts.push({ mesh: o, all, head });

      total += all.length;
    });

    this._sil = {
      parts,
      buf: new Float32Array(total * 2),
      v: new THREE.Vector3(),
    };
  }

  _anchorHead() {
    const v = new THREE.Vector3();
    const sum = new THREE.Vector3();

    let c = 0;

    this.holder.updateMatrixWorld(true);

    for (const { mesh, head } of this._sil.parts) {
      for (const i of head) {
        sum.add(
          mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld)
        );

        c++;
      }
    }

    if (c) {
      this.headAnchor = this.holder.worldToLocal(sum.divideScalar(c));
    }
  }

  silhouette() {
    if (!this._sil) return null;

    const p = this.canvas.parentElement;

    const W = p.clientWidth;
    const H = p.clientHeight;

    const { parts, buf, v } = this._sil;

    let n = 0;

    for (const { mesh, all } of parts) {
      for (const i of all) {
        mesh.getVertexPosition(i, v)
          .applyMatrix4(mesh.matrixWorld)
          .project(this.camera);

        buf[n++] = (v.x * 0.5 + 0.5) * W;
        buf[n++] = (-v.y * 0.5 + 0.5) * H;
      }
    }

    let head = null;

    if (this.headAnchor) {
      v.copy(this.headAnchor);

      this.holder.localToWorld(v).project(this.camera);

      head = {
        x: (v.x * 0.5 + 0.5) * W,
        y: (-v.y * 0.5 + 0.5) * H,
      };
    }

    return { buf, n, W, H, head };
  }

  _blend() {
    const N = this.poses.neutral;
    const F = this.poses.feetUp;

    const q = new THREE.Quaternion();

    for (const [name, b] of Object.entries(this.bones)) {
      const n = N[name];
      const f = F[name];

      if (!n) continue;

      b.position.lerpVectors(n.p, f.p, this.feet);

      q.copy(n.q).slerp(f.q, this.feet);

      b.scale.lerpVectors(n.s, f.s, this.feet);

      for (const [en, w] of Object.entries(this.emo)) {
        if (w < 0.001) continue;

        const e = this.poses[en][name];

        const dq = n.q.clone().invert().premultiply(e.q);

        q.multiply(
          new THREE.Quaternion()
            .identity()
            .slerp(dq, w * (1 - this.feet * 0.6))
        );
      }

      b.quaternion.copy(q);
    }
  }

  _overlay(t) {
    const wob = (bone, ax, ay, az, f = 1) => {
      const b = this.bones[bone];

      if (!b) return;

      const e = new THREE.Euler(
        ax * Math.sin(t * 0.9 * f + 0.0),
        ay * Math.sin(t * 0.7 * f + 1.3),
        az * Math.sin(t * 0.5 * f + 2.1),
      );

      b.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(e)
      );
    };

    const calm = 1 - this.feet * 0.5;

    wob('spine1', 0.012 * calm, 0.01 * calm, 0.008 * calm, 1.4);
    wob('spine2', 0.01 * calm, 0.012 * calm, 0.006 * calm, 1.1);
    wob('head', 0.03, 0.045, 0.03, 0.8);
    wob('arm1L', 0.01, 0, 0.012, 1.2);
    wob('arm1R', 0.01, 0, 0.012, 1.3);

    if (this.talk > 0.01 || this.pulse > 0) {
      const a = this.talk * 0.05 + this.pulse * 0.05;

      wob('head', a, a * 0.8, a * 0.6, 5.5);
      wob('neck', a * 0.4, 0, a * 0.3, 4.1);
      wob('spine2', this.talk * 0.012, 0, 0, 3.3);
    }
  }
}
