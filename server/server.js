// server/index.js
let http = require("http");
let WebSocket = require("ws");
let url = require("url");
let fs = require("fs");
let path = require("path");
let pool = require("./databse");
//prettier-ignore
let {rooms, handleMove, checkDraw, checkWin, generateCode, dropPiece, newBoard, joinRoom   } = require("./rooms-handling");
let wss = new WebSocket.Server({ host: "0.0.0.0", port: 8080 });
wss.on("listening", () => console.log("WS listening on ws://0.0.0.0:8080"));
wss.on("error", (err) => console.error("WS error:", err));
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

wss.on("connection", (ws) => {
    console.log("WS: client connected");

    ws.on("message", (msg) => {
        // חשוב: להמיר למחרוזת לפני parse
        const text = msg.toString();
        console.log("WS received:", text);

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            ws.send(JSON.stringify({ type: "error", reason: "invalid_json" }));
            return;
        }

        if (data.type === "create_room") {
            let roomCode = generateCode();
            rooms[roomCode] = {
                players: [
                    { name: data.name, color: data.color, ws, playerIndex: 0 },
                ],
                board: newBoard(),
                status: "waiting",
                currentTurn: 0,
            };
            pool.getConnection((err, conn) => {
                if (err) {
                    console.log("DB conn error (create_room):", err);
                    if (conn) conn.release();
                    return;
                }

                conn.query(
                    "INSERT INTO rooms (code,status,board_str) VALUES (?,?,?)",
                    [roomCode, "waiting", boardToString(rooms[roomCode].board)],
                    (e) => {
                        if (e) console.log("DB insert room error:", e);
                    }
                );

                conn.release(); // ALWAYS release at end of block
            });

            ws.roomCode = roomCode;
            ws.playerIndex = 0;
            ws.send(
                JSON.stringify({
                    type: "room_created",
                    roomCode,
                    playerIndex: 0,
                })
            );
            return;
        }
        if (data.type === "join_room") {
            joinRoom(data, ws);
            return;
        }
        if (data.type === "move") {
            handleMove(data, ws);
            return;
        }

        ws.send(JSON.stringify({ type: "error", reason: "unknown_type" }));
    });

    ws.on("close", () => {
        console.log("WS: client disconnected");
        if (!ws.roomCode) return;

        const room = rooms[ws.roomCode];
        if (!room) return;

        room.players[ws.playerIndex].ws = null;
        room.status = "waiting";

        const otherIdx = ws.playerIndex === 0 ? 1 : 0;
        const other = room.players[otherIdx];
        if (other && other.ws && other.ws.readyState === WebSocket.OPEN) {
            other.ws.send(JSON.stringify({ type: "opponent_left" }));
        }

        delete rooms[ws.roomCode];
    });
});

let server = http.createServer((req, res) => {
    let parsedUrl = url.parse(req.url, true);
    let p = parsedUrl.pathname;

    if (p === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (p === "/") {
        const filePath = path.join(__dirname, "static_files", "index.html");
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("Server up (no index.html found).");
                return;
            }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(data);
        });
        return;
    }

    // Serve static files from static_files directory
    const staticPath = path.join(__dirname, "static_files", p);
    fs.readFile(staticPath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
        }

        // Set appropriate content type based on file extension
        const ext = path.extname(staticPath).toLowerCase();
        let contentType = "text/plain";

        if (ext === ".html") contentType = "text/html";
        else if (ext === ".css") contentType = "text/css";
        else if (ext === ".js") contentType = "application/javascript";
        else if (ext === ".json") contentType = "application/json";

        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    });
});

server.listen(3000, "0.0.0.0", () => {
    console.log("HTTP listening on http://0.0.0.0:3000");
});
