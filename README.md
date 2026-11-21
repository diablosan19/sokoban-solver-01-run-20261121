[![sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/diablosan19/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/diablosan19/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

# sokoban-solver

A push-optimal Sokoban solver for the [make.fun bounty](https://make.fun/bounty/sokoban-solver-01-run-20261121):
one program answers all 5 instances of a set in as few pushes as possible.
Scores **1,000,000** (push-optimal on every instance) on the practice set,
against the house baseline plain-astar's 200,000, in ~0.6s per set.

## How it works

The generator lays one hallway row across the board with 1–4 rooms off it
through one door each, 3–4 boxes/goals per room, and a level's push-optimal
count is the sum of its rooms' optima — boxes never leave their room. The
solver exploits exactly that:

1. **Decompose** the level into hallway + rooms (connected components of the
   floor off the hallway row), one door per room.
2. **Solve each room independently** with a push-based A*: cost is pushes,
   the heuristic is the minimum-assignment box-to-goal distance over
   wall-only BFS distances (admissible, so the result is push-optimal),
   with exact dead-square pruning (a lone box that can never reach a goal)
   and 2×2 frozen-block pruning. A box sitting in a door is pushed one
   cell inward on entry, as the player must do to get in.
3. **Stitch** the rooms together with BFS player walks through the hallway,
   exiting each room back through its door (a room whose door is a goal is
   solved last, since the player cannot leave through a solved box).

A whole-board push A* with the same machinery is kept as a fallback if
decomposition ever fails. Every search is bounded by counted expansions,
never by the wall clock, and all iteration orders are fixed — two runs
write byte-identical outputs.

## Run it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is Node 22 TypeScript (erasable syntax), standard library only:
no dependencies, no network, no clock reads. It reads
`MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` (defaulting to `/input` /
`/output`) and writes `solution.txt` per instance (`u/d/l/r`, uppercase =
push).

## Results

| set | i001 | i002 | i003 | i004 | i005 | score |
| --- | ---- | ---- | ---- | ---- | ---- | ----- |
| practice | 13/13 | 16/16 | 29/29 | 47/47 | 60/60 | 1,000,000 |
| 10 freshly drawn sets | optimal | optimal | optimal | optimal | optimal | 1,000,000 each |

Pushes shown against each instance's push-optimal count. Verified with
the kit scorer (`program/scorer/score.ts`) and by running twice and
diffing the outputs.
