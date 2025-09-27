let WebSocket = require("ws");
let rooms = {};
let pool = require("./databse");
function generateCode(len = 5) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < len; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function boardToString(board) {
    let str = "";
    for (let row = 0; row < board.length; row++) {
        for (let col = 0; col < board[0].length; col++) {
            const cell = board[row][col];
            if (cell === null) {
                str += ".";
            } else {
                str += cell[0];
            }
        }
    }
    return str;
}

function newBoard(rows = 6, cols = 7) {
    let board = [];
    for (let row = 0; row < rows; row++) {
        let row = [];
        for (let c = 0; c < cols; c++) {
            row.push(null);
        }
        board.push(row);
    }
    return board;
}

function dropPiece(board, col, player) {
    for (let row = board.length - 1; row >= 0; row--) {
        if (!board[row][col]) {
            board[row][col] = player.color;
            return row;
        }
    }
    return -1;
}

function handleMove(data, ws) {
    const roomCode =
        data.roomCode && typeof data.roomCode === "string"
            ? data.roomCode
            : ws.roomCode;
    const room = rooms[roomCode];
    const col = data.col;

    if (!room) {
        ws.send(JSON.stringify({ type: "error", reason: "room_not_found" }));
        return;
    }
    if (room.status === "finished") {
        ws.send(JSON.stringify({ type: "error", reason: "game_over" }));
        return;
    }

    if (room.status !== "in_game" || room.players.length < 2) {
        ws.send(JSON.stringify({ type: "error", reason: "game_not_active" }));
        return;
    }

    const currentPlayer = room.players[room.currentTurn];
    if (!currentPlayer || currentPlayer.ws !== ws) {
        ws.send(JSON.stringify({ type: "error", reason: "not_your_turn" }));
        return;
    }

    if (typeof col !== "number" || col < 0 || col >= room.board[0].length) {
        ws.send(JSON.stringify({ type: "error", reason: "invalid_column" }));
        return;
    }

    const landingRow = dropPiece(room.board, col, currentPlayer);
    if (landingRow === -1) {
        ws.send(JSON.stringify({ type: "error", reason: "column_full" }));
        return;
    }

    pool.getConnection((err, conn) => {
        if (err) {
            console.log("DB conn error (handleMove: board update):", err);
            if (conn) conn.release();
            return;
        }
        conn.query(
            "UPDATE rooms SET board_str=? WHERE code=?",
            [boardToString(room.board), data.roomCode],
            (e) => {
                if (e) console.log("DB board update error:", e);
            }
        );
        conn.release();
    });

    if (checkWin(room.board, landingRow, col, currentPlayer)) {
        room.status = "finished";
        room.players.forEach((p) => {
            if (p.ws && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                    JSON.stringify({
                        type: "win",
                        winner: currentPlayer.name,
                        board: room.board,
                    })
                );
            }
        });
        pool.getConnection((err, conn) => {
            if (err) {
                console.log("DB conn error (win):", err);
                if (conn) conn.release();
                return;
            }
            conn.query(
                "UPDATE rooms SET status='finished', winner=? WHERE code=?",
                [room.currentTurn, data.roomCode],
                (e) => {
                    if (e) console.log("DB finish room error:", e);
                }
            );
            conn.release(); // ALWAYS
        });
        return;
    }

    if (checkDraw(room.board)) {
        room.status = "finished";
        room.players.forEach((p) => {
            if (p.ws && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                    JSON.stringify({
                        type: "draw",
                        board: room.board,
                    })
                );
            }
        });
        pool.getConnection((err, conn) => {
            if (err) {
                console.log("DB conn error (draw):", err);
                if (conn) conn.release();
                return;
            }
            conn.query(
                "UPDATE rooms SET status='finished', winner=NULL WHERE code=?",
                [data.roomCode],
                (e) => {
                    if (e) console.log("DB draw room error:", e);
                }
            );
            conn.release(); // ALWAYS
        });
        return;
    }

    room.currentTurn = (room.currentTurn + 1) % 2;

    for (let i = 0; i < room.players.length; i++) {
        const p = room.players[i];
        if (p.ws && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(
                JSON.stringify({
                    type: "state",
                    board: room.board,
                    currentTurn: room.currentTurn,
                    lastMove: {
                        row: landingRow,
                        col,
                        color: currentPlayer.color,
                    },
                })
            );
        }
    }
}
function joinRoom(data, ws) {
    const { roomCode, name, color } = data;
    const room = rooms[roomCode];

    if (!room) {
        ws.send(JSON.stringify({ type: "error", reason: "room_not_found" }));
        return;
    }

    if (room.players.length >= 2) {
        ws.send(JSON.stringify({ type: "error", reason: "room_full" }));
        return;
    }

    room.players.push({ name, color, ws, playerIndex: 1 });
    ws.roomCode = roomCode;
    ws.playerIndex = 1;

    if (room.players.length === 2) {
        room.status = "in_game";
        pool.getConnection((err, conn) => {
            if (err) {
                console.log("DB conn error (join_room → in_game):", err);
                if (conn) conn.release();
                return;
            }
            conn.query(
                "UPDATE rooms SET status='in_game' WHERE code=?",
                [roomCode],
                (e) => {
                    if (e) console.log("DB in_game update error:", e);
                }
            );
            conn.release(); // ALWAYS
        });

        const playerList = room.players.map((p) => ({
            name: p.name,
            color: p.color,
        }));

        for (let i = 0; i < room.players.length; i++) {
            const player = room.players[i];
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(
                    JSON.stringify({
                        type: "room_ready",
                        players: playerList,
                        board: room.board,
                        currentTurn: room.currentTurn,
                        yourIndex: i,
                        roomCode: roomCode,
                    })
                );
            }
        }
    } else {
        ws.send(JSON.stringify({ type: "waiting_for_opponent" }));
    }
}

function checkDraw(board) {
    for (let col = 0; col < board[0].length; col++) {
        if (board[0][col] === null) {
            //no need to check other rows since if top row has empty cell, game is not draw
            return false;
        }
    }
    return true;
}
function checkWin(board, row, col, player) {
    // Check horizontal (left and right)
    const rows = board.length;
    const cols = board[0].length;
    let count = 1;
    // Check left
    let c = col - 1;
    while (c >= 0 && board[row][c] === player.color) {
        count++;
        c--;
    }
    // Check right
    c = col + 1;
    while (c < cols && board[row][c] === player.color) {
        count++;
        c++;
    }
    if (count >= 4) return true;
    // 2. Check vertical (down only)
    count = 1;
    let r = row + 1;
    while (r < rows && board[r][col] === player.color) {
        count++;
        r++;
    }
    if (count >= 4) return true;
    // 3. Check diagonal (top-left to bottom-right)
    count = 1;
    // Check top-left
    r = row - 1;
    c = col - 1;
    while (r >= 0 && c >= 0 && board[r][c] === player.color) {
        count++;
        r--;
        c--;
    }
    // Check bottom-right
    r = row + 1;
    c = col + 1;
    while (r < rows && c < cols && board[r][c] === player.color) {
        count++;
        r++;
        c++;
    }
    if (count >= 4) return true;
    // 4. Check diagonal (top-right to bottom-left)
    count = 1;
    // Check top-right
    r = row - 1;
    c = col + 1;
    while (r >= 0 && c < cols && board[r][c] === player.color) {
        count++;
        r--;
        c++;
    }
    // Check bottom-left
    r = row + 1;
    c = col - 1;
    while (r < rows && c >= 0 && board[r][c] === player.color) {
        count++;
        r++;
        c--;
    }
    if (count >= 4) return true;
    // No win
    return false;
}

module.exports = {
    rooms,
    generateCode,
    checkDraw,
    checkWin,
    dropPiece,
    newBoard,
    handleMove,
    joinRoom,
};
