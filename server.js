const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
/*initializes*/
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const TICK_RATE = 30;
const rooms = new Map();
const socketRooms = new Map();

const COLORS = ["#39e8ff", "#ff4f77", "#c26cff", "#ffce52", "#6dff9d"];

const ARENA_SIZES = {
    small: 390,
    medium: 490,
    large: 590
};

const random = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function flailingRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 4; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    while (rooms.has(code)) {
        code = "";
        for (let i = 0; i < 4; i++) {
            code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
    }

    return code;
}

/*The player may need some fixing.*/
function newFlailPlayer(socket, name) {
    return {
        id: socket.id,
        name: String(name || "Player").trim().slice(0, 16) || "Player",
        color: COLORS[0],
        ready: false,
        alive: true,
        hp: 3,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle: random(0, Math.PI * 2),
        angularVelocity: 0,
        maceX: 0,
        maceY: 0,
        maceVx: 0,
        maceVy: 0,
        chainLength: 82,
        input: { up: false, down: false, left: false, right: false },
        kills: 0,
        invulnerable: 0,
        hitCooldowns: {},
        outOfBoundsTime: 0
    };
}

function makeFlailingRoom(socket, name) {
    const code = flailingRoomCode();

    const room = {
        code,
        hostId: socket.id,
        state: "LOBBY",
        players: [],
        arena: {
            size: "medium",
            x: 0,
            y: 0,
            w: 0,
            h: 0
        },
        createdAt: Date.now(),
        gameStartedAt: 0,
        winnerId: null
    };

    room.players.push(newFlailPlayer(socket, name));
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    socket.join(code);

    return room;
}

function roomForFlailing(socket) {
    const code = socketRooms.get(socket.id);
    return code ? rooms.get(code) : null;
}

function playerInFlailing(room, socket) {
    return room?.players.find(player => player.id === socket.id) || null;
}

function flailingLobbyData(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        state: room.state,
        maxPlayers: MAX_PLAYERS,
        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            color: player.color,
            ready: player.ready,
            alive: player.alive,
            hp: player.hp,
            kills: player.kills
        })),
        arena: room.arena,
        winnerId: room.winnerId
    };
}

function updateFlailingLobby(room) {
    io.to(room.code).emit("lobby:update", flailingLobbyData(room));
}

function sendFlailingRoom(socket, room) {
    socket.emit("room:joined", flailingLobbyData(room));
}

function removeFlailingPlayer(socket) {
    const code = socketRooms.get(socket.id);
    if (!code) return;

    socketRooms.delete(socket.id);

    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter(player => player.id !== socket.id);
    socket.leave(code);

    if (!room.players.length) {
        rooms.delete(code);
        return;
    }

    if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
        room.players[0].ready = true;
    }

    if (room.state === "PLAYING") {
        if (room.players.filter(player => player.alive).length <= 1) {
            finishFlailing(room);
        } else {
            io.to(code).emit("game:tick", runningGameState(room));
        }
    } else {
        updateFlailingLobby(room);
    }
}

function runningGameState(room) {
    const elapsed = (Date.now() - room.gameStartedAt) / 1000;

    return {
        timestamp: Date.now(),
        elapsed,
        phase: "ARENA",
        arena: room.arena,
        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            color: player.color,
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            angle: player.angle,
            angularVelocity: player.angularVelocity,
            maceX: player.maceX,
            maceY: player.maceY,
            maceVx: player.maceVx,
            maceVy: player.maceVy,
            chainLength: player.chainLength,
            alive: player.alive,
            hp: player.hp,
            invulnerable: player.invulnerable,
            kills: player.kills
        }))
    };
}

function startFlailing(room, socket) {
    if (!room || room.state !== "LOBBY") return false;
    if (room.hostId !== socket.id) return false;
    if (room.players.length < 2) return false;
    if (room.players.some(player => !player.ready && player.id !== room.hostId)) return false;

    const height = ARENA_SIZES[room.arena.size] || ARENA_SIZES.medium;
    const width = height * 1.5;

    room.arena = {
        size: room.arena.size,
        x: -width / 2,
        y: -height / 2,
        w: width,
        h: height
    };

    room.state = "PLAYING";
    room.gameStartedAt = Date.now();
    room.winnerId = null;

    const startRadius = Math.min(width, height) * 0.30;

    room.players.forEach((player, index) => {
        const angle = Math.PI * 2 * index / room.players.length;

        player.color = COLORS[index % COLORS.length];
        player.alive = true;
        player.hp = 3;
        player.kills = 0;
        player.invulnerable = 1.5;
        player.vx = 0;
        player.vy = 0;
        player.input = { up: false, down: false, left: false, right: false };
        player.hitCooldowns = {};
        player.outOfBoundsTime = 0;
        player.x = Math.cos(angle) * startRadius;
        player.y = Math.sin(angle) * startRadius;
        player.angle = random(0, Math.PI * 2);
        player.angularVelocity = random(-1, 1);
        player.chainLength = 82;
        player.maceX = player.x + Math.cos(player.angle) * player.chainLength;
        player.maceY = player.y + Math.sin(player.angle) * player.chainLength;
        player.maceVx = -Math.sin(player.angle) * player.angularVelocity * player.chainLength;
        player.maceVy = Math.cos(player.angle) * player.angularVelocity * player.chainLength;
    });

    io.to(room.code).emit("game:start", flailingLobbyData(room));
    return true;
}

function finishFlailing(room) {
    if (!room || room.state !== "PLAYING") return;

    room.state = "RESULTS";
    const alive = room.players.filter(player => player.alive);
    const winner = alive.length === 1 ? alive[0] : null;
    room.winnerId = winner?.id || null;

    io.to(room.code).emit("game:over", {
        winnerId: room.winnerId,
        winnerName: winner?.name || null,
        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            color: player.color,
            alive: player.alive,
            hp: player.hp,
            kills: player.kills
        }))
    });
}

function checkFlailingWinner(room) {
    if (room.state !== "PLAYING") return;

    const alive = room.players.filter(player => player.alive);
    if (alive.length <= 1) finishFlailing(room);
}

function eliminateFlailingPlayer(room, player, cause) {
    if (!player.alive) return;

    player.alive = false;
    player.hp = 0;
    player.input = { up: false, down: false, left: false, right: false };

    io.to(room.code).emit("player:eliminated", {
        playerId: player.id,
        cause
    });

    checkFlailingWinner(room);
}

function damageFlailingPlayer(room, target, attacker, knockX, knockY) {
    if (!target.alive || target.invulnerable > 0) return;

    target.hp--;
    target.invulnerable = 0.65;
    target.vx += knockX;
    target.vy += knockY;

    if (attacker && attacker.id !== target.id && target.hp <= 0) {
        attacker.kills++;
    }

    io.to(room.code).emit("player:hit", {
        targetId: target.id,
        attackerId: attacker?.id || null,
        hp: target.hp,
        vx: target.vx,
        vy: target.vy
    });

    if (target.hp <= 0) {
        eliminateFlailingPlayer(room, target, "flail");
    }
}

function flailVelocity(player) {
    return Math.hypot(player.maceVx, player.maceVy);
}

function tryFlailingHit(room, attacker, target, now) {
    if (!attacker.alive || !target.alive) return;

    if ((attacker.hitCooldowns[target.id] || 0) > now) return;

    const distance = Math.hypot(attacker.maceX - target.x, attacker.maceY - target.y);
    if (distance > 29) return;

    const speed = flailVelocity(attacker);
    if (speed < 115) return;

    const nx = (target.x - attacker.maceX) / (distance || 1);
    const ny = (target.y - attacker.maceY) / (distance || 1);

    attacker.hitCooldowns[target.id] = now + 450;
    damageFlailingPlayer(room, target, attacker, nx * 145, ny * 145);
}

function updateFlailingPhysics(room, dt) {
    if (room.state !== "PLAYING") return;

    const elapsed = (Date.now() - room.gameStartedAt) / 1000;
    const shrink = clamp(elapsed / 150, 0, 1);

    const originalHeight = ARENA_SIZES[room.arena.size] || ARENA_SIZES.medium;
    const originalWidth = originalHeight * 1.5;
    const width = originalWidth * (1 - shrink) + 300 * shrink;
    const height = originalHeight * (1 - shrink) + 210 * shrink;

    room.arena.w = width;
    room.arena.h = height;
    room.arena.x = -width / 2;
    room.arena.y = -height / 2;

    for (const player of room.players) {
        if (!player.alive) continue;

        player.invulnerable = Math.max(0, player.invulnerable - dt);

        let dx = 0;
        let dy = 0;

        if (player.input.left) dx--;
        if (player.input.right) dx++;
        if (player.input.up) dy--;
        if (player.input.down) dy++;

        const inputLength = Math.hypot(dx, dy) || 1;
        dx /= inputLength;
        dy /= inputLength;

        const previousVx = player.vx;
        const previousVy = player.vy;

        player.vx += dx * 470 * dt;
        player.vy += dy * 470 * dt;

        player.vx *= Math.pow(0.90, dt * 30);
        player.vy *= Math.pow(0.90, dt * 30);

        const speed = Math.hypot(player.vx, player.vy);
        if (speed > 310) {
            player.vx = player.vx / speed * 310;
            player.vy = player.vy / speed * 310;
        }

        player.x += player.vx * dt;
        player.y += player.vy * dt;

        const playerAx = (player.vx - previousVx) / dt;
        const playerAy = (player.vy - previousVy) / dt;

        const chainDx = player.maceX - player.x;
        const chainDy = player.maceY - player.y;
        const chainDistance = Math.hypot(chainDx, chainDy) || player.chainLength;
        const chainAngle = Math.atan2(chainDy, chainDx);

        const tangentX = -Math.sin(chainAngle);
        const tangentY = Math.cos(chainAngle);
        const tangentialAcceleration = (playerAx * tangentX + playerAy * tangentY) * 0.72;

        player.maceVx += playerAx * 0.58 * dt;
        player.maceVy += playerAy * 0.58 * dt;

        const pull = Math.max(0, chainDistance - player.chainLength) * 24;
        player.maceVx -= Math.cos(chainAngle) * pull * dt;
        player.maceVy -= Math.sin(chainAngle) * pull * dt;

        player.maceVx += tangentX * tangentialAcceleration * dt;
        player.maceVy += tangentY * tangentialAcceleration * dt;

        player.maceVx *= Math.pow(0.992, dt * 30);
        player.maceVy *= Math.pow(0.992, dt * 30);

        player.maceX += player.maceVx * dt;
        player.maceY += player.maceVy * dt;

        const ropeX = player.maceX - player.x;
        const ropeY = player.maceY - player.y;
        const ropeDistance = Math.hypot(ropeX, ropeY) || 1;

        if (ropeDistance > player.chainLength) {
            const nx = ropeX / ropeDistance;
            const ny = ropeY / ropeDistance;

            player.maceX = player.x + nx * player.chainLength;
            player.maceY = player.y + ny * player.chainLength;

            const outwardSpeed = player.maceVx * nx + player.maceVy * ny;
            if (outwardSpeed > 0) {
                player.maceVx -= nx * outwardSpeed;
                player.maceVy -= ny * outwardSpeed;
            }
        }

        player.angle = Math.atan2(player.maceY - player.y, player.maceX - player.x);
        player.angularVelocity = (player.maceVx * -Math.sin(player.angle) + player.maceVy * Math.cos(player.angle)) / player.chainLength;
    }

    const alive = room.players.filter(player => player.alive);
    const now = Date.now();

    for (let i = 0; i < alive.length; i++) {
        const a = alive[i];

        for (let j = i + 1; j < alive.length; j++) {
            const b = alive[j];

            const bodyDistance = Math.hypot(a.x - b.x, a.y - b.y);
            const bodyMinimum = 34;

            if (bodyDistance < bodyMinimum && bodyDistance > 0) {
                const nx = (b.x - a.x) / bodyDistance;
                const ny = (b.y - a.y) / bodyDistance;
                const overlap = bodyMinimum - bodyDistance;

                a.x -= nx * overlap * 0.5;
                a.y -= ny * overlap * 0.5;
                b.x += nx * overlap * 0.5;
                b.y += ny * overlap * 0.5;

                a.vx -= nx * 28;
                a.vy -= ny * 28;
                b.vx += nx * 28;
                b.vy += ny * 28;
            }

            tryFlailingHit(room, a, b, now);
            tryFlailingHit(room, b, a, now);
        }
    }

    for (const player of room.players) {
        if (!player.alive) continue;

        const margin = 40;

        if (
            player.x < room.arena.x - margin ||
            player.x > room.arena.x + room.arena.w + margin ||
            player.y < room.arena.y - margin ||
            player.y > room.arena.y + room.arena.h + margin
        ) {
            eliminateFlailingPlayer(room, player, "arena");
        }
    }

    checkFlailingWinner(room);
    if (room.state !== "PLAYING") return;

    io.to(room.code).emit("game:tick", runningGameState(room));
}

io.on("connection", socket => {
    socket.emit("connection:ready", { id: socket.id });

    socket.on("room:create", (data = {}) => {
        if (socketRooms.has(socket.id)) removeFlailingPlayer(socket);

        const room = makeFlailingRoom(socket, data.name);
        sendFlailingRoom(socket, room);
        updateFlailingLobby(room);
    });

    socket.on("room:join", (data = {}) => {
        if (socketRooms.has(socket.id)) removeFlailingPlayer(socket);

        const code = String(data.code || "").trim().toUpperCase();
        const room = rooms.get(code);

        if (!room) {
            socket.emit("room:error", "Room not found.");
            return;
        }

        if (room.state !== "LOBBY") {
            socket.emit("room:error", "That game has already started.");
            return;
        }

        if (room.players.length >= MAX_PLAYERS) {
            socket.emit("room:error", "Room is full.");
            return;
        }

        const player = newFlailPlayer(socket, data.name);
        player.color = COLORS[room.players.length % COLORS.length];

        room.players.push(player);
        socketRooms.set(socket.id, code);
        socket.join(code);

        sendFlailingRoom(socket, room);
        updateFlailingLobby(room);
    });

    socket.on("player:ready", value => {
        const room = roomForFlailing(socket);
        const player = playerInFlailing(room, socket);

        if (!room || !player || room.state !== "LOBBY") return;
        if (player.id === room.hostId) return;

        player.ready = Boolean(value);
        updateFlailingLobby(room);
    });

    socket.on("host:arena", size => {
        const room = roomForFlailing(socket);

        if (!room || room.hostId !== socket.id || room.state !== "LOBBY") return;
        if (!ARENA_SIZES[size]) return;

        room.arena.size = size;
        updateFlailingLobby(room);
    });

    socket.on("game:start", () => {
        const room = roomForFlailing(socket);
        if (!room) return;

        if (!startFlailing(room, socket)) {
            socket.emit("room:error", "Can't start yet. Check players and ready status.");
        }
    });

    socket.on("game:input", data => {
        const room = roomForFlailing(socket);
        const player = playerInFlailing(room, socket);

        if (!room || !player || room.state !== "PLAYING" || !player.alive) return;

        player.input = {
            up: Boolean(data?.up),
            down: Boolean(data?.down),
            left: Boolean(data?.left),
            right: Boolean(data?.right)
        };
    });

    socket.on("game:rematch", () => {
        const room = roomForFlailing(socket);
        if (!room || room.state !== "RESULTS") return;

        room.state = "LOBBY";
        room.winnerId = null;

        room.players.forEach(player => {
            player.ready = player.id === room.hostId;
            player.alive = true;
            player.hp = 3;
            player.kills = 0;
            player.invulnerable = 0;
            player.hitCooldowns = {};
            player.input = { up: false, down: false, left: false, right: false };
        });

        updateFlailingLobby(room);
        io.to(room.code).emit("game:rematch");
    });

    socket.on("room:leave", () => removeFlailingPlayer(socket));
    socket.on("disconnect", () => removeFlailingPlayer(socket));
});

setInterval(() => {
    const dt = 1 / TICK_RATE;

    for (const room of rooms.values()) {
        updateFlailingPhysics(room, dt);
    }
}, 1000 / TICK_RATE);

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        rooms: rooms.size,
        players: socketRooms.size
    });
});

server.listen(PORT, () => {
    console.log(`FLAILING server running on port ${PORT}`);
});