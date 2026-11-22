const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
/*initializes..   DONT FORGET THIS EVER.*/
const app = express();
 const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); 

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
 const TICK_RATE = 80;
const rooms = new Map(); 
const socketRooms = new Map();

const COLORS = ["#39e8ff", "#ff4f77", "#c26cff", "#ffce52", "#6dff9d"];

const ARENA_SIZES = {
 small: 500, 
    medium: 600,
 large: 700
};

const random = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max,value));

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
 hitLockUntil: 0,
        id: socket.id,
 lastPlayerX: 0,
        lastPlayerY: 0,
 name: String(name || "Player").trim().slice(0, 16) || "Player",
        color: COLORS[0],
 ready: false,
    alive: true,
        hp: 100,
 x: 0,
        y: 0,
 vx: 0,
        vy: 0,
 angle: random(0, Math.PI * 2),
        angularVelocity: 0,
 lastInputAngle: null,
        spinInput: 0,
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
 player.hitLockUntil = 0;
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
 player.lastPlayerX = player.x;
player.lastPlayerY = player.y;
        player.angle = random(0, Math.PI * 2);
 player.angularVelocity = random(-0.4, 0.4);
        player.lastInputAngle = null;
 player.spinInput = 0;
        player.chainLength = 90;
 player.maceX = player.x + Math.cos(player.angle) * player.chainLength;
        player.maceY = player.y + Math.sin(player.angle) * player.chainLength;
 player.macePrevX = player.maceX;
        player.macePrevY = player.maceY;
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

    const dx = target.x - attacker.maceX;
 const dy = target.y - attacker.maceY;
    const distance = Math.hypot(dx, dy);

    // radius.. um.. 
    if (distance > 34) return;

 const speed = flailVelocity(attacker);
    if (speed < 100) return;

    // launching should work now
    let launchX = attacker.maceVx;
 let launchY = attacker.maceVy;
    const launchSpeed = Math.hypot(launchX, launchY) || 1;

 launchX /= launchSpeed;
    launchY /= launchSpeed;


    const contactX = dx / (distance || 1);
 const contactY = dy / (distance || 1);

    launchX = launchX * 0.75 + contactX * 0.25;
 launchY = launchY * 0.75 + contactY * 0.25;

    const finalLength = Math.hypot(launchX, launchY) || 1;
 launchX /= finalLength;
    launchY /= finalLength;

    attacker.hitCooldowns[target.id] = now + 450;

    // force players to get hit
 target.hitLockUntil = now + 75;

    const launchForce = 230 + Math.min(speed * 0.35, 220);

    damageFlailingPlayer(
 room,
        target,
 attacker,
        launchX * launchForce,
        launchY * launchForce
    );
}

function updateFlailingPhysics(room, dt) {
    if (room.state !== "PLAYING") return;

 const now = Date.now();
    const frameTime = Math.min(dt, 0.05);
 const substeps = 3;
    const step = frameTime / substeps;

    const playerMass = 1;
 const maceMass = 4;
    const playerInverseMass = 1 / playerMass;
 const maceInverseMass = 1 / maceMass;

    const playerAcceleration = 850;
 const maxPlayerSpeed = 650;
    const maxMaceSpeed = 450;
 const playerDrag = 0.999;
    const maceDrag = 0.9997;
 const ropeBounce = 0;

    // =====================================================
    // PLAYER + MACE PHYSICS
    // =====================================================
 for (const player of room.players) {
        if (!player.alive) continue;

 player.invulnerable = Math.max(0, player.invulnerable - frameTime);

        player.vx ??= 0;
 player.vy ??= 0;
        player.maceVx ??= 0;
 player.maceVy ??= 0;

        player.macePrevX ??= player.maceX;
 player.macePrevY ??= player.maceY;

        for (let sub = 0; sub < substeps; sub++) {

            // -------------------------------
            // READ INPUT
            // -------------------------------
            let inputX = 0;
 let inputY = 0;

            if (player.input.left) inputX--;
 if (player.input.right) inputX++;
            if (player.input.up) inputY--;
 if (player.input.down) inputY++;

            const inputLength = Math.hypot(inputX, inputY);

            if (inputLength > 0) {
 inputX /= inputLength;
                inputY /= inputLength;
            }

            // -------------------------------
            // PLAYER ACCELERATION
            // -------------------------------
            if (now >= player.hitLockUntil) {
                player.vx += inputX * playerAcceleration * step;
 player.vy += inputY * playerAcceleration * step;
            }

            // -------------------------------
            // DRAG
            // -------------------------------
            player.vx *= Math.pow(playerDrag, step * 60);
 player.vy *= Math.pow(playerDrag, step * 60);

            player.maceVx *= Math.pow(maceDrag, step * 60);
 player.maceVy *= Math.pow(maceDrag, step * 60);

            // -------------------------------
            // LIMIT SPEED
            // -------------------------------
            let playerSpeed = Math.hypot(player.vx, player.vy);

            if (playerSpeed > maxPlayerSpeed) {
                player.vx = (player.vx / playerSpeed) * maxPlayerSpeed;
 player.vy = (player.vy / playerSpeed) * maxPlayerSpeed;
            }

            let maceSpeed = Math.hypot(player.maceVx, player.maceVy);

            if (maceSpeed > maxMaceSpeed) {
                player.maceVx = (player.maceVx / maceSpeed) * maxMaceSpeed;
 player.maceVy = (player.maceVy / maceSpeed) * maxMaceSpeed;
            }

            // -------------------------------
            // MOVE BOTH OBJECTS
            // -------------------------------
            player.x += player.vx * step;
 player.y += player.vy * step;

            player.maceX += player.maceVx * step;
 player.maceY += player.maceVy * step;

            // -------------------------------
            // ROPE CONSTRAINT
            // -------------------------------
            const ropeX = player.x - player.maceX;
 const ropeY = player.y - player.maceY;
            const distance = Math.hypot(ropeX, ropeY);

            if (distance > player.chainLength && distance > 0.0001) {
                const nx = ropeX / distance;
 const ny = ropeY / distance;

                // Rope correction. Both bodies move according to mass.
                const excess = distance - player.chainLength;
 const totalInverseMass = playerInverseMass + maceInverseMass;

                player.x -= nx * excess * (playerInverseMass / totalInverseMass);
 player.y -= ny * excess * (playerInverseMass / totalInverseMass);

                player.maceX += nx * excess * (maceInverseMass / totalInverseMass);
 player.maceY += ny * excess * (maceInverseMass);

                // Relative velocity along the rope.
                const relativeVx = player.vx - player.maceVx;
 const relativeVy = player.vy - player.maceVy;
                const outwardVelocity = relativeVx * nx + relativeVy * ny;

                // Remove velocity that would stretch the rope.
                if (outwardVelocity > 0) {
                    const impulse = (1 + ropeBounce) * outwardVelocity / totalInverseMass;

                    player.vx -= nx * impulse * playerInverseMass;
 player.vy -= ny * impulse * playerInverseMass;

                    player.maceVx += nx * impulse * maceInverseMass;
 player.maceVy += ny * impulse * maceInverseMass;
                }
            }
        }

        // -------------------------------
        // FINAL PLAYER / MACE VALUES
        // -------------------------------
 player.angle = Math.atan2(
            player.y - player.maceY,
        player.x - player.maceX
        );

        player.angularVelocity =
            ((player.vx - player.maceVx) *
            -Math.sin(player.angle) +
            (player.vy - player.maceVy) *
            Math.cos(player.angle)) / player.chainLength;

 player.macePrevX = player.maceX - player.maceVx * frameTime;
        player.macePrevY = player.maceY - player.maceVy * frameTime;
    }

    // =====================================================
    // PLAYER-TO-PLAYER COLLISIONS
    // =====================================================
 const alive = room.players.filter(player => player.alive);

    for (let i = 0; i < alive.length; i++) {
        const a = alive[i];

 for (let j = i + 1; j < alive.length; j++) {
            const b = alive[j];

            const dx = b.x - a.x;
 const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);

            const minimum = 18;

            if (distance < minimum && distance > 0.0001) {
                const nx = dx / distance;
 const ny = dy / distance;
                const overlap = minimum - distance;

                // Separate players.
                a.x -= nx * overlap * 0.5;
 a.y -= ny * overlap * 0.5;
                b.x += nx * overlap * 0.5;
 b.y += ny * overlap * 0.5;

                // Bounce them apart.
                const relativeVelocity =
                    (b.vx - a.vx) * nx +
                    (b.vy - a.vy) * ny;

                if (relativeVelocity < 0) {
                    const impulse = -relativeVelocity * 0.65;

                    a.vx -= nx * impulse;
 a.vy -= ny * impulse;
                    b.vx += nx * impulse;
 b.vy += ny * impulse;
                }
            }

            tryFlailingHit(room, a, b, now);
 tryFlailingHit(room, b, a, now);
        }
    }

    // =====================================================
    // MACE-TO-MACE COLLISIONS
    // =====================================================
 for (let i = 0; i < alive.length; i++) {
        const a = alive[i];

        for (let j = i + 1; j < alive.length; j++) {
 const b = alive[j];

            const dx = b.maceX - a.maceX;
 const dy = b.maceY - a.maceY;
            const distance = Math.hypot(dx, dy) || 0.0001;
 const minimum = 58;

            if (distance >= minimum) continue;

            const nx = dx / distance;
 const ny = dy / distance;
            const overlap = minimum - distance;

            // Separate mace heads.
            a.maceX -= nx * overlap * 0.5;
 a.maceY -= ny * overlap * 0.5;
            b.maceX += nx * overlap * 0.5;
 b.maceY += ny * overlap * 0.5;

            const relativeVelocity =
                (b.maceVx - a.maceVx) * nx +
                (b.maceVy - a.maceVy) * ny;

            if (relativeVelocity < 0) {
                const impulse = -relativeVelocity * 0.85;

                a.maceVx -= nx * impulse;
 a.maceVy -= ny * impulse;
                b.maceVx += nx * impulse;
 b.maceVy += ny * impulse;
            }
        }
    }

    // =====================================================
    // ARENA WALL COLLISIONS
    // =====================================================
 const wallPadding = 12;

    const left = room.arena.x + wallPadding;
 const right = room.arena.x + room.arena.w - wallPadding;
    const top = room.arena.y + wallPadding;
 const bottom = room.arena.y + room.arena.h - wallPadding;

    for (const player of room.players) {
        if (!player.alive) continue;

        // Player wall bounce
        if (player.x < left) {
            player.x = left;
 if (player.vx < 0) player.vx *= -0.65;
        }

        if (player.x > right) {
 player.x = right;
            if (player.vx > 0) player.vx *= -0.65;
        }

        if (player.y < top) {
            player.y = top;
 if (player.vy < 0) player.vy *= -0.65;
        }

        if (player.y > bottom) {
 player.y = bottom;
            if (player.vy > 0) player.vy *= -0.65;
        }

        // Mace wall bounce
        if (player.maceX < left) {
            player.maceX = left;
 if (player.maceVx < 0) player.maceVx *= -0.65;
        }

        if (player.maceX > right) {
 player.maceX = right;
            if (player.maceVx > 0) player.maceVx *= -0.65;
        }

        if (player.maceY < top) {
            player.maceY = top;
 if (player.maceVy < 0) player.maceVy *= -0.65;
        }

        if (player.maceY > bottom) {
 player.maceY = bottom;
            if (player.maceVy > 0) player.maceVy *= -0.65;
        }

        // Recheck the rope after hitting walls.
        const dx = player.x - player.maceX;
 const dy = player.y - player.maceY;
        const distance = Math.hypot(dx, dy);

        if (distance > player.chainLength && distance > 0.0001) {
            const nx = dx / distance;
 const ny = dy / distance;

            player.x = player.maceX + nx * player.chainLength;
 player.y = player.maceY + ny * player.chainLength;

            const relativeVx = player.vx - player.maceVx;
 const relativeVy = player.vy - player.maceVy;
            const outwardVelocity = relativeVx * nx + relativeVy * ny;

            if (outwardVelocity > 0) {
                player.vx -= nx * outwardVelocity;
 player.vy -= ny * outwardVelocity;
            }
        }

        // Update the mace velocity used by hit detection.
 player.macePrevX = player.maceX - player.maceVx * frameTime;
        player.macePrevY = player.maceY - player.maceVy * frameTime;

        player.angle = Math.atan2(
            player.y - player.maceY,
 player.x - player.maceX
        );
    }

    checkFlailingWinner(room);
 if (room.state !== "PLAYING") return;
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

let tickCount = 0;

setInterval(() => {
 const dt = 1 / TICK_RATE;

    for (const room of rooms.values()) {
        if (room.state !== "PLAYING") continue;

 updateFlailingPhysics(room, dt);
    }

 tickCount++;

    // Network updates at 40Hz instead of 80Hz
    if (tickCount % 2 === 0) {
        for (const room of rooms.values()) {
 if (room.state !== "PLAYING") continue;

            io.to(room.code).emit("game:tick", runningGameState(room));
        }
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