import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// ================= 1. CẤU HÌNH FIREBASE =================
// Thay 3 thông tin bên dưới bằng cấu hình từ Firebase Console của bạn
const firebaseConfig = {
  apiKey: "AIzaSyCXcDemE_sIYBIlqO3p6S_8P0HNGKisvoE",
  databaseURL: "https://fir-game-92590-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fir-game-92590"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ROOM_ID = 'le_hoi_dong_son_2026';
const FINISH_LINE = 300; // Vạch đích 300m
const ALL_ROLES = ['rower_left', 'rower_right', 'drummer', 'scholar', 'saboteur'];
const ROLE_NAMES = {
  rower_left: '🚣 Tay Chèo Trái',
  rower_right: '🚣 Tay Chèo Phải',
  drummer: '🥁 Tay Trống',
  scholar: '📜 Đáp Hội',
  saboteur: '💣 Kẻ Phá Đám'
};

const state = {
  playerId: 'p_' + Math.random().toString(36).slice(2, 8),
  name: '',
  status: 'lobby', // lobby | countdown | racing | finished
  assignedBoat: 0,
  assignedRole: 'rower_left',
  players: {},
  boats: [
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 }
  ]
};

// ================= 2. HỆ THỐNG ÂM THANH LỄ HỘI (WEB AUDIO API) =================
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
  osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + duration);
  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

// ================= 3. THUẬT TOÁN QUAY SỐ CHIA VAI KHI TRÙNG CHỖ =================
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
      assigned[winnerId] = { boat: slot.boat, role: slot.role, luckyWin: candidates.length > 1 };
    }

    candidates.forEach((pid, idx) => {
      if (idx !== winnerIndex) unassignedPlayers.push(pid);
    });
  });

  availableSlots.sort(() => Math.random() - 0.5);
  unassignedPlayers.forEach((pid, idx) => {
    const slot = availableSlots[idx % availableSlots.length];
    assigned[pid] = { boat: slot.boat, role: slot.role, luckyWin: false };
  });

  return assigned;
}

// ================= 4. ĐỒNG BỘ FIREBASE & VÒNG ĐỜI PHÒNG CHƠI =================
function setupFirebaseListeners() {
  const roomRef = ref(db, `rooms/${ROOM_ID}`);

  onValue(roomRef, (snap) => {
    const room = snap.val();
    if (!room) return;

    state.players = room.players || {};
    renderLobbyList();

    if (room.boats) {
      for (let i = 0; i < 4; i++) {
        if (room.boats[i]) {
          state.boats[i] = { ...state.boats[i], ...room.boats[i] };
          document.getElementById(`score-${i}`).innerText = `Ghe ${i + 1}: ${Math.min(FINISH_LINE, Math.floor(state.boats[i].progress))}m`;
        }
      }
    }

    if (room.lastEvent && Date.now() - room.lastEvent.time < 3000) {
      const feed = document.getElementById('feed');
      feed.innerText = room.lastEvent.text;
      feed.style.display = 'block';
    } else {
      document.getElementById('feed').style.display = 'none';
    }

    if (room.status && room.status !== state.status) {
      handleStatusChange(room.status, room.assignments);
    }
  });
}

function handleStatusChange(newStatus, assignments) {
  state.status = newStatus;

  if (newStatus === 'lobby') {
    document.getElementById('lobby').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('podium').style.display = 'none';
  } 
  else if (newStatus === 'countdown') {
    if (assignments && assignments[state.playerId]) {
      state.assignedBoat = assignments[state.playerId].boat;
      state.assignedRole = assignments[state.playerId].role;
    }
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('my-badge').innerText = `Bạn thuộc: GHE ${state.assignedBoat + 1} | Vai trò: ${ROLE_NAMES[state.assignedRole]}`;
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
        playDrumSound(240, 0.4);
        clearInterval(timer);
        setTimeout(() => {
          cdEl.style.display = 'none';
          update(ref(db, `rooms/${ROOM_ID}`), { status: 'racing' });
        }, 700);
      }
    }, 1000);
  } 
  else if (newStatus === 'finished') {
    document.getElementById('hud').style.display = 'none';
    document.getElementById('podium').style.display = 'flex';
    const ranked = state.boats
      .map((b, idx) => ({ idx, progress: b.progress, finishTime: b.finishTime || 9999999999999 }))
      .sort((a, b) => b.progress - a.progress || a.finishTime - b.finishTime);

    document.getElementById('ranking-list').innerHTML = ranked.map((item, rank) =>
      `<div><strong>Hạng ${rank + 1}: Ghe ${item.idx + 1}</strong> — ${Math.min(FINISH_LINE, Math.floor(item.progress))}m</div>`
    ).join('');
  }
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

// ================= 5. CỘNG ĐIỂM AN TOÀN VỚI RUNTRANSACTION =================
function addBoatProgress(boatIdx, deltaProgress, deltaMana = 0) {
  if (state.status !== 'racing') return;
  const boatRef = ref(db, `rooms/${ROOM_ID}/boats/${boatIdx}`);

  runTransaction(boatRef, (current) => {
    if (!current) current = { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 };
    const isSlowed = Date.now() < (current.debuffUntil || 0);
    const actualDelta = isSlowed ? deltaProgress * 0.5 : deltaProgress;

    current.progress = (current.progress || 0) + actualDelta;
    current.mana = Math.min(100, Math.max(0, (current.mana || 0) + deltaMana));

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

// ================= 6. DỰNG CẢNH 3D & VẠCH ĐÍCH =================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1f160d);
scene.fog = new THREE.Fog(0x1f160d, 25, 110);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 250);
scene.add(new THREE.DirectionalLight(0xffd27d, 2.2), new THREE.AmbientLight(0x8c6239, 1.2));

const river = new THREE.Mesh(
  new THREE.PlaneGeometry(36, 450),
  new THREE.MeshStandardMaterial({ color: 0x263529, roughness: 0.4, metalness: 0.3 })
);
river.rotation.x = -Math.PI / 2;
river.position.z = -180;
scene.add(river);

const finishGate = new THREE.Mesh(
  new THREE.BoxGeometry(24, 0.4, 1.5),
  new THREE.MeshStandardMaterial({ color: 0xffd27d, emissive: 0xd4af37, emissiveIntensity: 0.6 })
);
finishGate.position.set(0, 0.2, -FINISH_LINE);
scene.add(finishGate);

const boatColors = [0xd4af37, 0xc0392b, 0x16a085, 0xe67e22];
const boatMeshes = boatColors.map((color, idx) => {
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.6, 8),
    new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 })
  );
  hull.position.set((idx - 1.5) * 4.5, 0.3, 0);
  scene.add(hull);
  return hull;
});

// ================= 7. ĐIỀU KHIỂN MINI-GAME TỪNG VAI TRÒ =================
function renderRoleControls() {
  const panel = document.getElementById('role-panel');
  const role = state.assignedRole;

  if (role === 'rower_left' || role === 'rower_right') {
    const symbols = ['☀️ MẶT TRỜI', '🦅 CHIM LẠC'];
    let targetSym = symbols[0];
    panel.innerHTML = `
      <h4>${ROLE_NAMES[role]} — Hô nhịp với đồng đội!</h4>
      <p id="sym-hint" style="font-size:13px; color:#ffd27d; margin-top:4px;">Khẩu lệnh hiện tại: ${targetSym}</p>
      <div class="btn-group">
        <button id="btn-sun">☀️ CHÈO MẶT TRỜI</button>
        <button id="btn-bird">🦅 CHÈO CHIM LẠC</button>
      </div>
    `;
    const handleRow = (chosen) => {
      playDrumSound(120, 0.12);
      if (navigator.vibrate) navigator.vibrate(30);
      const bonus = chosen === targetSym ? 2.2 : 0.8;
      addBoatProgress(state.assignedBoat, bonus, 1);
      targetSym = symbols[Math.floor(Math.random() * symbols.length)];
      document.getElementById('sym-hint').innerText = `Khẩu lệnh tiếp theo: ${targetSym}`;
    };
    document.getElementById('btn-sun').onclick = () => handleRow('☀️ MẶT TRỜI');
    document.getElementById('btn-bird').onclick = () => handleRow('🦅 CHIM LẠC');
  } 
  else if (role === 'drummer') {
    panel.innerHTML = `
      <h4>🥁 TAY TRỐNG — Giữ nhịp lễ hội</h4>
      <div class="btn-group">
        <button class="d-btn" data-f="95">TRỐNG CÁI</button>
        <button class="d-btn" data-f="145">TRỐNG CON</button>
        <button class="d-btn" data-f="320">CHIÊNG ĐỒNG</button>
      </div>
    `;
    document.querySelectorAll('.d-btn').forEach(b => {
      b.onclick = () => {
        playDrumSound(Number(b.dataset.f), 0.16);
        addBoatProgress(state.assignedBoat, 1.4, 2);
      };
    });
  } 
  else if (role === 'scholar') {
    const bank = [
      { q: 'Đ / O / À / N / K / Ế / T', a: 'ĐOÀN KẾT' },
      { q: 'T / R / Ố / N / G / Đ / Ồ / N / G', a: 'TRỐNG ĐỒNG' },
      { q: 'L / Ạ / C / H / Ồ / N / G', a: 'LẠC HỒNG' },
      { q: 'V / Ă / N / L / A / N / G', a: 'VĂN LANG' },
      { q: 'Đ / Ô / N / G / S / Ơ / N', a: 'ĐÔNG SƠN' }
    ];
    let item = bank[Math.floor(Math.random() * bank.length)];
    panel.innerHTML = `
      <h4>📜 ĐÁP HỘI — Giải đố nạp Linh Khí</h4>
      <p style="color:#ffd27d; font-weight:bold; margin:4px 0;">${item.q}</p>
      <div class="btn-group">
        <input id="ans-in" placeholder="Nhập đáp án..." style="margin:0;" />
        <button id="ans-ok" style="width:40%;">GỬI</button>
      </div>
    `;
    document.getElementById('ans-ok').onclick = () => {
      if (document.getElementById('ans-in').value.trim().toUpperCase() === item.a) {
        playDrumSound(280, 0.25);
        addBoatProgress(state.assignedBoat, 2.5, 30);
        renderRoleControls();
      }
    };
  } 
  else if (role === 'saboteur') {
    panel.innerHTML = `
      <h4>💣 KẺ PHÁ ĐÁM (Tốn 30 Linh Khí/lần)</h4>
      <p style="font-size:12px;">Nhấn giữ nút NÉM để nạp lực (0.35s - 1.1s sẽ trúng đích!)</p>
      <div class="btn-group">
        <select id="t-boat" style="margin:0; width:45%;">
          <option value="0">Nhắm Ghe 1</option>
          <option value="1">Nhắm Ghe 2</option>
          <option value="2">Nhắm Ghe 3</option>
          <option value="3">Nhắm Ghe 4</option>
        </select>
        <button id="hold-throw" style="width:55%;">GIỮ ĐỂ NẠP LỰC NÉM</button>
      </div>
    `;
    let pressTime = 0;
    const btn = document.getElementById('hold-throw');
    btn.onpointerdown = () => { pressTime = Date.now(); btn.innerText = 'ĐANG NẠP LỰC...'; };
    btn.onpointerup = () => {
      const holdMs = Date.now() - pressTime;
      btn.innerText = 'GIỮ ĐỂ NẠP LỰC NÉM';
      const target = Number(document.getElementById('t-boat').value);
      const myBoat = state.boats[state.assignedBoat];

      if (target === state.assignedBoat || myBoat.mana < 30) return;
      addBoatProgress(state.assignedBoat, 0, -30);

      if (holdMs >= 350 && holdMs <= 1100) {
        playDrumSound(180, 0.3, 'sawtooth');
        update(ref(db, `rooms/${ROOM_ID}/boats/${target}`), { debuffUntil: Date.now() + 4500 });
        update(ref(db, `rooms/${ROOM_ID}`), {
          lastEvent: { text: `💣 ${state.name} (Ghe ${state.assignedBoat + 1}) ném Bèo Tây trúng Ghe ${target + 1}!`, time: Date.now() }
        });
      }
    };
  }
}

// ================= 8. SỰ KIỆN NÚT BẤM & VÒNG LẶP RENDER =================
document.getElementById('register-btn').onclick = () => {
  initAudio();
  playDrumSound(150, 0.2);
  state.name = document.getElementById('player-name').value.trim() || `Tay Đua ${state.playerId.slice(-3)}`;
  const pRef = ref(db, `rooms/${ROOM_ID}/players/${state.playerId}`);
  set(pRef, {
    name: state.name,
    prefBoat: document.getElementById('pref-boat').value,
    prefRole: document.getElementById('pref-role').value
  });
  onDisconnect(pRef).remove();
};

document.getElementById('host-start-btn').onclick = () => {
  initAudio();
  const assignments = assignRolesWithLottery(state.players);
  update(ref(db, `rooms/${ROOM_ID}`), {
    status: 'countdown',
    assignments,
    boats: {
      0: { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
      1: { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
      2: { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
      3: { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 }
    }
  });
};

document.getElementById('reset-room-btn').onclick = () => {
  update(ref(db, `rooms/${ROOM_ID}`), { status: 'lobby' });
};

function animate() {
  requestAnimationFrame(animate);
  boatMeshes.forEach((mesh, idx) => {
    const targetZ = -Math.min(FINISH_LINE, state.boats[idx].progress || 0);
    mesh.position.z += (targetZ - mesh.position.z) * 0.12;
    mesh.position.y = 0.3 + Math.sin(Date.now() * 0.006 + idx) * 0.08;
  });

  const myMesh = boatMeshes[state.assignedBoat];
  camera.position.x += (myMesh.position.x - camera.position.x) * 0.1;
  camera.position.z = myMesh.position.z + 12;
  camera.position.y = 7.5;
  camera.lookAt(myMesh.position.x, 1, myMesh.position.z - 8);

  renderer.render(scene, camera);
}

setupFirebaseListeners();
animate();
