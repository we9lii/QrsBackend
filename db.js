const mysql = require('mysql2/promise');

// Helper to detect if a host string is an IPv4/IPv6 address
function isIpAddress(host) {
  if (!host) return false;
  const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  const ipv6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv4.test(host) || ipv6.test(host);
}

// Prefer DATABASE_URL if available, otherwise fall back to discrete env vars
let connectionOptions;
let resolvedHost;
if (process.env.DATABASE_URL) {
  connectionOptions = { uri: process.env.DATABASE_URL };
  try {
    const url = new URL(process.env.DATABASE_URL);
    resolvedHost = url.hostname; // hostname (without port)
  } catch (e) {
    console.warn('Warning: Failed to parse DATABASE_URL for hostname detection:', e.message);
  }
} else {
  connectionOptions = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
  resolvedHost = process.env.DB_HOST;
}

// Configure SSL/TLS options safely. Render/external MySQL often requires TLS.
// Node's TLS forbids setting SNI servername to an IP address. To avoid the error,
// we override servername when host is an IP.
let sslOption = undefined;
const envWantsSsl = (process.env.DB_SSL || '').toLowerCase();
if (envWantsSsl === 'false' || envWantsSsl === '0' || envWantsSsl === 'off') {
  sslOption = false; // explicitly disable TLS
} else {
  sslOption = { rejectUnauthorized: false };
  // If host is IP, override servername with a safe value (e.g., 'localhost' or custom)
  if (isIpAddress(resolvedHost)) {
    sslOption.servername = process.env.DB_SSL_SERVERNAME || 'localhost';
  }
}

const pool = mysql.createPool({
  ...connectionOptions,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  ssl: sslOption
});

console.log('Database connection pool configured.', {
  ssl: sslOption ? { rejectUnauthorized: sslOption.rejectUnauthorized, servername: sslOption.servername || null } : false,
  via: process.env.DATABASE_URL ? 'DATABASE_URL' : 'env vars',
  host: resolvedHost || null,
});

// Attach a connection test function to the pool object.
pool.testConnection = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log('Database connection test successful.');
    return { status: 'ok', message: 'Database connection successful.' };
  } catch (error) {
    console.error('Database connection test failed:', error);
    return { status: 'error', message: 'Database connection failed.', error: error.message };
  } finally {
    if (connection) connection.release();
  }
};

module.exports = pool;