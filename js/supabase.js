
// VITA - Supabase REST Client Module (Pure Fetch / Zero Dependency)

const SUPABASE_CONFIG_KEY = 'vita_supabase_config';
// v2.0: no hardcoded credentials in source. User pastes URL+anon key
// via Supabase Cloud DB modal; stored only in this browser's localStorage.
const DEFAULT_SUPABASE_URL = 'https://msribsirdpovuegligcx.supabase.co';
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zcmlic2lyZHBvdnVlZ2xpZ2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MzgxNjgsImV4cCI6MjEwNTAxNDE2OH0.zxjpGcBnphJG5bCkVH__Ez204obVowIQV4q6Cewl_O4';

function getSupabaseConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || '{}');
    if (raw && typeof raw === 'object') {
      const url = (typeof raw.url === 'string' && raw.url) ? raw.url : DEFAULT_SUPABASE_URL;
      const anonKey = (typeof raw.anonKey === 'string' && raw.anonKey) ? raw.anonKey : DEFAULT_SUPABASE_KEY;
      if (url && anonKey) return { url, anonKey };
    }
  } catch (e) {}
  return { url: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_KEY };
}

function setSupabaseConfig(url, anonKey) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1\/?$/i, '');
  const cleanKey = String(anonKey || '').trim();
  const cfg = { url: cleanUrl, anonKey: cleanKey };
  try {
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {}
  return cfg;
}

function isSupabaseConfigured() {
  try {
    const cfg = getSupabaseConfig();
    return Boolean(cfg && typeof cfg.url === 'string' && typeof cfg.anonKey === 'string' && cfg.url && cfg.anonKey && cfg.url.toLowerCase().startsWith('http'));
  } catch (e) { return false; }
}

async function supabaseFetch(endpoint, options = {}) {
  const cfg = getSupabaseConfig();
  if (!isSupabaseConfigured()) {
    throw new Error('Facility uplink belum dikonfigurasi.');
  }

  const url = `${cfg.url}/rest/v1/${endpoint.replace(/^\/+/, '')}`;
  const headers = {
    'apikey': cfg.anonKey,
    'Authorization': `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    let errText = '';
    try {
      const errJson = await response.json();
      errText = errJson.message || errJson.error || JSON.stringify(errJson);
    } catch (e) {
      errText = await response.text();
    }
    throw new Error(`Uplink Error (${response.status}): ${errText}`);
  }

  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}

// ---- Keamanan Kriptografi: Client-Side SHA-256 Passcode Hashing ----
function isHashedPasscode(str) {
  if (!str || typeof str !== 'string') return false;
  return (/^[0-9a-f]{64}$/i.test(str) || str.startsWith('hf_'));
}

async function hashPasscode(callsign, passcode) {
  if (!passcode) return '';
  const salt = `VITA_FACILITY_AUTH_SALT_v1_${String(callsign || '').trim().toLowerCase()}_`;
  const text = salt + String(passcode);
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}

  // Fallback hashing jika Web Crypto API tidak aktif
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'hf_' + Math.abs(hash).toString(16);
}

async function comparePasscode(inputPasscode, storedPasscode, callsign) {
  if (!storedPasscode) return true; // Akun tanpa passcode
  if (!inputPasscode) return false;

  // 1. Cek langsung jika profil legacy lama masih plaintext
  if (inputPasscode === storedPasscode) return true;

  // 2. Cek kecocokan hash SHA-256
  const hashedInput = await hashPasscode(callsign, inputPasscode);
  return hashedInput === storedPasscode;
}

// Verifikasi sandi operatif via Secure RPC (Fallback ke verifikasi lokal jika RPC belum ada)
async function verifyOperativePasscode(username, passcode) {
  if (!isSupabaseConfigured() || !username) {
    return { ok: false, reason: 'unconfigured' };
  }
  const hashedPass = passcode ? (isHashedPasscode(passcode) ? passcode : await hashPasscode(username, passcode)) : '';
  
  // 1. Coba verifikasi di server lewat PostgreSQL RPC Function (Paling Aman)
  try {
    const rpcRes = await supabaseFetch('rpc/verify_operative_passcode', {
      method: 'POST',
      body: JSON.stringify({
        p_username: username.trim(),
        p_passcode_hash: hashedPass
      })
    });
    if (rpcRes && typeof rpcRes === 'object' && ('ok' in rpcRes)) {
      return rpcRes;
    }
  } catch (rpcErr) {
    // Abaikan jika RPC belum di-deploy di Supabase remote, lanjut ke legacy check
  }

  // 2. Fallback: Cek manual dari data remote
  const remote = await fetchOperativeByCallsign(username);
  if (!remote) return { ok: false, reason: 'not_found' };
  const passOk = await comparePasscode(passcode, remote.passcode, username);
  return passOk ? { ok: true, profile: remote } : { ok: false, reason: 'invalid_passcode' };
}

// 1. Simpan atau perbarui profil & pencapaian akun ke Supabase (Smart UPSERT & Schema Fallback)
async function syncProfileToSupabase(prof) {
  if (!isSupabaseConfigured() || !prof || !prof.name || prof.provider === 'guest' || !prof.isLoggedIn) {
    return null;
  }

  try {
    const hashedPass = prof.passcode 
      ? (isHashedPasscode(prof.passcode) ? prof.passcode : await hashPasscode(prof.name, prof.passcode))
      : '';

    // Ambil data progres & pencapaian operatif dari storage lokal
    let high = {};
    try { high = JSON.parse(localStorage.getItem('vita_high') || '{}'); } catch (e) {}
    const safeHighLevel = Math.max(1, Math.min(15, Math.round(Number(high.highestLevel) || 1)));
    const safeKills = Math.max(0, Math.round(Number(high.totalKills) || 0));
    const safeTime = Math.max(0, Math.round(Number(high.bestTime) || 0));
    const safeScore = Math.max(0, Math.round(Number(high.score) || 0));
    const safeWeapons = (Array.isArray(high.savedWeapons) && high.savedWeapons.length) ? high.savedWeapons : ['knife'];
    const safePerks = Array.isArray(high.savedPerks) ? high.savedPerks : [];
    const safePLevel = Math.max(1, Math.round(Number(high.savedPLevel) || 1));
    const safeExp = Math.max(0, Math.round(Number(high.savedExp) || 0));

    // Serialisasi progress ke metadata clearance sebagai jaminan anti-gagal
    const metaObj = {
      lvl: safeHighLevel,
      kills: safeKills,
      time: safeTime,
      score: safeScore,
      wpns: safeWeapons,
      prks: safePerks,
      plvl: safePLevel,
      exp: safeExp
    };
    const baseClearance = String(prof.status || 'LEVEL-1').split('#M:')[0].trim();
    const compositeClearance = `${baseClearance}#M:${JSON.stringify(metaObj)}`;

    // 1. Coba jalankan Secure RPC Upsert terlebih dahulu (Anti-Hijack & Proteksi Sandi)
    try {
      const rpcPayload = {
        p_username: prof.name,
        p_passcode_hash: hashedPass,
        p_role: prof.role || 'Operatif Lapangan',
        p_avatar: (prof.avatar && prof.avatar.length < 50000) ? prof.avatar : '',
        p_preset_emoji: prof.presetEmoji || 'biohazard',
        p_provider: prof.provider || 'facility',
        p_clearance: compositeClearance
      };
      const rpcResult = await supabaseFetch('rpc/upsert_operative_profile', {
        method: 'POST',
        body: JSON.stringify(rpcPayload)
      });
      if (rpcResult && rpcResult.ok) {
        return rpcResult;
      }
      if (rpcResult && rpcResult.ok === false && rpcResult.reason === 'unauthorized') {
        throw new Error(rpcResult.message || 'Passcode tidak cocok.');
      }
    } catch (rpcErr) {
      if (rpcErr.message && rpcErr.message.includes('Passcode')) {
        throw rpcErr;
      }
    }

    // 2. Direct Table Upsert
    const existing = await fetchOperativeByCallsign(prof.name);

    const payload = {
      username: prof.name,
      role: prof.role || 'Operatif Lapangan',
      preset_emoji: prof.presetEmoji || 'biohazard',
      provider: prof.provider || 'facility',
      clearance: compositeClearance,
      avatar: (prof.avatar && prof.avatar.length < 50000) ? prof.avatar : '',
      highest_level: safeHighLevel,
      total_kills: safeKills,
      best_time: safeTime,
      high_score: safeScore,
      saved_weapons: safeWeapons,
      saved_perks: safePerks,
      saved_plevel: safePLevel,
      saved_exp: safeExp,
      updated_at: new Date().toISOString()
    };

    if (hashedPass) {
      payload.passcode = hashedPass;
    }

    let targetEndpoint = 'profiles';
    let method = 'POST';

    if (existing && existing.id) {
      targetEndpoint = `profiles?id=eq.${encodeURIComponent(existing.id)}`;
      method = 'PATCH';
    }

    try {
      return await supabaseFetch(targetEndpoint, {
        method,
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // Fallback jika database Supabase remote belum memiliki kolom-kolom baru (PGRST204)
      if (err.message && err.message.includes('PGRST204')) {
        console.warn('[UPLINK FALLBACK] Kolom baru belum ada di schema remote. Mengirim via core payload...');
        delete payload.highest_level;
        delete payload.total_kills;
        delete payload.best_time;
        delete payload.high_score;
        delete payload.saved_weapons;
        delete payload.saved_perks;
        delete payload.saved_plevel;
        delete payload.saved_exp;
        if (err.message.includes('passcode')) delete payload.passcode;
        return await supabaseFetch(targetEndpoint, {
          method,
          body: JSON.stringify(payload)
        });
      }
      throw err;
    }
  } catch (err) {
    console.warn('Gagal sinkron profil & pencapaian ke facility network:', err.message);
    return null;
  }
}

// Sinkronkan data akun & seluruh pencapaian dari remote profile ke sistem lokal
function syncAccountDataFromCloud(remote) {
  if (!remote || !remote.username) return null;

  let meta = null;
  if (typeof remote.clearance === 'string' && remote.clearance.includes('#M:')) {
    try {
      const parts = remote.clearance.split('#M:');
      meta = JSON.parse(parts[1]);
    } catch (e) {}
  }

  const highestLevel = Math.max(1, Math.min(15, Math.round(Number(remote.highest_level || (meta && meta.lvl) || 1))));
  const totalKills = Math.max(0, Math.round(Number(remote.total_kills || (meta && meta.kills) || 0)));
  const bestTime = Math.max(0, Math.round(Number(remote.best_time || (meta && meta.time) || 0)));
  const score = Math.max(0, Math.round(Number(remote.high_score || (meta && meta.score) || 0)));
  const savedWeapons = (Array.isArray(remote.saved_weapons) && remote.saved_weapons.length)
    ? remote.saved_weapons
    : ((meta && Array.isArray(meta.wpns) && meta.wpns.length) ? meta.wpns : ['knife']);
  const savedPerks = Array.isArray(remote.saved_perks)
    ? remote.saved_perks
    : ((meta && Array.isArray(meta.prks)) ? meta.prks : []);
  const savedPLevel = Math.max(1, Math.round(Number(remote.saved_plevel || (meta && meta.plvl) || 1)));
  const savedExp = Math.max(0, Math.round(Number(remote.saved_exp || (meta && meta.exp) || 0)));

  // Update vita_high (save data roguelite)
  let high = {};
  try { high = JSON.parse(localStorage.getItem('vita_high') || '{}'); } catch (e) {}
  high.highestLevel = Math.max(Number(high.highestLevel) || 1, highestLevel);
  high.lastLevel = Math.max(0, highestLevel - 1);
  high.totalKills = Math.max(Number(high.totalKills) || 0, totalKills);
  if (bestTime > 0) high.bestTime = (!high.bestTime || bestTime < high.bestTime) ? bestTime : high.bestTime;
  if (score > 0) high.score = Math.max(Number(high.score) || 0, score);
  high.savedWeapons = [...new Set([...(high.savedWeapons || ['knife']), ...savedWeapons])];
  high.savedPerks = savedPerks.length ? savedPerks : (high.savedPerks || []);
  high.savedPLevel = Math.max(Number(high.savedPLevel) || 1, savedPLevel);
  high.savedExp = Math.max(Number(high.savedExp) || 0, savedExp);

  try {
    localStorage.setItem('vita_high', JSON.stringify(high));
  } catch (e) {}

  // Update vita_profile
  const cleanStatus = String(remote.clearance || `${(remote.role || 'OPERATIVE').toUpperCase()} // CLOUD SYNCED`).split('#M:')[0].trim();
  const prof = {
    isLoggedIn: true,
    name: remote.username,
    role: remote.role || 'Field Operative',
    avatar: (remote.avatar && remote.avatar.length < 50000) ? remote.avatar : '',
    presetEmoji: remote.preset_emoji || 'biohazard',
    passcode: remote.passcode || '',
    provider: 'facility',
    status: cleanStatus || `${(remote.role || 'OPERATIVE').toUpperCase()} // CLOUD SYNCED`
  };

  try {
    localStorage.setItem('vita_profile', JSON.stringify(prof));
  } catch (e) {}

  if (typeof saveLocalAccount === 'function') {
    saveLocalAccount(prof);
  }
  if (typeof applyProfileUI === 'function') {
    applyProfileUI();
  }
  if (typeof checkContinueBtn === 'function') {
    checkContinueBtn();
  }

  return { prof, high };
}

// Ambil profil operatif berdasarkan username dari Supabase (Case-Insensitive & Terkini)
async function fetchOperativeByCallsign(username) {
  if (!isSupabaseConfigured() || !username) return null;
  try {
    const data = await supabaseFetch(`profiles?username=ilike.${encodeURIComponent(username.trim())}&order=updated_at.desc&limit=1`, {
      method: 'GET'
    });
    return (Array.isArray(data) && data.length > 0) ? data[0] : null;
  } catch (err) {
    console.warn('Gagal mencari profil di facility network:', err.message);
    return null;
  }
}

// 2. Kirim skor & rekor bermain ke Leaderboard Supabase (Sanitasi Integritas)
async function submitScoreToSupabase(data) {
  if (!isSupabaseConfigured() || !data || !data.username) return null;
  try {
    const rawTime = Math.round(Number(data.bestTime) || 0);
    // Batasan minimal waktu bermain yang realistis (15 detik) untuk mencegah bot injeksi
    const safeTime = Math.max(15, rawTime);
    const safeLevel = Math.max(1, Math.min(15, Math.round(Number(data.highestLevel) || 1)));
    const validGrades = ['S', 'A', 'B', 'C'];
    const safeGrade = validGrades.includes(data.grade) ? data.grade : 'B';

    const payload = {
      username: String(data.username || 'Operatif Anonim').trim().slice(0, 32),
      role: data.role || 'Operatif Lapangan',
      preset_emoji: data.presetEmoji || 'biohazard',
      avatar: (data.avatar && data.avatar.length < 50000) ? data.avatar : '',
      best_time: safeTime,
      total_kills: Math.max(0, Math.round(Number(data.totalKills) || 0)),
      highest_level: safeLevel,
      grade: safeGrade
    };

    return await supabaseFetch('leaderboard', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('Gagal kirim skor ke facility network:', err.message);
    return null;
  }
}

// 3. Ambil daftar Top Leaderboard dari Supabase
async function fetchTopLeaderboard(limit = 10) {
  if (!isSupabaseConfigured()) return [];
  try {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
    const data = await supabaseFetch(`leaderboard?select=username,role,preset_emoji,avatar,best_time,total_kills,highest_level,grade&order=highest_level.desc,best_time.asc,total_kills.desc&limit=${safeLimit}`, {
      method: 'GET'
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('Gagal memuat leaderboard dari facility network:', err.message);
    return [];
  }
}

// 4. Tes koneksi Supabase langsung dari UI (Audit Schema & Fitur Lengkap)
async function testSupabaseConnection(url, anonKey) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1\/?$/i, '');
  const cleanKey = String(anonKey || '').trim();
  if (!cleanUrl || !cleanKey) {
    return { ok: false, message: 'URL atau Anon Key tidak boleh kosong.' };
  }

  try {
    const headers = {
      'apikey': cleanKey,
      'Authorization': `Bearer ${cleanKey}`,
      'Content-Type': 'application/json'
    };

    const resLeader = await fetch(`${cleanUrl}/rest/v1/leaderboard?select=id&limit=1`, { method: 'GET', headers });
    if (!resLeader.ok) {
      const txt = await resLeader.text();
      return { ok: false, message: `Gagal akses leaderboard (${resLeader.status}): ${txt}` };
    }

    const resProf = await fetch(`${cleanUrl}/rest/v1/profiles?select=id&limit=1`, { method: 'GET', headers });
    if (!resProf.ok) {
      const txt = await resProf.text();
      return { ok: false, message: `Gagal akses profiles (${resProf.status}): ${txt}` };
    }

    // Cek ketersediaan kolom passcode di remote database
    const resPass = await fetch(`${cleanUrl}/rest/v1/profiles?select=passcode&limit=1`, { method: 'GET', headers });
    const hasPasscodeCol = resPass.ok;

    // Cek ketersediaan Secure RPC
    let hasRpc = false;
    try {
      const rpcCheck = await fetch(`${cleanUrl}/rest/v1/rpc/verify_operative_passcode`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_username: '__ping__', p_passcode_hash: '' })
      });
      hasRpc = (rpcCheck.status !== 404);
    } catch (e) {}

    setSupabaseConfig(cleanUrl, cleanKey);
    let msg = 'Uplink fasilitas berhasil tersambung! ';
    if (hasRpc) {
      msg += '(Jaringan siap penuh dengan verifikasi aman & sanitasi backend)';
    } else if (hasPasscodeCol) {
      msg += '(Jaringan siap. Tips: jalankan query update SQL terbaru untuk mengaktifkan verifikasi aman).';
    } else {
      msg += '(Catatan: jalankan migrasi SQL agar sinkronisasi sandi network aktif).';
    }

    return {
      ok: true,
      hasPasscodeCol,
      hasRpc,
      message: msg
    };
  } catch (e) {
    return { ok: false, message: `Koneksi gagal: ${e.message}. Pastikan URL dan Internet aktif.` };
  }
}
