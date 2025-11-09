require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
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
    connectionLimit: 5,
    queueLimit: 0,
    dateStrings: true,
    ssl: { rejectUnauthorized: false },
  });

  const targetTable = 'users';
  const targetColumn = 'role';
  const defaultValue = 'employee';
  const neededValues = ['team_lead'];

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.ping();
    console.log('Connected to DB.');

    const dbName = process.env.DB_NAME || (process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace('/', '') : null);
    if (!dbName) {
      throw new Error('Cannot determine database name (DB_NAME or DATABASE_URL required).');
    }

    const [rows] = await conn.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [dbName, targetTable, targetColumn]
    );

    if (rows.length === 0) {
      throw new Error(`Column ${targetTable}.${targetColumn} not found in schema ${dbName}.`);
    }

    const columnType = rows[0].COLUMN_TYPE;
    console.log('Current COLUMN_TYPE:', columnType);

    const match = columnType.match(/^enum\((.*)\)$/i);
    if (!match) {
      console.log(`Column ${targetTable}.${targetColumn} is not ENUM. Skipping.`);
      process.exit(0);
    }

    const currentValues = match[1]
      .split(',')
      .map(s => s.trim().replace(/^'|"|\\'|\\"|\s+|\s+$/g, ''))
      .map(s => s.replace(/^'|^"|\'$|\"$/g, ''))
      .map(s => s.replace(/^'|^"|\'$|\"$/g, ''));

    const missing = neededValues.filter(v => !currentValues.includes(v));
    if (missing.length === 0) {
      console.log('No missing ENUM values. Nothing to do.');
      process.exit(0);
    }

    const newEnumValues = Array.from(new Set([...currentValues, ...missing]));
    const enumSqlList = newEnumValues.map(v => '\'' + v + '\'').join(',');
    const alterSql = 'ALTER TABLE `' + targetTable + '` MODIFY `' + targetColumn + '` ENUM(' + enumSqlList + ') NOT NULL DEFAULT \'' + defaultValue + '\'';

    console.log('Altering ENUM to:', alterSql);
    await conn.query(alterSql);

    console.log('ENUM updated successfully. New values:', newEnumValues);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
})();
