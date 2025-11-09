require('dotenv').config();
const express = require('express');
const cors = require('cors');
const allRoutes = require('./routes');
const db = require('./db.js');
const { initializeFirebase } = require('./routes/firebaseAdmin.js');

const app = express();

// Initialize Firebase Admin SDK
initializeFirebase();

// Ensure DB schema is ready (add missing columns if needed)
const { ensureSchema } = require('./schema.js');
(async () => { try { await ensureSchema(); } catch (e) { console.error('Schema init error:', e); } })();

// --- CORS Configuration ---
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://qrs.qssun.solar',
  'http://localhost',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4176',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:4173',
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost'
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // mobile/webview or same-origin
  if (allowedOrigins.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    // Allow localhost on any port
    if (/^https?:$/.test(protocol)) {
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      // Allow any Render app domain
      if (hostname.endsWith('.onrender.com')) return true;
      // Allow qssun.solar root and subdomains
      if (hostname.endsWith('qssun.solar')) return true;
    }
    return false;
  } catch {
    // Non-HTTP origins for hybrid apps
    return origin === 'capacitor://localhost' || origin === 'ionic://localhost';
  }
}

const corsOptions = {
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  // Explicitly allow custom headers used by the frontend
  allowedHeaders: [
    'Content-Type',
    'X-User-Id',
    'X-User-Role',
    'Authorization',
    'Accept',
    'Origin',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Health Check Endpoint ---
app.get('/api/health', async (req, res) => {
    const dbStatus = await db.testConnection();
    if (dbStatus.status === 'ok') {
        res.status(200).json({ status: 'ok', message: 'Server is running.', database: dbStatus });
    } else {
        res.status(503).json({ status: 'error', message: 'Server is running, but database connection is failing.', database: dbStatus });
    }
});

// --- Routes ---
app.use('/api', allRoutes);

// --- Root Route ---
app.get('/', (req, res) => {
  res.send('Qssun Reports API is running!');
});

// --- Global Error Handling ---
app.use((err, req, res, next) => {
    console.error('--- UNHANDLED ERROR ---');
    console.error(err.stack);
    res.status(500).json({ 
        message: 'An unexpected internal server error occurred.',
    });
});

// --- Port Binding for Render ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`âœ… Server is listening on http://0.0.0.0:${PORT}`);
  console.log(`ًںŒگ Allowed Origins: ${allowedOrigins.join(', ')}`);
});

