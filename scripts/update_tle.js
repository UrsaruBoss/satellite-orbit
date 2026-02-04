// scripts/update_tle.js

/**
 * update_tle.js
 * -------------
 * Offline utility script for downloading fresh TLE (Two-Line Element) data
 * from Celestrak and storing it locally for the frontend application.
 *
 * This script is intended to be run:
 * - manually (local development), or
 * - automatically via GitHub Actions on a daily schedule.
 *
 * Output:
 *   public/data/satellites.tle
 *
 * Notes:
 * - The frontend never fetches Celestrak directly.
 * - This ensures offline demos, reproducibility, and no API rate limits.
 */

import fs from "fs";
import fetch from "node-fetch"; // Requires: npm install node-fetch

// Celestrak source: visual satellites group
const CELESTRAK_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle";

// Output file consumed by the frontend
const OUTPUT_FILE = "./public/data/satellites.tle";

/**
 * Download and persist TLE data.
 * Exits with non-zero code on failure so CI/CD pipelines can detect errors.
 */
async function downloadTLE() {
  console.log("Starting TLE download from Celestrak...");

  try {
    const response = await fetch(CELESTRAK_URL);

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.text();

    /**
     * Basic sanity check:
     * - Ensures we received actual TLE data, not an HTML error page.
     * - ISS is used as a known reference satellite.
     */
    if (!data.includes("ISS (ZARYA)")) {
      throw new Error("Invalid or empty TLE dataset received");
    }

    // Ensure output directory exists
    fs.mkdirSync("./public/data", { recursive: true });

    fs.writeFileSync(OUTPUT_FILE, data, "utf-8");

    console.log(
      `TLE update successful. Saved ${data.length} bytes to ${OUTPUT_FILE}`
    );
  } catch (error) {
    /**
     * Fail hard:
     * - GitHub Actions will mark the workflow as failed.
     * - Prevents silently committing broken or empty datasets.
     */
    console.error("TLE update failed:", error.message);
    process.exit(1);
  }
}

// Execute script
downloadTLE();
