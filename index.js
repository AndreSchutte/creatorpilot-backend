require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Models
const Transcript = require('./models/Transcript');
const User = require('./models/User');

// Middleware
const requireAuth = require('./middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again in a minute.' },
});
app.use(limiter);

// MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB error:', err));

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Registration
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

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: 'Login error', error: err.message });
  }
});

// Generate Chapters (protected)
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
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Start
app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3001}`);
});
