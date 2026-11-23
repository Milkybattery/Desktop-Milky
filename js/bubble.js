// Places the speech bubble and aims its tail, every frame, from where she actually is on screen.
//
//  - the bubble never overlaps her: it sits on the side with room (left, else right, else above)
//    and narrows horizontally to fit the free space when she takes up a lot of the stage
//  - the tail's base is the middle of the bubble's edge that faces her
//  - the tail points at a fixed spot on her head and stops a set distance short of it; that spot
//    only moves when she does, not when she turns her head

export class BubbleLayout {
  constructor({ stage, bubble }) {
    this.stage = stage;
    this.bubble = bubble;
    this.body = bubble.querySelector('.body');
    this.path = bubble.querySelector('.shape path');
    this.side = 'left';
    this.lim = 0;       // width the bubble may use, with hysteresis so it doesn't flicker
    this.h = 0;         // bubble height from the last frame
    this.fresh = true;  // snap to the first layout instead of easing
    this.R = 80;        // rows in the silhouette profile
    this.L = new Float32Array(this.R);
    this.Rr = new Float32Array(this.R);
  }

  update() {
    const b = this.bubble;
    if (b.classList.contains('hidden')) { this.fresh = true; return; }
    const sil = this.stage.silhouette();
    if (!sil || !sil.head) return;
    const { W, H, buf, n, head } = sil;
    const small = W < 520;

    const m = 0.035 * W;          // margin to the stage edge
    const pad = 0.022 * W;        // keep this far from her
    const tailMin = 0.06 * W;     // the tail always has at least this much room
    const tailGap = 0.03 * W;     // safety: the tip stops this far from her outline
    const headGap = 0.115 * W;    // the tip stops this far from the spot she keeps her head
    const prefW = (small ? 0.66 : 0.36) * W;
    const minW = (small ? 0.4 : 0.17) * W;
    const ym = 0.05 * H;

    // her outline as a left/right extent per row, grown by pad
    const { R, L, Rr } = this;
    const rowH = H / R;
    L.fill(Infinity); Rr.fill(-Infinity);
    let top = Infinity;
    for (let i = 0; i < n; i += 2) {
      const x = buf[i], y = buf[i + 1];
      if (y < top) top = y;
      const r0 = Math.max(0, Math.floor((y - pad) / rowH));
      const r1 = Math.min(R - 1, Math.floor((y + pad) / rowH));
      for (let r = r0; r <= r1; r++) {
        if (x - pad < L[r]) L[r] = x - pad;
        if (x + pad > Rr[r]) Rr[r] = x + pad;
      }
    }

    // free width beside her over the rows the bubble covers
    const rs = Math.max(0, Math.floor(ym / rowH));
    const re = Math.min(R - 1, Math.floor((ym + Math.max(this.h, 0.1 * H)) / rowH));
    let leftEdge = Infinity, rightEdge = -Infinity;
    for (let r = rs; r <= re; r++) {
      if (L[r] < leftEdge) leftEdge = L[r];
      if (Rr[r] > rightEdge) rightEdge = Rr[r];
    }
    if (leftEdge === Infinity) { leftEdge = W; rightEdge = 0; }
    const availL = leftEdge - tailMin - m;
    const availR = W - m - (rightEdge + tailMin);
    const roomTop = top - pad - tailMin - ym;

    // pick a side, staying put while it still fits
    let side = this.side;
    const okL = availL >= minW, okR = availR >= minW, okT = roomTop >= 0.18 * H;
    const stays = (side === 'left' && availL >= minW * 0.9)
      || (side === 'right' && availR >= minW * 0.9)
      || (side === 'top' && okT && !okL && !okR);
    if (!stays) side = okL ? 'left' : okR ? 'right' : okT ? 'top' : (availL >= availR ? 'left' : 'right');
    if (side !== this.side) { this.side = side; this.fresh = true; }

    let x, w, maxH = H - ym - m;
    if (side === 'top') {
      w = Math.min(1.25 * prefW, W - 2 * m);
      x = Math.min(Math.max(head.x - w / 2, m), W - m - w);
      maxH = Math.max(0.12 * H, roomTop);
    } else {
      // she can only squeeze the bubble hard; it grows back gently
      const raw = side === 'left' ? availL : availR;
      const slack = 0.012 * W, grow = 0.02 * W;
      if (this.fresh) this.lim = raw - slack;
      else if (raw < this.lim) this.lim = raw - slack;
      else if (raw > this.lim + slack + grow) this.lim += (raw - slack - this.lim) * 0.1;
      w = Math.min(prefW, Math.max(0.1 * W, this.lim));
      x = side === 'left' ? m : W - m - w;
    }
    this.fresh = false;

    const q = (v) => Math.round(v * 2) / 2;
    b.style.left = q(x) + 'px';
    b.style.top = q(ym) + 'px';
    b.style.width = q(w) + 'px';
    b.style.maxHeight = q(maxH) + 'px';
    this.body.style.maxHeight = q(maxH) + 'px';
    const bw = b.offsetWidth, bh = b.offsetHeight;
    this.h = bh;

    // tail: base in the middle of the edge facing her head
    const cx = x + bw / 2, cy = ym + bh / 2;
    const dx = head.x - cx, dy = head.y - cy;
    const tx = dx ? (bw / 2) / Math.abs(dx) : Infinity;
    const ty = dy ? (bh / 2) / Math.abs(dy) : Infinity;
    let nx = 0, ny = 0, bx, by;
    if (tx < ty) { nx = dx > 0 ? 1 : -1; bx = x + (nx > 0 ? bw : 0); by = cy; }
    else { ny = dy > 0 ? 1 : -1; bx = cx; by = ym + (ny > 0 ? bh : 0); }

    // the tip sits a fixed distance short of her head's spot, on the line from the base to it
    const len = Math.hypot(head.x - bx, head.y - by) || 1;
    const ux = (head.x - bx) / len, uy = (head.y - by) / len;
    let s = Math.max(len - headGap, 0.015 * W);
    // safety: never let the tip reach into her outline, whatever pose she is in
    const clear = pad - tailGap;
    for (let t = 0; t < s; t += 3) {
      const px = bx + ux * t, py = by + uy * t;
      const r = Math.min(R - 1, Math.max(0, Math.floor(py / rowH)));
      if (px > L[r] + clear && px < Rr[r] - clear) { s = Math.max(t - 3, 0.015 * W); break; }
    }
    const tipX = bx + ux * s - x, tipY = by + uy * s - ym;

    // one outline for bubble and tail, so there is no seam between them
    const sw = Math.max(2, 0.005 * W);
    const r = Math.min(0.026 * W, bw / 2 - sw, bh / 2 - sw);
    const x0 = sw / 2, y0 = sw / 2, x1 = bw - sw / 2, y1 = bh - sw / 2;
    const mx = bw / 2, my = bh / 2;
    const edge = nx ? bh : bw;
    const hw = Math.max(1, Math.min(0.02 * W, (edge - 2 * r) * 0.45));
    const T = `L${tipX.toFixed(1)} ${tipY.toFixed(1)} `;
    let d = `M${x0 + r} ${y0} `;
    if (ny < 0) d += `L${mx - hw} ${y0} ${T}L${mx + hw} ${y0} `;
    d += `L${x1 - r} ${y0} A${r} ${r} 0 0 1 ${x1} ${y0 + r} `;
    if (nx > 0) d += `L${x1} ${my - hw} ${T}L${x1} ${my + hw} `;
    d += `L${x1} ${y1 - r} A${r} ${r} 0 0 1 ${x1 - r} ${y1} `;
    if (ny > 0) d += `L${mx + hw} ${y1} ${T}L${mx - hw} ${y1} `;
    d += `L${x0 + r} ${y1} A${r} ${r} 0 0 1 ${x0} ${y1 - r} `;
    if (nx < 0) d += `L${x0} ${my + hw} ${T}L${x0} ${my - hw} `;
    d += `L${x0} ${y0 + r} A${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
    this.path.setAttribute('d', d);
    this.path.setAttribute('stroke-width', sw);
    b.style.transformOrigin = `${(bx - x).toFixed(1)}px ${(by - ym).toFixed(1)}px`;
  }
}
