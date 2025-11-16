const fs = require('fs');
const path = require('path');

const SERIALS_DIR = path.join(__dirname, 'serials');
const FIXED_PREFIX = 'القصيم';

function ensureDir() {
  if (!fs.existsSync(SERIALS_DIR)) {
    fs.mkdirSync(SERIALS_DIR, { recursive: true });
  }
}

function formatDate8(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function getSerialFilePath(date8) {
  return path.join(SERIALS_DIR, `${date8}.txt`);
}

function getDailySerial() {
  ensureDir();
  const date8 = formatDate8();
  const filePath = getSerialFilePath(date8);
  let last = 0;
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      const n = Number(raw);
      if (!Number.isNaN(n) && n >= 0) last = n;
    } catch {}
  }
  const next = last + 1;
  const padded = String(next).padStart(3, '0');
  fs.writeFileSync(filePath, String(next), 'utf8');
  return `${FIXED_PREFIX}${date8}${padded}`;
}

module.exports = { getDailySerial, FIXED_PREFIX };
