// Game scenes that play on their own while on screen. Each scene runs a
// timeline (progress 0..1 over DURATION seconds), holds the ending briefly,
// then loops; it restarts from the beginning whenever it comes back into view.
(() => {
  "use strict";

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DURATION = 9;  // seconds for one play-through
  const HOLD = 1.6;  // seconds to rest on the last frame before looping
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const span = (p, a, b) => clamp((p - a) / (b - a));
  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInCubic = (t) => t * t * t;

  function loadImages(map) {
    const out = {};
    return Promise.all(Object.entries(map).map(([key, src]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { out[key] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = src;
    }))).then(() => out);
  }

  // ---------- Maze Keep: blocks drop, towers rise, monsters march and fall ----------
  const MK = { cols: 9, rows: 7 };
  // Path the monsters walk: portal (left) to castle (right), in cell centres.
  const MK_PATH = [[-0.6, 1], [1, 1], [1, 5], [4, 5], [4, 1], [7, 1], [7, 3], [9.6, 3]];
  // Tetromino walls that shape the maze, dropped in this order.
  const MK_PIECES = [
    { c: "#ff7a59", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
    { c: "#59a8ff", cells: [[0, 2], [0, 3], [0, 4], [0, 5]] },
    { c: "#ffc93c", cells: [[2, 2], [3, 2], [2, 3], [3, 3]] },
    { c: "#a77bff", cells: [[0, 6], [1, 6], [2, 6], [3, 6]] },
    { c: "#58c96b", cells: [[5, 2], [5, 3], [5, 4], [6, 4]] },
    { c: "#ff7a59", cells: [[5, 0], [6, 0], [7, 0], [8, 0]] },
    { c: "#59a8ff", cells: [[5, 6], [6, 6], [7, 6], [8, 6]] },
    { c: "#ffc93c", cells: [[6, 5], [7, 5], [8, 5], [3, 1]] },
    { c: "#a77bff", cells: [[2, 4], [3, 4], [6, 2], [6, 3]] },
  ];
  // Towers sit on top of walls next to the path.
  const MK_TOWERS = [
    { cell: [2, 2], kind: "arrow", at: 0.42 },
    { cell: [5, 3], kind: "cannon", at: 0.47 },
    { cell: [3, 4], kind: "arrow", at: 0.52 },
    { cell: [6, 2], kind: "cannon", at: 0.57 },
  ];
  const MK_ENEMIES = 7;

  function pathLength(path) {
    let L = 0;
    for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    return L;
  }
  function pointAt(path, d) {
    for (let i = 1; i < path.length; i++) {
      const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      if (d <= seg) {
        const t = d / seg;
        return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
      }
      d -= seg;
    }
    return path[path.length - 1];
  }
  const MK_LEN = pathLength(MK_PATH);

  function tinted(img, color, size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, size, size);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(img, 0, 0, size, size);
    return c;
  }

  function mazeScene(img) {
    const tints = {};
    return (g, w, h, p, t) => {
      const cell = Math.min(w / (MK.cols + 1.2), h / (MK.rows + 0.8));
      const ox = (w - cell * MK.cols) / 2;
      const oy = (h - cell * MK.rows) / 2;
      const X = (x) => ox + (x + 0.5) * cell;
      const Y = (y) => oy + (y + 0.5) * cell;

      // Ground
      g.save();
      g.beginPath();
      g.roundRect(ox - cell * 0.35, oy - cell * 0.35, cell * (MK.cols + 0.7), cell * (MK.rows + 0.7), cell * 0.5);
      g.clip();
      if (img.ground_w1) {
        const pat = g.createPattern(img.ground_w1, "repeat");
        g.fillStyle = pat;
      } else g.fillStyle = "#7cc86a";
      g.fillRect(0, 0, w, h);
      g.restore();

      // Path dirt
      g.save();
      g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = "rgba(196,150,90,0.55)";
      g.lineWidth = cell * 0.62;
      g.beginPath();
      MK_PATH.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.stroke();
      g.restore();

      // Portal and castle
      const pulse = 1 + Math.sin(t * 3) * 0.04;
      if (img.portal) g.drawImage(img.portal, X(-0.5) - cell * 0.55 * pulse, Y(1) - cell * 0.55 * pulse, cell * 1.1 * pulse, cell * 1.1 * pulse);

      // Walls: each tetromino falls in with a bounce.
      MK_PIECES.forEach((piece, i) => {
        const start = 0.02 + i * 0.038;
        const k = span(p, start, start + 0.09);
        if (k <= 0) return;
        const drop = (1 - easeOutBack(k)) * -h * 0.6;
        const key = piece.c;
        if (!tints[key] && img.block) tints[key] = tinted(img.block, key, 128);
        piece.cells.forEach(([cx, cy]) => {
          const x = X(cx) - cell / 2, y = Y(cy) - cell / 2 + drop;
          g.globalAlpha = clamp(k * 3);
          if (tints[key]) g.drawImage(tints[key], x, y, cell, cell);
          else { g.fillStyle = key; g.fillRect(x + 2, y + 2, cell - 4, cell - 4); }
          g.globalAlpha = 1;
        });
      });

      if (img.castle) g.drawImage(img.castle, X(MK.cols - 0.4) - cell * 0.75, Y(3) - cell * 0.75, cell * 1.5, cell * 1.5);

      // Monsters: march in after the towers, fall one by one.
      const marchStart = 0.5;
      const alive = [];
      for (let j = 0; j < MK_ENEMIES; j++) {
        const d = (p - marchStart) * MK_LEN * 2.2 - j * 1.15;
        if (d < 0) continue;
        const dieAt = 0.66 + j * 0.045;
        const kill = span(p, dieAt, dieAt + 0.03);
        const [px, py] = pointAt(MK_PATH, Math.min(d, MK_LEN));
        const sprite = [img.enemy_grunt, img.enemy_runner, img.enemy_shield][j % 3];
        if (kill >= 1) {
          // Puff where it fell.
          const puff = span(p, dieAt + 0.03, dieAt + 0.09);
          if (puff < 1) {
            g.globalAlpha = 1 - puff;
            for (let s = 0; s < 6; s++) {
              const a = (s / 6) * Math.PI * 2;
              const r = cell * (0.2 + puff * 0.55);
              g.fillStyle = s % 2 ? "#fff3c2" : "#ffd04d";
              g.beginPath(); g.arc(X(px) + Math.cos(a) * r, Y(py) + Math.sin(a) * r, cell * 0.08 * (1 - puff) + 1, 0, 7); g.fill();
            }
            g.globalAlpha = 1;
          }
          continue;
        }
        const bob = Math.sin(t * 9 + j) * cell * 0.04;
        const sz = cell * 0.78 * (1 - kill * 0.6);
        if (sprite) g.drawImage(sprite, X(px) - sz / 2, Y(py) - sz / 2 + bob, sz, sz);
        alive.push([X(px), Y(py) + bob]);
      }

      // Towers pop up on the walls and fire at the nearest monster.
      MK_TOWERS.forEach((tw, i) => {
        const k = span(p, tw.at, tw.at + 0.06);
        if (k <= 0) return;
        const s = easeOutBack(k);
        const tx = X(tw.cell[0]), ty = Y(tw.cell[1]);
        const sz = cell * 1.05 * s;
        if (img.tower_base) g.drawImage(img.tower_base, tx - sz / 2, ty - sz / 2, sz, sz);
        const head = tw.kind === "arrow" ? img.tower_arrow : img.tower_cannon;
        if (head) g.drawImage(head, tx - sz / 2, ty - sz / 2, sz, sz);
        if (k < 1 || !alive.length) return;
        let best = null, bd = Infinity;
        alive.forEach(([mx, my]) => { const dd = Math.hypot(mx - tx, my - ty); if (dd < bd) { bd = dd; best = [mx, my]; } });
        if (!best || bd > cell * 3.2) return;
        const f = (t * 1.6 + i * 0.37) % 1;
        const bx = tx + (best[0] - tx) * f, by = ty + (best[1] - ty) * f;
        g.save();
        if (tw.kind === "arrow") {
          const ang = Math.atan2(best[1] - ty, best[0] - tx);
          g.translate(bx, by); g.rotate(ang);
          g.strokeStyle = "#5b3a1e"; g.lineWidth = Math.max(2, cell * 0.06);
          g.beginPath(); g.moveTo(-cell * 0.22, 0); g.lineTo(cell * 0.18, 0); g.stroke();
          g.fillStyle = "#e8e8e8";
          g.beginPath(); g.moveTo(cell * 0.26, 0); g.lineTo(cell * 0.14, -cell * 0.07); g.lineTo(cell * 0.14, cell * 0.07); g.fill();
        } else {
          g.fillStyle = "#2b2b33";
          g.beginPath(); g.arc(bx, by, cell * 0.11, 0, 7); g.fill();
          if (f > 0.85) {
            g.fillStyle = "rgba(255,200,80,0.8)";
            g.beginPath(); g.arc(best[0], best[1], cell * 0.32 * (f - 0.85) / 0.15, 0, 7); g.fill();
          }
        }
        g.restore();
      });
    };
  }

  // ---------- Driver ----------
  function mount(section, draw) {
    const canvas = section.querySelector("canvas");
    const g = canvas.getContext("2d");
    const captions = [...section.querySelectorAll("[data-at]")];
    let visible = false;
    let raf = 0;

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    let startedAt = 0;
    function progress(now) {
      if (reduceMotion) return 0.62;
      const t = (now - startedAt) / 1000 % (DURATION + HOLD);
      return Math.min(1, t / DURATION);
    }

    function frame(now) {
      const p = progress(now);
      const r = canvas.getBoundingClientRect();
      g.clearRect(0, 0, r.width, r.height);
      draw(g, r.width, r.height, p, now / 1000);
      captions.forEach((el) => {
        const [a, b] = el.dataset.at.split(",").map(Number);
        el.classList.toggle("on", p >= a && p < b);
      });
      if (visible && !reduceMotion) raf = requestAnimationFrame(frame);
    }

    new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible && !was) startedAt = performance.now();
      if (visible) raf = requestAnimationFrame(frame);
    }, { threshold: 0.45 }).observe(section);
    new ResizeObserver(() => { size(); requestAnimationFrame(frame); }).observe(canvas);
    size();
    requestAnimationFrame(frame);
  }

  const MK_IMAGES = Object.fromEntries(["block", "castle", "portal", "tower_base", "tower_arrow", "tower_cannon",
    "enemy_grunt", "enemy_runner", "enemy_shield", "ground_w1"].map((k) => [k, `assets/mk/${k}.png`]));

  const maze = document.getElementById("scene-maze");
  if (maze) loadImages(MK_IMAGES).then((img) => mount(maze, mazeScene(img)));
})();
