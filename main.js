import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// ================= 1. CẤU HÌNH FIREBASE (GIỮ NGUYÊN CỦA BẠN) =================
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

const ROLE_BRIEF = {
  rower_left: '<b>Bạn là ai:</b> Tay Chèo Trái · <b>Bạn làm gì:</b> Chèo đúng khẩu lệnh khi con lắc vào vùng vàng · <b>Ảnh hưởng ai:</b> Đẩy ghe tiến lên, chèo chuẩn tạo sóng nước.',
  rower_right: '<b>Bạn là ai:</b> Tay Chèo Phải · <b>Bạn làm gì:</b> Chèo đúng khẩu lệnh khi con lắc vào vùng vàng · <b>Ảnh hưởng ai:</b> Đẩy ghe tiến lên, chèo chuẩn tạo sóng nước.',
  drummer: '<b>Bạn là ai:</b> Tay Trống · <b>Bạn làm gì:</b> Gõ đúng trống đang sáng để nối chuỗi Combo · <b>Ảnh hưởng ai:</b> Combo ≥ 3 gửi "TRỐNG TỐT!" mở rộng vùng chèo cho 2 Tay Chèo.',
  scholar: '<b>Bạn là ai:</b> Đáp Hội · <b>Bạn làm gì:</b> Giải Vua Tiếng Việt hoặc Ghép mảnh Trống Đồng · <b>Ảnh hưởng ai:</b> Nạp Linh Khí cho cả ghe & mở chiêu cho Kẻ Phá Đám.',
  saboteur: '<b>Bạn là ai:</b> Kẻ Phá Đám · <b>Bạn làm gì:</b> Tự liếc góc nhìn, canh lực ném Bèo Tây hoặc thổi tù và · <b>Ảnh hưởng ai:</b> Làm chậm ghe địch hoặc tăng tốc toàn đội mình.'
};

const state = {
  playerId: 'p_' + Math.random().toString(36).slice(2, 8),
  name: '',
  status: 'lobby',
  assignedBoat: 0,
  assignedRole: 'rower_left',
  focusBoat: null,
  camYaw: 0,
  players: {},
  lastThrowId: '',
  lastEventTime: 0,
  lastTeamBoostTime: 0,
  boats: [
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, surgeUntil: 0, drumCombo: 0, finishTime: 0 }
  ]
};

// ================= 2. ÂM THANH LỄ HỘI (WEB AUDIO API) =================
let audioCtx = null;
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playDrumSound(freq = 110, duration = 0.18, type = 'sine') {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(38, audioCtx.currentTime + duration);
  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.008, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playCheerSound() {
  if (!audioCtx) return;
  const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
  notes.forEach((f, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, audioCtx.currentTime + i * 0.055);
    gain.gain.setValueAtTime(0.16, audioCtx.currentTime + i * 0.055);
    gain.gain.exponentialRampToValueAtTime(0.004, audioCtx.currentTime + i * 0.055 + 0.32);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + i * 0.055);
    osc.stop(audioCtx.currentTime + i * 0.055 + 0.32);
  });
}

// ================= 3. MẶT NƯỚC SÁNG & HOA VĂN TRỐNG ĐỒNG TIẾT CHẾ =================
function createRiverTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  // Nền sông xanh ngọc lễ hội sáng rõ, có chiều sâu
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#124e59');
  grad.addColorStop(0.5, '#1b6d7a');
  grad.addColorStop(1, '#124e59');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Gợn sóng lăn tăn ngang dòng sông
  ctx.strokeStyle = 'rgba(186, 244, 247, 0.22)';
  ctx.lineWidth = 2;
  for (let y = 16; y < 512; y += 32) {
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const wy = y + Math.sin((x / 512) * Math.PI * 6 + y * 0.05) * 4;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }

  // Vạch phân làn nhẹ
  ctx.strokeStyle = 'rgba(255, 217, 125, 0.25)';
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

  ctx.strokeStyle = 'rgba(242, 198, 92, 0.72)';
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

  // Ngôi sao 14 tia trung tâm
  ctx.fillStyle = 'rgba(255, 223, 130, 0.88)';
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

// ================= 4. CẢNH 3D, BỜ SÔNG, GHE NGO & HIỆU ỨNG =================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b4c57);
scene.fog = new THREE.Fog(0x1b4c57, 36, 155);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 280);
const sunLight = new THREE.DirectionalLight(0xfff0c2, 2.4);
sunLight.position.set(15, 25, 10);
scene.add(sunLight, new THREE.AmbientLight(0x9be2e8, 1.35));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const riverTex = createRiverTexture();
const river = new THREE.Mesh(
  new THREE.PlaneGeometry(34, FINISH_LINE + 160),
  new THREE.MeshStandardMaterial({ map: riverTex, roughness: 0.35, metalness: 0.25 })
);
river.rotation.x = -Math.PI / 2;
river.position.z = -(FINISH_LINE + 160) / 2 + 25;
scene.add(river);

// Bờ sông xanh cây & cọc tiêu lễ hội hai bên để cảm nhận tốc độ rõ hơn
const bankMat = new THREE.MeshStandardMaterial({ color: 0x245e3b, roughness: 0.85 });
[-21, 21].forEach(xPos => {
  const bank = new THREE.Mesh(new THREE.BoxGeometry(8, 1.4, FINISH_LINE + 160), bankMat);
  bank.position.set(xPos, 0.1, -(FINISH_LINE + 160) / 2 + 25);
  scene.add(bank);
});

const postGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.2, 8);
const postMat = new THREE.MeshStandardMaterial({ color: 0xffd97d, emissive: 0x8c6213, emissiveIntensity: 0.35 });
for (let z = 0; z >= -FINISH_LINE; z -= 30) {
  [-17.2, 17.2].forEach(xPos => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(xPos, 1.6, z);
    scene.add(post);
  });
}

// Các đĩa hoa văn trống đồng đặt dọc đường đua làm điểm mốc trực quan
const medallionTex = createDongSonMedallionTexture();
const medallionMat = new THREE.MeshBasicMaterial({ map: medallionTex, transparent: true, depthWrite: false });
for (let z = -60; z >= -FINISH_LINE; z -= 120) {
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5), medallionMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0.04, z);
  scene.add(disc);
}

// Cổng đích
const finishGate = new THREE.Group();
const arch = new THREE.Mesh(
  new THREE.TorusGeometry(15.5, 0.55, 8, 36, Math.PI),
  new THREE.MeshStandardMaterial({ color: 0xffd97d, emissive: 0xe0b84c, emissiveIntensity: 0.75 })
);
finishGate.add(arch);
finishGate.position.set(0, 0, -FINISH_LINE);
scene.add(finishGate);

const boatColors = [0xe0b84c, 0xd63c2f, 0x18b89a, 0xf27d24];
const boatObjects = boatColors.map((color, idx) => {
  const group = new THREE.Group();

  const hull = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.78, 9.2, 8),
    new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.25 })
  );
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.12, 1, 0.65);
  group.add(hull);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(0.58, 2.3, 6),
    new THREE.MeshStandardMaterial({ color: 0xffe082, metalness: 0.8, roughness: 0.2 })
  );
  bow.position.set(0, 0.85, -4.9);
  bow.rotation.x = -Math.PI / 4;
  group.add(bow);

  const paddles = [];
  for (let p = 0; p < 5; p++) {
    const zPos = -2.6 + p * 1.3;
    const warrior = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0xf7ebd2 })
    );
    warrior.position.set(0, 0.65, zPos);
    group.add(warrior);

    const feather = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.45, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffe082 })
    );
    feather.position.set(0, 1.2, zPos);
    group.add(feather);

    const paddle = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.08, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x9c6633 })
    );
    paddle.position.set(p % 2 === 0 ? -0.95 : 0.95, 0.45, zPos);
    group.add(paddle);
    paddles.push(paddle);
  }

  // Hiệu ứng hào quang tăng tốc / buff đồng đội
  const boostAura = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.65, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe082, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
  );
  boostAura.rotation.x = -Math.PI / 2;
  boostAura.position.y = 0.12;
  boostAura.visible = false;
  group.add(boostAura);

  // Hiệu ứng Bèo Tây / làm chậm khi trúng đòn
  const debuffCloud = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.15, 0.25, 32, 8),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x145a32 })
  );
  debuffCloud.position.set(0, 1.15, 0);
  debuffCloud.visible = false;
  group.add(debuffCloud);

  group.position.set((idx - 1.5) * LANE_SPACING, 0.35, 0);
  scene.add(group);
  return { group, paddles, boostAura, debuffCloud };
});

// Hạt bọt nước trắng khi chèo / tăng tốc
const splashes = [];
function spawnSplash(boatIdx, count = 6, colorHex = 0xe8fbff) {
  const origin = boatObjects[boatIdx].group.position;
  for (let i = 0; i < count; i++) {
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 6),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 })
    );
    drop.position.set(
      origin.x + (Math.random() - 0.5) * 1.6,
      0.4,
      origin.z + (Math.random() - 0.5) * 3.5
    );
    scene.add(drop);
    splashes.push({
      mesh: drop,
      vx: (Math.random() - 0.5) * 0.12,
      vy: 0.08 + Math.random() * 0.12,
      vz: (Math.random() - 0.5) * 0.12,
      life: 1
    });
  }
}

// Vật phẩm Bèo Tây bay theo quỹ đạo parabol
const projectiles = [];
function spawn3DProjectile(fromBoatIdx, toBoatIdx, hit = true) {
  const startPos = boatObjects[fromBoatIdx].group.position.clone();
  const endPos = hit
    ? boatObjects[toBoatIdx].group.position.clone()
    : new THREE.Vector3(
        boatObjects[toBoatIdx].group.position.x + (Math.random() > 0.5 ? 2.2 : -2.2),
        0.35,
        boatObjects[toBoatIdx].group.position.z - 5
      );
  const ball = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.55),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: hit ? 0xff5722 : 0x7f8c8d, emissiveIntensity: 0.55 })
  );
  ball.position.copy(startPos);
  scene.add(ball);
  projectiles.push({ mesh: ball, start: startPos, end: endPos, t: 0, targetIdx: toBoatIdx, hit });
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

// ================= 6. HIỂN THỊ BANNER ĐỒNG ĐỘI & ĐỒNG BỘ =================
let bannerTimer = null;
function showTeamBanner(text, duration = 2200) {
  const el = document.getElementById('team-banner');
  if (!el) return;
  el.innerText = text;
  el.style.display = 'block';
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    el.style.display = 'none';
  }, duration);
}

function syncScoreUI() {
  for (let i = 0; i < 4; i++) {
    const m = Math.min(FINISH_LINE, Math.floor(state.boats[i].progress));
    const isMy = i === state.assignedBoat ? '⭐' : '';
    const el = document.getElementById(`score-${i}`);
    if (el) el.innerText = `${isMy}Ghe ${i + 1}: ${m}m`;
  }
  const manaEl = document.getElementById('mana-display');
  if (manaEl) manaEl.innerText = Math.floor(state.boats[state.assignedBoat].mana || 0);
}

function setupFirebaseListeners() {
  if (IS_DEMO_MODE) {
    document.getElementById('player-list').innerHTML =
      '<div style="color:#ffd97d;">Chế độ Chơi Thử Offline: Bấm Đăng Ký & Bắt Đầu để đua cùng 3 ghe máy.</div>';
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

          // Thông báo khi Tay Trống của ghe mình đạt Combo cao
          if (i === state.assignedBoat && (next.drumCombo || 0) >= 3 && next.drumCombo !== prev.drumCombo) {
            showTeamBanner(`🥁 TRỐNG TỐT! (Combo x${next.drumCombo}) — Mở rộng vùng chèo cho cả ghe!`);
          }
          if (i === state.assignedBoat && (next.surgeUntil || 0) > Date.now() && (prev.surgeUntil || 0) <= Date.now()) {
            showTeamBanner('🎺 TÙ VÀ XUNG TRẬN! Toàn đội tăng tốc!');
          }
        }
      }
      syncScoreUI();
    }

    if (room.lastThrow && room.lastThrow.id !== state.lastThrowId) {
      state.lastThrowId = room.lastThrow.id;
      spawn3DProjectile(room.lastThrow.from, room.lastThrow.to, room.lastThrow.hit !== false);
    }

    if (room.lastEvent && room.lastEvent.time !== state.lastEventTime && Date.now() - room.lastEvent.time < 3500) {
      state.lastEventTime = room.lastEvent.time;
      const feed = document.getElementById('feed');
      feed.innerText = room.lastEvent.text;
      feed.style.display = 'block';
    } else if (!room.lastEvent || Date.now() - room.lastEvent.time >= 3500) {
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

    document.getElementById('lobby').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('my-badge').innerHTML =
      `Bạn thuộc: <strong>GHE ${state.assignedBoat + 1}</strong> · ${ROLE_NAMES[state.assignedRole]} · Linh khí: <strong id="mana-display">40</strong>`;
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
        }, 700);
      }
    }, 1000);
  } else if (newStatus === 'finished') {
    playCheerSound();
    document.getElementById('hud').style.display = 'none';
    document.getElementById('podium').style.display = 'flex';
    const ranked = state.boats
      .map((b, idx) => ({ idx, progress: b.progress, finishTime: b.finishTime || 9999999999999 }))
      .sort((a, b) => b.progress - a.progress || a.finishTime - b.finishTime);

    document.getElementById('ranking-list').innerHTML = ranked.map((item, rank) =>
      `<div><strong>${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '🏅'} Hạng ${rank + 1}: Ghe ${item.idx + 1}</strong> — ${Math.min(FINISH_LINE, Math.floor(item.progress))}m</div>`
    ).join('');
  }
}

function startDemoBots() {
  botInterval = setInterval(() => {
    if (state.status !== 'racing') return;
    for (let i = 0; i < 4; i++) {
      if (i === state.assignedBoat) continue;
      addBoatProgress(i, 1.4 + Math.random() * 1.7, 0);
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

  listEl.innerHTML = `<strong>Đã vào sảnh (${entries.length}/20 người):</strong>` + entries.map(p => {
    const k = `${p.prefBoat}_${p.prefRole}`;
    const isConflict = counts[k] > 1;
    return `<div class="player-item">
      <span>${p.name}</span>
      <span class="${isConflict ? 'conflict-badge' : ''}">Ghe ${Number(p.prefBoat) + 1} - ${ROLE_NAMES[p.prefRole]} ${isConflict ? '(Trùng!)' : ''}</span>
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
      handleStatusChange('finished');
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

// ================= 7. ĐIỀU KHIỂN GÓC NHÌN (KHÔNG TỰ KHÓA MỤC TIÊU) =================
function setFocusBoat(val) {
  state.focusBoat = val === 'mine' ? null : Number(val);
  state.camYaw = 0;
  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cam === String(val));
  });
}

document.querySelectorAll('.cam-btn').forEach(btn => {
  btn.onclick = () => {
    const mode = btn.dataset.cam;
    if (mode === 'left') {
      state.camYaw = Math.max(-0.55, state.camYaw - 0.22);
      document.querySelectorAll('.cam-btn').forEach(b => b.classList.toggle('active', b.dataset.cam === 'left'));
    } else if (mode === 'right') {
      state.camYaw = Math.min(0.55, state.camYaw + 0.22);
      document.querySelectorAll('.cam-btn').forEach(b => b.classList.toggle('active', b.dataset.cam === 'right'));
    } else {
      setFocusBoat(mode);
    }
  };
});

// Kéo ngang trên mặt sông 3D để tự liếc góc nhìn
let dragStartX = 0;
canvas.addEventListener('pointerdown', (e) => { dragStartX = e.clientX; });
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons === 1 || e.pointerType === 'touch') {
    const dx = e.clientX - dragStartX;
    state.camYaw = Math.max(-0.55, Math.min(0.55, -dx * 0.0045));
  }
});

// ================= 8. GAMEPLAY TỪNG VAI TRÒ =================
let activeMiniLoop = null;

function renderRoleControls() {
  if (activeMiniLoop) clearInterval(activeMiniLoop);
  const panel = document.getElementById('role-panel');
  const role = state.assignedRole;

  // 1. 2 TAY CHÈO: Chịu ảnh hưởng "TRỐNG TỐT!" từ Tay Trống
  if (role === 'rower_left' || role === 'rower_right') {
    const symbols = ['☀️ MẶT TRỜI', '🦅 CHIM LẠC'];
    let targetSym = symbols[0];
    let pos = 0, dir = 1;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="font-size:14px;">${ROLE_NAMES[role]}</h4>
        <span id="drum-buff-tag" style="font-size:11px; color:#ffd97d;"></span>
      </div>
      <div id="sym-hint" style="font-size:13px; color:#ffe082; font-weight:700; margin:3px 0;">Khẩu lệnh: ${targetSym}</div>
      <div style="width:100%; height:18px; background:#0f2024; border:1px solid #e0b84c; border-radius:9px; position:relative; overflow:hidden; margin:6px 0;">
        <div id="sweet-zone" style="position:absolute; left:38%; width:24%; height:100%; background:rgba(255,217,125,0.45);"></div>
        <div id="swing-cursor" style="position:absolute; left:0%; width:6%; height:100%; background:#ff6b3d; border-radius:4px;"></div>
      </div>
      <div class="btn-group">
        <button id="btn-sun">☀️ MẶT TRỜI</button>
        <button id="btn-bird">🦅 CHIM LẠC</button>
      </div>
    `;

    activeMiniLoop = setInterval(() => {
      const myBoat = state.boats[state.assignedBoat];
      const hasDrumBuff = (myBoat.drumCombo || 0) >= 3;
      const zoneEl = document.getElementById('sweet-zone');
      const tagEl = document.getElementById('drum-buff-tag');

      // Mở rộng vùng vàng khi Tay Trống đạt Combo >= 3
      const leftPct = hasDrumBuff ? 30 : 38;
      const widthPct = hasDrumBuff ? 40 : 24;
      if (zoneEl) {
        zoneEl.style.left = leftPct + '%';
        zoneEl.style.width = widthPct + '%';
      }
      if (tagEl) {
        tagEl.innerText = hasDrumBuff ? `🔥 TRỐNG TỐT! (Combo x${myBoat.drumCombo})` : '';
      }

      pos += dir * 3.9;
      if (pos >= 94 || pos <= 0) dir *= -1;
      const cur = document.getElementById('swing-cursor');
      if (cur) cur.style.left = pos + '%';
    }, 25);

    const handleRow = (chosen) => {
      const myBoat = state.boats[state.assignedBoat];
      const hasDrumBuff = (myBoat.drumCombo || 0) >= 3;
      const minSweet = hasDrumBuff ? 28 : 35;
      const maxSweet = hasDrumBuff ? 72 : 65;

      const inSweetSpot = pos >= minSweet && pos <= maxSweet;
      const rightSym = chosen === targetSym;
      playDrumSound(inSweetSpot ? 155 : 95, 0.14);
      if (navigator.vibrate) navigator.vibrate(inSweetSpot ? 40 : 12);

      let speed = 0.8;
      if (inSweetSpot && rightSym) {
        speed = 3.4;
        playCheerSound();
        spawnSplash(state.assignedBoat, 8, 0xffffff);
      } else if (inSweetSpot || rightSym) {
        speed = 1.9;
        spawnSplash(state.assignedBoat, 4, 0xbef4f7);
      }

      addBoatProgress(state.assignedBoat, speed, inSweetSpot ? 2 : 1);
      targetSym = symbols[Math.floor(Math.random() * symbols.length)];
      const hintEl = document.getElementById('sym-hint');
      if (hintEl) hintEl.innerText = `Khẩu lệnh tiếp: ${targetSym}`;
    };

    document.getElementById('btn-sun').onclick = () => handleRow('☀️ MẶT TRỜI');
    document.getElementById('btn-bird').onclick = () => handleRow('🦅 CHIM LẠC');
  }

  // 2. TAY TRỐNG: Nối Combo gửi "TRỐNG TỐT!" cho cả đội
  else if (role === 'drummer') {
    let activeLane = 0, combo = 0;
    panel.innerHTML = `
      <h4 style="font-size:14px;">🥁 TAY TRỐNG — Gõ Trống Sáng (Combo: <span id="drum-combo">0</span>)</h4>
      <div class="btn-group">
        <button class="d-btn" data-idx="0" data-f="95">🥁 TRỐNG CÁI</button>
        <button class="d-btn" data-idx="1" data-f="155">🪘 TRỐNG CON</button>
        <button class="d-btn" data-idx="2" data-f="330">🔔 CHIÊNG ĐỒNG</button>
      </div>
    `;
    const btns = document.querySelectorAll('.d-btn');
    const highlightNext = () => {
      activeLane = Math.floor(Math.random() * 3);
      btns.forEach((b, i) => {
        b.style.background = i === activeLane ? '#ffd97d' : '#26444a';
        b.style.color = i === activeLane ? '#122124' : '#f7ebd2';
      });
    };
    highlightNext();

    btns.forEach(b => {
      b.onclick = () => {
        const idx = Number(b.dataset.idx);
        playDrumSound(Number(b.dataset.f), 0.16);
        if (idx === activeLane) {
          combo++;
          if (navigator.vibrate) navigator.vibrate(25);
          spawnSplash(state.assignedBoat, 5, 0xffe082);
          updateBoatState(state.assignedBoat, (boat) => {
            boat.drumCombo = combo;
          });
          if (combo >= 3) {
            showTeamBanner(`🥁 TRỐNG TỐT! Combo x${combo} — 2 Tay Chèo được mở rộng vùng chèo!`);
          }
          addBoatProgress(state.assignedBoat, 1.4 * Math.min(2.4, 1 + combo * 0.1), 2);
          highlightNext();
        } else {
          combo = 0;
          updateBoatState(state.assignedBoat, (boat) => {
            boat.drumCombo = 0;
          });
          addBoatProgress(state.assignedBoat, 0.35, 0);
        }
        const cEl = document.getElementById('drum-combo');
        if (cEl) cEl.innerText = combo;
      };
    });
  }

  // 3. ĐÁP HỘI: Vua Tiếng Việt + Ghép Hình Trống Đồng
  else if (role === 'scholar') {
    let mode = 'word'; // 'word' | 'puzzle'
    const bank = [
      { hint: 'Biểu tượng văn hóa Việt cổ', word: 'TRỐNG ĐỒNG' },
      { hint: 'Loài chim khắc trên mặt trống', word: 'CHIM LẠC' },
      { hint: 'Sức mạnh làm nên chiến thắng', word: 'ĐOÀN KẾT' },
      { hint: 'Lễ hội đua thuyền vùng Nam Bộ', word: 'GHE NGO' },
      { hint: 'Con cháu Rồng Tiên', word: 'LẠC HỒNG' }
    ];

    const renderWordGame = () => {
      const current = bank[Math.floor(Math.random() * bank.length)];
      const cleanChars = current.word.replace(/\s+/g, '').split('');
      let shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
      let picked = [];

      const draw = () => {
        panel.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
            <h4 style="font-size:13px;">📜 ĐÁP HỘI — Vua Tiếng Việt (+25 Linh Khí)</h4>
            <button id="switch-to-puzzle" class="secondary" style="width:auto; margin:0; padding:4px 8px; font-size:11px;">🧩 Ghép Hình</button>
          </div>
          <div style="font-size:12px; color:#ffd97d; margin:4px 0;">Gợi ý: ${current.hint}</div>
          <div style="font-size:16px; font-weight:800; letter-spacing:2px; background:#0f2024; border-radius:6px; padding:4px; margin-bottom:6px;">
            ${picked.join(' ') || '_ _ _ _'}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:5px; justify-content:center;">
            ${shuffled.map((ch, i) => `<button class="char-tile" data-i="${i}" style="width:36px; padding:7px 0; margin:0; font-size:13px;">${ch}</button>`).join('')}
            <button id="clear-tile" class="secondary" style="width:52px; padding:7px 0; margin:0; font-size:12px;">XÓA</button>
          </div>
        `;
        document.getElementById('switch-to-puzzle').onclick = () => { mode = 'puzzle'; renderPuzzleGame(); };
        document.querySelectorAll('.char-tile').forEach(btn => {
          btn.onclick = () => {
            const i = Number(btn.dataset.i);
            if (!shuffled[i]) return;
            playDrumSound(220 + picked.length * 28, 0.08);
            picked.push(shuffled[i]);
            shuffled[i] = '';
            if (picked.join('') === cleanChars.join('')) {
              playCheerSound();
              spawnSplash(state.assignedBoat, 7, 0x7ef9d4);
              addBoatProgress(state.assignedBoat, 2.5, 25);
              renderWordGame();
            } else {
              draw();
            }
          };
        });
        document.getElementById('clear-tile').onclick = () => {
          shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
          picked = [];
          draw();
        };
      };
      draw();
    };

    // Trò ghép mảnh 2x2 biểu tượng trống đồng (chọn 2 ô để đổi vị trí)
    const renderPuzzleGame = () => {
      const solved = ['☀️', '🦅', '🥁', '🌊'];
      let tiles = [...solved].sort(() => Math.random() - 0.5);
      if (tiles.join('') === solved.join('')) tiles.reverse();
      let selectedIdx = null;

      const drawPuzzle = () => {
        panel.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
            <h4 style="font-size:13px;">🧩 ĐÁP HỘI — Ghép ☀️ 🦅 🥁 🌊 (+35 Linh Khí)</h4>
            <button id="switch-to-word" class="secondary" style="width:auto; margin:0; padding:4px 8px; font-size:11px;">📜 Ghép Chữ</button>
          </div>
          <div style="font-size:11px; color:#ffd97d; margin:3px 0;">Chạm 2 ô để đổi chỗ theo đúng thứ tự trên</div>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-top:6px;">
            ${tiles.map((t, i) => `
              <button class="puz-btn" data-i="${i}" style="margin:0; padding:10px 0; font-size:18px; background:${selectedIdx === i ? '#ffd97d' : '#26444a'}; color:#122124;">
                ${t}
              </button>
            `).join('')}
          </div>
        `;
        document.getElementById('switch-to-word').onclick = () => { mode = 'word'; renderWordGame(); };
        document.querySelectorAll('.puz-btn').forEach(btn => {
          btn.onclick = () => {
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
                spawnSplash(state.assignedBoat, 9, 0xffe082);
                addBoatProgress(state.assignedBoat, 3.5, 35);
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

  // 4. KẺ PHÁ ĐÁM: Không tự khóa mục tiêu, tự căn lực ném Bèo Tây + Thổi Tù Và + Cảnh báo
  else if (role === 'saboteur') {
    panel.innerHTML = `
      <h4 style="font-size:13px;">💣 KẺ PHÁ ĐÁM — Tự Ngắm & Canh Lực (Vùng chuẩn: 55%–80%)</h4>
      <div style="width:100%; height:16px; background:#0f2024; border:1px solid #e0b84c; border-radius:8px; position:relative; overflow:hidden; margin:6px 0;">
        <div style="position:absolute; left:55%; width:25%; height:100%; background:rgba(46,204,113,0.55);"></div>
        <div id="power-bar" style="width:0%; height:100%; background:#ffd97d;"></div>
      </div>
      <div class="btn-group">
        <select id="t-boat" style="margin:0; width:34%; padding:8px 6px; font-size:12px;">
          <option value="0">Làn Ghe 1</option>
          <option value="1">Làn Ghe 2</option>
          <option value="2">Làn Ghe 3</option>
          <option value="3">Làn Ghe 4</option>
        </select>
        <button id="hold-throw" style="width:42%; padding:8px 6px; font-size:12px;">GIỮ NÉM BÈO (30)</button>
        <button id="horn-btn" class="secondary" style="width:24%; padding:8px 4px; font-size:11px;">🎺 TÙ VÀ (45)</button>
      </div>
    `;

    let power = 0, charging = false;
    const throwBtn = document.getElementById('hold-throw');

    activeMiniLoop = setInterval(() => {
      if (charging) {
        power = Math.min(100, power + 2.7);
        const bar = document.getElementById('power-bar');
        if (bar) bar.style.width = power + '%';
      }
    }, 25);

    throwBtn.onpointerdown = () => {
      charging = true;
      power = 0;
      throwBtn.innerText = 'THẢ RA ĐỂ NÉM!';
    };

    throwBtn.onpointerup = () => {
      if (!charging) return;
      charging = false;
      throwBtn.innerText = 'GIỮ NÉM BÈO (30)';
      const target = Number(document.getElementById('t-boat').value);
      const myBoat = state.boats[state.assignedBoat];

      if (target === state.assignedBoat || (myBoat.mana || 0) < 30) {
        power = 0;
        const bar = document.getElementById('power-bar');
        if (bar) bar.style.width = '0%';
        return;
      }

      addBoatProgress(state.assignedBoat, 0, -30);
      const hit = power >= 55 && power <= 80;

      if (hit) {
        playDrumSound(190, 0.3, 'sawtooth');
        spawnSplash(target, 8, 0x2ecc71);
        if (IS_DEMO_MODE) {
          state.boats[target].debuffUntil = Date.now() + 4500;
          spawn3DProjectile(state.assignedBoat, target, true);
          showTeamBanner(`💣 Bèo Tây trúng Ghe ${target + 1}!`);
        } else {
          update(ref(db, `rooms/${ROOM_ID}/boats/${target}`), { debuffUntil: Date.now() + 4500 });
          update(ref(db, `rooms/${ROOM_ID}`), {
            lastThrow: { id: 'th_' + Date.now(), from: state.assignedBoat, to: target, hit: true },
            lastEvent: { text: `💣 ${state.name} (Ghe ${state.assignedBoat + 1}) thả Bèo Tây trúng Ghe ${target + 1}!`, time: Date.now() }
          });
        }
      } else {
        playDrumSound(90, 0.15);
        spawn3DProjectile(state.assignedBoat, target, false);
        showTeamBanner('💨 Ném lệch vùng lực — Bèo Tây rơi hụt!');
      }

      power = 0;
      const bar = document.getElementById('power-bar');
      if (bar) bar.style.width = '0%';
    };

    document.getElementById('horn-btn').onclick = () => {
      const myBoat = state.boats[state.assignedBoat];
      if ((myBoat.mana || 0) < 45) return;
      playCheerSound();
      spawnSplash(state.assignedBoat, 10, 0xffe082);
      if (IS_DEMO_MODE) {
        myBoat.mana -= 45;
        myBoat.surgeUntil = Date.now() + 4000;
        showTeamBanner('🎺 TÙ VÀ XUNG TRẬN! Toàn đội tăng tốc!');
      } else {
        updateBoatState(state.assignedBoat, (b) => {
          b.mana = Math.max(0, (b.mana || 0) - 45);
          b.surgeUntil = Date.now() + 4000;
        });
        update(ref(db, `rooms/${ROOM_ID}`), {
          lastEvent: { text: `🎺 Ghe ${state.assignedBoat + 1} thổi Tù Và bứt tốc toàn đội!`, time: Date.now() }
        });
      }
    };
  }
}

// ================= 9. SỰ KIỆN SẢNH CHỜ & VÒNG LẶP RENDER 3D =================
document.getElementById('register-btn').onclick = () => {
  initAudio();
  playDrumSound(150, 0.2);
  state.name = document.getElementById('player-name').value.trim() || `Tay Đua ${state.playerId.slice(-3)}`;
  const prefBoat = document.getElementById('pref-boat').value;
  const prefRole = document.getElementById('pref-role').value;

  if (IS_DEMO_MODE) {
    state.players[state.playerId] = { name: state.name, prefBoat, prefRole };
    renderLobbyList();
    return;
  }

  const pRef = ref(db, `rooms/${ROOM_ID}/players/${state.playerId}`);
  set(pRef, { name: state.name, prefBoat, prefRole });
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
  update(ref(db, `rooms/${ROOM_ID}`), {
    status: 'countdown',
    assignments,
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

  riverTex.offset.y -= 0.018;

  boatObjects.forEach((obj, idx) => {
    const bData = state.boats[idx];
    const targetZ = -Math.min(FINISH_LINE, bData.progress || 0);
    obj.group.position.z += (targetZ - obj.group.position.z) * 0.12;
    obj.group.position.y = 0.35 + Math.sin(now * 0.007 + idx) * 0.09;

    const isSurging = now < (bData.surgeUntil || 0);
    const hasDrumBuff = (bData.drumCombo || 0) >= 3;
    const paddleSpeed = isSurging ? 0.026 : hasDrumBuff ? 0.02 : 0.015;

    obj.paddles.forEach((pad, pIdx) => {
      pad.rotation.z = Math.sin(now * paddleSpeed + pIdx) * 0.48;
    });

    obj.boostAura.visible = isSurging || hasDrumBuff;
    if (obj.boostAura.visible) {
      obj.boostAura.rotation.z = now * 0.005;
      const pulse = 1 + Math.sin(now * 0.012) * 0.12;
      obj.boostAura.scale.set(pulse, pulse, 1);
    }

    const isDebuffed = now < (bData.debuffUntil || 0);
    obj.debuffCloud.visible = isDebuffed;
    obj.debuffCloud.rotation.y += 0.05;
    obj.group.rotation.z = isDebuffed ? Math.sin(now * 0.04) * 0.18 : 0;
  });

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
    p.t += 0.035;
    const currentEnd = boatObjects[p.targetIdx].group.position;
    p.mesh.position.lerpVectors(p.start, currentEnd, p.t);
    p.mesh.position.y += Math.sin(p.t * Math.PI) * 5.8;
    if (p.t >= 1) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  const focusIdx = state.focusBoat !== null ? state.focusBoat : state.assignedBoat;
  const focusMesh = boatObjects[focusIdx].group;

  camera.position.x += (focusMesh.position.x - camera.position.x) * 0.12;
  camera.position.z += (focusMesh.position.z + 12 - camera.position.z) * 0.12;
  camera.position.y = 7.4;
  camera.lookAt(
    focusMesh.position.x + Math.sin(state.camYaw) * 9,
    1.2,
    focusMesh.position.z - Math.cos(state.camYaw) * 9
  );

  renderer.render(scene, camera);
}

setupFirebaseListeners();
animate();
