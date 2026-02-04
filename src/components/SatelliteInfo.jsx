import React, { useMemo } from "react";

/**
 * SatelliteInfo
 * -------------
 * Side HUD panel that displays metadata & live telemetry for the currently selected satellite.
 *
 * Input:
 *  - data: object | null
 *      Expected fields (when available):
 *        name, satId, designator,
 *        height (km), velocity (km/h), latitude, longitude,
 *        period (min), tleAgeDays (number)
 *
 * Behavior:
 *  - If no satellite is selected (data=null), renders an "idle / no lock" state.
 *  - If data is present, computes a small "health" UI based on TLE data age.
 */
const SatelliteInfo = ({ data }) => {
  /**
   * Derive UI state from incoming satellite data.
   * - We keep this memoized because the panel re-renders frequently.
   * - The derived state includes: TLE freshness (label, color, normalized pct) and a status badge.
   */
  const ui = useMemo(() => {
    // --- EMPTY / NO SELECTION FALLBACK ---
    if (!data) {
      return {
        tle: { days: null, label: "N/A", color: "#ff4444", pct: 0 },
        status: { text: "NO SIGNAL", color: "#ff4444", bg: "rgba(255, 68, 68, 0.1)" },
      };
    }

    /**
     * TLE AGE:
     * tleAgeDays is the "staleness" of the orbital elements.
     * Fresh TLE data gives more accurate position propagation; old data reduces confidence.
     */
    const tleDaysRaw = typeof data.tleAgeDays === "number" ? data.tleAgeDays : null;

    // Default UI values if TLE age is missing/invalid
    let tleLabel = "N/A";
    let tleColor = "#ff4444";

    // Map TLE age thresholds to visual labels + colors (HUD semantics)
    if (tleDaysRaw !== null) {
      if (tleDaysRaw < 3) {
        tleLabel = "FRESH";
        tleColor = "#00ff9d"; // green-ish cyan
      } else if (tleDaysRaw < 14) {
        tleLabel = "STABLE";
        tleColor = "#00ccff"; // blue
      } else if (tleDaysRaw < 30) {
        tleLabel = "STALE";
        tleColor = "#ffbb00"; // orange
      } else {
        tleLabel = "OLD";
        tleColor = "#ff4444"; // red
      }
    }

    /**
     * Normalize to [0..1] using a 30-day scale.
     * pct is used for rendering a progress bar (inverted later: fresh => full bar).
     */
    const tlePct = tleDaysRaw == null ? 0 : Math.max(0, Math.min(1, tleDaysRaw / 30));

    /**
     * Status text:
     * Short operational message shown in the header badge.
     */
    const statusText =
      tleDaysRaw == null
        ? "NO TLE DATA"
        : tleDaysRaw < 14
          ? "ACTIVE TRACKING"
          : tleDaysRaw < 30
            ? "LOW CONFIDENCE"
            : "DEGRADED ORBIT";

    return {
      tle: { days: tleDaysRaw, label: tleLabel, color: tleColor, pct: tlePct },
      // Using hex alpha "1A" (~10%) as an easy semi-transparent background
      status: { text: statusText, color: tleColor, bg: `${tleColor}1A` },
    };
  }, [data]);

  /**
   * Numeric formatter helper:
   * - Returns "N/A" if value is not finite.
   * - Uses 0 decimals for integers, 2 decimals for fractional values.
   */
  const fmt = (val, unit = "") =>
    Number.isFinite(val) ? `${val.toFixed(val % 1 !== 0 ? 2 : 0)}${unit}` : "N/A";

  // --- RENDER: EMPTY STATE (no satellite selected) ---
  if (!data) {
    return (
      <div style={s.container}>
        {/* Retro HUD scanlines overlay */}
        <div style={s.scanlines} />

        <div style={s.headerRow}>
          <div
            style={{
              ...s.badge,
              borderColor: "#ff4444",
              color: "#ff4444",
              boxShadow: "0 0 10px rgba(255,68,68,0.2)",
            }}
          >
            SYSTEM IDLE
          </div>
        </div>

        <div style={s.emptyContent}>
          <h3 style={s.emptyTitle}>NO TARGET LOCK</h3>
          <p style={s.emptyText}>
            Select a target from the orbital view to initialize telemetry stream.
          </p>
        </div>

        {/* Decorative sci-fi corner (bottom-right) */}
        <div style={s.cornerDecoration} />
      </div>
    );
  }

  // --- RENDER: DATA STATE (satellite selected) ---
  return (
    <div style={s.container}>
      <div style={s.scanlines} />

      {/* Header: satellite name + status badge */}
      <div style={s.headerRow}>
        <div style={s.satName}>{data.name}</div>
        <div
          style={{
            ...s.badge,
            color: ui.status.color,
            borderColor: ui.status.color,
            backgroundColor: ui.status.bg,
          }}
        >
          {ui.status.text}
        </div>
      </div>

      <div style={s.divider} />

      {/* Primary telemetry grid (left: identity, right: kinematics & geo) */}
      <div style={s.grid}>
        <InfoItem label="SAT ID" value={data.satId || "N/A"} />
        <InfoItem label="DESIGNATOR" value={data.designator || "N/A"} />

        <InfoItem label="ALTITUDE" value={fmt(data.height, " km")} highlight />
        <InfoItem label="VELOCITY" value={fmt(data.velocity, " km/h")} />

        <InfoItem label="LATITUDE" value={fmt(data.latitude, "°")} />
        <InfoItem label="LONGITUDE" value={fmt(data.longitude, "°")} />

        <InfoItem label="PERIOD" value={fmt(data.period, " min")} />
      </div>

      <div style={{ ...s.divider, margin: "16px 0 12px 0" }} />

      {/* TLE freshness / "health" section */}
      <div style={s.tleSection}>
        <div style={s.flexBetween}>
          <span style={s.label}>DATA AGE</span>
          <span style={{ ...s.value, color: ui.tle.color }}>
            {ui.tle.days !== null ? `${ui.tle.days.toFixed(2)} days` : "N/A"}
            <span style={{ opacity: 0.7, fontSize: "0.7em", marginLeft: 6 }}>
              [{ui.tle.label}]
            </span>
          </span>
        </div>

        {/* Progress bar: inverted so that fresh data (0 days) appears as a full bar */}
        <div style={s.barContainer}>
          <div style={s.barBackground} />
          <div
            style={{
              ...s.barFill,
              width: `${(1 - ui.tle.pct) * 100}%`,
              backgroundColor: ui.tle.color,
              boxShadow: `0 0 12px ${ui.tle.color}`,
            }}
          />
          {/* Tick marks: rough thresholds (1/3 and 2/3 of the scale) */}
          <div style={{ ...s.tick, left: "33%" }} />
          <div style={{ ...s.tick, left: "66%" }} />
        </div>

        <div style={s.flexBetween}>
          <span style={s.subLabel}>CRITICAL</span>
          <span style={s.subLabel}>FRESH</span>
        </div>
      </div>

      <div style={s.cornerDecoration} />
    </div>
  );
};

/**
 * InfoItem
 * --------
 * Small presentational component for a label/value pair inside the HUD grid.
 * - highlight: used for primary metric (altitude) to stand out slightly.
 */
const InfoItem = ({ label, value, highlight }) => (
  <div style={s.item}>
    <div style={s.label}>{label}</div>
    <div
      style={{
        ...s.value,
        color: highlight ? "#fff" : "#ddeeff",
        textShadow: highlight ? "0 0 8px rgba(255,255,255,0.3)" : "none",
      }}
    >
      {value}
    </div>
  </div>
);

// --- Inline styles for a compact, self-contained sci-fi HUD panel ---
const s = {
  container: {
    position: "absolute",
    top: 20,
    left: 20,
    width: 340,
    backgroundColor: "rgba(10, 14, 23, 0.92)", // dark navy
    backdropFilter: "blur(12px)",
    // Clip-path corner cut for a sci-fi look
    clipPath:
      "polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)",
    border: "1px solid rgba(100, 200, 255, 0.15)",
    borderTop: "2px solid rgba(0, 200, 255, 0.6)",
    color: "#e0f7ff",
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    padding: "20px",
    zIndex: 1000,
    boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
    overflow: "hidden", // needed for scanlines overlay
  },
  scanlines: {
    position: "absolute",
    inset: 0,
    // CRT-style scanlines + subtle RGB noise bands
    background:
      "linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))",
    backgroundSize: "100% 4px, 6px 100%",
    pointerEvents: "none",
    zIndex: 0,
    opacity: 0.6,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    position: "relative",
    zIndex: 1,
  },
  satName: {
    fontSize: "1.1rem",
    fontWeight: "700",
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: "1px",
    maxWidth: "60%",
    lineHeight: 1.2,
  },
  badge: {
    fontSize: "0.65rem",
    fontWeight: "bold",
    padding: "4px 8px",
    border: "1px solid",
    borderRadius: "2px",
    letterSpacing: "1px",
    whiteSpace: "nowrap",
  },
  divider: {
    height: 1,
    width: "100%",
    background:
      "linear-gradient(90deg, transparent, rgba(0, 200, 255, 0.5), transparent)",
    marginBottom: 16,
    opacity: 0.5,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px 20px",
    position: "relative",
    zIndex: 1,
  },
  item: { display: "flex", flexDirection: "column", gap: "2px" },
  label: { fontSize: "0.7rem", color: "#6b8bad", letterSpacing: "0.5px" },
  value: { fontSize: "0.95rem", fontWeight: "600", letterSpacing: "0.5px" },

  // TLE section styles
  tleSection: { position: "relative", zIndex: 1 },
  flexBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  barContainer: {
    position: "relative",
    height: 6,
    width: "100%",
    background: "rgba(0,0,0,0.5)",
    margin: "8px 0 4px 0",
    borderRadius: 2,
    overflow: "hidden",
  },
  // Optional: background layer placeholder for future styling
  barBackground: {},
  barFill: { height: "100%", transition: "width 0.4s cubic-bezier(0.22, 1, 0.36, 1)" },
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    background: "rgba(0,0,0,0.8)",
    zIndex: 2,
  },
  subLabel: {
    fontSize: "0.6rem",
    color: "#455a64",
    textTransform: "uppercase",
  },

  // Empty state styles
  emptyContent: {
    textAlign: "center",
    padding: "20px 0",
    position: "relative",
    zIndex: 1,
  },
  emptyTitle: {
    margin: "0 0 8px 0",
    color: "#ff4444",
    fontSize: "1rem",
    letterSpacing: "2px",
  },
  emptyText: { margin: 0, fontSize: "0.8rem", color: "#888", lineHeight: 1.5 },

  // Decorative corner bottom-right
  cornerDecoration: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderLeft: "2px solid rgba(0, 200, 255, 0.3)",
    background:
      "linear-gradient(135deg, transparent 50%, rgba(0, 200, 255, 0.1) 50%)",
    pointerEvents: "none",
  },
};

export default SatelliteInfo;
