
(() => {
  "use strict";

  // ==========================================
  // FLAILING
  // Local prototype: Player vs Bots
  // Controls: WASD / Arrow Keys
  // ESC: Return to menu
  // ==========================================

  const $ = (id) => document.getElementById(id);

  const canvas = $("game");
  const ctx = canvas?.getContext("2d");

  const menu = $("menu");
  const result = $("result");
  const hud = $("hud");

  const startBtn = $("startButton");
  const againBtn = $("againButton");
  const menuBtn = $("menuButton");

  const botSelect = $("botCount");
  const sizeSelect = $("arenaSize");

  const aliveEl = $("aliveCount");
  const statsEl = $("playerStats");
  const phaseEl = $("phase");

  if (!canvas || !ctx || !menu || !result || !hud || !startBtn) {
    console.error("FLAILING: Missing HTML elements.");
    return;
  }

  if (!window.Matter) {
    if (phaseEl) {
      phaseEl.textContent =
        "Matter.js failed to load. Check your internet and refresh.";
    }
    return;
  }

  // ==========================================
  // MATTER.JS SETUP
  // ==========================================

  const {
    Engine,
    Bodies,
    Body,
    Constraint,
    Composite,
    Events
  } = Matter;

  const engine = Engine.create({
    enableSleeping: false
  });

  engine.gravity.x = 0;
  engine.gravity.y = 0;

  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  engine.constraintIterations = 4;

  // ==========================================
  // CONSTANTS
  // ==========================================

  const WORLD_WIDTH = 1200;
  const WORLD_HEIGHT = 800;

  const COLORS = [
    ["#39e8ff", "CYAN"],
    ["#ff4f77", "CORAL"],
    ["#c26cff", "VIOLET"],
    ["#ffce52", "GOLD"],
    ["#6dff9d", "LIME"]
  ];

  const ARENA_PRESETS = {
    large: 590,
    medium: 490,
    small: 395
  };

  const keys = {};

  let players = [];
  let particles = [];
  let trails = [];

  let arena = {};
  let baseArena = {};

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  let running = false;
  let finished = false;

  let animationFrame = 0;
  let startTime = 0;
  let lastTime = 0;
  let elapsed = 0;

  let bots = 3;
  let arenaSize = "medium";

  const random = (min, max) =>
    min + Math.random() * (max - min);

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  const distance = (a, b) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const alivePlayers = () =>
    players.filter((player) => player.alive);

  // ==========================================
  // CANVAS RESIZING
  // ==========================================

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    scale = Math.min(
      window.innerWidth / WORLD_WIDTH,
      window.innerHeight / WORLD_HEIGHT
    );

    offsetX = (window.innerWidth - WORLD_WIDTH * scale) / 2;
    offsetY = (window.innerHeight - WORLD_HEIGHT * scale) / 2;
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ==========================================
  // ARENA
  // ==========================================

  function createArena() {
    const height = ARENA_PRESETS[arenaSize] || ARENA_PRESETS.medium;
    const width = height * 1.5;

    baseArena = {
      x: (WORLD_WIDTH - width) / 2,
      y: (WORLD_HEIGHT - height) / 2,
      w: width,
      h: height
    };

    arena = { ...baseArena };
  }

  // ==========================================
  // PLAYER CREATION
  // ==========================================

  function createPlayer(index, isHuman, spawn) {
    const colorData = COLORS[index % COLORS.length];
    const radius = isHuman ? 17 : 16;

    const collisionGroup = -index - 1;

    const body = Bodies.circle(
      spawn.x,
      spawn.y,
      radius,
      {
        label: "player",
        frictionAir: 0.035,
        friction: 0,
        restitution: 0.2,
        density: 0.002,
        collisionFilter: {
          group: collisionGroup
        }
      }
    );

    const mace = Bodies.circle(
      spawn.x + 45,
      spawn.y + 6,
      12,
      {
        label: "mace",
        frictionAir: 0.008,
        friction: 0,
        restitution: 0.72,
        density: 0.0018,
        collisionFilter: {
          group: collisionGroup
        }
      }
    );

    const rope = Constraint.create({
      bodyA: body,
      bodyB: mace,
      length: 78,
      stiffness: 0.075,
      damping: 0.03,
      render: {
        visible: false
      }
    });

    const player = {
      id: index,
      name: colorData[1],
      color: colorData[0],

      human: isHuman,

      body,
      mace,
      rope,

      alive: true,
      hp: 3,

      invulnerability: 0,
      flash: 0,

      aiTimer: 0,
      target: null,

      kills: 0,
      trailTick: 0
    };

    Composite.add(engine.world, [
      body,
      mace,
      rope
    ]);

    return player;
  }

  // ==========================================
  // START GAME
  // ==========================================

  function startGame() {
    stopLoop();

    Composite.clear(engine.world, false);
    Engine.clear(engine);

    players = [];
    particles = [];
    trails = [];

    finished = false;
    running = true;

    bots = clamp(
      Number(botSelect?.value || 3),
      1,
      4
    );

    arenaSize = sizeSelect?.value || "medium";

    createArena();

    const playerCount = bots + 1;

    const centerX = arena.x + arena.w / 2;
    const centerY = arena.y + arena.h / 2;

    const spawnRadius =
      Math.min(arena.w, arena.h) * 0.31;

    for (let i = 0; i < playerCount; i++) {
      const angle =
        -Math.PI / 2 + (Math.PI * 2 * i) / playerCount;

      const spawn = {
        x: centerX + Math.cos(angle) * spawnRadius,
        y: centerY + Math.sin(angle) * spawnRadius
      };

      players.push(
        createPlayer(i, i === 0, spawn)
      );
    }

    startTime = performance.now();
    lastTime = startTime;
    elapsed = 0;

    menu.classList.add("hidden");
    result.classList.add("hidden");
    hud.classList.remove("hidden");

    updateHUD();

    if (phaseEl) {
      phaseEl.textContent = "ARENA STABLE";
    }

    animationFrame = requestAnimationFrame(gameLoop);
  }

  // ==========================================
  // MENU / CLEANUP
  // ==========================================

  function stopLoop() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }

    animationFrame = 0;
  }

  function returnToMenu() {
    running = false;
    finished = false;

    stopLoop();

    Composite.clear(engine.world, false);
    Engine.clear(engine);

    players = [];
    particles = [];
    trails = [];

    hud.classList.add("hidden");
    result.classList.add("hidden");
    menu.classList.remove("hidden");
  }

  // ==========================================
  // HUD
  // ==========================================

  function updateHUD() {
    const alive = alivePlayers();

    if (aliveEl) {
      aliveEl.textContent = String(alive.length);
    }

    if (statsEl) {
      statsEl.innerHTML = players.map((player) => {
        const hearts =
          "♥".repeat(player.hp) +
          "♡".repeat(Math.max(0, 3 - player.hp));

        return `
          <div
            class="stat ${player.alive ? "" : "dead"}"
            style="--player-color:${player.color}"
          >
            <span class="stat-dot"></span>
            <b>${player.human ? "YOU" : "BOT " + player.id}</b>
            <span class="stat-hearts">${hearts}</span>
          </div>
        `;
      }).join("");
    }
  }

  // ==========================================
  // PARTICLES
  // ==========================================

  function createSparks(x, y, color, amount) {
    for (let i = 0; i < amount; i++) {
      const angle = random(0, Math.PI * 2);
      const speed = random(1, 6);

      particles.push({
        x,
        y,

        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,

        life: random(18, 40),
        maxLife: 40,

        color,
        radius: random(1.5, 4)
      });
    }
  }

  // ==========================================
  // ELIMINATION
  // ==========================================

  function eliminate(player, reason) {
    if (!player.alive) return;

    player.alive = false;

    createSparks(
      player.body.position.x,
      player.body.position.y,
      player.color,
      22
    );

    Composite.remove(engine.world, player.body);
    Composite.remove(engine.world, player.mace);
    Composite.remove(engine.world, player.rope);

    updateHUD();

    if (player.human) {
      finishMatch(null, reason || "You fell beyond the arena.");
    } else if (alivePlayers().length <= 1) {
      finishMatch(alivePlayers()[0] || null);
    }
  }

  // ==========================================
  // MATCH END
  // ==========================================

  function finishMatch(winner, reason) {
    if (finished) return;

    finished = true;
    running = false;

    stopLoop();

    hud.classList.add("hidden");
    result.classList.remove("hidden");

    if (winner && winner.human) {
      $("resultTitle").textContent = "YOU WIN!";
      $("resultSub").textContent =
        "Last dot standing. You survived the flailing.";
    } else if (winner) {
      $("resultTitle").textContent =
        winner.name + " WINS";

      $("resultSub").textContent =
        "A bot claimed the arena. Try again!";
    } else {
      $("resultTitle").textContent = "ELIMINATED";

      $("resultSub").textContent =
        reason || "You were knocked out.";
    }
  }

  // ==========================================
  // DAMAGE
  // ==========================================

  function hitPlayer(target, attacker, speed) {
    if (!target.alive || target.invulnerability > 0) return;

    target.hp--;
    target.invulnerability = 0.9;
    target.flash = 0.25;

    const dx =
      target.body.position.x - attacker.mace.position.x;

    const dy =
      target.body.position.y - attacker.mace.position.y;

    const d = Math.max(1, Math.hypot(dx, dy));

    const force = clamp(speed * 0.018, 0.07, 0.25);

    Body.applyForce(
      target.body,
      target.body.position,
      {
        x: (dx / d) * force,
        y: (dy / d) * force
      }
    );

    Body.applyForce(
      target.mace,
      target.mace.position,
      {
        x: (dx / d) * force * 0.65,
        y: (dy / d) * force * 0.65
      }
    );

    createSparks(
      target.body.position.x,
      target.body.position.y,
      target.color,
      13
    );

    if (target.hp <= 0) {
      eliminate(target, "");
    }

    updateHUD();
  }

  // ==========================================
  // COLLISIONS
  // ==========================================

  const hitCooldowns = new Map();

  Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;

      const playerA = players.find(
        (p) => p.alive &&
          (p.body === bodyA || p.mace === bodyA)
      );

      const playerB = players.find(
        (p) => p.alive &&
          (p.body === bodyB || p.mace === bodyB)
      );

      if (!playerA || !playerB || playerA === playerB) {
        continue;
      }

      const maceA = playerA.mace === bodyA;
      const maceB = playerB.mace === bodyB;

      if (!maceA && !maceB) continue;

      const attacker = maceA ? playerA : playerB;
      const target = maceA ? playerB : playerA;

      const key = attacker.id + ":" + target.id;

      if ((hitCooldowns.get(key) || 0) > 0) {
        continue;
      }

      const speed = Math.hypot(
        attacker.mace.velocity.x,
        attacker.mace.velocity.y
      );

      if (speed < 3.5) continue;

      hitCooldowns.set(key, 0.5);

      hitPlayer(target, attacker, speed);
    }
  });

  // ==========================================
  // PLAYER INPUT
  // ==========================================

  function getHumanDirection() {
    let x = 0;
    let y = 0;

    if (keys.w || keys.arrowup) y--;
    if (keys.s || keys.arrowdown) y++;
    if (keys.a || keys.arrowleft) x--;
    if (keys.d || keys.arrowright) x++;

    const length = Math.hypot(x, y) || 1;

    return {
      x: x / length,
      y: y / length
    };
  }

  // ==========================================
  // BOT AI
  // ==========================================

  function getBotDirection(player, dt) {
    player.aiTimer -= dt;

    if (player.aiTimer <= 0 || !player.target?.alive) {
      player.aiTimer = random(0.22, 0.5);

      player.target = alivePlayers()
        .filter((other) => other !== player)
        .sort(
          (a, b) =>
            distance(player.body.position, a.body.position) -
            distance(player.body.position, b.body.position)
        )[0] || null;
    }

    if (!player.target) {
      return { x: 0, y: 0 };
    }

    let x =
      player.target.body.position.x -
      player.body.position.x;

    let y =
      player.target.body.position.y -
      player.body.position.y;

    let d = Math.max(1, Math.hypot(x, y));

    x /= d;
    y /= d;

    const margin = 110;

    const left = arena.x + margin;
    const right = arena.x + arena.w - margin;
    const top = arena.y + margin;
    const bottom = arena.y + arena.h - margin;

    const pos = player.body.position;

    if (pos.x < left) {
      x += ((left - pos.x) / margin) * 1.8;
    }

    if (pos.x > right) {
      x -= ((pos.x - right) / margin) * 1.8;
    }

    if (pos.y < top) {
      y += ((top - pos.y) / margin) * 1.8;
    }

    if (pos.y > bottom) {
      y -= ((pos.y - bottom) / margin) * 1.8;
    }

    d = Math.max(1, Math.hypot(x, y));

    return {
      x: x / d,
      y: y / d
    };
  }

  // ==========================================
  // MOVEMENT
  // ==========================================

  function movePlayer(player, direction, dt) {
    if (!player.alive) return;

    const force = player.human ? 0.0018 : 0.0014;

    Body.applyForce(
      player.body,
      player.body.position,
      {
        x: direction.x * force,
        y: direction.y * force
      }
    );

    Body.applyForce(
      player.mace,
      player.mace.position,
      {
        x: direction.x * force * 0.55,
        y: direction.y * force * 0.55
      }
    );

    const maxSpeed = player.human ? 6.8 : 5.8;

    const speed = Math.hypot(
      player.body.velocity.x,
      player.body.velocity.y
    );

    if (speed > maxSpeed) {
      Body.setVelocity(player.body, {
        x: (player.body.velocity.x * maxSpeed) / speed,
        y: (player.body.velocity.y * maxSpeed) / speed
      });
    }

    player.invulnerability = Math.max(
      0,
      player.invulnerability - dt
    );

    player.flash = Math.max(
      0,
      player.flash - dt
    );

    player.trailTick++;

    if (player.trailTick % 3 === 0) {
      trails.push({
        x: player.mace.position.x,
        y: player.mace.position.y,
        color: player.color,
        life: 0.22,
        maxLife: 0.22
      });
    }
  }

  // ==========================================
  // ARENA SHRINKING
  // ==========================================

  function updateArena(dt) {
    const progress = clamp(elapsed / 145, 0, 1);

    const targetWidth =
      baseArena.w * (1 - progress) + 300 * progress;

    const targetHeight =
      baseArena.h * (1 - progress) + 210 * progress;

    const smooth = 1 - Math.pow(0.001, dt);

    arena.w += (targetWidth - arena.w) * smooth;
    arena.h += (targetHeight - arena.h) * smooth;

    arena.x = (WORLD_WIDTH - arena.w) / 2;
    arena.y = (WORLD_HEIGHT - arena.h) / 2;

    if (phaseEl) {
      phaseEl.textContent =
        elapsed < 25
          ? "ARENA STABLE"
          : elapsed < 55
            ? "SHRINKING: PHASE 1"
            : elapsed < 95
              ? "SHRINKING: PHASE 2"
              : "FINAL COLLAPSE";
    }

    for (const player of [...alivePlayers()]) {
      const pos = player.body.position;
      const margin = 24;

      if (
        pos.x < arena.x - margin ||
        pos.x > arena.x + arena.w + margin ||
        pos.y < arena.y - margin ||
        pos.y > arena.y + arena.h + margin
      ) {
        eliminate(player, "outside the shrinking arena");
      }
    }
  }

  // ==========================================
  // EFFECTS
  // ==========================================

  function updateEffects(dt) {
    trails.forEach((trail) => {
      trail.life -= dt;
    });

    trails = trails.filter((trail) => trail.life > 0);

    particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;

      particle.vx *= 0.97;
      particle.vy *= 0.97;

      particle.life--;
    });

    particles = particles.filter(
      (particle) => particle.life > 0
    );

    for (const [key, value] of hitCooldowns) {
      hitCooldowns.set(
        key,
        Math.max(0, value - dt)
      );
    }
  }

  // ==========================================
  // MAIN GAME LOOP
  // ==========================================

  function gameLoop(now) {
    animationFrame = 0;

    if (!running || finished) return;

    const dt = clamp(
      (now - lastTime) / 1000,
      0,
      0.033
    );

    lastTime = now;
    elapsed = (now - startTime) / 1000;

    for (const player of alivePlayers()) {
      const direction = player.human
        ? getHumanDirection()
        : getBotDirection(player, dt);

      movePlayer(player, direction, dt);
    }

    Engine.update(engine, dt * 1000);

    updateArena(dt);
    updateEffects(dt);
    draw();

    if (running && !finished) {
      animationFrame = requestAnimationFrame(gameLoop);
    }
  }

  // ==========================================
  // DRAWING
  // ==========================================

  function draw() {
    ctx.clearRect(
      0,
      0,
      window.innerWidth,
      window.innerHeight
    );

    ctx.save();

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    drawBackground();
    drawArena();
    drawEffects();

    for (const player of players) {
      if (player.alive) {
        drawPlayer(player);
      }
    }

    ctx.restore();
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(
      0, 0, WORLD_WIDTH, WORLD_HEIGHT
    );

    gradient.addColorStop(0, "#070a17");
    gradient.addColorStop(1, "#101229");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.strokeStyle = "rgba(100,115,165,0.13)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= WORLD_WIDTH; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
      ctx.stroke();
    }

    for (let y = 0; y <= WORLD_HEIGHT; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
      ctx.stroke();
    }
  }

  function drawArena() {
    ctx.save();

    const color = elapsed > 25 ? "#ff4268" : "#6b82ff";

    ctx.shadowColor = color;
    ctx.shadowBlur = 22;

    ctx.strokeStyle = color;
    ctx.lineWidth = 7;

    ctx.strokeRect(
      arena.x,
      arena.y,
      arena.w,
      arena.h
    );

    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;

    ctx.strokeRect(
      arena.x + 12,
      arena.y + 12,
      arena.w - 24,
      arena.h - 24
    );

    ctx.fillStyle = color;

    const size = 24;

    const corners = [
      [arena.x, arena.y, 1, 1],
      [arena.x + arena.w, arena.y, -1, 1],
      [arena.x, arena.y + arena.h, 1, -1],
      [arena.x + arena.w, arena.y + arena.h, -1, -1]
    ];

    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();

      ctx.moveTo(x, y);
      ctx.lineTo(x + sx * size, y);
      ctx.lineTo(x, y + sy * size);

      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawEffects() {
    for (const trail of trails) {
      ctx.globalAlpha =
        Math.max(0, trail.life / trail.maxLife) * 0.45;

      ctx.fillStyle = trail.color;

      ctx.beginPath();
      ctx.arc(trail.x, trail.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    for (const particle of particles) {
      ctx.globalAlpha =
        clamp(particle.life / particle.maxLife, 0, 1);

      ctx.fillStyle = particle.color;

      ctx.beginPath();
      ctx.arc(
        particle.x,
        particle.y,
        particle.radius,
        0,
        Math.PI * 2
      );

      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  // ==========================================
  // PLAYER RENDERING
  // ==========================================

  function drawPlayer(player) {
    const body = player.body.position;
    const mace = player.mace.position;
    const velocity = player.mace.velocity;

    const maceSpeed = Math.hypot(
      velocity.x,
      velocity.y
    );

    const angle = Math.atan2(
      mace.y - body.y,
      mace.x - body.x
    );

    ctx.save();
    ctx.lineCap = "round";

    // Chain
    ctx.strokeStyle = "rgba(225,238,255,0.82)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(mace.x, mace.y);
    ctx.stroke();

    ctx.strokeStyle = player.color;
    ctx.lineWidth = 1.3;

    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(mace.x, mace.y);
    ctx.stroke();

    // Flail
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 20;

    ctx.fillStyle = player.color;

    ctx.beginPath();
    ctx.arc(mace.x, mace.y, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.fillStyle = "#f5fbff";

    ctx.beginPath();
    ctx.arc(mace.x, mace.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Player
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 18;

    ctx.fillStyle =
      player.flash > 0 ? "#ffffff" : player.color;

    ctx.beginPath();
    ctx.arc(body.x, body.y, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(body.x, body.y, 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#07101e";

    ctx.beginPath();
    ctx.arc(body.x, body.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Name
    ctx.font = "bold 14px Inter, Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = player.color;

    ctx.fillText(
      player.human ? "YOU" : "BOT " + player.id,
      body.x,
      body.y - 29
    );

    // Health
    ctx.font = "16px Arial";

    ctx.fillText(
      "♥".repeat(player.hp) +
      "♡".repeat(Math.max(0, 3 - player.hp)),
      body.x,
      body.y + 38
    );

    // Speed arc
    if (maceSpeed > 4.8) {
      ctx.strokeStyle = player.color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 4;

      ctx.beginPath();

      ctx.arc(
        mace.x,
        mace.y,
        22 + maceSpeed * 2,
        angle - 0.9,
        angle + 0.9
      );

      ctx.stroke();
    }

    ctx.restore();
  }

  // ==========================================
  // INPUT
  // ==========================================

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    keys[key] = true;

    if (
      [
        "w", "a", "s", "d",
        "arrowup", "arrowdown",
        "arrowleft", "arrowright",
        " "
      ].includes(key)
    ) {
      event.preventDefault();
    }

    if (key === "escape" && running) {
      returnToMenu();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys[event.key.toLowerCase()] = false;
  });

  window.addEventListener("blur", () => {
    for (const key in keys) {
      keys[key] = false;
    }
  });

  // ==========================================
  // BUTTONS
  // ==========================================

  startBtn.addEventListener("click", startGame);

  if (againBtn) {
    againBtn.addEventListener("click", startGame);
  }

  if (menuBtn) {
    menuBtn.addEventListener("click", returnToMenu);
  }

  // ==========================================
  // MENU BACKGROUND
  // ==========================================

  function idleDraw() {
    if (running) return;

    ctx.clearRect(
      0,
      0,
      window.innerWidth,
      window.innerHeight
    );

    ctx.save();

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    drawBackground();

    const savedArena = arena;

    arena = {
      x: 155,
      y: 115,
      w: 890,
      h: 570
    };

    drawArena();

    arena = savedArena;

    ctx.restore();

    requestAnimationFrame(idleDraw);
  }

  idleDraw();

})();


