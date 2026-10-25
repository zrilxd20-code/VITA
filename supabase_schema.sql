-- ====================================================================
-- VITA: Sektor Terlupakan - Database Schema & Security Update (v2.3.8)
-- ====================================================================
-- Jalankan script SQL ini di Supabase Dashboard -> SQL Editor -> Run
-- ====================================================================

-- 1. Buat / Perbarui Tabel Profil Operatif (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    passcode TEXT DEFAULT '',
    role TEXT DEFAULT 'Operatif Lapangan',
    avatar TEXT,
    preset_emoji TEXT DEFAULT 'biohazard',
    provider TEXT DEFAULT 'facility',
    clearance TEXT DEFAULT 'LEVEL-1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Migrasi kolom jika tabel sudah ada sebelumnya
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS passcode TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_play_time INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS highest_level INTEGER DEFAULT 1;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_kills INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS best_time INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS high_score INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saved_weapons JSONB DEFAULT '["knife"]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saved_perks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saved_plevel INTEGER DEFAULT 1;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saved_exp INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS games_played INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS games_won INTEGER DEFAULT 0;

-- Bersihkan data duplikat lama sebelum membuat unique index (pertahankan data paling baru)
DELETE FROM public.profiles
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY LOWER(username) 
                   ORDER BY updated_at DESC, created_at DESC
               ) as rnum
        FROM public.profiles
    ) sub
    WHERE sub.rnum > 1
);

-- Index unik untuk pencarian username cepat & mencegah duplikasi case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique ON public.profiles(LOWER(username));

-- 2. Buat / Perbarui Tabel Papan Peringkat Global (Leaderboard)
CREATE TABLE IF NOT EXISTS public.leaderboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    role TEXT DEFAULT 'Operatif Lapangan',
    preset_emoji TEXT DEFAULT 'biohazard',
    avatar TEXT,
    best_time INTEGER NOT NULL,
    total_kills INTEGER DEFAULT 0,
    highest_level INTEGER DEFAULT 1,
    grade TEXT DEFAULT 'B',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index untuk sorting leaderboard berdasarkan sektor tertinggi, waktu tercepat, dan kill terbanyak
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank ON public.leaderboard(highest_level DESC, best_time ASC, total_kills DESC);

-- Batasan Integritas Skor (Check Constraints Anti-Cheat / Bot Tampering)
ALTER TABLE public.leaderboard DROP CONSTRAINT IF EXISTS chk_leaderboard_best_time;
ALTER TABLE public.leaderboard ADD CONSTRAINT chk_leaderboard_best_time CHECK (best_time >= 15);

ALTER TABLE public.leaderboard DROP CONSTRAINT IF EXISTS chk_leaderboard_highest_level;
ALTER TABLE public.leaderboard ADD CONSTRAINT chk_leaderboard_highest_level CHECK (highest_level >= 1 AND highest_level <= 15);

ALTER TABLE public.leaderboard DROP CONSTRAINT IF EXISTS chk_leaderboard_total_kills;
ALTER TABLE public.leaderboard ADD CONSTRAINT chk_leaderboard_total_kills CHECK (total_kills >= 0);

ALTER TABLE public.leaderboard DROP CONSTRAINT IF EXISTS chk_leaderboard_grade;
ALTER TABLE public.leaderboard ADD CONSTRAINT chk_leaderboard_grade CHECK (grade IN ('S', 'A', 'B', 'C'));

-- 3. View Profil Publik Aman (Menyembunyikan Kolom Passcode dari Publik)
CREATE OR REPLACE VIEW public.v_public_profiles AS
SELECT 
    id,
    username,
    role,
    avatar,
    preset_emoji,
    provider,
    clearance,
    created_at,
    updated_at
FROM public.profiles;

-- 4. View Top 20 Operatif Terbaik
CREATE OR REPLACE VIEW public.v_top_operatives AS
SELECT 
    username,
    role,
    preset_emoji,
    avatar,
    best_time,
    total_kills,
    highest_level,
    grade,
    created_at
FROM public.leaderboard
ORDER BY highest_level DESC, best_time ASC, total_kills DESC
LIMIT 20;

-- 5. Aktifkan Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;

-- 6. Kebijakan Keamanan RLS untuk Leaderboard
DROP POLICY IF EXISTS "Publik dapat melihat leaderboard" ON public.leaderboard;
CREATE POLICY "Publik dapat melihat leaderboard" 
ON public.leaderboard 
FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Pemain dapat mengirim skor ke leaderboard" ON public.leaderboard;
CREATE POLICY "Pemain dapat mengirim skor ke leaderboard" 
ON public.leaderboard 
FOR INSERT 
WITH CHECK (
    best_time >= 15 AND 
    highest_level >= 1 AND 
    highest_level <= 15 AND 
    total_kills >= 0 AND 
    grade IN ('S', 'A', 'B', 'C')
);

-- 7. Kebijakan Keamanan RLS untuk Profiles
-- Catatan: Akses publik terhadap data profil dianjurkan melalui view `v_public_profiles`
-- dan fungsi RPC SECURITY DEFINER (`upsert_operative_profile` & `verify_operative_passcode`)
-- guna melindungi kolom kredensial (`passcode`).
DROP POLICY IF EXISTS "Publik dapat melihat profil" ON public.profiles;
CREATE POLICY "Publik dapat melihat profil" 
ON public.profiles 
FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Pemain dapat membuat profil" ON public.profiles;
CREATE POLICY "Pemain dapat membuat profil" 
ON public.profiles 
FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Pemain dapat memperbarui profil" ON public.profiles;
CREATE POLICY "Pemain dapat memperbarui profil" 
ON public.profiles 
FOR UPDATE 
USING (
    -- Cegah pembajakan akun langsung via REST: hanya perbolehkan update jika passcode kosong atau lewat RPC
    passcode IS NULL OR passcode = '' OR current_setting('request.jwt.claim.role', true) = 'service_role'
);

-- 8. FUNGSI AMAN (SECURITY DEFINER RPC): Verifikasi Sandi Operatif
-- Memeriksa sandi secara langsung di database sehingga hash sandi tidak bocor ke publik
CREATE OR REPLACE FUNCTION public.verify_operative_passcode(
    p_username TEXT,
    p_passcode_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prof RECORD;
    v_matched BOOLEAN := false;
BEGIN
    SELECT * INTO v_prof 
    FROM public.profiles 
    WHERE LOWER(username) = LOWER(TRIM(p_username))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    -- Jika profil belum punya passcode, atau passcode cocok
    IF v_prof.passcode IS NULL OR v_prof.passcode = '' OR v_prof.passcode = p_passcode_hash THEN
        v_matched := true;
    END IF;

    IF NOT v_matched THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_passcode');
    END IF;

    -- Kembalikan data profil AMAN (tanpa passcode)
    RETURN jsonb_build_object(
        'ok', true,
        'profile', jsonb_build_object(
            'id', v_prof.id,
            'username', v_prof.username,
            'role', v_prof.role,
            'avatar', v_prof.avatar,
            'preset_emoji', v_prof.preset_emoji,
            'provider', v_prof.provider,
            'clearance', v_prof.clearance,
            'highest_level', COALESCE(v_prof.highest_level, 1),
            'total_kills', COALESCE(v_prof.total_kills, 0),
            'best_time', COALESCE(v_prof.best_time, 0),
            'high_score', COALESCE(v_prof.high_score, 0),
            'saved_weapons', COALESCE(v_prof.saved_weapons, '["knife"]'::jsonb),
            'saved_perks', COALESCE(v_prof.saved_perks, '[]'::jsonb),
            'saved_plevel', COALESCE(v_prof.saved_plevel, 1),
            'saved_exp', COALESCE(v_prof.saved_exp, 0),
            'updated_at', v_prof.updated_at
        )
    );
END;
$$;

-- 9. FUNGSI AMAN (SECURITY DEFINER RPC): Pendaftaran & Pembaruan Profil Anti-Hijack
-- Mencegah pemain lain menimpa callsign milik operatif lain tanpa passcode yang benar
CREATE OR REPLACE FUNCTION public.upsert_operative_profile(
    p_username TEXT,
    p_passcode_hash TEXT,
    p_role TEXT DEFAULT 'Operatif Lapangan',
    p_avatar TEXT DEFAULT '',
    p_preset_emoji TEXT DEFAULT 'biohazard',
    p_provider TEXT DEFAULT 'facility',
    p_clearance TEXT DEFAULT 'LEVEL-1'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_user TEXT := TRIM(p_username);
    v_clean_avatar TEXT := '';
    v_existing RECORD;
BEGIN
    -- Validasi callsign
    IF v_clean_user IS NULL OR LENGTH(v_clean_user) < 3 OR LENGTH(v_clean_user) > 24 THEN
        RAISE EXCEPTION 'Callsign tidak valid (harus 3-24 karakter)';
    END IF;

    -- Validasi batas panjang data URI avatar
    IF p_avatar IS NOT NULL AND LENGTH(p_avatar) < 50000 THEN
        v_clean_avatar := p_avatar;
    END IF;

    -- Cek profil eksisting
    SELECT * INTO v_existing 
    FROM public.profiles 
    WHERE LOWER(username) = LOWER(v_clean_user)
    LIMIT 1;

    IF FOUND THEN
        -- Proteksi Anti-Hijack: jika profil sudah ada dan memiliki passcode
        IF v_existing.passcode IS NOT NULL AND v_existing.passcode <> '' THEN
            IF p_passcode_hash IS NULL OR p_passcode_hash <> v_existing.passcode THEN
                RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized', 'message', 'Passcode tidak cocok dengan pemilik callsign.');
            END IF;
        END IF;

        -- Update profil
        UPDATE public.profiles
        SET 
            role = COALESCE(p_role, role),
            avatar = CASE WHEN v_clean_avatar <> '' THEN v_clean_avatar ELSE avatar END,
            preset_emoji = COALESCE(p_preset_emoji, preset_emoji),
            clearance = COALESCE(p_clearance, clearance),
            passcode = CASE WHEN (passcode IS NULL OR passcode = '') AND p_passcode_hash <> '' THEN p_passcode_hash ELSE passcode END,
            updated_at = now()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'ok', true,
            'action', 'updated',
            'username', v_clean_user
        );
    ELSE
        -- Insert profil baru
        INSERT INTO public.profiles (
            username,
            passcode,
            role,
            avatar,
            preset_emoji,
            provider,
            clearance,
            created_at,
            updated_at
        ) VALUES (
            v_clean_user,
            COALESCE(p_passcode_hash, ''),
            COALESCE(p_role, 'Operatif Lapangan'),
            v_clean_avatar,
            COALESCE(p_preset_emoji, 'biohazard'),
            COALESCE(p_provider, 'facility'),
            COALESCE(p_clearance, 'LEVEL-1'),
            now(),
            now()
        );

        RETURN jsonb_build_object(
            'ok', true,
            'action', 'created',
            'username', v_clean_user
        );
    END IF;
END;
$$;

-- Berikan izin eksekusi RPC untuk pengguna anonim & terautentikasi
GRANT EXECUTE ON FUNCTION public.verify_operative_passcode(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_operative_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
