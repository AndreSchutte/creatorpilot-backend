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
const requireAdmin = require('./middleware/admin');

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

    await User.create({ email, password }); // the schema will hash it automatically


    // Optional: Auto-login after registration
    const user = await User.findOne({ email });
    const token = jwt.sign(
      {
        userId: user._id,
        isAdmin: user.isAdmin || false,
        isOwner: user.isOwner || false,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token }); // ✅ Respond with token
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
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      {
        userId: user._id,
        isAdmin: user.isAdmin || false,
        isOwner: user.isOwner || false, // ✅ ADD THIS
      },
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

// 📜 Get transcript history (NEW)
app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const history = await Transcript.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .select('text format result createdAt');
    res.json(history);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch transcript history' });
  }
});

// 👑 Admin-only: View all users
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error('Admin fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// 🔁 Owner-only: Toggle admin role
app.put('/api/admin/toggle-admin/:userId', requireAuth, async (req, res) => {
  try {
    const requestingUser = await User.findById(req.user.userId);

    if (!requestingUser?.isOwner) {
      return res.status(403).json({ error: 'Forbidden: Only owner can manage admin roles' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent changing the owner's own status or another owner's
    if (user.isOwner) {
      return res.status(403).json({ error: 'Cannot change owner privileges' });
    }

    user.isAdmin = !user.isAdmin;
    await user.save();

    res.json({ message: 'User role updated', user });
  } catch (err) {
    console.error('Toggle admin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ❌ Delete a transcript (authenticated)
app.delete('/api/transcripts/:id', requireAuth, async (req, res) => {
  try {
    const transcript = await Transcript.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found or unauthorized' });
    }

    res.json({ message: 'Transcript deleted' });
  } catch (err) {
    console.error('Delete transcript error:', err);
    res.status(500).json({ message: 'Failed to delete transcript' });
  }
});

// ❌ Delete transcript by ID (protected)
app.delete('/api/history/:id', requireAuth, async (req, res) => {
  try {
    const transcript = await Transcript.findOne({
      _id: req.params.id,
      userId: req.user.userId, // ensure user owns it
    });

    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found' });
    }

    await Transcript.findByIdAndDelete(transcript._id);
    res.json({ message: 'Transcript deleted successfully' });
  } catch (err) {
    console.error('❌ Delete error:', err);
    res.status(500).json({ message: 'Failed to delete transcript' });
  }
});

// 👤 Get user profile
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 📝 Update user profile
app.put('/api/profile', requireAuth, async (req, res) => {
  const { name, bio } = req.body;
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.name = name;
    user.bio = bio;
    await user.save();

    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 📝 Generate YouTube Titles from Transcript
app.post('/api/generate-titles', requireAuth, async (req, res) => {
  const { transcript } = req.body;

  if (!transcript || transcript.trim().length < 20) {
    return res.status(400).json({ error: 'Transcript is too short or missing.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a creative assistant that generates 5 catchy YouTube video titles based on transcripts.'
        },
        {
          role: 'user',
          content: `Transcript:\n${transcript}`
        }
      ]
    });

    const titles = completion.choices[0].message.content;
    res.json({ titles });
  } catch (err) {
    console.error('Generate titles error:', err);
    res.status(500).json({ error: 'Failed to generate titles' });
  }
});

// 🚀 Start Server
app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3001}`);
});
