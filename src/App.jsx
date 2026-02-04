import React, { useState } from "react";
import GlobeViewer from "./components/GlobeViewer";
import SatelliteInfo from "./components/SatelliteInfo";
import "./index.css";

/**
 * App
 * ---
 * Root application component.
 *
 * Responsibilities:
 * - Owns the currently selected satellite state.
 * - Connects the 3D globe (data producer) with the UI overlay (data consumer).
 *
 * Data flow:
 *   GlobeViewer  -->  App (state)  -->  SatelliteInfo
 */
function App() {
  /**
   * Holds the telemetry & metadata of the currently selected satellite.
   * - null   => no satellite selected (idle UI state)
   * - object => active satellite with live telemetry
   */
  const [selectedSatData, setSelectedSatData] = useState(null);

  return (
    <div
      className="App"
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* 3D Globe Viewer (background layer)
          - Emits satellite selection events upward via callback */}
      <GlobeViewer onSatelliteSelect={setSelectedSatData} />

      {/* UI Overlay (foreground layer)
          - Renders satellite telemetry or idle state based on selection */}
      <SatelliteInfo data={selectedSatData} />
    </div>
  );
}

export default App;
