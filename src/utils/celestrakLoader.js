// src/utils/celestrakLoader.js

/**
 * celestrakLoader
 * ----------------
 * Utility responsible for loading and parsing TLE (Two-Line Element) data.
 *
 * Data source:
 * - Primary: local file served from /public/data/satellites.tle
 *   (generated offline via node scripts/update_tle.js)
 * - Fallback: embedded TLE data (ISS only), used when local file is missing.
 *
 * This approach avoids hitting Celestrak directly from the browser and keeps
 * the app fully offline-capable once TLE data is generated.
 */

// Path to the locally generated TLE file.
// The browser can access files placed in /public via absolute paths.
const DATA_URL = "/data/satellites.tle";

/**
 * Fetch and parse satellite TLE data.
 *
 * @returns {Promise<Array<{id: number, name: string, line1: string, line2: string}>>}
 */
export const fetchSatellites = async () => {
  try {
    console.log(`📂 Loading local satellite data from ${DATA_URL}...`);

    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(
        "Local fetch failed (Did you run 'node scripts/update_tle.js'?)"
      );
    }

    const text = await response.text();
    return parseTLE(text);
  } catch (error) {
    /**
     * If the local file is missing or unreadable, we fall back to a minimal,
     * hardcoded dataset (ISS only). This ensures the app still boots and
     * demonstrates functionality even without external data.
     */
    console.warn(
      "⚠️ Local TLE data missing. Using hardcoded fallback (ISS only).",
      error
    );

    return parseTLE(BACKUP_TLE);
  }
};

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/**
 * Parse raw TLE text into structured satellite objects.
 *
 * Expected format:
 *   Satellite Name
 *   Line 1
 *   Line 2
 *
 * The file is assumed to be clean and aligned in 3-line blocks.
 *
 * @param {string} tleData - Raw TLE file content
 * @returns {Array<{id: number, name: string, line1: string, line2: string}>}
 */
const parseTLE = (tleData) => {
  // Normalize lines: trim whitespace and remove empty rows
  const lines = tleData
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const satellites = [];

  // Iterate in fixed 3-line steps (name + line1 + line2)
  for (let i = 0; i < lines.length; i += 3) {
    if (lines[i] && lines[i + 1] && lines[i + 2]) {
      satellites.push({
        id: i, // stable index-based identifier
        name: lines[i],
        line1: lines[i + 1],
        line2: lines[i + 2],
      });
    }
  }

  return satellites;
};

/**
 * BACKUP_TLE
 * ----------
 * Minimal fallback dataset used when no local TLE file is available.
 * Contains a single, well-known satellite (ISS).
 *
 * This is NOT meant for production accuracy — only for graceful degradation
 * and development/demo scenarios.
 */
const BACKUP_TLE = `
ISS (ZARYA)
1 25544U 98067A   24036.56038380  .00014798  00000-0  26998-3 0  9993
2 25544  51.6401 195.9620 0004567 114.7672 344.9754 15.49651543437637
`;
