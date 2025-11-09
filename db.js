const mysql = require('mysql2/promise');

// This configuration is now more robust for cloud hosting like Render.
// It prioritizes the standard DATABASE_URL if available.
const connectionOptions = process.env.DATABASE_URL 
  ? { uri: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };

const pool = mysql.createPool({
  ...connectionOptions,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  // SSL is often required for external connections to cloud databases (like Render).
  // `rejectUnauthorized: false` is a common setting to allow connections without a specific CA file.
  ssl: {
    rejectUnauthorized: false
  }
});

console.log('Database connection pool configured with SSL support.');
if (process.env.DATABASE_URL) {
  console.log('Attempting connection using DATABASE_URL.');
} else {
  console.log('Attempting connection using individual DB environment variables.');
}

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