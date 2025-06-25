const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGIN = "https://chat-frontendskillbarracks.netlify.app";

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});


app.use(express.json()); // For parsing JSON bodies

// 1. Serve static files in /uploads
const UPLOADS_FOLDER = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_FOLDER)) {
  fs.mkdirSync(UPLOADS_FOLDER); // Create uploads folder if it doesn't exist
}
app.use('/uploads', express.static(UPLOADS_FOLDER));

// 2. Set up Multer for image upload handling
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, ''));
  }
});
const upload = multer({ storage: storage });

// 3. Image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // The frontend will receive this path
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

app.get('/', (req, res) => {
  res.send("Server is running");
});

// 4. Chat logic (with NO LINKS in promotions restriction)
const HISTORY_FILE = path.join(__dirname, 'messages.json');
let roomMessages = {};
if (fs.existsSync(HISTORY_FILE)) {
  roomMessages = JSON.parse(fs.readFileSync(HISTORY_FILE));
}
const saveMessages = () => {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(roomMessages, null, 2));
};

io.on('connection', (socket) => {
  console.log(`⚡: User connected ${socket.id}`);
  socket.currentRoom = null;

  socket.on('join room', (room) => {
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
    }
    socket.currentRoom = room;
    socket.join(room);
    console.log(`🛏️: ${socket.id} joined room ${room}`);

    if (!roomMessages[room]) {
      roomMessages[room] = [];
    }
    socket.emit('chat history', roomMessages[room]);
  });

socket.on('chat message', (msg) => {
  const targetRoom = msg.room || socket.currentRoom;
  if (!targetRoom) return;

  // Universal link detector: http, https, www., or anything.something
  const linkRegex = /(?:https?:\/\/|www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})(\/\S*)?/gi;

  if (targetRoom === 'promotion' && linkRegex.test(msg.text)) {
    console.log('LINK DETECTED AND BLOCKED:', msg.text);
    socket.emit('error-message', 'No links are allowed in the Promotion chat!');
    return; // Block message
  }

  roomMessages[targetRoom] = roomMessages[targetRoom] || [];
  roomMessages[targetRoom].push(msg);

  if (roomMessages[targetRoom].length > 100) {
    roomMessages[targetRoom].shift();
  }

  saveMessages();

  console.log(`📤 [${targetRoom}] Broadcasting message:`);
  console.log(JSON.stringify(msg, null, 2));

  io.to(targetRoom).emit('chat message', msg);
});




  socket.on('disconnect', () => {
    console.log(`🔥: User disconnected ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
