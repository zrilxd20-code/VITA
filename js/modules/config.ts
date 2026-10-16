// VITA Configuration & Constants Module
// Single source of truth for all game constants, settings, and i18n

export const VITA_SAVE_KEY = 'vita_save';
export const VITA_HIGH_KEY = 'vita_high';
export const VITA_DIFFS = ['easy', 'normal', 'hard'] as const;
export const VITA_QUALS = ['smooth', 'retro', 'chunky'] as const;

export type Difficulty = typeof VITA_DIFFS[number];
export type Quality = typeof VITA_QUALS[number];

export const CELL = 32;
export const LEVELS = 15;
export const PIXEL_SCALES = { smooth: 2, retro: 3, chunky: 4 } as const;

export const DIFF_SPEED_MULT = { easy: 0.8, normal: 1.0, hard: 1.2 } as const;
export const DIFF_STAT_MULT = { easy: 0.75, normal: 1.0, hard: 1.3 } as const;
export const DIFF_DETECT_MULT = { easy: 0.85, normal: 1.0, hard: 1.2 } as const;

export const SEKTOR_MODS = [
    { torchMult: 1.15, detectMult: 0.75, speedMult: 1.0, fogTint: null, heartbeat: false },
    { torchMult: 1.10, detectMult: 0.80, speedMult: 1.0, fogTint: null, heartbeat: false },
    { torchMult: 0.85, detectMult: 1.0, speedMult: 1.0, fogTint: 'rgba(40,80,20,0.08)', heartbeat: false },
    { torchMult: 0.80, detectMult: 1.0, speedMult: 0.95, fogTint: 'rgba(40,80,20,0.12)', heartbeat: false },
    { torchMult: 0.90, detectMult: 1.0, speedMult: 0.88, fogTint: 'rgba(80,15,15,0.06)', heartbeat: false },
    { torchMult: 0.85, detectMult: 1.05, speedMult: 0.85, fogTint: 'rgba(80,15,15,0.08)', heartbeat: false },
    { torchMult: 0.82, detectMult: 1.15, speedMult: 1.0, fogTint: 'rgba(60,20,80,0.07)', heartbeat: false },
    { torchMult: 0.78, detectMult: 1.20, speedMult: 1.0, fogTint: 'rgba(60,20,80,0.10)', heartbeat: false },
    { torchMult: 0.75, detectMult: 1.35, speedMult: 1.0, fogTint: 'rgba(90,10,10,0.06)', heartbeat: true },
    { torchMult: 0.72, detectMult: 1.45, speedMult: 0.95, fogTint: 'rgba(90,10,10,0.09)', heartbeat: true },
    { torchMult: 0.60, detectMult: 1.30, speedMult: 1.0, fogTint: 'rgba(0,0,0,0.12)', heartbeat: true },
    { torchMult: 0.55, detectMult: 1.35, speedMult: 0.92, fogTint: 'rgba(0,0,0,0.15)', heartbeat: true },
    { torchMult: 0.65, detectMult: 1.40, speedMult: 0.90, fogTint: 'rgba(120,0,0,0.10)', heartbeat: true },
    { torchMult: 0.62, detectMult: 1.50, speedMult: 0.88, fogTint: 'rgba(120,0,0,0.14)', heartbeat: true },
    { torchMult: 1.0, detectMult: 1.0, speedMult: 1.0, fogTint: 'rgba(140,10,0,0.05)', heartbeat: true }
] as const;

export function getSektorMod(level: number) {
    return SEKTOR_MODS[Math.max(0, Math.min(SEKTOR_MODS.length - 1, level))] || SEKTOR_MODS[0];
}

export function getDiffSpeedMult(difficulty: Difficulty) {
    return DIFF_SPEED_MULT[difficulty] ?? 1.0;
}

export function getDiffStatMult(difficulty: Difficulty) {
    return DIFF_STAT_MULT[difficulty] ?? 1.0;
}

export function getDiffDetectMult(difficulty: Difficulty) {
    return DIFF_DETECT_MULT[difficulty] ?? 1.0;
}

export interface Settings {
    volume: number;
    brightness: number;
    difficulty: Difficulty;
    lang: 'id' | 'en';
    quality: Quality;
}

export function sanitizeSettings(raw: unknown): Settings {
    const s = (raw && typeof raw === 'object') ? raw : {};
    let volume = Math.round(Number(s.volume));
    if (!Number.isFinite(volume)) volume = 70;
    volume = Math.max(0, Math.min(100, volume));
    
    let brightness = Math.round(Number(s.brightness));
    if (!Number.isFinite(brightness)) brightness = 100;
    brightness = Math.max(30, Math.min(180, brightness));
    
    const difficulty = VITA_DIFFS.includes(s.difficulty as Difficulty) ? s.difficulty as Difficulty : 'normal';
    const lang = s.lang === 'id' ? 'id' : 'en';
    const quality = VITA_QUALS.includes(s.quality as Quality) ? s.quality as Quality : 'retro';
    
    return { volume, brightness, difficulty, lang, quality };
}

export function brightnessMul(brightness: number) {
    const b = Number(brightness);
    if (!Number.isFinite(b)) return 1;
    return Math.min(1.4, Math.max(0.2, (200 - b) / 100));
}

export type Language = 'id' | 'en';
export let currentLang: Language = 'en';

export const T = {
    id: {
        ui_level: 'Level:', ui_mode: 'Mode:', ui_diff: 'Kesulitan:', ui_hp: 'HP:', ui_atk: 'Attack:',
        ui_monster: 'Monster:', ui_artifact: 'Artefak:', ui_exit: 'Exit:', ui_time: 'Waktu:',
        mode_light: 'TERANG', mode_dark: 'GELAP',
        exit_open: 'TERBUKA', exit_locked: 'TERKUNCI',
        ctrl_bar: 'WASD / Panah / Joystick: Gerak | SPACE / KLIK: Serang | SHIFT: Dash | ESC: Jeda | M: Bisukan',
        pause_title: 'JEDA OPERASI', resume: 'LANJUT', restart: 'ULANGI DARI AWAL', main_menu: 'MENU UTAMA',
        start_subtitle: 'Maze Monster Trainer — 15 Level', play_now: 'MAIN SEKARANG',
        settings: 'PENGATURAN', how_to_play: 'CARA MAIN',
        volume: 'Volume', brightness: 'Kecerahan', language: 'Bahasa', close: 'Tutup',
        diff_label: 'Kesulitan', diff_easy: 'Mudah', diff_normal: 'Normal', diff_hard: 'Sulit',
        quality: 'Kualitas', quality_smooth: 'Halus', quality_retro: 'Retro', quality_chunky: 'Kasar',
        ctrl1: 'WASD / Panah: bergerak', ctrl2: 'SPACE / Klik: menyerang', ctrl3: 'SHIFT: dash kebal — tembus jebakan & serangan',
        ctrl4: 'Kumpulkan semua artefak lalu menuju pintu keluar.',
        death_title: '[ SUBJEK TERMINASI // GUGUR ]', death_level_lbl: 'Sektor tercapai:', death_kills_lbl: 'Anomali dinetralisir:',
        retry: 'DARI AWAL', retry_level: 'ULANGI LEVEL INI',
        muted_on: 'Suara mati (tekan M untuk nyalakan)', muted_off: 'Suara nyala',
        win_title: '[ SEKTOR BERSIH // FASILITAS AMAN ]', win_sub: 'Semua 15 sektor & The Monolith telah ditaklukkan!',
        win_kills_lbl: 'Total anomali dinetralisir:', win_time_lbl: 'Waktu total:',
        win_best_lbl: 'Rekor terbaik:', play_again: 'MAIN LAGI',
        win_grade_lbl: 'Peringkat:', new_best: '[ REKOR BARU TERTINGGI ]',
        announce_light: 'PROTOKOL: TERANG', announce_dark: 'PROTOKOL: GELAP',
        exit_locked_label: 'AIRLOCK TERKUNCI', need_more_artifacts: 'Butuh {n} artefak lagi',
        msg_exit_locked: 'Airlock terkunci! Cari {n} artefak lagi!',
        arrow_artifact: 'ARTEFAK', arrow_exit: 'EXIT',
        trap_hit: 'Jebakan Duri! -{n} HP', level_up: 'NAIK TINGKAT! HP+{h} ATK+{a}',
        death_time_lbl: 'Waktu bermain:', ui_bpm: 'BIOMETRIK:', death_cause_lbl: 'Penyebab Kematian:',
        death_stamp: 'SUBJEK: DIMANGSA', win_stamp: 'SEKTOR DIBERSIHKAN',
        admin_btn: 'ADMIN', admin_login_title: 'LOGIN ADMIN',
        admin_login_desc: 'Masukkan kode admin untuk mode testing.',
        admin_code_lbl: 'Kode', admin_enter: 'MASUK', admin_cancel: 'Batal',
        admin_wrong: 'Kode salah! Akses ditolak.',
        admin_panel_title: 'PANEL ADMIN // FASILITAS',
        admin_panel_desc: 'Lompat ke level / boss mana pun untuk testing.',
        admin_boss: 'UJI THE MONOLITH (LV 15)', admin_unlock: 'BUKA AIRLOCK EXIT',
        admin_god_on: 'PROTOKOL KEBAL: ON', admin_god_off: 'PROTOKOL KEBAL: OFF',
        admin_kill: 'PURGE SEMUA MONSTER', admin_logout: 'LOGOUT ADMIN',
        admin_jump_msg: 'Lompat ke Sektor ', admin_welcome: 'Konsol admin aktif.',
        armory_title: 'PILIH PASOKAN SENJATA BARU',
        armory_eyebrow: 'ARSENAL OPERATIF // PROTOKOL PENAHANAN ANOMALI',
        armory_sub: 'Tingkat anomali sektor meningkat! Ambil 1 persenjataan taktis untuk melanjutkan misi:',
        armory_choose: 'PILIH SENJATA INI',
        armory_owned: 'SUDAH DIMILIKI',
        armory_claim: 'PASOKAN DITERIMA: {w}!',
        weapon_knife: 'Pisau Taktis',
        weapon_knife_role: 'Melee Jarak Dekat',
        weapon_knife_desc: 'Tebasan pisau bedah cepat tanpa amunisi. Mementalkan anomali dalam jarak sangat dekat.',
        weapon_rifle: 'Senapan Taktis',
        weapon_rifle_role: 'Presisi Jarak Jauh',
        weapon_rifle_desc: 'Menembakkan peluru berkecepatan tinggi lurus ke arah bidikan dengan akurasi presisi tinggi.',
        weapon_grenade: 'Granat Biologis EMP',
        weapon_grenade_role: 'Ledakan Pantul Area (AoE)',
        weapon_grenade_desc: 'Dilempar memantul di lorong dan meledak area luas setelah 1 detik atau saat terkena anomali.',
        weapon_bazooka: 'Peluncur Roket Berat',
        weapon_bazooka_role: 'Artileri Berat Anti-Brute',
        weapon_bazooka_desc: 'Meluncurkan roket berhulu ledak tinggi dengan jejak asap. Meledak dahsyat saat menabrak target/dinding.',
        weapon_shield: 'Perisai Kinetik',
        weapon_shield_role: 'Pertahanan & Pemantul',
        weapon_shield_desc: 'Mengaktifkan kubah neon pelindung kebal 2.5 detik. Memusnahkan peluru musuh dan mementalkan monster.',
        weapon_minigun: 'Vulcan Rotary Minigun',
        weapon_minigun_role: 'Hujan Peluru Beruntun',
        weapon_minigun_desc: 'Menembakkan rentetan peluru cepat beruntun tanpa jeda. Waspadai panas berlebih (overheat)!',
        spec_dmg: 'Kerusakan', spec_rate: 'Laju Tembak', spec_range: 'Jangkauan', spec_special: 'Sifat Khas',
        weapon_overheated: 'SENJATA OVERHEAT!',
        weapon_switch_hint: '1-5 / Q / E / Scroll: Ganti Senjata',
        skill_backstab: 'CRITICAL BACKSTAB! 2.2x',
        skill_pulse: 'KINETIC PULSE DISCHARGE!',
        skill_purge: 'THERMAL PURGE STEAM!',
        armory_choose_perk: 'PASANG AUGMENTASI INI',
        perk_claim: 'AUGMENTASI AKTIF: {p}!',
        perk_nano_name: 'Lapisan Zirah Nanit',
        perk_nano_role: 'Pertahanan & Bio-Regenerasi',
        perk_nano_desc: 'Menyematkan struktur nanit peredam impak: Max HP +50, memulihkan HP secara instan, dan mereduksi 25% kerusakan yang diterima.',
        perk_adren_name: 'Injektor Adrenalin Servo',
        perk_adren_role: 'Kelincahan & Phase Dash',
        perk_adren_desc: 'Stimulan neuromuskular sintetis: Kecepatan lari meningkat 18% dan waktu cooldown Phase Dash dipangkas separuh.',
        perk_plasma_name: 'Munisi Plasma Hyper-Charge',
        perk_plasma_role: 'Daya Rusak Taktis Global',
        perk_plasma_desc: 'Menyelimuti seluruh proyektil dan bilah senjata dengan energi plasma superpanas, mendongkrak ATK seluruh senjata +30%.',
        perk_cryo_name: 'Penyerap Panas Cryo-Vent',
        perk_cryo_role: 'Disipasi Termal & Cooldown',
        perk_cryo_desc: 'Kondensor pendingin nitrogen cair: memotong cooldown seluruh serangan 35% dan mengurangi akumulasi panas Minigun 50%.',
        prologue_skip: 'LEWATI ▸▸',
        prologue_continue: 'TEKAN TOMBOL APAPUN UNTUK MELANJUTKAN',
        prologue_classify: 'RAHASIA TERTINGGI // HANYA UNTUK PERSONEL BERWENANG',
        prologue_date: 'LOG INSIDEN — HARI KE-0 // FASILITAS VITA',
        prologue_title: 'SEKTOR TERLUPAKAN',
        combo_double: 'ELIMINASI GANDA',
        combo_triple: 'ELIMINASI TIGA',
        combo_carnage: 'BANTAIAN // CARNAGE',
        combo_godlike: 'TAK TERBENDUNG // OVERKILL',
        lore_disc_found: 'DATA DISC DITEMUKAN',
        barrel_detonated: '💥 BIOHAZARD MELEDAK 💥',
        boss_monolith_phase1: 'FASE I // INTI RUNIK',
        boss_monolith_phase2: 'FASE II // MATA KOSMIK',
        boss_monolith_phase3: 'FASE III // AMUKAN NOVA',
        obj_collect: 'KUMPULKAN ARTEFAK', obj_exit: 'MENUJU EXIT // AIRLOCK TERBUKA',
        tut_move: 'WASD / Joystick: bergerak — kumpulkan artefak berpendar',
        tut_attack: 'SPACE / Klik: serang ke arah kursor. SHIFT: dash kebal!',
        tut_exit: 'Semua artefak didapat! Cari portal EXIT hijau sekarang!',
        perk_vamp_name: 'Sifon Biomassa Nanit',
        perk_vamp_role: 'Regenerasi Darah & Combo',
        perk_vamp_desc: 'Setiap anomali yang dinetralisir memulihkan +12 HP (+20 HP saat combo multi-kill).',
        perk_rico_name: 'Matriks Defleksi Plasma',
        perk_rico_role: 'Peluru Pantul Sudut',
        perk_rico_desc: 'Peluru senjata memantul dari dinding lorong hingga 2 kali dengan lontaran percikan energi neon.',
        perk_emp_name: 'Empas Kejut Kinetik',
        perk_emp_role: 'Gelombang Kejut Dash',
        perk_emp_desc: 'Melakukan Phase Dash memancarkan gelombang kejut EMP yang mementalkan dan melumpuhkan musuh terdekat.',
        perk_therm_name: 'Saluran Api Termal',
        perk_therm_role: 'Jejak Plasma Pembakar',
        perk_therm_desc: 'Phase Dash meninggalkan jejak api plasma membakar yang melukai anomali pengejar di lorong.',
        medpod_heal: '+60 HP [RUANG NANIT MEDIS DIAKTIFKAN]',
        codex_title: 'ARSIP DOKUMEN RAHASIA',
        codex_btn: 'ARSIP RAHASIA',
        codex_empty: 'Belum ada data disc yang ditemukan. Jelajahi lorong labirin!',
        status_poisoned: 'KERACUNAN NEUROTOKSIN',
        status_burning: 'TERBAKAR',
        status_frozen: 'MEMBEKU',
        status_stunned: 'LUMPUH',
        weak_point_hit: 'TITIK LEMAH TERKENA! 2.5x',
        monolith_weak_exposed: '⚠️ INTI KOSMIK MONOLITH TERBUKA! SERANG SEKARANG! ⚠️',
        mimic_ambush: '⚠️ PENYAMARAN TERBONGKAR! MIMIC MENYERGAP! ⚠️',
        dark_knight_riposte: 'PERTAHANAN BALASAN!',
        dragon_firestorm: 'SEMBURAN API NAGA!',
        lich_summon: 'PEMANGGILAN ARWAH GELAP!',
        beholder_sweep: 'SOROTAN SINAR KOSMIK!'
    },
    en: {
        ui_level: 'Level:', ui_mode: 'Mode:', ui_diff: 'Difficulty:', ui_hp: 'HP:', ui_atk: 'Attack:',
        ui_monster: 'Monster:', ui_artifact: 'Artifacts:', ui_exit: 'Exit:', ui_time: 'Time:',
        mode_light: 'LIGHT', mode_dark: 'DARK',
        exit_open: 'OPEN', exit_locked: 'LOCKED',
        ctrl_bar: 'WASD / Arrows / Joystick: Move | SPACE / CLICK: Attack | SHIFT: Dash | ESC: Pause | M: Mute',
        pause_title: 'OPERATION PAUSED', resume: 'RESUME', restart: 'RESTART LEVEL', main_menu: 'MAIN MENU',
        start_subtitle: 'Maze Monster Trainer — 15 Levels', play_now: 'PLAY NOW',
        settings: 'SETTINGS', how_to_play: 'HOW TO PLAY',
        volume: 'Volume', brightness: 'Brightness', language: 'Language', close: 'Close',
        diff_label: 'Difficulty', diff_easy: 'Easy', diff_normal: 'Normal', diff_hard: 'Hard',
        quality: 'Quality', quality_smooth: 'Smooth', quality_retro: 'Retro', quality_chunky: 'Chunky',
        ctrl1: 'WASD / Arrows: move', ctrl2: 'SPACE / Click: attack', ctrl3: 'SHIFT: phase dash — invincible, pass traps & hits',
        ctrl4: 'Collect all artifacts, then reach the exit portal.',
        death_title: '[ SUBJECT TERMINATED // DEAD ]', death_level_lbl: 'Sector reached:', death_kills_lbl: 'Monsters neutralized:',
        retry: 'FROM START', retry_level: 'RETRY LEVEL',
        muted_on: 'Muted (press M to unmute)', muted_off: 'Sound on',
        win_title: '[ SECTOR PURGED // FACILITY SECURE ]', win_sub: 'All 15 sectors conquered & The Monolith neutralized!',
        win_kills_lbl: 'Total monsters neutralized:', win_time_lbl: 'Total time:',
        win_best_lbl: 'Best record:', play_again: 'PLAY AGAIN',
        win_grade_lbl: 'Rank:', new_best: '[ NEW BEST RECORD ]',
        announce_light: 'PROTOCOL: LIGHT', announce_dark: 'PROTOCOL: DARK',
        exit_locked_label: 'EXIT LOCKED', need_more_artifacts: 'Need {n} more artifacts',
        msg_exit_locked: 'Airlock locked! Find {n} more artifacts!',
        arrow_artifact: 'ARTIFACT', arrow_exit: 'EXIT',
        trap_hit: 'Spike Trap! -{n} HP', level_up: 'LEVEL UP! HP+{h} ATK+{a}',
        death_time_lbl: 'Play time:', ui_bpm: 'BIOMETRIC:', death_cause_lbl: 'Cause of Death:',
        death_stamp: 'SUBJECT: TERMINATED', win_stamp: 'SECTOR PURGED',
        admin_btn: 'ADMIN', admin_login_title: 'ADMIN LOGIN',
        admin_login_desc: 'Enter the admin code for testing mode.',
        admin_code_lbl: 'Code', admin_enter: 'ENTER', admin_cancel: 'Cancel',
        admin_wrong: 'Wrong code! Access denied.',
        admin_panel_title: 'ADMIN PANEL // FACILITY',
        admin_panel_desc: 'Jump to any level / boss for testing.',
        admin_boss: 'TEST THE MONOLITH (LV 15)', admin_unlock: 'UNLOCK EXIT AIRLOCK',
        admin_god_on: 'INVULNERABLE: ON', admin_god_off: 'INVULNERABLE: OFF',
        admin_kill: 'PURGE ALL MONSTERS', admin_logout: 'LOGOUT ADMIN',
        admin_jump_msg: 'Jumped to Sector ', admin_welcome: 'Admin mode active.',
        armory_title: 'SELECT NEW WEAPON SUPPLY',
        armory_eyebrow: 'OPERATIVE ARSENAL // ANOMALY CONTAINMENT PROTOCOL',
        armory_sub: 'Sector anomaly level rising! Requisition 1 tactical armament to proceed with the mission:',
        armory_choose: 'SELECT THIS WEAPON',
        armory_owned: 'ALREADY OWNED',
        armory_claim: 'SUPPLY ACQUIRED: {w}!',
        weapon_knife: 'Tactical Knife',
        weapon_knife_role: 'Close Melee',
        weapon_knife_desc: 'Rapid scalpel swipe requiring no ammo. Knocks back biological anomalies at very close range.',
        weapon_rifle: 'Tactical Rifle',
        weapon_rifle_role: 'Long-Range Precision',
        weapon_rifle_desc: 'Fires high-velocity rounds straight toward your crosshair with pinpoint accuracy.',
        weapon_grenade: 'Biological EMP Grenade',
        weapon_grenade_role: 'Bouncing Area Blast (AoE)',
        weapon_grenade_desc: 'Bounces off corridor walls and detonates with wide AoE blast after 1s or on direct contact.',
        weapon_bazooka: 'Heavy Rocket Launcher',
        weapon_bazooka_role: 'Anti-Brute Heavy Artillery',
        weapon_bazooka_desc: 'Launches heavy warhead rocket with smoke trail. Detonates with massive blast on target/wall impact.',
        weapon_shield: 'Kinetic Shield',
        weapon_shield_role: 'Defense & Deflection',
        weapon_shield_desc: 'Activates invulnerable neon dome for 2.5s. Destroys monster bullets and knocks back charging foes.',
        weapon_minigun: 'Vulcan Rotary Minigun',
        weapon_minigun_role: 'Rapid Bullet Storm',
        weapon_minigun_desc: 'Unleashes rapid continuous ballistic stream. Beware of weapon overheating!',
        spec_dmg: 'Damage', spec_rate: 'Fire Rate', spec_range: 'Range', spec_special: 'Trait',
        weapon_overheated: 'WEAPON OVERHEATED!',
        weapon_switch_hint: '1-5 / Q / E / Scroll: Switch Weapon',
        skill_backstab: 'CRITICAL BACKSTAB! 2.2x',
        skill_pulse: 'KINETIC PULSE DISCHARGE!',
        skill_purge: 'THERMAL PURGE STEAM!',
        armory_choose_perk: 'EQUIP THIS AUGMENTATION',
        perk_claim: 'AUGMENTATION ACTIVE: {p}!',
        perk_nano_name: 'Nanite Armor Plating',
        perk_nano_role: 'Defense & Bio-Regeneration',
        perk_nano_desc: 'Integrates impact-absorbing nanite fibers: +50 Max HP, instant full heal, and 25% incoming damage reduction.',
        perk_adren_name: 'Adrenaline Servo Injector',
        perk_adren_role: 'Agility & Rapid Phase Dash',
        perk_adren_desc: 'Synthetic neuromuscular stimulant: Movement speed increased by 18% and Phase Dash cooldown cut in half.',
        perk_plasma_name: 'Hyper-Charge Plasma Munitions',
        perk_plasma_role: 'Global Tactical Firepower',
        perk_plasma_desc: 'Envelops all rounds and knife blades in superheated plasma radiation, boosting all weapon ATK by +30%.',
        perk_cryo_name: 'Cryo-Vent Heat Sinks',
        perk_cryo_role: 'Thermal Dissipation & Cooldown',
        perk_cryo_desc: 'Liquid cryogenic cooling condenser: reduces all attack cooldowns by 35% and cuts Minigun heat generation by 50%.',
        prologue_skip: 'SKIP ▸▸',
        prologue_continue: 'PRESS ANY KEY TO CONTINUE',
        prologue_classify: 'TOP SECRET // AUTHORIZED PERSONNEL ONLY',
        prologue_date: 'INCIDENT LOG — DAY ZERO // VITA FACILITY',
        prologue_title: 'FORGOTTEN SECTOR',
        combo_double: 'DOUBLE KILL',
        combo_triple: 'TRIPLE KILL',
        combo_carnage: 'CARNAGE',
        combo_godlike: 'UNSTOPPABLE // OVERKILL',
        lore_disc_found: 'DATA DISC RECOVERED',
        barrel_detonated: '💥 BIOHAZARD DETONATION 💥',
        boss_monolith_phase1: 'PHASE I // RUNIC CORE',
        boss_monolith_phase2: 'PHASE II // COSMIC EYE',
        boss_monolith_phase3: 'PHASE III // BERSERK NOVA',
        obj_collect: 'COLLECT ARTIFACTS', obj_exit: 'GO TO EXIT // AIRLOCK OPEN',
        tut_move: 'WASD / Joystick: move — collect glowing artifacts',
        tut_attack: 'SPACE / Click: attack toward cursor. SHIFT: invincible dash!',
        tut_exit: 'All artifacts secured! Find the green EXIT portal now!',
        perk_vamp_name: 'Nanite Bio-Siphon',
        perk_vamp_role: 'Blood Regen & Combo',
        perk_vamp_desc: 'Every eliminated anomaly restores +12 HP (+20 HP during multi-kill combo).',
        perk_rico_name: 'Plasma Deflection Matrix',
        perk_rico_role: 'Angled Bullet Ricochet',
        perk_rico_desc: 'Weapon rounds bounce off labyrinth walls up to 2 times with neon energy sparks.',
        perk_emp_name: 'Kinetic EMP Discharge',
        perk_emp_role: 'Dash Shockwave Stun',
        perk_emp_desc: 'Performing Phase Dash discharges a radial kinetic EMP shockwave that stuns and repels nearby foes.',
        perk_therm_name: 'Thermal Exhaust Trail',
        perk_therm_role: 'Incendiary Plasma Trail',
        perk_therm_desc: 'Phase Dash leaves a scorching plasma trail that burns pursuing anomalies in corridors.',
        medpod_heal: '+60 HP [NANITE MED-CHAMBER ACTIVATED]',
        codex_title: 'CLASSIFIED ARCHIVES CODEX',
        codex_btn: 'CLASSIFIED ARCHIVES',
        codex_empty: 'No data discs recovered yet. Search the labyrinth corridors!',
        status_poisoned: 'NEUROTOXIN POISONED',
        status_burning: 'BURNING',
        status_frozen: 'FROZEN',
        status_stunned: 'STUNNED',
        weak_point_hit: 'WEAK POINT HIT! 2.5x',
        monolith_weak_exposed: '⚠️ MONOLITH CORE EXPOSED! STRIKE NOW! ⚠️',
        mimic_ambush: '⚠️ DISGUISE BROKEN! MIMIC AMBUSH! ⚠️',
        dark_knight_riposte: 'RIPOSTE COUNTER-ATTACK!',
        dragon_firestorm: 'DRAGON FIRESTORM!',
        lich_summon: 'DARK SPIRIT SUMMON!',
        beholder_sweep: 'COSMIC EYE BEAM SWEEP!'
    }
} as const;

export function tt(key: string): string {
    return (T[currentLang] && T[currentLang][key as keyof typeof T.id]) || T.id[key as keyof typeof T.id] || key;
}

export function setLang(value: Language) {
    currentLang = value;
}