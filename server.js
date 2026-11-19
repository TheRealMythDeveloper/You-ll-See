
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const TICK_RATE = 30;
const rooms = new Map();
const socketRooms = new Map();

const COLORS = [
    "#39e8ff",
    "#ff4f77",
    "#c26cff",
    "#ffce52",
    "#6dff9d"
];

const ARENA_SIZES = {
    small: 390,
    medium: 490,
    large: 590
};

const random = (min, max) =>
    min + Math.random() * (max - min);

const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

const makeCode = () => {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 4; i++) {
        code += characters[Math.floor(Math.random() * characters.length)];
    }

    return code;
};

function createUniqueCode() {
    let code;

    do {
        code = makeCode();
    } while (rooms.has(code));

    return code;
}

function createPlayer(socket, name) {
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
        angularVelocity: random(-2, 2),
        maceX: 0,
        maceY: 0,
        input: {
            up: false,
            down: false,
            left: false,
            right: false
        },
        kills: 0,
        invulnerable: 0
    };
}

function createRoom(socket, name) {
    const code = createUniqueCode();

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
        lastUpdate: Date.now(),
        winnerId: null
    };

    const player = createPlayer(socket, name);

    room.players.push(player);
    rooms.set(code, room);
    socketRooms.set(socket.id, code);

    socket.join(code);

    return room;
}

function getRoom(socket) {
    const code = socketRooms.get(socket.id);
    return code ? rooms.get(code) : null;
}

function getPlayer(room, socket) {
    return room?.players.find(player => player.id === socket.id) || null;
}

function roomSummary(room) {
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

function broadcastLobby(room) {
    io.to(room.code).emit("lobby:update", roomSummary(room));
}

function sendRoom(socket, room) {
    socket.emit("room:joined", roomSummary(room));
}

function removePlayer(socket) {
    const code = socketRooms.get(socket.id);
    if (!code) return;

    const room = rooms.get(code);
    socketRooms.delete(socket.id);

    if (!room) return;

    room.players = room.players.filter(player => player.id !== socket.id);

    socket.leave(code);

    if (room.players.length === 0) {
        rooms.delete(code);
        return;
    }

    if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
    }

    if (room.state === "PLAYING") {
        if (room.players.length <= 1) {
            finishGame(room, room.players[0] || null);
        } else {
            checkWinner(room);
        }
    }

    if (room.state === "LOBBY") {
        broadcastLobby(room);
    } else {
        io.to(code).emit("game:state", roomSummary(room));
    }
}

function startGame(room, socket) {
    if (!room || room.state !== "LOBBY") return false;
    if (room.hostId !== socket.id) return false;
    if (room.players.length < 2) return false;
    if (room.players.some(player => !player.ready && player.id !== room.hostId)) return false;

    const size = room.arena.size;
    const height = ARENA_SIZES[size] || ARENA_SIZES.medium;
    const width = height * 1.5;

    room.arena = {
        size,
        x: -width / 2,
        y: -height / 2,
        w: width,
        h: height
    };

    room.state = "PLAYING";
    room.gameStartedAt = Date.now();
    room.lastUpdate = Date.now();
    room.winnerId = null;

    const count = room.players.length;
    const radius = Math.min(width, height) * 0.29;

    room.players.forEach((player, index) => {
        const angle = (Math.PI * 2 * index) / count;

        player.color = COLORS[index % COLORS.length];
        player.alive = true;
        player.hp = 3;
        player.kills = 0;
        player.invulnerable = 1.5;
        player.vx = 0;
        player.vy = 0;
        player.input = {
            up: false,
            down: false,
            left: false,
            right: false
        };

        player.x = Math.cos(angle) * radius;
        player.y = Math.sin(angle) * radius;
        player.angle = random(0, Math.PI * 2);
        player.angularVelocity = random(-2.5, 2.5);
        player.maceX = player.x + Math.cos(player.angle) * 78;
        player.maceY = player.y + Math.sin(player.angle) * 78;
    });

    io.to(room.code).emit("game:start", roomSummary(room));

    return true;
}

function finishGame(room, winner) {
    if (!room || room.state !== "PLAYING") return;

    room.state = "RESULTS";
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

function checkWinner(room) {
    if (room.state !== "PLAYING") return;

    const alive = room.players.filter(player => player.alive);

    if (alive.length <= 1) {
        finishGame(room, alive[0] || null);
    }
}

function eliminatePlayer(room, player, cause) {
    if (!player.alive) return;

    player.alive = false;
    player.hp = 0;

    io.to(room.code).emit("player:eliminated", {
        playerId: player.id,
        cause
    });

    checkWinner(room);
}

function damagePlayer(room, target, attacker, knockX, knockY) {
    if (!target.alive || target.invulnerable > 0) return;

    target.hp--;
    target.invulnerable = 0.65;

    target.vx += knockX;
    target.vy += knockY;

    if (attacker && attacker.id !== target.id) {
        attacker.kills += target.hp <= 0 ? 1 : 0;
    }

    io.to(room.code).emit("player:hit", {
        targetId: target.id,
        attackerId: attacker?.id || null,
        hp: target.hp,
        vx: target.vx,
        vy: target.vy
    });

    if (target.hp <= 0) {
        eliminatePlayer(room, target, "flail");
    }
}

function updateRoom(room, dt) {
    if (room.state !== "PLAYING") return;

    const elapsed = (Date.now() - room.gameStartedAt) / 1000;
    const shrinkProgress = clamp(elapsed / 150, 0, 1);

    const originalHeight = ARENA_SIZES[room.arena.size] || ARENA_SIZES.medium;
    const originalWidth = originalHeight * 1.5;

    const width = originalWidth * (1 - shrinkProgress) + 300 * shrinkProgress;
    const height = originalHeight * (1 - shrinkProgress) + 210 * shrinkProgress;

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

        const magnitude = Math.hypot(dx, dy) || 1;
        dx /= magnitude;
        dy /= magnitude;

        player.vx += dx * 470 * dt;
        player.vy += dy * 470 * dt;

        player.vx *= Math.pow(0.90, dt * 30);
        player.vy *= Math.pow(0.90, dt * 30);

        const maxSpeed = 310;
        const speed = Math.hypot(player.vx, player.vy);

        if (speed > maxSpeed) {
            player.vx = player.vx / speed * maxSpeed;
            player.vy = player.vy / speed * maxSpeed;
        }

        player.x += player.vx * dt;
        player.y += player.vy * dt;

        player.angularVelocity +=
            (dx * 0.8 - dy * 0.6) * dt;

        player.angularVelocity *= Math.pow(0.995, dt * 30);
        player.angularVelocity = clamp(player.angularVelocity, -10, 10);

        player.angle += player.angularVelocity * dt;

        const chainLength = 78;

        player.maceX = player.x + Math.cos(player.angle) * chainLength;
        player.maceY = player.y + Math.sin(player.angle) * chainLength;
    }

    const alive = room.players.filter(player => player.alive);

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

                const push = 28;

                a.vx -= nx * push;
                a.vy -= ny * push;
                b.vx += nx * push;
                b.vy += ny * push;
            }

            const maceDistance = Math.hypot(a.maceX - b.x, a.maceY - b.y);

            if (maceDistance < 29) {
                const speed = Math.hypot(a.vx, a.vy) + Math.abs(a.angularVelocity) * 18;
                const nx = (b.x - a.maceX) / (maceDistance || 1);
                const ny = (b.y - a.maceY) / (maceDistance || 1);

                if (speed > 110) {
                    damagePlayer(room, b, a, nx * 145, ny * 145);
                }
            }

            const reverseMaceDistance = Math.hypot(b.maceX - a.x, b.maceY - a.y);

            if (reverseMaceDistance < 29) {
                const speed = Math.hypot(b.vx, b.vy) + Math.abs(b.angularVelocity) * 18;
                const nx = (a.x - b.maceX) / (reverseMaceDistance || 1);
                const ny = (a.y - b.maceY) / (reverseMaceDistance || 1);

                if (speed > 110) {
                    damagePlayer(room, a, b, nx * 145, ny * 145);
                }
            }
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
            eliminatePlayer(room, player, "arena");
        }
    }

    checkWinner(room);

    if (room.state !== "PLAYING") return;

    io.to(room.code).emit("game:tick", {
        timestamp: Date.now(),
        elapsed,
        arena: room.arena,
        players: room.players.map(player => ({
            id: player.id,
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            angle: player.angle,
            angularVelocity: player.angularVelocity,
            maceX: player.maceX,
            maceY: player.maceY,
            alive: player.alive,
            hp: player.hp,
            invulnerable: player.invulnerable,
            color: player.color,
            name: player.name,
            kills: player.kills
        }))
    });
}

io.on("connection", socket => {
    socket.emit("connection:ready", {
        id: socket.id
    });

    socket.on("room:create", (data = {}) => {
        if (socketRooms.has(socket.id)) {
            removePlayer(socket);
        }

        const room = createRoom(socket, data.name);
        sendRoom(socket, room);
        broadcastLobby(room);
    });

    socket.on("room:join", (data = {}) => {
        if (socketRooms.has(socket.id)) {
            removePlayer(socket);
        }

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

        const player = createPlayer(socket, data.name);
        player.color = COLORS[room.players.length % COLORS.length];

        room.players.push(player);
        socketRooms.set(socket.id, code);
        socket.join(code);

        sendRoom(socket, room);
        broadcastLobby(room);
    });

    socket.on("player:ready", value => {
        const room = getRoom(socket);
        const player = getPlayer(room, socket);

        if (!room || !player || room.state !== "LOBBY") return;
        if (player.id === room.hostId) return;

        player.ready = Boolean(value);
        broadcastLobby(room);
    });

    socket.on("host:arena", size => {
        const room = getRoom(socket);

        if (!room || room.hostId !== socket.id || room.state !== "LOBBY") return;
        if (!ARENA_SIZES[size]) return;

        room.arena.size = size;
        broadcastLobby(room);
    });

    socket.on("game:start", () => {
        const room = getRoom(socket);

        if (!room) return;

        if (!startGame(room, socket)) {
            socket.emit("room:error", "Cannot start yet. Check players and ready status.");
        }
    });

    socket.on("game:input", input => {
        const room = getRoom(socket);
        const player = getPlayer(room, socket);

        if (!room || !player || room.state !== "PLAYING" || !player.alive) return;

        player.input = {
            up: Boolean(input?.up),
            down: Boolean(input?.down),
            left: Boolean(input?.left),
            right: Boolean(input?.right)
        };
    });

    socket.on("game:rematch", () => {
        const room = getRoom(socket);

        if (!room || room.state !== "RESULTS") return;

        room.state = "LOBBY";
        room.winnerId = null;

        room.players.forEach(player => {
            player.ready = player.id === room.hostId;
            player.alive = true;
            player.hp = 3;
            player.kills = 0;
        });

        broadcastLobby(room);
        io.to(room.code).emit("game:rematch");
    });

    socket.on("room:leave", () => {
        removePlayer(socket);
    });

    socket.on("disconnect", () => {
        removePlayer(socket);
    });
});

setInterval(() => {
    const dt = 1 / TICK_RATE;

    for (const room of rooms.values()) {
        updateRoom(room, dt);
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
