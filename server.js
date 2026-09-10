const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
const server = http.createServer(app);

// Configure Socket.io with CORS enabled so your Python app can connect externally
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 1. Dynamic MongoDB Connection via Render Environment Variables
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatdb';
mongoose.connect(mongoURI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Database Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

const User2 = mongoose.model('User2', userSchema);
const onlineUsers = new Map();

// 3. HTTP REST API Endpoints
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user2 = new User2({ username, password: hashedPassword });
    await user2.save();
    
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Username might already exist' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user2 = await User2.findOne({ username });
    if (!user2) return res.status(400).json({ error: 'Invalid username or password' });

    const isMatch = await bcrypt.compare(password, user2.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid username or password' });

    res.status(200).json({ message: 'Login successful', username });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 4. Socket.io Real-Time Event Handlers
io.on('connection', (socket) => {
  socket.on('identify', (username) => {
    socket.username = username;
    onlineUsers.set(username, socket.id);
    console.log(`User registered: ${username}`);
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
    }
  });
});

// 5. Render-specific Port Binding
// Render binds to port 10000 by default, provided dynamically via process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
