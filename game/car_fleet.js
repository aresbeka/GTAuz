/**
 * car_fleet.js — Custom `.glb` Car Fleet Loader, Auto-Normalizer, Parking Bay Manager,
 * Wheel Spin/Steer Rig & Built-In Composite GT Starter Car for Pelican Campus Quest.
 *
 * Automatically loads every `.glb` file discovered by `tools/sync-models.mjs` in
 * `./models/manifest.json` (from the repository's `models/` folder), normalizes
 * scale/orientation/grounding to flush `y = 0.0`, spawns them on campus parking bays,
 * and allows entering, driving, drifting, flipping orientation, scaling, and runtime
 * `.glb` drag/import preview.
 */

import * as THREE from "../vendor/three.module.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { DRACOLoader } from "../vendor/DRACOLoader.js";
import { getOpenWorldTerrainHeight } from "../rig/kin.js";

const TARGET_CAR_LENGTH_M = 4.45;
const MIN_SCALE_MUL = 0.5;
const MAX_SCALE_MUL = 2.0;

// Curated flat campus parking bays starting directly in front of Gradient Canopy Drop-Off (`z = 116`)
// so user `.glb` cars are immediately visible and drivable when entering Free Roam!
export const CAMPUS_CAR_PARKING_BAYS = Object.freeze([
  { x: -7.5, z: 112.2, yaw: 0.28, zone: "Gradient Canopy Plaza" },
  { x: 7.5, z: 112.2, yaw: -0.28, zone: "Gradient Canopy Plaza" },
  { x: -16.0, z: 112.5, yaw: 0.35, zone: "Gradient Canopy West" },
  { x: 16.0, z: 112.5, yaw: -0.35, zone: "Gradient Canopy East" },
  { x: -24.5, z: 113.0, yaw: 0.42, zone: "Gradient Canopy West" },
  { x: 24.5, z: 113.0, yaw: -0.42, zone: "Gradient Canopy East" },
  { x: -12.0, z: 82.0, yaw: -Math.PI * 0.5, zone: "Charleston Rd" },
  { x: 12.0, z: 82.0, yaw: Math.PI * 0.5, zone: "Charleston Rd" },
  { x: -110.0, z: 96.0, yaw: 0.0, zone: "Android Lawn" },
  { x: -108.0, z: -26.0, yaw: 0.0, zone: "Googleplex Courtyard" },
  { x: 149.0, z: 52.0, yaw: 0.0, zone: "Bay View Waterfront" },
  { x: 149.0, z: 42.0, yaw: 0.0, zone: "Bay View Waterfront" },
  { x: 18.0, z: -172.0, yaw: -0.3, zone: "Shoreline Esplanade" },
  { x: -34.0, z: 113.0, yaw: 0.2, zone: "Gradient Canopy West" },
  { x: 34.0, z: 113.0, yaw: -0.2, zone: "Gradient Canopy East" },
  { x: -42.0, z: 113.0, yaw: 0.15, zone: "Gradient Canopy West" },
]);

const _box3 = new THREE.Box3();
const _size3 = new THREE.Vector3();
const _center3 = new THREE.Vector3();
const _childWorldPos = new THREE.Vector3();

function createCarContactShadowTexture() {
  const w = 128;
  const h = 256;
  const data = new Uint8Array(w * h * 4);
  for (let py = 0; py < h; py++) {
    const ny = ((py + 0.5) / h) * 2.0 - 1.0;
    for (let px = 0; px < w; px++) {
      const nx = ((px + 0.5) / w) * 2.0 - 1.0;
      const rx = Math.max(0, Math.abs(nx) - 0.18) / 0.82;
      const ry = Math.max(0, Math.abs(ny) - 0.24) / 0.76;
      const d = Math.hypot(rx, ry);
      const a = d < 1.0 ? Math.pow(1.0 - d * d, 2.0) * 0.62 : 0.0;
      const idx = (py * w + px) * 4;
      data[idx] = 10;
      data[idx + 1] = 14;
      data[idx + 2] = 22;
      data[idx + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createProximityRingTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const ny = ((py + 0.5) / size) * 2.0 - 1.0;
    for (let px = 0; px < size; px++) {
      const nx = ((px + 0.5) / size) * 2.0 - 1.0;
      const r = Math.hypot(nx, ny);
      const ring = Math.exp(-Math.pow((r - 0.84) / 0.055, 2.0));
      const softGlow = r < 0.88 && r > 0.68 ? Math.exp(-Math.pow((r - 0.84) / 0.13, 2.0)) * 0.35 : 0.0;
      const a = Math.min(1.0, ring + softGlow);
      const idx = (py * size + px) * 4;
      data[idx] = 96;
      data[idx + 1] = 195;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a sleek 12-part composite PBR Sports Coupe (`Campus GT Coupe`) so players have an
 * immediately drivable car even before placing custom `.glb` files in `models/`.
 * Oriented with forward = `-Z`, bottom grounded flush at `y = 0.0`.
 */
function buildBuiltInStarterCarGroup() {
  const group = new THREE.Group();
  group.name = "Campus_GT_Coupe_Starter";

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8,
    metalness: 0.78,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.95,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x181c24,
    metalness: 0.32,
    roughness: 0.42,
    envMapIntensity: 0.72,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.15,
    roughness: 0.08,
    clearcoat: 1.0,
    opacity: 0.88,
    transparent: true,
    envMapIntensity: 1.0,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0xdbe4ee,
    metalness: 0.92,
    roughness: 0.18,
    envMapIntensity: 0.9,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    metalness: 0.05,
    roughness: 0.82,
  });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    metalness: 0.45,
    roughness: 0.32,
  });
  const headLightMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xfff7d6,
    emissiveIntensity: 1.8,
    roughness: 0.15,
  });
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xef4444,
    emissiveIntensity: 1.9,
    roughness: 0.18,
  });

  // 1. Sculpted side-profile extruded lower body hull (`ExtrudeGeometry` with bevels)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.18, 0.26); // Rear bumper bottom
  hullShape.lineTo(2.18, 0.24);  // Front splitter
  hullShape.lineTo(2.22, 0.56);  // Front nose
  hullShape.lineTo(1.55, 0.78);  // Hood line
  hullShape.lineTo(0.72, 0.86);  // Base of windshield
  hullShape.lineTo(-1.42, 0.90); // Rear deck shoulder
  hullShape.lineTo(-2.18, 0.84); // Rear tail deck
  hullShape.lineTo(-2.22, 0.46); // Rear diffuser lip
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 1.72,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.08,
    bevelSegments: 3,
  });
  hullGeo.translate(0, 0, -0.86);
  // Rotate so +X (front in 2D shape) maps to -Z (Three.js vehicle forward)
  hullGeo.rotateY(Math.PI * 0.5);
  const hullMesh = new THREE.Mesh(hullGeo, paintMat);
  hullMesh.name = "Body_Hull";
  group.add(hullMesh);

  // 2. Sculpted fastback glass greenhouse cabin
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(-1.35, 0.82);
  cabinShape.lineTo(0.84, 0.80);
  cabinShape.lineTo(0.18, 1.32);
  cabinShape.lineTo(-0.78, 1.32);
  cabinShape.closePath();

  const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
    depth: 1.32,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.06,
    bevelSegments: 3,
  });
  cabinGeo.translate(0, 0, -0.66);
  cabinGeo.rotateY(Math.PI * 0.5);
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.name = "Cabin_Glass";
  group.add(cabinMesh);

  // 3. Painted roof cap
  const roofGeo = new THREE.BoxGeometry(1.24, 0.06, 1.15);
  const roofMesh = new THREE.Mesh(roofGeo, paintMat);
  roofMesh.position.set(0, 1.35, 0.25);
  group.add(roofMesh);

  // 4. Carbon-fiber front splitter & side skirts
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.06, 0.42), carbonMat);
  splitter.position.set(0, 0.22, -2.14);
  group.add(splitter);

  const sideSkirtL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 2.25), carbonMat);
  sideSkirtL.position.set(-0.96, 0.23, 0.02);
  group.add(sideSkirtL);

  const sideSkirtR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 2.25), carbonMat);
  sideSkirtR.position.set(0.96, 0.23, 0.02);
  group.add(sideSkirtR);

  // 5. Rear diffuser + GT Wing Spoiler
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.16, 0.24), carbonMat);
  diffuser.position.set(0, 0.26, 2.18);
  group.add(diffuser);

  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.28), carbonMat);
  wingBlade.position.set(0, 1.12, 2.02);
  wingBlade.rotation.x = 0.08;
  group.add(wingBlade);

  for (const sx of [-0.58, 0.58]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.18), carbonMat);
    strut.position.set(sx, 0.96, 1.98);
    group.add(strut);
  }

  // 6. Headlights & full-width LED tail light bar
  for (const sx of [-0.66, 0.66]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.12), headLightMat);
    hl.position.set(sx, 0.62, -2.23);
    group.add(hl);
  }
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.08, 0.08), tailLightMat);
  tailBar.position.set(0, 0.72, 2.24);
  group.add(tailBar);

  // 7. Side mirrors
  for (const sx of [-0.98, 0.98]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.12), paintMat);
    mirror.position.set(sx, 0.95, -0.58);
    group.add(mirror);
  }

  // 8. 4 Rotating Alloy Wheels + Brake Calipers (Front wheels wrapped in steering pivots!)
  const wheelRadius = 0.36;
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.27, 24);
  tireGeo.rotateZ(Math.PI * 0.5);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.285, 16);
  rimGeo.rotateZ(Math.PI * 0.5);
  const spokeGeo = new THREE.BoxGeometry(0.30, 0.42, 0.055);

  const wheelDefs = [
    { name: "Wheel_FL", x: -0.90, z: -1.36, isFront: true },
    { name: "Wheel_FR", x: 0.90, z: -1.36, isFront: true },
    { name: "Wheel_RL", x: -0.92, z: 1.36, isFront: false },
    { name: "Wheel_RR", x: 0.92, z: 1.36, isFront: false },
  ];

  const wheels = [];
  for (const wd of wheelDefs) {
    const steerPivot = new THREE.Group();
    steerPivot.name = `${wd.name}_Steer`;
    steerPivot.position.set(wd.x, wheelRadius, wd.z);

    const spinGroup = new THREE.Group();
    spinGroup.name = wd.name;
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const rim = new THREE.Mesh(rimGeo, alloyMat);
    const spokeA = new THREE.Mesh(spokeGeo, alloyMat);
    const spokeB = new THREE.Mesh(spokeGeo, alloyMat);
    spokeB.rotation.x = Math.PI * 0.5;
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), caliperMat);
    caliper.position.set(wd.x < 0 ? 0.06 : -0.06, 0.06, 0.12);

    spinGroup.add(tire, rim, spokeA, spokeB);
    steerPivot.add(spinGroup, caliper);
    group.add(steerPivot);

    wheels.push({
      steerPivot: wd.isFront ? steerPivot : null,
      spinNode: spinGroup,
      isFront: wd.isFront,
      baseRotX: 0,
      baseRotY: 0,
      radius: wheelRadius,
    });
  }

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  group.userData.builtInWheels = wheels;
  return group;
}

/**
 * Normalizes any arbitrary user `.glb` car scene:
 *  - Auto-aligns longest horizontal axis with `-Z`
 *  - Uniformly scales to realistic ~4.45m length
 *  - Centers horizontally at (0, 0) and grounds bottom flush at `y = 0.0`
 *  - Calibrates shadows, material `envMapIntensity`, and detects wheel sub-nodes
 */
function normalizeLoadedCarScene(rawScene, envMap = null) {
  const wrapper = new THREE.Group();
  wrapper.name = "NormalizedCarModel";

  const orientGroup = new THREE.Group();
  orientGroup.name = "CarOrientGroup";
  orientGroup.add(rawScene);
  wrapper.add(orientGroup);

  // Hide exported collision/helper shells (e.g., GTA ColMesh_*) before measuring bounds
  const helperMeshRe = /colmesh|collision_?mesh|shadow_?plane|hitbox/i;
  rawScene.traverse((obj) => {
    if (obj.isMesh && helperMeshRe.test(obj.name || "")) {
      obj.visible = false;
    }
  });

  rawScene.updateMatrixWorld(true);
  _box3.makeEmpty();
  const _meshBox = new THREE.Box3();
  rawScene.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    _meshBox.setFromObject(obj);
    if (!_meshBox.isEmpty()) _box3.union(_meshBox);
  });
  if (_box3.isEmpty()) {
    _box3.setFromObject(rawScene);
  }
  _box3.getSize(_size3);

  // Guard against degenerate/empty GLBs
  const maxHoriz = Math.max(_size3.x, _size3.z, 0.001);
  const baseScale = TARGET_CAR_LENGTH_M / maxHoriz;
  orientGroup.scale.setScalar(baseScale);

  // If car's length runs along X instead of Z, rotate 90 deg around Y
  if (_size3.x > _size3.z * 1.12) {
    orientGroup.rotation.y = Math.PI * 0.5;
  }

  wrapper.updateMatrixWorld(true);
  _box3.makeEmpty();
  orientGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    _meshBox.setFromObject(obj);
    if (!_meshBox.isEmpty()) _box3.union(_meshBox);
  });
  if (_box3.isEmpty()) {
    _box3.setFromObject(orientGroup);
  }
  _box3.getCenter(_center3);

  // Center X/Z and snap bottom flush to Y = 0.000m
  orientGroup.position.x -= _center3.x;
  orientGroup.position.z -= _center3.z;
  orientGroup.position.y -= _box3.min.y;

  wrapper.updateMatrixWorld(true);
  _box3.makeEmpty();
  wrapper.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    _meshBox.setFromObject(obj);
    if (!_meshBox.isEmpty()) _box3.union(_meshBox);
  });
  if (_box3.isEmpty()) {
    _box3.setFromObject(wrapper);
  }
  _box3.getSize(_size3);

  const carWidthM = Math.max(1.4, Math.min(2.6, _size3.x));
  const carHeightM = Math.max(0.9, Math.min(2.8, _size3.y));
  const carLengthM = Math.max(2.8, Math.min(6.0, _size3.z));

  const detectedWheels = [];
  const wheelNameRe = /wheel|tire|tyre|rim|hub|roue|rad|rueda|ko.?l|g.?ildirak|balon|shina/i;
  const frontNameRe = /front|fl|fr|_f_|_f$|перед|old/i;
  const _wheelBox = new THREE.Box3();
  const _wheelSize = new THREE.Vector3();

  rawScene.traverse((obj) => {
    if (obj.isMesh && obj.visible) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
          if (envMap && !m.envMap) m.envMap = envMap;
          m.envMapIntensity = Math.min(Math.max(m.envMapIntensity ?? 0.85, 0.55), 1.15);
        }
      }
    }

    if (obj !== rawScene && obj.visible && wheelNameRe.test(obj.name || "")) {
      // Avoid double-registering child mesh inside an already registered wheel group
      let ancestorRegistered = false;
      let p = obj.parent;
      while (p && p !== rawScene) {
        if (wheelNameRe.test(p.name || "")) {
          ancestorRegistered = true;
          break;
        }
        p = p.parent;
      }
      if (!ancestorRegistered) {
        // Only spin compact individual wheel nodes (ignore merged multi-wheel or body+wheel meshes)
        _wheelBox.setFromObject(obj);
        _wheelBox.getSize(_wheelSize);
        const maxDim = Math.max(_wheelSize.x, _wheelSize.y, _wheelSize.z);
        if (maxDim > 0.15 && maxDim < 1.25) {
          obj.getWorldPosition(_childWorldPos);
          const isFront = frontNameRe.test(obj.name || "") || _childWorldPos.z < -0.25;
          detectedWheels.push({
            steerPivot: null,
            spinNode: obj,
            isFront,
            baseRotX: obj.rotation.x,
            baseRotY: obj.rotation.y,
            radius: Math.max(0.24, Math.min(0.55, _wheelSize.y * 0.5)),
          });
        }
      }
    }
  });

  return {
    modelWrapper: wrapper,
    carWidthM,
    carHeightM,
    carLengthM,
    wheels: detectedWheels,
  };
}

export class CarFleetManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.envMap = options.envMap || null;
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath("./draco/gltf/");
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(this.dracoLoader);

    this.root = new THREE.Group();
    this.root.name = "CustomCarFleetRoot";
    this.scene.add(this.root);

    this.shadowTex = createCarContactShadowTexture();
    this.ringTex = createProximityRingTexture();

    this.cars = [];
    this.activeCarId = null;
    this._localImportCounter = 0;
  }

  setEnvMap(envMap) {
    this.envMap = envMap;
  }

  _getParkingBayForIndex(idx) {
    if (idx < CAMPUS_CAR_PARKING_BAYS.length) {
      return CAMPUS_CAR_PARKING_BAYS[idx];
    }
    const extra = idx - CAMPUS_CAR_PARKING_BAYS.length;
    return {
      x: -48.0 + (extra % 12) * 8.5,
      z: 104.0 - Math.floor(extra / 12) * 10.0,
      yaw: 0.0,
      zone: "Campus Lot",
    };
  }

  _createCarEntity({ id, name, source, url, modelWrapper, carWidthM, carHeightM, carLengthM, wheels, bay }) {
    const root = new THREE.Group();
    root.name = `DrivableCar_${id}`;
    root.rotation.order = "YXZ";

    const bodyTiltGroup = new THREE.Group();
    bodyTiltGroup.name = "CarBodyTilt";
    bodyTiltGroup.rotation.order = "YXZ";

    const userAdjustGroup = new THREE.Group();
    userAdjustGroup.name = "CarUserAdjust";
    userAdjustGroup.add(modelWrapper);

    bodyTiltGroup.add(userAdjustGroup);
    root.add(bodyTiltGroup);

    // Grounded Contact Shadow
    const shadowGeo = new THREE.PlaneGeometry(carWidthM * 1.32, carLengthM * 1.18);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.y = 0.025;
    root.add(shadowMesh);

    // Subtle Ground Interaction Ring (visible when parked & player approaches)
    const ringRadius = Math.max(carWidthM, carLengthM) * 0.64;
    const ringGeo = new THREE.PlaneGeometry(ringRadius * 2.0, ringRadius * 2.0);
    ringGeo.rotateX(-Math.PI * 0.5);
    const ringMat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.04;
    root.add(ringMesh);

    const groundY = getOpenWorldTerrainHeight(bay.x, bay.z);
    root.position.set(bay.x, groundY, bay.z);
    root.rotation.set(0, -bay.yaw, 0, "YXZ");
    this.root.add(root);

    const entity = {
      id,
      name,
      source,
      url: url || null,
      zone: bay.zone || "Campus",
      root,
      bodyTiltGroup,
      userAdjustGroup,
      shadowMesh,
      ringMesh,
      wheels: wheels || [],
      carWidthM,
      carHeightM,
      carLengthM,
      x: bay.x,
      y: groundY,
      z: bay.z,
      yaw: bay.yaw,
      slopePitchRad: 0.0,
      rollRad: 0.0,
      pitchDiveRad: 0.0,
      wheelSpinRad: 0.0,
      flip180: false,
      scaleMul: 1.0,
      spawnX: bay.x,
      spawnZ: bay.z,
      spawnYaw: bay.yaw,
    };

    this.cars.push(entity);
    return entity;
  }

  /**
   * Loads `./models/manifest.json` (generated from `models/*.glb`) and spawns every user `.glb` car
   * plus the built-in `Campus GT Coupe` starter car so driving always works immediately!
   */
  async loadFromManifest() {
    let manifestCars = [];
    if (typeof fetch === "function") {
      try {
        const res = await fetch("./models/manifest.json", { cache: "no-cache" });
        if (res && res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.cars)) {
            manifestCars = json.cars;
          }
        }
      } catch (_err) {
        manifestCars = [];
      }
    }

    // 1. Load every custom `.glb` model from `models/`
    for (let i = 0; i < manifestCars.length; i++) {
      const entry = manifestCars[i];
      try {
        const gltf = await new Promise((resolve, reject) => {
          this.loader.load(entry.url, resolve, undefined, reject);
        });
        if (gltf && gltf.scene) {
          const norm = normalizeLoadedCarScene(gltf.scene, this.envMap);
          const bay = this._getParkingBayForIndex(this.cars.length);
          this._createCarEntity({
            id: entry.id,
            name: entry.name,
            source: "models",
            url: entry.url,
            ...norm,
            bay,
          });
        }
      } catch (err) {
        console.warn(`[CarFleet] Failed to load model "${entry.fileName}":`, err);
      }
    }

    // 2. Always include the built-in Campus GT Coupe starter car (parked in the next bay, or bay #0 if `models/` is empty)
    const starterGroup = buildBuiltInStarterCarGroup();
    const starterBay = this._getParkingBayForIndex(this.cars.length);
    this._createCarEntity({
      id: "campus_gt_coupe",
      name: "Campus GT Coupe",
      source: "builtin",
      url: null,
      modelWrapper: starterGroup,
      carWidthM: 1.98,
      carHeightM: 1.38,
      carLengthM: 4.46,
      wheels: starterGroup.userData.builtInWheels || [],
      bay: starterBay,
    });

    return this.getSerializableList();
  }

  /**
   * Lets players test any local `.glb` file directly in the browser before committing to `models/`.
   */
  async loadLocalGlbFile(file) {
    if (!file) return null;
    const arrayBuf = await file.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength < 16) {
      throw new Error("Invalid .glb file");
    }
    const gltf = await new Promise((resolve, reject) => {
      this.loader.parse(arrayBuf, "", resolve, reject);
    });
    if (!gltf || !gltf.scene) {
      throw new Error("GLB scene is empty");
    }

    this._localImportCounter += 1;
    const cleanName = String(file.name || `Custom Car ${this._localImportCounter}`)
      .replace(/\.glb$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    const displayName = cleanName
      ? cleanName
          .split(/\s+/)
          .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
          .join(" ")
      : `Custom Car ${this._localImportCounter}`;

    const norm = normalizeLoadedCarScene(gltf.scene, this.envMap);
    const bay = this._getParkingBayForIndex(this.cars.length);
    const entity = this._createCarEntity({
      id: `local_glb_${Date.now()}_${this._localImportCounter}`,
      name: displayName,
      source: "local",
      url: null,
      ...norm,
      bay,
    });
    return entity;
  }

  getCarById(id) {
    return this.cars.find((c) => c.id === id) || null;
  }

  getActiveCar() {
    return this.activeCarId ? this.getCarById(this.activeCarId) : null;
  }

  findNearestCar(x, z, maxDistM = 5.5) {
    let best = null;
    let bestDist = maxDistM;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.id === this.activeCarId) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best ? { car: best, distM: bestDist } : null;
  }

  setCarFlip180(carId, flipBool) {
    const car = this.getCarById(carId);
    if (!car) return null;
    car.flip180 = typeof flipBool === "boolean" ? flipBool : !car.flip180;
    car.userAdjustGroup.rotation.y = car.flip180 ? Math.PI : 0.0;
    return car;
  }

  adjustCarScale(carId, deltaScale) {
    const car = this.getCarById(carId);
    if (!car) return null;
    car.scaleMul = THREE.MathUtils.clamp(
      Number((car.scaleMul + deltaScale).toFixed(2)),
      MIN_SCALE_MUL,
      MAX_SCALE_MUL
    );
    car.userAdjustGroup.scale.setScalar(car.scaleMul);
    return car;
  }

  resetAllCarsToBays() {
    this.activeCarId = null;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.x = c.spawnX;
      c.z = c.spawnZ;
      c.yaw = c.spawnYaw;
      c.y = getOpenWorldTerrainHeight(c.x, c.z);
      c.slopePitchRad = 0;
      c.rollRad = 0;
      c.pitchDiveRad = 0;
      c.root.position.set(c.x, c.y, c.z);
      c.root.rotation.set(0, -c.yaw, 0, "YXZ");
      c.bodyTiltGroup.rotation.set(0, 0, 0);
      c.shadowMesh.visible = true;
      c.ringMesh.material.opacity = 0.0;
    }
  }

  /**
   * Updates active driven car transform, wheel rotation, body roll/pitch, and parked proximity halos.
   */
  update(dt, snap, state) {
    const isDrivingCar = state.activeVehicle === "car" && Boolean(state.activeCarId);
    this.activeCarId = isDrivingCar ? state.activeCarId : null;
    const simT = Number(state.elapsedTime) || 0.0;
    const pulse = 0.55 + 0.45 * Math.sin(simT * 4.2);

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (isDrivingCar && car.id === this.activeCarId) {
        car.x = snap.x;
        car.y = snap.y;
        car.z = snap.z;
        car.yaw = snap.headingYaw;
        car.slopePitchRad = snap.slopePitchRad || 0.0;

        car.root.position.set(car.x, car.y, car.z);
        car.root.rotation.set(car.slopePitchRad, -car.yaw, 0, "YXZ");

        // Smooth outward suspension body roll & acceleration/braking pitch dive
        const speedMps = Number(snap.speedMps) || 0.0;
        const steerRad = Number(snap.steerRad) || 0.0;
        const targetRoll = THREE.MathUtils.clamp(
          -(speedMps * speedMps * steerRad) * 0.00055,
          -0.068,
          0.068
        );
        const accelSignal = Number(snap.carAccelMps2) || 0.0;
        const targetPitch = THREE.MathUtils.clamp(accelSignal * 0.0024, -0.042, 0.045);

        const dampAlpha = 1.0 - Math.exp(-10.0 * Math.max(dt, 1 / 120));
        car.rollRad = THREE.MathUtils.lerp(car.rollRad, targetRoll, dampAlpha);
        car.pitchDiveRad = THREE.MathUtils.lerp(car.pitchDiveRad, targetPitch, dampAlpha);
        car.bodyTiltGroup.rotation.set(car.pitchDiveRad, 0, car.rollRad, "YXZ");

        // Spin & steer detected wheel nodes
        const wheelSpinDelta = (speedMps * dt) / 0.36;
        car.wheelSpinRad += wheelSpinDelta;
        const steerSign = car.flip180 ? 1 : -1;
        for (let w = 0; w < car.wheels.length; w++) {
          const wh = car.wheels[w];
          if (wh.steerPivot) {
            wh.steerPivot.rotation.y = -steerRad * 0.9;
            wh.spinNode.rotation.x = -car.wheelSpinRad;
          } else if (wh.spinNode) {
            wh.spinNode.rotation.x = wh.baseRotX - car.wheelSpinRad * (car.flip180 ? -1 : 1);
            if (wh.isFront) {
              wh.spinNode.rotation.y = wh.baseRotY + steerSign * steerRad * 0.55;
            }
          }
        }

        // Fade contact shadow when airborne over ramps
        const jh = Math.max(0.0, Number(snap.jumpHeightM) || 0.0);
        car.shadowMesh.visible = jh < 1.8;
        car.shadowMesh.position.y = Math.max(0.025, 0.025 - jh);
        car.shadowMesh.material.opacity = 0.65 * Math.exp(-jh * 1.8);
        car.ringMesh.material.opacity = 0.0;
      } else {
        // Parked car — gently settle body tilt & show interaction halo when player is nearby
        car.rollRad *= Math.exp(-8.0 * Math.max(dt, 1 / 120));
        car.pitchDiveRad *= Math.exp(-8.0 * Math.max(dt, 1 / 120));
        car.bodyTiltGroup.rotation.set(car.pitchDiveRad, 0, car.rollRad, "YXZ");
        car.shadowMesh.visible = true;
        car.shadowMesh.position.y = 0.025;
        car.shadowMesh.material.opacity = 0.65;

        const dist = Math.hypot(car.x - snap.x, car.z - snap.z);
        if (!isDrivingCar && dist < 16.0 && state.gameMode === "free_roam") {
          const proximity = THREE.MathUtils.clamp((16.0 - dist) / 11.0, 0.0, 1.0);
          car.ringMesh.material.opacity = (dist < 5.5 ? 0.65 : 0.28) * proximity * pulse;
        } else {
          car.ringMesh.material.opacity = 0.0;
        }
      }
    }
  }

  getSerializableList() {
    return this.cars.map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      zone: c.zone,
      x: Number(c.x.toFixed(2)),
      z: Number(c.z.toFixed(2)),
      yaw: Number(c.yaw.toFixed(3)),
      flip180: Boolean(c.flip180),
      scaleMul: Number(c.scaleMul.toFixed(2)),
    }));
  }
}
