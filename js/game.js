/**
 * 淘金者 / Lode Runner — HTML5 Canvas 引擎
 * 经典挖洞、爬梯、攀绳、捡金、躲敌
 */
(function () {
  "use strict";

  const COLS = 28;
  const ROWS = 16;
  const TILE = 30;
  const W = COLS * TILE;
  const H = ROWS * TILE;

  const T = {
    EMPTY: 0,
    BRICK: 1,
    SOLID: 2,
    LADDER: 3,
    ROPE: 4,
    GOLD: 5,
    HOLE: 6,
    EXIT: 7,
  };

  const HOLE_DURATION = 4200;
  const ENEMY_TRAP_TIME = 1800;
  const PLAYER_SPEED = 2.4;
  const FALL_SPEED = 3.2;
  const ENEMY_SPEED = 1.35;
  const START_LIVES = 3;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const el = {
    level: document.getElementById("level-num"),
    lives: document.getElementById("lives"),
    goldGot: document.getElementById("gold-got"),
    goldTotal: document.getElementById("gold-total"),
    score: document.getElementById("score"),
    overlay: document.getElementById("overlay"),
    title: document.getElementById("overlay-title"),
    sub: document.getElementById("overlay-sub"),
    body: document.getElementById("overlay-body"),
    btn: document.getElementById("overlay-btn"),
  };

  const keys = Object.create(null);
  let digLeftQueued = false;
  let digRightQueued = false;

  // —— 输入：键盘 ——
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "KeyZ") digLeftQueued = true;
    if (e.code === "KeyX") digRightQueued = true;
    if (e.code === "KeyP") togglePause();
    if (e.code === "KeyR" && state.mode === "play") die(true);
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyZ","KeyX","Space"].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  // —— 输入：触屏按钮 ——
  function bindTouchBtn(btn) {
    const code = btn.dataset.key;
    const isDig = code === "KeyZ" || code === "KeyX";
    const set = (down) => {
      keys[code] = down;
      btn.classList.toggle("pressed", down);
      if (down && code === "KeyZ") digLeftQueued = true;
      if (down && code === "KeyX") digRightQueued = true;
    };
    const onDown = (e) => { e.preventDefault(); set(true); };
    const onUp = (e) => { e.preventDefault(); set(false); };
    btn.addEventListener("touchstart", onDown, { passive: false });
    btn.addEventListener("touchend", onUp, { passive: false });
    btn.addEventListener("touchcancel", onUp, { passive: false });
    btn.addEventListener("mousedown", onDown);
    btn.addEventListener("mouseup", onUp);
    btn.addEventListener("mouseleave", onUp);
    // 防止拖出按钮后卡住
    if (!isDig) {
      btn.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    }
  }
  document.querySelectorAll("#touch-controls .tbtn").forEach(bindTouchBtn);

  // 防止页面滚动/双击缩放干扰
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.getElementById("touch-controls").addEventListener("touchmove", (e) => {
    e.preventDefault();
  }, { passive: false });

  const state = {
    mode: "title", // title | play | pause | clear | over | win
    levelIndex: 0,
    lives: START_LIVES,
    score: 0,
    map: null,
    holes: [],
    player: null,
    enemies: [],
    goldLeft: 0,
    goldTotal: 0,
    exitReady: false,
    anim: 0,
    overlayAction: null,
  };

  function showOverlay(title, sub, body, btnText, action) {
    el.title.textContent = title;
    el.sub.textContent = sub || "";
    el.body.innerHTML = body || "";
    el.btn.textContent = btnText;
    state.overlayAction = action;
    el.overlay.classList.remove("hidden");
  }
  function hideOverlay() {
    el.overlay.classList.add("hidden");
    state.overlayAction = null;
  }
  el.btn.addEventListener("click", () => {
    if (typeof state.overlayAction === "function") state.overlayAction();
  });
  el.btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (typeof state.overlayAction === "function") state.overlayAction();
  }, { passive: false });

  function updateHud() {
    el.level.textContent = String(state.levelIndex + 1);
    el.lives.textContent = String(state.lives);
    el.goldGot.textContent = String(state.goldTotal - state.goldLeft);
    el.goldTotal.textContent = String(state.goldTotal);
    el.score.textContent = String(state.score);
  }

  function parseLevel(raw) {
    const map = [];
    let player = null;
    const enemies = [];
    let gold = 0;
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      const line = raw[y] || ".".repeat(COLS);
      for (let x = 0; x < COLS; x++) {
        const c = line[x] || ".";
        let t = T.EMPTY;
        if (c === "#") t = T.BRICK;
        else if (c === "@") t = T.SOLID;
        else if (c === "H") t = T.LADDER;
        else if (c === "-") t = T.ROPE;
        else if (c === "$") { t = T.GOLD; gold++; }
        else if (c === "P") {
          player = { x: x * TILE, y: y * TILE, vx: 0, vy: 0, facing: 1, alive: true, onRope: false };
          t = T.EMPTY;
        } else if (c === "E") {
          enemies.push({
            x: x * TILE, y: y * TILE, vx: 0, vy: 0, facing: -1,
            trapped: 0, carrying: false, spawnX: x * TILE, spawnY: y * TILE,
            aiTimer: 0, prefer: 0,
          });
          t = T.EMPTY;
        }
        row.push(t);
      }
      map.push(row);
    }
    if (!player) player = { x: TILE, y: TILE * 10, vx: 0, vy: 0, facing: 1, alive: true, onRope: false };
    return { map, player, enemies, gold };
  }

  function loadLevel(idx) {
    const levels = window.LODE_LEVELS;
    if (idx < 0 || idx >= levels.length) return false;
    const parsed = parseLevel(levels[idx]);
    state.levelIndex = idx;
    state.map = parsed.map;
    state.player = parsed.player;
    state.enemies = parsed.enemies;
    state.goldLeft = parsed.gold;
    state.goldTotal = parsed.gold;
    state.holes = [];
    state.exitReady = false;
    state.mode = "play";
    digLeftQueued = false;
    digRightQueued = false;
    hideOverlay();
    updateHud();
    return true;
  }

  function tileAt(tx, ty) {
    if (ty < 0) return T.EMPTY;
    if (tx < 0 || tx >= COLS || ty >= ROWS) return T.SOLID;
    return state.map[ty][tx];
  }
  function setTile(tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;
    state.map[ty][tx] = v;
  }
  function isSolid(t) {
    return t === T.BRICK || t === T.SOLID || t === T.HOLE;
  }
  function isFloor(t) {
    return t === T.BRICK || t === T.SOLID;
  }
  function isClimbable(t) {
    return t === T.LADDER || t === T.EXIT;
  }
  function isRope(t) {
    return t === T.ROPE;
  }

  // 实体脚底/身体采样
  function entityCell(ent) {
    const cx = Math.floor((ent.x + TILE / 2) / TILE);
    const cy = Math.floor((ent.y + TILE / 2) / TILE);
    return { cx, cy };
  }
  function feetCell(ent) {
    const cx = Math.floor((ent.x + TILE / 2) / TILE);
    const fy = Math.floor((ent.y + TILE - 1) / TILE);
    return { cx, fy };
  }

  function standingOnGround(ent) {
    const { cx } = entityCell(ent);
    const belowY = Math.floor((ent.y + TILE) / TILE);
    const aligned = Math.abs(ent.y - Math.round(ent.y / TILE) * TILE) < 1.5;
    if (!aligned) return false;
    const t = tileAt(cx, belowY);
    return isFloor(t);
  }

  function onLadder(ent) {
    const { cx, cy } = entityCell(ent);
    return isClimbable(tileAt(cx, cy)) || isClimbable(tileAt(cx, cy + 1));
  }

  function onRopeTile(ent) {
    const { cx, cy } = entityCell(ent);
    // 绳子在格子上半部可攀
    const nearTop = (ent.y % TILE) < TILE * 0.45;
    return isRope(tileAt(cx, cy)) && nearTop;
  }

  function inHole(ent) {
    const { cx, cy } = entityCell(ent);
    return tileAt(cx, cy) === T.HOLE;
  }

  function canFall(ent) {
    if (onLadder(ent)) return false;
    if (onRopeTile(ent)) return false;
    if (standingOnGround(ent)) return false;
    if (inHole(ent) && ent.trapped > 0) return false;
    return true;
  }

  function snapToGridX(ent) {
    ent.x = Math.round(ent.x / TILE) * TILE;
  }
  function snapToGridY(ent) {
    ent.y = Math.round(ent.y / TILE) * TILE;
  }

  function tryMoveX(ent, dx, isPlayer) {
    if (dx === 0) return;
    ent.facing = dx > 0 ? 1 : -1;
    let nx = ent.x + dx;
    // 垂直对齐时检测侧墙
    const cy = Math.floor((ent.y + TILE / 2) / TILE);
    const topY = Math.floor((ent.y + 2) / TILE);
    const checkX = dx > 0
      ? Math.floor((nx + TILE - 1) / TILE)
      : Math.floor(nx / TILE);

    const block = (tx, ty) => {
      const t = tileAt(tx, ty);
      if (t === T.BRICK || t === T.SOLID) return true;
      // 玩家可掉进洞 / 走过洞；被困敌人占洞时玩家可踩过（单独处理）
      if (t === T.HOLE && !isPlayer) {
        // 敌人不主动走进空洞（除非掉落）
        return false;
      }
      return false;
    };

    if (block(checkX, topY) || block(checkX, cy)) {
      if (dx > 0) nx = checkX * TILE - TILE;
      else nx = (checkX + 1) * TILE;
    }
    nx = Math.max(0, Math.min((COLS - 1) * TILE, nx));
    ent.x = nx;
  }

  function tryMoveY(ent, dy) {
    if (dy === 0) return;
    let ny = ent.y + dy;
    const cx = Math.floor((ent.x + TILE / 2) / TILE);
    if (dy < 0) {
      const checkY = Math.floor(ny / TILE);
      const t = tileAt(cx, checkY);
      if (t === T.BRICK || t === T.SOLID) {
        ny = (checkY + 1) * TILE;
      }
    } else {
      const checkY = Math.floor((ny + TILE - 1) / TILE);
      const feet = Math.floor((ny + TILE) / TILE);
      const tFeet = tileAt(cx, feet);
      // 落到实心上
      if (isFloor(tFeet) && (ny + TILE) >= feet * TILE) {
        // 若当前格是洞，可落入洞中
        const cur = tileAt(cx, checkY);
        if (cur !== T.HOLE) {
          ny = feet * TILE - TILE;
        }
      }
      // 洞底（实心）停住
      if (tileAt(cx, checkY) === T.HOLE) {
        const below = tileAt(cx, checkY + 1);
        if (isFloor(below) && (ny + TILE) >= (checkY + 1) * TILE) {
          ny = (checkY + 1) * TILE - TILE;
        }
      }
    }
    ny = Math.max(-TILE, Math.min((ROWS - 1) * TILE, ny));
    ent.y = ny;
  }

  function revealExit() {
    if (state.exitReady) return;
    state.exitReady = true;
    // 在顶部空列放置出口梯子
    for (let x = 0; x < COLS; x++) {
      if (state.map[0][x] === T.EMPTY || state.map[0][x] === T.ROPE) {
        // 找一列有梯子连通或空的，从顶往下铺一小段出口梯
      }
    }
    // 经典：所有顶部空位变成出口梯，或从已有梯子延伸到顶
    for (let x = 0; x < COLS; x++) {
      let hasLadder = false;
      for (let y = 0; y < ROWS; y++) {
        if (state.map[y][x] === T.LADDER) { hasLadder = true; break; }
      }
      if (hasLadder) {
        for (let y = 0; y < ROWS; y++) {
          if (state.map[y][x] === T.EMPTY || state.map[y][x] === T.ROPE) {
            state.map[y][x] = T.EXIT;
          } else if (state.map[y][x] === T.LADDER) {
            state.map[y][x] = T.EXIT;
          } else break;
        }
      }
    }
    // 若没有梯子列，在玩家附近顶部开一条
    let any = false;
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < 3; y++) if (state.map[y][x] === T.EXIT) any = true;
    }
    if (!any) {
      const px = Math.floor((state.player.x + TILE / 2) / TILE);
      for (let y = 0; y < ROWS; y++) {
        const t = state.map[y][px];
        if (t === T.EMPTY || t === T.ROPE || t === T.LADDER) state.map[y][px] = T.EXIT;
        else if (t === T.BRICK || t === T.SOLID) break;
      }
    }
  }

  function dig(dir) {
    // dir: -1 left, +1 right — dig brick beside & at foot level
    const p = state.player;
    if (canFall(p) && !onLadder(p)) return; // 空中不能挖
    const cx = Math.floor((p.x + TILE / 2) / TILE);
    const cy = Math.floor((p.y + TILE / 2) / TILE);
    const tx = cx + dir;
    const ty = cy + 1; // 脚下旁侧砖
    if (tileAt(tx, ty) !== T.BRICK) {
      // 也尝试同层旁侧（若站在砖上边缘）
      if (tileAt(tx, cy) === T.BRICK) {
        // 不挖身体旁的砖（避免挖自己站的）
      }
      return;
    }
    // 不能挖有敌人站着的砖上方……允许挖，敌人会掉
    setTile(tx, ty, T.HOLE);
    state.holes.push({ x: tx, y: ty, age: 0, max: HOLE_DURATION });
  }

  function updateHoles(dt) {
    for (let i = state.holes.length - 1; i >= 0; i--) {
      const h = state.holes[i];
      h.age += dt;
      if (h.age >= h.max) {
        // 填洞：若有敌人在洞里 → 消灭重生；若玩家在洞里 → 死亡
        const entitiesIn = [];
        const checkEnt = (ent, isP) => {
          const { cx, cy } = entityCell(ent);
          if (cx === h.x && cy === h.y) entitiesIn.push({ ent, isP });
        };
        checkEnt(state.player, true);
        state.enemies.forEach((e) => checkEnt(e, false));
        setTile(h.x, h.y, T.BRICK);
        state.holes.splice(i, 1);
        entitiesIn.forEach(({ ent, isP }) => {
          if (isP) die(false);
          else killEnemy(ent);
        });
      }
    }
  }

  function killEnemy(e) {
    state.score += 100;
    e.x = e.spawnX;
    e.y = e.spawnY;
    e.trapped = 0;
    e.vx = 0;
    e.vy = 0;
    updateHud();
  }

  function collectGold(p) {
    const { cx, cy } = entityCell(p);
    if (tileAt(cx, cy) === T.GOLD) {
      setTile(cx, cy, T.EMPTY);
      state.goldLeft--;
      state.score += 250;
      updateHud();
      if (state.goldLeft <= 0) revealExit();
    }
  }

  function checkClear() {
    const p = state.player;
    // 爬到地图顶部外 / 第一行出口梯上方
    if (state.exitReady && p.y <= -TILE * 0.2) {
      levelClear();
      return;
    }
    if (state.exitReady && p.y < TILE * 0.5) {
      const { cx, cy } = entityCell(p);
      if (isClimbable(tileAt(cx, cy)) || cy <= 0) {
        // 接近顶且在出口梯上
        if (p.y <= 2) levelClear();
      }
    }
  }

  function levelClear() {
    state.mode = "clear";
    state.score += 1000 + state.lives * 100;
    updateHud();
    const levels = window.LODE_LEVELS;
    const next = state.levelIndex + 1;
    if (next >= levels.length) {
      state.mode = "win";
      showOverlay(
        "全部通关！",
        "恭喜你完成所有关卡",
        `最终得分：${state.score}<br/>谢谢游玩 淘金者`,
        "再来一次",
        () => startGame()
      );
    } else {
      showOverlay(
        "过关！",
        `第 ${state.levelIndex + 1} 关完成`,
        `得分：${state.score}<br/>准备进入下一关`,
        "下一关",
        () => loadLevel(next)
      );
    }
  }

  function die(restartOnly) {
    if (state.mode !== "play") return;
    if (restartOnly) {
      loadLevel(state.levelIndex);
      return;
    }
    state.lives--;
    updateHud();
    if (state.lives <= 0) {
      state.mode = "over";
      showOverlay(
        "游戏结束",
        "生命耗尽",
        `得分：${state.score}<br/>坚持到第 ${state.levelIndex + 1} 关`,
        "再来一次",
        () => startGame()
      );
    } else {
      // 重置本关
      const idx = state.levelIndex;
      const lives = state.lives;
      const score = state.score;
      loadLevel(idx);
      state.lives = lives;
      state.score = score;
      updateHud();
    }
  }

  function enemyAI(e, dt) {
    if (e.trapped > 0) {
      e.trapped -= dt;
      // 困在洞底
      const { cx, cy } = entityCell(e);
      if (tileAt(cx, cy) === T.HOLE) {
        snapToGridX(e);
        e.y = cy * TILE;
      }
      if (e.trapped <= 0) {
        // 爬出洞
        e.y = cy * TILE - TILE;
        e.trapped = 0;
      }
      return;
    }
    const { cx, cy } = entityCell(e);
    if (tileAt(cx, cy) === T.HOLE) {
      e.trapped = ENEMY_TRAP_TIME;
      snapToGridX(e);
      e.y = cy * TILE;
      return;
    }

    if (canFall(e)) {
      tryMoveY(e, FALL_SPEED);
      // 对齐 X 下落
      const mid = cx * TILE;
      if (Math.abs(e.x - mid) < 3) e.x = mid;
      return;
    }

    const p = state.player;
    const pcx = Math.floor((p.x + TILE / 2) / TILE);
    const pcy = Math.floor((p.y + TILE / 2) / TILE);
    const ecx = Math.floor((e.x + TILE / 2) / TILE);
    const ecy = Math.floor((e.y + TILE / 2) / TILE);

    e.aiTimer -= dt;
    let wantX = 0;
    let wantY = 0;

    // 简单追逐
    if (onLadder(e) || isClimbable(tileAt(ecx, ecy))) {
      if (pcy < ecy) wantY = -1;
      else if (pcy > ecy) wantY = 1;
      else if (pcx !== ecx) wantX = pcx > ecx ? 1 : -1;
    } else if (onRopeTile(e)) {
      if (pcx !== ecx) wantX = pcx > ecx ? 1 : -1;
      else if (pcy > ecy) wantY = 1; // 可从绳落下
    } else {
      if (pcx !== ecx) wantX = pcx > ecx ? 1 : -1;
      // 若下方有梯且玩家在下
      if (pcy > ecy && isClimbable(tileAt(ecx, ecy + 1))) wantY = 1;
      if (pcy < ecy && isClimbable(tileAt(ecx, ecy))) wantY = -1;
    }

    // 障碍：砖墙则尝试找梯子
    if (wantX !== 0) {
      const nx = ecx + wantX;
      if (isFloor(tileAt(nx, ecy)) && !isFloor(tileAt(nx, ecy - 1))) {
        // 墙挡路，找附近梯子
        wantX = 0;
        for (let d = 1; d < 8; d++) {
          if (isClimbable(tileAt(ecx + d, ecy)) || isClimbable(tileAt(ecx - d, ecy))) {
            wantX = isClimbable(tileAt(ecx + d, ecy)) ? 1 : -1;
            break;
          }
        }
        if (wantX === 0) wantX = e.facing || 1;
      }
    }

    if (wantY !== 0 && (onLadder(e) || isClimbable(tileAt(ecx, ecy)) || isClimbable(tileAt(ecx, ecy + (wantY > 0 ? 1 : 0))))) {
      snapToGridX(e);
      tryMoveY(e, wantY * ENEMY_SPEED);
    } else if (wantX !== 0) {
      if (onLadder(e) || standingOnGround(e) || onRopeTile(e)) {
        if (!onRopeTile(e) && !onLadder(e)) snapToGridY(e);
        if (onRopeTile(e)) snapToGridY(e);
        tryMoveX(e, wantX * ENEMY_SPEED, false);
      }
    }
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (!p.alive) return;

    // 挖洞（点按一次挖一次）
    if (digLeftQueued) { dig(-1); digLeftQueued = false; }
    if (digRightQueued) { dig(1); digRightQueued = false; }

    const left = keys["ArrowLeft"] || keys["KeyA"];
    const right = keys["ArrowRight"] || keys["KeyD"];
    const up = keys["ArrowUp"] || keys["KeyW"];
    const down = keys["ArrowDown"] || keys["KeyS"];

    if (canFall(p)) {
      tryMoveY(p, FALL_SPEED);
      // 下落时允许少量水平
      if (left) tryMoveX(p, -PLAYER_SPEED * 0.5, true);
      if (right) tryMoveX(p, PLAYER_SPEED * 0.5, true);
    } else if (onLadder(p) && (up || down)) {
      snapToGridX(p);
      if (up) tryMoveY(p, -PLAYER_SPEED);
      if (down) tryMoveY(p, PLAYER_SPEED);
      if (left) tryMoveX(p, -PLAYER_SPEED, true);
      if (right) tryMoveX(p, PLAYER_SPEED, true);
    } else if (onRopeTile(p)) {
      snapToGridY(p);
      p.onRope = true;
      if (left) tryMoveX(p, -PLAYER_SPEED, true);
      if (right) tryMoveX(p, PLAYER_SPEED, true);
      if (down) { // 松手落下
        p.y += 4;
      }
      if (up && onLadder(p)) {
        tryMoveY(p, -PLAYER_SPEED);
      }
    } else {
      p.onRope = false;
      snapToGridY(p);
      if (left) tryMoveX(p, -PLAYER_SPEED, true);
      if (right) tryMoveX(p, PLAYER_SPEED, true);
      if (up && onLadder(p)) {
        snapToGridX(p);
        tryMoveY(p, -PLAYER_SPEED);
      }
      if (down) {
        const { cx, cy } = entityCell(p);
        if (isClimbable(tileAt(cx, cy + 1)) || isClimbable(tileAt(cx, cy))) {
          snapToGridX(p);
          tryMoveY(p, PLAYER_SPEED);
        }
      }
    }

    // 掉出地图底部
    if (p.y > (ROWS - 0.5) * TILE) die(false);

    collectGold(p);
    checkClear();

    // 与敌人碰撞
    for (const e of state.enemies) {
      if (e.trapped > 0) continue;
      const dx = Math.abs(p.x - e.x);
      const dy = Math.abs(p.y - e.y);
      if (dx < TILE * 0.55 && dy < TILE * 0.55) {
        die(false);
        return;
      }
    }
  }

  function togglePause() {
    if (state.mode === "play") {
      state.mode = "pause";
      showOverlay("暂停", "", "按 P 或点击继续", "继续游戏", () => {
        hideOverlay();
        state.mode = "play";
      });
    } else if (state.mode === "pause") {
      hideOverlay();
      state.mode = "play";
    }
  }

  function startGame() {
    state.lives = START_LIVES;
    state.score = 0;
    loadLevel(0);
  }

  // —— 绘制（像素风） ——
  function drawBrick(x, y, solid) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = solid ? "#6a6a7a" : "#b06030";
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = solid ? "#8a8a9a" : "#d08040";
    ctx.fillRect(px + 1, py + 1, TILE - 2, Math.floor(TILE / 2) - 1);
    ctx.fillStyle = solid ? "#4a4a5a" : "#803010";
    ctx.fillRect(px + 1, py + Math.floor(TILE / 2), TILE - 2, Math.floor(TILE / 2) - 1);
    ctx.strokeStyle = solid ? "#2a2a3a" : "#401808";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    // 砖缝
    ctx.beginPath();
    ctx.moveTo(px, py + TILE / 2);
    ctx.lineTo(px + TILE, py + TILE / 2);
    ctx.moveTo(px + TILE / 2, py + TILE / 2);
    ctx.lineTo(px + TILE / 2, py + TILE);
    ctx.stroke();
  }

  function drawLadder(x, y, exit) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = exit ? "#80ff80" : "#c8a060";
    ctx.fillRect(px + 5, py, 3, TILE);
    ctx.fillRect(px + TILE - 8, py, 3, TILE);
    for (let i = 0; i < 3; i++) {
      const ly = py + 5 + i * 9;
      ctx.fillRect(px + 5, ly, TILE - 10, 3);
    }
  }

  function drawRope(x, y) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = "#e8c878";
    ctx.fillRect(px, py + 4, TILE, 3);
    ctx.fillStyle = "#a08040";
    ctx.fillRect(px, py + 7, TILE, 1);
  }

  function drawGold(x, y) {
    const px = x * TILE + 7, py = y * TILE + 10;
    const blink = Math.sin(state.anim / 120) > 0;
    ctx.fillStyle = blink ? "#ffe866" : "#ffcc00";
    ctx.fillRect(px, py, 16, 12);
    ctx.fillStyle = "#fff6a0";
    ctx.fillRect(px + 2, py + 2, 6, 3);
    ctx.fillStyle = "#c49000";
    ctx.fillRect(px, py + 10, 16, 2);
  }

  function drawHole(x, y, age, max) {
    const px = x * TILE, py = y * TILE;
    ctx.fillStyle = "#12081a";
    ctx.fillRect(px, py, TILE, TILE);
    // 快填上时闪烁碎砖
    if (age > max * 0.75) {
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(state.anim / 50);
      ctx.fillStyle = "#b06030";
      ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer(p) {
    const px = Math.round(p.x), py = Math.round(p.y);
    // 身体
    ctx.fillStyle = "#40c0ff";
    ctx.fillRect(px + 8, py + 8, 14, 14);
    // 头
    ctx.fillStyle = "#ffe0b0";
    ctx.fillRect(px + 9, py + 2, 12, 10);
    // 帽子
    ctx.fillStyle = "#ff4040";
    ctx.fillRect(px + 8, py + 1, 14, 4);
    // 腿
    ctx.fillStyle = "#2060a0";
    ctx.fillRect(px + 8, py + 22, 5, 8);
    ctx.fillRect(px + 17, py + 22, 5, 8);
    // 面朝
    ctx.fillStyle = "#202020";
    if (p.facing >= 0) ctx.fillRect(px + 16, py + 5, 3, 3);
    else ctx.fillRect(px + 10, py + 5, 3, 3);
  }

  function drawEnemy(e) {
    const px = Math.round(e.x), py = Math.round(e.y);
    const trapped = e.trapped > 0;
    ctx.fillStyle = trapped ? "#805080" : "#e04040";
    ctx.fillRect(px + 6, py + 8, 18, 16);
    ctx.fillStyle = trapped ? "#c0a0c0" : "#ff8080";
    ctx.fillRect(px + 8, py + 2, 14, 10);
    // 眼睛
    ctx.fillStyle = "#201010";
    ctx.fillRect(px + 10, py + 5, 3, 4);
    ctx.fillRect(px + 17, py + 5, 3, 4);
    ctx.fillStyle = "#ff2020";
    ctx.fillRect(px + 11, py + 6, 2, 2);
    ctx.fillRect(px + 18, py + 6, 2, 2);
    // 腿
    ctx.fillStyle = trapped ? "#604060" : "#801010";
    ctx.fillRect(px + 8, py + 24, 5, 6);
    ctx.fillRect(px + 17, py + 24, 5, 6);
  }

  function drawBackground() {
    ctx.fillStyle = "#1a1028";
    ctx.fillRect(0, 0, W, H);
    // 简易星点
    ctx.fillStyle = "#3a2850";
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97) % W;
      const sy = (i * 53) % H;
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  function render() {
    drawBackground();
    if (!state.map) return;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = state.map[y][x];
        if (t === T.BRICK) drawBrick(x, y, false);
        else if (t === T.SOLID) drawBrick(x, y, true);
        else if (t === T.LADDER) drawLadder(x, y, false);
        else if (t === T.EXIT) drawLadder(x, y, true);
        else if (t === T.ROPE) drawRope(x, y);
        else if (t === T.GOLD) drawGold(x, y);
        else if (t === T.HOLE) {
          const hole = state.holes.find((h) => h.x === x && h.y === y);
          drawHole(x, y, hole ? hole.age : 0, hole ? hole.max : HOLE_DURATION);
        }
      }
    }

    if (state.player) drawPlayer(state.player);
    state.enemies.forEach(drawEnemy);

    // 出口提示
    if (state.exitReady && state.mode === "play") {
      ctx.fillStyle = "rgba(128,255,128,0.85)";
      ctx.font = "10px monospace";
      ctx.fillText("出口已开启 — 爬到顶上！", 12, 14);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(40, now - last);
    last = now;
    state.anim += dt;

    if (state.mode === "play") {
      updateHoles(dt);
      updatePlayer(dt);
      state.enemies.forEach((e) => enemyAI(e, dt));
    }
    render();
    requestAnimationFrame(frame);
  }

  // 标题画面
  function showTitle() {
    state.mode = "title";
    showOverlay(
      "淘金者",
      "Lode Runner · 红白机风格",
      "收集全部金子，躲避敌人，挖洞闯关！<br/>键盘：方向键移动，Z/X 挖洞<br/>手机：请横屏，左手方向、右手挖洞",
      "开始游戏",
      () => startGame()
    );
    // 预载第 1 关作背景
    const parsed = parseLevel(window.LODE_LEVELS[0]);
    state.map = parsed.map;
    state.player = parsed.player;
    state.enemies = parsed.enemies;
    state.holes = [];
    state.goldLeft = parsed.gold;
    state.goldTotal = parsed.gold;
    updateHud();
  }

  showTitle();
  requestAnimationFrame(frame);
})();
