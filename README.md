# Satellite Orbit Visualization & Tracking

![JavaScript](https://img.shields.io/badge/JavaScript-ES2023-yellow?style=flat-square\&logo=javascript)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square\&logo=react)
![CesiumJS](https://img.shields.io/badge/CesiumJS-3D%20Globe-3b82f6?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square\&logo=docker)
![Status](https://img.shields.io/badge/Status-Operational-green?style=flat-square)
![Classification](https://img.shields.io/badge/Classification-Open%20Source-grey?style=flat-square)

---

An interactive **3D satellite orbit visualization and tracking platform** built with **CesiumJS and React**, focused on accurate orbital propagation using **TLE (Two-Line Element)** data.

The project is designed as a **technical portfolio and research-grade visualization**, prioritizing deterministic behavior, offline reproducibility, and clean architectural separation.

---

## Key Features

* Real-time satellite orbit propagation on a 3D Earth globe
* Offline-first TLE loading (no runtime dependency on external APIs)
* Interactive satellite selection with live telemetry overlay
* Data freshness and confidence indicators derived from TLE age
* Clear separation between visualization logic and UI components
* Fully containerized deployment using Docker and Nginx

---

## System Architecture

The application follows a deliberately decoupled architecture:

```
GlobeViewer (Cesium / 3D Visualization)
        |
        |  emits satellite selection + telemetry
        v
      App (state owner)
        |
        |  passes structured data
        v
SatelliteInfo (UI / Telemetry Panel)
```

### Architectural Principles

* **Offline-first data handling**: TLE data is generated ahead of time and served locally
* **Stateless visualization layer**: the globe component focuses purely on rendering and interaction
* **Deterministic UI logic**: telemetry status is derived exclusively from data age and validity

---

## Project Structure

```
src/
 ├─ components/
 │   ├─ GlobeViewer.jsx      # Cesium-based globe and orbit rendering
 │   └─ SatelliteInfo.jsx   # HUD-style telemetry and status panel
 │
 ├─ utils/
 │   └─ celestrakLoader.js  # TLE loading and parsing logic
 │
 ├─ App.jsx                 # Application state and data flow
 └─ main.jsx                # React application entry point
```

---

## TLE Data Handling

* Primary source: locally generated TLE file

  ```
  public/data/satellites.tle
  ```

* Data is generated offline via a Node.js script and never fetched directly from third-party APIs at runtime

* A minimal fallback dataset (ISS only) is used if local data is unavailable

This ensures predictable behavior, offline demos, and immunity to external API failures.

---

## Running with Docker (Recommended)

### Build and Run

```bash
docker compose up --build
```

The application will be available at:

```
http://localhost:8080
```

The Docker setup includes:

* Multi-stage build (Node.js build stage, Nginx runtime stage)
* SPA-safe Nginx configuration
* Production-ready static asset serving

---

## Local Development

```bash
npm install
npm run dev
```

Then open:

```
http://localhost:5173
```

---

## Screenshots

```
assets/screenshots/
  globe_overview.png
  satellite_selected.png
  tle_health.png
```

---

## Live Demo

A live demo can be deployed using the provided Docker configuration on any standard VPS or cloud instance.

```
https://your-live-demo-link
```

---

## Intended Use Cases

* Satellite orbit visualization demonstrations
* Geospatial and aerospace data exploration
* Technical portfolio and code review
* Educational tool for orbital mechanics concepts

---

## Technology Stack

* React 18
* CesiumJS / Resium
* satellite.js
* Docker and Nginx
* Modern JavaScript (ES modules)

---

## Notes

This project prioritizes readability and correctness over feature breadth. The architecture is intentionally modular to support future extensions such as:

* Multiple TLE sources
* Time controls and playback
* Ground tracks and coverage visualization
* Sensor and field-of-view modeling

---

## License

MIT License
