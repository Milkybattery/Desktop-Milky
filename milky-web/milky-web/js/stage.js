// The 3D stage: Milky behind a desk, posed and animated procedurally.
//
// Poses are snapshots of every bone's local transform. "neutral" is built from the T-pose with a
// few world-space rotations, "feetUp" is read from animations/pose1.glb, and emotions are small
// tweaks on top of neutral. At runtime the poses are blended and a little breathing, swaying and
// talking motion is layered over the top.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const OUTLINE = 0x231451;
// Emotions that have their own head texture: add a name here once assets/faces/<name>.png exists.
const CUSTOM_FACES = [];
const MODEL_HEIGHT = 1.7; // world units; her T-pose is scaled to this tall

// World-space rotation recipes. Each step is [bone, axis, degrees]; "side" steps are mirrored so
// that +1 is her screen-right arm. Applied parent-first.
function neutralRecipe() {
  const steps = [];
  for (const side of [1, -1]) {
    const sfx = side === 1 ? 'l' : 'r'; // her left is screen right when she faces the camera
    steps.push([`upperarm_${sfx}`, Z, -side * 58]);
    steps.push([`lowerarm_${sfx}`, X, -62]);
    steps.push([`hand_${sfx}`, X, -10]);
  }
  steps.push(['head', Z, 3]);
  return steps;
}

const EMOTION_RECIPES = {
  sad: [
    ['spine_03', X, 9],
    ['neck_01', X, 10],
    ['head', X, 14],
    ['upperarm_l', Z, -6], ['upperarm_r', Z, 6],
  ],
  uneasy: [
    ['spine_03', Z, 4],
    ['head', Z, -9],
    ['head', Y, 14],
    ['shoulder_l', Z, 9], ['shoulder_r', Z, -9],
    ['lowerarm_l', X, -16], ['lowerarm_r', X, -16],
  ],
};

export class Stage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(20, 2, 0.1, 100);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
    sun.position.set(-1.2, 2, 3);
    this.scene.add(sun);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);

    this.bones = {};          // name -> Object3D
    this.rest = null;         // T-pose snapshot
    this.poses = {};          // name -> snapshot
    this.feet = 0;            // 0..1 blend towards feetUp
    this.feetTarget = 0;
    this.emotion = 'neutral';
    this.emo = { sad: 0, uneasy: 0 };
    this.talking = false;
    this.talk = 0;            // smoothed talking amount
    this.pulse = 0;           // short head bob per spoken letter
    this.t = 0;
    this.faces = {};          // optional head textures per emotion
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
    const w = 1.15, h = 1.08, d = 0.62;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mats = [
      new THREE.MeshLambertMaterial({ color: 0xa6a3ad }), // right
      new THREE.MeshLambertMaterial({ color: 0xa6a3ad }), // left
      new THREE.MeshLambertMaterial({ color: 0xc4c1ca }), // top
      new THREE.MeshLambertMaterial({ color: 0x8f8c97 }), // bottom
      new THREE.MeshLambertMaterial({ color: 0x9a97a2 }), // front
      new THREE.MeshLambertMaterial({ color: 0x9a97a2 }), // back
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

  async load(modelUrl, poseUrl) {
    const loader = new GLTFLoader();
    const [m, p] = await Promise.all([loader.loadAsync(modelUrl), loader.loadAsync(poseUrl)]);
    const model = m.scene;
    this.model = model;
    this.holder.add(model);

    model.traverse((o) => {
      if (o.isBone || o.type === 'Bone') this.bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) if (mt.name === 'head') this.headMat = mt;
      }
    });
    if (this.headMat) this.baseHeadMap = this.headMat.map;

    // scale her to MODEL_HEIGHT, feet on y = 0, centred on x = 0
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const k = MODEL_HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(k);
    model.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, 0);
    this.k = k;

    this.rest = this._snapshot();
    this.poses.rest = this.rest;

    // neutral: relaxed, arms on the desk
    this._reset();
    this._applyRecipe(neutralRecipe());
    this.poses.neutral = this._snapshot();

    // feetUp: the single keyframe in pose1.glb
    this._reset();
    const mixer = new THREE.AnimationMixer(model);
    const clip = p.animations.find((a) => a.tracks.length && a.duration === 0) || p.animations[0];
    mixer.clipAction(clip).play();
    mixer.update(0);
    this.poses.feetUp = this._snapshot();
    mixer.stopAllAction();
    mixer.uncacheRoot(model);

    // emotions, as tweaks on top of neutral
    for (const [name, recipe] of Object.entries(EMOTION_RECIPES)) {
      this._reset();
      this._applyPose(this.poses.neutral);
      this._applyRecipe(recipe);
      this.poses[name] = this._snapshot();
    }

    this._applyPose(this.poses.neutral);
    this._placeModel();
    this.ready = true;
    this._frameCamera();
    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  _placeModel() {
    // she stands behind the desk on the right-hand side of the stage
    this.holder.position.set(0.93, 0.12, 0);
  }

  _frameCamera() {
    // framed for a wide stage; on narrower ones pull back and slide towards her so she isn't cut off
    const cam = this.camera;
    const k = Math.max(1, 1.8 / cam.aspect);
    const target = new THREE.Vector3(0.45 + (k - 1) * 0.45, 1.4 + (k - 1) * 0.12, 0);
    cam.position.set(target.x, 1.9 + (k - 1) * 0.3, 3.1 * k);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }

  // ---------- pose plumbing ----------

  _snapshot() {
    const out = {};
    for (const [n, b] of Object.entries(this.bones)) {
      out[n] = { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() };
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

  _reset() { this._applyPose(this.rest); }

  _applyRecipe(steps) {
    const pq = new THREE.Quaternion();
    const wq = new THREE.Quaternion();
    for (const [name, axis, deg] of steps) {
      const b = this.bones[name];
      if (!b) { console.warn('no bone', name); continue; }
      b.parent.updateWorldMatrix(true, false);
      b.parent.getWorldQuaternion(pq);
      wq.setFromAxisAngle(axis, deg * DEG);
      // local' = parent^-1 * worldRotation * parent * local
      b.quaternion.premultiply(pq).premultiply(wq).premultiply(pq.clone().invert());
      b.updateMatrixWorld(true);
    }
  }

  // ---------- public controls ----------

  setFeet(up) { this.feetTarget = up ? 1 : 0; }
  setTalking(on) { this.talking = !!on; }
  blip() { this.pulse = 1; }

  setEmotion(name) {
    name = (name || 'neutral').toLowerCase();
    this.emotion = this.poses[name] && name in this.emo ? name : 'neutral';
    this._applyFace(this.emotion);
  }

  // optional: 1024x1024 head textures at assets/faces/<emotion>.png swap her face (see CUSTOM_FACES)
  async _applyFace(name) {
    if (!this.headMat) return;
    if (name === 'neutral') { this.headMat.map = this.baseHeadMap; this.headMat.needsUpdate = true; return; }
    if (!CUSTOM_FACES.includes(name)) { this.headMat.map = this.baseHeadMap; this.headMat.needsUpdate = true; return; }
    if (this.faces[name] === undefined) {
      this.faces[name] = null;
      try {
        const tex = await new THREE.TextureLoader().loadAsync(`./assets/faces/${name}.png`);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = this.baseHeadMap.wrapS; tex.wrapT = this.baseHeadMap.wrapT;
        tex.magFilter = this.baseHeadMap.magFilter; tex.minFilter = this.baseHeadMap.minFilter;
        this.faces[name] = tex;
      } catch { /* no custom face for this emotion, that's fine */ }
    }
    if (this.emotion !== name) return;
    this.headMat.map = this.faces[name] || this.baseHeadMap;
    this.headMat.needsUpdate = true;
  }

  // ---------- per-frame ----------

  _resize() {
    const p = this.canvas.parentElement;
    const w = Math.max(2, p.clientWidth), h = Math.max(2, p.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.ready) this._frameCamera();
  }

  _tick(ms) {
    const dt = Math.min(0.05, (ms / 1000) - this.t || 0.016);
    this.t = ms / 1000;
    if (!this.ready) return;
    const t = this.t;
    const ease = 1 - Math.pow(0.0015, dt); // frame-rate independent smoothing

    this.feet += (this.feetTarget - this.feet) * (1 - Math.pow(0.02, dt));
    for (const n of Object.keys(this.emo)) {
      const goal = this.emotion === n ? 1 : 0;
      this.emo[n] += (goal - this.emo[n]) * ease;
    }
    this.talk += ((this.talking ? 1 : 0) - this.talk) * ease;
    this.pulse = Math.max(0, this.pulse - dt * 7);

    this._blend();
    this._overlay(t);

    // the desk slides out of the way of the raised leg only visually; nothing else to do
    this.renderer.render(this.scene, this.camera);
  }

  _blend() {
    const N = this.poses.neutral, F = this.poses.feetUp;
    const q = new THREE.Quaternion();
    for (const [name, b] of Object.entries(this.bones)) {
      const n = N[name], f = F[name];
      if (!n) continue;
      // neutral -> feetUp
      b.position.lerpVectors(n.p, f.p, this.feet);
      q.copy(n.q).slerp(f.q, this.feet);
      b.scale.lerpVectors(n.s, f.s, this.feet);
      // plus each emotion's difference from neutral (rotations only)
      for (const [en, w] of Object.entries(this.emo)) {
        if (w < 0.001) continue;
        const e = this.poses[en][name];
        const dq = n.q.clone().invert().premultiply(e.q); // e = n * d  ->  d = n^-1 * e
        q.multiply(new THREE.Quaternion().identity().slerp(dq, w * (1 - this.feet * 0.6)));
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
      b.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
    };
    const calm = 1 - this.feet * 0.5;
    // breathing and a lazy sway
    wob('spine_02', 0.012 * calm, 0.01 * calm, 0.008 * calm, 1.4);
    wob('spine_03', 0.01 * calm, 0.012 * calm, 0.006 * calm, 1.1);
    wob('head', 0.03, 0.045, 0.03, 0.8);
    wob('upperarm_l', 0.01, 0, 0.012, 1.2);
    wob('upperarm_r', 0.01, 0, 0.012, 1.3);
    // talking: faster, bigger head motion plus a bounce on every spoken letter
    if (this.talk > 0.01 || this.pulse > 0) {
      const a = this.talk * 0.05 + this.pulse * 0.05;
      wob('head', a, a * 0.8, a * 0.6, 5.5);
      wob('neck_01', a * 0.4, 0, a * 0.3, 4.1);
      wob('spine_03', this.talk * 0.012, 0, 0, 3.3);
    }
  }
}
