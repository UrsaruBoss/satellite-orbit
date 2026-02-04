// scripts/update_tle.js
import fs from 'fs';
import fetch from 'node-fetch'; // Trebuie instalat: npm install node-fetch

const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle';
const OUTPUT_FILE = './public/data/satellites.tle';

async function downloadTLE() {
  console.log('🛰️ Starting TLE download...');
  try {
    const response = await fetch(CELESTRAK_URL);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    
    const data = await response.text();
    
    // Verificăm dacă am primit date valide (nu HTML de eroare)
    if (data.includes('ISS (ZARYA)')) {
        fs.writeFileSync(OUTPUT_FILE, data);
        console.log(`✅ Success! Saved ${data.length} bytes to ${OUTPUT_FILE}`);
    } else {
        throw new Error('Invalid data received');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1); // Ieșim cu eroare ca să ne notifice GitHub
  }
}

downloadTLE();