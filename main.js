import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, update, onValue, runTransaction, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// ================= 1. CẤU HÌNH FIREBASE (GIỮ NGUYÊN CỦA BẠN) =================
const firebaseConfig = {
  apiKey: "AIzaSyCXcDemE_sIYBIlqO3p6S_8P0HNGKisvoE",
  databaseURL: "https://fir-game-92590-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fir-game-92590"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ROOM_ID = 'le_hoi_dong_son_2026';
const FINISH_LINE = 300;
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
  status: 'lobby',
  assignedBoat: 0,
  assignedRole: 'rower_left',
  players: {},
  lastThrowId: '',
  boats: [
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 },
    { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 }
  ]
};

// ================= 2. HỆ THỐNG ÂM THANH LỄ HỘI & REO HÒ =================
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
  gain.gain.setValueAtTime(0.45, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
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
    osc.frequency.setValueAtTime(f, audioCtx.currentTime + i * 0.06);
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime + i * 0.06);
    gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + i * 0.06 + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + i * 0.06);
    osc.stop(audioCtx.currentTime + i * 0.06 + 0.35);
  });
}

// ================= 3. TẠO VÂN TRỐNG ĐỒNG ĐÔNG SƠN CHO CẢNH 3D =================
function createDongSonTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#23190f';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = '#8c6928';
  ctx.lineWidth = 2;

  const radii = [70, 115, 165, 220];
  radii.forEach((r, idx) => {
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();

    const teeth = 24 + idx * 12;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(a) * (r - 6), 256 + Math.sin(a) * (r - 6));
      ctx.lineTo(256 + Math.cos(a + 0.05) * (r + 6), 256 + Math.sin(a + 0.05) * (r + 6));
      ctx.stroke();
    }
  });

  ctx.fillStyle = '#a87e32';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(256, 256);
    ctx.lineTo(256 + Math.cos(a - 0.12) * 25, 256 + Math.sin(a - 0.12) * 25);
    ctx.lineTo(256 + Math.cos(a) * 55, 256 + Math.sin(a) * 55);
    ctx.lineTo(256 + Math.cos(a + 0.12) * 25, 256 + Math.sin(a + 0.12) * 25);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 35);
  return tex;
}

// ================= 4. DỰNG CẢNH 3D GHE NGO & ĐỘI CHÈO =================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a120a);
scene.fog = new THREE.Fog(0x1a120a, 28, 120);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 250);
scene.add(new THREE.DirectionalLight(0xffd98e, 2.5), new THREE.AmbientLight(0x9e7340, 1.3));

const riverTex = createDongSonTexture();
const river = new THREE.Mesh(
  new THREE.PlaneGeometry(34, 460),
  new THREE.MeshStandardMaterial({ map: riverTex, roughness: 0.5, metalness: 0.4 })
);
river.rotation.x = -Math.PI / 2;
river.position.z = -180;
scene.add(river);

const finishGate = new THREE.Group();
const arch = new THREE.Mesh(
  new THREE.TorusGeometry(13, 0.5, 8, 32, Math.PI),
  new THREE.MeshStandardMaterial({ color: 0xffd27d, emissive: 0xd4af37, emissiveIntensity: 0.7 })
);
finishGate.add(arch);
finishGate.position.set(0, 0, -FINISH_LINE);
scene.add(finishGate);

const boatColors = [0xd4af37, 0xc0392b, 0x16a085, 0xe67e22];
const boatObjects = boatColors.map((color, idx) => {
  const group = new THREE.Group();

  const hull = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.75, 8.5, 8),
    new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.25 })
  );
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.1, 1, 0.65);
  group.add(hull);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd27d, metalness: 0.8, roughness: 0.2 })
  );
  bow.position.set(0, 0.8, -4.6);
  bow.rotation.x = -Math.PI / 4;
  group.add(bow);

  const paddles = [];
  for (let p = 0; p < 5; p++) {
    const zPos = -2.4 + p * 1.2;
    const warrior = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0xf5deb3 })
    );
    warrior.position.set(0, 0.65, zPos);
    group.add(warrior);

    const feather = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.45, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffd27d })
    );
    feather.position.set(0, 1.2, zPos);
    group.add(feather);

    const paddle = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.08, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
    );
    paddle.position.set(p % 2 === 0 ? -0.9 : 0.9, 0.45, zPos);
    group.add(paddle);
    paddles.push(paddle);
  }

  const debuffCloud = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.1, 0.25, 32, 8),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x145a32 })
  );
  debuffCloud.position.set(0, 1.1, 0);
  debuffCloud.visible = false;
  group.add(debuffCloud);

  group.position.set((idx - 1.5) * 4.6, 0.35, 0);
  scene.add(group);
  return { group, paddles, debuffCloud };
});

const projectiles = [];
function spawn3DProjectile(fromBoatIdx, toBoatIdx) {
  const startPos = boatObjects[fromBoatIdx].group.position.clone();
  const endPos = boatObjects[toBoatIdx].group.position.clone();
  const ball = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.55),
    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0xff5722, emissiveIntensity: 0.6 })
  );
  ball.position.copy(startPos);
  scene.add(ball);
  projectiles.push({ mesh: ball, start: startPos, end: endPos, t: 0, targetIdx: toBoatIdx });
}

// ================= 5. THUẬT TOÁN QUAY SỐ CHIA VAI KHI TRÙNG CHỖ =================
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

// ================= 6. ĐỒNG BỘ FIREBASE =================
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
          const m = Math.min(FINISH_LINE, Math.floor(state.boats[i].progress));
          const isMy = i === state.assignedBoat ? '⭐' : '';
          document.getElementById(`score-${i}`).innerText = `${isMy}Ghe ${i + 1}: ${m}m`;
        }
      }
      const manaEl = document.getElementById('mana-display');
      if (manaEl) manaEl.innerText = Math.floor(state.boats[state.assignedBoat].mana || 0);
    }

    if (room.lastThrow && room.lastThrow.id !== state.lastThrowId) {
      state.lastThrowId = room.lastThrow.id;
      spawn3DProjectile(room.lastThrow.from, room.lastThrow.to);
    }

    if (room.lastEvent && Date.now() - room.lastEvent.time < 3200) {
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
    document.getElementById('my-badge').innerHTML = `Bạn thuộc: <strong>GHE ${state.assignedBoat + 1}</strong> | ${ROLE_NAMES[state.assignedRole]} | Linh khí: <strong id="mana-display">40</strong>`;
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
          update(ref(db, `rooms/${ROOM_ID}`), { status: 'racing' });
        }, 750);
      }
    }, 1000);
  } 
  else if (newStatus === 'finished') {
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

function addBoatProgress(boatIdx, deltaProgress, deltaMana = 0) {
  if (state.status !== 'racing') return;
  const boatRef = ref(db, `rooms/${ROOM_ID}/boats/${boatIdx}`);

  runTransaction(boatRef, (current) => {
    if (!current) current = { progress: 0, mana: 40, debuffUntil: 0, finishTime: 0 };
    const isSlowed = Date.now() < (current.debuffUntil || 0);
    const actualDelta = isSlowed ? deltaProgress * 0.45 : deltaProgress;

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

// ================= 7. GAME FEEL TỪNG VAI TRÒ =================
let activeMiniLoop = null;

function renderRoleControls() {
  if (activeMiniLoop) clearInterval(activeMiniLoop);
  const panel = document.getElementById('role-panel');
  const role = state.assignedRole;

  if (role === 'rower_left' || role === 'rower_right') {
    const symbols = ['☀️ MẶT TRỜI', '🦅 CHIM LẠC'];
    let targetSym = symbols[0];
    let pos = 0, dir = 1;

    panel.innerHTML = `
      <h4>${ROLE_NAMES[role]} — Canh Vùng Vàng & Khớp Lệnh!</h4>
      <div id="sym-hint" style="font-size:14px; color:#ffd27d; font-weight:bold; margin:4px 0;">Khẩu lệnh: ${targetSym}</div>
      <div style="width:100%; height:18px; background:#1a120b; border:1px solid #d4af37; border-radius:9px; position:relative; overflow:hidden; margin:8px 0;">
        <div style="position:absolute; left:38%; width:24%; height:100%; background:rgba(212,175,55,0.45);"></div>
        <div id="swing-cursor" style="position:absolute; left:0%; width:6%; height:100%; background:#ff5722; border-radius:4px;"></div>
      </div>
      <div class="btn-group">
        <button id="btn-sun">☀️ CHÈO MẶT TRỜI</button>
        <button id="btn-bird">🦅 CHÈO CHIM LẠC</button>
      </div>
    `;

    activeMiniLoop = setInterval(() => {
      pos += dir * 3.8;
      if (pos >= 94 || pos <= 0) dir *= -1;
      const cur = document.getElementById('swing-cursor');
      if (cur) cur.style.left = pos + '%';
    }, 25);

    const handleRow = (chosen) => {
      const inSweetSpot = pos >= 35 && pos <= 65;
      const rightSym = chosen === targetSym;
      playDrumSound(inSweetSpot ? 150 : 95, 0.14);
      if (navigator.vibrate) navigator.vibrate(inSweetSpot ? 45 : 15);

      let speed = 0.7;
      if (inSweetSpot && rightSym) { speed = 3.2; playCheerSound(); }
      else if (inSweetSpot || rightSym) { speed = 1.8; }

      addBoatProgress(state.assignedBoat, speed, inSweetSpot ? 2 : 1);
      targetSym = symbols[Math.floor(Math.random() * symbols.length)];
      document.getElementById('sym-hint').innerText = `Khẩu lệnh tiếp: ${targetSym}`;
    };
    document.getElementById('btn-sun').onclick = () => handleRow('☀️ MẶT TRỜI');
    document.getElementById('btn-bird').onclick = () => handleRow('🦅 CHIM LẠC');
  }

  else if (role === 'drummer') {
    let activeLane = 0, combo = 0;
    panel.innerHTML = `
      <h4>🥁 TAY TRỐNG — Gõ Trống Sáng (Combo: <span id="drum-combo">0</span>)</h4>
      <p style="font-size:12px; opacity:0.85;">Chạm nhanh mặt trống đang phát sáng để tích bội số tốc độ!</p>
      <div class="btn-group">
        <button class="d-btn" data-idx="0" data-f="95" style="height:64px;">🥁 TRỐNG CÁI</button>
        <button class="d-btn" data-idx="1" data-f="155" style="height:64px;">🪘 TRỐNG CON</button>
        <button class="d-btn" data-idx="2" data-f="330" style="height:64px;">🔔 CHIÊNG ĐỒNG</button>
      </div>
    `;
    const btns = document.querySelectorAll('.d-btn');
    const highlightNext = () => {
      activeLane = Math.floor(Math.random() * 3);
      btns.forEach((b, i) => {
        b.style.background = i === activeLane ? '#ffd27d' : '#3d2b18';
        b.style.color = i === activeLane ? '#1a120b' : '#f5deb3';
        b.style.transform = i === activeLane ? 'scale(1.04)' : 'scale(1)';
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
          const mult = Math.min(2.5, 1 + combo * 0.1);
          addBoatProgress(state.assignedBoat, 1.3 * mult, 2);
          highlightNext();
        } else {
          combo = 0;
          addBoatProgress(state.assignedBoat, 0.3, 0);
        }
        document.getElementById('drum-combo').innerText = combo;
      };
    });
  }

  else if (role === 'scholar') {
    const bank = [
      { hint: 'Biểu tượng văn hóa Việt cổ', word: 'TRỐNG ĐỒNG' },
      { hint: 'Loài chim khắc trên mặt trống', word: 'CHIM LẠC' },
      { hint: 'Sức mạnh làm nên chiến thắng', word: 'ĐOÀN KẾT' },
      { hint: 'Quốc hiệu đầu tiên của nước ta', word: 'VĂN LANG' },
      { hint: 'Con cháu Rồng Tiên', word: 'LẠC HỒNG' },
      { hint: 'Lễ hội đua thuyền vùng Nam Bộ', word: 'GHE NGO' },
      { hint: 'Vị vua dời đô về Thăng Long', word: 'LÝ THÁI TỔ' },
      { hint: 'Bánh truyền thống ngày Tết', word: 'BÁNH CHƯNG' }
    ];
    let current = bank[Math.floor(Math.random() * bank.length)];
    let cleanChars = current.word.replace(/\s+/g, '').split('');
    let shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
    let picked = [];

    const renderTiles = () => {
      panel.innerHTML = `
        <h4>📜 ĐÁP HỘI — Bấm ghép chữ (+30 Linh Khí)</h4>
        <p style="font-size:12px; color:#ffd27d;">Gợi ý: ${current.hint}</p>
        <div style="margin:6px 0; font-size:18px; font-weight:bold; letter-spacing:3px; min-height:26px; background:#1a120b; border-radius:6px; padding:4px;">
          ${picked.join(' ') || '_ _ _ _'}
        </div>
        <div id="tile-box" style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center;">
          ${shuffled.map((ch, i) => `<button class="char-tile" data-i="${i}" style="width:38px; padding:8px 0; margin:0;">${ch}</button>`).join('')}
          <button id="clear-tile" class="secondary" style="width:54px; padding:8px 0; margin:0;">XÓA</button>
        </div>
      `;

      document.querySelectorAll('.char-tile').forEach(btn => {
        btn.onclick = () => {
          const i = Number(btn.dataset.i);
          if (!shuffled[i]) return;
          playDrumSound(220 + picked.length * 30, 0.08);
          picked.push(shuffled[i]);
          shuffled[i] = '';
          if (picked.join('') === cleanChars.join('')) {
            playCheerSound();
            addBoatProgress(state.assignedBoat, 3.0, 30);
            renderRoleControls();
          } else {
            renderTiles();
          }
        };
      });
      document.getElementById('clear-tile').onclick = () => {
        shuffled = [...cleanChars].sort(() => Math.random() - 0.5);
        picked = [];
        renderTiles();
      };
    };
    renderTiles();
  }

  else if (role === 'saboteur') {
    panel.innerHTML = `
      <h4>💣 KẺ PHÁ ĐÁM (Tốn 30 Linh Khí/lần)</h4>
      <div style="width:100%; height:18px; background:#1a120b; border:1px solid #d4af37; border-radius:9px; position:relative; overflow:hidden; margin:8px 0;">
        <div style="position:absolute; left:55%; width:25%; height:100%; background:rgba(46,204,113,0.5);"></div>
        <div id="power-bar" style="width:0%; height:100%; background:#ffd27d;"></div>
      </div>
      <div class="btn-group">
        <select id="t-boat" style="margin:0; width:42%;">
          <option value="0">Nhắm Ghe 1</option>
          <option value="1">Nhắm Ghe 2</option>
          <option value="2">Nhắm Ghe 3</option>
          <option value="3">Nhắm Ghe 4</option>
        </select>
        <button id="hold-throw" style="width:58%;">GIỮ NẠP LỰC (VÙNG XANH)</button>
      </div>
    `;
    let power = 0, charging = false;
    const btn = document.getElementById('hold-throw');

    activeMiniLoop = setInterval(() => {
      if (charging) {
        power = Math.min(100, power + 2.8);
        const bar = document.getElementById('power-bar');
        if (bar) bar.style.width = power + '%';
      }
    }, 25);

    btn.onpointerdown = () => { charging = true; power = 0; btn.innerText = 'THẢ RA ĐỂ NÉM!'; };
    btn.onpointerup = () => {
      if (!charging) return;
      charging = false;
      btn.innerText = 'GIỮ NẠP LỰC (VÙNG XANH)';
      const target = Number(document.getElementById('t-boat').value);
      const myBoat = state.boats[state.assignedBoat];

      if (target === state.assignedBoat || myBoat.mana < 30) {
        power = 0;
        return;
      }
      addBoatProgress(state.assignedBoat, 0, -30);

      if (power >= 52 && power <= 83) {
        playDrumSound(190, 0.3, 'sawtooth');
        update(ref(db, `rooms/${ROOM_ID}/boats/${target}`), { debuffUntil: Date.now() + 4500 });
        update(ref(db, `rooms/${ROOM_ID}`), {
          lastThrow: { id: 'th_' + Date.now(), from: state.assignedBoat, to: target },
          lastEvent: { text: `💣 ${state.name} (Ghe ${state.assignedBoat + 1}) thả Bèo Tây trúng Ghe ${target + 1}!`, time: Date.now() }
        });
      }
      power = 0;
      const bar = document.getElementById('power-bar');
      if (bar) bar.style.width = '0%';
    };
  }
}

// ================= 8. SỰ KIỆN PHÒNG CHỜ & VÒNG LẶP RENDER 3D =================
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
  const now = Date.now();

  riverTex.offset.y -= 0.015;

  boatObjects.forEach((obj, idx) => {
    const bData = state.boats[idx];
    const targetZ = -Math.min(FINISH_LINE, bData.progress || 0);
    obj.group.position.z += (targetZ - obj.group.position.z) * 0.12;
    obj.group.position.y = 0.35 + Math.sin(now * 0.007 + idx) * 0.09;

    obj.paddles.forEach((pad, pIdx) => {
      pad.rotation.z = Math.sin(now * 0.015 + pIdx) * 0.45;
    });

    const isDebuffed = now < (bData.debuffUntil || 0);
    obj.debuffCloud.visible = isDebuffed;
    obj.debuffCloud.rotation.y += 0.05;
    obj.group.rotation.z = isDebuffed ? Math.sin(now * 0.04) * 0.18 : 0;
  });

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += 0.035;
    const currentEnd = boatObjects[p.targetIdx].group.position;
    p.mesh.position.lerpVectors(p.start, currentEnd, p.t);
    p.mesh.position.y += Math.sin(p.t * Math.PI) * 5.5;
    if (p.t >= 1) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  const myMesh = boatObjects[state.assignedBoat].group;
  camera.position.x += (myMesh.position.x - camera.position.x) * 0.1;
  camera.position.z = myMesh.position.z + 11.5;
  camera.position.y = 7.2;
  camera.lookAt(myMesh.position.x, 1.2, myMesh.position.z - 8);

  renderer.render(scene, camera);
}

setupFirebaseListeners();
animate();
