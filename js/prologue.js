// ============================================================
// VITA FACILITY NARRATIVE COMPENDIUM & LORE ENGINE
// ============================================================
// This compendium drives:
// 1. PROLOGUE_SCRIPT — Cutscene dialogue before Sector 1
// 2. SECTOR_TRANSMISSIONS — Live tactical radio comms during missions
// 3. LORE_DATA_LOGS — Classified blackbox memory terminals in the labyrinth
// 4. EPILOGUE_SCRIPT — Cinematic narrative endings upon purging Sector 15
// ============================================================

const PROLOGUE_SCRIPT = [
    {
        type: 'speaker',
        speaker: '[SYSTEM] — FACILITY WARNING',
        text_en: '"⚠ WARNING — We have entered a danger zone. Beware of anomalies and hostile organisms."',
        text_id: '"⚠ PERINGATAN — Kita telah memasuki zona bahaya. Waspadai anomali dan organisme berbahaya."'
    },
    {
        type: 'divider',
        text_en: '▬▬▬▬▬▬▬',
        text_id: '▬▬▬▬▬▬▬'
    },
    {
        type: 'speaker',
        speaker: 'DR. SARA — LEAD SCIENTIST',
        text_en: '"Um... okay, it should turn on—"',
        text_id: '"Um... oke, seharusnya ini menyala—"'
    },
    {
        type: 'speaker',
        speaker: '???',
        text_en: '"Wait a minute. Give it ten minutes."',
        text_id: '"Tunggu sebentar. Beri waktu sepuluh menit."'
    },
    {
        type: 'narrator',
        text_en: 'The lights flicker. Deep beneath the facility, generators hum to life one by one.',
        text_id: 'Lampu-lampu berkedip. Jauh di bawah fasilitas, generator-generator menderu hidup satu per satu.'
    },
    {
        type: 'speaker',
        speaker: 'DR. RAINSER — SYSTEMS ENGINEER',
        text_en: '"The power is set, Doctor!"',
        text_id: '"Daya sudah aktif, Dokter!"'
    },
    {
        type: 'speaker',
        speaker: 'LT. VAD — SECURITY OFFICER',
        text_en: '"The opening area is clear."',
        text_id: '"Area pembuka aman."'
    },
    {
        type: 'divider',
        text_en: '· · ·',
        text_id: '· · ·'
    },
    {
        type: 'speaker',
        speaker: 'YOU — PROTOTYPE-19',
        text_en: '"...?"',
        text_id: '"...?"'
    },
    {
        type: 'speaker',
        speaker: '???',
        text_en: '"No time for questions. You have to honor your master. Understood? Your mission is to defeat Specimen CARNIS-07."',
        text_id: '"Tidak ada waktu untuk bertanya. Kau harus menghormati mastermu. Paham? Misimu adalah mengalahkan Spesimen CARNIS-07."'
    },
    {
        type: 'speaker',
        speaker: 'YOU — PROTOTYPE-19',
        text_en: '"Roger. [SYSTEM: Mission acknowledged] ...But why?"',
        text_id: '"Diterima. [SYSTEM: Misi dikonfirmasi] ...Tapi kenapa?"'
    },
    {
        type: 'divider',
        text_en: '▬▬▬▬▬▬▬',
        text_id: '▬▬▬▬▬▬▬'
    },
    {
        type: 'narrator',
        text_en: 'You are PROTOTYPE-19 — an agent robot, the last hope of humanity. No memories. No past. Only a directive: survive the 15 sectors and destroy what waits at the end.',
        text_id: 'Kau adalah PROTOTYPE-19 — robot agen, harapan terakhir umat manusia. Tanpa ingatan. Tanpa masa lalu. Hanya satu perintah: bertahan di 15 sektor dan hancurkan apapun yang menunggu di ujung sana.'
    },
];

// In-mission radio transmissions for Sectors 1-10 (focus on maze navigation, combat tactics & survival)
// Sectors 11-15 reserved for upcoming lore bomb
const SECTOR_TRANSMISSIONS = {
    0: {
        speaker: 'DR. SARA — COMMS',
        callsign: 'DR. SARA // RES-01',
        icon: 'dna',
        color: '#2ecc71',
        text_en: 'Prototype-19, bio-telemetry synchronized. Collect all luminous artifacts in the corridors to destabilize the quarantine gate locks. Watch the shadows at the corners!',
        text_id: 'Prototype-19, telemetri biologis tersinkron. Kumpulkan seluruh artefak berpendar di koridor untuk membuka kunci segel gerbang karantina. Waspadai bayangan di tikungan!'
    },
    1: {
        speaker: 'DR. RAINSER — SYSTEMS',
        callsign: 'DR. RAINSER // ENG',
        icon: 'biohazard',
        color: '#3498db',
        text_en: 'Sector generator is experiencing power fluctuations. Keep an eye on the minimap radar to chart dead-end corridors and track nearby anomalies!',
        text_id: 'Generator sektor mengalami fluktuasi daya. Perhatikan radar mini-map di sudut layar untuk membaca rute koridor buntu dan arah anomali terdekat!'
    },
    2: {
        speaker: 'LT. VAD — TACTICAL',
        callsign: 'LT. VAD // SEC-OPS',
        icon: 'shield',
        color: '#3498db',
        text_en: 'Sector 3 is infested with Crawl-Morph nests. They track footstep vibrations. Use your agility to land lethal backstabs from behind or keep your firing distance!',
        text_id: 'Sektor 3 dipenuhi sarang Crawl-Morph. Mereka mendeteksi getaran langkah kaki. Manfaatkan kelincahanmu untuk serangan tusukan belakang (backstab) mematikan atau tembak dari jarak jauh!'
    },
    3: {
        speaker: 'LT. VAD — HAZARD',
        callsign: 'LT. VAD // SEC-OPS',
        icon: 'shield',
        color: '#f1c40f',
        text_en: 'Operative alert! Corridor floors are rigged with mechanical spike traps. Trigger Phase Dash (SHIFT) to surge through spikes and projectiles unharmed!',
        text_id: 'Perhatian operatif! Lantai koridor dipasangi pelat perangkap duri mekanis. Aktifkan Phase Dash (SHIFT) untuk menerobos duri dan proyektil musuh tanpa menerima luka!'
    },
    4: {
        speaker: 'DR. RAINSER — ALARM',
        callsign: 'DR. RAINSER // ENG',
        icon: 'biohazard',
        color: '#e74c3c',
        text_en: 'A massive Bio-Harvester anomaly is patrolling this sector! Avoid engaging in narrow bottlenecks. Lure them into open junctions so you don\'t get cornered!',
        text_id: 'Anomali Bio-Harvester berukuran besar berpatroli di sektor ini! Jangan bertarung di lorong sempit satu arah. Pancing mereka ke ruang terbuka agar kamu tidak terpojok!'
    },
    5: {
        speaker: 'LT. VAD — ARMORY',
        callsign: 'LT. VAD // SEC-OPS',
        icon: 'shield',
        color: '#2ecc71',
        text_en: 'Adapt your arsenal to corridor geometry. Blade for rapid point-blank strikes, Rifle for long corridors, and Grenades to bounce explosives around tight corners!',
        text_id: 'Gunakan senjata yang sesuai situasi lorong. Pisau untuk sergapan cepat tanpa amunisi, Rifle untuk koridor lurus panjang, dan Grenade untuk ledakan sudut dinding!'
    },
    6: {
        speaker: 'DR. SARA — SPECTRAL',
        callsign: 'DR. SARA // RES-01',
        icon: 'dna',
        color: '#9b59b6',
        text_en: 'Spectrometry detects Phantasm anomalies. Labyrinth walls cannot hold them—they phase straight through concrete bulkheads! Do not remain stationary in a room!',
        text_id: 'Spektrometri mendeteksi anomali Phantasm. Dinding labirin tidak dapat menahan mereka—mereka meluncur menembus sekat beton! Jangan berdiam diri di satu ruangan!'
    },
    7: {
        speaker: 'DR. RAINSER — WARNING',
        callsign: 'DR. RAINSER // ENG',
        icon: 'biohazard',
        color: '#e67e22',
        text_en: 'Sensors detect irregular frequencies from supply caches. Stay cautious—some containers are camouflaged Decoy Mimic ambushers! Test them with a strike from range first!',
        text_id: 'Sensor mencatat sinyal aneh dari wadah suplai. Hati-hati saat membuka peti logistik—sebagian adalah Decoy Mimic yang menyamar! Uji dengan serangan dari jauh terlebih dahulu!'
    },
    8: {
        speaker: 'DR. SARA — BIOMETRICS',
        callsign: 'DR. SARA // RES-01',
        icon: 'dna',
        color: '#e74c3c',
        text_en: 'Biometric BPM telemetry is spiking! Anomaly density at intersections is peaking. Prioritize the fastest artifact gathering route and reach the extraction airlock immediately!',
        text_id: 'Grafik biometrik BPM melonjak tajam! Kepadatan monster di persimpangan mencapai puncaknya. Prioritaskan rute pengumpulan artefak tercepat dan segera capai airlock keluar!'
    },
    9: {
        speaker: 'LT. VAD — CHECKPOINT',
        callsign: 'LT. VAD // SEC-OPS',
        icon: 'shield',
        color: '#00f0ff',
        text_en: 'Outstanding work, Prototype-19! Exterior perimeter Sectors 1-10 are fully cleared. Prepare yourself... we are descending into the deeper facility vaults!',
        text_id: 'Kerja bagus, Prototype-19! Seluruh perimeter luar Sektor 1-10 berhasil kamu bersihkan. Bersiaplah... kita akan menuruni terowongan fasilitas yang jauh lebih dalam!'
    }
};

// Recoverable Blackbox Lore Terminals scattered across labyrinth corridors
const LORE_DATA_LOGS = [
    {
        id: 'log_01',
        level: 1, // Appears in Sector 2
        title_en: 'PROJECT VITA // INCEPTION MEMO #01',
        title_id: 'PROYEK VITA // MEMORANDUM AWAL #01',
        author: 'DIRECTOR V. CROSS',
        body_en: '"We sought immortality through synthetic biomatter. The Carnis cell cultures demonstrated spontaneous cellular regeneration beyond any natural limit. We believed we had conquered mortality."',
        body_id: '"Kami mencari keabadian melalui biomassa sintetis. Kultur sel Carnis menunjukkan regenerasi sel spontan melampaui batas alami. Kami mengira telah menaklukkan kematian."'
    },
    {
        id: 'log_02',
        level: 3, // Appears in Sector 4
        title_en: 'BIO-CONTAINMENT INCIDENT LOG #14',
        title_id: 'LOG INSIDEN PENAHANAN BIOLOGIS #14',
        author: 'CHIEF MEDICAL OFFICER',
        body_en: '"The culture escaped petri dish confinement within 48 hours. It did not replicate like bacteria—it organized like neural tissue. It learned our shift schedules. It mimics human breathing sounds."',
        body_id: '"Kultur lolos dari cawan petri dalam 48 jam. Ia tidak bereplikasi seperti bakteri—ia berorganisasi seperti jaringan otak. Ia mempelajari jadwal shift kami. Ia menirukan suara napas manusia."'
    },
    {
        id: 'log_03',
        level: 6, // Appears in Sector 7
        title_en: 'SECURITY COUNCIL RECORD // PROTOCOL-19',
        title_id: 'CATATAN DEWAN KEAMANAN // PROTOKOL-19',
        author: 'COMMAND CENTRAL',
        body_en: '"Standard combat units cannot withstand bio-assimilation. Only a synthetic titanium chassis fused with a re-stabilized neural processor can survive the necrotic fog. They named it Prototype-19."',
        body_id: '"Unit tempur biasa tak tahan asimilasi biologis. Hanya sasis titanium sintetis yang dipadu prosesor saraf stabil yang mampu menembus kabut nekrotik. Mereka menamainya Prototype-19."'
    },
    {
        id: 'log_04',
        level: 8, // Appears in Sector 9
        title_en: 'MORPHOLOGY ANALYSIS // FEAR MIMICRY',
        title_id: 'ANALISIS MORFOLOGI // MIMIKRI KETAKUTAN',
        author: 'DR. K. REEVES // NEURO-BIOLOGY',
        body_en: '"Carnis tissue assimilating human subjects does not merely absorb organic mass, but also residual neural impulses in the cerebral cortex. The organism reconstructs its form based on the host\'s strongest phobias—masked humanoids, winged predators, and the dread of being watched. They adapt into forms best suited to paralyze their prey."',
        body_id: '"Sampel jaringan Carnis yang mengasimilasi subjek manusia tidak hanya menyerap materi organik, tetapi juga jejak impuls pada korteks serebral. Organisme ini mencetak ulang bentuk fisiknya berdasarkan ketakutan terkuat inangnya—figur bertopeng, predator bersayap, hingga rasa takut diawasi. Mereka mengadaptasi bentuk yang paling efektif memicu kelumpuhan reaksi pada mangsanya."'
    },
    {
        id: 'log_05',
        level: 10, // Appears in Sector 11
        title_en: 'THE APEX MANIFESTO // COELUM CARNIS',
        title_id: 'MANIFESTO APEX // COELUM CARNIS',
        author: 'RECOVERED AUDIO FRAGMENT',
        body_en: '"The Monoliths are not weapons. They are antennas. When the 7 pillars connect their neural frequencies, human consciousness will cease individuality and become eternal flesh."',
        body_id: '"Monolith bukanlah senjata. Mereka adalah antena. Saat ke-7 pilar menyatukan frekuensi sarafnya, kesadaran manusia akan melebur dari individu menjadi daging abadi."'
    }
];

// Cinematic Epilogue endings rendered upon defeating Sector 15
const EPILOGUE_SCRIPT = {
    intro_en: 'THE MONOLITH COLLAPSES. THE LABYRINTH TREMBLES AS ITS BIOMECHANICAL HEARTS CEASE BEATING.',
    intro_id: 'THE MONOLITH RUNTUH. LABIRIN BERGETAR SAAT JANTUNG BIOMEKANIKNYA BERHENTI BERDETAK.',
    lines_en: [
        'The necrotic red fog dissipates from the corridors of the Forgotten Sector.',
        'Emergency decontamination airlocks depressurize one by one, opening the path to the surface.',
        'Your internal HUD flickers: [DIRECTIVE COMPLETED // THREAT CARNIS-07 PURGED].',
        'In the distance, the sirens fall silent. For the first time in centuries, the Tide Labyrinth is quiet.',
        'You stand at the threshold of the outside world. An operative born in the dark, who gave humanity another dawn.'
    ],
    lines_id: [
        'Kabut merah nekrotik perlahan memudar dari lorong-lorong Sektor Terlupakan.',
        'Pintu kedap dekontaminasi darurat membuka satu demi satu, membuka jalan menuju permukaan.',
        'HUD internalmu berkedip: [PERINTAH SELESAI // ANCAMAN CARNIS-07 BERHASIL DIMUSNAHKAN].',
        'Di kejauhan, sirene darurat mereda. Untuk pertama kalinya dalam ratusan tahun, Labirin Tide terdiam.',
        'Kau berdiri di ambang pintu dunia luar. Seorang prajurit yang lahir di kegelapan, demi memberi fajar baru bagi umat manusia.'
    ]
};

// ============================================================
// INTERLUDE SINEMATIK LATAR GELAP TANPA BOX (ALTERISHA)
// ============================================================
const NARRATIVE_INTERLUDES = {
    9: { // Sektor 10 selesai (currentLevel === 9) menuju Sektor 11
        slides: [
            {
                speaker: '***',
                speakerRevealed: false,
                signal_id: '(frekuensi transmisi radio tak dikenal tersambung).......',
                signal_en: '(incoming unverified radio frequency).......',
                body_id: '"itu...... bot..... BOT-7."',
                body_en: '"thats...... bot..... the bot-7 ."',
                tail_id: '',
                tail_en: ''
            },
            {
                speaker: '*** ➔ ALTERISHA',
                speakerRevealed: true,
                signal_id: '(identitas transmisi terungkap: ALTERISHA).......',
                signal_en: '(transmission decrypted: ALTERISHA).......',
                body_id: '"itu salah satu kegagalan kami saat menyerang sektor ini......"',
                body_en: '"thats one of our failure on attacking this sector......"',
                tail_id: '"Entah bagaimana kau bisa selamat sampai sejauh ini, Prototype-19...... Tetap waspada di sektor berikutnya."',
                tail_en: '"Somehow you managed to survive this far, Prototype-19...... Stay alert in the upcoming sectors."'
            }
        ]
    },
    10: { // Sektor 11 selesai (currentLevel === 10) menuju Sektor 12
        slides: [
            {
                speaker: 'ALTERISHA',
                speakerRevealed: true,
                signal_id: '(suara Alterisha terdengar hening di tengah frekuensi radio).......',
                signal_en: '(Alterisha\'s voice cuts through the quiet radio static).......',
                body_id: '"Orang itu telah hilang dari jejak kami entah kemana, APA yang dia lakukan aku tidak tahu.... aku mencoba mencarinya ke mana mana."',
                body_en: '"That person has vanished from our traces without a trace, what they were doing I have no idea.... I tried searching for them everywhere."',
                tail_id: '',
                tail_en: ''
            },
            {
                speaker: 'ALTERISHA',
                speakerRevealed: true,
                signal_id: '(kenangan lama berderau samar).......',
                signal_en: '(distant memory echoes through the stillness).......',
                body_id: '"Terakhir kali kami bertemu dengan dia ia telah membuat dan meneliti serta mempelajari makhluk itu dengan sangat serius, terakhir kali aku bertemu dengannya ia memberi tahuku \'Kau akan melanjutkan suatu hari nanti\' ."',
                body_en: '"The last time we met them, they were creating, researching, and studying those creatures with utmost obsession. The last time I saw them, they told me \'You will carry this on one day\' ."',
                tail_id: '',
                tail_en: ''
            },
            {
                speaker: 'ALTERISHA',
                speakerRevealed: true,
                signal_id: '(frekuensi radio terdiam sejenak).......',
                signal_en: '(radio frequency lingers in contemplative silence).......',
                body_id: '"Aku tidak mengerti apa yang dia katakan sebelum menghilang......."',
                body_en: '"I never understood what they meant before they vanished......."',
                tail_id: '"Apakah kata-katanya tertuju padamu, Prototype-19......?"',
                tail_en: '"Were those words meant for you, Prototype-19......?"'
            }
        ]
    },
    11: { // Sektor 12 selesai (currentLevel === 11) menuju Sektor 13
        slides: [
            {
                speaker: 'ALTERISHA',
                speakerRevealed: true,
                signal_id: '(frekuensi transmisi terhubung dari Sektor Luar).......',
                signal_en: '(incoming transmission frequency from Outer Perimeter).......',
                body_id: '"Kami telah mengerahkan berbagai unit drone ke seluruh tujuh sektor awal. Namun, sama seperti unit sebelumnya—BOT-7—tidak ada satu pun yang berhasil menembus barisan pertahanan mereka."',
                body_en: '"We deployed multiple drone units across all seven outer sectors. Yet, just like the previous unit—BOT-7—none managed to breach their offensive lines."',
                tail_id: '"Karena itulah aku meneliti kembali setiap rekaman data... mencari potensi kemampuan dan peningkatan apa saja yang masih bisa kita maksimalkan untuk unitmu."',
                tail_en: '"Which is why I\'m dissecting their data logs... researching any operational capability and combat augmentations we can still enhance for your chassis."'
            }
        ]
    },
    12: { // Sektor 13 selesai (currentLevel === 12) menuju Sektor 14
        slides: [
            {
                speaker: 'ALTERISHA',
                speakerRevealed: true,
                signal_id: '(interferensi biomassa melonjak drastis).......',
                signal_en: '(biomass interference surging violently).......',
                body_id: '"Struktur labirin di depan bukan lagi sekadar baja dan beton. Dinding-dinding fasilitas mulai berdenyut dan menyatu dengan biomassa The Monolith. Prototype-19... kau sudah semakin dekat ke inti kehancuran ini."',
                body_en: '"The labyrinth structure ahead is no longer mere steel and concrete. The facility walls are pulsing, fusing directly into the biomass of The Monolith. Prototype-19... you are drawing closer to the core of this cataclysm."',
                tail_id: '"Tetap waspada. Setiap sudut koridor kini menjadi perangkap hidup."',
                tail_en: '"Stay vigilant. Every corner of the corridor is now a living death trap."'
            }
        ]
    },
    13: { // Sektor 14 selesai (currentLevel === 13) menuju Sektor 15 (Puncak Pertarungan)
        slides: [
            {
                speaker: 'ALTERISHA',
                speakerRevealed: true,
                signal_id: '(distorsi medan psionik mendekati batas kritis).......',
                signal_en: '(psionic field distortion nearing critical threshold).......',
                body_id: '"Semua frekuensi komunikasi dari Sektor Luar mulai terputus oleh medan psionik The Monolith. Ini adalah transmisi terakhir yang bisa kukirimkan sebelum jaringan padam total. Hancurkan jantung biomekanik mereka, Prototype-19. Buktikan pengorbanan unit-unit terdahulu tidak sia-sia!"',
                body_en: '"All external comm channels are collapsing under The Monolith\'s psionic jamming. This is the final transmission I can send before total blackout. Shatter their biomechanical core, Prototype-19. Prove that the sacrifice of every preceding unit was not in vain!"',
                tail_id: '"Bawa fajar baru bagi umat manusia......"',
                tail_en: '"Bring a new dawn to humanity......"'
            }
        ]
    }
};

function playTypingSound() {
    try {
        const ac = (typeof ensureAudio === 'function') ? ensureAudio() : null;
        if (!ac) return;
        const vol = (typeof settings !== 'undefined' && settings && Number(settings.volume)) ? Number(settings.volume) : 70;
        if (vol <= 0) return;
        const master = (vol / 100);
        const now = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const filter = ac.createBiquadFilter();

        // Delicate, soft resonance chime blip (Genshin/HSR dialogue style)
        osc.type = 'sine';
        const baseFreq = 780 + Math.random() * 140;
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(280, now + 0.026);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, now);

        gain.gain.setValueAtTime(0.045 * master, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect((typeof masterGain !== 'undefined' && masterGain) ? masterGain : ac.destination);

        osc.start(now);
        osc.stop(now + 0.03);
    } catch (_) {}
}

function playNarrativeInterlude(levelIndex, onComplete) {
    const data = NARRATIVE_INTERLUDES[levelIndex];
    if (!data) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    const screen = document.getElementById('narrativeInterludeScreen');
    const speakerEl = document.getElementById('interludeSpeaker');
    const signalEl = document.getElementById('interludeSignal');
    const bodyEl = document.getElementById('interludeBody');
    const tailEl = document.getElementById('interludeTail');
    const promptEl = document.getElementById('interludePrompt');
    const innerEl = screen ? screen.querySelector('.interlude-inner') : null;

    if (!screen) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    const slides = Array.isArray(data.slides) ? data.slides : [data];
    let slideIdx = 0;
    let isTyping = false;
    let isTransitioning = false;
    let typingTimer = null;
    let currentFullBody = '';
    let currentFullTail = '';
    let lastTypeSoundTime = 0;

    const currentLang = (typeof settings !== 'undefined' && settings && settings.lang) ? settings.lang : 'id';

    screen.style.display = 'flex';
    void screen.offsetWidth;
    screen.classList.add('active');

    try {
        if (typeof sStaticBurst === 'function') sStaticBurst();
    } catch (_) {}

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderSlide(idx) {
        if (idx >= slides.length) {
            closeInterlude();
            return;
        }

        const s = slides[idx];
        if (typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
        }

        if (innerEl) {
            innerEl.classList.remove('fade-out');
        }

        if (speakerEl) {
            speakerEl.textContent = s.speaker;
            speakerEl.classList.toggle('revealed', !!s.speakerRevealed);
        }
        if (signalEl) {
            signalEl.textContent = currentLang === 'en' ? s.signal_en : s.signal_id;
        }
        if (tailEl) {
            tailEl.textContent = '';
            tailEl.style.opacity = '0';
        }
        if (promptEl) {
            promptEl.classList.remove('visible');
            promptEl.textContent = currentLang === 'en' ? '[ CLICK / SPACE TO CONTINUE ]' : '[ KLIK / SPASI UNTUK MELANJUTKAN ]';
        }

        currentFullBody = currentLang === 'en' ? s.body_en : s.body_id;
        currentFullTail = currentLang === 'en' ? (s.tail_en || '') : (s.tail_id || '');

        let charIdx = 0;
        isTyping = true;
        isTransitioning = false;
        if (bodyEl) bodyEl.innerHTML = '<span class="interlude-cursor"></span>';

        function typeNext() {
            if (!isTyping) return;
            if (charIdx < currentFullBody.length) {
                charIdx++;
                const visible = currentFullBody.slice(0, charIdx);
                const char = currentFullBody[charIdx - 1];
                if (char && char.trim() !== '') {
                    const now = Date.now();
                    if (now - lastTypeSoundTime >= 45) {
                        lastTypeSoundTime = now;
                        playTypingSound();
                    }
                }
                if (bodyEl) {
                    bodyEl.innerHTML = escapeHtml(visible) + '<span class="interlude-cursor"></span>';
                }
                // Genshin/HSR deliberate, slow pacing with punctuation pauses
                const charDelay = (char === '.' || char === '!' || char === '?') ? 280 : (char === ',') ? 160 : (char === ':') ? 180 : 44;
                typingTimer = setTimeout(typeNext, charDelay);
            } else {
                finishTyping();
            }
        }

        typingTimer = setTimeout(typeNext, 200);
    }

    function finishTyping() {
        if (typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
        }
        isTyping = false;
        if (bodyEl) {
            bodyEl.innerHTML = escapeHtml(currentFullBody) + '<span class="interlude-cursor idle"></span>';
        }
        if (tailEl && currentFullTail) {
            tailEl.textContent = currentFullTail;
            setTimeout(() => { if (tailEl) tailEl.style.opacity = '0.9'; }, 80);
        }
        if (promptEl) {
            setTimeout(() => { if (promptEl) promptEl.classList.add('visible'); }, 200);
        }
    }

    function handleInteraction(e) {
        if (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        }
        if (isTransitioning) return;

        if (isTyping) {
            // Selesaikan kalimat yang sedang diketik
            finishTyping();
        } else {
            // Hilang perlahan (fade out bertahap) sebelum masuk ke slide berikutnya atau selesai
            isTransitioning = true;
            if (innerEl) {
                innerEl.classList.add('fade-out');
            }
            if (typingTimer) {
                clearTimeout(typingTimer);
                typingTimer = null;
            }

            setTimeout(() => {
                slideIdx++;
                if (slideIdx >= slides.length) {
                    closeInterlude();
                } else {
                    // Jeda hening dalam kegelapan (pacing lambat ala Genshin/HSR)
                    setTimeout(() => {
                        renderSlide(slideIdx);
                    }, 240);
                }
            }, 550);
        }
    }

    let closed = false;
    function closeInterlude() {
        if (closed) return;
        closed = true;
        window.removeEventListener('keydown', onKey);
        screen.removeEventListener('click', handleInteraction);

        screen.classList.remove('active');
        setTimeout(() => {
            screen.style.display = 'none';
            if (innerEl) innerEl.classList.remove('fade-out');
            if (typeof onComplete === 'function') onComplete();
        }, 800);
    }

    function onKey(e) {
        if (e.key === 'Tab') return;
        handleInteraction(e);
    }

    setTimeout(() => {
        window.addEventListener('keydown', onKey);
        screen.addEventListener('click', handleInteraction);
        renderSlide(0);
    }, 240);
}

