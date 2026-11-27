import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// ================= 1. CẤU HÌNH FIREBASE & HẰNG SỐ =================
const firebaseConfig = {
  apiKey: "AIzaSyCXcDemE_sIYBIlqO3p6S_8P0HNGKisvoE",
  databaseURL: "https://fir-game-92590-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fir-game-92590"
};

const IS_DEMO_MODE = !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY";
let db = null;
if (!IS_DEMO_MODE) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

const ROOM_ID = 'le_hoi_dong_son_2026';
const FINISH_LINE = 600;
const LANE_SPACING = 5.4;
const ALL_ROLES = ['rower_left', 'rower_right', 'drummer', 'scholar', 'saboteur'];

const ROLE_NAMES = {
  rower_left: '🚣 Tay Chèo Trái',
  rower_right: '🚣 Tay Chèo Phải',
  drummer: '🥁 Tay Trống',
  scholar: '📜 Đáp Hội',
  saboteur: '💣 Kẻ Phá Đám'
};

// Ngắn gọn: Ai - Làm gì - Ảnh hưởng ai
const ROLE_BRIEF = {
  rower_left: '<b>Ai:</b> Chèo Trái · <b>Làm:</b> Chèo đúng nhịp & lệnh · <b>Ảnh hưởng:</b> Đẩy ghe, chèo đồng nhịp tạo sóng.',
  rower_right: '<b>Ai:</b> Chèo Phải · <b>Làm:</b> Chèo đúng nhịp & lệnh · <b>Ảnh hưởng:</b> Đẩy ghe, chèo đồng nhịp tạo sóng.',
  er: '<b>Ai:</b> Tay Trống · <b>Làm:</b> Gõ nhịp/dồn trống/ngân chiêng · <b>Ảnh hưởng:</b> Combo ≥ 3 mở rộng vùng chèo cho đội.',
  scholar: '<b>Ai:</b> Đáp Hội · <b>Làm:</b> Ghép chữ hoặc đổi mảnh hình · <b>Ảnh hưởng:</b> Nạp Linh Khí cho cả ghe.',
  saboteur: '<b>Ai:</b> Phá Đám · <b>Làm:</b> Giữ xoay hướng & thả ném Bèo · <b>Ảnh hưởng:</b> Làm chậm ghe địch hoặc buff Tù Và.'
};

const state = {
  playerId: 'p_' + Math.random().toString(36).slice(2, 8),
  name: '',
  status: 'lobby',
  assignedBoat: 0,
  assignedRole: 'rower_left',
  focusBoat: null,
  camYaw: 0,      // Xoay 360° quanh ghe
  camPitch: 0.42, // Độ cao góc nhìn
  score: 0,       // Điểm đóng góp cá nhân
  players: {},
  lastThrowId: '',
  lastEventTime: 0,
  boats: [
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 }
  ]
};

// ================= 2. ÂM THANH LỄ HỘI =================
let audioCtx = null;
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playDrumSound(freq = 110, duration = 0.18, type = 'sine', gainPeak = 0.38) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(38, audioCtx.currentTime + duration);
  gain.gain.setValueAtTime(gainPeak, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.008, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playCheerSound() {
  if (!audioCtx) return;
  [523.25, 587.33, 659.25, 783.99, 880.0].forEach((f, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, audioCtx.currentTime + i * 0.055);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime + i * 0.055);
    gain.gain.exponentialRampToValueAtTime(0.004, audioCtx.currentTime + i * 0.055 + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + i * 0.055);
    osc.stop(audioCtx.currentTime + i * 0.055 + 0.3);
  });
}

// ================= 3. MẶT NƯỚC & HOA VĂN TRỐNG ĐỒNG =================
function createRiverTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#105461');
  grad.addColorStop(0.5, '#1d7a88');
  grad.addColorStop(1, '#105461');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  for (let y = 14; y < 512; y += 28) {
    ctx.strokeStyle = y % 56 === 14 ? 'rgba(225, 252, 255, 0.28)' : 'rgba(255, 232, 163, 0.14)';
    ctx.lineWidth = y % 56 === 14 ? 2.2 : 1.5;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const wy = y + Math.sin((x / 512) * Math.PI * 8 + y * 0.06) * 4.2;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 226, 138, 0.25)';
  ctx.setLineDash([14, 14]);
  ctx.lineWidth = 2;
  [128, 256, 384].forEach(lx => {
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, 512);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 55);
  return tex;
}

function createDongSonMedallionTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(255, 214, 107, 0.78)';
  ctx.lineWidth = 3;
  [42, 72, 106].forEach((r, idx) => {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();

    const teeth = 18 + idx * 8;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(128 + Math.cos(a) * (r - 4), 128 + Math.sin(a) * (r - 4));
      ctx.lineTo(128 + Math.cos(a) * (r + 5), 128 + Math.sin(a) * (r + 5));
      ctx.stroke();
    }
  });

  ctx.fillStyle = 'rgba(255, 232, 148, 0.92)';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.cos(a - 0.14) * 12, 128 + Math.sin(a - 0.14) * 12);
    ctx.lineTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
    ctx.lineTo(128 + Math.cos(a + 0.14) * 12, 128 + Math.sin(a + 0.14) * 12);
    ctx.closePath();
    ctx.fill();
  }

  return new THREE.CanvasTexture(c);
}

// ================= 4. CẢNH 3D, GHE NGO & QUỸ ĐẠO CHẤM ĐỎ =================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e5c69);
scene.fog = new THREE.Fog(0x1e5c69, 42, 175);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
scene.add(new THREE.HemisphereLight(0xd9f7ff, 0x16424a, 1.45));
const sunLight = new THREE.DirectionalLight(0xfff1c4, 2.35);
sunLight.position.set(16, 26, 12);
scene.add(sunLight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const riverTex = createRiverTexture();
const river = new THREE.Mesh(
  new THREE.PlaneGeometry(36, FINISH_LINE + 180),
  new THREE.MeshStandardMaterial({ map: riverTex, roughness: 0.3, metalness: 0.25 })
);
river.rotation.x = -Math.PI / 2;
river.position.z = -(FINISH_LINE + 180) / 2 + 35;
scene.add(river);

const bankMat = new THREE.MeshStandardMaterial({ color: 0x286b43, roughness: 0.85 });
[-22, 22].forEach(xPos => {
  const bank = new THREE.Mesh(new THREE.BoxGeometry(8, 1.4, FINISH_LINE + 180), bankMat);
  bank.position.set(xPos, 0.1, -(FINISH_LINE + 180) / 2 + 35);
  scene.add(bank);
});

const postGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.4, 8);
const postMat = new THREE.MeshStandardMaterial({ color: 0xffe082, emissive: 0x8c6213, emissiveIntensity: 0.35 });
const flagColors = [0xe64635, 0xf2c14e, 0x1ec8a5, 0xf27d24];
const banners = [];

for (let z = 0; z >= -FINISH_LINE; z -= 30) {
  [-17.5, 17.5].forEach((xPos, sideIdx) => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(xPos, 1.7, z);
    scene.add(post);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.85),
      new THREE.MeshStandardMaterial({
        color: flagColors[(Math.abs(z) / 30 + sideIdx) % flagColors.length],
        side: THREE.DoubleSide
      })
    );
    flag.position.set(xPos + (xPos < 0 ? 0.65 : -0.65), 2.95, z);
    scene.add(flag);
    banners.push({ mesh: flag, phase: z * 0.05 + sideIdx });
  });
}

const medallionTex = createDongSonMedallionTexture();
const medallionMat = new THREE.MeshBasicMaterial({ map: medallionTex, transparent: true, depthWrite: false });
for (let z = -60; z >= -FINISH_LINE; z -= 120) {
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), medallionMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0.04, z);
  scene.add(disc);
}

const arch = new THREE.Mesh(
  new THREE.TorusGeometry(15.5, 0.6, 8, 36, Math.PI),
  new THREE.MeshStandardMaterial({ color: 0xffe082, emissive: 0xe6be52, emissiveIntensity: 0.8 })
);
arch.position.set(0, 0, -FINISH_LINE);
scene.add(arch);

const boatColors = [0xe6be52, 0xd93f30, 0x19bfa0, 0xf27d24];
const boatObjects = boatColors.map((color, idx) => {
  const group = new THREE.Group();

  const hull = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.8, 9.6, 8),
    new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.24 })
  );
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.14, 1, 0.66);
  group.add(hull);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.12, 0.12, 9.1),
    new THREE.MeshStandardMaterial({ color: 0xffe699, metalness: 0.85, roughness: 0.2 })
  );
  trim.position.set(0, 0.36, 0);
  group.add(trim);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 2.5, 6),
    new THREE.MeshStandardMaterial({ color: 0xffe699, metalness: 0.82, roughness: 0.2 })
  );
  bow.position.set(0, 0.9, -5.0);
  bow.rotation.x = -Math.PI / 3.6;
  group.add(bow);

  const stern = new THREE.Mesh(
    new THREE.ConeGeometry(0.48, 1.8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffe699, metalness: 0.8, roughness: 0.22 })
  );
  stern.position.set(0, 0.75, 4.8);
  stern.rotation.x = Math.PI / 3.8;
  group.add(stern);

  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 4.2),
    new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, -0.25, 6.4);
  group.add(wake);

  const paddles = [];
  for (let p = 0; p < 5; p++) {
    const zPos = -2.6 + p * 1.3;
    const warrior = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.92, 6),
      new THREE.MeshStandardMaterial({ color: 0xf8eed8 })
    );
    warrior.position.set(0, 0.68, zPos);
    group.add(warrior);

    const feather = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.48, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xffe699 })
    );
    feather.position.set(0, 1.24, zPos);
    group.add(feather);

    const paddleGroup = new THREE.Group();
    paddleGroup.position.set(p % 2 === 0 ? -0.65 : 0.65, 0.55, zPos);
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 0.08, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xa66e38 })
    );
    shaft.position.set(p % 2 === 0 ? -0.45 : 0.45, 0, 0);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.45, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xffd66b })
    );
    blade.position.set(p % 2 === 0 ? -1.15 : 1.15, -0.18, 0);
    paddleGroup.add(shaft, blade);
    group.add(paddleGroup);
    paddles.push(paddleGroup);
  }

  const boostAura = new THREE.Mesh(
    new THREE.RingGeometry(1.3, 1.75, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe38e, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  );
  boostAura.rotation.x = -Math.PI / 2;
  boostAura.position.y = 0.12;
  boostAura.visible = false;
  group.add(boostAura);

  const debuffCloud = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.15, 0.24, 32, 8),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x145a32 })
  );
  debuffCloud.position.set(0, 1.15, 0);
  debuffCloud.visible = false;
  group.add(debuffCloud);

  group.position.set((idx - 1.5) * LANE_SPACING, 0.35, 0);
  scene.add(group);
  return { group, paddles, wake, boostAura, debuffCloud };
});

// Dấu ném dạng chấm đỏ cong 3D tới vùng ném của Kẻ Phá Đám
const ARC_DOT_COUNT = 18;
const arcDots = [];
const dotGeo = new THREE.SphereGeometry(0.18, 8, 8);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xff2e2e });
for (let i = 0; i < ARC_DOT_COUNT; i++) {
  const m = new THREE.Mesh(dotGeo, dotMat);
  m.visible = false;
  scene.add(m);
  arcDots.push(m);
}
const landingMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.35, 24),
  new THREE.MeshBasicMaterial({ color: 0xff3b30, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
);
landingMarker.rotation.x = -Math.PI / 2;
landingMarker.position.y = 0.08;
landingMarker.visible = false;
scene.add(landingMarker);

const aimState = {
  active: false,
  yawOffset: 0, // Người chơi giữ để xoay hướng ném tự do
  range: 14,    // Tầm xa ném điều chỉnh theo giữ
  landPoint: new THREE.Vector3()
};

function updateAimArc(boatIdx) {
  if (!aimState.active) {
    arcDots.forEach(d => { d.visible = false; });
    landingMarker.visible = false;
    return;
  }
  const start = boatObjects[boatIdx].group.position.clone();
  start.y = 1.2;

  const dirX = Math.sin(aimState.yawOffset);
  const dirZ = -Math.cos(aimState.yawOffset);
  const end = new THREE.Vector3(
    start.x + dirX * aimState.range,
    0.2,
    start.z + dirZ * aimState.range
  );
  aimState.landPoint.copy(end);

  const peakHeight = 4.2 + aimState.range * 0.14;
  for (let i = 0; i < ARC_DOT_COUNT; i++) {
    const t = (i + 1) / ARC_DOT_COUNT;
    const d = arcDots[i];
    d.visible = true;
    d.position.lerpVectors(start, end, t);
    d.position.y += Math.sin(t * Math.PI) * peakHeight;
    const sc = 0.65 + t * 0.55;
    d.scale.set(sc, sc, sc);
  }
  landingMarker.visible = true;
  landingMarker.position.set(end.x, 0.08, end.z);
}

// Hạt bọt nước
const splashes = [];
function spawnSplash(boatIdx, count = 6, colorHex = 0xe8fbff) {
  const origin = boatObjects[boatIdx].group.position;
  for (let i = 0; i < count; i++) {
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 6, 6),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.92 })
    );
    drop.position.set(
      origin.x + (Math.random() - 0.5) * 1.7,
      0.42,
      origin.z + (Math.random() - 0.5) * 3.6
    );
    scene.add(drop);
    splashes.push({
      mesh: drop,
      vx: (Math.random() - 0.5) * 0.13,
      vy: 0.09 + Math.random() * 0.12,
      vz: (Math.random() - 0.5) * 0.13,
      life: 1
    });
  }
}

// Bèo Tây bay theo quỹ đạo tới đúng điểm ngắm (có kiểm tra trúng ghe nào không)
const projectiles = [];
function spawn3DProjectileFromTo(fromBoatIdx, endPos, hitBoatIdx) {
  const startPos = boatObjects[fromBoatIdx].group.position.clone();
  startPos.y = 1.2;
  const hyacinthGroup = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: hitBoatIdx !== null ? 0x1e8449 : 0x4d5656, emissiveIntensity: 0.45 });
  for (let k = 0; k < 4; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), leafMat);
    leaf.scale.set(1.2, 0.55, 1.2);
    leaf.position.set(Math.cos(k * 1.57) * 0.25, Math.sin(k) * 0.1, Math.sin(k * 1.57) * 0.25);
    hyacinthGroup.add(leaf);
  }
  hyacinthGroup.position.copy(startPos);
  scene.add(hyacinthGroup);
  const dist = startPos.distanceTo(endPos.clone().setY(1.2));
  projectiles.push({
    mesh: hyacinthGroup,
    start: startPos,
    end: endPos.clone().setY(0.35),
    peak: 4.2 + dist * 0.14,
    t: 0,
    hitBoatIdx
  });
}

// ================= 5. CHIA VAI QUAY SỐ =================
function assignRolesWithLottery(playersObj) {
  const playerIds = Object.keys(playersObj);
  const availableSlots = [];
  for (let b = 0; b < 4; b++) {
    for (const r of ALL_ROLES) {
      availableSlots.push({ boat: b, role: r, key: `${b}_${r}` });
    }
  }

  const wishes = {};
  playerIds.forEach(pid => {
    const p = playersObj[pid];
    const key = `${p.prefBoat}_${p.prefRole}`;
    if (!wishes[key]) wishes[key] = [];
    wishes[key].push(pid);
  });

  const assigned = {};
  const unassignedPlayers = [];

  Object.keys(wishes).forEach(slotKey => {
    const candidates = wishes[slotKey];
    const winnerIndex = Math.floor(Math.random() * candidates.length);
    const winnerId = candidates[winnerIndex];
    const slotIdx = availableSlots.findIndex(s => s.key === slotKey);
    if (slotIdx !== -1) {
      const [slot] = availableSlots.splice(slotIdx, 1);
      assigned[winnerId] = { boat: slot.boat, role: slot.role };
    }
    candidates.forEach((pid, idx) => {
      if (idx !== winnerIndex) unassignedPlayers.push(pid);
    });
  });

  availableSlots.sort(() => Math.random() - 0.5);
  unassignedPlayers.forEach((pid, idx) => {
    const slot = availableSlots[idx % availableSlots.length];
    assigned[pid] = { boat: slot.boat, role: slot.role };
  });

  return assigned;
}

// ================= 6. ĐIỂM ĐÓNG GÓP & ĐỒNG BỘ =================
let bannerTimer = null;
function showTeamBanner(text, duration = 2000) {
  const el = document.getElementById('team-banner');
  if (!el) return;
  el.innerText = text;
  el.style.display = 'block';
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
}

function addPersonalScore(pts) {
  if (state.status !== 'racing' || pts <= 0) return;
  state.score += pts;
  updateScoreBadge();
  if (!IS_DEMO_MODE) {
    update(ref(db, `rooms/${ROOM_ID}/players/${state.playerId}`), { score: state.score });
  } else if (state.players[state.playerId]) {
    state.players[state.playerId].score = state.score;
  }
}

function updateScoreBadge() {
  const badge = document.getElementById('my-badge');
  if (!badge) return;
  const mana = Math.floor(state.boats[state.assignedBoat]?.mana || 0);
  badge.innerHTML = `Ghe ${state.assignedBoat + 1} · ${ROLE_NAMES[state.assignedRole]} · Linh khí: <strong id="mana-display">${mana}</strong> · Điểm: <strong>${state.score}</strong>`;
}

function syncScoreUI() {
  for (let i = 0; i < 4; i++) {
    const m = Math.min(FINISH_LINE, Math.floor(state.boats[i].progress));
    const isMy = i === state.assignedBoat ? '⭐' : '';
    const el = document.getElementById(`score-${i}`);
    if (el) el.innerText = `${isMy}G${i + 1}: ${m}m`;
  }
  updateScoreBadge();
}

function setupFirebaseListeners() {
  if (IS_DEMO_MODE) {
    document.getElementById('player-list').innerHTML =
      '<div style="color:#ffe38e;">Offline Demo: Đăng ký & Bắt đầu để đua cùng 3 ghe máy.</div>';
    return;
  }

  const roomRef = ref(db, `rooms/${ROOM_ID}`);
  onValue(roomRef, (snap) => {
    const room = snap.val();
    if (!room) return;

    state.players = room.players || {};
    renderLobbyList();

    if (room.boats) {
      for (let i = 0; i < 4; i++) {
        if (room.boats[i]) {
          const prev = state.boats[i];
          const next = { ...prev, ...room.boats[i] };
          state.boats[i] = next;

          if (i === state.assignedBoat && (next.drumCombo || 0) >= 3 && next.drumCombo !== prev.drumCombo) {
            showTeamBanner(`🥁 TRỐNG TỐT! (x${next.drumCombo}) — Mở rộng vùng chèo!`);
          }
          if (i === state.assignedBoat && (next.surgeUntil || 0) > Date.now() && (prev.surgeUntil || 0) <= Date.now()) {
            showTeamBanner('🎺 TÙ VÀ XUNG TRẬN! Tăng tốc toàn đội!');
          }
        }
      }
      syncScoreUI();
    }

    if (room.lastThrow && room.lastThrow.id !== state.lastThrowId) {
      state.lastThrowId = room.lastThrow.id;
      const endV = new THREE.Vector3(room.lastThrow.endX, 0.35, room.lastThrow.endZ);
      spawn3DProjectileFromTo(room.lastThrow.from, endV, room.lastThrow.hitBoatIdx ?? null);
    }

    if (room.lastEvent && room.lastEvent.time !== state.lastEventTime && Date.now() - room.lastEvent.time < 3200) {
      state.lastEventTime = room.lastEvent.time;
      const feed = document.getElementById('feed');
      feed.innerText = room.lastEvent.text;
      feed.style.display = 'block';
    } else if (!room.lastEvent || Date.now() - room.lastEvent.time >= 3200) {
      document.getElementById('feed').style.display = 'none';
    }

    if (room.status && room.status !== state.status) {
      handleStatusChange(room.status, room.assignments);
    }
  });
}

let botInterval = null;
function handleStatusChange(newStatus, assignments) {
  state.status = newStatus;
  if (botInterval) clearInterval(botInterval);

  if (newStatus === 'lobby') {
    document.getElementById('lobby').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('podium').style.display = 'none';
  } else if (newStatus === 'countdown') {
    if (assignments && assignments[state.playerId]) {
      state.assignedBoat = assignments[state.playerId].boat;
      state.assignedRole = assignments[state.playerId].role;
    } else if (IS_DEMO_MODE) {
      state.assignedBoat = Number(document.getElementById('pref-boat').value);
      state.assignedRole = document.getElementById('pref-role').value;
    }
    state.focusBoat = null;
    state.camYaw = 0;
    state.score = 0;
    aimState.active = false;
    updateAimArc(state.assignedBoat);

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('role-brief').innerHTML = ROLE_BRIEF[state.assignedRole] || '';
    syncScoreUI();
    renderRoleControls();

    const cdEl = document.getElementById('countdown');
    cdEl.style.display = 'flex';
    let count = 3;
    cdEl.innerText = count;
    playDrumSound(160, 0.25);

    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        cdEl.innerText = count;
        playDrumSound(160, 0.25);
      } else {
        cdEl.innerText = 'XUẤT PHÁT!';
        playCheerSound();
        clearInterval(timer);
        setTimeout(() => {
          cdEl.style.display = 'none';
          if (IS_DEMO_MODE) {
            state.status = 'racing';
            startDemoBots();
          } else {
            update(ref(db, `rooms/${ROOM_ID}`), { status: 'racing' });
          }
        }, 650);
      }
    }, 1000);
  } else if (newStatus === 'finished') {
    aimState.active = false;
    updateAimArc(state.assignedBoat);
    playCheerSound();
    document.getElementById('hud').style.display = 'none';
    document.getElementById('podium').style.display = 'flex';

    const ranked = state.boats
      .map((b, idx) => ({ idx, progress: b.progress, finishTime: b.finishTime || 9999999999999 }))
      .sort((a, b) => b.progress - a.progress || a.finishTime - b.finishTime);

    document.getElementById('ranking-list').innerHTML = ranked.map((item, rank) =>
      `<div class="rank-row"><strong>${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '🏅'} Hạng ${rank + 1}: Ghe ${item.idx + 1}</strong><span>${Math.min(FINISH_LINE, Math.floor(item.progress))}m</span></div>`
    ).join('');

    const contribList = Object.entries(state.players)
      .map(([pid, p]) => {
        const assign = assignments?.[pid] || { boat: Number(p.prefBoat || 0), role: p.prefRole || 'rower_left' };
        const pts = pid === state.playerId ? state.score : (p.score || 0);
        return { pid, name: p.name, boat: assign.boat, role: assign.role, score: pts };
      })
      .sort((a, b) => b.score - a.score);

    if (!contribList.length) {
      contribList.push({
        pid: state.playerId,
        name: state.name || 'Bạn',
        boat: state.assignedBoat,
        role: state.assignedRole,
        score: state.score
      });
    }

    document.getElementById('contribution-list').innerHTML = contribList.map((c, idx) =>
      `<div class="rank-row"><span><strong>#${idx + 1} ${c.name}</strong> · G${Number(c.boat) + 1} (${ROLE_NAMES[c.role] || c.role})</span><strong>${c.score} đ</strong></div>`
    ).join('');
  }
}

function startDemoBots() {
  botInterval = setInterval(() => {
    if (state.status !== 'racing') return;
    for (let i = 0; i < 4; i++) {
      if (i === state.assignedBoat) continue;
      addBoatProgress(i, 1.4 + Math.random() * 1.6, 0);
    }
  }, 450);
}

function renderLobbyList() {
  const listEl = document.getElementById('player-list');
  const entries = Object.values(state.players);
  if (!entries.length) {
    listEl.innerHTML = 'Chưa có ai đăng ký...';
    return;
  }
  const counts = {};
  entries.forEach(p => {
    const k = `${p.prefBoat}_${p.prefRole}`;
    counts[k] = (counts[k] || 0) + 1;
  });

  listEl.innerHTML = `<strong>Sảnh (${entries.length}/20):</strong>` + entries.map(p => {
    const k = `${p.prefBoat}_${p.prefRole}`;
    const isConflict = counts[k] > 1;
    return `<div class="player-item">
      <span>${p.name}</span>
      <span class="${isConflict ? 'conflict-badge' : ''}">G${Number(p.prefBoat) + 1}·${ROLE_NAMES[p.prefRole]} ${isConflict ? '(Trùng)' : ''}</span>
    </div>`;
  }).join('');
}

function updateBoatState(boatIdx, mutator) {
  if (state.status !== 'racing') return;

  if (IS_DEMO_MODE) {
    const b = state.boats[boatIdx];
    mutator(b);
    if (b.progress >= FINISH_LINE && !b.finishTime) {
      b.finishTime = Date.now();
      handleStatusChange('finished', null);
    }
    syncScoreUI();
    return;
  }

  const boatRef = ref(db, `rooms/${ROOM_ID}/boats/${boatIdx}`);
  runTransaction(boatRef, (current) => {
    if (!current) current = { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 };
    mutator(current);
    if (current.progress >= FINISH_LINE && !current.finishTime) {
      current.finishTime = Date.now();
    }
    return current;
  }).then((res) => {
    if (res.committed && res.snapshot.val().progress >= FINISH_LINE) {
      update(ref(db, `rooms/${ROOM_ID}`), { status: 'finished' });
    }
  });
}

function addBoatProgress(boatIdx, deltaProgress, deltaMana = 0) {
  if (deltaProgress <= 0 && deltaMana === 0) return;
  updateBoatState(boatIdx, (b) => {
    const now = Date.now();
    const isSlowed = now < (b.debuffUntil || 0);
    const isSurging = now < (b.surgeUntil || 0);
    const comboMult = (b.drumCombo || 0) >= 3 ? 1.25 : 1.0;
    const surgeMult = isSurging ? 1.45 : 1.0;
    const slowMult = isSlowed ? 0.45 : 1.0;

    b.progress = (b.progress || 0) + deltaProgress * comboMult * surgeMult * slowMult;
    b.mana = Math.min(100, Math.max(0, (b.mana || 0) + deltaMana));
  });
}

// ================= 7. CAMERA XOAY 360° TỰ DO =================
function setFocusBoat(val) {
  state.focusBoat = val === 'mine' ? null : Number(val);
  state.camYaw = 0;
  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cam === String(val));
  });
}

document.querySelectorAll('.cam-btn').forEach(btn => {
  btn.onclick = () => setFocusBoat(btn.dataset.cam);
});

let isDraggingCam = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener('pointerdown', (e) => {
  isDraggingCam = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDraggingCam) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

  // Xoay 360° không giới hạn vòng
  state.camYaw = (state.camYaw - dx * 0.008) % (Math.PI * 2);
  state.camPitch = Math.max(0.18, Math.min(1.05, state.camPitch + dy * 0.003));
  document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
});

const stopDragCam = (e) => {
  if (!isDraggingCam) return;
  isDraggingCam = false;
  canvas.releasePointerCapture?.(e.pointerId);
};

canvas.addEventListener('pointerup', stopDragCam);
canvas.addEventListener('pointercancel', stopDragCam);

// ================= 8. GAMEPLAY TỪNG VAI TRÒ + PHẠT KHI LÀM ĐẠI =================
let activeMiniLoop = null;

function renderRoleControls() {
  if (activeMiniLoop) clearInterval(activeMiniLoop);
  const panel = document.getElementById('role-panel');
  const role = state.assignedRole;

  // 1. 2 TAY CHÈO: Phạt spam & trật nhịp (không cộng tiến độ/điểm, khóa ngắn, reset chuỗi)
  if (role === 'rower_left' || role === 'rower_right') {
    const symbols = ['☀️ MẶT TRỜI', '🦅 CHIM LẠC'];
    let targetSym = symbols[0];
    let pos = 0, dir = 1;
    let lastTapTime = 0;
    let lockedUntil = 0;
    let streak = 0;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <strong>${ROLE_NAMES[role]} · Chuỗi: <span id="row-streak">0</span></strong>
        <span id="row-status" style="color:#ffe38e;"></span>
      </div>
      <div id="sym-hint" style="font-size:12.5px; color:#ffe38e; font-weight:800; margin:2px 0;">Lệnh: ${targetSym}</div>
      <div style="width:100%; height:16px; background:#0e1f23; border:1px solid #e6be52; border-radius:8px; position:relative; overflow:hidden; margin:4px 0;">
        <div id="sweet-zone" style="position:absolute; left:38%; width:24%; height:100%; background:rgba(255,227,142,0.45);"></div>
        <div id="swing-cursor" style="position:absolute; left:0%; width:6%; height:100%; background:#ff6b3d; border-radius:4px;"></div>
      </div>
      <div class="btn-group">
        <button id="btn-sun" class="row-act">☀️ MẶT TRỜI</button>
        <button id="btn-bird" class="row-act">🦅 CHIM LẠC</button>
      </div>
    `;

    activeMiniLoop = setInterval(() => {
      const now = Date.now();
      const myBoat = state.boats[state.assignedBoat];
      const hasDrumBuff = (myBoat.drumCombo || 0) >= 3;
      const zoneEl = document.getElementById('sweet-zone');
      if (zoneEl) {
        zoneEl.style.left = hasDrumBuff ? '30%' : '38%';
        zoneEl.style.width = hasDrumBuff ? '40%' : '24%';
      }

      pos += dir * 4.1;
      if (pos >= 94 || pos <= 0) dir *= -1;
      const cur = document.getElementById('swing-cursor');
      if (cur) cur.style.left = pos + '%';

      const isLocked = now < lockedUntil;
      document.querySelectorAll('.row-act').forEach(b => { b.disabled = isLocked; });
    }, 25);

    const penalizeRow = (msg, lockMs = 550) => {
      streak = 0;
      lockedUntil = Date.now() + lockMs;
      playDrumSound(75, 0.16, 'sawtooth', 0.25);
      if (navigator.vibrate) navigator.vibrate([35, 30, 35]);
      const st = document.getElementById('row-status');
      if (st) { st.style.color = '#ff7b72'; st.innerText = msg; }
      const sk = document.getElementById('row-streak');
      if (sk) sk.innerText = '0';
    };

    const handleRow = (chosen) => {
      const now = Date.now();
      if (now < lockedUntil) return;

      // Chống spam bấm liên tục quá nhanh (< 240ms)
      if (now - lastTapTime < 240) {
        penalizeRow('SPAM! Hụt nước', 650);
        return;
      }
      lastTapTime = now;

      const hasDrumBuff = (state.boats[state.assignedBoat].drumCombo || 0) >= 3;
      const inSweetSpot = pos >= (hasDrumBuff ? 28 : 35) && pos <= (hasDrumBuff ? 72 : 65);
      const rightSym = chosen === targetSym;

      if (!inSweetSpot && !rightSym) {
        penalizeRow('TRẬT NHỊP!', 550);
        return;
      }

      streak++;
      const sk = document.getElementById('row-streak');
      if (sk) sk.innerText = String(streak);
      const st = document.getElementById('row-status');

      if (inSweetSpot && rightSym) {
        playCheerSound();
        spawnSplash(state.assignedBoat, 9, 0xffffff);
        addBoatProgress(state.assignedBoat, 3.4, 2);
        addPersonalScore(25);
        if (st) { st.style.color = '#7ef9d4'; st.innerText = 'CHUẨN NHỊP! +25đ'; }
      } else {
        playDrumSound(150, 0.13);
        spawnSplash(state.assignedBoat, 4, 0xc9f6fa);
        addBoatProgress(state.assignedBoat, 1.5, 1);
        addPersonalScore(10);
        if (st) { st.style.color = '#ffe38e'; st.innerText = 'ĐƯỢC! +10đ'; }
      }

      targetSym = symbols[Math.floor(Math.random() * symbols.length)];
      const hintEl = document.getElementById('sym-hint');
      if (hintEl) hintEl.innerText = `Lệnh: ${targetSym}`;
    };

    document.getElementById('btn-sun').onclick = () => handleRow('☀️ MẶT TRỜI');
    document.getElementById('btn-bird').onclick = () => handleRow('🦅 CHIM LẠC');
  }

  // 2. TAY TRỐNG: Gõ mặt trống sáng nối Combo + Xả Trống khi đầy thanh nhịp
  else if (role === 'drummer') {
    let combo = 0;
    let charge = 0;
    let targetPad = 0;
    let lastHitTime = 0;
    let softLockUntil = 0;

    const padNames = ['🥁 TRỐNG CÁI', '🪘 TRỐNG CON', '🔔 CHIÊNG ĐỒNG'];
    const padFreqs = [95, 160, 330];

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:12px;">
        <strong>${ROLE_NAMES[role]} · Combo: <span id="drum-combo">0</span></strong>
        <span id="drum-msg" style="color:#ffe38e;">Gõ nút sáng · Đầy thanh thì XẢ TRỐNG</span>
      </div>
      <div style="width:100%; height:14px; background:#0e1f23; border:1px solid #e6be52; border-radius:7px; overflow:hidden; margin:5px 0;">
        <div id="drum-charge-bar" style="width:0%; height:100%; background:linear-gradient(90deg,#e6be52,#ffe38e); transition:width 0.1s;"></div>
      </div>
      <div class="btn-group">
        ${[0, 1, 2].map(i => `
          <button class="d-pad" data-i="${i}">${padNames[i]}</button>
        `).join('')}
        <button id="burst-drum-btn" class="secondary" disabled style="min-width:92px;">⚡ XẢ TRỐNG</button>
      </div>
    `;

    const pads = document.querySelectorAll('.d-pad');
    const burstBtn = document.getElementById('burst-drum-btn');
    const msgEl = document.getElementById('drum-msg');
    const comboEl = document.getElementById('drum-combo');
    const barEl = document.getElementById('drum-charge-bar');

    const pickNextPad = () => {
      let next = Math.floor(Math.random() * 3);
      if (next === targetPad) next = (next + 1) % 3;
      targetPad = next;
      pads.forEach((b, i) => {
        b.style.background = i === targetPad ? '#ffe38e' : '#234249';
        b.style.color = i === targetPad ? '#102024' : '#f8eed8';
      });
    };

    const refreshDrumUI = (statusText, color = '#ffe38e') => {
      if (comboEl) comboEl.innerText = String(combo);
      if (barEl) barEl.style.width = `${Math.min(100, charge)}%`;
      if (burstBtn) burstBtn.disabled = charge < 100;
      if (msgEl && statusText) {
        msgEl.innerText = statusText;
        msgEl.style.color = color;
      }
    };

    pickNextPad();

    pads.forEach(btn => {
      btn.onclick = () => {
        const now = Date.now();
        if (now < softLockUntil) return;

        const idx = Number(btn.dataset.i);
        const freq = padFreqs[idx];

        // Chống spam bấm liên tục quá nhanh (< 140ms)
        if (now - lastHitTime < 140) {
          softLockUntil = now + 260;
          combo = Math.max(0, combo - 1);
          playDrumSound(75, 0.12, 'sawtooth', 0.2);
          updateBoatState(state.assignedBoat, (b) => { b.drumCombo = combo; });
          refreshDrumUI('Gõ quá nhanh! -1 Combo', '#ff8278');
          return;
        }
        lastHitTime = now;

        if (idx === targetPad) {
          combo++;
          charge = Math.min(100, charge + 25);
          playDrumSound(freq, 0.16);
          if (navigator.vibrate) navigator.vibrate(20);
          spawnSplash(state.assignedBoat, 5, 0xffe38e);
          addBoatProgress(state.assignedBoat, 1.35 * Math.min(2.2, 1 + combo * 0.08), 2);
          addPersonalScore(15);

          updateBoatState(state.assignedBoat, (b) => { b.drumCombo = combo; });
          if (combo >= 3) {
            showTeamBanner(`🥁 TRỐNG TỐT! (x${combo}) — Mở rộng vùng chèo!`);
          }
          pickNextPad();
          refreshDrumUI(charge >= 100 ? '⚡ Đầy nhịp! Bấm XẢ TRỐNG!' : `Chuẩn nhịp! +15đ`, '#7ef9d4');
        } else {
          // Phạt nhẹ: giảm 2 combo, không khóa lâu
          softLockUntil = now + 250;
          combo = Math.max(0, combo - 2);
          playDrumSound(80, 0.14, 'sawtooth', 0.22);
          updateBoatState(state.assignedBoat, (b) => { b.drumCombo = combo; });
          refreshDrumUI('Lệch mặt trống! -2 Combo', '#ff8278');
        }
      };
    });

    burstBtn.onclick = () => {
      if (charge < 100) return;
      charge = 0;
      combo += 2;
      playCheerSound();
      spawnSplash(state.assignedBoat, 10, 0xffe38e);
      addBoatProgress(state.assignedBoat, 3.2, 8);
      addPersonalScore(25);
      updateBoatState(state.assignedBoat, (b) => { b.drumCombo = combo; });
      showTeamBanner(`⚡ XẢ TRỐNG! Combo x${combo} — Đội bứt tốc!`);
      refreshDrumUI('Xả trống thành công! +25đ', '#7ef9d4');
    };
  }

  // 3. ĐÁP HỘI: Ghép chữ + Ghép hình (phạt nhẹ khi chọn sai)
  else if (role === 'scholar') {
    let mode = 'word';
    let lockedUntil = 0;
    const bank = [
      { hint: 'Văn hóa Việt cổ', word: 'TRỐNG ĐỒNG' },
      { hint: 'Chim khắc trên trống', word: 'CHIM LẠC' },
      { hint: 'Sức mạnh chiến thắng', word: 'ĐOÀN KẾT' },
      { hint: 'Đua thuyền Nam Bộ', word: 'GHE NGO' },
      { hint: 'Con cháu Rồng Tiên', word: 'LẠC HỒNG' }
    ];

    const renderWordGame = () => {
      const current = bank[Math.floor(Math.random() * bank.length)];
      const cleanChars = current.word.replace(/\s+/g, '').split('');
      let shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
      let picked = [];

      const draw = () => {
        panel.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:12.5px;">${ROLE_NAMES[role]} · Chữ (+35đ / +25 Linh khí)</strong>
            <button id="sw-puz" class="secondary" style="width:auto; margin:0; padding:3px 7px; font-size:10.5px;">🧩 Ghép Hình</button>
          </div>
          <div style="font-size:11.5px; color:#ffe38e; margin:2px 0;">${current.hint} · <b>${picked.join(' ') || '_ _ _ _'}</b></div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center;">
            ${shuffled.map((ch, i) => `<button class="char-tile" data-i="${i}" style="width:34px; padding:6px 0; margin:0; font-size:12.5px;">${ch}</button>`).join('')}
            <button id="clr-tile" class="secondary" style="width:46px; padding:6px 0; margin:0; font-size:11px;">XÓA</button>
          </div>
        `;
        document.getElementById('sw-puz').onclick = () => { mode = 'puzzle'; renderPuzzleGame(); };
        document.querySelectorAll('.char-tile').forEach(btn => {
          btn.onclick = () => {
            if (Date.now() < lockedUntil) return;
            const i = Number(btn.dataset.i);
            if (!shuffled[i]) return;
            playDrumSound(220 + picked.length * 25, 0.08);
            picked.push(shuffled[i]);
            shuffled[i] = '';

            // Kiểm tra ngay chữ cái vừa chọn có đúng vị trí từ khóa không
            const expectedChar = cleanChars[picked.length - 1];
            if (picked[picked.length - 1] !== expectedChar) {
              lockedUntil = Date.now() + 500;
              playDrumSound(80, 0.15, 'sawtooth', 0.22);
              shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
              picked = [];
              showTeamBanner('❌ Sai chữ! Làm lại từ đầu', 1300);
              draw();
              return;
            }

            if (picked.join('') === cleanChars.join('')) {
              playCheerSound();
              spawnSplash(state.assignedBoat, 8, 0x7ef9d4);
              addBoatProgress(state.assignedBoat, 2.5, 25);
              addPersonalScore(35);
              renderWordGame();
            } else {
              draw();
            }
          };
        });
        document.getElementById('clr-tile').onclick = () => {
          shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
          picked = [];
          draw();
        };
      };
      draw();
    };

    const renderPuzzleGame = () => {
      const solved = ['☀️', '🦅', '🥁', '🌊'];
      let tiles = [...solved].sort(() => Math.random() - 0.5);
      if (tiles.join('') === solved.join('')) tiles.reverse();
      let selectedIdx = null;

      const drawPuzzle = () => {
        panel.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:12.5px;">${ROLE_NAMES[role]} · Ghép ☀️🦅🥁🌊 (+45đ / +35 Linh khí)</strong>
            <button id="sw-word" class="secondary" style="width:auto; margin:0; padding:3px 7px; font-size:10.5px;">📜 Ghép Chữ</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:5px; margin-top:5px;">
            ${tiles.map((t, i) => `
              <button class="puz-btn" data-i="${i}" style="margin:0; padding:8px 0; font-size:16px; background:${selectedIdx === i ? '#ffe38e' : '#234249'}; color:#102024;">
                ${t}
              </button>
            `).join('')}
          </div>
        `;
        document.getElementById('sw-word').onclick = () => { mode = 'word'; renderWordGame(); };
        document.querySelectorAll('.puz-btn').forEach(btn => {
          btn.onclick = () => {
            if (Date.now() < lockedUntil) return;
            const idx = Number(btn.dataset.i);
            playDrumSound(260, 0.08);
            if (selectedIdx === null) {
              selectedIdx = idx;
              drawPuzzle();
            } else if (selectedIdx === idx) {
              selectedIdx = null;
              drawPuzzle();
            } else {
              const tmp = tiles[selectedIdx];
              tiles[selectedIdx] = tiles[idx];
              tiles[idx] = tmp;
              selectedIdx = null;
              if (tiles.join('') === solved.join('')) {
                playCheerSound();
                spawnSplash(state.assignedBoat, 10, 0xffe38e);
                addBoatProgress(state.assignedBoat, 3.5, 35);
                addPersonalScore(45);
                renderPuzzleGame();
              } else {
                drawPuzzle();
              }
            }
          };
        });
      };
      drawPuzzle();
    };

    if (mode === 'word') renderWordGame();
    else renderPuzzleGame();
  }

  // 4. KẺ PHÁ ĐÁM: Nhấn giữ để xoay hướng tự do + chấm đỏ cong quỹ đạo, không tự khóa mục tiêu
  else if (role === 'saboteur') {
    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:12px;">
        <strong>${ROLE_NAMES[role]} · Giữ để xoay hướng & tầm ném</strong>
        <span id="aim-info" style="color:#ff8278; font-weight:700;"></span>
      </div>
      <div class="btn-group">
        <button id="hold-aim-btn" style="flex:2;">🎯 GIỮ XOAY HƯỚNG NÉM (30 LK)</button>
        <button id="horn-btn" class="secondary" style="flex:1;">🎺 TÙ VÀ (45 LK)</button>
      </div>
    `;

    const aimBtn = document.getElementById('hold-aim-btn');
    let startX = 0;
    let startY = 0;
    let cooldownUntil = 0;

    aimBtn.onpointerdown = (e) => {
      if (Date.now() < cooldownUntil) return;
      const myBoat = state.boats[state.assignedBoat];
      if ((myBoat.mana || 0) < 30) {
        showTeamBanner('⚠️ Thiếu Linh Khí (cần 30)', 1200);
        return;
      }
      aimState.active = true;
      aimState.yawOffset = 0;
      aimState.range = 15;
      startX = e.clientX;
      startY = e.clientY;
      aimBtn.innerText = 'KÉO TRÁI/PHẢI/LÊN/XUỐNG — THẢ ĐỂ NÉM';
      aimBtn.setPointerCapture?.(e.pointerId);
      updateAimArc(state.assignedBoat);
    };

    aimBtn.onpointermove = (e) => {
      if (!aimState.active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      aimState.yawOffset = Math.max(-1.35, Math.min(1.35, dx * 0.012));
      aimState.range = Math.max(6, Math.min(28, 15 - dy * 0.08));
      updateAimArc(state.assignedBoat);
    };

    const releaseThrow = (e) => {
      if (!aimState.active) return;
      aimState.active = false;
      aimBtn.innerText = '🎯 GIỮ XOAY HƯỚNG NÉM (30 LK)';
      aimBtn.releasePointerCapture?.(e.pointerId);

      const land = aimState.landPoint.clone();
      updateAimArc(state.assignedBoat);

      const myBoat = state.boats[state.assignedBoat];
      if ((myBoat.mana || 0) < 30) return;

      // Trừ 30 Linh Khí & đặt hồi chiêu ngắn chống spam
      addBoatProgress(state.assignedBoat, 0, -30);
      cooldownUntil = Date.now() + 800;

      // Kiểm tra điểm rơi có chạm ghe đối thủ nào không (không tự khóa mục tiêu)
      let hitIdx = null;
      for (let i = 0; i < 4; i++) {
        if (i === state.assignedBoat) continue;
        const bPos = boatObjects[i].group.position;
        const distXZ = Math.hypot(land.x - bPos.x, land.z - bPos.z);
        if (distXZ <= 3.1) {
          hitIdx = i;
          break;
        }
      }

      if (hitIdx !== null) {
        playDrumSound(195, 0.28, 'sawtooth');
        spawnSplash(hitIdx, 9, 0x2ecc71);
        addPersonalScore(40);
        if (IS_DEMO_MODE) {
          state.boats[hitIdx].debuffUntil = Date.now() + 4500;
          spawn3DProjectileFromTo(state.assignedBoat, land, hitIdx);
          showTeamBanner(`💣 Trúng Ghe ${hitIdx + 1}! +40đ`);
        } else {
          update(ref(db, `rooms/${ROOM_ID}/boats/${hitIdx}`), { debuffUntil: Date.now() + 4500 });
          update(ref(db, `rooms/${ROOM_ID}`), {
            lastThrow: { id: 'th_' + Date.now(), from: state.assignedBoat, endX: land.x, endZ: land.z, hitBoatIdx: hitIdx },
            lastEvent: { text: `💣 ${state.name} (G${state.assignedBoat + 1}) ném trúng G${hitIdx + 1}!`, time: Date.now() }
          });
        }
      } else {
        playDrumSound(85, 0.14);
        spawn3DProjectileFromTo(state.assignedBoat, land, null);
        showTeamBanner('💨 Ném hụt mục tiêu (0đ)', 1300);
      }
    };

    aimBtn.onpointerup = releaseThrow;
    aimBtn.onpointercancel = releaseThrow;

    document.getElementById('horn-btn').onclick = () => {
      const myBoat = state.boats[state.assignedBoat];
      if ((myBoat.mana || 0) < 45) return;
      playCheerSound();
      spawnSplash(state.assignedBoat, 10, 0xffe38e);
      addPersonalScore(30);
      if (IS_DEMO_MODE) {
        myBoat.mana -= 45;
        myBoat.surgeUntil = Date.now() + 4000;
        syncScoreUI();
        showTeamBanner('🎺 TÙ VÀ! Tăng tốc đội +30đ');
      } else {
        updateBoatState(state.assignedBoat, (b) => {
          b.mana = Math.max(0, (b.mana || 0) - 45);
          b.surgeUntil = Date.now() + 4000;
        });
        update(ref(db, `rooms/${ROOM_ID}`), {
          lastEvent: { text: `🎺 G${state.assignedBoat + 1} thổi Tù Và!`, time: Date.now() }
        });
      }
    };
  }
}

// ================= 9. SẢNH CHỜ & VÒNG LẶP RENDER 3D =================
document.getElementById('register-btn').onclick = () => {
  initAudio();
  playDrumSound(150, 0.2);
  state.name = document.getElementById('player-name').value.trim() || `Tay Đua ${state.playerId.slice(-3)}`;
  const prefBoat = document.getElementById('pref-boat').value;
  const prefRole = document.getElementById('pref-role').value;
  state.score = 0;

  if (IS_DEMO_MODE) {
    state.players[state.playerId] = { name: state.name, prefBoat, prefRole, score: 0 };
    renderLobbyList();
    return;
  }

  const pRef = ref(db, `rooms/${ROOM_ID}/players/${state.playerId}`);
  set(pRef, { name: state.name, prefBoat, prefRole, score: 0 });
  onDisconnect(pRef).remove();
};

document.getElementById('host-start-btn').onclick = () => {
  initAudio();
  if (IS_DEMO_MODE) {
    state.boats = [
      { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
      { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
      { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
      { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 }
    ];
    handleStatusChange('countdown', null);
    return;
  }

  const assignments = assignRolesWithLottery(state.players);
  const resetScores = {};
  Object.keys(state.players).forEach(pid => {
    resetScores[`players/${pid}/score`] = 0;
  });

  update(ref(db, `rooms/${ROOM_ID}`), {
    status: 'countdown',
    assignments,
    ...resetScores,
    boats: {
      0: { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
      1: { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
      2: { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
      3: { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 }
    }
  });
};

document.getElementById('reset-room-btn').onclick = () => {
  if (IS_DEMO_MODE) {
    handleStatusChange('lobby');
    return;
  }
  update(ref(db, `rooms/${ROOM_ID}`), { status: 'lobby' });
};

function animate() {
  requestAnimationFrame(animate);
  const now = Date.now();

  riverTex.offset.y -= 0.02;

  banners.forEach(b => {
    b.mesh.rotation.y = Math.sin(now * 0.006 + b.phase) * 0.35;
  });

  boatObjects.forEach((obj, idx) => {
    const bData = state.boats[idx];
    const targetZ = -Math.min(FINISH_LINE, bData.progress || 0);
    const speedDiff = Math.abs(targetZ - obj.group.position.z);
    obj.group.position.z += (targetZ - obj.group.position.z) * 0.12;
    obj.group.position.y = 0.35 + Math.sin(now * 0.007 + idx) * 0.1;

    const isSurging = now < (bData.surgeUntil || 0);
    const hasDrumBuff = (bData.drumCombo || 0) >= 3;
    const paddleSpeed = isSurging ? 0.028 : hasDrumBuff ? 0.021 : 0.015;
    const sideSign = idx % 2 === 0 ? 1 : -1;

    obj.paddles.forEach((pad, pIdx) => {
      pad.rotation.z = Math.sin(now * paddleSpeed + pIdx * 0.6) * 0.42 * sideSign;
      pad.rotation.y = Math.cos(now * paddleSpeed + pIdx * 0.6) * 0.22;
    });

    const wakeScale = Math.min(1.6, 0.75 + speedDiff * 0.18 + (isSurging ? 0.4 : 0));
    obj.wake.scale.set(wakeScale, wakeScale, 1);
    obj.wake.material.opacity = Math.min(0.65, 0.22 + speedDiff * 0.08 + (isSurging ? 0.2 : 0));

    obj.boostAura.visible = isSurging || hasDrumBuff;
    if (obj.boostAura.visible) {
      obj.boostAura.rotation.z = now * 0.006;
      const pulse = 1 + Math.sin(now * 0.012) * 0.14;
      obj.boostAura.scale.set(pulse, pulse, 1);
    }

    const isDebuffed = now < (bData.debuffUntil || 0);
    obj.debuffCloud.visible = isDebuffed;
    obj.debuffCloud.rotation.y += 0.05;
    obj.group.rotation.z = isDebuffed ? Math.sin(now * 0.045) * 0.2 : 0;
  });

  if (aimState.active) {
    updateAimArc(state.assignedBoat);
  }

  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.mesh.position.x += s.vx;
    s.mesh.position.y += s.vy;
    s.mesh.position.z += s.vz;
    s.vy -= 0.008;
    s.life -= 0.04;
    s.mesh.material.opacity = Math.max(0, s.life);
    if (s.life <= 0) {
      scene.remove(s.mesh);
      splashes.splice(i, 1);
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += 0.04;
    p.mesh.position.lerpVectors(p.start, p.end, p.t);
    p.mesh.position.y += Math.sin(p.t * Math.PI) * p.peak;
    p.mesh.rotation.y += 0.14;
    if (p.t >= 1) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  // Camera xoay 360° quanh ghe đang theo dõi
  const focusIdx = state.focusBoat !== null ? state.focusBoat : state.assignedBoat;
  const focusMesh = boatObjects[focusIdx].group;
  const radius = 12.5;
  const horizDist = Math.cos(state.camPitch) * radius;
  const vertDist = Math.max(1.6, Math.sin(state.camPitch) * radius);

  const targetCamX = focusMesh.position.x + Math.sin(state.camYaw) * horizDist;
  const targetCamZ = focusMesh.position.z + Math.cos(state.camYaw) * horizDist;
  const targetCamY = focusMesh.position.y + vertDist;

  camera.position.x += (targetCamX - camera.position.x) * 0.14;
  camera.position.y += (targetCamY - camera.position.y) * 0.14;
  camera.position.z += (targetCamZ - camera.position.z) * 0.14;
  camera.lookAt(focusMesh.position.x, focusMesh.position.y + 1.0, focusMesh.position.z - 2.5);

  const degEl = document.getElementById('cam-deg');
  if (degEl) {
    const deg = Math.round(((state.camYaw * 180) / Math.PI) % 360);
    degEl.innerText = `${deg}°`;
  }

  renderer.render(scene, camera);
}

setupFirebaseListeners();
animate();
