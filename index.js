const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });


const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGIN = "https://chat-frontendskillbarracks.netlify.app";

const allowedOrigins = [
  "https://chat-frontendskillbarracks.netlify.app",
  "https://skillbarracks.com" // <-- change to your real WordPress domain
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"],
  credentials: true
}));


const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
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


io.on('connection', (socket) => {
  console.log(`⚡: User connected ${socket.id}`);
  socket.currentRoom = null;

  // 1. Join room: fetch history from Neon
  socket.on('join room', async (room) => {
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
    }
    socket.currentRoom = room;
    socket.join(room);
    console.log(`🛏️: ${socket.id} joined room ${room}`);

    try {
      // Fetch last 100 messages for this room, oldest first
      const { rows } = await pool.query(
        'SELECT * FROM messages WHERE room = $1 ORDER BY id ASC LIMIT 100',
        [room]
      );
      socket.emit('chat history', rows);
    } catch (err) {
      console.error('Error fetching messages:', err);
      socket.emit('chat history', []);
    }
  });

  // 2. Handle chat message: save to Neon and broadcast
  socket.on('chat message', async (msg) => {
    const targetRoom = msg.room || socket.currentRoom;
    if (!targetRoom) return;

    // Universal link detector: http, https, www., or anything.something
    const linkRegex = /(?:https?:\/\/|www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})(\/\S*)?/gi;

    if (targetRoom === 'promotion' && linkRegex.test(msg.text)) {
      console.log('LINK DETECTED AND BLOCKED:', msg.text);
      socket.emit('error-message', 'No links are allowed in the Promotion chat!');
      return;
    }

    try {
      await pool.query(
        'INSERT INTO messages (room, username, text, image, time, date) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          targetRoom,
          msg.username,
          msg.text,
          msg.image,
          msg.time,
          msg.date
        ]
      );
      io.to(targetRoom).emit('chat message', msg);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔥: User disconnected ${socket.id}`);
  });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
