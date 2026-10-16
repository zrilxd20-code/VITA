// VITA Maze Generation & Pathfinding Module
// Procedural maze generation with BFS pathfinding and shared buffers

import { CELL, LEVELS } from './config.js';

export interface MazeCell {
    walls: number; // bitmask: 1=top, 2=right, 4=bottom, 8=left
    visited: boolean;
    x: number;
    y: number;
}

export interface Point {
    x: number;
    y: number;
}

export interface MazeData {
    grid: MazeCell[][];
    width: number;
    height: number;
    exit: Point;
    artifacts: Point[];
}

let bfsPrev: Int16Array | null = null;
let bfsQueue: Int16Array | null = null;
const MAX_BFS_SIZE = 2500; // 50x50 max

function ensureBfsBuffers(w: number, h: number) {
    const size = w * h;
    if (size > MAX_BFS_SIZE) return;
    if (!bfsPrev || bfsPrev.length < size) bfsPrev = new Int16Array(size);
    if (!bfsQueue || bfsQueue.length < size) bfsQueue = new Int16Array(size);
}

function idx(x: number, y: number, w: number) { return y * w + x; }

export function bfsPath(
    maze: MazeCell[][],
    sx: number, sy: number,
    tx: number, ty: number,
    w: number, h: number
): Point[] {
    ensureBfsBuffers(w, h);
    if (!bfsPrev || !bfsQueue) return [];

    const size = w * h;
    bfsPrev.fill(-1, 0, size);
    
    let qh = 0, qt = 0;
    bfsQueue[qt++] = idx(sx, sy, w);
    bfsPrev[idx(sx, sy, w)] = -2;

    const dirs = [
        { dx: 0, dy: -1, wall: 1, owall: 4 },
        { dx: 1, dy: 0, wall: 2, owall: 8 },
        { dx: 0, dy: 1, wall: 4, owall: 1 },
        { dx: -1, dy: 0, wall: 8, owall: 2 }
    ];

    while (qh < qt) {
        const cur = bfsQueue[qh++];
        const cx = cur % w;
        const cy = (cur / w) | 0;
        if (cx === tx && cy === ty) break;

        for (const d of dirs) {
            const nx = cx + d.dx, ny = cy + d.dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if ((maze[cy][cx].walls & d.wall) !== 0) continue;
            const nIdx = idx(nx, ny, w);
            if (bfsPrev[nIdx] !== -1) continue;
            bfsPrev[nIdx] = cur;
            bfsQueue[qt++] = nIdx;
        }
    }

    const tIdx = idx(tx, ty, w);
    if (bfsPrev[tIdx] === -1) return [];

    const path: Point[] = [];
    let cur = tIdx;
    while (cur !== -2) {
        path.push({ x: cur % w, y: (cur / w) | 0 });
        cur = bfsPrev[cur];
    }
    path.reverse();
    return path;
}

function shuffle<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

export function generateMaze(level: number): MazeData {
    const baseW = 21 + Math.floor(level / 2) * 2;
    const baseH = 21 + Math.floor(level / 2) * 2;
    const w = Math.min(baseW, 49) | 1; // odd
    const h = Math.min(baseH, 49) | 1;

    const grid: MazeCell[][] = [];
    for (let y = 0; y < h; y++) {
        grid[y] = [];
        for (let x = 0; x < w; x++) {
            grid[y][x] = { walls: 15, visited: false, x, y }; // all walls
        }
    }

    // Recursive backtracker
    const stack: Point[] = [{ x: 1, y: 1 }];
    grid[1][1].visited = true;

    while (stack.length) {
        const cur = stack[stack.length - 1];
        const neighbors: Point[] = [];
        const dirs = [
            { dx: 0, dy: -2, wall: 1, owall: 4 },
            { dx: 2, dy: 0, wall: 2, owall: 8 },
            { dx: 0, dy: 2, wall: 4, owall: 1 },
            { dx: -2, dy: 0, wall: 8, owall: 2 }
        ];
        for (const d of dirs) {
            const nx = cur.x + d.dx, ny = cur.y + d.dy;
            if (nx > 0 && ny > 0 && nx < w && ny < h && !grid[ny][nx].visited) {
                neighbors.push({ x: nx, y: ny, wall: d.wall, owall: d.owall } as any);
            }
        }
        if (neighbors.length) {
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            const wx = cur.x + (next.x - cur.x) / 2;
            const wy = cur.y + (next.y - cur.y) / 2;
            grid[cur.y][cur.x].walls &= ~(next.wall as number);
            grid[wy][wx].walls &= ~(next.owall as number);
            grid[next.y][next.x].visited = true;
            stack.push(next);
        } else {
            stack.pop();
        }
    }

    // Add loops for complexity (10% of walls)
    const loopChance = 0.1 + level * 0.01;
    for (let y = 1; y < h - 1; y += 2) {
        for (let x = 1; x < w - 1; x += 2) {
            if (Math.random() < loopChance) {
                const dirs = [
                    { dx: 0, dy: -1, wall: 1, owall: 4 },
                    { dx: 1, dy: 0, wall: 2, owall: 8 },
                    { dx: 0, dy: 1, wall: 4, owall: 1 },
                    { dx: -1, dy: 0, wall: 8, owall: 2 }
                ];
                const d = dirs[Math.floor(Math.random() * dirs.length)];
                const nx = x + d.dx * 2, ny = y + d.dy * 2;
                if (nx > 0 && ny > 0 && nx < w && ny < h) {
                    grid[y][x].walls &= ~d.wall;
                    grid[ny][nx].walls &= ~d.owall;
                }
            }
        }
    }

    // Place exit (far from start)
    let exitX = w - 2, exitY = h - 2;
    const pathToExit = bfsPath(grid, 1, 1, exitX, exitY, w, h);
    
    // Place artifacts along path and side branches
    const artifacts: Point[] = [];
    const artifactCount = Math.min(3 + Math.floor(level / 3), 8);
    const pathLen = pathToExit.length;
    
    // Place some on main path
    for (let i = 0; i < Math.min(artifactCount, pathLen / 3); i++) {
        const idx = Math.floor((i + 1) * pathLen / (artifactCount + 1));
        const p = pathToExit[idx];
        if (p.x !== 1 || p.y !== 1) artifacts.push({ x: p.x, y: p.y });
    }
    
    // Place remaining in dead ends
    const deadEnds: Point[] = [];
    for (let y = 1; y < h - 1; y += 2) {
        for (let x = 1; x < w - 1; x += 2) {
            let walls = 0;
            if (grid[y][x].walls & 1) walls++;
            if (grid[y][x].walls & 2) walls++;
            if (grid[y][x].walls & 4) walls++;
            if (grid[y][x].walls & 8) walls++;
            if (walls >= 3) deadEnds.push({ x, y });
        }
    }
    shuffle(deadEnds);
    for (const p of deadEnds) {
        if (artifacts.length >= artifactCount) break;
        if (p.x === 1 && p.y === 1) continue;
        if (p.x === exitX && p.y === exitY) continue;
        artifacts.push(p);
    }

    return { grid, width: w, height: h, exit: { x: exitX, y: exitY }, artifacts };
}

export function worldToCell(px: number, py: number): Point {
    return { x: Math.floor(px / CELL), y: Math.floor(py / CELL) };
}

export function cellToWorld(cx: number, cy: number): Point {
    return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
}

export function isWalkable(maze: MazeCell[][], x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < maze[0].length && y < maze.length && maze[y][x].walls !== undefined;
}

export function getNeighbors(maze: MazeCell[][], x: number, y: number): Point[] {
    const dirs = [
        { dx: 0, dy: -1, wall: 1 },
        { dx: 1, dy: 0, wall: 2 },
        { dx: 0, dy: 1, wall: 4 },
        { dx: -1, dy: 0, wall: 8 }
    ];
    const res: Point[] = [];
    for (const d of dirs) {
        const nx = x + d.dx, ny = y + d.dy;
        if (isWalkable(maze, nx, ny) && (maze[y][x].walls & d.wall) === 0) {
            res.push({ x: nx, y: ny });
        }
    }
    return res;
}