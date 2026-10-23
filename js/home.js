
let activeGameDirective = 'campaign'; // 'campaign' | 'endless'
try {
  const savedDir = localStorage.getItem('vita_game_directive');
  if (savedDir === 'endless' || savedDir === 'campaign') activeGameDirective = savedDir;
} catch(_) {}

function selectGameDirective(mode) {
  activeGameDirective = (mode === 'endless') ? 'endless' : 'campaign';
  try { localStorage.setItem('vita_game_directive', activeGameDirective); } catch(_) {}
  
  const btnC = document.getElementById('btnDirectiveCampaign');
  const btnE = document.getElementById('btnDirectiveEndless');
  const btnPlayText = document.getElementById('btnHeroPlayText');
  const isId = (homeSettings && homeSettings.lang === 'id');
  
  if (btnC) {
    if (activeGameDirective === 'campaign') {
      btnC.classList.add('active');
      btnC.style.borderColor = 'var(--accent, #ff3b3b)';
      btnC.style.background = 'rgba(255, 59, 59, 0.22)';
      btnC.style.color = '#fff';
    } else {
      btnC.classList.remove('active');
      btnC.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      btnC.style.background = 'transparent';
      btnC.style.color = 'rgba(255, 255, 255, 0.6)';
    }
  }
  if (btnE) {
    if (activeGameDirective === 'endless') {
      btnE.classList.add('active');
      btnE.style.borderColor = '#00f0ff';
      btnE.style.background = 'rgba(0, 240, 255, 0.22)';
      btnE.style.color = '#00f0ff';
    } else {
      btnE.classList.remove('active');
      btnE.style.borderColor = 'rgba(0, 229, 255, 0.3)';
      btnE.style.background = 'rgba(0, 229, 255, 0.08)';
      btnE.style.color = '#00e5ff';
    }
  }
  if (btnPlayText) {
    if (activeGameDirective === 'endless') {
      btnPlayText.textContent = isId ? 'MASUK ARENA SURVIVAL // HORDE' : 'ENTER SURVIVAL ARENA // HORDE';
    } else {
      btnPlayText.textContent = isId ? 'MASUK KE DALAM LABIRIN' : 'ENTER THE LABYRINTH';
    }
  }
}

// Inisialisasi tampilan directive tombol saat Hub siap
if (typeof document !== 'undefined') {
  setTimeout(function() {
    try { selectGameDirective(activeGameDirective); } catch(_) {}
  }, 50);
}

const emberCanvas = document.getElementById('embers');
const emberCtx = emberCanvas.getContext('2d');
let EW, EH, embers = [];
const emberMouse = { x: 0, y: 0, t: 0 };

// v2.x perf: #homeView is a singleton element that never leaves the DOM — cache the lookup
// instead of re-querying it every frame (the ember loop + bestiary pulse run at 60 Hz).
let _hubViewEl = null;
function hubView() {
  if (!_hubViewEl || !_hubViewEl.isConnected) _hubViewEl = document.getElementById('homeView');
  return _hubViewEl;
}

// prefers-reduced-motion: the global CSS rule dampens CSS transitions only, not JS-driven
// loops, so decorative JS animation must opt out explicitly.
const HOME_REDUCE_MOTION = (typeof window.matchMedia === 'function') &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resizeEmbers() {
  EW = emberCanvas.width = window.innerWidth;
  EH = emberCanvas.height = window.innerHeight;
  const count = Math.min(90, Math.floor(EW * EH / 16000));
  embers = Array.from({ length: count }, () => spawnEmber(true));
}
function spawnEmber(anywhere) {
  return {
    x: Math.random() * EW,
    y: anywhere ? Math.random() * EH : EH + 20,
    r: Math.random() * 2 + 0.6,
    vy: -(Math.random() * 0.35 + 0.12),   // naik seperti bara / abu panas
    vx: (Math.random() - 0.5) * 0.25,
    life: Math.random() * 160 + 120,
    max: 280,
    phase: Math.random() * Math.PI * 2,
    hue: Math.random() < 0.35 ? 18 : 0,   // kadang oranye, mayoritas merah
    big: Math.random() < 0.08
  };
}
window.addEventListener('resize', resizeEmbers);
resizeEmbers();
window.addEventListener('mousemove', e => { emberMouse.x = e.clientX; emberMouse.y = e.clientY; emberMouse.t = performance.now(); });

function drawEmbers(now) {
  // v2.0 perf: skip render cost when tab hidden or hub not visible.
  const hv0 = hubView();
  if (document.hidden || (hv0 && hv0.style.display === 'none')) {
    requestAnimationFrame(drawEmbers);
    return;
  }
  emberCtx.clearRect(0, 0, EW, EH);
  for (const p of embers) {
    p.x += p.vx + Math.sin(p.phase += 0.02) * 0.15;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0 || p.y < -20 || p.x < -20 || p.x > EW + 20) {
      Object.assign(p, spawnEmber(false));
      continue;
    }
    const t = Math.min(1, p.life / (p.max * 0.6));
    const flicker = 0.55 + Math.sin(p.phase * 2) * 0.45;
    emberCtx.globalAlpha = t * flicker * 0.8;
    emberCtx.fillStyle = p.hue ? 'rgba(255,138,61,1)' : 'rgba(255,54,54,1)';
    emberCtx.beginPath();
    emberCtx.arc(p.x, p.y, p.r * (p.big ? 2.4 : 1), 0, Math.PI * 2);
    emberCtx.fill();
    if (p.big) {
      emberCtx.globalAlpha = t * 0.25;
      emberCtx.beginPath();
      emberCtx.arc(p.x, p.y, p.r * 9, 0, Math.PI * 2);
      emberCtx.fill();
    }
  }
  // paralaks halus ke kursor
  const px = (emberMouse.x - EW / 2) * 0.02;
  const py = (emberMouse.y - EH / 2) * 0.02;
  emberCtx.save();
  emberCtx.globalAlpha = 0.3;
  emberCtx.translate(-px, -py);
  emberCtx.strokeStyle = 'rgba(255,54,54,0.5)';
  emberCtx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = (i * EW) / 4.2;
    const y = (i * EH) / 6.2;
    emberCtx.beginPath();
    emberCtx.moveTo(x - 16, y); emberCtx.lineTo(x + 16, y);
    emberCtx.moveTo(x, y - 16); emberCtx.lineTo(x, y + 16);
    emberCtx.stroke();
  }
  emberCtx.restore();
  emberCtx.globalAlpha = 1;
  drawTeasers(now);
  requestAnimationFrame(drawEmbers);
}
requestAnimationFrame(drawEmbers);

function openModal(name, desc, cmd, req) {
  const tText = document.getElementById('modalTitleText');
  if (tText && name) tText.textContent = name;
  else if (document.getElementById('modalTitle') && name) {
    document.getElementById('modalTitle').textContent = name;
  }
  const mDesc = document.getElementById('modalDesc');
  if (mDesc) mDesc.textContent = desc || '';
  const mCmd = document.getElementById('modalCmd');
  if (mCmd) mCmd.textContent = cmd || '';
  const mReq = document.getElementById('modalReq');
  if (mReq) mReq.textContent = req || '';
  if (typeof updateInstructionsModalLang === 'function') {
    updateInstructionsModalLang((homeSettings && homeSettings.lang) || 'id');
  }
  const m = document.getElementById('modal');
  if (m) m.classList.add('open');
}
const mCloseBtn = document.getElementById('modalClose');
if (mCloseBtn) {
  mCloseBtn.addEventListener('click', () => {
    const m = document.getElementById('modal');
    if (m) m.classList.remove('open');
  });
}
const mRoot = document.getElementById('modal');
if (mRoot) {
  mRoot.addEventListener('click', e => {
    if (e.target.id === 'modal') e.currentTarget.classList.remove('open');
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = document.getElementById('modal');
    if (m) m.classList.remove('open');
  }
});

/* Teaser monster: pixel-art prosedural 2-frame, tanpa aset eksternal.
   '.' = transparan. Digambar chunky langsung ke <canvas data-foe>. */
const FOE_PX = 8;
const FOES = {
  slime: {
    pal: { g: '#2ea89a', W: '#bff3ec', E: '#06383b' },
    frames: [
      [
        '....gggg....',
        '..gggggggg..',
        '.gWWggggggg.',
        '.gWgggggggg.',
        'gggggggggggg',
        'gEEggggggEEg',
        'gEEggggggEEg',
        'gggggggggggg',
        '.gggggggggg.'
      ],
      [
        '............',
        '............',
        '..gggggggg..',
        '.gWWggggggg.',
        'gggggggggggg',
        'gEEggggggEEg',
        'gEEggggggEEg',
        'gggggggggggg',
        'gggggggggggg'
      ]
    ]
  },
  bat: {
    pal: { P: '#7a4fd0', B: '#3a2358', E: '#ff3b3b' },
    frames: [
      [
        'PP.........PP',
        'PPP.......PPP',
        '.PPPP...PPPP.',
        '..PPPBBBPPP..',
        '....BEBEB....',
        '....BBBBB....',
        '.....B.B.....'
      ],
      [
        '.............',
        '.............',
        '....BBBBB....',
        '..PPBEBEBPP..',
        '.PPPBBBBBPPP.',
        'PPP...B...PPP',
        'PP....B....PP'
      ]
    ]
  },
  eye: {
    pal: { R: '#a02323', W: '#e8dcc8', P: '#200000' },
    frames: [
      [
        '...RRRRR...',
        '.RRRRRRRRR.',
        'RRWWWWWWWRR',
        'RWWWWWWWWWR',
        'RWWWWPWWWWR',
        'RWWWWWWWWWR',
        'RRWWWWWWWRR',
        '.RRRRRRRRR.',
        '...RRRRR...'
      ],
      [
        '...RRRRR...',
        '.RRRRRRRRR.',
        'RRWWWWWWWRR',
        'RWWWWWWWWWR',
        'RWWWPWWWWWR',
        'RWWWWWWWWWR',
        'RRWWWWWWWRR',
        '.RRRRRRRRR.',
        '...RRRRR...'
      ]
    ]
  },
  mimic: {
    pal: { F: '#5c0a0a', M: '#e8dcc8', E: '#ff2200', D: '#1a0000', B: '#d4c5a0' },
    frames: [
      [
        '...FFFFFF...',
        '.FFFFFFFFFF.',
        'FFMMMMMMMMFF',
        'FMEEDDDDEEMF',
        'FMEEDDDDEEMF',
        'FBBBBBBBBBBF',
        'FDDDDDDDDDDF',
        '.FFFFFFFFFF.',
        '...FFFFFF...'
      ],
      [
        '...FFFFFF...',
        '.FFFFFFFFFF.',
        'FFMMMMMMMMFF',
        'FMDEEDDDDEEM',
        'FMDEEDDDDEEM',
        'FBBBBBBBBBBF',
        'FDDDDDDDDDDF',
        '.FFFFFFFFFF.',
        '...FFFFFF...'
      ]
    ]
  }
};
const teasers = [];
function initTeasers() {
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('canvas[data-foe]').forEach(cv => {
    const foe = FOES[cv.getAttribute('data-foe')];
    if (!foe) return;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    teasers.push({ cv, cx, foe });
  });
}
function drawTeasers(now) {
  for (const t of teasers) {
    const { cv, cx, foe } = t;
    const frame = foe.frames[Math.floor(now / 450) % foe.frames.length];
    const rows = frame.length;
    const cols = frame[0].length;
    const w = cols * FOE_PX;
    const h = rows * FOE_PX;
    const ox = Math.round((cv.width - w) / 2);
    const oy = Math.round(cv.height - h - 8 + Math.round(Math.sin(now / 400) * 1.2));
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.fillStyle = 'rgba(0,0,0,0.45)';
    cx.fillRect(ox + 8, cv.height - 8, w - 16, 4);
    for (let y = 0; y < rows; y++) {
      const row = frame[y];
      for (let x = 0; x < row.length; x++) {
        const c = foe.pal[row[x]];
        if (!c) continue;
        cx.fillStyle = c;
        cx.fillRect(ox + x * FOE_PX, oy + y * FOE_PX, FOE_PX, FOE_PX);
      }
    }
  }
}

const HOME_SETTINGS_KEY = 'vita_save';
const HOME_DIFFS = ['easy', 'normal', 'hard'];
const HOME_QUALS = ['hd', 'smooth', 'retro', 'chunky'];
const homeDefaults = {
  volume: 70,
  sfxVolume: 80,
  bgmVolume: 70,
  muted: false,
  brightness: 100,
  lang: 'en',
  difficulty: 'normal',
  quality: 'hd',
  deviceMode: 'ask',
  autoAim: true,
  haptic: true,
  screenShake: true,
  showMinimap: true,
  showFps: false,
  touchScale: 100,
  touchOpacity: 85
};
function sanitizeHomeSettings(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  let volume = Math.round(Number(s.volume));
  if (!Number.isFinite(volume)) volume = homeDefaults.volume;
  volume = Math.max(0, Math.min(100, volume));

  let sfxVolume = Math.round(Number(s.sfxVolume));
  if (!Number.isFinite(sfxVolume)) sfxVolume = homeDefaults.sfxVolume;
  sfxVolume = Math.max(0, Math.min(100, sfxVolume));

  let bgmVolume = Math.round(Number(s.bgmVolume));
  if (!Number.isFinite(bgmVolume)) bgmVolume = homeDefaults.bgmVolume;
  bgmVolume = Math.max(0, Math.min(100, bgmVolume));

  const muted = !!s.muted;

  let brightness = Math.round(Number(s.brightness));
  if (!Number.isFinite(brightness)) brightness = homeDefaults.brightness;
  brightness = Math.max(30, Math.min(180, brightness));

  const lang = s.lang === 'id' ? 'id' : 'en';
  const difficulty = HOME_DIFFS.includes(s.difficulty) ? s.difficulty : 'normal';
  const quality = HOME_QUALS.includes(s.quality) ? s.quality : 'retro';

  const deviceMode = (s.deviceMode === 'pc' || s.deviceMode === 'mobile' || s.deviceMode === 'ask') ? s.deviceMode : 'ask';
  const autoAim = (s.autoAim !== undefined) ? !!s.autoAim : true;
  const haptic = (s.haptic !== undefined) ? !!s.haptic : true;
  const screenShake = (s.screenShake !== undefined) ? !!s.screenShake : true;
  const showMinimap = (s.showMinimap !== undefined) ? !!s.showMinimap : true;
  const showFps = (s.showFps !== undefined) ? !!s.showFps : false;

  let touchScale = Math.round(Number(s.touchScale));
  if (!Number.isFinite(touchScale)) touchScale = homeDefaults.touchScale;
  touchScale = Math.max(70, Math.min(140, touchScale));

  let touchOpacity = Math.round(Number(s.touchOpacity));
  if (!Number.isFinite(touchOpacity)) touchOpacity = homeDefaults.touchOpacity;
  touchOpacity = Math.max(30, Math.min(100, touchOpacity));

  return {
    volume, sfxVolume, bgmVolume, muted,
    brightness, lang, difficulty, quality,
    deviceMode, autoAim, haptic, screenShake, showMinimap, showFps,
    touchScale, touchOpacity
  };
}
let homeSettings;
try {
  homeSettings = sanitizeHomeSettings(JSON.parse(localStorage.getItem(HOME_SETTINGS_KEY) || '{}'));
} catch (error) {
  homeSettings = Object.assign({}, homeDefaults);
  console.warn('Preferensi VITA tidak dapat dibaca, memakai nilai default.', error);
}
try { localStorage.setItem(HOME_SETTINGS_KEY, JSON.stringify(homeSettings)); } catch (e) {}
const settingsModal = document.getElementById('settingsModal');
const saveHomeSettings = () => { try { localStorage.setItem(HOME_SETTINGS_KEY, JSON.stringify(homeSettings)); } catch (e) {} };
const settingsOpenBtn = document.getElementById('settingsOpen');
if (settingsOpenBtn) settingsOpenBtn.addEventListener('click', openSettingsModal);
const controlsOpenBtn = document.getElementById('controlsOpen');
if (controlsOpenBtn) controlsOpenBtn.addEventListener('click', openControlsModal);
const settingsCloseBtn = document.getElementById('settingsClose');
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettingsModal);
if (settingsModal) {
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) closeSettingsModal();
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (typeof closeSidebar === 'function') closeSidebar();
    if (typeof closeProfileModal === 'function') closeProfileModal();
    if (typeof closeLeaderboardModal === 'function') closeLeaderboardModal();
    if (typeof closeSettingsModal === 'function') closeSettingsModal();
    if (typeof closeDatabaseModal === 'function') closeDatabaseModal();
    if (typeof closeAuthModal === 'function') closeAuthModal();
    const gm = document.getElementById('modal');
    if (gm) gm.classList.remove('open');
  }
});

/* Semua dialog memakai pola .modal-backdrop (plus .robot-memory-backdrop untuk */
(function initDialogA11y() {
  const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const hosts = Array.from(document.querySelectorAll('.modal-backdrop, .robot-memory-backdrop, #sidebarDrawer'));
  if (!hosts.length) return;
  let activeHost = null;
  let restoreTarget = null;
  let titleSeq = 0;

  const isVisible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const isOpen = el => el.classList.contains('open') || (el.style.display && el.style.display !== 'none');
  const dialogOf = host => host.querySelector('.modal, .modal-card') || host;

  function focusableWithin(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(isVisible);
  }

  function ensureSemantics(host) {
    const dlg = dialogOf(host);
    if (!dlg.hasAttribute('role')) dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
    if (!dlg.hasAttribute('aria-label') && !dlg.hasAttribute('aria-labelledby')) {
      const title = dlg.querySelector('h3, h2, [id$="Title"]');
      if (title) {
        if (!title.id) title.id = 'dlg-title-' + (++titleSeq);
        dlg.setAttribute('aria-labelledby', title.id);
      }
    }
    return dlg;
  }

  function onOpen(host) {
    if (activeHost === host) return;
    if (!activeHost) restoreTarget = document.activeElement;
    activeHost = host;
    const dlg = ensureSemantics(host);
    const target = focusableWithin(dlg)[0] || dlg;
    // Tunggu satu frame agar transisi/display selesai sebelum memindahkan fokus.
    // Batalkan bila dialog sudah ditutup/diganti sebelum frame berjalan.
    requestAnimationFrame(() => {
      if (activeHost !== host) return;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    });
  }

  function onClose(host) {
    if (activeHost !== host) return;
    activeHost = null;
    const back = restoreTarget;
    restoreTarget = null;
    if (back && back.isConnected && isVisible(back)) {
      requestAnimationFrame(() => {
        if (activeHost) return; // dialog lain sudah terbuka, jangan rebut fokus.
        try { back.focus({ preventScroll: true }); } catch (e) {}
      });
    }
  }

  const observer = new MutationObserver(records => {
    for (const rec of records) {
      const host = rec.target;
      // Anggap benar-benar terbuka hanya jika dialog tampak (parent tidak display:none).
      if (isOpen(host) && isVisible(host)) onOpen(host);
      else onClose(host);
    }
  });
  hosts.forEach(host => observer.observe(host, { attributes: true, attributeFilter: ['class', 'style'] }));

  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !activeHost) return;
    const dlg = dialogOf(activeHost);
    const items = focusableWithin(dlg);
    if (!items.length) { e.preventDefault(); dlg.focus(); return; }
    const idx = items.indexOf(document.activeElement);
    if (e.shiftKey) {
      if (idx <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
    } else if (idx === -1 || idx === items.length - 1) {
      e.preventDefault();
      items[0].focus();
    }
  });
})();

/* Kartu pilihan perangkat, pil mode, dan banner operatif adalah <div> agar */
(function initKeyboardButtonActivation() {
  const NATIVE = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1 };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target;
    if (!el || el.nodeType !== 1 || NATIVE[el.tagName]) return;
    if (el.getAttribute('role') !== 'button') return;
    e.preventDefault(); // Space menggulir halaman bila tidak dicegah
    el.click();
  });
})();

// ---- Sistem Profil Operatif & PP (Photo Profile) ----
const VITA_PROFILE_KEY = 'vita_profile';
const VITA_ACCOUNTS_KEY = 'vita_accounts';
const VITA_SAVED_CRED_KEY = 'vita_saved_cred';

function getSavedCredentials() {
  try {
    const raw = JSON.parse(localStorage.getItem(VITA_SAVED_CRED_KEY) || '{}');
    if (raw && typeof raw === 'object' && raw.username) return raw;
  } catch (e) {}
  const prof = getProfile();
  if (prof && prof.isLoggedIn && prof.name && prof.name !== 'GUEST-77') {
    return { username: prof.name, passcode: prof.savedPasscode || '', remember: true };
  }
  const accounts = getLocalAccounts();
  const names = Object.keys(accounts);
  if (names.length > 0) {
    const last = accounts[names[names.length - 1]];
    return { username: last.name, passcode: last.savedPasscode || '', remember: true };
  }
  return { username: '', passcode: '', remember: true };
}

function saveCredentials(username, passcode, remember = true) {
  if (!username) return;
  if (!remember) {
    try { localStorage.removeItem(VITA_SAVED_CRED_KEY); } catch (e) {}
    return;
  }
  try {
    localStorage.setItem(VITA_SAVED_CRED_KEY, JSON.stringify({
      username: String(username).trim(),
      passcode: String(passcode || ''),
      remember: true,
      updatedAt: new Date().toISOString()
    }));
  } catch (e) {}
}

function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btnEl) btnEl.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btnEl) btnEl.textContent = '👁️';
  }
}

function getLocalAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(VITA_ACCOUNTS_KEY) || '{}');
    if (raw && typeof raw === 'object') return raw;
  } catch (e) {}
  return {};
}

function saveLocalAccount(prof) {
  if (!prof || !prof.name || prof.name === 'GUEST-77' || prof.provider === 'guest') return;
  try {
    const accounts = getLocalAccounts();
    const key = prof.name.toLowerCase().trim();
    accounts[key] = {
      name: prof.name,
      role: prof.role || 'Field Operative',
      avatar: prof.avatar || '',
      presetEmoji: prof.presetEmoji || 'biohazard',
      passcode: prof.passcode || '',
      savedPasscode: prof.savedPasscode || (accounts[key] && accounts[key].savedPasscode) || '',
      provider: prof.provider || 'facility',
      status: prof.status || `${(prof.role || 'OPERATIVE').toUpperCase()} // REGISTERED`,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(VITA_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch (e) {}
}

function findLocalAccount(username) {
  if (!username) return null;
  const accounts = getLocalAccounts();
  return accounts[username.toLowerCase().trim()] || null;
}

function getProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(VITA_PROFILE_KEY) || '{}');
    if (raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name) {
      if (raw.avatar !== undefined && typeof raw.avatar !== 'string') raw.avatar = '';
      if (raw.presetEmoji !== undefined && typeof raw.presetEmoji !== 'string') raw.presetEmoji = 'biohazard';
      if (raw.role !== undefined && typeof raw.role !== 'string') raw.role = 'Field Operative';
      if (raw.provider !== undefined && typeof raw.provider !== 'string') raw.provider = 'guest';
      if (raw.status !== undefined && typeof raw.status !== 'string') raw.status = 'GUEST // LOCAL';
      return raw;
    }
  } catch (e) {}
  return {
    isLoggedIn: false,
    name: 'GUEST-77',
    role: 'Field Operative',
    avatar: '',
    presetEmoji: 'biohazard',
    provider: 'guest',
    status: 'GUEST // LOCAL'
  };
}

const PRESET_SVGS = {
  biohazard: '<svg class="avatar-svg" viewBox="0 0 24 24"><path d="M12 2a1 1 0 0 1 .86.5l1.6 2.76A7.5 7.5 0 0 1 18.5 7.9l2.76-1.6a1 1 0 0 1 1.37.37 1 1 0 0 1-.37 1.36l-2.76 1.6A7.5 7.5 0 0 1 20 12a7.5 7.5 0 0 1-.5 2.63l2.76 1.6a1 1 0 0 1 .37 1.36 1 1 0 0 1-1.37.37L18.5 16.36a7.5 7.5 0 0 1-4.04 2.64l-1.6 2.76A1 1 0 0 1 12 22a1 1 0 0 1-.86-.5l-1.6-2.76A7.5 7.5 0 0 1 5.5 16.36l-2.76 1.6a1 1 0 0 1-1.37-.37 1 1 0 0 1 .37-1.36l2.76-1.6A7.5 7.5 0 0 1 4 12a7.5 7.5 0 0 1 .5-2.63l-2.76-1.6a1 1 0 0 1-.37-1.36 1 1 0 0 1 1.37-.37L5.5 7.9a7.5 7.5 0 0 1 4.04-2.64l1.6-2.76A1 1 0 0 1 12 2zm0 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
  shield: '<svg class="avatar-svg" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
  dna: '<svg class="avatar-svg" viewBox="0 0 24 24"><path d="M4.5 3a1 1 0 0 0-.7.3 1 1 0 0 0 0 1.4l1.6 1.6A9 9 0 0 0 4 11a9 9 0 0 0 2.6 6.4L5 19a1 1 0 1 0 1.4 1.4l1.6-1.6A9 9 0 0 0 13 20a9 9 0 0 0 6.4-2.6l1.6 1.6a1 1 0 0 0 1.4-1.4l-1.6-1.6A9 9 0 0 0 22 11a9 9 0 0 0-2.6-6.4L21 3a1 1 0 1 0-1.4-1.4l-1.6 1.6A9 9 0 0 0 13 2a9 9 0 0 0-6.4 2.6L5 3a1 1 0 0 0-.5 0zm7.5 2a7 7 0 0 1 4.9 2.1l-1.4 1.4a5 5 0 0 0-7 0L7.1 7.1A7 7 0 0 1 12 5zm-3.5 4.9a3 3 0 0 1 4.2 0 3 3 0 0 1 0 4.2l-1.4 1.4a5 5 0 0 0-7 0l-1.4-1.4a7 7 0 0 1 5.6-4.2zm7 0a7 7 0 0 1 2.1 4.9 7 7 0 0 1-2.1 4.9l-1.4-1.4a5 5 0 0 0 0-7l1.4-1.4z"/></svg>',
  eye: '<svg class="avatar-svg" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
  carnis: '<svg class="avatar-svg" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
  cyber: '<svg class="avatar-svg" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 1-2 0v-1.07A8 8 0 0 1 4.07 13H5a1 1 0 0 1 0-2h-.93A8 8 0 0 1 11 4.07V5a1 1 0 0 1 2 0v-.93A8 8 0 0 1 19.93 11H19a1 1 0 0 1 0 2h.93A8 8 0 0 1 13 19.93zM12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4z"/></svg>'
};

function getPresetSvgMarkup(key) {
  const map = {
    '☣️': 'biohazard',
    '🛡️': 'shield',
    '🧬': 'dna',
    '👁️': 'eye',
    '🩸': 'carnis',
    '🦾': 'cyber'
  };
  const normKey = map[key] || key || 'biohazard';
  return PRESET_SVGS[normKey] || PRESET_SVGS.biohazard;
}

function setProfile(p) {
  try { localStorage.setItem(VITA_PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
  if (p && p.isLoggedIn && p.provider !== 'guest') {
    saveLocalAccount(p);
  }
  applyProfileUI();
  if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof syncProfileToSupabase === 'function') {
    syncProfileToSupabase(p).catch(() => {});
  }
}

function processAvatarFile(file, callback) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    alert('Please select an image file (JPG, PNG, WEBP).');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      // Auto-compress & crop square 128x128
      const targetDim = 128;
      const canvas = document.createElement('canvas');
      canvas.width = targetDim;
      canvas.height = targetDim;
      const ctx = canvas.getContext('2d');
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, targetDim, targetDim);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const approxKb = Math.round((dataUrl.length * 0.75) / 1024);
      callback(dataUrl, approxKb);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function getCurrentCallsign() {
  const uInput = document.getElementById('profileUsernameInput');
  const mUInput = document.getElementById('modalUsernameInput');
  const uVal = uInput ? uInput.value.trim() : '';
  const mVal = mUInput ? mUInput.value.trim() : '';
  if (uVal) return uVal;
  if (mVal) return mVal;
  const prof = getProfile();
  return (prof && prof.name) ? prof.name : 'OPERATIVE-CARNIS';
}

let saveIndicatorTimer = null;
function showSaveIndicator(msg = 'Profile Saved') {
  const btn = document.getElementById('btnSaveProfile');
  const mBtn = document.getElementById('modalSaveProfileBtn');
  const autoTag = document.getElementById('autoSaveIndicator');
  const modalTag = document.getElementById('modalAutoSaveIndicator');

  if (autoTag) {
    autoTag.textContent = `● ${msg} ✓`;
    autoTag.style.color = '#4ade80';
  }
  if (modalTag) {
    modalTag.textContent = `● ${msg} ✓`;
    modalTag.style.color = '#4ade80';
  }

  if (btn) {
    if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" style="fill:#fff"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg> <span>${msg} ✓</span>`;
    btn.classList.add('save-success');
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => {
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
      btn.classList.remove('save-success');
    }, 2200);
  }

  if (mBtn) {
    if (!mBtn.dataset.origHtml) mBtn.dataset.origHtml = mBtn.innerHTML;
    mBtn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" style="fill:#fff"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg> <span>${msg} ✓</span>`;
    mBtn.classList.add('save-success');
    setTimeout(() => {
      if (mBtn.dataset.origHtml) mBtn.innerHTML = mBtn.dataset.origHtml;
      mBtn.classList.remove('save-success');
    }, 2200);
  }
}

// ---- Prosedural WebAudio UI Feedback ----
let homeAudioCtx = null;
function getHomeAudioCtx() {
  if (typeof audioCtx !== 'undefined' && audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  if (!homeAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) homeAudioCtx = new AudioContextClass();
  }
  if (homeAudioCtx && homeAudioCtx.state === 'suspended') {
    homeAudioCtx.resume().catch(() => {});
  }
  return homeAudioCtx;
}

function homeBeep(type) {
  try {
    if (typeof sCinematicUI === 'function') {
      sCinematicUI(type);
      return;
    }
    const v = Number(homeSettings && homeSettings.volume);
    const volMul = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0.7;
    if (volMul <= 0.01) return;

    const ac = getHomeAudioCtx();
    if (!ac) return;
    const now = ac.currentTime;

    if (type === 'click') {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const flt = ac.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.045);
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(1400, now);
      gain.gain.setValueAtTime(0.45 * volMul, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(flt); flt.connect(gain); gain.connect(ac.destination);
      osc.start(now); osc.stop(now + 0.05);
    } else if (type === 'open') {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const flt = ac.createBiquadFilter();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.14);
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.4 * volMul, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(flt); flt.connect(gain); gain.connect(ac.destination);
      osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'close') {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
      gain.gain.setValueAtTime(0.4 * volMul, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'save') {
      [260, 520].forEach((f, idx) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.06);
        gain.gain.setValueAtTime(0.35 * volMul, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.25);
        osc.connect(gain); gain.connect(ac.destination);
        osc.start(now + idx * 0.06); osc.stop(now + idx * 0.06 + 0.25);
      });
    } else if (type === 'denied') {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const flt = ac.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.16);
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(380, now);
      gain.gain.setValueAtTime(0.6 * volMul, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(flt); flt.connect(gain); gain.connect(ac.destination);
      osc.start(now); osc.stop(now + 0.16);
    }
  } catch (_) {}
}

function highlightActivePresetAvatar(key) {
  const normKey = key || 'biohazard';
  document.querySelectorAll('.btn-preset-avatar').forEach(btn => {
    const onclickAttr = btn.getAttribute('onclick') || '';
    if (onclickAttr.includes(`'${normKey}'`)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function selectPresetAvatar(emoji) {
  const prof = getProfile();
  prof.name = getCurrentCallsign();
  prof.avatar = '';
  prof.presetEmoji = emoji;
  prof.isLoggedIn = true;
  if (!prof.provider || prof.provider === 'guest') prof.provider = 'custom';
  prof.status = `${(prof.role || 'OPERATIVE').toUpperCase()} // ACTIVE`;
  setProfile(prof);
  showSaveIndicator('Division Insignia Saved');
  highlightActivePresetAvatar(emoji);
  homeBeep('click');
}

// ---- Navigasi Sidebar Drawer & Modals ----
function openSidebar() {
  const sb = document.getElementById('sidebarDrawer');
  const bd = document.getElementById('sidebarBackdrop');
  if (sb) sb.classList.add('open');
  if (bd) bd.classList.add('open');
  homeBeep('open');
}

function closeSidebar() {
  const sb = document.getElementById('sidebarDrawer');
  const bd = document.getElementById('sidebarBackdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('open');
  homeBeep('close');
}

function openProfileModal() {
  closeSidebar();
  const m = document.getElementById('profileModal');
  if (m) m.classList.add('open');
  applyProfileUI();
  homeBeep('open');
}

function closeProfileModal() {
  const m = document.getElementById('profileModal');
  if (m) m.classList.remove('open');
  homeBeep('close');
}

function openLeaderboardModal() {
  closeSidebar();
  const m = document.getElementById('leaderboardModal');
  if (m) m.classList.add('open');
  renderLeaderboard();
  homeBeep('open');
}

function closeLeaderboardModal() {
  const m = document.getElementById('leaderboardModal');
  if (m) m.classList.remove('open');
  homeBeep('close');
}

function openSettingsModal() {
  closeSidebar();
  try { homeSettings = sanitizeHomeSettings(JSON.parse(localStorage.getItem(HOME_SETTINGS_KEY) || '{}')); } catch (e) {}
  const vEl = document.getElementById('homeVolume');
  const bEl = document.getElementById('homeBrightness');
  const lEl = document.getElementById('homeLanguage');
  const dEl = document.getElementById('homeDifficulty');
  const qEl = document.getElementById('homeQuality');
  if (vEl) vEl.value = Math.max(0, Math.min(100, Math.round(Number(homeSettings.volume) || 70)));
  if (bEl) bEl.value = Math.max(30, Math.min(180, Math.round(Number(homeSettings.brightness) || 100)));
  const vVal = document.getElementById('homeVolumeVal');
  if (vVal) vVal.textContent = (vEl ? vEl.value : '70') + '%';
  const bVal = document.getElementById('homeBrightnessVal');
  if (bVal) bVal.textContent = (bEl ? bEl.value : '100') + '%';

  const sfxEl = document.getElementById('homeSfx');
  const sfxVal = document.getElementById('homeSfxVal');
  if (sfxEl) { sfxEl.value = homeSettings.sfxVolume ?? 80; if (sfxVal) sfxVal.textContent = sfxEl.value + '%'; }
  const bgmEl = document.getElementById('homeBgm');
  const bgmVal = document.getElementById('homeBgmVal');
  if (bgmEl) { bgmEl.value = homeSettings.bgmVolume ?? 70; if (bgmVal) bgmVal.textContent = bgmEl.value + '%'; }
  const muteEl = document.getElementById('homeMuted');
  if (muteEl) muteEl.checked = !!homeSettings.muted;

  const devEl = document.getElementById('homeDeviceMode');
  if (devEl) devEl.value = homeSettings.deviceMode || 'ask';
  const aimEl = document.getElementById('homeAutoAim');
  if (aimEl) aimEl.checked = homeSettings.autoAim !== false;
  const hapEl = document.getElementById('homeHaptic');
  if (hapEl) hapEl.checked = homeSettings.haptic !== false;

  const tsEl = document.getElementById('homeTouchScale');
  const tsVal = document.getElementById('homeTouchScaleVal');
  if (tsEl) { tsEl.value = homeSettings.touchScale || 100; if (tsVal) tsVal.textContent = tsEl.value + '%'; }
  const toEl = document.getElementById('homeTouchOpacity');
  const toVal = document.getElementById('homeTouchOpacityVal');
  if (toEl) { toEl.value = homeSettings.touchOpacity || 85; if (toVal) toVal.textContent = toEl.value + '%'; }

  const shakeEl = document.getElementById('homeScreenShake');
  if (shakeEl) shakeEl.checked = homeSettings.screenShake !== false;
  const mmEl = document.getElementById('homeMinimap');
  if (mmEl) mmEl.checked = homeSettings.showMinimap !== false;
  const fpsEl = document.getElementById('homeShowFps');
  if (fpsEl) fpsEl.checked = !!homeSettings.showFps;

  if (lEl) lEl.value = homeSettings.lang === 'en' ? 'en' : 'id';
  if (dEl) dEl.value = HOME_DIFFS.includes(homeSettings.difficulty) ? homeSettings.difficulty : 'normal';
  if (qEl) qEl.value = HOME_QUALS.includes(homeSettings.quality) ? homeSettings.quality : 'hd';

  const m = document.getElementById('settingsModal');
  if (m) m.classList.add('open');
  homeBeep('open');
}

function closeSettingsModal() {
  const m = document.getElementById('settingsModal');
  if (m) m.classList.remove('open');
  homeBeep('close');
}

function openControlsModal() {
  closeSidebar();
  openModal('Field Protocol', 'Maneuver your operative with WASD or Arrow Keys. Collect data chips and biomass artifacts, evade anomalies, and reach the green Sector Goal.', 'WASD / Arrows / Virtual Joystick', 'Press ESC to pause mission.');
  homeBeep('open');
}

function openDatabaseModal() {
  closeSidebar();
  const m = document.getElementById('databaseModal');
  if (m) m.classList.add('open');
  applyProfileUI();
  homeBeep('open');
}

function closeDatabaseModal() {
  const m = document.getElementById('databaseModal');
  if (m) m.classList.remove('open');
  homeBeep('close');
}

function openDesktopModal() {
  // v2.0: Desktop Pygame edition retired (Web-only). Redirect legacy callers to Field Manual.
  if (typeof openControlsModal === 'function') openControlsModal();
  else if (typeof openModal === 'function') openModal('VITA — Web Edition', 'Desktop edition retired in v2.0. Play instantly in browser.', '', '');
}

// Kompatibilitas switchDashTab jika terpanggil
function switchDashTab(tabId) {
  if (tabId === 'profile') openProfileModal();
  else if (tabId === 'leaderboard') openLeaderboardModal();
  else if (tabId === 'settings') openSettingsModal();
  else if (tabId === 'guide') openControlsModal();
  else if (tabId === 'database') openDatabaseModal();
  else if (tabId === 'play') playWebGame();
}
function initDashTab() {}

// ---- Mode Pergantian Modal Auth (Login vs Register) ----
function switchAuthMode(mode) {
  const isReg = mode === 'register';
  const loginSec = document.getElementById('authLoginSection');
  const regSec = document.getElementById('authRegisterSection');
  const tabLoginBtn = document.getElementById('authTabLoginBtn');
  const tabRegBtn = document.getElementById('authTabRegisterBtn');

  if (loginSec) loginSec.style.display = isReg ? 'none' : 'block';
  if (regSec) regSec.style.display = isReg ? 'block' : 'none';

  if (tabLoginBtn) {
    if (!isReg) tabLoginBtn.classList.add('active');
    else tabLoginBtn.classList.remove('active');
  }
  if (tabRegBtn) {
    if (isReg) tabRegBtn.classList.add('active');
    else tabRegBtn.classList.remove('active');
  }

  // Mempertahankan input sandi pengguna
  homeBeep('click');
}

function showAuthForms(force = false) {
  const banner = document.getElementById('authActiveUserBanner');
  const forms = document.getElementById('authFormsContainer');
  if (banner && forms) {
    if (force) {
      banner.style.display = 'none';
      forms.style.display = 'block';
      switchAuthMode('login');
      const lCall = document.getElementById('loginCallsignInput');
      const lPass = document.getElementById('loginPasscodeInput');
      const cred = getSavedCredentials();
      if (lCall && cred.username) lCall.value = cred.username;
      if (lPass && cred.passcode) lPass.value = cred.passcode;
    } else {
      const prof = getProfile();
      const isUserLoggedIn = prof && prof.isLoggedIn && prof.name && prof.name !== 'GUEST-77' && prof.provider !== 'guest';
      banner.style.display = isUserLoggedIn ? 'block' : 'none';
      forms.style.display = isUserLoggedIn ? 'none' : 'block';
    }
  }
}

function openAuthModal(mode = 'login') {
  const am = document.getElementById('authModal');
  if (am) {
    am.classList.add('open');
    const prof = getProfile();
    const isUserLoggedIn = prof && prof.isLoggedIn && prof.name && prof.name !== 'GUEST-77' && prof.provider !== 'guest';

    const banner = document.getElementById('authActiveUserBanner');
    const forms = document.getElementById('authFormsContainer');
    const activeCallsign = document.getElementById('authActiveCallsignText');
    const activeRole = document.getElementById('authActiveRoleText');
    const activeBadge = document.getElementById('authActiveStatusBadge');

    if (banner && forms) {
      if (isUserLoggedIn && mode !== 'force-forms') {
        banner.style.display = 'block';
        forms.style.display = 'none';
        if (activeCallsign) activeCallsign.textContent = prof.name;
        if (activeRole) activeRole.textContent = prof.role || 'Field Operative';
        if (activeBadge) activeBadge.textContent = prof.status ? prof.status.split('//')[0].trim() : 'TERVERIFIKASI';
      } else {
        banner.style.display = 'none';
        forms.style.display = 'block';
      }
    }

    switchAuthMode(mode === 'register' ? 'register' : 'login');

    const lCall = document.getElementById('loginCallsignInput');
    const mCall = document.getElementById('modalUsernameInput');
    const lPass = document.getElementById('loginPasscodeInput');
    const mPass = document.getElementById('modalPasscodeInput');
    const cred = getSavedCredentials();

    if (mode === 'login' || mode === 'force-forms') {
      if (lCall) {
        lCall.value = cred.username || (isUserLoggedIn ? prof.name : '');
      }
      if (lPass && cred.passcode) {
        lPass.value = cred.passcode;
      }
      const chk = document.getElementById('authRememberCheckbox');
      if (chk) chk.checked = cred.remember !== false;
      if (lCall && !lCall.value) setTimeout(() => lCall.focus(), 150);
      else if (lPass) setTimeout(() => lPass.focus(), 150);
    } else if (mode === 'register') {
      if (mCall && !mCall.value) {
        mCall.value = '';
        setTimeout(() => mCall.focus(), 150);
      }
      if (mPass && !mPass.value) mPass.value = '';
    }

    homeBeep('open');
  }
}

function closeAuthModal() {
  const am = document.getElementById('authModal');
  if (am) am.classList.remove('open');
  homeBeep('close');
}

// Operatif Login
async function handlePerformLogin() {
  const uInput = document.getElementById('loginCallsignInput');
  const pInput = document.getElementById('loginPasscodeInput');
  const btnLogin = document.getElementById('btnPerformLogin');
  const username = (uInput ? uInput.value : '').trim();
  const passcode = (pInput ? pInput.value : '').trim();

  if (!username) {
    homeBeep('denied');
    alert('[LOGIN FAILED]\nPlease enter your Operative Callsign / Handle.');
    if (uInput) uInput.focus();
    return;
  }

  const originalBtnHtml = btnLogin ? btnLogin.innerHTML : '';
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.innerHTML = '<span>Authenticating Identity...</span>';
  }

  const resetBtn = () => {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.innerHTML = originalBtnHtml;
    }
  };

  try {
    // 1. Cek profil di Supabase Cloud jika terhubung & online
    if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof fetchOperativeByCallsign === 'function') {
      try {
        const remote = await fetchOperativeByCallsign(username);
        if (remote) {
          const passOk = (typeof comparePasscode === 'function')
            ? await comparePasscode(passcode, remote.passcode, username)
            : (remote.passcode === passcode);

          if (remote.passcode && (!passcode || !passOk)) {
            resetBtn();
            homeBeep('denied');
            alert('[ACCESS DENIED]\nSecurity passcode does not match operative "' + username + '".');
            if (pInput) { pInput.value = ''; pInput.focus(); }
            return;
          }

          let syncRes = null;
          if (typeof syncAccountDataFromCloud === 'function') {
            syncRes = syncAccountDataFromCloud(remote);
          } else {
            const prof = {
              isLoggedIn: true,
              name: remote.username,
              role: remote.role || 'Field Operative',
              avatar: remote.avatar || '',
              presetEmoji: remote.preset_emoji || 'biohazard',
              passcode: remote.passcode || passcode,
              provider: remote.provider || 'facility',
              status: `${(remote.role || 'OPERATIVE').toUpperCase()} // CLOUD VERIFIED`
            };
            setProfile(prof);
            syncRes = { prof, high: { highestLevel: 1 } };
          }

          const remChk = document.getElementById('authRememberCheckbox');
          const shouldRemember = !remChk || remChk.checked;
          saveCredentials(username, passcode, shouldRemember);
          if (syncRes && syncRes.prof) {
            syncRes.prof.savedPasscode = passcode;
            saveLocalAccount(syncRes.prof);
          }
          resetBtn();
          closeAuthModal();
          homeBeep('save');
          const finalProf = (syncRes && syncRes.prof) || { name: remote.username };
          const finalHigh = (syncRes && syncRes.high) || { highestLevel: 1 };
          alert('[CLOUD AUTHORIZATION GRANTED]\nWelcome back, Operative ' + finalProf.name + '!\nProfile, Avatar, and Sector Progress (CH ' + finalHigh.highestLevel + '/15) fully synced from facility database.');
          return;
        }
      } catch (err) {
        console.warn('Pengecekan cloud gagal saat login:', err);
      }
    }

    // 2. Cek akun lokal tersimpan (Offline / Local Database Cache)
    const localAcc = findLocalAccount(username);
    const activeProf = getProfile();
    const targetProf = localAcc || ((activeProf && activeProf.name && activeProf.name.toLowerCase() === username.toLowerCase()) ? activeProf : null);

    if (targetProf && targetProf.name) {
      const localPassOk = (typeof comparePasscode === 'function')
        ? await comparePasscode(passcode, targetProf.passcode, username)
        : (targetProf.passcode === passcode);

      if (targetProf.passcode && (!passcode || !localPassOk)) {
        resetBtn();
        homeBeep('denied');
        alert('[ACCESS DENIED]\nSecurity passcode does not match local account "' + targetProf.name + '".');
        if (pInput) { pInput.value = ''; pInput.focus(); }
        return;
      }

      const remChk = document.getElementById('authRememberCheckbox');
      const shouldRemember = !remChk || remChk.checked;
      saveCredentials(username, passcode, shouldRemember);

      const prof = {
        ...targetProf,
        isLoggedIn: true,
        passcode: targetProf.passcode || passcode,
        savedPasscode: passcode,
        status: `${(targetProf.role || 'OPERATIVE').toUpperCase()} // LOCAL VERIFIED`
      };

      setProfile(prof);
      saveLocalAccount(prof);
      resetBtn();
      closeAuthModal();
      homeBeep('save');
      alert('[LOCAL AUTHORIZATION GRANTED]\nWelcome back to facility terminal, Operative ' + prof.name + '!');
      return;
    }

    // 3. Akun tidak ditemukan sama sekali di server maupun lokal
    resetBtn();
    homeBeep('denied');
    const goToReg = confirm('[CALLSIGN NOT FOUND]\n"' + username + '" is not registered in facility records.\n\nWould you like to register this Callsign now?');
    if (goToReg) {
      switchAuthMode('register');
      const regInput = document.getElementById('modalUsernameInput');
      if (regInput) {
        regInput.value = username;
        const regPass = document.getElementById('modalPasscodeInput');
        if (regPass) setTimeout(() => regPass.focus(), 100);
      }
    } else if (uInput) {
      uInput.focus();
    }
  } catch (e) {
    resetBtn();
    console.error('Error saat login:', e);
    alert('An error occurred during authentication: ' + e.message);
  }
}

// Operatif Registrasi Baru
async function handleModalRegisterProfile() {
  const uInput = document.getElementById('modalUsernameInput');
  const pInput = document.getElementById('modalPasscodeInput');
  const rSelect = document.getElementById('modalRoleSelect');
  const btnReg = document.getElementById('modalSaveProfileBtn');

  const username = (uInput ? uInput.value : '').trim();
  const passcode = (pInput ? pInput.value : '').trim();
  const role = (rSelect ? rSelect.value : 'Field Operative');

  if (!username) {
    homeBeep('denied');
    alert('[REGISTRATION FAILED]\nPlease enter an Operative Callsign / Handle.');
    if (uInput) uInput.focus();
    return;
  }

  if (username.length < 3 || username.length > 24) {
    homeBeep('denied');
    alert('[REGISTRATION FAILED]\nCallsign length must be between 3 and 24 characters.');
    if (uInput) uInput.focus();
    return;
  }

  if (!/^[a-zA-Z0-9_\-\.\s]+$/.test(username)) {
    homeBeep('denied');
    alert('[REGISTRATION FAILED]\nCallsign may only contain letters, numbers, spaces, dots, dashes (-), or underscores (_).');
    if (uInput) uInput.focus();
    return;
  }

  if (!passcode || passcode.length < 4) {
    homeBeep('denied');
    alert('[REGISTRATION FAILED]\nSecurity passcode must be at least 4 characters/digits.');
    if (pInput) pInput.focus();
    return;
  }

  const originalBtnHtml = btnReg ? btnReg.innerHTML : '';
  if (btnReg) {
    btnReg.disabled = true;
    btnReg.innerHTML = '<span>Checking Callsign Availability...</span>';
  }

  const resetRegBtn = () => {
    if (btnReg) {
      btnReg.disabled = false;
      btnReg.innerHTML = originalBtnHtml;
    }
  };

  try {
    // 1. Cek apakah username sudah ada di akun lokal
    const localExists = findLocalAccount(username);
    if (localExists) {
      resetRegBtn();
      homeBeep('denied');
      alert('[REGISTRATION REJECTED]\nCallsign "' + username + '" is already registered on this device.\nPlease log in via the "OPERATIVE LOGIN" tab.');
      switchAuthMode('login');
      const lCall = document.getElementById('loginCallsignInput');
      if (lCall) lCall.value = username;
      return;
    }

    // 2. Cek apakah username sudah dipakai di Supabase Cloud
    if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof fetchOperativeByCallsign === 'function') {
      try {
        const remoteExists = await fetchOperativeByCallsign(username);
        if (remoteExists) {
          resetRegBtn();
          homeBeep('denied');
          alert('[REGISTRATION REJECTED]\nCallsign "' + username + '" is already registered in the facility database.\nPlease choose another Callsign or log in.');
          if (uInput) uInput.focus();
          return;
        }
      } catch (err) {
        console.warn('Pengecekan duplikasi di server gagal, lanjut pendaftaran lokal:', err);
      }
    }

    // 3. Simpan identitas baru
    if (btnReg) btnReg.innerHTML = '<span>Registering to Facility...</span>';

    const curProf = getProfile();
    const hashedPasscode = (typeof hashPasscode === 'function')
      ? await hashPasscode(username, passcode)
      : passcode;

    const newProf = {
      isLoggedIn: true,
      name: username,
      role: role,
      avatar: curProf.avatar || '',
      presetEmoji: curProf.presetEmoji || 'biohazard',
      passcode: hashedPasscode,
      provider: 'facility',
      status: `${role.toUpperCase()} // OFFICIAL ROSTER`
    };

    const remChk = document.getElementById('authRegRememberCheckbox');
    const shouldRemember = !remChk || remChk.checked;
    saveCredentials(username, passcode, shouldRemember);
    newProf.savedPasscode = passcode;
    saveLocalAccount(newProf);

    setProfile(newProf);
    if (typeof syncProfileToSupabase === 'function' && typeof isSupabaseConfigured === 'function' && isSupabaseConfigured()) {
      try {
        await syncProfileToSupabase(newProf);
      } catch (syncErr) {
        console.warn('Sync registrasi ke Supabase:', syncErr);
      }
    }
    resetRegBtn();
    closeAuthModal();
    homeBeep('save');
    showSaveIndicator('Operative Registered');
    alert('[REGISTRATION SUCCESSFUL]\nOperative Dossier "' + username + '" recorded in the facility database!\nDivision: ' + role + '\nCredentials and clearance secured.');
  } catch (e) {
    resetRegBtn();
    console.error('Error saat registrasi:', e);
    alert('An error occurred during registration: ' + e.message);
  }
}

// Akses Tamu Cepat
function handleQuickGuest() {
  const guestCode = Math.floor(100 + Math.random() * 900);
  const guestProf = {
    isLoggedIn: true,
    name: 'GUEST-' + guestCode,
    role: 'Field Operative',
    avatar: '',
    presetEmoji: 'biohazard',
    passcode: '',
    provider: 'guest',
    status: 'GUEST // LOCAL'
  };
  setProfile(guestProf);
  closeAuthModal();
  homeBeep('click');
  showSaveIndicator('Guest Mode Active');
}

function handleSaveFullProfile() {
  const uInput = document.getElementById('profileUsernameInput');
  const pInput = document.getElementById('profilePasscodeInput');
  const rInput = document.getElementById('profileRoleInput');
  const name = (uInput && uInput.value.trim()) || getCurrentCallsign() || 'OPERATIVE-CARNIS';
  const role = (rInput && rInput.value) || 'Field Operative';
  const passcode = (pInput && pInput.value) ? pInput.value.trim() : '';

  const prof = getProfile();
  prof.isLoggedIn = true;
  prof.name = name;
  prof.role = role;
  if (passcode) prof.passcode = passcode;
  prof.status = `${role.toUpperCase()} // VERIFIED`;
  if (!prof.provider || prof.provider === 'guest') prof.provider = 'facility';
  setProfile(prof);
  homeBeep('save');
  showSaveIndicator('Profile Saved Successfully');
}

async function handleManualCloudSync() {
  const prof = getProfile();
  if (!prof || !prof.isLoggedIn || prof.provider === 'guest' || prof.name === 'GUEST-77') {
    homeBeep('denied');
    alert('[SINKRONISASI DIBATALKAN]\nAnda saat ini dalam mode Tamu (Guest).\nSilakan LOGIN atau DAFTAR AKUN terlebih dahulu untuk mengamankan data ke database Supabase.');
    openAuthModal('login');
    return;
  }

  homeBeep('click');
  const syncBtn = document.getElementById('btnManualCloudSync');
  const origHtml = syncBtn ? syncBtn.innerHTML : '';
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span>Mengunggah ke Cloud...</span>';
  }

  try {
    if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured()) {
      if (typeof syncProfileToSupabase === 'function') {
        await syncProfileToSupabase(prof);
      }
      if (typeof fetchOperativeByCallsign === 'function') {
        const remote = await fetchOperativeByCallsign(prof.name);
        if (remote && typeof syncAccountDataFromCloud === 'function') {
          syncAccountDataFromCloud(remote);
        }
      }
      homeBeep('save');
      showSaveIndicator('Cloud Synced');
      alert(`[SINKRONISASI DATABASE BERHASIL]\nAkun Operatif: ${prof.name}\nFoto Profil (PP), kredensial, senjata yang didapat, dan pencapaian level telah disinkronkan sempurna dengan Supabase.`);
    } else {
      homeBeep('denied');
      alert('[UPLINK OFFLINE]\nKoneksi fasilitas belum terhubung.');
    }
  } catch (err) {
    homeBeep('denied');
    console.error('Gagal sinkron manual:', err);
    alert('Gagal sinkronisasi: ' + err.message);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = origHtml;
    }
  }
}

function handleLogout() {
  const defaultGuest = {
    isLoggedIn: false,
    name: 'GUEST-77',
    role: 'Field Operative',
    avatar: '',
    presetEmoji: 'biohazard',
    passcode: '',
    provider: 'guest',
    status: 'GUEST // LOCAL'
  };
  try { localStorage.setItem(VITA_PROFILE_KEY, JSON.stringify(defaultGuest)); } catch (e) {}
  applyProfileUI();
  showAuthForms(false);
  closeAuthModal();
  homeBeep('click');
  showSaveIndicator('Sesi Ditutup / Logout');
  alert('Operatif berhasil keluar (Logged out).\nSesi kembali ke mode Tamu (Guest).\nNama & sandi akun Anda tetap aman tersimpan di perangkat.');
}

function applyProfileUI() {
  const prof = getProfile();

  // Sidebar Mini User Card elements
  const sbName = document.getElementById('sidebarUserName');
  const sbRole = document.getElementById('sidebarUserRole');
  const sbStatus = document.getElementById('sidebarUserStatus');
  const sbAvatarImg = document.getElementById('sidebarAvatarImg');
  const sbAvatarDef = document.getElementById('sidebarAvatarDef');

  // Compatibility header elements
  const bar = document.getElementById('operativeBadgeBar');
  const btnOpen = document.getElementById('loginModalOpen');
  const nameEl = document.getElementById('operativeName');
  const statusEl = document.getElementById('operativeStatus');
  const avatarEl = document.getElementById('operativeAvatar');
  const defAvatar = document.getElementById('operativeAvatarDefault');

  // Start screen elements (in gameView)
  const startIcon = document.getElementById('startOperativeIcon');
  const startText = document.getElementById('startOperativeText');
  const startBadge = document.getElementById('startOperativeBadge');
  const btnStartAuth = document.getElementById('btnStartAuth');

  // Hub Profile Card elements
  const pBadge = document.getElementById('portalBadge');
  const pClearance = document.getElementById('portalClearance');
  const ppPreviewImg = document.getElementById('ppPreviewImg');
  const ppPreviewDef = document.getElementById('ppPreviewDef');
  const uInput = document.getElementById('profileUsernameInput');
  const passInput = document.getElementById('profilePasscodeInput');
  const rInput = document.getElementById('profileRoleInput');
  const pBestTime = document.getElementById('profileBestTime');
  const pTotalKills = document.getElementById('profileTotalKills');
  const pDbStatus = document.getElementById('profileDbStatus');

  // Modal elements
  const mPpImg = document.getElementById('modalPpImg');
  const mPpDef = document.getElementById('modalPpDef');
  const mUInput = document.getElementById('modalUsernameInput');
  const mPassInput = document.getElementById('modalPasscodeInput');

  // Render Avatar (custom photo vs preset emoji)
  const hasCustomPhoto = isAvatarSafeUrl(prof.avatar) && prof.avatar.trim().toLowerCase().startsWith('data:image');
  const currentEmoji = (typeof prof.presetEmoji === 'string' && prof.presetEmoji) ? prof.presetEmoji : 'biohazard';

  // 1. Sidebar Avatar
  if (sbAvatarImg && sbAvatarDef) {
    if (hasCustomPhoto) {
      sbAvatarImg.src = prof.avatar;
      sbAvatarImg.style.display = 'block';
      sbAvatarDef.style.display = 'none';
    } else {
      sbAvatarImg.style.display = 'none';
      sbAvatarDef.style.display = 'flex';
      sbAvatarDef.innerHTML = getPresetSvgMarkup(currentEmoji);
    }
  }

  // 2. Hub Profile Dossier Avatar
  if (ppPreviewImg && ppPreviewDef) {
    if (hasCustomPhoto) {
      ppPreviewImg.src = prof.avatar;
      ppPreviewImg.style.display = 'block';
      ppPreviewDef.style.display = 'none';
    } else {
      ppPreviewImg.style.display = 'none';
      ppPreviewDef.style.display = 'flex';
      ppPreviewDef.innerHTML = getPresetSvgMarkup(currentEmoji);
    }
  }

  // 3. Modal Avatar
  if (mPpImg && mPpDef) {
    if (hasCustomPhoto) {
      mPpImg.src = prof.avatar;
      mPpImg.style.display = 'block';
      mPpDef.style.display = 'none';
    } else {
      mPpImg.style.display = 'none';
      mPpDef.style.display = 'flex';
      mPpDef.innerHTML = getPresetSvgMarkup(currentEmoji);
    }
  }

  // 4. Header Badge Avatar (Compat)
  if (avatarEl && defAvatar) {
    if (hasCustomPhoto) {
      avatarEl.src = prof.avatar;
      avatarEl.style.display = 'block';
      defAvatar.style.display = 'none';
    } else {
      avatarEl.style.display = 'none';
      defAvatar.style.display = 'flex';
      defAvatar.innerHTML = getPresetSvgMarkup(currentEmoji);
    }
  }

  // Set Sidebar Text
  if (sbName) sbName.textContent = prof.name || 'GUEST-77';
  if (sbRole) sbRole.textContent = prof.role || 'Field Operative';
  if (sbStatus) sbStatus.textContent = prof.isLoggedIn ? (prof.status || 'OPERATIVE // ACTIVE') : 'GUEST // LOCAL';

  // Inputs
  const currentName = (prof.name && prof.name !== 'GUEST-77') ? prof.name : (prof.name || '');
  if (uInput && document.activeElement !== uInput) {
    uInput.value = currentName;
  }
  if (mUInput && document.activeElement !== mUInput) {
    mUInput.value = currentName;
  }
  if (passInput && prof.passcode && document.activeElement !== passInput) {
    passInput.value = prof.passcode;
  }
  if (mPassInput && prof.passcode && document.activeElement !== mPassInput) {
    mPassInput.value = prof.passcode;
  }
  if (rInput && prof.role) {
    rInput.value = prof.role;
  }

  // Read stats from localStorage
  try {
    const rawSave = JSON.parse(localStorage.getItem('vita_save') || '{}');
    if (pBestTime) pBestTime.textContent = (rawSave && rawSave.bestTime) ? (rawSave.bestTime + 's') : '-';
    if (pTotalKills) pTotalKills.textContent = (rawSave && rawSave.totalKills) ? rawSave.totalKills : '0';
  } catch (e) {}

  if (prof.isLoggedIn && prof.name) {
    if (bar) bar.style.display = 'flex';
    if (btnOpen) btnOpen.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>' + escapeLbHtml(prof.name);
    if (nameEl) nameEl.textContent = 'OPERATIVE: ' + prof.name.toUpperCase();
    if (statusEl) statusEl.textContent = prof.status || 'OPERATIVE // ACTIVE';

    if (startText) startText.textContent = 'OPERATIVE: ' + prof.name.toUpperCase();
    if (startBadge) startBadge.textContent = prof.provider === 'guest' ? 'GUEST' : 'REGISTERED';
    if (startIcon) startIcon.innerHTML = getPresetSvgMarkup(currentEmoji);
    if (btnStartAuth) btnStartAuth.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>DOSSIER: ' + escapeLbHtml(prof.name).toUpperCase();

    if (pBadge) {
      pBadge.textContent = 'ACTIVE IDENTITY // ' + (prof.provider === 'guest' ? 'GUEST' : 'VERIFIED');
      pBadge.className = 'auth-status-pill ' + (prof.provider === 'guest' ? 'guest' : 'verified');
    }
    if (pClearance) pClearance.textContent = prof.provider === 'guest' ? 'CLEARANCE: LEVEL-1' : 'CLEARANCE: LEVEL-2';
    if (pDbStatus) {
      if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured()) {
        pDbStatus.textContent = 'UPLINK ACTIVE';
      } else {
        pDbStatus.textContent = 'LOCAL ARCHIVE';
      }
    }
  } else {
    if (bar) bar.style.display = 'none';
    if (btnOpen) btnOpen.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>Sign In / Operative Dossier';
    if (startText) startText.textContent = 'OPERATIVE: ANONYMOUS [SIGN IN]';
    if (startBadge) startBadge.textContent = 'GUEST';
    if (startIcon) startIcon.innerHTML = getPresetSvgMarkup('biohazard');
    if (btnStartAuth) btnStartAuth.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>SIGN IN / OPERATIVE DOSSIER';

    if (pBadge) {
      pBadge.textContent = 'STATUS: GUEST // LOCAL';
      pBadge.className = 'auth-status-pill unverified';
    }
    if (pClearance) pClearance.textContent = 'CLEARANCE: LEVEL-1';
    if (pDbStatus) pDbStatus.textContent = 'LOCAL ARCHIVE // STANDBY';
  }

  // Sinkronisasi status koneksi Supabase Cloud
  const sbTag = document.getElementById('supabaseStatusTag');
  const sbUrlIn = document.getElementById('sbUrlInput');
  const sbKeyIn = document.getElementById('sbKeyInput');
  if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured()) {
    const cfg = getSupabaseConfig();
    if (sbUrlIn && !sbUrlIn.value) sbUrlIn.value = cfg.url;
    if (sbKeyIn && !sbKeyIn.value) sbKeyIn.value = cfg.anonKey;
    if (sbTag) {
      sbTag.textContent = 'UPLINK ACTIVE';
      sbTag.className = 'supabase-status-tag connected';
    }
    if (pDbStatus) {
      pDbStatus.textContent = 'UPLINK ACTIVE';
    }
  }

  // Top Bar Mini Pill Avatar & Name
  const hName = document.getElementById('headerUserName');
  const hAvatar = document.getElementById('headerUserAvatar');
  const hDef = document.getElementById('headerUserDef');
  if (hName) hName.textContent = (prof.name && prof.name !== 'GUEST-77') ? prof.name : (prof.name || 'GUEST-77');
  if (hAvatar && hDef) {
    if (hasCustomPhoto) {
      hAvatar.src = prof.avatar;
      hAvatar.style.display = 'block';
      hDef.style.display = 'none';
    } else {
      hAvatar.style.display = 'none';
      hDef.style.display = 'flex';
      hDef.innerHTML = getPresetSvgMarkup(currentEmoji);
    }
  }

  // Highlight simbol divisi terpilih
  if (typeof highlightActivePresetAvatar === 'function') {
    highlightActivePresetAvatar(hasCustomPhoto ? '' : currentEmoji);
  }
}

async function handleConnectSupabase() {
  const urlInput = document.getElementById('sbUrlInput');
  const keyInput = document.getElementById('sbKeyInput');
  const url = (urlInput ? urlInput.value : '').trim();
  const key = (keyInput ? keyInput.value : '').trim();

  if (!url || !key) {
    alert('Enter Facility Uplink URL and Access Key first.');
    return;
  }

  const tag = document.getElementById('supabaseStatusTag');
  if (tag) {
    tag.textContent = 'LINKING...';
    tag.className = 'supabase-status-tag';
  }

  if (typeof testSupabaseConnection === 'function') {
    const res = await testSupabaseConnection(url, key);
    if (res.ok) {
      alert('[UPLINK ESTABLISHED]\nOperative dossier and leaderboard are now synchronized across the facility network.');
      if (tag) {
        tag.textContent = 'UPLINK ACTIVE';
        tag.className = 'supabase-status-tag connected';
      }
      const dbStatus = document.getElementById('profileDbStatus');
      if (dbStatus) {
        dbStatus.textContent = 'UPLINK ACTIVE';
      }
      if (typeof syncProfileToSupabase === 'function') {
        const prof = getProfile();
        await syncProfileToSupabase(prof);
      }
      renderLeaderboard();
    } else {
      alert('[UPLINK FAILED]\n' + res.message);
      if (tag) {
        tag.textContent = 'LINK FAILED';
        tag.className = 'supabase-status-tag';
      }
    }
  }
}

function handleDisconnectSupabase() {
  if (typeof setSupabaseConfig === 'function') {
    setSupabaseConfig('', '');
  }
  const urlInput = document.getElementById('sbUrlInput');
  const keyInput = document.getElementById('sbKeyInput');
  if (urlInput) urlInput.value = '';
  if (keyInput) keyInput.value = '';

  const tag = document.getElementById('supabaseStatusTag');
  if (tag) {
    tag.textContent = 'STANDBY';
    tag.className = 'supabase-status-tag';
  }
  const dbStatus = document.getElementById('profileDbStatus');
  if (dbStatus) {
    dbStatus.textContent = 'LOCAL ARCHIVE';
  }
  alert('[UPLINK CUT] Facility network link closed. Dossier restored to local archive.');
  renderLeaderboard();
}

function escapeLbHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function isAvatarSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  if (/^data:image\//i.test(s)) return true;
  if (/^https:\/\//i.test(s)) return true;
  return false;
}

function formatLbTime(sec) {
  const s0 = Number(sec);
  if (!Number.isFinite(s0) || s0 < 0) return '-';
  const m = Math.floor(s0 / 60);
  const s = Math.floor(s0 % 60);
  return m + ':' + String(s).padStart(2, '0');
}

async function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardTbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-dim)">Fetching facility telemetry data...</td></tr>';

  let entries = [];
  let isCloud = false;

  if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof fetchTopLeaderboard === 'function') {
    entries = await fetchTopLeaderboard(20);
    isCloud = true;
  }

  if (entries && entries.length > 0) {
    let rowsHtml = '';
    entries.forEach((item, index) => {
      const rankNum = index + 1;
      let rankBadge = `<span class="rank-badge">#${rankNum}</span>`;
      if (rankNum === 1) rankBadge = `<span class="rank-badge rank-1">#1</span>`;
      else if (rankNum === 2) rankBadge = `<span class="rank-badge rank-2">#2</span>`;
      else if (rankNum === 3) rankBadge = `<span class="rank-badge rank-3">#3</span>`;

      const isSafeAvatar = isAvatarSafeUrl(item.avatar);
      const avatarHtml = isSafeAvatar
        ? `<img class="op-avatar-mini" src="${escapeLbHtml(item.avatar)}" alt="${escapeLbHtml(item.username)}">`
        : `<span class="op-svg-mini">${getPresetSvgMarkup(item.preset_emoji)}</span>`;

      const grade = ['S', 'A', 'B', 'C'].includes(item.grade) ? item.grade : 'B';
      rowsHtml += `
        <tr>
          <td>${rankBadge}</td>
          <td>
            <div class="op-cell">
              ${avatarHtml}
              <span class="op-name">${escapeLbHtml(item.username)}</span>
            </div>
          </td>
          <td><span class="op-role-tag">${escapeLbHtml(item.role || 'Operative')}</span></td>
          <td><span class="sector-tag">SECTOR ${item.highest_level || 1}</span></td>
          <td class="time-col">
            <svg class="tele-icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            ${formatLbTime(item.best_time)}
          </td>
          <td class="kills-col">
            <svg class="tele-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12c0 3.03 1.35 5.75 3.5 7.6V22h13v-2.4c2.15-1.85 3.5-4.57 3.5-7.6 0-5.52-4.48-10-10-10zm-3 12c-.83 0-1.5-.67-1.5-1.5S8.17 11 9 11s1.5.67 1.5 1.5S9.83 14 9 14zm6 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
            ${item.total_kills || 0}
          </td>
          <td><span class="grade-pill grade-${grade}">${grade}</span></td>
        </tr>
      `;
    });
    tbody.innerHTML = rowsHtml;
  } else {
    let localHigh = null;
    try {
      localHigh = JSON.parse(localStorage.getItem('vita_high') || 'null');
    } catch (e) {}

    const prof = getProfile();
    if (localHigh && localHigh.bestTime) {
      const isSafeProfAvatar = isAvatarSafeUrl(prof.avatar);
      const avatarHtml = isSafeProfAvatar
        ? `<img class="op-avatar-mini" src="${escapeLbHtml(prof.avatar)}" alt="${escapeLbHtml(prof.name)}">`
        : `<span class="op-svg-mini">${getPresetSvgMarkup(prof.presetEmoji)}</span>`;

      tbody.innerHTML = `
        <tr>
          <td><span class="rank-badge rank-1">#1</span></td>
          <td>
            <div class="op-cell">
              ${avatarHtml}
              <span class="op-name">${escapeLbHtml(prof.name)}</span>
            </div>
          </td>
          <td><span class="op-role-tag">${escapeLbHtml(prof.role || 'Field Operative')}</span></td>
          <td><span class="sector-tag">SECTOR ${localHigh.highestLevel || localHigh.level || 1} (LOCAL)</span></td>
          <td class="time-col">
            <svg class="tele-icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            ${formatLbTime(localHigh.bestTime)}
          </td>
          <td class="kills-col">
            <svg class="tele-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12c0 3.03 1.35 5.75 3.5 7.6V22h13v-2.4c2.15-1.85 3.5-4.57 3.5-7.6 0-5.52-4.48-10-10-10zm-3 12c-.83 0-1.5-.67-1.5-1.5S8.17 11 9 11s1.5.67 1.5 1.5S9.83 14 9 14zm6 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
            ${localHigh.bestKills || 0}
          </td>
          <td><span class="grade-pill grade-S">S</span></td>
        </tr>
        <tr>
          <td colspan="7" style="text-align:center;padding:16px;font-size:12px;color:var(--text-dim);border-top:1px dashed rgba(255,255,255,0.1)">
            ${isCloud ? 'No facility records yet. Complete a sector to submit your first telemetry!' : 'Displaying local facility records. Open "Facility Uplink" to link the facility network.'}
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:28px;color:var(--text-dim)">
            <p style="margin-bottom:8px;font-size:14px;color:var(--accent-glow)">No mission history recorded yet.</p>
            <p style="font-size:12px;margin:0">Purge labyrinth sectors or link the facility network to view global leaderboards.</p>
          </td>
        </tr>
      `;
    }
  }
}

function openAdminFromHome() {
  playWebGame();
  setTimeout(() => {
    if (typeof openAdminLogin === 'function') openAdminLogin();
  }, 100);
}

const authModal = document.getElementById('authModal');
const loginModalOpen = document.getElementById('loginModalOpen');
const authModalClose = document.getElementById('authModalClose');

if (loginModalOpen) {
  loginModalOpen.addEventListener('click', openAuthModal);
}
if (authModalClose) {
  authModalClose.addEventListener('click', closeAuthModal);
}
if (authModal) {
  authModal.addEventListener('click', e => {
    if (e.target === authModal) closeAuthModal();
  });
}

const operativeLogoutBtn = document.getElementById('operativeLogoutBtn');
if (operativeLogoutBtn) {
  operativeLogoutBtn.addEventListener('click', handleLogout);
}

// File Upload Handlers (Photo Profile)
const ppFileInput = document.getElementById('ppFileInput');
if (ppFileInput) {
  ppFileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    processAvatarFile(file, (dataUrl, approxKb) => {
      const prof = getProfile();
      prof.name = getCurrentCallsign();
      prof.avatar = dataUrl;
      prof.isLoggedIn = true;
      if (!prof.provider || prof.provider === 'guest') prof.provider = 'custom';
      prof.status = `${(prof.role || 'OPERATIVE').toUpperCase()} // ACTIVE`;
      setProfile(prof);
      showSaveIndicator(`Avatar Photo Saved (${approxKb} KB)`);
    });
  });
}

const modalFileInput = document.getElementById('modalFileInput');
if (modalFileInput) {
  modalFileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    processAvatarFile(file, (dataUrl, approxKb) => {
      const prof = getProfile();
      prof.name = getCurrentCallsign();
      prof.avatar = dataUrl;
      prof.isLoggedIn = true;
      if (!prof.provider || prof.provider === 'guest') prof.provider = 'custom';
      prof.status = `${(prof.role || 'OPERATIVE').toUpperCase()} // ACTIVE`;
      setProfile(prof);
      showSaveIndicator(`Avatar Photo Saved (${approxKb} KB)`);
    });
  });
}

function setupProfileLiveListeners() {
  const uInput = document.getElementById('profileUsernameInput');
  const mUInput = document.getElementById('modalUsernameInput');
  const pInput = document.getElementById('profilePasscodeInput');
  const mPassInput = document.getElementById('modalPasscodeInput');
  const rInput = document.getElementById('profileRoleInput');

  let debounceTimer = null;
  function handleLiveNameChange(e) {
    const val = e.target.value;
    // Sync both inputs in real time
    if (e.target === uInput && mUInput && document.activeElement !== mUInput) {
      mUInput.value = val;
    } else if (e.target === mUInput && uInput && document.activeElement !== uInput) {
      uInput.value = val;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const cleanVal = val.trim();
      if (!cleanVal) return;
      const prof = getProfile();
      prof.name = cleanVal;
      prof.isLoggedIn = true;
      if (!prof.provider || prof.provider === 'guest') prof.provider = 'custom';
      prof.status = `${(prof.role || 'OPERATIVE').toUpperCase()} // ACTIVE`;
      try { localStorage.setItem(VITA_PROFILE_KEY, JSON.stringify(prof)); } catch (err) {}

      const nameEl = document.getElementById('operativeName');
      if (nameEl) nameEl.textContent = 'OPERATIVE: ' + prof.name.toUpperCase();
      const sbName = document.getElementById('sidebarUserName');
      if (sbName) sbName.textContent = prof.name;
      const hName = document.getElementById('headerUserName');
      if (hName) hName.textContent = prof.name;
      const startText = document.getElementById('startOperativeText');
      if (startText) startText.textContent = 'OPERATIVE: ' + prof.name.toUpperCase();

      const autoTag = document.getElementById('autoSaveIndicator');
      if (autoTag) {
        autoTag.textContent = '● Auto-Saved ✓';
        autoTag.style.color = '#4ade80';
      }
      const modalTag = document.getElementById('modalAutoSaveIndicator');
      if (modalTag) {
        modalTag.textContent = '● Auto-Saved ✓';
        modalTag.style.color = '#4ade80';
      }
      if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof syncProfileToSupabase === 'function') {
        syncProfileToSupabase(prof).catch(() => {});
      }
    }, 350);
  }

  let passDebounceTimer = null;
  function handleLivePassChange(e) {
    const val = e.target.value;
    if (e.target === pInput && mPassInput && document.activeElement !== mPassInput) {
      mPassInput.value = val;
    } else if (e.target === mPassInput && pInput && document.activeElement !== pInput) {
      pInput.value = val;
    }
    clearTimeout(passDebounceTimer);
    passDebounceTimer = setTimeout(() => {
      const prof = getProfile();
      prof.passcode = val.trim();
      try { localStorage.setItem(VITA_PROFILE_KEY, JSON.stringify(prof)); } catch (err) {}
      if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof syncProfileToSupabase === 'function') {
        syncProfileToSupabase(prof).catch(() => {});
      }
    }, 450);
  }

  if (uInput) {
    uInput.addEventListener('input', handleLiveNameChange);
    uInput.addEventListener('change', handleLiveNameChange);
  }
  if (mUInput) {
    mUInput.addEventListener('input', handleLiveNameChange);
    mUInput.addEventListener('change', handleLiveNameChange);
  }
  if (pInput) {
    pInput.addEventListener('input', handleLivePassChange);
    pInput.addEventListener('change', handleLivePassChange);
  }
  if (mPassInput) {
    mPassInput.addEventListener('input', handleLivePassChange);
    mPassInput.addEventListener('change', handleLivePassChange);
  }
  if (rInput) {
    rInput.addEventListener('change', () => {
      const prof = getProfile();
      prof.role = rInput.value;
      prof.isLoggedIn = true;
      prof.status = `${rInput.value.toUpperCase()} // ACTIVE`;
      setProfile(prof);
      showSaveIndicator('Division Saved');
    });
  }

  const fileIn = document.getElementById('ppFileInput');
  const mFileIn = document.getElementById('modalFileInput');
  function handleAvatarUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    processAvatarFile(file, (dataUrl, approxKb) => {
      const prof = getProfile();
      prof.avatar = dataUrl;
      prof.name = getCurrentCallsign();
      prof.isLoggedIn = true;
      if (!prof.provider || prof.provider === 'guest') prof.provider = 'custom';
      prof.status = `${(prof.role || 'OPERATIVE').toUpperCase()} // PHOTO ACTIVE`;
      setProfile(prof);
      showSaveIndicator(`Avatar Photo Saved (${approxKb} KB)`);
      homeBeep('save');
    });
  }
  if (fileIn) fileIn.addEventListener('change', handleAvatarUpload);
  if (mFileIn) mFileIn.addEventListener('change', handleAvatarUpload);
}

applyProfileUI();
setupProfileLiveListeners();
initDashTab();
initTeasers();
renderLeaderboard();
// Setup listeners untuk pengaturan komplit
['homeVolume', 'homeBrightness', 'homeSfx', 'homeBgm', 'homeTouchScale', 'homeTouchOpacity'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', e => {
    const v = Math.round(Number(e.target.value));
    if (!Number.isFinite(v)) return;
    if (id === 'homeVolume') {
      homeSettings.volume = Math.max(0, Math.min(100, v));
      const vVal = document.getElementById('homeVolumeVal');
      if (vVal) vVal.textContent = homeSettings.volume + '%';
      if (typeof setMasterVolume === 'function') setMasterVolume(homeSettings.volume, true);
    } else if (id === 'homeBrightness') {
      homeSettings.brightness = Math.max(30, Math.min(180, v));
      const bVal = document.getElementById('homeBrightnessVal');
      if (bVal) bVal.textContent = homeSettings.brightness + '%';
      if (typeof applyBrightness === 'function') applyBrightness(homeSettings.brightness);
    } else if (id === 'homeSfx') {
      homeSettings.sfxVolume = Math.max(0, Math.min(100, v));
      const sVal = document.getElementById('homeSfxVal');
      if (sVal) sVal.textContent = homeSettings.sfxVolume + '%';
    } else if (id === 'homeBgm') {
      homeSettings.bgmVolume = Math.max(0, Math.min(100, v));
      const bVal = document.getElementById('homeBgmVal');
      if (bVal) bVal.textContent = homeSettings.bgmVolume + '%';
    } else if (id === 'homeTouchScale') {
      homeSettings.touchScale = Math.max(70, Math.min(140, v));
      const tsVal = document.getElementById('homeTouchScaleVal');
      if (tsVal) tsVal.textContent = homeSettings.touchScale + '%';
      if (typeof applyTouchStyle === 'function') applyTouchStyle();
    } else if (id === 'homeTouchOpacity') {
      homeSettings.touchOpacity = Math.max(30, Math.min(100, v));
      const toVal = document.getElementById('homeTouchOpacityVal');
      if (toVal) toVal.textContent = homeSettings.touchOpacity + '%';
      if (typeof applyTouchStyle === 'function') applyTouchStyle();
    }
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
});

const hMuteEl = document.getElementById('homeMuted');
if (hMuteEl) {
  hMuteEl.addEventListener('change', e => {
    homeSettings.muted = !!e.target.checked;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hDevEl = document.getElementById('homeDeviceMode');
if (hDevEl) {
  hDevEl.addEventListener('change', e => {
    homeSettings.deviceMode = e.target.value;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hAimEl = document.getElementById('homeAutoAim');
if (hAimEl) {
  hAimEl.addEventListener('change', e => {
    homeSettings.autoAim = !!e.target.checked;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hHapEl = document.getElementById('homeHaptic');
if (hHapEl) {
  hHapEl.addEventListener('change', e => {
    homeSettings.haptic = !!e.target.checked;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hShakeEl = document.getElementById('homeScreenShake');
if (hShakeEl) {
  hShakeEl.addEventListener('change', e => {
    homeSettings.screenShake = !!e.target.checked;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hMmEl = document.getElementById('homeMinimap');
if (hMmEl) {
  hMmEl.addEventListener('change', e => {
    homeSettings.showMinimap = !!e.target.checked;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hFpsEl = document.getElementById('homeShowFps');
if (hFpsEl) {
  hFpsEl.addEventListener('change', e => {
    homeSettings.showFps = !!e.target.checked;
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

const hLangEl = document.getElementById('homeLanguage');
if (hLangEl) {
  hLangEl.addEventListener('change', e => {
    homeSettings.lang = e.target.value === 'en' ? 'en' : 'id';
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}
const hDiffEl = document.getElementById('homeDifficulty');
if (hDiffEl) {
  hDiffEl.addEventListener('change', e => {
    homeSettings.difficulty = HOME_DIFFS.includes(e.target.value) ? e.target.value : 'normal';
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}
const hQualEl = document.getElementById('homeQuality');
if (hQualEl) {
  hQualEl.addEventListener('change', e => {
    homeSettings.quality = HOME_QUALS.includes(e.target.value) ? e.target.value : 'retro';
    saveHomeSettings();
    if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  });
}

function resetAllSettingsToDefault() {
  const confirmMsg = (homeSettings.lang === 'id')
    ? 'Kembalikan seluruh pengaturan sistem ke default pabrik?'
    : 'Reset all system settings to factory default?';
  if (!confirm(confirmMsg)) return;
  homeSettings = Object.assign({}, homeDefaults);
  saveHomeSettings();
  if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  if (typeof openSettingsModal === 'function') openSettingsModal();
  if (typeof showSaveIndicator === 'function') showSaveIndicator('Settings Reset');
  homeBeep('save');
}

// ---- DEVICE SELECTION MODAL (PC OR MOBILE) ----
let pendingDeviceAutoStart = false;
let pendingDeviceContinue = false;
let pendingDeviceFromGameView = false;
let selectedDeviceOption = 'pc';

/* Sinkronkan kelas visual + status ARIA kedua kartu pilihan perangkat.
   Dipakai bersama oleh openDeviceModeModal() dan selectDeviceChoice(). */
function syncDeviceChoiceSelection() {
  const isPc = selectedDeviceOption === 'pc';
  const pcCard = document.getElementById('deviceChoicePc');
  const mobCard = document.getElementById('deviceChoiceMobile');
  if (pcCard) {
    pcCard.classList.toggle('selected', isPc);
    pcCard.setAttribute('aria-pressed', isPc ? 'true' : 'false');
  }
  if (mobCard) {
    mobCard.classList.toggle('selected', !isPc);
    mobCard.setAttribute('aria-pressed', !isPc ? 'true' : 'false');
  }
}

function openDeviceModeModal(fromGameView = false, autoStart = false, isContinue = false) {
  pendingDeviceFromGameView = !!fromGameView;
  pendingDeviceAutoStart = !!autoStart;
  pendingDeviceContinue = !!isContinue;

  // Auto-detect touchscreen vs mouse/keyboard
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(pointer: coarse)').matches;
  const currentMode = homeSettings.deviceMode;
  if (currentMode === 'mobile' || currentMode === 'pc') {
    selectedDeviceOption = currentMode;
  } else {
    selectedDeviceOption = hasTouch ? 'mobile' : 'pc';
  }

  syncDeviceChoiceSelection();

  const chk = document.getElementById('chkRememberDevice');
  if (chk) chk.checked = (homeSettings.deviceMode === 'pc' || homeSettings.deviceMode === 'mobile');

  const m = document.getElementById('deviceModeModal');
  if (m) { m.style.display = 'flex'; m.classList.add('open'); }
  homeBeep('open');
}

function closeDeviceModeModal() {
  const m = document.getElementById('deviceModeModal');
  if (m) { m.classList.remove('open'); m.style.display = 'none'; }
  homeBeep('close');
}

function selectDeviceChoice(choice) {
  selectedDeviceOption = (choice === 'mobile') ? 'mobile' : 'pc';
  syncDeviceChoiceSelection();
  homeBeep('click');
}

function confirmDeviceChoiceAndPlay() {
  const chk = document.getElementById('chkRememberDevice');
  const remember = chk && chk.checked;

  if (remember) {
    homeSettings.deviceMode = selectedDeviceOption;
  } else {
    homeSettings.deviceMode = 'ask';
  }
  saveHomeSettings();

  // Terapkan class touch-on
  if (selectedDeviceOption === 'mobile') {
    document.body.classList.add('touch-on');
    if (typeof applyTouchLayout === 'function') applyTouchLayout();
  } else {
    document.body.classList.remove('touch-on');
  }

  updateStartScreenDevicePill(selectedDeviceOption);
  closeDeviceModeModal();

  if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();

  if (pendingDeviceFromGameView) {
    // Dipanggil langsung dari start screen / in-game
    if (pendingDeviceAutoStart && typeof startGame === 'function') {
      startGame(true);
    } else if (pendingDeviceContinue && typeof continueGame === 'function') {
      continueGame(true);
    }
    return;
  }

  proceedToWebGame(pendingDeviceAutoStart);
}

const VITA_DESKTOP_SVG = '<svg class="device-pill-svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z"/></svg>';
const VITA_PHONE_SVG = '<svg class="device-pill-svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>';

function updateStartScreenDevicePill(mode, langOverride) {
  const isMob = (mode === 'mobile');
  // applyLang() meneruskan bahasa otoritatif dari pengaturan game; tanpa itu pakai pengaturan Hub.
  const lang = (langOverride === 'id' || langOverride === 'en') ? langOverride : homeSettings.lang;
  const icon = document.getElementById('startScreenDeviceIcon');
  const txt = document.getElementById('startScreenDeviceText');
  if (icon) icon.innerHTML = isMob ? VITA_PHONE_SVG : VITA_DESKTOP_SVG;
  if (txt) {
    if (isMob) txt.textContent = (lang === 'id') ? 'MODE KONTROL: HP (LAYAR SENTUH)' : 'CONTROL MODE: MOBILE (TOUCH)';
    else txt.textContent = (lang === 'id') ? 'MODE KONTROL: PC (KEYBOARD)' : 'CONTROL MODE: PC (KEYBOARD)';
  }
  const pill = document.getElementById('startScreenDevicePill');
  if (pill) pill.title = (lang === 'id') ? 'Klik untuk mengganti mode PC / HP' : 'Click to switch PC / mobile mode';
  const swBtn = document.querySelector('#startScreenDevicePill .device-pill-btn');
  if (swBtn) swBtn.textContent = (lang === 'id') ? '[GANTI]' : '[SWITCH]';
}

// Pindah ke view game dalam satu halaman (dipanggil tombol MAIN SEKARANG).
function playWebGame(autoStart = false) {
  if (typeof ensureAudio === 'function') {
    try { ensureAudio(); } catch (_) {}
  }

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (window.innerWidth <= 820);

  // Jika masih default ('ask'), langsung auto-detect agar pemain tidak terhalang modal
  if (homeSettings.deviceMode === 'ask') {
    homeSettings.deviceMode = isTouch ? 'mobile' : 'pc';
    saveHomeSettings();
  }

  // Terapkan class touch-on
  if (homeSettings.deviceMode === 'mobile' || (isTouch && homeSettings.deviceMode !== 'pc')) {
    document.body.classList.add('touch-on');
    if (typeof applyTouchLayout === 'function') applyTouchLayout();
  } else {
    document.body.classList.remove('touch-on');
  }

  updateStartScreenDevicePill(homeSettings.deviceMode);
  proceedToWebGame(autoStart);
}

function proceedToWebGame(autoStart = false) {
  if (typeof syncSettingsFromStorage === 'function') syncSettingsFromStorage();
  const hv = document.getElementById('homeView');
  if (hv) hv.style.display = 'none';
  const dm = document.getElementById('deviceModeModal');
  if (dm) { dm.classList.remove('open'); dm.style.display = 'none'; }
  const gv = document.getElementById('gameView');
  if (gv) gv.style.display = '';
  document.body.classList.add('game-on');
  const ss = document.getElementById('startScreen');
  if (autoStart) {
    if (ss) ss.style.display = 'none';
  } else {
    if (ss) ss.style.display = 'flex';
  }
  if (typeof resize === 'function') resize();
  if (typeof checkContinueBtn === 'function') checkContinueBtn();
  if (typeof checkDeviceOrientationPrompt === 'function') checkDeviceOrientationPrompt();
  if (autoStart && typeof startGame === 'function') {
    if (activeGameDirective === 'endless' && typeof startEndlessMode === 'function') {
      startEndlessMode();
    } else {
      startGame(true);
    }
  }
}

// ---- Update dalam aplikasi (ala game lain) ----
// Cara rilis versi baru (3 langkah, jangan lupa salah satu):
//   1) naikkan APP_VERSION di bawah,
//   2) samakan "version" di version.json,
//   3) naikkan CACHE di sw.js (mis. vita-v3 -> vita-v4).
// App yang sudah ter-install otomatis menampilkan spanduk update.
function compareSemver(a, b) {
  if (!a || !b) return 0;
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
const APP_VERSION = '2.5.5';
const VITA_CLOUD_HOST = 'https://vita-game-three.vercel.app';
const UPDATE_TXT = {
  id: { 
    msg: 'Pembaruan VITA tersedia!', 
    btn: 'Update Sekarang', 
    btn_app: 'Unduh Pembaruan',
    later: 'Nanti' 
  },
  en: { 
    msg: 'VITA update available!', 
    btn: 'Update Now', 
    btn_app: 'Download Update',
    later: 'Later' 
  }
};
let vitaSwReg = null;
let vitaUpdateShown = false;
let vitaReloading = false;
let pendingVersion = '';

function updateLang() {
  try {
    const s = JSON.parse(localStorage.getItem(HOME_SETTINGS_KEY) || '{}');
    return s.lang === 'id' ? 'id' : 'en';
  } catch (e) { return 'en'; }
}

function ensureUpdateBanner() {
  let bar = document.getElementById('updateBanner');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'updateBanner';
  bar.style.cssText = 'display:none;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:#14101c;border:1px solid #00f0ff;border-radius:12px;padding:12px 18px;font-family:inherit;color:#fff;box-shadow:0 8px 32px rgba(0,240,255,.25),0 12px 40px rgba(0,0,0,.7);max-width:min(92vw,460px);text-align:center;backdrop-filter:blur(8px);';
  const msg = document.createElement('span');
  msg.id = 'updateBannerMsg';
  msg.style.cssText = 'font-size:13px;margin-right:12px;font-weight:600;color:#e6edf3;display:inline-block;margin-bottom:6px;';
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:inline-flex;align-items:center;gap:8px;';
  const go = document.createElement('button');
  go.id = 'updateBannerGo';
  go.style.cssText = 'background:linear-gradient(135deg,#00f0ff,#0070f3);border:0;border-radius:8px;padding:8px 16px;font-weight:bold;color:#0a0a12;cursor:pointer;font-size:12px;';
  go.addEventListener('click', applyVitaUpdate);
  const later = document.createElement('button');
  later.id = 'updateBannerLater';
  later.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.2);color:#a0a0b0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12px;';
  later.addEventListener('click', () => {
    try { localStorage.setItem('vita_update_dismissed', pendingVersion); } catch (e) {}
    bar.style.display = 'none';
  });
  btnRow.appendChild(go); btnRow.appendChild(later);
  bar.appendChild(msg); bar.appendChild(document.createElement('br')); bar.appendChild(btnRow);
  document.body.appendChild(bar);
  return bar;
}

function showUpdateBanner(ver) {
  if (vitaUpdateShown) return;
  vitaUpdateShown = true;
  pendingVersion = ver;
  const L = UPDATE_TXT[updateLang()] || UPDATE_TXT.id;
  const bar = ensureUpdateBanner();
  const msgEl = document.getElementById('updateBannerMsg');
  if (msgEl) msgEl.textContent = L.msg + ' (v' + ver + ' | ' + (isApp ? (navigator.userAgent.toLowerCase().includes('android') ? 'Android' : 'PC') : 'Web') + ')';
  const goEl = document.getElementById('updateBannerGo');
  if (goEl) goEl.textContent = isApp ? (L.btn_app || L.btn) : L.btn;
  const laterEl = document.getElementById('updateBannerLater');
  if (laterEl) laterEl.textContent = L.later;
  if (bar) bar.style.display = 'block';
}

async function checkVitaUpdate(manual = false) {
  if (vitaUpdateShown && !manual) return;
  const feedback = document.getElementById('settingsUpdateFeedback');
  if (manual && feedback) {
    feedback.style.display = 'block';
    feedback.style.background = 'rgba(0,240,255,0.1)';
    feedback.style.color = '#00f0ff';
    feedback.style.border = '1px solid rgba(0,240,255,0.3)';
    feedback.textContent = (updateLang() === 'id') ? 'Sedang memeriksa pembaruan server...' : 'Checking server for updates...';
  }

  try {
    const endpoints = [];
    if (window.location.protocol.indexOf('http') === 0 && !isNativeApp()) {
      endpoints.push('version.json?t=' + Date.now());
    }
    endpoints.push('https://raw.githubusercontent.com/zrilxd20-code/VITA/main/version.json?t=' + Date.now());
    endpoints.push(VITA_CLOUD_HOST + '/version.json?t=' + Date.now());

    let remoteVer = null;
    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
        clearTimeout(timeoutId);
        if (res && res.ok) {
          const data = await res.json();
          if (data && typeof data.version === 'string') {
            remoteVer = data.version;
            break;
          }
        }
      } catch (_) {}
    }

    if (!remoteVer) {
      if (manual && feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(255,100,100,0.1)';
        feedback.style.color = '#ff6b6b';
        feedback.style.border = '1px solid rgba(255,100,100,0.3)';
        feedback.textContent = (updateLang() === 'id') ? 'Tidak dapat terhubung ke server pembaruan (offline).' : 'Unable to connect to update server (offline).';
      }
      return;
    }

    const cmp = compareSemver(remoteVer, APP_VERSION);
    if (cmp > 0) {
      // Ada versi baru!
      if (manual && feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(0,255,136,0.1)';
        feedback.style.color = '#00ff88';
        feedback.style.border = '1px solid rgba(0,255,136,0.3)';
        feedback.textContent = (updateLang() === 'id') 
          ? ('Pembaruan v' + remoteVer + ' tersedia! Klik tombol di bawah.') 
          : ('Update v' + remoteVer + ' available! Click below.');
      }
      showUpdateBanner(remoteVer);
    } else {
      if (manual && feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(0,240,255,0.1)';
        feedback.style.color = '#00f0ff';
        feedback.style.border = '1px solid rgba(0,240,255,0.3)';
        feedback.textContent = (updateLang() === 'id') 
          ? ('✓ VITA sudah dalam versi terbaru (v' + APP_VERSION + ').') 
          : ('✓ VITA is already up to date (v' + APP_VERSION + ').');
      }
    }
  } catch (err) {
    if (manual && feedback) {
      feedback.style.display = 'block';
      feedback.style.background = 'rgba(255,100,100,0.1)';
      feedback.style.color = '#ff6b6b';
      feedback.style.border = '1px solid rgba(255,100,100,0.3)';
      feedback.textContent = (updateLang() === 'id') ? 'Gagal memeriksa pembaruan.' : 'Update check failed.';
    }
  }
}

window.checkVitaUpdateManual = function() {
  checkVitaUpdate(true);
};

function isApkOrWebView() {
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (ua.includes('wv') || ua.includes('webview')) return true;
    if (ua.includes('android') && ua.includes('version/')) return true;
    if (window.Android || window.Capacitor || window.cordova) return true;
    if (window.location.protocol === 'file:') return true;
  } catch (e) {}
  return false;
}

function safeVitaReload(reason) {
  try {
    const now = Date.now();
    const lastReload = parseInt(sessionStorage.getItem('vita_last_reload') || '0', 10);
    // Cegah refresh berulang jika baru reload dalam 15 detik terakhir
    if (now - lastReload < 15000) {
      console.warn('VITA: Mencegah loop reload (' + reason + ')');
      return;
    }
    sessionStorage.setItem('vita_last_reload', String(now));
  } catch (e) {}
  window.location.reload();
}

const hadControllerOnLoad = Boolean('serviceWorker' in navigator && navigator.serviceWorker.controller);
let vitaUpdateTriggeredByUser = false;

function applyVitaUpdate() {
  const isApp = typeof isNativeApp === 'function' && isNativeApp();
  if (isApp) {
    const isAndroid = (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) || navigator.userAgent.toLowerCase().includes('android');
    if (isAndroid) {
      if (typeof openAndroidDownloadModal === 'function') {
        openAndroidDownloadModal();
        return;
      }
    } else {
      if (typeof openPcDownloadModal === 'function') {
        openPcDownloadModal();
        return;
      }
    }
    const updateUrl = isAndroid 
      ? VITA_CLOUD_HOST + '/downloads/vita.apk'
      : VITA_CLOUD_HOST + '/downloads/vita.exe';

    try {
      if (window.open) window.open(updateUrl, '_blank');
      else window.location.href = updateUrl;
    } catch (_) {
      window.location.href = updateUrl;
    }
    return;
  }

  vitaUpdateTriggeredByUser = true;
  const done = () => { setTimeout(() => safeVitaReload('user update applied'), 800); };
  try {
    if (vitaSwReg && typeof vitaSwReg.update === 'function') {
      vitaSwReg.update().catch(() => {}).then(done);
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration()
        .then(r => { if (r) r.update().catch(() => {}); })
        .catch(() => {});
      done();
    } else done();
  } catch (e) { safeVitaReload('update catch fallback'); }
}

try {
  if (window.location.protocol.indexOf('http') === 0 && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => {
          if (!reg) return;
          vitaSwReg = reg;
          if (typeof reg.addEventListener === 'function') {
            reg.addEventListener('updatefound', () => {
              const inst = reg.installing;
              if (!inst) return;
              inst.addEventListener('statechange', () => {
                // SW baru selesai install -> cek versi & tampilkan spanduk jika relevan.
                if (inst.state === 'installed' && navigator.serviceWorker.controller) {
                  checkVitaUpdate();
                }
              });
            });
          }
        })
        .catch(err => {
          console.warn('SW registration skipped:', err);
        });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 1. Dalam APK / WebView, jangan lakukan reload otomatis dari SW
      if (isApkOrWebView()) return;
      // 2. Jika halaman awalnya belum memiliki controller (instalasi pertama kali / claim awal), jangan reload
      if (!hadControllerOnLoad) return;
      // 3. Jangan reload otomatis jika pemain sedang di dalam game agar progres tidak hilang
      const isPlaying = document.body.classList.contains('game-on') ||
        (document.getElementById('gameView') && document.getElementById('gameView').style.display !== 'none');
      if (isPlaying && !vitaUpdateTriggeredByUser) return;
      // 4. Mencegah double reload
      if (vitaReloading) return;
      vitaReloading = true;
      safeVitaReload('controllerchange update');
    });
  }
} catch (e) {}

function setupAuthFormListeners() {
  const attachEnter = (inputId, callback) => {
    const el = document.getElementById(inputId);
    if (el) {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          callback();
        }
      });
    }
  };

  attachEnter('loginCallsignInput', handlePerformLogin);
  attachEnter('loginPasscodeInput', handlePerformLogin);
  attachEnter('modalUsernameInput', handleModalRegisterProfile);
  attachEnter('modalPasscodeInput', handleModalRegisterProfile);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAuthFormListeners);
} else {
  setupAuthFormListeners();
}

window.addEventListener('load', () => {
  setTimeout(checkVitaUpdate, 2500);
  try {
    const params = new URLSearchParams(window.location.search);
    const act = params.get('action');
    if (act === 'play') {
      setTimeout(() => { if (typeof playWebGame === 'function') playWebGame(); }, 250);
    } else if (act === 'leaderboard') {
      setTimeout(() => { if (typeof openLeaderboard === 'function') openLeaderboard(); }, 180);
    } else if (act === 'settings') {
      setTimeout(() => { if (typeof openSettings === 'function') openSettings(); }, 180);
    }
  } catch (_) {}
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVitaUpdate(); });
setInterval(checkVitaUpdate, 30 * 60 * 1000);

// VITA v2.0 HUB POLISH (procedural, no new deps)
// - ESC closes sidebar/modals (industry-standard)
// - Bestiary canvases get living pulse animation
// - Ember loop pauses when tab hidden (battery/perf)

(function vita2HubPolish() {
  document.addEventListener('keydown', (e) => {
    if (!e || !e.key) return;
    if (e.key === 'Escape') {
      try {
        const open = document.querySelector('#homeView .modal-backdrop.open');
        if (open) { open.classList.remove('open'); return; }
        const sb = document.getElementById('sidebarDrawer');
        if (sb && sb.classList.contains('open')) closeSidebar();
      } catch (_) {}
    }
  });

  // Living bestiary: subtle breathing pulse on each foe canvas.
  // Perf: the foe canvases are static DOM nodes (index.html) — cache the NodeList and skip
  // the per-frame querySelectorAll. A11y: skip the pulse entirely under prefers-reduced-motion
  // (the global CSS rule can't dampen a JS transform loop, which would otherwise snap 60×/sec).
  let pulseFoes = null;
  function vita2PulseFoes(t) {
    const hv = hubView();
    if (document.hidden || !hv || hv.style.display === 'none') {
      requestAnimationFrame(vita2PulseFoes);
      return;
    }
    try {
      if (!pulseFoes || pulseFoes.length === 0 || !pulseFoes[0].isConnected) {
        pulseFoes = document.querySelectorAll('#homeView .foe-canvas-box canvas');
      }
      for (let i = 0; i < pulseFoes.length; i++) {
        const s = 1 + Math.sin(t / 900 + i * 1.7) * 0.04;
        pulseFoes[i].style.transform = 'scale(' + s.toFixed(3) + ')';
      }
    } catch (_) {}
    requestAnimationFrame(vita2PulseFoes);
  }
  if (!HOME_REDUCE_MOTION && typeof requestAnimationFrame === 'function') requestAnimationFrame(vita2PulseFoes);
})();

// MODAL PLATFORM DOWNLOADER (PC & ANDROID)

function openPcDownloadModal() {
  const m = document.getElementById('pcDownloadModal');
  if (m) m.classList.add('open');
  if (typeof homeBeep === 'function') homeBeep('open');
}

function closePcDownloadModal() {
  const m = document.getElementById('pcDownloadModal');
  if (m) m.classList.remove('open');
  if (typeof homeBeep === 'function') homeBeep('close');
}

function openAndroidDownloadModal() {
  const m = document.getElementById('androidDownloadModal');
  if (m) m.classList.add('open');
  if (typeof homeBeep === 'function') homeBeep('open');
}

function closeAndroidDownloadModal() {
  const m = document.getElementById('androidDownloadModal');
  if (m) m.classList.remove('open');
  if (typeof homeBeep === 'function') homeBeep('close');
}

let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  const pwaBtn = document.getElementById('btnInstallPwa');
  if (pwaBtn) pwaBtn.style.display = 'inline-flex';
});

function installPwaFromHub() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    deferredPwaPrompt.userChoice.then(() => {
      deferredPwaPrompt = null;
    }).catch(() => {});
  } else {
    alert(homeSettings.lang === 'en' ? 
      'PWA is already installed or open your browser menu and choose "Add to Home Screen".' : 
      'Aplikasi sudah terpasang atau buka menu browser Anda lalu pilih "Tambahkan ke Layar Utama".');
  }
}

window.openPcDownloadModal = openPcDownloadModal;
window.closePcDownloadModal = closePcDownloadModal;
window.openAndroidDownloadModal = openAndroidDownloadModal;
window.closeAndroidDownloadModal = closeAndroidDownloadModal;
window.installPwaFromHub = installPwaFromHub;

// DETEKSI PLATFORM NATIVE (PC WINDOWS TAURI & ANDROID CAPACITOR)

function isNativeApp() {
  try {
    if (typeof window !== 'undefined') {
      // 1. Desktop Standalone Tauri (Windows / Mac / Linux)
      if (typeof window.__TAURI__ !== 'undefined' || typeof window.__TAURI_METADATA__ !== 'undefined' || typeof window.__TAURI_IPC__ !== 'undefined') return true;
      if (window.location && (window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost' || window.location.host === 'tauri.localhost')) return true;
      // 2. Mobile Android APK Capacitor
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return true;
      if (window.location && (window.location.origin === 'https://localhost' || (window.location.hostname === 'localhost' && window.Capacitor))) return true;
    }
  } catch (_) {}
  return false;
}

function initHubPlatformView() {
  const platSec = document.getElementById('platformSelectorSection');
  const heroBox = document.getElementById('heroPlayBox');
  const switchRow = document.getElementById('webPlatformSwitchRow');
  if (!platSec || !heroBox) return;

  // Cek parameter URL: jika dibuka via tab baru (?play=web atau ?play=1 atau tautan co-op)
  let hasPlayParam = false;
  try {
    const params = new URLSearchParams(window.location.search);
    hasPlayParam = params.get('play') === 'web' || params.get('play') === '1' || params.has('coop') || params.get('action') === 'play';
  } catch (_) {}

  if (isNativeApp() || hasPlayParam) {
    // Pada aplikasi yang diunduh (PC/APK) atau saat membuka tab game (?play=web):
    // Lewati gerbang pemilihan platform dan langsung tampilkan menu awal game normal.
    platSec.style.display = 'none';
    heroBox.style.display = 'flex';
    if (switchRow) switchRow.style.display = isNativeApp() ? 'none' : 'block';
  } else {
    // Pada halaman web portal awal (tanpa parameter ?play=web):
    // Cek apakah pemain sudah memilih "MAINKAN DI WEB" pada sesi ini
    let entered = false;
    try {
      entered = (typeof sessionStorage !== 'undefined') && sessionStorage.getItem('vita_hub_entered') === '1';
    } catch (_) {}

    if (entered) {
      platSec.style.display = 'none';
      heroBox.style.display = 'flex';
      if (switchRow) switchRow.style.display = 'block';
    } else {
      platSec.style.display = 'block';
      heroBox.style.display = 'none';
    }
  }
}

function enterWebHub() {
  const platSec = document.getElementById('platformSelectorSection');
  const heroBox = document.getElementById('heroPlayBox');
  const switchRow = document.getElementById('webPlatformSwitchRow');
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('vita_hub_entered', '1');
  } catch (_) {}

  if (platSec) platSec.style.display = 'none';
  if (heroBox) heroBox.style.display = 'flex';
  if (switchRow) switchRow.style.display = 'block';
  if (typeof homeBeep === 'function') homeBeep('open');
}

function showPlatformSelector() {
  const platSec = document.getElementById('platformSelectorSection');
  const heroBox = document.getElementById('heroPlayBox');
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('vita_hub_entered');
  } catch (_) {}

  if (platSec) platSec.style.display = 'block';
  if (heroBox) heroBox.style.display = 'none';
  if (typeof homeBeep === 'function') homeBeep('close');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHubPlatformView);
} else {
  initHubPlatformView();
}

window.isNativeApp = isNativeApp;
window.initHubPlatformView = initHubPlatformView;
window.enterWebHub = enterWebHub;
window.showPlatformSelector = showPlatformSelector;
window.showAuthForms = showAuthForms;
window.togglePasswordVisibility = togglePasswordVisibility;
window.getSavedCredentials = getSavedCredentials;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.openLeaderboardModal = openLeaderboardModal;
window.closeLeaderboardModal = closeLeaderboardModal;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.openControlsModal = openControlsModal;
window.closeControlsModal = closeControlsModal;
window.openManualModal = openManualModal;
window.closeManualModal = closeManualModal;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.openCodexModal = typeof openCodexModal === 'function' ? openCodexModal : () => {};
window.closeCodexModal = typeof closeCodexModal === 'function' ? closeCodexModal : () => {};
window.openDatabaseModal = typeof openDatabaseModal === 'function' ? openDatabaseModal : () => {};
window.closeDatabaseModal = typeof closeDatabaseModal === 'function' ? closeDatabaseModal : () => {};
window.openDeviceModeModal = typeof openDeviceModeModal === 'function' ? openDeviceModeModal : () => {};
window.closeDeviceModeModal = typeof closeDeviceModeModal === 'function' ? closeDeviceModeModal : () => {};
window.openPcDownloadModal = typeof openPcDownloadModal === 'function' ? openPcDownloadModal : () => {};
window.closePcDownloadModal = typeof closePcDownloadModal === 'function' ? closePcDownloadModal : () => {};
window.openAndroidDownloadModal = typeof openAndroidDownloadModal === 'function' ? openAndroidDownloadModal : () => {};
window.closeAndroidDownloadModal = typeof closeAndroidDownloadModal === 'function' ? closeAndroidDownloadModal : () => {};
window.openCoopLobbyModal = typeof openCoopLobbyModal === 'function' ? openCoopLobbyModal : () => {};
window.closeCoopLobbyModal = typeof closeCoopLobbyModal === 'function' ? closeCoopLobbyModal : () => {};
window.checkVitaUpdateManual = typeof checkVitaUpdateManual === 'function' ? checkVitaUpdateManual : () => {};
window.selectGameDirective = selectGameDirective;
window.selectDeviceChoice = typeof selectDeviceChoice === 'function' ? selectDeviceChoice : () => {};
window.confirmDeviceChoiceAndPlay = typeof confirmDeviceChoiceAndPlay === 'function' ? confirmDeviceChoiceAndPlay : () => {};
window.playWebGame = typeof playWebGame === 'function' ? playWebGame : () => {};
window.installPwaFromHub = typeof installPwaFromHub === 'function' ? installPwaFromHub : () => {};
window.homeBeep = homeBeep;

// Otomatis sinkronkan profil operatif dengan Supabase saat Hub dibuka
async function autoSyncCloudOnStartup() {
  const prof = getProfile();
  if (!prof || !prof.isLoggedIn || prof.provider === 'guest' || prof.name === 'GUEST-77') return;
  if (typeof isSupabaseConfigured === 'function' && isSupabaseConfigured() && typeof fetchOperativeByCallsign === 'function') {
    try {
      const remote = await fetchOperativeByCallsign(prof.name);
      if (remote && typeof syncAccountDataFromCloud === 'function') {
        syncAccountDataFromCloud(remote);
      } else if (!remote && typeof syncProfileToSupabase === 'function') {
        await syncProfileToSupabase(prof);
      }
    } catch (e) {
      console.warn('Auto cloud sync on startup:', e);
    }
  }
}
