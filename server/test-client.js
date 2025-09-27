// winner-test.js
const WebSocket = require("ws");
const URL = "ws://127.0.0.1:8080";

function log(tag, x) {
    console.log(`[${tag}]`, typeof x === "string" ? x : JSON.stringify(x));
}
function send(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function makeClient(tag) {
    const ws = new WebSocket(URL);
    ws.tag = tag;
    ws.roomCode = null;
    ws.yourIndex = null;
    ws.queue = []; // סדרת עמודות לשחק
    ws.sentThisTurn = false; // לא שולחים פעמיים באותו תור
    ws.finishedProbeSent = false;

    ws.on("open", () => log(tag, "connected"));

    ws.on("message", (buf) => {
        let msg;
        try {
            msg = JSON.parse(buf.toString());
        } catch {
            log(tag, "non-JSON");
            return;
        }
        log(tag, msg);

        if (msg.type === "room_created") {
            // רק P1 יקבל את זה
            ws.roomCode = msg.roomCode;
        }

        if (msg.type === "room_ready") {
            ws.yourIndex = msg.yourIndex;
            ws.sentThisTurn = false;
            maybePlay(ws, msg.currentTurn);
        }

        if (msg.type === "state") {
            ws.sentThisTurn = false; // תור חדש התחיל
            maybePlay(ws, msg.currentTurn);
        }

        if (msg.type === "win" || msg.type === "draw") {
            scheduleFinishedProbe();
        }

        if (msg.type === "error" && msg.reason === "game_not_active") {
            log(
                "ASSERT",
                "status=finished confirmed (post-finish move blocked)"
            );
            cleanExit();
        }
    });

    ws.on("close", () => log(tag, "closed"));
    ws.on("error", (e) => log(tag, `error: ${e.message}`));
    return ws;
}

function maybePlay(ws, currentTurn) {
    if (ws.yourIndex == null) return;
    if (currentTurn !== ws.yourIndex) return;
    if (ws.sentThisTurn) return;

    // MUST: roomCode חייב להיות קיים לפני שליחת מהלך
    if (!ws.roomCode) return;

    const col = ws.queue.shift();
    if (typeof col !== "number") return;

    send(ws, { type: "move", roomCode: ws.roomCode, col });
    ws.sentThisTurn = true;
}

// אחרי WIN/DRAW ננסה בכוונה לשלוח מהלך נוסף כדי לוודא שהשרת ננעל (finished)
function scheduleFinishedProbe() {
    if (A.finishedProbeSent || B.finishedProbeSent) return;
    A.finishedProbeSent = B.finishedProbeSent = true;
    setTimeout(() => {
        // הפסד לא משנה. מספיק ש*אחד* הלקוחות ינסה; כאן נשתמש ב-B.
        if (B.roomCode) send(B, { type: "move", roomCode: B.roomCode, col: 6 });
        else if (A.roomCode)
            send(A, { type: "move", roomCode: A.roomCode, col: 0 });
    }, 150);
}

function cleanExit() {
    setTimeout(() => {
        try {
            A.close();
        } catch {}
        try {
            B.close();
        } catch {}
        process.exit(0);
    }, 200);
}

// === ריצה ===
const A = makeClient("P1");
const B = makeClient("P2");

// P1 יוצר חדר
A.on("open", () => {
    send(A, { type: "create_room", name: "P1", color: "red" });
});

// כשיש קוד, P2 מצטרף — ושימו לב: נותנים ל-B את roomCode של A לפני כל מהלך
const joinTick = setInterval(() => {
    if (A.roomCode && B.readyState === WebSocket.OPEN) {
        B.roomCode = A.roomCode; // ← התיקון הקריטי!
        send(B, {
            type: "join_room",
            roomCode: B.roomCode,
            name: "P2",
            color: "yellow",
        });
        clearInterval(joinTick);
    }
}, 50);

// רצף מהלכים: P1 מנצח אופקית (0,1,2,3); P2 זורק ב-6 כדי לא לחסום
A.queue = [0, 1, 2, 3];
B.queue = [6, 6, 6];

// timeout בטיחות
setTimeout(() => {
    log("TIMEOUT", "Test took too long without finishing.");
    cleanExit();
}, 8000);
