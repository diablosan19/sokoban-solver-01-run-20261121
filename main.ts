// sokoban-solver: a push-optimal Sokoban solver for make.fun's
// sokoban-solver-01-run-20261121.
//
// Strategy. The generator lays one hallway row across the board with 1-4
// rooms (6x6 slots) off it through one door each, 3-4 boxes/goals per room,
// and a level's push-optimal count is the sum of its rooms' optima, boxes
// never leaving their room. So each level is decomposed into hallway +
// rooms, every room is solved independently with a push-based A* (cost =
// pushes, minimum-assignment box-to-goal heuristic over BFS distances,
// exact dead-square pruning plus 2x2 frozen-block pruning), and the rooms
// are stitched together with BFS player walks through the hallway. A
// whole-board push A* is kept as a fallback if decomposition ever fails.
//
// Determinism: every search is bounded by counted expansions, never by the
// wall clock; iteration orders are fixed, so two runs write identical bytes.
// Only the Node standard library is used; no network, no clock reads.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Per-room expansion cap and whole-run expansion cap (counted work, never
// the clock, so the 60s wall budget is respected deterministically).
const ROOM_BUDGET = 400_000;
const GLOBAL_BUDGET = 1_500_000;
const WHOLE_BUDGET = 200_000;
const NODE_CAP = 2_000_000;
let globalExpansions = 0;

interface Dir {
  dx: number;
  dy: number;
  ch: string;
}
const DIRS: Dir[] = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];

interface Level {
  w: number;
  h: number;
  wall: boolean[];
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split(/\r?\n/).filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall: boolean[] = new Array(w * h).fill(true);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = 0;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      wall[i] = ch === '#';
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

// Breadth-first walk from `from` to `to` over cells passing `passable`.
// Returns the move string, '' when from === to, null when unreachable.
// Fixed direction order and FIFO queue make the path deterministic.
function walkPath(
  from: number,
  to: number,
  w: number,
  h: number,
  passable: (c: number) => boolean,
): string | null {
  if (from === to) return '';
  const prev = new Map<number, { p: number; ch: string }>();
  const q: number[] = [from];
  prev.set(from, { p: -1, ch: '' });
  let head = 0;
  while (head < q.length) {
    const cur = q[head++]!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (prev.has(n) || !passable(n)) continue;
      prev.set(n, { p: cur, ch: d.ch });
      if (n === to) {
        let s = '';
        let c = n;
        while (c !== from) {
          const e = prev.get(c)!;
          s = e.ch + s;
          c = e.p;
        }
        return s;
      }
      q.push(n);
    }
  }
  return null;
}

// All cells reachable from `from` without stepping on a blocked cell.
function regionCells(
  from: number,
  w: number,
  h: number,
  blocked: (c: number) => boolean,
): Set<number> {
  const seen = new Set<number>([from]);
  const q: number[] = [from];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++]!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen.has(n) || blocked(n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

// Minimum-cost assignment (Hungarian algorithm, O(n^3), deterministic).
// cost is n x n; returns the minimum total and the assignment assign[i]=j.
// A total >= INF/2 means some assigned pair was unreachable.
const INF = 1e9;
function hungarian(cost: number[][]): { total: number; assign: number[] } {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const assign = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j]! > 0) assign[p[j]! - 1] = j - 1;
  }
  let total = 0;
  for (let i = 0; i < n; i++) total += cost[i]![assign[i]!]!;
  return { total, assign };
}

interface PushResult {
  moves: string;
  pushes: number;
  endPlayer: number;
  boxes: number[];
}

// Push-based A* over one cell set (a room, or the whole board as fallback).
// State: sorted box cells + the player's reachable region (canonicalised to
// its lowest cell). Cost is pushes; the heuristic is the minimum-assignment
// box-to-goal distance over wall-only BFS distances (admissible, so the
// result is push-optimal within the budget). `exitCell` (-1 for none) must
// be reachable by the player, boxes as obstacles, in the goal state.
function solvePush(
  w: number,
  h: number,
  cellSet: Set<number>,
  goals: number[],
  boxes0: number[],
  player0: number,
  exitCell: number,
  budget: number,
): PushResult | null {
  const goalSet = new Set(goals);
  const n = goals.length;
  if (boxes0.length !== n) return null;
  if (n === 0) return { moves: '', pushes: 0, endPlayer: player0, boxes: [] };

  // BFS distances from each goal over the cell set (walls only).
  const dist: Int32Array[] = goals.map((g) => {
    const d = new Int32Array(w * h).fill(-1);
    d[g] = 0;
    const q: number[] = [g];
    let head = 0;
    while (head < q.length) {
      const cur = q[head++]!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const dir of DIRS) {
        const nx = cx + dir.dx;
        const ny = cy + dir.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nn = ny * w + nx;
        if (!cellSet.has(nn) || d[nn] !== -1) continue;
        d[nn] = d[cur]! + 1;
        q.push(nn);
      }
    }
    return d;
  });

  const blockedBy = (boxSet: Set<number>) => (c: number): boolean =>
    !cellSet.has(c) || boxSet.has(c);

  // Exact dead squares: a cell is dead when a lone box on it, with the
  // player free to roam anywhere, can never be pushed onto a goal.
  const dead = new Set<number>();
  {
    const canReachGoal = (start: number): boolean => {
      const seen = new Set<string>();
      const queue: [number, number][] = [];
      // The player may start in any region of the room minus the box.
      const occupied = new Set<number>([start]);
      // Regions of the room with the box cell removed.
      const regionSeen = new Set<number>();
      for (const c of cellSet) {
        if (occupied.has(c) || regionSeen.has(c)) continue;
        const reg = regionCells(c, w, h, (x) => !cellSet.has(x) || occupied.has(x));
        for (const r of reg) regionSeen.add(r);
        const canon = Math.min(...reg);
        const k = `${start}|${canon}`;
        seen.add(k);
        queue.push([start, canon]);
      }
      let head = 0;
      while (head < queue.length) {
        const [b, p] = queue[head++]!;
        if (goalSet.has(b)) return true;
        const bset = new Set<number>([b]);
        const region = regionCells(p, w, h, blockedBy(bset));
        const bx = b % w;
        const by = Math.floor(b / w);
        for (const d of DIRS) {
          const pushPos = (by - d.dy) * w + (bx - d.dx);
          if (!region.has(pushPos)) continue;
          const t = (by + d.dy) * w + (bx + d.dx);
          if (!cellSet.has(t)) continue;
          const tset = new Set<number>([t]);
          const reg2 = regionCells(b, w, h, blockedBy(tset));
          const canon = Math.min(...reg2);
          const k = `${t}|${canon}`;
          if (!seen.has(k)) {
            seen.add(k);
            queue.push([t, canon]);
          }
        }
      }
      return false;
    };
    for (const c of cellSet) {
      if (!goalSet.has(c) && !canReachGoal(c)) dead.add(c);
    }
  }

  // A box not on a goal inside a 2x2 block of walls/boxes can never move.
  const hasDeadBlock = (boxes: number[], boxSet: Set<number>): boolean => {
    const isBlocking = (c: number): boolean => !cellSet.has(c) || boxSet.has(c);
    for (const b of boxes) {
      if (goalSet.has(b)) continue;
      const bx = b % w;
      const by = Math.floor(b / w);
      for (const [ox, oy] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ] as const) {
        let all = true;
        for (const [cx, cy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const x = bx + ox + cx;
          const y = by + oy + cy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue; // off-board is a wall
          if (!isBlocking(y * w + x)) {
            all = false;
            break;
          }
        }
        if (all) return true;
      }
    }
    return false;
  };

  const heuristic = (boxes: number[]): number => {
    const cost: number[][] = boxes.map((b) =>
      goals.map((_, j) => {
        const d = dist[j]![b]!;
        return d === -1 ? INF : d;
      }),
    );
    const { total } = hungarian(cost);
    return total >= INF / 2 ? Infinity : total;
  };

  const keyOf = (boxes: number[], canon: number): string =>
    `${boxes.join(',')}|${canon}`;

  // Initial state sanity: no box on a dead square, no frozen 2x2 block.
  for (const b of boxes0) if (dead.has(b)) return null;
  if (hasDeadBlock(boxes0, new Set(boxes0))) return null;
  if (heuristic(boxes0) === Infinity) return null;

  // Node storage: boxes, player, g, parent index, transition moves.
  const nBoxes: number[][] = [boxes0.slice()];
  const nPlayer: number[] = [player0];
  const nG: number[] = [0];
  const nParent: number[] = [-1];
  const nMoves: string[] = [''];
  const best = new Map<string, number>();
  const canon0 = Math.min(
    ...regionCells(player0, w, h, blockedBy(new Set(boxes0))),
  );
  best.set(keyOf(boxes0, canon0), 0);

  // Binary heap ordered by (f asc, g desc, insertion seq asc).
  interface HeapEntry {
    f: number;
    g: number;
    seq: number;
    node: number;
  }
  const heap: HeapEntry[] = [];
  let seq = 0;
  const heapLess = (a: HeapEntry, b: HeapEntry): boolean =>
    a.f < b.f || (a.f === b.f && (a.g > b.g || (a.g === b.g && a.seq < b.seq)));
  const heapPush = (e: HeapEntry): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): HeapEntry => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
        if (!heapLess(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };
  heapPush({ f: heuristic(boxes0), g: 0, seq: seq++, node: 0 });

  let expansions = 0;
  while (heap.length > 0) {
    const entry = heapPop();
    const s = entry.node;
    const boxes = nBoxes[s]!;
    const player = nPlayer[s]!;
    const g = nG[s]!;
    const boxSet = new Set(boxes);
    const region = regionCells(player, w, h, blockedBy(boxSet));
    const canon = Math.min(...region);
    if (best.get(keyOf(boxes, canon)) !== g) continue; // stale entry
    if (globalExpansions >= GLOBAL_BUDGET) return null;
    expansions++;
    globalExpansions++;
    if (expansions > budget) return null;

    // Goal: every box on a goal, and the exit reachable when required.
    if (boxes.every((b) => goalSet.has(b))) {
      if (exitCell === -1 || region.has(exitCell)) {
        let moves = '';
        for (let t = s; t > 0; t = nParent[t]!) moves = nMoves[t]! + moves;
        return { moves, pushes: g, endPlayer: player, boxes: boxes.slice() };
      }
      // Solved but the player cannot leave: keep searching.
      continue;
    }

    for (const b of boxes) {
      const bx = b % w;
      const by = Math.floor(b / w);
      for (const d of DIRS) {
        const pushPos = (by - d.dy) * w + (bx - d.dx);
        if (!region.has(pushPos)) continue;
        const t = (by + d.dy) * w + (bx + d.dx);
        if (!cellSet.has(t) || boxSet.has(t)) continue;
        if (dead.has(t)) continue;
        const nb = boxes.slice();
        nb[nb.indexOf(b)] = t;
        nb.sort((a, b2) => a - b2);
        const nbSet = new Set(nb);
        if (hasDeadBlock(nb, nbSet)) continue;
        const h2 = heuristic(nb);
        if (!Number.isFinite(h2)) continue;
        const reg2 = regionCells(b, w, h, blockedBy(nbSet));
        const canon2 = Math.min(...reg2);
        const k2 = keyOf(nb, canon2);
        const seenG = best.get(k2);
        if (seenG !== undefined && seenG <= g + 1) continue;
        const walk = walkPath(player, pushPos, w, h, (c) => !boxSet.has(c) && cellSet.has(c));
        if (walk === null) continue; // cannot happen: pushPos is in region
        const idx = nBoxes.length;
        if (idx >= NODE_CAP) return null;
        nBoxes.push(nb);
        nPlayer.push(b);
        nG.push(g + 1);
        nParent.push(s);
        nMoves.push(walk + d.ch.toUpperCase());
        best.set(k2, g + 1);
        heapPush({ f: g + 1 + h2, g: g + 1, seq: seq++, node: idx });
      }
    }
  }
  return null;
}

interface Room {
  cells: number[];
  cellSet: Set<number>;
  boxes: number[];
  goals: number[];
  door: number;
  entryHall: number;
  entryDx: number;
  entryDy: number;
}

// Solve one level. Returns the move string ('' when unsolved).
function solveLevel(text: string): string {
  const lv = parseLevel(text);
  const { w, h } = lv;
  if (lv.boxes.length === 0) return '';

  const wholeFallback = (): string => {
    const cellSet = new Set<number>();
    for (let i = 0; i < w * h; i++) if (!lv.wall[i]) cellSet.add(i);
    const res = solvePush(w, h, cellSet, lv.goals, lv.boxes, lv.player, -1, WHOLE_BUDGET);
    return res ? res.moves : '';
  };

  const hy = Math.floor(lv.player / w);
  const inHallway = (c: number): boolean => Math.floor(c / w) === hy;

  // Connected components of the floor off the hallway row: the rooms.
  const seen = new Set<number>();
  const rooms: Room[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lv.wall[i] || inHallway(i) || seen.has(i)) continue;
    const comp = regionCells(i, w, h, (c) => lv.wall[c] || inHallway(c));
    for (const c of comp) seen.add(c);
    const cells = [...comp].sort((a, b) => a - b);
    const cellSet = new Set(cells);
    const boxes = lv.boxes.filter((b) => cellSet.has(b));
    const goals = lv.goals.filter((g) => cellSet.has(g));
    // The door: the room cell next to a hallway floor cell.
    let door = -1;
    let entryHall = -1;
    let entryDx = 0;
    let entryDy = 0;
    for (const c of cells) {
      const cx = c % w;
      const cy = Math.floor(c / w);
      for (const d of DIRS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (inHallway(n) && !lv.wall[n]) {
          door = c;
          entryHall = n;
          entryDx = d.dx;
          entryDy = d.dy;
          break;
        }
      }
      if (door !== -1) break;
    }
    if (door === -1 || boxes.length !== goals.length) return wholeFallback();
    rooms.push({ cells, cellSet, boxes, goals, door, entryHall, entryDx, entryDy });
  }
  // Every box must belong to exactly one room.
  if (rooms.reduce((a, r) => a + r.boxes.length, 0) !== lv.boxes.length) {
    return wholeFallback();
  }
  if (rooms.length === 0) return wholeFallback();

  // A room whose door cell is a goal is solved last: the player cannot
  // leave through a door a solved box sits on.
  const doorIsGoal = (r: Room): boolean => r.goals.includes(r.door);
  rooms.sort((a, b) => {
    const ga = doorIsGoal(a) ? 1 : 0;
    const gb = doorIsGoal(b) ? 1 : 0;
    return ga - gb || a.door - b.door;
  });

  let moves = '';
  let curPlayer = lv.player;
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri]!;
    const last = ri === rooms.length - 1;
    // Walk the hallway to the cell outside the door.
    const toDoor = walkPath(
      curPlayer,
      room.entryHall,
      w,
      h,
      (c) => inHallway(c) && !lv.wall[c],
    );
    if (toDoor === null) return wholeFallback();
    moves += toDoor;
    // Step into the door, pushing a box there one cell inward if needed.
    // (entryDx, entryDy) points from the door toward the hallway, so the
    // player enters, and pushes, in the opposite direction.
    const entryDir = DIRS.find((d) => d.dx === -room.entryDx && d.dy === -room.entryDy)!;
    const roomBoxes = room.boxes.slice();
    const atDoor = roomBoxes.indexOf(room.door);
    if (atDoor >= 0) {
      const target = room.door - room.entryDy * w - room.entryDx;
      if (!room.cellSet.has(target) || roomBoxes.includes(target)) return wholeFallback();
      roomBoxes[atDoor] = target;
      roomBoxes.sort((a, b) => a - b);
      moves += entryDir.ch.toUpperCase();
    } else {
      moves += entryDir.ch;
    }
    const res = solvePush(
      w,
      h,
      room.cellSet,
      room.goals,
      roomBoxes,
      room.door,
      last ? -1 : room.door,
      ROOM_BUDGET,
    );
    if (!res) return wholeFallback();
    moves += res.moves;
    if (!last) {
      // Walk back out through the door to the hallway.
      const out = walkPath(
        res.endPlayer,
        room.door,
        w,
        h,
        (c) => room.cellSet.has(c) && !new Set(res.boxes).has(c),
      );
      if (out === null) return wholeFallback();
      moves += out;
      const exitDir = DIRS.find((d) => d.dx === room.entryDx && d.dy === room.entryDy)!;
      moves += exitDir.ch;
      curPlayer = room.entryHall;
    }
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const dir = join(I, id);
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(dir, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
