const statusEl = document.getElementById("status");
const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");

let myName = "";
let myColor = "";
let roomCode = "";
let playerIndex = -1;
let currentTurn = 0;

const proto = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${proto}://${location.host}/ws`);

ws.onopen = () => {
    statusEl.textContent = "connected";
};

// prettier-ignore
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log("WS <-", msg);

  if (msg.roomCode) roomCode = msg.roomCode;

  if (msg.type === "error") {
    alert("Error: " + (msg.reason || "unknown"));
  } else if (msg.type === "room_created") {
    playerIndex = 0; 
    statusEl.textContent = "room " + roomCode + " created, waiting for opponent…";
  } else if (msg.type === "waiting_for_opponent") {
    statusEl.textContent = "waiting for opponent…";
  } else if (msg.type === "room_ready") {
    playerIndex = msg.yourIndex;
    currentTurn = msg.currentTurn;
    statusEl.textContent = "room " + roomCode + " ready | you are " + (playerIndex === 0 ? "Red" : "Yellow") + " | " + (currentTurn === playerIndex ? "your turn" : "opponent turn");
    paint(msg.board);
  } else if (msg.type === "state") {
    currentTurn = msg.currentTurn;
    statusEl.textContent = currentTurn === playerIndex ? "your turn" : "opponent turn";
    paint(msg.board);
  } else if (msg.type === "win") {
    statusEl.textContent =
      msg.winner === myName ? "you win" : "you lose, winner: " + msg.winner;
    if (msg.board) paint(msg.board);
  } else if (msg.type === "draw") {
    statusEl.textContent = "draw";
    if (msg.board) paint(msg.board);
  } else if (msg.type === "opponent_left") {
    statusEl.textContent = "opponent left";
  }
};

ws.onerror = () => {
    statusEl.textContent = "error";
};

ws.onclose = () => {
    statusEl.textContent = "disconnected";
};

btnCreate.onclick = () => {
    myName = prompt("name (creator):");
    if (myName === null) return;
    myColor = "red";
    ws.send(
        JSON.stringify({ type: "create_room", name: myName, color: myColor })
    );
    statusEl.textContent = "creating room…";
};

btnJoin.onclick = () => {
    myName = prompt("name (joiner):");
    if (myName === null) return;
    myColor = "yellow";
    const code = prompt("room code:");
    if (code === null) return;
    roomCode = code;
    ws.send(
        JSON.stringify({
            type: "join_room",
            roomCode: roomCode,
            name: myName,
            color: myColor,
        })
    );
    statusEl.textContent = "joining room " + roomCode + "…";
};

const grid = document.getElementById("grid");

const buildGrid = () => {
    grid.innerHTML = "";
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const cell = document.createElement("div");
            cell.style.width = "44px";
            cell.style.height = "44px";
            cell.style.borderRadius = "50%";
            cell.style.background = "#e6ecff";
            cell.dataset.r = row;
            cell.dataset.c = col;
            grid.appendChild(cell);
        }
    }
};

const paint = (board) => {
    let i = 0;
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const cell = grid.children[i++];
            const v = board[row][col];
            cell.style.background =
                v === "red" ? "#d33" : v === "yellow" ? "#cc3" : "#e6ecff";
        }
    }
};

grid.onclick = (e) => {
    const target = e.target;
    if (!target || target.dataset.c === undefined) return;
    if (playerIndex < 0) return;
    if (currentTurn !== playerIndex) return;
    const col = Number(target.dataset.c);
    ws.send(JSON.stringify({ type: "move", roomCode: roomCode, col: col }));
};

buildGrid();
