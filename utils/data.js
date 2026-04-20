// utils/data.js
const fs = require('fs');
const path = require('path');

function loadData(filePath = './data/birthdays.json') {
  try {
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ birthdays: [], servers: {}, whitelistedServers: [], lastSent: {} }, null, 2));
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load data file:', err);
    // return default structure so code can continue
    return { birthdays: [], servers: {}, whitelistedServers: [], lastSent: {} };
  }
}

function saveData(filePath = './data/birthdays.json', data) {
  try {
    // write atomically: write to temp then rename (best-effort)
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    console.error('Failed to save data file:', err);
    throw err;
  }
}

module.exports = { loadData, saveData };
