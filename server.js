const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);

// 1. MongoDB Connection
// Change connection string if your MongoDB is hosted elsewhere
mongoose.connect('mongodb://localhost:27017/chatdb')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. Database Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

// Memory map to track connected users: { username: socketId }
const onlineUsers = new Map();

// 3. HTTP REST API Endpoints
// Register User
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Username might already exist' });
  }
});

// Login User
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid username or password' });

    res.status(200).json({ message: 'Login successful', username });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 4. Socket.io Real-Time Event Handlers
io.on('connection', (socket) => {
  
  // Register the user to the socket network upon authentication
  socket.on('identify', (username) => {
    socket.username = username;
    onlineUsers.set(username, socket.id);
    console.log(`User registered: ${username} (${socket.id})`);
  });

  // Handle Private Messaging
  socket.on('private_message', ({ recipient, message }) => {
    const recipientSocketId = onlineUsers.get(recipient);
    
    if (recipientSocketId) {
      // Send message to recipient
      io.to(recipientSocketId).emit('msg_receive', {
        sender: socket.username,
        message: message
      });
    } else {
      // Notify sender if the recipient is offline
      socket.emit('msg_error', { error: `User ${recipient} is offline or doesn't exist.` });
    }
  });

  // Handle Disconnections
  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      console.log(`User disconnected: ${socket.username}`);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
