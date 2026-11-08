import type { Grid } from './layout'

export interface Pt {
  x: number
  y: number
}

/**
 * 4-connected A* over the walk grid with a binary-heap open list and typed-array bookkeeping, so a
 * cross-office route costs well under a millisecond. The start tile may be blocked (e.g. while seated).
 */
export function findPath(grid: Grid, from: Pt, to: Pt): Pt[] | null {
  const H = grid.length
  const W = grid[0].length
  if (to.x < 0 || to.y < 0 || to.x >= W || to.y >= H || !grid[to.y][to.x]) return null
  const N = W * H
  const g = new Float32Array(N).fill(Infinity)
  const came = new Int32Array(N).fill(-1)
  const closed = new Uint8Array(N)
  const start = from.y * W + from.x
  const goal = to.y * W + to.x
  g[start] = 0

  // binary min-heap of [f, key]
  const heapF: number[] = []
  const heapK: number[] = []
  const push = (f: number, k: number) => {
    let i = heapF.length
    heapF.push(f)
    heapK.push(k)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapF[p] <= heapF[i]) break
      ;[heapF[p], heapF[i]] = [heapF[i], heapF[p]]
      ;[heapK[p], heapK[i]] = [heapK[i], heapK[p]]
      i = p
    }
  }
  const pop = (): number => {
    const top = heapK[0]
    const lastF = heapF.pop()!
    const lastK = heapK.pop()!
    if (heapF.length) {
      heapF[0] = lastF
      heapK[0] = lastK
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heapF.length && heapF[l] < heapF[m]) m = l
        if (r < heapF.length && heapF[r] < heapF[m]) m = r
        if (m === i) break
        ;[heapF[m], heapF[i]] = [heapF[i], heapF[m]]
        ;[heapK[m], heapK[i]] = [heapK[i], heapK[m]]
        i = m
      }
    }
    return top
  }
  const h = (k: number) => Math.abs((k % W) - to.x) + Math.abs(Math.floor(k / W) - to.y)
  push(h(start), start)
  const DIRS = [1, -1, W, -W]

  while (heapF.length) {
    const k = pop()
    if (k === goal) {
      const path: Pt[] = []
      for (let c = k; c !== -1; c = came[c]) path.push({ x: c % W, y: Math.floor(c / W) })
      return path.reverse()
    }
    if (closed[k]) continue
    closed[k] = 1
    const cx = k % W
    const prevDir = came[k] === -1 ? 0 : k - came[k]
    for (const d of DIRS) {
      const nk = k + d
      const nx = nk % W
      const ny = Math.floor(nk / W)
      if (nk < 0 || nk >= N || Math.abs(nx - cx) > 1 || !grid[ny][nx] || closed[nk]) continue
      // small turn penalty keeps routes natural (fewer zig-zags)
      const ng = g[k] + 1 + (prevDir && d !== prevDir ? 0.3 : 0)
      if (ng < g[nk]) {
        g[nk] = ng
        came[nk] = k
        push(ng + h(nk), nk)
      }
    }
  }
  return null
}
