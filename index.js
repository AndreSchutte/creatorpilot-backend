require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');

// MongoDB Model
const Transcript = require('./Transcript');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rate Limiter
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many requests, please try again in a minute.',
  },
});
app.use(limiter);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Endpoint
app.post('/api/generate-chapters', async (req, res) => {
  const { transcript, format } = req.body;

  try {
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that generates YouTube chapters. Format the output as requested: ${format}`,
        },
        {
          role: 'user',
          content: `Transcript:\n${transcript}\n\nGenerate chapters in ${format} format.`,
        },
      ],
      model: 'gpt-3.5-turbo',
    });

    const data = chatCompletion.choices[0].message.content;

    // Save transcript to MongoDB
    await Transcript.create({
      text: transcript,
      format,
      result: data || 'No chapters returned',
    });

    res.json({ chapters: data });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Start server
app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Backend is running at http://localhost:${process.env.PORT || 3001}`);
});
