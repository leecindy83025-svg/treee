// main.js
import * as THREE from 'three';
import {
  FilesetResolver,
  GestureRecognizer,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js';

// ===== Renderer & Scene =====
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.4, 6);

// Lights
scene.add(new THREE.AmbientLight(0x232323, 0.6));
const keyLight = new THREE.DirectionalLight(0xfff3d0, 1.0);
keyLight.position.set(3, 6, 6);
scene.add(keyLight);
scene.add(new THREE.HemisphereLight(0x404050, 0x0b0b14, 0.35));

// ===== Particle Tree =====
const particleCount = 42000;
const particleGeo = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
const colors = new Float32Array(particleCount * 3);

const targetTree = new Float32Array(particleCount * 3);
const targetScatter = new Float32Array(particleCount * 3);

const colorA = new THREE.Color(0xc8b47e);
const colorB = new THREE.Color(0xe8e6df);

function generateTargets() {
  const height = 3.6, baseRadius = 1.6;
  for (let i = 0; i < particleCount; i++) {
    const h = Math.random() * height;
    const r = baseRadius * (1 - h / height);
    const theta = Math.random() * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.04;
    const x = (r + jitter) * Math.cos(theta);
    const z = (r + jitter) * Math.sin(theta);
    const y = h + (Math.random() - 0.5) * 0.03;

    targetTree[i*3+0] = x;
    targetTree[i*3+1] = y;
    targetTree[i*3+2] = z;

    // Scatter: random sphere shell
    const R = 5.0, u = Math.random(), v = Math.random();
    const phi = 2 * Math.PI * u, costheta = 2*v - 1, sintheta = Math.sqrt(1 - costheta*costheta);
    const sx = R * sintheta * Math.cos(phi);
    const sy = R * sintheta * Math.sin(phi);
    const sz = R * costheta;

    targetScatter[i*3+0] = sx;
    targetScatter[i*3+1] = sy;
    targetScatter[i*3+2] = sz;

    positions[i*3+0] = sx;
    positions[i*3+1] = sy;
    positions[i*3+2] = sz;

    // luxe dual tone
    const mix = Math.pow(Math.random(), 1.6);
    const c = colorA.clone().lerp(colorB, mix);
    colors[i*3+0] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
}
generateTargets();

particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const particleMat = new THREE.PointsMaterial({
  size: 0.035, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const particles = new THREE.Points(particleGeo, particleMat);
particles.position.y = 0.4;
scene.add(particles);

// ===== Snow Particles =====
const snowCount = 800;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(snowCount * 3);
const snowVel = new Float32Array(snowCount);
for (let i = 0; i < snowCount; i++) {
  snowPos[i*3+0] = (Math.random() - 0.5) * 18;
  snowPos[i*3+1] = Math.random() * 10;
  snowPos[i*3+2] = (Math.random() - 0.5) * 18;
  snowVel[i] = 0.6 + Math.random() * 0.8;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.8, depthWrite: false });
const snow = new THREE.Points(snowGeo, snowMat);
scene.add(snow);

// ===== Photos =====
const textureLoader = new THREE.TextureLoader();
const photoUrls = [
  '005OxMBSly1i3ex3b1milj32s41b84qs',
  '005OxMBSly1i3to23qhlcj32ls1jkhdx',
  '005OxMBSly1i4hzadvxo5j32sd1b84qu',
  '005OxMBSly1i287felpisj32s91b81l1',
];
const photos = [];
const photoGroup = new THREE.Group();
scene.add(photoGroup);

function spawnPhotos() {
  photoUrls.forEach(url => {
    const tex = textureLoader.load(url);
    const geo = new THREE.PlaneGeometry(1.0, 1.3);
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex, clearcoat: 0.6, clearcoatRoughness: 0.2, roughness: 0.45, metalness: 0.0, sheen: 0.3,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random()-0.5)*8, 0.8 + (Math.random()-0.5)*3, (Math.random()-0.5)*8);
    mesh.rotation.set((Math.random()-0.5)*0.6, (Math.random()-0.5)*1.2, (Math.random()-0.5)*0.2);
    mesh.userData.floatPhase = Math.random() * Math.PI * 2;
    photos.push(mesh);
    photoGroup.add(mesh);
  });
}
spawnPhotos();

// ===== State Machine =====
const STATE = { TREE: 'TREE', SCATTER: 'SCATTER', FOCUS: 'FOCUS' };
let currentState = STATE.SCATTER;
let morphT = 0; // 0 scatter, 1 tree
let focusPhoto = null;

// ===== Resize =====
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ===== MediaPipe GestureRecognizer =====
const videoEl = document.getElementById('cam');
let gestureRecognizer = null;
let lastGesture = null;

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  videoEl.srcObject = stream;
  await videoEl.play();
}

async function setupGesture() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  gestureRecognizer = await GestureRecognizer.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float32/1/gesture_recognizer.task',
    },
    runningMode: 'VIDEO',
  });
}

function mapGesture(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('closed') || n.includes('fist')) return 'FIST';
  if (n.includes('open') || n.includes('palm')) return 'OPEN';
  if (n.includes('pinch')) return 'PINCH';
  return null;
}

async function runGestureLoop() {
  await setupCamera();
  await setupGesture();

  const tick = () => {
    if (gestureRecognizer && videoEl.readyState >= 2) {
      const result = gestureRecognizer.recognizeForVideo(videoEl, performance.now());
      if (result && result.gestures && result.gestures[0] && result.gestures[0][0]) {
        const category = result.gestures[0][0].categoryName;
        const mapped = mapGesture(category);
        if (mapped && mapped !== lastGesture) {
          lastGesture = mapped;
          onGesture(mapped);
        }
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function onGesture(g) {
  if (g === 'FIST') {
    currentState = STATE.TREE;      // 握拳→聚合成树
  } else if (g === 'OPEN') {
    currentState = STATE.SCATTER;   // 张开→散开
    focusPhoto = null;
  } else if (g === 'PINCH') {
    focusPhoto = pickClosestPhotoToCamera(); // 捏合→聚焦照片
    if (focusPhoto) currentState = STATE.FOCUS;
  }
}

function pickClosestPhotoToCamera() {
  let best = null, bestD = Infinity;
  const camPos = camera.position.clone();
  photos.forEach(p => {
    const d = p.position.distanceTo(camPos);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}

// ===== Animate =====
const clock = new THREE.Clock();

function animate() {
  const dt = clock.getDelta();

  // Snow
  const sPos = snowGeo.attributes.position.array;
  for (let i = 0; i < snowCount; i++) {
    sPos[i*3+1] -= snowVel[i] * dt;
    sPos[i*3+0] += Math.sin(i * 0.013 + performance.now() * 0.0008) * 0.005;
    if (sPos[i*3+1] < -1) {
      sPos[i*3+1] = 8 + Math.random() * 2;
      sPos[i*3+0] = (Math.random()-0.5)*18;
      sPos[i*3+2] = (Math.random()-0.5)*18;
    }
  }
  snowGeo.attributes.position.needsUpdate = true;

  // Morph particles
  const speed = 0.8;
  if (currentState === STATE.TREE) morphT = Math.min(1, morphT + dt * speed);
  else if (currentState === STATE.SCATTER) morphT = Math.max(0, morphT - dt * speed);

  const pos = particleGeo.attributes.position.array;
  for (let i = 0; i < particleCount; i++) {
    const i3 = i*3;
    pos[i3+0] = targetScatter[i3+0]*(1-morphT) + targetTree[i3+0]*morphT;
    pos[i3+1] = targetScatter[i3+1]*(1-morphT) + targetTree[i3+1]*morphT;
    pos[i3+2] = targetScatter[i3+2]*(1-morphT) + targetTree[i3+2]*morphT;
  }
  particleGeo.attributes.position.needsUpdate = true;

  // Photos float & focus
  photos.forEach(p => {
    p.userData.floatPhase += dt * 0.5;
    const sway = Math.sin(p.userData.floatPhase) * 0.02;
    p.position.y += sway;
    p.rotation.y += 0.15 * dt;
    p.rotation.x += 0.07 * dt;
  });

  if (currentState === STATE.FOCUS && focusPhoto) {
    const targetPos = new THREE.Vector3(0, 1.2, camera.position.z - 1.8);
    focusPhoto.position.lerp(targetPos, 0.15);
    focusPhoto.rotation.set(0, 0, 0);
    photos.forEach(p => (p.material.opacity = p === focusPhoto ? 1.0 : 0.35));
  } else {
    photos.forEach(p => (p.material.opacity = 1.0));
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

runGestureLoop();
animate();
