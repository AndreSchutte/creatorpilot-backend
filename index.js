require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Models
const Transcript = require('./models/Transcript');
const User = require('./models/User');

// Middleware
const requireAuth = require('./middleware/auth');
const requireAdmin = require('./middleware/admin'); // 👑 Admin middleware

const app = express();

// Middleware setup
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again in a minute.' },
});
app.use(limiter);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((err) => console.error('❌ MongoDB error:', err));

mongoose.connection.once('open', () => {
  console.log('✅ MongoDB connected');
});

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔐 Register
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });

    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(500).json({ message: 'Register error', error: err.message });
  }
});

// 🔑 Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('📩 Login attempt for:', email);

  try {
    const user = await User.findOne({ email });

    if (!user) {
      console.log('❌ User not found');
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log('❌ Password mismatch for user:', email);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, isAdmin: user.isAdmin || false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ Login successful for:', email);
    res.json({ token });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ message: 'Login error', error: err.message });
  }
});

// 📚 Generate Chapters (protected)
app.post('/api/generate-chapters', requireAuth, async (req, res) => {
  const { transcript, format } = req.body;

  try {
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that generates YouTube chapters in ${format} format.`,
        },
        {
          role: 'user',
          content: `Transcript:\n${transcript}`,
        },
      ],
      model: 'gpt-3.5-turbo',
    });

    const result = chatCompletion.choices[0].message.content;

    await Transcript.create({
      text: transcript,
      format,
      result,
      userId: req.user.userId,
    });

    res.json({ chapters: result });
  } catch (error) {
    console.error('Chapter generation error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// 📜 Get transcript history for logged-in user
app.get('/api/transcripts', requireAuth, async (req, res) => {
  try {
    const transcripts = await Transcript.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.json(transcripts);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch transcript history' });
  }
});

// 👑 Admin-only route: View all users
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error('Admin fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// 🔁 Admin: Toggle admin role
app.put('/api/admin/toggle-admin/:userId', requireAuth, async (req, res) => {
  try {
    const requestingUser = await User.findById(req.user.userId);
    if (!requestingUser?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admins only' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.isAdmin = !user.isAdmin;
    await user.save();

    res.json({ message: `User updated`, user });
  } catch (err) {
    console.error('Toggle admin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🚀 Start Server
app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3001}`);
});
