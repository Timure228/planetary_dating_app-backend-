const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.cloud_name,
  api_key: process.env.api_key,
  api_secret: process.env.api_secret
});

const app = express();

// Middlewares
app.use(cors());          // Allows your React app to talk to this backend
app.use(express.json());  // Allows the server to read JSON sent from React

// Connect to your PostgreSQL database using your credentials
const pool = new Pool({
  connectionString: process.env.connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

const JWT_SECRET = "dDkf3*_j4r41!*89De_1" 

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) return res.status(401).json({error: "Access denied. Log in first."})
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({error: "Invalid session. Log in again."})
    req.user = user;
    next();
  })
}

app.get('/api/card-profile', authenticateToken, async (req, res) => {
  try {
    const current_user = req.user.username;
    const query = `
      SELECT p.username, p.age, p.bio, p.interested_in, p.image_url, p.city 
      FROM profiles p 
      WHERE p.username != $1 
      AND p.username NOT IN (SELECT swiped_on_username FROM swipes WHERE swiper_username = $1)
      ORDER BY RANDOM() LIMIT 1;
    `;
    const { rows } = await pool.query(query, [current_user]);
    if (rows.length === 0) return res.status(404).json({error: "No new profiles left!"})
    res.json(rows[0]); // Sends the data object to React
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get('/api/likes', authenticateToken, async (req, res) => {
  try {
    const current_user = req.user.username;
    const query = `
      SELECT 
      s.swiper_username,
      p.image_url
      FROM swipes s
      JOIN profiles p 
      ON s.swiper_username = p.username
      WHERE s.swiped_on_username = $1 AND s.action = 'like';
    `;
    const { rows } = await pool.query(query, [current_user]);
    res.json(rows); // Sends the data object to React
  } catch (err) {
    console.error(err);
  }
});

app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    const current_user = req.user.username;
    const query = `
      SELECT 
      m.message_sender,
      m.message,
      p.image_url
      FROM messages m
      JOIN profiles p 
      ON m.message_sender = p.username
      m.message_receiver = $1
      ORDER BY m.created_at ASC
    `;
    const { rows } = await pool.query(query, [current_user]);
    res.json(rows); // Sends the data object to React
  } catch (err) {
    console.error(err);
  }
}); 

// Configure Multer to control where and how files are saved
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Crucial: Manually create an 'uploads' folder in your backend root directory!
  },
  filename: (req, file, cb) => {
    // Generates a unique filename using timestamps to prevent overwrites
    cb(null, file.originalname);
  },
});

const upload = multer({ storage: multer.memoryStorage() });

// The API endpoint to post new data
app.post('/api/register', upload.single('image_file'), async (req, res) => {
  const { username, password, age, gender, city, interested_in, bio } = req.body;
  
  const hashedPassword = await bcrypt.hash(password, 10);

  const cloudinaryResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'profile_photos' },
      (error, result) => error ? reject(error) : resolve(result)
   );
   stream.end(req.file.buffer);
  });
  const image_name = cloudinaryResult.secure_url;

  const query = 'INSERT INTO profiles (username, password, age, gender, city, interested_in, bio, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *';
  const values = [username, hashedPassword, age, gender, city, interested_in, bio, image_name];

  const result = await pool.query(query, values);
  res.status(201).json({ message: 'Profile created!', profile: result.rows[0] });
})

app.post('/api/login', async (req, res) => {
  const {username, password} = req.body;

  const result = await pool.query('SELECT * FROM PROFILES WHERE username = $1', [username]);
  if (result.rows.length === 0) return res.status(400).json({error: "Wrong Username. Try again or sign up."});
  
  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(400).json({error: "Wrong password. Try again."});
    
  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: "1d" });
  res.json({message: "Logged in!", token, username: user.username, image_url: user.image_url});
})

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.post('/api/swipe', authenticateToken, async (req, res) => 
  {
    const swiper_username = req.user.username;
    const {swiped_on_username, action} = req.body;

    const query = `
      INSERT INTO swipes (swiper_username, swiped_on_username, action) 
      VALUES ($1, $2, $3) 
      RETURNING *;
    `;
    const values = [swiper_username, swiped_on_username, action];

    const result = await pool.query(query, values);

    res.status(201).json({ 
      message: 'Swipe successfully saved!', 
      swipe: result.rows[0] 
    });
  }
) 

app.post('/api/message', authenticateToken, async (req, res) => 
  {
    const message_sender = req.user.username;
    const {message_receiver, message} = req.body;

    const query = `
      INSERT INTO messages (message_sender, message_receiver, message) 
      VALUES ($1, $2, $3) 
      RETURNING *;
    `;
    const values = [message_sender, message_receiver, message];

    const result = await pool.query(query, values);

    res.status(201).json({ 
      message: 'Message sent successfully!',  
    });
  }
) 

// Fire up the backend on port 5000
app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
