const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json()); // Essential for parsing Python json={} requests
const server = http.createServer(app);

// Enable CORS so your external Python app can connect seamlessly to Render
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 1. Connect to MongoDB Atlas via your Render environment variable
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
  console.error("CRITICAL ERROR: MONGODB_URI environment variable is missing!");
  process.exit(1);
}

mongoose.connect(mongoURI)
  .then(() => console.log('Connected to MongoDB Atlas successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Database Schema (Bypassing strict unique indexes to avoid caching bugs)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String, required: true }
}, { collection: 'unified_chat_users' }); // Explicit collection name

const User = mongoose.model('User', userSchema);
const onlineUsers = new Map(); // Tracks { username: socketId }

// 3. HTTP Endpoints
// REGISTRATION
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password fields are required' });
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    // Custom check instead of relying on broken database indexes
    const existingUser = await User.findOne({ username: cleanUsername });
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);
    const user = new User({ username: cleanUsername, password: hashedPassword });
    await user.save();
    
    console.log(`[Backend Log] User registered successfully: "${cleanUsername}"`);
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('[Registration Failure]', error);
    res.status(500).json({ error: 'Internal server registration error' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials (User not found)' });
    }

    const isMatch = await bcrypt.compare(cleanPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials (Password mismatch)' });
    }

    res.status(200).json({ message: 'Login successful', username: cleanUsername });
  } catch (error) {
    console.error('[Login Failure]', error);
    res.status(500).json({ error: 'Internal server login error' });
  }
});

// 4. Real-Time WebSockets Engine
io.on('connection', (socket) => {
  socket.on('identify', (username) => {
    socket.username = username;
    onlineUsers.set(username, socket.id);
    console.log(`[Socket Connected] User: ${username}`);
  });

  socket.on('private_message', ({ recipient, message }) => {
    const recipientSocketId = onlineUsers.get(recipient);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('msg_receive', {
        sender: socket.username,
        message: message
      });
    } else {
      socket.emit('msg_error', { error: `User ${recipient} is offline.` });
    }
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      console.log(`[Socket Disconnected] User: ${socket.username}`);
    }
  });
});

// 5. Host Binding for Render Cloud
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server executing safely on port ${PORT}`));
