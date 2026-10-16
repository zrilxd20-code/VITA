// VITA Audio Module - Procedural WebAudio Synthesis
// Zero external audio assets - all sounds generated synthetically

export class AudioEngine {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private volume = 0.7;
    private muted = false;
    private unlocked = false;

    constructor() {
        this.init();
    }

    private init() {
        try {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.connect(this.ctx.destination);
            this.masterGain.gain.value = this.volume;
        } catch (e) {
            console.warn('WebAudio not supported:', e);
        }
    }

    unlock() {
        if (this.ctx && this.ctx.state === 'suspended' && !this.unlocked) {
            this.ctx.resume();
            this.unlocked = true;
        }
    }

    setVolume(v: number) {
        this.volume = Math.max(0, Math.min(1, v));
        if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }

    setMuted(m: boolean) {
        this.muted = m;
        if (this.masterGain) this.masterGain.gain.value = m ? 0 : this.volume;
    }

    getVolume() { return this.volume; }
    isMuted() { return this.muted; }

    private blip(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.1, when = 0) {
        if (!this.ctx || this.muted || this.volume === 0) return;
        try {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            g.gain.value = gain * this.volume;
            osc.connect(g);
            g.connect(this.masterGain!);
            const t = this.ctx.currentTime + when;
            osc.start(t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            osc.stop(t + dur);
        } catch (e) { /* ignore audio errors */ }
    }

    private noise(dur: number, gain = 0.1, when = 0) {
        if (!this.ctx || this.muted || this.volume === 0) return;
        try {
            const bufferSize = this.ctx.sampleRate * dur;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            const g = this.ctx.createGain();
            g.gain.value = gain * this.volume;
            source.connect(g);
            g.connect(this.masterGain!);
            source.start(this.ctx.currentTime + when);
            source.stop(this.ctx.currentTime + when + dur);
        } catch (e) { /* ignore */ }
    }

    // Gameplay sounds
    playerHit() { this.blip(180, 0.12, 'sawtooth', 0.15); }
    playerHeal() { this.blip(440, 0.1, 'sine', 0.12); this.blip(660, 0.1, 'sine', 0.08, 0.05); }
    playerDash() { this.blip(320, 0.06, 'square', 0.1); this.noise(0.08, 0.05); }
    playerDeath() { 
        this.blip(120, 0.3, 'sawtooth', 0.2);
        this.blip(80, 0.5, 'sawtooth', 0.15, 0.1);
    }
    levelUp() {
        this.blip(523, 0.08, 'sine', 0.12);
        this.blip(659, 0.08, 'sine', 0.1, 0.06);
        this.blip(784, 0.12, 'sine', 0.1, 0.12);
    }
    artifactCollect() {
        this.blip(880, 0.05, 'sine', 0.1);
        this.blip(1320, 0.05, 'sine', 0.08, 0.03);
        this.blip(1760, 0.05, 'sine', 0.06, 0.06);
    }
    exitUnlock() {
        this.blip(440, 0.1, 'sine', 0.12);
        this.blip(554, 0.1, 'sine', 0.1, 0.08);
        this.blip(659, 0.15, 'sine', 0.1, 0.16);
    }
    weaponFire(type: string) {
        switch (type) {
            case 'knife': this.blip(400, 0.04, 'square', 0.08); break;
            case 'rifle': this.blip(300, 0.03, 'square', 0.1); this.blip(600, 0.02, 'square', 0.05, 0.01); break;
            case 'grenade': this.blip(150, 0.08, 'sawtooth', 0.12); this.noise(0.1, 0.06); break;
            case 'bazooka': this.blip(80, 0.15, 'sawtooth', 0.18); this.noise(0.2, 0.1); break;
            case 'shield': this.blip(500, 0.15, 'sine', 0.12); this.blip(700, 0.1, 'sine', 0.08, 0.05); break;
            case 'minigun': this.blip(250, 0.02, 'square', 0.06); break;
        }
    }
    weaponEmpty() { this.blip(200, 0.05, 'square', 0.08); this.blip(150, 0.05, 'square', 0.06, 0.03); }
    monsterHit() { this.blip(220, 0.06, 'triangle', 0.1); }
    monsterDeath() { this.blip(160, 0.12, 'sawtooth', 0.12); this.blip(110, 0.1, 'sawtooth', 0.08, 0.05); }
    monsterSpawn() { this.blip(100, 0.15, 'sawtooth', 0.08); }
    bossRoar() { 
        this.blip(60, 0.4, 'sawtooth', 0.2);
        this.blip(45, 0.5, 'sawtooth', 0.15, 0.1);
    }
    bossPhaseShift() {
        this.blip(80, 0.2, 'sawtooth', 0.15);
        this.blip(120, 0.15, 'square', 0.1, 0.1);
        this.noise(0.2, 0.08);
    }
    trapHit() { this.blip(120, 0.08, 'sawtooth', 0.15); }
    gasDamage() { this.blip(180, 0.1, 'triangle', 0.08); }
    uiClick() { this.blip(600, 0.02, 'square', 0.04); }
    uiHover() { this.blip(800, 0.015, 'sine', 0.02); }
    uiError() { this.blip(150, 0.1, 'sawtooth', 0.08); }
    comboKill(count: number) {
        if (count === 2) { this.blip(880, 0.06, 'sine', 0.1); this.blip(1100, 0.06, 'sine', 0.08, 0.04); }
        else if (count === 3) { this.blip(784, 0.05, 'sine', 0.1); this.blip(988, 0.05, 'sine', 0.08, 0.03); this.blip(1175, 0.08, 'sine', 0.08, 0.06); }
        else if (count >= 4) { this.blip(659, 0.08, 'sine', 0.12); this.blip(831, 0.08, 'sine', 0.1, 0.05); this.blip(988, 0.12, 'sine', 0.1, 0.1); }
    }
    perkAcquire() { this.blip(523, 0.1, 'sine', 0.12); this.blip(784, 0.15, 'sine', 0.1, 0.08); }
    weaponSwitch() { this.blip(500, 0.03, 'square', 0.06); }
    minigunOverheat() { this.blip(180, 0.15, 'sawtooth', 0.12); this.noise(0.15, 0.08); }
    minigunSpinUp() { for(let i=0;i<5;i++) this.blip(100+i*20, 0.03, 'square', 0.04, i*0.02); }
    minigunSpinDown() { for(let i=4;i>=0;i--) this.blip(100+i*20, 0.03, 'square', 0.04, (4-i)*0.02); }
    ambientHeartbeat(intensity: number) {
        const baseFreq = 60;
        const vol = Math.min(0.15, intensity * 0.1);
        this.blip(baseFreq, 0.1, 'sine', vol);
        this.blip(baseFreq * 1.5, 0.08, 'sine', vol * 0.6, 0.12);
    }
}

export const audio = new AudioEngine();