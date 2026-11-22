const socket = io();
const $ = id => document.getElementById(id);

const screens = {
 menu: $("menu"),
    lobby: $("lobby"),
 results: $("results"),
        hud: $("gameHud")
};

const canvas = $("game");
const ctx = canvas.getContext("2d");

let currentScreen = "menu";
let isHost = false;
 let isReady = false;
let gameRunning = false;
let localPlayerId = null;
let currentRoom = null;
let latestState = null;
let players = [];

let stateBuffer = [];
const INTERPOLATION_DELAY = 100;
    let renderPlayers = [];
const MAX_SNAPSHOTS = 30;

let arenaBounds = { x: -367.5, y: -245, w: 735, h: 490 };
let arenaCenter = { x: 0, y: 0 };
let camera = { x: 0, y: 0, zoom: 1 };

let lastToast = null;
let toastTimeout = null;

let input = {
    up: false,
 down: false,
    left: false,
 right: false
};

let inputInterval = null;
let animationFrame = null;
let lastFrame = 0;
let particles = [];


function resizeCanvas() {
const scale = Math.min(window.devicePixelRatio || 1, 1.5);

    canvas.width = window.innerWidth * scale;
 canvas.height = window.innerHeight * scale;
    canvas.style.width = window.innerWidth + "px";
canvas.style.height = window.innerHeight + "px";

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

function showScreen(screen) {
    currentScreen = screen;

    Object.values(screens).forEach(element => {
 element?.classList.add("hidden");
    });

    if (screen === "game") {
        screens.hud?.classList.remove("hidden");
 canvas.classList.remove("hidden");
        gameRunning = true;
        startRendering();
    } else {
        screens[screen]?.classList.remove("hidden");
 canvas.classList.add("hidden");
        gameRunning = false;
 stopRendering();
    }
}

function setStatus(id, message) {
    const element = $(id);
 if (element) element.textContent = message || "";
}

function toast(message) {
 const element = $("toast");
    if (!element) return;

    element.textContent = message;
 element.classList.add("show");

    clearTimeout(toastTimeout);
 toastTimeout = setTimeout(() => {
        element.classList.remove("show");
    }, 2600);
}

function cleanName(name) {
    return String(name || "").trim().slice(0, 16);
}

function getPlayerName() {
 return cleanName($("playerName")?.value) || "Player";
}


function normalizePlayers(data) {
    if (Array.isArray(data)) return data;
 if (Array.isArray(data?.players)) return data.players;
    if (Array.isArray(data?.room?.players)) return data.room.players;
 if (Array.isArray(data?.state?.players)) return data.state.players;
    return [];
}

function normalizeRoom(data) {
 return data?.room || data?.lobby || data;
}

function getPlayerId(player) {
    return player?.id ?? player?.playerId ?? player?.socketId ?? player?.userId;
}

function getPlayerNameFromData(player) {
 return player?.name ?? player?.username ?? player?.playerName ?? "Player";
}

function getPlayerColor(player, index) {
    const colors = [
 "#ff5267",
        "#38bdf8",
 "#a855f7",
        "#fbbf24",
 "#39e98b"
    ];

    return player?.color || player?.hex || player?.colour || colors[index % colors.length];
}

function isPlayerReady(player) {
 return player?.ready === true || player?.isReady === true;
}

function isPlayerHost(player) {
    return player?.host === true || player?.isHost === true;
}


function updateLobby(data) {
    const room = normalizeRoom(data);
 if (!room) return;

    currentRoom = room;
 players = normalizePlayers(room);

    const code = room.code || room.roomCode || room.id || "";
 $("roomCodeDisplay").textContent = code;
    $("playerCount").textContent = `${players.length}/5 PLAYERS`;

    let hostId = room.hostId || room.host || room.ownerId;
 const me = players.find(player => getPlayerId(player) === localPlayerId);

    if (me) {
        isHost = isPlayerHost(me) || getPlayerId(me) === hostId;
        isReady = isPlayerReady(me);
    } else if (hostId) {
 isHost = hostId === localPlayerId;
    }

    renderLobbyPlayers(players);

 const readyButton = $("readyButton");
    if (readyButton) {
        readyButton.textContent = isReady ? "NOT READY" : "READY UP";
 readyButton.classList.toggle("ready", isReady);
    }

    const startButton = $("startButton");
    if (startButton) {
 startButton.classList.toggle("hidden", !isHost);
        startButton.disabled =
            players.length < 2 ||
            players.some(player =>
                !isPlayerReady(player) &&
                !isPlayerHost(player) &&
                getPlayerId(player) !== hostId
            );
    }

 const arenaSelect = $("arenaSizeSelect");
    if (arenaSelect) {
        arenaSelect.disabled = !isHost;

        const size = room.arenaSize || room.arena || room.settings?.arenaSize;

        if (size && [...arenaSelect.options].some(option => option.value === String(size))) {
            arenaSelect.value = String(size);
        }
    }

    showScreen("lobby");
}

function renderLobbyPlayers(list) {
    const container = $("playerList");
 if (!container) return;

    container.innerHTML = "";

 list.forEach((player, index) => {
        const id = getPlayerId(player);
 const color = getPlayerColor(player, index);
        const name = getPlayerNameFromData(player);
 const ready = isPlayerReady(player);
        const host = isPlayerHost(player) || id === (currentRoom?.hostId || currentRoom?.host);

        const card = document.createElement("div");
 card.className = "player-card";

        const left = document.createElement("div");
        left.className = "player-name";

        const dot = document.createElement("span");
 dot.className = "player-color";
        dot.style.background = color;
        dot.style.color = color;

        const nameText = document.createElement("span");
 nameText.textContent =
            name + (id === localPlayerId ? " (YOU)" : "") + (host ? " ★" : "");

        left.append(dot, nameText);

 const status = document.createElement("span");
        status.className = "player-status" + (ready ? "" : " not-ready");
 status.textContent = ready ? "READY" : "WAITING";

        card.append(left, status);
 container.appendChild(card);
    });

    for (let i = list.length; i < 5; i++) {
 const empty = document.createElement("div");
        empty.className = "player-card";
        empty.style.opacity = "0.35";
 empty.textContent = "Waiting for player...";
        container.appendChild(empty);
    }
}


// Room actions

function createRoom() {
 socket.emit("room:create", { name: getPlayerName() });
    setStatus("menuStatus", "Creating room...");
}

function joinRoom() {
    const name = getPlayerName();
 const code = $("roomCodeInput")?.value.trim().toUpperCase();

    if (!code) {
        setStatus("menuStatus", "Enter a room code.");
 return;
    }

    socket.emit("room:join", { name, code });
 setStatus("menuStatus", "Joining room...");
}

function toggleReady() {
    if (!currentRoom) return;

 isReady = !isReady;
    socket.emit("player:ready", isReady);
}

function startGame() {
 if (!isHost) return;
    socket.emit("game:start");
}

function leaveRoom() {
 socket.emit("room:leave");

    currentRoom = null;
 latestState = null;
    stateBuffer = [];
 renderPlayers = [];
    players = [];

    isHost = false;
    isReady = false;
 localPlayerId = null;

    clearInputs();
 showScreen("menu");
}

function requestRematch() {
    socket.emit("game:rematch");
}

function copyRoomCode() {
 const code = $("roomCodeDisplay")?.textContent;
    if (!code) return;

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code)
            .then(() => toast("ROOM CODE COPIED"))
 .catch(() => toast(code));
    } else {
        toast(code);
    }
}


// Buttons

function bindButtons() {
    $("createButton")?.addEventListener("click", createRoom);
 $("joinButton")?.addEventListener("click", joinRoom);
    $("readyButton")?.addEventListener("click", toggleReady);
 $("startButton")?.addEventListener("click", startGame);
    $("copyCodeButton")?.addEventListener("click", copyRoomCode);
 $("leaveButton")?.addEventListener("click", leaveRoom);
    $("resultsLeaveButton")?.addEventListener("click", leaveRoom);
 $("rematchButton")?.addEventListener("click", requestRematch);
    $("gameLeaveButton")?.addEventListener("click", leaveRoom);

    $("arenaSizeSelect")?.addEventListener("change", event => {
 if (isHost) socket.emit("host:arena", event.target.value);
    });

    $("roomCodeInput")?.addEventListener("input", event => {
        event.target.value = event.target.value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 8);
    });

 $("playerName")?.addEventListener("keydown", event => {
        if (event.key === "Enter") createRoom();
    });

    $("roomCodeInput")?.addEventListener("keydown", event => {
 if (event.key === "Enter") joinRoom();
    });
}


// Movement input

const keyMap = {
 w: "up",
    ArrowUp: "up",
 s: "down",
    ArrowDown: "down",
 a: "left",
    ArrowLeft: "left",
 d: "right",
    ArrowRight: "right"
};

function handleKeyDown(event) {
    if (currentScreen !== "game") return;

 const direction = keyMap[event.key];
    if (!direction) return;

    event.preventDefault();
 input[direction] = true;
}

function handleKeyUp(event) {
 const direction = keyMap[event.key];
    if (!direction) return;

 input[direction] = false;
}

function clearInputs() {
    input.up = false;
 input.down = false;
    input.left = false;
 input.right = false;
}

window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", clearInputs);

function startInputLoop() {
 stopInputLoop();

    inputInterval = setInterval(() => {
        if (currentScreen !== "game") return;
 socket.emit("game:input", { ...input });
    }, 50);
}

function stopInputLoop() {
    if (inputInterval) clearInterval(inputInterval);
 inputInterval = null;
}


// Rendering loop

function startRendering() {
 if (animationFrame) return;

    lastFrame = performance.now();
 animationFrame = requestAnimationFrame(renderLoop);
}

function stopRendering() {
    if (!animationFrame) return;

 cancelAnimationFrame(animationFrame);
    animationFrame = null;
}

function renderLoop(now) {
    animationFrame = requestAnimationFrame(renderLoop);

 const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

 updateParticles(dt);
    drawGame();
}


// Reading game data

function getNumber(object, keys, fallback = 0) {
    for (const key of keys) {
 const value = object?.[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }

    return fallback;
}

function getPosition(object, keys, fallback = null) {
 for (const key of keys) {
        const value = object?.[key];

        if (value && typeof value.x === "number" && typeof value.y === "number") {
            return value;
        }
    }

 return fallback;
}

function normalizeGameState(data) {
    const state = data?.state || data?.game || data || {};
 const incomingPlayers = normalizePlayers(state);

    if (incomingPlayers.length) players = incomingPlayers;

    const arena = state.arena || data?.arena;

    if (
        arena &&
        Number.isFinite(arena.x) &&
        Number.isFinite(arena.y) &&
        Number.isFinite(arena.w) &&
        Number.isFinite(arena.h)
    ) {
        arenaBounds = {
 x: arena.x,
            y: arena.y,
 w: arena.w,
            h: arena.h
        };
    }

    arenaCenter = {
        x: arenaBounds.x + arenaBounds.w / 2,
 y: arenaBounds.y + arenaBounds.h / 2
    };

    latestState = state;

    if (state.phase !== "ARENA" || !incomingPlayers.length) return state;

    const snapshot = {
        time: performance.now(),
 players: incomingPlayers.map(player => ({ ...player }))
    };

    stateBuffer.push(snapshot);

    if (stateBuffer.length > MAX_SNAPSHOTS) {
 stateBuffer.shift();
    }

    return state;
}

function updateRenderPositions() {
    if (!stateBuffer.length) {
 renderPlayers = players;
        return;
    }

 const renderTime = performance.now() - INTERPOLATION_DELAY;
    const first = stateBuffer[0];
 const last = stateBuffer[stateBuffer.length - 1];

    if (renderTime <= first.time) {
        renderPlayers = first.players;
 return;
    }

    if (renderTime >= last.time) {
 renderPlayers = last.players;
        return;
    }

    let before = first;
 let after = last;

    for (let i = 0; i < stateBuffer.length - 1; i++) {
 const current = stateBuffer[i];
        const next = stateBuffer[i + 1];

        if (current.time <= renderTime && next.time >= renderTime) {
            before = current;
 after = next;
            break;
        }
    }

    const span = after.time - before.time;
 const progress = span > 0
        ? Math.max(0, Math.min(1, (renderTime - before.time) / span))
        : 1;

    const nextPlayers = new Map(
 after.players.map(player => [getPlayerId(player), player])
    );

    renderPlayers = before.players.map(player => {
        const next = nextPlayers.get(getPlayerId(player));
 if (!next) return player;

        return {
            ...next,
            x: player.x + (next.x - player.x) * progress,
 y: player.y + (next.y - player.y) * progress,
            maceX: player.maceX + (next.maceX - player.maceX) * progress,
 maceY: player.maceY + (next.maceY - player.maceY) * progress
        };
    });

    while (stateBuffer.length > 2 && stateBuffer[1].time < renderTime) {
 stateBuffer.shift();
    }
}

function getPlayerPosition(player) {
    return getPosition(player, ["position", "pos"], {
 x: getNumber(player, ["x", "px"], 0),
        y: getNumber(player, ["y", "py"], 0)
    });
}

function getFlailPosition(player) {
    const direct = getPosition(player, [
 "flail",
        "mace",
 "weaponPosition",
        "ball",
 "macePosition"
    ]);

    if (direct) return direct;

 const x = getNumber(player, ["flailX", "maceX", "ballX", "weaponX"], NaN);
    const y = getNumber(player, ["flailY", "maceY", "ballY", "weaponY"], NaN);

    if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x, y };
    }

 const pos = getPlayerPosition(player);
    const angle = getNumber(player, ["angle", "flailAngle", "swingAngle"], 0);
 const length = getNumber(player, ["chainLength", "flailLength", "weaponLength"], 70);

    return {
        x: pos.x + Math.cos(angle) * length,
 y: pos.y + Math.sin(angle) * length
    };
}

function getAlive(player) {
 return player?.alive !== false &&
        player?.eliminated !== true &&
 player?.dead !== true;
}


// Camera

function worldToScreen(x, y) {
    const zoom = camera.zoom || 1;

 return {
        x: (x - camera.x) * zoom + window.innerWidth / 2,
 y: (y - camera.y) * zoom + window.innerHeight / 2
    };
}


// Drawing

function drawBackground() {
    const width = window.innerWidth;
 const height = window.innerHeight;

    ctx.fillStyle = "#080b12";
    ctx.fillRect(0, 0, width, height);

 const grid = 48;
    const offsetX = ((-camera.x + width / 2) % grid + grid) % grid;
 const offsetY = ((-camera.y + height / 2) % grid + grid) % grid;

    ctx.beginPath();
    ctx.strokeStyle = "rgba(110,130,170,0.055)";
 ctx.lineWidth = 1;

    for (let x = offsetX; x < width; x += grid) {
        ctx.moveTo(x, 0);
 ctx.lineTo(x, height); 
    }

    for (let y = offsetY; y < height; y += grid) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }

 ctx.stroke();

    const glow = ctx.createRadialGradient(
        width / 2, height / 2, 20,
 width / 2, height / 2, Math.max(width, height) * 0.75
    );

    glow.addColorStop(0, "rgba(99,102,241,0.055)");
 glow.addColorStop(1, "rgba(8,11,18,0)");

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
}

function drawArena() {
 const topLeft = worldToScreen(arenaBounds.x, arenaBounds.y);
    const width = arenaBounds.w * camera.zoom;
 const height = arenaBounds.h * camera.zoom;

    ctx.save();

 ctx.fillStyle = "rgba(18,24,38,0.72)";
    ctx.fillRect(topLeft.x, topLeft.y, width, height);

    ctx.lineWidth = 4;
 ctx.strokeStyle = "#a855f7";
    ctx.shadowColor = "#a855f7";
 ctx.shadowBlur = 16;
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);

    ctx.shadowBlur = 0;
 ctx.lineWidth = 1;
    ctx.setLineDash([8, 12]);
 ctx.strokeStyle = "rgba(129,140,248,0.25)";

    ctx.strokeRect(
        topLeft.x + 12,
 topLeft.y + 12,
        width - 24,
 height - 24
    );

    ctx.setLineDash([]);
 ctx.restore();
}
function drawChain(start, end, color, chainLength = 90) {
   const dx = end.x - start.x;
const dy = end.y - start.y;
const distance = Math.hypot(dx, dy);

  const slack = Math.max(0, chainLength - distance);
   const sag = Math.min(slack * 0.55, 45);

 const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2 + sag;

    ctx.save();
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(midX, midY, end.x, end.y); ctx.strokeStyle = "#b8c2d4";
    ctx.lineWidth = 2;
    ctx.stroke();
 const links = Math.floor(distance / 12);

    for (let i = 1; i < links; i++) {
       const t = i / links;
        const inv = 1 - t;

    const x = inv * inv * start.x +
            2 * inv * t * midX +     t * t * end.x;

        const y = inv * inv * start.y +
            2 * inv * t * midY +
            t * t * end.y;

       ctx.beginPath();
     ctx.arc(x, y, 1.4, 0, Math.PI * 2);
       ctx.fillStyle = color;
        ctx.fill(); 
    }

 ctx.restore();
}

function drawFlail(position, color, radius = 29) {
    ctx.save();

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#090b10";
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(position.x, position.y, radius - 4, 0, Math.PI * 2);
    ctx.fillStyle = "#252b36";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(
        position.x - radius * 0.28, 
        position.y - radius * 0.28,
        radius * 0.16,
        0,
        Math.PI * 2
    );
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.65;
    ctx.fill(); 

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 3, 0, Math.PI * 2); 
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
}

function drawPlayer(player, index) {
    if (!getAlive(player)) return;

 const id = getPlayerId(player);
    const color = getPlayerColor(player, index);

    const worldPos = getPlayerPosition(player);
 const flailWorld = getFlailPosition(player); 

    const pos = worldToScreen(worldPos.x, worldPos.y);
 const flail = worldToScreen(flailWorld.x, flailWorld.y);
    const isMe = id === localPlayerId;

    const playerRadius = 7;
 const maceRadius = 29;

    drawChain(
 pos,
        flail,
 color,
        getNumber(player, ["chainLength"], 90) * camera.zoom
    );

    drawFlail(flail, color, maceRadius);

    ctx.save();

    ctx.beginPath();
 ctx.arc(pos.x, pos.y, playerRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.lineWidth = isMe ? 2 : 1;
 ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    if (isMe) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, playerRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
 ctx.lineWidth = 1;
        ctx.stroke();
    }

    ctx.font = "600 12px Inter";
    ctx.textAlign = "center";
 ctx.textBaseline = "bottom";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(
        getPlayerNameFromData(player),
 pos.x,
        pos.y - playerRadius - 9
    );

    ctx.restore();
}

function drawGame() {
 if (!latestState) {
        drawBackground();
        return;
    }

    updateRenderPositions();

    const alivePlayers = renderPlayers.filter(getAlive);
 const myPlayer = players.find(player => getPlayerId(player) === localPlayerId);
    const renderMyPlayer = renderPlayers.find(player => getPlayerId(player) === localPlayerId);

    const myPosition = renderMyPlayer
        ? getPlayerPosition(renderMyPlayer)
        : myPlayer
            ? getPlayerPosition(myPlayer)
            : arenaCenter;

    camera.x = myPosition.x;
 camera.y = myPosition.y;

    const fitX = (window.innerWidth - 100) / arenaBounds.w;
 const fitY = (window.innerHeight - 160) / arenaBounds.h;

    camera.zoom = Math.max(0.45, Math.min(1, fitX, fitY));

    drawBackground();
 drawArena();

    renderPlayers.forEach(drawPlayer);
 drawParticles();

    const aliveElement = $("aliveCount");
    if (aliveElement) {
 aliveElement.textContent = `ALIVE: ${alivePlayers.length}`;
    }

    const phaseElement = $("phaseLabel");
    if (phaseElement) {
 phaseElement.textContent = latestState.phase || latestState.status || "ARENA";
    }

    updatePlayerStats(myPlayer);
}

function updatePlayerStats(player) {
    const element = $("gamePlayerStats");
 if (!element || !player) return;

    const speed = getNumber(player, ["speed", "velocity"], 0);
 const hits = getNumber(player, ["hits", "hitCount", "kills"], 0);

    element.textContent = `SPEED ${Math.round(speed)}  ·  HITS ${hits}`;
}


// Particles

function spawnParticles(x, y, color, amount = 8) {
    for (let i = 0; i < amount; i++) {
 const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 300;

        particles.push({
 x,
            y,
 vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
 life: 0.3 + Math.random() * 0.5,
            maxLife: 0.8,
 color,
            size: 2 + Math.random() * 4
        });
    }
}

function updateParticles(dt) {
    particles = particles.filter(particle => {
        particle.life -= dt;
 particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
 particle.vx *= 0.97;
        particle.vy *= 0.97;
        return particle.life > 0;
    });

    if (particles.length > 100) {
 particles.splice(0, particles.length - 100);
    }
}

function drawParticles() {
 particles.forEach(particle => {
        const pos = worldToScreen(particle.x, particle.y);

        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
 ctx.fillStyle = particle.color;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.globalAlpha = 1;
}


// Server events

bindButtons();
showScreen("menu");
startInputLoop();

socket.on("connect", () => {
    localPlayerId = socket.id;
 setStatus("menuStatus", "Connected");
});

socket.on("connection:ready", data => {
    localPlayerId = data?.id || data?.socketId || socket.id;
});

socket.on("room:joined", data => {
    const room = normalizeRoom(data);

 currentRoom = room;
    localPlayerId = data?.playerId || data?.id || socket.id;

    setStatus("menuStatus", "");
 updateLobby(data);
    toast("ROOM JOINED");
});

socket.on("lobby:update", data => {
 updateLobby(data);
});

socket.on("room:error", data => {
    const message = typeof data === "string"
        ? data
        : data?.message || data?.error || "Unable to join room.";

    setStatus("menuStatus", message);
    setStatus("lobbyStatus", message);
 toast(message);
});

socket.on("game:start", data => {
    stateBuffer = [];
 renderPlayers = [];
    latestState = null;

    normalizeGameState(data);
 showScreen("game");
    toast("FIGHT!");
});

socket.on("game:tick", data => {
 normalizeGameState(data);
});

socket.on("player:hit", data => {
    const id = data?.targetId || data?.playerId || data?.id;
 const player = players.find(item => getPlayerId(item) === id);

    if (player) {
        const position = getPlayerPosition(player);
 spawnParticles(position.x, position.y, getPlayerColor(player, players.indexOf(player)), 20);
    }

    toast("HIT!");
});

socket.on("player:eliminated", data => {
    const id = data?.playerId || data?.id;
 const player = players.find(item => getPlayerId(item) === id);

    if (player) {
        const position = getPlayerPosition(player);
        spawnParticles(position.x, position.y, getPlayerColor(player, players.indexOf(player)), 30);
    }
});

socket.on("game:over", data => {
    gameRunning = false;
 showResults(data);
});

socket.on("game:rematch", data => {
    stateBuffer = [];
 renderPlayers = [];
    latestState = null;

    normalizeGameState(data);
 showScreen("lobby");
    toast("REMATCH!");
});

socket.on("disconnect", () => {
 clearInputs();
    toast("DISCONNECTED");
});


// Results

function showResults(data) {
    const list = normalizePlayers(data);
 const winner = data?.winner || data?.winnerPlayer || data?.result?.winner;
    const winnerId = typeof winner === "object" ? getPlayerId(winner) : winner;

    const winnerName = typeof winner === "object"
        ? getPlayerNameFromData(winner)
        : data?.winnerName || players.find(player => getPlayerId(player) === winnerId)?.name;

    $("resultTitle").textContent = winnerName ? `${winnerName} WINS!` : "GAME OVER";
 $("resultSubtitle").textContent = data?.message || "THE ARENA HAS SPOKEN";

    const container = $("resultsList");
 container.innerHTML = "";

    const resultsPlayers = list.length ? list : players;

    resultsPlayers.forEach(player => {
        const item = document.createElement("div");
 item.className = "result-player";

        if (getPlayerId(player) === winnerId || player.winner) {
            item.classList.add("winner");
        }

        const name = document.createElement("span");
 name.textContent = getPlayerNameFromData(player);

        const detail = document.createElement("span");
        detail.textContent =
            player.winner || getPlayerId(player) === winnerId
                ? "WINNER"
                : player.alive === false || player.eliminated
                    ? "ELIMINATED"
                    : "FINISHED";

        item.append(name, detail);
 container.appendChild(item);
    });

    showScreen("results");
}

showScreen("menu");