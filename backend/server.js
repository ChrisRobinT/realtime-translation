const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
require("dotenv").config();

console.log("ENV CHECK → OPENAI_API_KEY =", JSON.stringify(process.env.OPENAI_API_KEY));
console.log("ENV CHECK → ELEVENLABS_API_KEY =", JSON.stringify(process.env.ELEVENLABS_API_KEY?.substring(0, 20) + "..."));


const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // where incoming audio chunks temporarily go

const TranslationService = require("./translationService");
const translationService = new TranslationService();

const fs = require("fs").promises;

const app = express();
const server = http.createServer(app);

// ---------------------------
// CORS + Socket.io
// ---------------------------
const FRONTENDS = [
  "https://realtime-translation-gules.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: FRONTENDS,
    credentials: true,
  })
);

const io = socketIo(server, {
  cors: {
    origin: FRONTENDS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ---------------------------
// TEST ENDPOINT
// ---------------------------
app.get("/", (req, res) => {
  res.json({ status: "WebRTC Signaling Server Running" });
});

// ---------------------------
// TRANSLATION ENDPOINT
// ---------------------------
app.post("/translate-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided." });
    }

    const inputFile = req.file.path;
    const sourceLang = normalizeLang(req.body.source_lang || "en");
    const targetLang = normalizeLang(req.body.target_lang || "es");

    console.log(`🎧 Received audio file: ${inputFile}`);
    console.log(`🌍 Source: ${sourceLang} → Target: ${targetLang}`);

    // Run the full translation pipeline
    const outputFile = await translationService.fullPipeline(
      inputFile,
      sourceLang,
      targetLang
    );

    if (!outputFile) {
      console.log("❌ Pipeline returned empty file.");
      await safeDelete(inputFile);
      return res.status(500).json({ error: "Translation failed" });
    }

    // Read MP3 and return to frontend
    const audioBuffer = await fs.readFile(outputFile);

    // Cleanup temp files
    await safeDelete(inputFile);
    await safeDelete(outputFile);

    res.set("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    console.error("❌ /translate-audio ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helper to avoid crashes on delete
async function safeDelete(path) {
  try {
    await fs.unlink(path);
  } catch (err) {
    // ignore
  }
}

// Normalize languages coming from the frontend
function normalizeLang(lang) {
  if (!lang) return "en";

  lang = lang.toLowerCase();

  // Whisper uses ISO639-1 codes (et, en, es, fr, de...)
  // Azure translator uses same codes (except Chinese)
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("et")) return "et";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("ru")) return "ru";

  return lang; // fallback
}

// ---------------------------
// SOCKET.IO — WebRTC signaling
// ---------------------------
const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on("join-room", ({ roomId, clientId }) => {
    socket.join(roomId);
    socket.clientId = clientId;
    socket.roomId = roomId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());

    const room = rooms.get(roomId);
    const peers = Array.from(room.keys());

    room.set(clientId, socket.id);

    console.log(`👤 ${clientId} joined ${roomId}. Total peers: ${room.size}`);

    // If someone is already there → tell the new guy to initiate
    if (peers.length > 0) {
      const peerToCall = peers[0];
      socket.emit("initiate-call", { peerId: peerToCall });

      const peerSocketId = room.get(peerToCall);
      io.to(peerSocketId).emit("peer-joined", { peerId: clientId });
    }
  });

  socket.on("offer", (data) => {
    forwardSignal(socket, data.target, "offer", data.offer);
  });

  socket.on("answer", (data) => {
    forwardSignal(socket, data.target, "answer", data.answer);
  });

  socket.on("ice-candidate", (data) => {
    forwardSignal(socket, data.target, "ice-candidate", data.candidate);
  });

  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);

    const { roomId, clientId } = socket;
    if (!roomId || !clientId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.delete(clientId);

    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`🗑 Room ${roomId} removed (empty)`);
    }

    socket.to(roomId).emit("peer-left", { peerId: clientId });
  });
});

// Helper to forward WebRTC offers/answers/candidates
function forwardSignal(socket, targetClientId, type, payload) {
  const room = rooms.get(socket.roomId);
  if (!room) return;

  const targetSocketId = room.get(targetClientId);
  if (!targetSocketId) {
    console.log(`⚠️ Target client ${targetClientId} not found for ${type}`);
    return;
  }

  io.to(targetSocketId).emit(type, {
    from: socket.clientId,
    [type === "ice-candidate" ? "candidate" : type]: payload,
  });
}

// ---------------------------
// START SERVER
// ---------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});