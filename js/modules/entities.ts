// VITA Entity System with Object Pooling
// Zero-GC pools for particles, projectiles, monsters, and effects

import { CELL } from './config.js';
import { Point } from './maze.js';

export interface Entity {
    x: number;
    y: number;
    active: boolean;
    type: string;
    reset(): void;
    update(dt: number): void;
    render(ctx: CanvasRenderingContext2D): void;
}

export class Pool<T extends Entity> {
    private pool: T[] = [];
    private factory: () => T;
    private maxSize: number;

    constructor(factory: () => T, initialSize = 50, maxSize = 500) {
        this.factory = factory;
        this.maxSize = maxSize;
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(factory());
        }
    }

    acquire(): T {
        let entity = this.pool.find(e => !e.active);
        if (!entity) {
            if (this.pool.length < this.maxSize) {
                entity = this.factory();
                this.pool.push(entity);
            } else {
                // Recycle oldest inactive (shouldn't happen if pool sized correctly)
                entity = this.pool[0];
            }
        }
        entity.active = true;
        return entity;
    }

    release(entity: T) {
        entity.active = false;
        entity.reset();
    }

    releaseAll() {
        for (const e of this.pool) {
            e.active = false;
            e.reset();
        }
    }

    getActive(): T[] {
        return this.pool.filter(e => e.active);
    }

    getAll(): T[] {
        return this.pool;
    }

    size() { return this.pool.length; }
    activeCount() { return this.pool.filter(e => e.active).length; }
}

// Particle System
export interface Particle extends Entity {
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    color: string;
    size: number;
    gravity: number;
    fade: boolean;
}

export function createParticle(): Particle {
    return {
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, color: '#fff', size: 2,
        gravity: 0, fade: true, active: false, type: 'particle',
        reset() { this.active = false; },
        update(dt: number) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vy += this.gravity * dt;
            this.life -= dt;
            if (this.life <= 0) this.active = false;
        },
        render(ctx: CanvasRenderingContext2D) {
            const alpha = this.fade ? this.life / this.maxLife : 1;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    };
}

export const particlePool = new Pool<Particle>(createParticle, 200, 2000);

export function spawnParticle(
    x: number, y: number,
    color: string, count: number,
    options: { speed?: number; spread?: number; life?: number; size?: number; gravity?: number } = {}
) {
    const { speed = 50, spread = Math.PI * 2, life = 0.5, size = 2, gravity = 0 } = options;
    for (let i = 0; i < count; i++) {
        const p = particlePool.acquire();
        p.x = x; p.y = y;
        const angle = Math.random() * spread;
        const spd = speed * (0.5 + Math.random() * 0.5);
        p.vx = Math.cos(angle) * spd;
        p.vy = Math.sin(angle) * spd;
        p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
        p.color = color;
        p.size = size * (0.5 + Math.random() * 0.5);
        p.gravity = gravity;
        p.fade = true;
    }
}

// Projectile System
export interface Projectile extends Entity {
    vx: number;
    vy: number;
    damage: number;
    owner: 'player' | 'monster';
    weaponType: string;
    pierce: number;
    bounce: number;
    trail: Point[];
    maxTrail: number;
    rotation: number;
    size: number;
    color: string;
    explosive: boolean;
    explodeRadius: number;
    gasCloud: boolean;
    lifetime: number;
    maxLifetime: number;
}

export function createProjectile(): Projectile {
    return {
        x: 0, y: 0, vx: 0, vy: 0,
        damage: 1, owner: 'player', weaponType: 'knife',
        pierce: 0, bounce: 0, trail: [], maxTrail: 8,
        rotation: 0, size: 4, color: '#ff3b3b',
        explosive: false, explodeRadius: 0, gasCloud: false,
        lifetime: 0, maxLifetime: 3,
        active: false, type: 'projectile',
        reset() { 
            this.active = false; 
            this.trail.length = 0;
            this.pierce = 0; this.bounce = 0;
            this.explosive = false; this.gasCloud = false;
        },
        update(dt: number) {
            this.trail.push({ x: this.x, y: this.y });
            if (this.trail.length > this.maxTrail) this.trail.shift();
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.lifetime -= dt;
            if (this.lifetime <= 0) this.active = false;
        },
        render(ctx: CanvasRenderingContext2D) {
            if (this.trail.length > 1) {
                ctx.strokeStyle = this.color;
                ctx.lineWidth = this.size * 0.5;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.moveTo(this.trail[0].x, this.trail[0].y);
                for (let i = 1; i < this.trail.length; i++) {
                    ctx.lineTo(this.trail[i].x, this.trail[i].y);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            ctx.fillStyle = this.color;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.beginPath();
            ctx.moveTo(this.size, 0);
            ctx.lineTo(-this.size, -this.size * 0.5);
            ctx.lineTo(-this.size, this.size * 0.5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    };
}

export const projectilePool = new Pool<Projectile>(createProjectile, 100, 500);

export function spawnProjectile(
    x: number, y: number,
    angle: number, speed: number,
    damage: number, owner: 'player' | 'monster',
    weaponType: string, options: Partial<Projectile> = {}
) {
    const p = projectilePool.acquire();
    p.x = x; p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.damage = damage;
    p.owner = owner;
    p.weaponType = weaponType;
    p.rotation = angle;
    p.maxLifetime = options.maxLifetime ?? 3;
    p.lifetime = p.maxLifetime;
    p.pierce = options.pierce ?? 0;
    p.bounce = options.bounce ?? 0;
    p.explosive = options.explosive ?? false;
    p.explodeRadius = options.explodeRadius ?? 0;
    p.gasCloud = options.gasCloud ?? false;
    p.size = options.size ?? 4;
    p.color = options.color ?? '#ff3b3b';
    p.maxTrail = options.maxTrail ?? 8;
    p.trail.length = 0;
}

// Monster System
export interface Monster extends Entity {
    id: string;
    hp: number;
    maxHp: number;
    speed: number;
    damage: number;
    detectRange: number;
    attackRange: number;
    attackCooldown: number;
    attackTimer: number;
    monsterType: string;
    variant: number;
    path: Point[];
    pathIndex: number;
    pathTimer: number;
    stunned: number;
    frozen: number;
    burning: number;
    poisoned: number;
    knockback: { x: number; y: number; timer: number };
    lastPlayerPos: Point | null;
    separationForce: { x: number; y: number };
    credits: number;
    artifactDrop: boolean;
    scale: number;
    color: string;
    glowColor: string;
    eyeColor: string;
    animFrame: number;
    animTimer: number;
    state: 'idle' | 'chase' | 'attack' | 'stunned' | 'frozen';
}

export function createMonster(): Monster {
    return {
        x: 0, y: 0, id: '', hp: 1, maxHp: 1,
        speed: 50, damage: 10, detectRange: 200, attackRange: 32,
        attackCooldown: 1, attackTimer: 0,
        monsterType: 'slime', variant: 0,
        path: [], pathIndex: 0, pathTimer: 0,
        stunned: 0, frozen: 0, burning: 0, poisoned: 0,
        knockback: { x: 0, y: 0, timer: 0 },
        lastPlayerPos: null,
        separationForce: { x: 0, y: 0 },
        credits: 10, artifactDrop: false,
        scale: 1, color: '#ff3b3b', glowColor: '#ff6b6b', eyeColor: '#fff',
        animFrame: 0, animTimer: 0, state: 'idle',
        active: false, type: 'monster',
        reset() { 
            this.active = false; 
            this.path.length = 0;
            this.stunned = this.frozen = this.burning = this.poisoned = 0;
            this.knockback = { x: 0, y: 0, timer: 0 };
            this.separationForce = { x: 0, y: 0 };
        },
        update(dt: number) {
            // Base update - overridden by AI system
            this.animTimer += dt;
            if (this.animTimer > 0.15) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 4; }
            if (this.stunned > 0) this.stunned -= dt;
            if (this.frozen > 0) this.frozen -= dt;
            if (this.burning > 0) { this.burning -= dt; this.hp -= 5 * dt; }
            if (this.poisoned > 0) { this.poisoned -= dt; this.hp -= 3 * dt; }
            if (this.knockback.timer > 0) {
                this.x += this.knockback.x * dt;
                this.y += this.knockback.y * dt;
                this.knockback.timer -= dt;
            }
        },
        render(ctx: CanvasRenderingContext2D) {
            // Base render - overridden by specific monster renderers
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, CELL * 0.4 * this.scale, 0, Math.PI * 2);
            ctx.fill();
        }
    };
}

export const monsterPool = new Pool<Monster>(createMonster, 50, 300);

export interface FloatingText extends Entity {
    text: string;
    color: string;
    vy: number;
    size: number;
    lifetime: number;
}

export function createFloatingText(): FloatingText {
    return {
        x: 0, y: 0, text: '', color: '#fff', vy: -30, size: 14,
        lifetime: 1, active: false, type: 'floatingText',
        reset() { this.active = false; },
        update(dt: number) {
            this.y += this.vy * dt;
            this.lifetime -= dt;
            this.vy *= 0.98;
            if (this.lifetime <= 0) this.active = false;
        },
        render(ctx: CanvasRenderingContext2D) {
            ctx.font = `bold ${this.size}px "Cascadia Code", monospace`;
            ctx.fillStyle = this.color;
            ctx.textAlign = 'center';
            ctx.globalAlpha = this.lifetime;
            ctx.fillText(this.text, this.x, this.y);
            ctx.globalAlpha = 1;
        }
    };
}

export const floatingTextPool = new Pool<FloatingText>(createFloatingText, 50, 200);

export function spawnFloatingText(x: number, y: number, text: string, color = '#fff', size = 14) {
    const ft = floatingTextPool.acquire();
    ft.x = x; ft.y = y; ft.text = text; ft.color = color; ft.size = size;
    ft.lifetime = 1; ft.vy = -30;
}

// Shockwave effect
export interface Shockwave extends Entity {
    radius: number;
    maxRadius: number;
    speed: number;
    color: string;
    width: number;
    damage: number;
    owner: 'player' | 'monster';
}

export function createShockwave(): Shockwave {
    return {
        x: 0, y: 0, radius: 0, maxRadius: 200, speed: 400,
        color: '#00e5ff', width: 3, damage: 0, owner: 'player',
        active: false, type: 'shockwave',
        reset() { this.active = false; },
        update(dt: number) {
            this.radius += this.speed * dt;
            if (this.radius >= this.maxRadius) this.active = false;
        },
        render(ctx: CanvasRenderingContext2D) {
            const alpha = 1 - this.radius / this.maxRadius;
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.width;
            ctx.globalAlpha = alpha * 0.8;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    };
}

export const shockwavePool = new Pool<Shockwave>(createShockwave, 10, 50);

// Gas Cloud effect
export interface GasCloud extends Entity {
    radius: number;
    maxRadius: number;
    life: number;
    maxLife: number;
    damage: number;
    color: string;
    tickTimer: number;
}

export function createGasCloud(): GasCloud {
    return {
        x: 0, y: 0, radius: 0, maxRadius: 120,
        life: 0, maxLife: 5, damage: 8, color: 'rgba(40,80,20,0.3)',
        tickTimer: 0, active: false, type: 'gasCloud',
        reset() { this.active = false; },
        update(dt: number) {
            this.life -= dt;
            this.tickTimer += dt;
            if (this.life <= 0) this.active = false;
        },
        render(ctx: CanvasRenderingContext2D) {
            const alpha = this.life / this.maxLife;
            ctx.fillStyle = this.color;
            ctx.globalAlpha = alpha * 0.5;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    };
}

export const gasCloudPool = new Pool<GasCloud>(createGasCloud, 10, 50);

// Brass Casing effect
export interface BrassCasing extends Entity {
    vx: number;
    vy: number;
    rotation: number;
    rotSpeed: number;
    life: number;
    color: string;
}

export function createBrassCasing(): BrassCasing {
    return {
        x: 0, y: 0, vx: 0, vy: 0, rotation: 0, rotSpeed: 0,
        life: 2, color: '#c9b037', active: false, type: 'brassCasing',
        reset() { this.active = false; },
        update(dt: number) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vy += 300 * dt; // gravity
            this.rotation += this.rotSpeed * dt;
            this.life -= dt;
            if (this.life <= 0 || this.y > 1000) this.active = false;
        },
        render(ctx: CanvasRenderingContext2D) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.fillStyle = this.color;
            ctx.fillRect(-3, -1, 6, 2);
            ctx.restore();
        }
    };
}

export const brassCasingPool = new Pool<BrassCasing>(createBrassCasing, 30, 150);