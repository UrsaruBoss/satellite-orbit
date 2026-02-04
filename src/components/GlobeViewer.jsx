import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  Viewer,
  Entity,
  CylinderGraphics,
  EllipseGraphics,
  PolylineGraphics,
  BillboardGraphics,
} from "resium";
import {
  Cartesian3,
  Color,
  JulianDate,
  CallbackProperty,
  SampledPositionProperty,
  PolylineGlowMaterialProperty,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Matrix4,
  VerticalOrigin,
} from "cesium";
import * as satellite from "satellite.js";
import { fetchSatellites } from "../utils/celestrakLoader";

/**
 * GlobeViewer
 * -----------
 * Main 3D visualization component built on Cesium + Resium.
 *
 * Responsibilities:
 * - Render the Earth globe and satellite orbits in real time.
 * - Load and propagate TLE-based satellite positions.
 * - Handle satellite selection via mouse interaction.
 *
 * Data flow:
 * - Emits selected satellite telemetry upward through `onSatelliteSelect`.
 * - Does not own UI state; acts purely as a data/visualization layer.
 *
 * Notes:
 * - Heavy computations (orbit propagation, interpolation) are kept internal.
 * - Designed to be visually dominant (background layer) with UI rendered separately.
 */
const GlobeViewer = ({ onSatelliteSelect }) => {
  // -----------------------------
  // Core state
  // -----------------------------
  const [satellites, setSatellites] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [matrixCoords, setMatrixCoords] = useState("");

  // Selection state
  const [selectedSat, setSelectedSat] = useState(null);
  const [selectedSatPath, setSelectedSatPath] = useState(null);

  // Tracking state
  const [isTracked, setIsTracked] = useState(false);

  // UI, search, and filters
  const [searchTerm, setSearchTerm] = useState("");
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [showAdvFilters, setShowAdvFilters] = useState(false);

  // Filter values
  const [filterAlt, setFilterAlt] = useState({ min: 0, max: 40000 }); // km
  const [filterVel, setFilterVel] = useState({ min: 0, max: 40000 }); // km/h

  // Location + scanner
  const [locationQuery, setLocationQuery] = useState("");
  const [geocodeStatus, setGeocodeStatus] = useState({ type: "", message: "" });
  const [groundTarget, setGroundTarget] = useState(null);
  const [intercepts, setIntercepts] = useState([]);
  const [scanRadius, setScanRadius] = useState(500); // km

  // Time controls
  const [simDateInput, setSimDateInput] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });

  const [isPaused, setIsPaused] = useState(false);
  const [multiplier, setMultiplier] = useState(10);

  const MAX_FUTURE_DAYS = 30;
  const [tleWarning, setTleWarning] = useState("");
  const [isTleOutOfRange, setIsTleOutOfRange] = useState(false);


  // -----------------------------
  // Icons (kept as-is)
  // -----------------------------
  const HomeIcon = () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );

  const ZoomInIcon = () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );

  const ZoomOutIcon = () => (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );

  // -----------------------------
  // Mobile
  // -----------------------------
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);


  // -----------------------------
  // Refs and internal caches
  // -----------------------------
  const viewerRef = useRef(null);
  const lastTickTime = useRef(0);
  const lastScannerCheck = useRef(0);

  // Keep the latest orbit path in a ref for "immediate" Cesium reads
  const selectedSatPathRef = useRef(null);

  // Cache TLE -> satrec objects (twoline2satrec is not free)
  const satrecCacheRef = useRef(new Map());

  const getViewer = () => viewerRef.current?.cesiumElement || null;

  const getSatrec = useCallback((sat) => {
    if (!sat?.id) return null;

    // Use sat.id as cache key (stable across filters)
    const cache = satrecCacheRef.current;
    if (cache.has(sat.id)) return cache.get(sat.id);

    try {
      const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
      cache.set(sat.id, satrec);
      return satrec;
    } catch {
      return null;
    }
  }, []);


  const jsDateToLocalInput = (d) => {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().slice(0, 16);
  };

  const getTleEpochDate = (sat) => {
    const satrec = getSatrec(sat);
    if (!satrec?.jdsatepoch) return null;

    const tleEpochMs = (satrec.jdsatepoch - 2440587.5) * 86400 * 1000;
    const d = new Date(tleEpochMs);
    return Number.isFinite(d.getTime()) ? d : null;
  };


  const isOutOfRange = useCallback((jsDate, sat) => {
    if (!sat) return false;
    const epoch = getTleEpochDate(sat);
    if (!epoch) return false;

    const max = new Date(epoch.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
    return jsDate > max;
  }, [getTleEpochDate, MAX_FUTURE_DAYS]);


  const simMaxDate = useMemo(() => {
    if (!selectedSat) return "";          // fără sat selectat, nu clamp-uim
    const epoch = getTleEpochDate(selectedSat);
    if (!epoch) return "";
    const max = new Date(epoch.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
    return jsDateToLocalInput(max);
  }, [selectedSat, getTleEpochDate]);

  const simMinDate = useMemo(() => {
    if (!selectedSat) return ""; // fără selectie, îl lași liber sau pui un minim global
    const epoch = getTleEpochDate(selectedSat);
    return epoch ? jsDateToLocalInput(epoch) : "";
  }, [selectedSat, getSatrec]);

  // -----------------------------
  // Initialization
  // -----------------------------
  useEffect(() => {
    let alive = true;

    fetchSatellites().then((data) => {
      if (!alive) return;
      setSatellites(data || []);
    });

    // Initialize Cesium clock once the viewer is mounted
    const t = setTimeout(() => {
      const viewer = getViewer();
      if (!viewer) return;

      const clock = viewer.clock;
      clock.currentTime = JulianDate.fromDate(new Date());
      clock.multiplier = 10;
      clock.shouldAnimate = true;
    }, 800);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  // -----------------------------
  // Filtering (search + advanced filters)
  // -----------------------------
  const filteredSatellites = useMemo(() => {
    let result = satellites;

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toUpperCase();
      result = result.filter((s) => (s.name || "").toUpperCase().includes(q));
    }

    if (!showAdvFilters) return result;

    const now = new Date();
    return result.filter((sat) => {
      const satrec = getSatrec(sat);
      if (!satrec) return false;

      try {
        const pv = satellite.propagate(satrec, now);
        if (!pv.position || !pv.velocity) return false;

        // Velocity magnitude: km/s -> km/h
        const vKmS = Math.sqrt(
          pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2
        );
        const vKmH = vKmS * 3600;

        if (vKmH < filterVel.min || vKmH > filterVel.max) return false;

        // Altitude filter (posGd.height is in km)
        const gmst = satellite.gstime(now);
        const posGd = satellite.eciToGeodetic(pv.position, gmst);
        if (posGd.height < filterAlt.min || posGd.height > filterAlt.max) return false;

        return true;
      } catch {
        return false;
      }
    });
  }, [satellites, searchTerm, showAdvFilters, filterAlt, filterVel, getSatrec]);

  // Auto-deselect if selection disappears from current filtered list
  useEffect(() => {
    if (!selectedSat) return;

    const stillVisible = filteredSatellites.some((s) => s.id === selectedSat.id);
    if (stillVisible) return;

    setSelectedSat(null);
    setSelectedSatPath(null);
    selectedSatPathRef.current = null;

    setIsTracked(false);
    onSatelliteSelect?.(null);

    const viewer = getViewer();
    if (viewer) viewer.trackedEntity = undefined;
  }, [filteredSatellites, selectedSat, onSatelliteSelect]);

  const updateInfoPanel = useCallback((sat) => {
    const viewer = getViewer();
    if (!viewer) return;

    const now = JulianDate.toDate(viewer.clock.currentTime);
    const satrec = getSatrec(sat);
    if (!satrec) return;

    try {
      // --- PERIOD (minutes) ---
      const mmTleRaw = sat?.line2?.substring(52, 63); // rev/day
      const mmTle = mmTleRaw ? parseFloat(mmTleRaw.trim()) : NaN;

      const mmFromSatrec = Number.isFinite(satrec?.no)
        ? (satrec.no * 1440) / (2 * Math.PI) // rev/day
        : NaN;

      const meanMotionRevPerDay =
        Number.isFinite(mmTle) && mmTle > 0 ? mmTle :
        Number.isFinite(mmFromSatrec) && mmFromSatrec > 0 ? mmFromSatrec :
        NaN;

      const periodMin =
        Number.isFinite(meanMotionRevPerDay) && meanMotionRevPerDay > 0
          ? 1440 / meanMotionRevPerDay
          : null;

      // --- TLE AGE ---
      const jd = satrec.jdsatepoch;
      const tleEpochMs = (jd - 2440587.5) * 86400 * 1000;
      const tleAgeDays = (now.getTime() - tleEpochMs) / (86400 * 1000);

      const tleAgeLabel =
        tleAgeDays < 3 ? "FRESH" :
        tleAgeDays < 14 ? "OK" :
        tleAgeDays < 30 ? "OLD" :
        "VERY OLD";

      // --- Propagate (optional for pos/vel) ---
      const pv = satellite.propagate(satrec, now);

      let heightKm = null, latDeg = null, lonDeg = null, velKmH = null;

      if (pv?.position) {
        const gmst = satellite.gstime(now);
        const posGd = satellite.eciToGeodetic(pv.position, gmst);

        heightKm = posGd.height;
        latDeg = satellite.degreesLat(posGd.latitude);
        lonDeg = satellite.degreesLong(posGd.longitude);

        if (pv?.velocity) {
          const vKmS = Math.sqrt(
            pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2
          );
          velKmH = Number((vKmS * 3600).toFixed(0));
        }
      }

      onSatelliteSelect?.({
        name: sat.name,
        satId: sat.id,

        height: heightKm,
        latitude: latDeg,
        longitude: lonDeg,
        velocity: velKmH,

        tleAgeDays: Number(tleAgeDays.toFixed(2)),
        tleAgeLabel,

        period: periodMin != null ? Number(periodMin.toFixed(1)) : null,
        designator: sat.line1?.substring(9, 17)?.trim() || "",
      });
    } catch (e) {
      console.warn("updateInfoPanel failed:", e);
    }
  }, [getSatrec, onSatelliteSelect]);


  // -----------------------------
  // Orbit sampling for the selected satellite (stable + deterministic)
  // -----------------------------
  const calculatePreciseMovement = useCallback(
    (sat) => {
      const viewer = getViewer();
      if (!viewer) return;

      const satrec = getSatrec(sat);
      if (!satrec) return;

      const baseDate = JulianDate.toDate(viewer.clock.currentTime);
      const property = new SampledPositionProperty();

      // Sample +/- 4 hours around the current clock time, every 2 minutes
      for (let i = -240; i <= 240; i += 2) {
        const t = new Date(baseDate.getTime() + i * 60_000);
        const jt = JulianDate.fromDate(t);

        try {
          const pv = satellite.propagate(satrec, t);
          if (!pv.position || isNaN(pv.position.x)) continue;

          const gmst = satellite.gstime(t);
          const posGd = satellite.eciToGeodetic(pv.position, gmst);

          // Cesium expects meters
          const cart = Cartesian3.fromRadians(
            posGd.longitude,
            posGd.latitude,
            posGd.height * 1000
          );

          property.addSample(jt, cart);
        } catch {
          // Skip invalid samples
        }
      }

      // Keep both: React state (for JSX) and a ref (for immediate callback access)
      selectedSatPathRef.current = property;
      setSelectedSatPath(property);
    },
    [getSatrec]
  );

  // -----------------------------
  // Selection + helper path generators
  // -----------------------------
  const selectSatelliteById = useCallback(
    (satId) => {
      const sat = satellites.find((s) => s.id === satId);
      if (!sat) {
        console.warn("selectSatelliteById: satellite not found:", satId);
        return;
      }

      setSelectedSat(sat);

      const viewer = getViewer();
      const jsDate = viewer ? JulianDate.toDate(viewer.clock.currentTime) : new Date();
      const out = isOutOfRange(jsDate, sat);


      setIsTleOutOfRange(out);

      if (out) {
        setSelectedSatPath(null);
        selectedSatPathRef.current = null;
        setTleWarning(`TLE out of range (+${MAX_FUTURE_DAYS} days). Orbit path disabled; data may be inaccurate.`);
      } else {
        calculatePreciseMovement(sat);
        if (tleWarning) setTleWarning("");
      }


      // Update external panel details
      updateInfoPanel(sat);

      // Optional: ensure tracking remains meaningful when selecting a new sat
      // (do NOT auto-enable tracking here; only keep camera state consistent)
      if (viewer && viewer.trackedEntity) {
        // If we were tracking something else, we will rebind in the tracking effect.
        viewer.trackedEntity = undefined;
      }
    },
    [satellites, calculatePreciseMovement, updateInfoPanel, isOutOfRange, tleWarning, MAX_FUTURE_DAYS]
  );

  const getDynamicFuturePath = useCallback(
    (sat) => {
      const satrec = getSatrec(sat);
      if (!satrec) return undefined;

      return new CallbackProperty((cesiumTime) => {
        const positions = [];
        const startDate = JulianDate.toDate(cesiumTime);

        // 90 minutes ahead, 1-min step
        for (let i = 0; i <= 90; i += 1) {
          const t = new Date(startDate.getTime() + i * 60_000);
          try {
            const pv = satellite.propagate(satrec, t);
            if (!pv.position || isNaN(pv.position.x)) continue;

            const gmst = satellite.gstime(t);
            const posGd = satellite.eciToGeodetic(pv.position, gmst);

            positions.push(
              Cartesian3.fromRadians(
                posGd.longitude,
                posGd.latitude,
                posGd.height * 1000
              )
            );
          } catch {
            // ignore
          }
        }

        return positions;
      }, false);
    },
    [getSatrec]
  );

  const selectionVisuals = useMemo(() => {
    return {
      scale: new CallbackProperty((time) => {
        const t = JulianDate.toDate(time).getTime();
        return 0.6 + Math.sin(t / 400) * 0.01;
      }, false),
      rotation: new CallbackProperty((time) => {
        const t = JulianDate.toDate(time).getTime();
        return (t / 5000) % (Math.PI * 20);
      }, false),
    };
  }, []);

  const getSimpleCallback = useCallback(
    (sat) => {
      const satrec = getSatrec(sat);
      if (!satrec) return undefined;

      return new CallbackProperty((time) => {
        try {
          const jsDate = JulianDate.toDate(time);
          const pv = satellite.propagate(satrec, jsDate);
          if (!pv.position || isNaN(pv.position.x)) return undefined;

          const gmst = satellite.gstime(jsDate);
          const posGd = satellite.eciToGeodetic(pv.position, gmst);

          return Cartesian3.fromRadians(
            posGd.longitude,
            posGd.latitude,
            posGd.height * 1000
          );
        } catch {
          return undefined;
        }
      }, false);
    },
    [getSatrec]
  );

  // -----------------------------
  // Tracking logic (follow selected sat)
  // -----------------------------
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;

    if (!isTracked || !selectedSat) {
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      return;
    }

    // We set trackedEntity after the selected entity exists in the viewer
    const t = setTimeout(() => {
    const entity =
      viewer.entities.getById("selected-sat-complex") ||
      viewer.entities.getById("selected-sat-simple");

      if (entity) viewer.trackedEntity = entity;
    }, 50);

    return () => clearTimeout(t);
  }, [isTracked, selectedSat]);

  // -----------------------------
  // OnTick: UI time + scanner (NO orbit resampling here)
  // -----------------------------
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;

    const onTick = (clock) => {
      const nowMs = Date.now();

      // Update UI once per second
      if (nowMs - lastTickTime.current > 1000) {
        lastTickTime.current = nowMs;

        try {
          const jsDate = JulianDate.toDate(clock.currentTime);

          const out = selectedSat ? isOutOfRange(jsDate, selectedSat) : false;


          if (out !== isTleOutOfRange) {
            setIsTleOutOfRange(out);

            // dacă tocmai am intrat out-of-range, tăiem orbit path-ul (dar păstrăm selecția)
            if (out) {
              setSelectedSatPath(null);
              selectedSatPathRef.current = null;
            } else {
              // dacă revenim în range și avem sat selectat, reconstruim path-ul
              if (selectedSat) calculatePreciseMovement(selectedSat);
            }
          }

          if (out) {
            setTleWarning(`TLE out of range (+${MAX_FUTURE_DAYS} days). Orbit path disabled; data may be inaccurate.`);
          } else {
            if (tleWarning) setTleWarning("");
          }


          const offsetMs = jsDate.getTimezoneOffset() * 60_000;
          const localISO = new Date(jsDate.getTime() - offsetMs)
            .toISOString()
            .slice(0, 16);

          // Do not overwrite if the user is currently editing the datetime input
          const active = document.activeElement;
          const isEditingDate =
            active && active.tagName === "INPUT" && active.type === "datetime-local";

          if (!isEditingDate) setSimDateInput(localISO);

          // Keep the info panel "live" for the selected sat
          if (selectedSat) updateInfoPanel(selectedSat);
        } catch {
          // ignore
        }
      }

      // Scanner (every 2 seconds)
      if (groundTarget && nowMs - lastScannerCheck.current > 2000) {
        lastScannerCheck.current = nowMs;

        const currentJsDate = JulianDate.toDate(clock.currentTime);
        const found = [];

        const sourceList = filteredSatellites.length ? filteredSatellites : satellites;
        const subsetToCheck = sourceList.slice(0, 1000);
        const rangeMeters = scanRadius * 1000;

        for (const sat of subsetToCheck) {
          const satrec = getSatrec(sat);
          if (!satrec) continue;

          try {
            const pv = satellite.propagate(satrec, currentJsDate);
            if (!pv.position) continue;

            const gmst = satellite.gstime(currentJsDate);
            const posGd = satellite.eciToGeodetic(pv.position, gmst);
            const satCart = Cartesian3.fromRadians(
              posGd.longitude,
              posGd.latitude,
              posGd.height * 1000
            );

            const distance = Cartesian3.distance(satCart, groundTarget.position);
            if (distance < rangeMeters) {
              found.push({
                name: sat.name,
                id: sat.id,
                distanceKm: distance / 1000,
              });
            }
          } catch {
            // ignore
          }
        }

        found.sort((a, b) => a.distanceKm - b.distanceKm);
        setIntercepts(
          found.map((x) => ({
            name: x.name,
            id: x.id,
            distance: `${x.distanceKm.toFixed(0)} KM`,
          }))
        );
      }
    };

    viewer.clock.onTick.addEventListener(onTick);
    return () => viewer.clock.onTick.removeEventListener(onTick);
  }, [
    groundTarget,
    filteredSatellites,
    satellites,
    scanRadius,
    selectedSat,
    updateInfoPanel,
    getSatrec,
    isOutOfRange,
    isTleOutOfRange,
    tleWarning,
    calculatePreciseMovement,

  ]);

  // Disable Cesium default double-click zoom
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;

    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
  }, []);

  // Click selection handler (stable dependency: selectSatelliteById is useCallback)
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;

    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    const handleSelection = (movement, isDoubleClick) => {
      const pickedObject = viewer.scene.pick(movement.position);

      if (defined(pickedObject) && pickedObject.id) {
        const entity = pickedObject.id;

        // Ignore the cone helper if it is pickable
        if (entity?.id === "selected-sat-cone") return;

        const satIdProp = entity?.properties?.satId;
        if (satIdProp) {
          const satId = satIdProp.getValue();
          selectSatelliteById(satId);
          return;
        }
      }

      // Background click: clear selection (only on single click)
      if (!isDoubleClick) {
        setSelectedSat(null);
        setSelectedSatPath(null);
        selectedSatPathRef.current = null;

        onSatelliteSelect?.(null);
        setIsTracked(false);

        viewer.trackedEntity = undefined;
      }
    };

    handler.setInputAction(
      (m) => handleSelection(m, false),
      ScreenSpaceEventType.LEFT_CLICK
    );
    handler.setInputAction(
      (m) => handleSelection(m, true),
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    return () => handler.destroy();
  }, [selectSatelliteById, onSatelliteSelect]);

  // -----------------------------
  // Controls & Geo (kept for next section)
  // -----------------------------
  const togglePlay = () => {
    const viewer = getViewer();
    if (!viewer) return;
    const c = viewer.clock;
    c.shouldAnimate = !c.shouldAnimate;
    setIsPaused(!c.shouldAnimate);
  };

  const setSpeed = (val) => {
    const s = parseFloat(val);
    if (isNaN(s)) return;

    setMultiplier(s);

    const viewer = getViewer();
    if (!viewer) return;

    const c = viewer.clock;
    c.multiplier = s;
    c.shouldAnimate = true;
    setIsPaused(false);
  };

  const flyHome = () => getViewer()?.camera.flyHome();
  const zoomIn = () => getViewer()?.camera.zoomIn(1_000_000);
  const zoomOut = () => getViewer()?.camera.zoomOut(1_000_000);

  const searchLocation = async () => {
    const q = (locationQuery || "").trim();
    if (!q) return;

    // Reset status each run
    setGeocodeStatus({ type: "", message: "" });

    // 1) Dacă userul bagă coordonate direct: "lat, lon" (ex: "43.75, 24.87")
    const coordMatch = q.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/
    );
    if (coordMatch) {
      const latitude = parseFloat(coordMatch[1]);
      const longitude = parseFloat(coordMatch[2]);

      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const cartesian = Cartesian3.fromDegrees(longitude, latitude);

        setIsTracked(false);
        const viewer = getViewer();
        if (viewer) viewer.trackedEntity = undefined;

        setGroundTarget({
          position: cartesian,
          name: "CUSTOM COORDS",
          lat: latitude,
          lon: longitude,
        });

        setIntercepts([]);

        if (viewer) {
          viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(longitude, latitude, 2_000_000),
            duration: 2,
          });
        }

        setGeocodeStatus({ type: "ok", message: "COORDS LOCKED" });
        return;
      }
    }

    // 2) Altfel: încearcă geocoding (poate pica din CORS / 403)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        q
      )}`;

      const response = await fetch(url, {
        method: "GET",
        // Nominatim e sensibil, dar asta nu rezolvă CORS. Ajută doar la "polite requests".
        headers: {
          "Accept": "application/json",
        },
      });

      // Dacă Nominatim întoarce 403/429 etc, aruncă eroare controlată
      if (!response.ok) {
        throw new Error(`GEOCODE_HTTP_${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.length) {
        setGeocodeStatus({ type: "warn", message: "LOCATION NOT FOUND" });
        return;
      }

      const { lat, lon, display_name } = data[0];
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);

      const cartesian = Cartesian3.fromDegrees(longitude, latitude);

      setIsTracked(false);
      const viewer = getViewer();
      if (viewer) viewer.trackedEntity = undefined;

      setGroundTarget({
        position: cartesian,
        name: (display_name || "").split(",")[0],
        lat: latitude,
        lon: longitude,
      });

      setIntercepts([]);

      if (viewer) {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(longitude, latitude, 2_000_000),
          duration: 2,
        });
      }

      setGeocodeStatus({ type: "ok", message: "TARGET ACQUIRED" });
    } catch (err) {
      console.error("Geocoding error:", err);

      // Mesaj “uman”, stabil, fără să arunci UI-ul în aer
      setGeocodeStatus({
        type: "error",
        message:
          "GEOCODING UNAVAILABLE (CORS / 403). USE COORDS: LAT,LON",
      });
    }
  };

  const handleDateChange = (e) => {
    const newDateStr = e.target.value;
    if (!newDateStr) return;

    setSimDateInput(newDateStr);

    const viewer = getViewer();
    if (!viewer) return;

    const newJsDate = new Date(newDateStr);
    let finalDate = newJsDate;

    // clamp MIN = TLE epoch
    if (selectedSat) {
      const epoch = getTleEpochDate(selectedSat);
      if (epoch) {
        const maxLimit = new Date(epoch.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
        if (finalDate > maxLimit) finalDate = maxLimit;
      }
    }


    const maxLimit = new Date(Date.now() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
    if (finalDate > maxLimit) finalDate = maxLimit;

    const finalJulian = JulianDate.fromDate(finalDate);
    viewer.clock.currentTime = finalJulian;

    viewer.clock.shouldAnimate = true;
    setIsCalculating(true);

    const out = selectedSat ? isOutOfRange(finalDate, selectedSat) : false;
    setIsTleOutOfRange(out);

    if (out) {
      setSelectedSatPath(null);
      selectedSatPathRef.current = null;
      setTleWarning(`TLE out of range (+${MAX_FUTURE_DAYS} days). Orbit path disabled; data may be inaccurate.`);
    } else {
      if (selectedSat) calculatePreciseMovement(selectedSat);
      if (tleWarning) setTleWarning("");
    }


    // Visual "matrix" effect only
    const interval = setInterval(() => {
      const randomCoord = `LAT: ${(Math.random() * 180 - 90).toFixed(
        4
      )}° / LON: ${(Math.random() * 360 - 180).toFixed(
        4
      )}° / ALT: ${(Math.random() * 35000).toFixed(1)}KM`;
      setMatrixCoords(randomCoord);
    }, 50);

    setTimeout(() => {
      clearInterval(interval);
      setIsCalculating(false);
    }, 1200);
  };

  const backgroundSatellites = useMemo(() => {
    // If a sat is selected, do not draw it in the background list to avoid duplicates
    let list = filteredSatellites;
    if (selectedSat) list = list.filter((s) => s.id !== selectedSat.id);
    return list;
  }, [filteredSatellites, selectedSat]);

  const isSelectionInFilter = useMemo(() => {
    if (!selectedSat) return false;
    return filteredSatellites.some((s) => s.id === selectedSat.id);
  }, [filteredSatellites, selectedSat]);


return (
  
  <div style={{ width: "100%", height: "100vh", position: "relative", overflow: "hidden" }}>
    {isPortrait && (
      <div style={{ ...styles.portraitOverlay, display: "flex" }}>
        <div style={{ fontSize: "1.2rem", letterSpacing: "2px" }}>
          ROTATE DEVICE
        </div>
        <div style={{ marginTop: "12px", fontSize: "0.8rem", opacity: 0.7 }}>
          This interface is optimized for landscape mode.
        </div>
      </div>
    )}

    {isCalculating && (
      <div style={styles.loadingOverlay}>
        <div style={{ letterSpacing: "8px", fontSize: "1.5rem", fontWeight: "bold" }}>
          RECALCULATING ALL ORBITAL VECTORS
        </div>
        <div style={styles.scanBar}></div>
        <div style={styles.matrixText}>{matrixCoords}</div>
        <div style={{ marginTop: "40px", fontSize: "0.6rem", opacity: 0.5, letterSpacing: "2px" }}>
          PROPAGATING SGP4 MODEL // UPDATING EPOCH DATA // SYNCING SATELLITE_DB
        </div>
      </div>
    )}

    {/* --- UI ELEMENTS --- */}
    <button onClick={() => setIsFilterVisible(!isFilterVisible)} style={styles.toggleButton}>
      {isFilterVisible ? "[-] HIDE FILTER" : "[+] SAT FILTER"}
    </button>

    {isFilterVisible && (
      <div style={styles.searchContainer}>
        <div style={styles.searchLabel}>SATELLITE FILTER //</div>
        <input
          type="text"
          placeholder="NAME SEARCH..."
          style={styles.searchInput}
          onChange={(e) => setSearchTerm(e.target.value)}
          value={searchTerm}
          autoFocus
        />

        <div style={{ ...styles.advButton, marginTop: "10px" }} onClick={() => setShowAdvFilters(!showAdvFilters)}>
          {showAdvFilters ? "▼ HIDE ADVANCED" : "► SHOW ADVANCED FILTERS"}
        </div>

        {showAdvFilters && (
          <div style={styles.advPanel}>
            <div style={styles.filterRow}>
              <span style={{ color: "#888", fontSize: "0.7rem" }}>ALT (KM):</span>
              <div style={{ display: "flex", gap: "5px" }}>
                <input
                  type="number"
                  placeholder="MIN"
                  style={styles.smallInput}
                  value={filterAlt.min}
                  onChange={(e) => setFilterAlt({ ...filterAlt, min: Number(e.target.value) })}
                />
                <input
                  type="number"
                  placeholder="MAX"
                  style={styles.smallInput}
                  value={filterAlt.max}
                  onChange={(e) => setFilterAlt({ ...filterAlt, max: Number(e.target.value) })}
                />
              </div>
            </div>

            <div style={styles.filterRow}>
              <span style={{ color: "#888", fontSize: "0.7rem" }}>SPD (KM/H):</span>
              <div style={{ display: "flex", gap: "5px" }}>
                <input
                  type="number"
                  placeholder="MIN"
                  style={styles.smallInput}
                  value={filterVel.min}
                  onChange={(e) => setFilterVel({ ...filterVel, min: Number(e.target.value) })}
                />
                <input
                  type="number"
                  placeholder="MAX"
                  style={styles.smallInput}
                  value={filterVel.max}
                  onChange={(e) => setFilterVel({ ...filterVel, max: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        )}

        <div style={styles.resultCount}>FOUND: {filteredSatellites.length} ORBITS</div>
      </div>
    )}

    {/* --- SCANNER --- */}
    {groundTarget && (
      <div style={styles.interceptContainer}>
        <div style={styles.targetLabel}>GROUND TARGET SYSTEM //</div>
        <div style={{ color: "#fff", fontSize: "0.8rem", marginBottom: "5px" }}>
          TARGET: <span style={{ color: "#ff3333" }}>{groundTarget.name.split(",")[0]}</span>
        </div>

        <div style={{ marginBottom: "10px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", fontSize: "0.7rem" }}>
            <span>RANGE: {scanRadius} KM</span>
          </div>
          <input
            type="range"
            min="50"
            max="5000"
            step="50"
            value={scanRadius}
            onChange={(e) => setScanRadius(Number(e.target.value))}
            style={{ width: "100%", cursor: "pointer", accentColor: "#ff3333" }}
          />
        </div>

        <div style={{ ...styles.interceptList, scrollbarWidth: "thin" }}>
          {intercepts.length === 0 && <div style={{ color: "#666", fontSize: "0.7rem" }}>SCANNING SKY SECTOR...</div>}
          {intercepts.map((int, i) => (
            <div key={i} style={styles.interceptItem} onClick={() => selectSatelliteById(int.id)}>
              <span style={{ color: "#00ff00", fontWeight: "bold" }}>{int.name}</span>
              <span style={{ color: "#00aaff" }}>{int.distance}</span>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* --- TRACKING BUTTON --- */}
    {selectedSat && isSelectionInFilter && (
      <div style={styles.trackingControl}>
        <button
          onClick={() => setIsTracked(!isTracked)}
          style={{
            ...styles.trackButton,
            background: isTracked ? "rgba(0, 255, 0, 0.2)" : "rgba(0, 0, 0, 0.6)",
            border: isTracked ? "1px solid #00ff00" : "1px solid #666",
            color: isTracked ? "#00ff00" : "#888",
          }}
        >
          {isTracked ? "[●] TARGET LOCKED" : "[ ] TRACK TARGET"}
        </button>
      </div>
    )}

<div style={styles.locationContainer}>
  <div style={styles.targetLabel}>GROUND TARGET SYSTEM //</div>

  {/* row: input + button */}
  <div style={{ display: "flex", border: "1px solid #ff3333" }}>
    <input
      type="text"
      placeholder="CITY OR COORDS..."
      style={styles.targetInput}
      value={locationQuery}
      onChange={(e) => setLocationQuery(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && searchLocation()}
    />

    <button style={styles.targetBtn} onClick={searchLocation}>
      LOCATE
    </button>
  </div>

  {/* row: status message (under the input) */}
  {geocodeStatus?.message && (
    <div
      style={{
        marginTop: "10px",
        fontSize: "0.72rem",
        lineHeight: 1.3,
        color:
          geocodeStatus.type === "ok"
            ? "#00ff9d"
            : geocodeStatus.type === "warn"
            ? "#ffcc66"
            : "#ff7777",
        opacity: 0.95,
        borderTop: "1px dashed rgba(255,255,255,0.12)",
        paddingTop: "8px",
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}
    >
      {geocodeStatus.message}
    </div>
  )}
</div>


    <div style={styles.navBar}>
      <button style={styles.navButton} onClick={flyHome} title="RESET TO ORIGIN">
        <HomeIcon />
      </button>
      <button style={styles.navButton} onClick={zoomIn} title="ZOOM IN">
        <ZoomInIcon />
      </button>
      <button style={styles.navButton} onClick={zoomOut} title="ZOOM OUT">
        <ZoomOutIcon />
      </button>
    </div>

    {tleWarning && (
      <div style={styles.tleWarningBar}>
        ⚠ {tleWarning}
      </div>
    )}

    <div style={styles.bottomBar}>
      <div style={styles.clockSection}>
        <span style={{ color: "#888", fontSize: "0.7rem" }}>SIMULATION TIME:</span>
          <input type="datetime-local" value={simDateInput} onChange={handleDateChange} min={simMinDate} max={simMaxDate} style={styles.dateInput} />
      </div>

      <div style={styles.controlsGroup}>
        <button style={styles.playButton} onClick={togglePlay}>
          {isPaused ? "▶ START" : "|| HALT"}
        </button>

        <div style={styles.speedButtonGroup}>
          <button style={{ ...styles.speedBtn, opacity: multiplier === 1 ? 1 : 0.6 }} onClick={() => setSpeed(1)}>
            1x
          </button>
          <button style={{ ...styles.speedBtn, opacity: multiplier === 10 ? 1 : 0.6 }} onClick={() => setSpeed(10)}>
            10x
          </button>
          <button style={{ ...styles.speedBtn, opacity: multiplier === 100 ? 1 : 0.6 }} onClick={() => setSpeed(100)}>
            100x
          </button>
        </div>

        <div style={styles.customSpeedBox}>
          <span style={{ fontSize: "0.6rem", color: "#00aaff" }}>CUSTOM:</span>
          <input type="number" value={multiplier} onChange={(e) => setSpeed(e.target.value)} style={styles.numberInput} />
        </div>
      </div>
    </div>

    <Viewer
      full
      ref={viewerRef}
      shadows={true}
      terrainShadows={1}
      scene3DOnly={true}
      timeline={false}
      animation={false}
      baseLayerPicker={false}
      infoBox={false}
      selectionIndicator={false}
      homeButton={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      geocoder={false}
      shouldAnimate={true}
      useDefaultRenderLoop={true}
    >
      {/* 1) BACKGROUND SATELLITES */}
      {backgroundSatellites.map((sat) => (
        <Entity
          key={sat.id}
          properties={{ satId: sat.id }}
          name={sat.name}
          position={getSimpleCallback(sat)}
          point={{
            pixelSize: 6,
            color: Color.CYAN.withAlpha(0.8),
            outlineColor: Color.BLACK,
            outlineWidth: 1,
          }}
        />
      ))}

      {/* 2) SELECTED SATELLITE (only if visible in filter) */}
      {selectedSat && !isTleOutOfRange && (selectedSatPath || selectedSatPathRef.current) && isSelectionInFilter && (
        <>
          <Entity
            id="selected-sat-complex"
            name={selectedSat.name}
            properties={{ satId: selectedSat.id }}
            viewFrom={new Cartesian3(-2000000, 0, 1000000)}
            position={selectedSatPath || selectedSatPathRef.current}
            point={{
              pixelSize: 12,
              color: Color.WHITE,
              outlineColor: Color.ORANGE,
              outlineWidth: 2,
            }}
            path={{
              resolution: 1,
              leadTime: 0,
              trailTime: 5400,
              width: 5,
              material: new PolylineGlowMaterialProperty({
                glowPower: 0.25,
                taperPower: 0.5,
                color: Color.ORANGE,
              }),
            }}
          />

          {/* Custom selection indicator */}
          <Entity position={selectedSatPath || selectedSatPathRef.current}>
            <BillboardGraphics
              image={`data:image/svg+xml;utf8,${encodeURIComponent(
                `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'>
                  <path d='M30 10 H10 V30 M98 10 H118 V30 M30 118 H10 V98 M98 118 H118 V98'
                        fill='none' stroke='white' stroke-width='6' />
                  <circle cx='64' cy='64' r='40' fill='none' stroke='white' stroke-width='2' stroke-dasharray='8 4' />
                </svg>`
              )}`}
              scale={selectionVisuals.scale}
              rotation={selectionVisuals.rotation}
              color={isTracked ? Color.fromCssColorString("#FF3300") : Color.fromCssColorString("#00FBFF")}
              verticalOrigin={VerticalOrigin.CENTER}
              disableDepthTestDistance={Number.POSITIVE_INFINITY}
            />
          </Entity>

          {/* Cone helper (pickable; we'll fix selection via drillPick in handler) */}
          <Entity
            id="selected-sat-cone"
            position={
              new CallbackProperty((time) => {
                const pathToUse = selectedSatPath || selectedSatPathRef.current;
                if (!pathToUse) return undefined;

                const satPos = pathToUse.getValue(time);
                if (!satPos) return undefined;

                const offset = Cartesian3.normalize(satPos, new Cartesian3());
                Cartesian3.multiplyByScalar(offset, -350000, offset);
                return Cartesian3.add(satPos, offset, new Cartesian3());
              }, false)
            }
          >
            <CylinderGraphics
              length={700000}
              topRadius={10000}
              bottomRadius={150000}
              material={Color.GREEN.withAlpha(0.2)}
              slices={16}
            />
          </Entity>

          {/* Future dashed path */}
          <Entity>
            <PolylineGraphics
              positions={getDynamicFuturePath(selectedSat)}
              width={2}
              material={new PolylineDashMaterialProperty({
                color: Color.CYAN.withAlpha(0.8),
                dashLength: 20.0,
              })}
            />
          </Entity>
        </>
      )}

      {selectedSat && isTleOutOfRange && isSelectionInFilter && (
        <Entity
          id="selected-sat-simple"
          name={selectedSat.name}
          properties={{ satId: selectedSat.id }}
          position={getSimpleCallback(selectedSat)}
          point={{
            pixelSize: 12,
            color: Color.ORANGE.withAlpha(0.95),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
          }}
        />
      )}


      {/* Ground target */}
      {groundTarget && (
        <>
          <Entity id="ground-target-area" position={groundTarget.position} name={groundTarget.name}>
            <EllipseGraphics
              semiMajorAxis={scanRadius * 1000}
              semiMinorAxis={scanRadius * 1000}
              material={Color.RED.withAlpha(0.1)}
              outline={true}
              outlineColor={Color.RED.withAlpha(0.5)}
              height={0}
            />
          </Entity>

          {/* Separate entity for the vertical marker (CylinderGraphics doesn't take position prop) */}
          <Entity
            id="ground-target-pillar"
            position={Cartesian3.fromDegrees(groundTarget.lon, groundTarget.lat, 100000)}
          >
            <CylinderGraphics
              length={200000}
              topRadius={500}
              bottomRadius={500}
              material={Color.RED.withAlpha(0.6)}
            />
          </Entity>
        </>
      )}
    </Viewer>
  </div>
  );
};
const styles = {
  // --- GLOBAL OVERLAYS ---
  portraitOverlay: {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    background: 'radial-gradient(circle at center, #0a0e17 0%, #000 100%)', // Darker, cleaner
    color: '#00ccff', zIndex: 9999, flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: '"JetBrains Mono", "Consolas", monospace', textAlign: 'center', padding: '20px',
    border: '4px solid #ff4444' // Warning border
  },

  loadingOverlay: {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    background: '#05070a', 
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, color: '#00ccff', fontFamily: '"JetBrains Mono", monospace',
    backgroundImage: 'linear-gradient(rgba(0, 204, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 204, 255, 0.03) 1px, transparent 1px)',
    backgroundSize: '30px 30px' // Grid effect
  },

  // --- TOP CONTROLS ---
  toggleButton: { 
    position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', 
    zIndex: 1001, 
    background: 'rgba(10, 14, 23, 0.9)', 
    border: '1px solid rgba(0, 204, 255, 0.5)',
    borderBottom: '2px solid #00ccff',
    color: '#00ccff', padding: '10px 30px', 
    fontFamily: '"JetBrains Mono", monospace', 
    cursor: 'pointer', fontWeight: 'bold', letterSpacing: '2px', textTransform: 'uppercase',
    backdropFilter: 'blur(8px)', 
    boxShadow: '0 0 15px rgba(0, 204, 255, 0.15)',
    clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)', // Chamfered corners
    transition: 'all 0.2s', outline: 'none'
  },

  // --- SEARCH PANEL (Center Top) ---
  searchContainer: { 
    position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', 
    zIndex: 1000, 
    background: 'rgba(10, 14, 23, 0.95)', 
    border: '1px solid rgba(0, 204, 255, 0.3)', 
    borderLeft: '4px solid #00ccff', // Tech accent
    padding: '20px', 
    width: '460px', 
    fontFamily: '"JetBrains Mono", monospace', 
    backdropFilter: 'blur(12px)', 
    boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)', // Sci-fi cut
    boxSizing: 'border-box'
  },

  searchLabel: { 
    color: '#00ccff', fontSize: '0.7rem', marginBottom: '8px', 
    fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.8 
  },

  searchInput: { 
    width: '100%', 
    background: 'rgba(0, 0, 0, 0.4)', 
    border: '1px solid rgba(0, 204, 255, 0.2)', 
    borderBottom: '2px solid rgba(0, 204, 255, 0.5)',
    color: '#fff', 
    padding: '12px', 
    fontFamily: 'inherit', fontSize: '1rem',
    outline: 'none', 
    textTransform: 'uppercase', 
    borderRadius: '2px',
    boxSizing: 'border-box',
    marginBottom: '10px',
    transition: 'border-color 0.3s'
  },

  advButton: {
    color: '#6b8bad', // Muted blue
    cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '1px',
    display: 'flex', alignItems: 'center', padding: '8px 0',
    transition: 'color 0.2s', textTransform: 'uppercase'
  },

  resultCount: { 
    marginTop: '10px', paddingTop: '8px',
    borderTop: '1px dashed rgba(0, 204, 255, 0.2)',
    color: '#00ff9d', // Matrix Green
    fontSize: '0.8rem', fontWeight: 'bold', textAlign: 'right', letterSpacing: '1px',
    textShadow: '0 0 8px rgba(0, 255, 157, 0.4)'
  },

  // --- ADVANCED FILTERS PANEL ---
  advPanel: { 
    marginTop: '15px', padding: '15px', 
    background: 'rgba(0, 0, 0, 0.3)', 
    border: '1px solid rgba(0, 204, 255, 0.15)', 
  },
  filterRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  smallInput: { 
    width: '70px', background: '#05070a', border: '1px solid #00ccff44', 
    color: '#00ccff', fontSize: '0.8rem', padding: '6px', textAlign: 'center', fontFamily: 'inherit' 
  },

  // --- RIGHT PANELS (Intercept & Target) ---
  // Shared base style for side panels
  _panelBase: {
    zIndex: 1000, width: '300px', padding: '15px',
    fontFamily: '"JetBrains Mono", monospace',
    backdropFilter: 'blur(10px)',
    background: 'linear-gradient(135deg, rgba(10,14,23,0.9) 0%, rgba(10,14,23,0.8) 100%)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  },

  interceptContainer: { 
    position: 'absolute', top: '200px', right: '20px', 
    zIndex: 1000, width: '300px', padding: '15px',
    fontFamily: '"JetBrains Mono", monospace', backdropFilter: 'blur(10px)',
    background: 'rgba(5, 20, 10, 0.9)', // Slight green tint
    border: '1px solid rgba(0, 255, 0, 0.2)',
    borderTop: '3px solid #00ff9d',
    clipPath: 'polygon(15px 0, 100% 0, 100% 100%, 0 100%, 0 15px)' // Top-left cut
  },

  interceptItem: { 
    display: 'flex', justifyContent: 'space-between', padding: '8px 10px', 
    marginBottom: '4px', background: 'rgba(0, 255, 157, 0.05)', 
    color: '#ccffdd', fontSize: '0.75rem', cursor: 'pointer', transition: 'all 0.2s',
    borderLeft: '2px solid transparent',
    // Hover style needs to be handled in JS or CSS class, but default here is clean
  },

  locationContainer: { 
    position: 'absolute', top: '20px', right: '20px', 
    zIndex: 1000, width: '300px', padding: '15px',
    fontFamily: '"JetBrains Mono", monospace', backdropFilter: 'blur(10px)',
    background: 'rgba(20, 5, 5, 0.9)', // Slight red tint
    border: '1px solid rgba(255, 68, 68, 0.2)',
    borderTop: '3px solid #ff4444',
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%)' // Bottom-right cut
  },

  targetInput: { 
    flex: 1, background: 'rgba(0, 0, 0, 0.5)', 
    border: '1px solid #ff4444', borderRight: 'none',
    color: '#fff', padding: '10px', fontFamily: 'inherit', outline: 'none', 
    textTransform: 'uppercase', fontSize: '0.85rem'
  },

  targetBtn: {
    width: "52px",
    height: "52px",
    padding: 0,
    background: "rgba(255, 68, 68, 0.2)",
    border: "1px solid #ff4444",
    color: "#ff4444",
    fontWeight: "bold",
    cursor: "pointer",
    transition: "all 0.3s",
    textTransform: "uppercase",
    fontSize: "0.7rem",
    letterSpacing: "1px",
    boxShadow: "0 0 10px rgba(255, 68, 68, 0.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // --- CENTER TRACKING BUTTON ---
  trackingControl: { position: 'absolute', bottom: '120px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000 },
  
  trackButton: { 
    padding: '12px 40px', fontFamily: '"JetBrains Mono", monospace', fontWeight: 'bold', 
    cursor: 'pointer', fontSize: '0.9rem', textTransform: 'uppercase', 
    letterSpacing: '3px', transition: 'all 0.3s', 
    background: 'rgba(0, 0, 0, 0.6)',
    color: '#fff',
    border: '1px solid #fff',
    boxShadow: '0 0 20px rgba(255,255,255,0.1)',
    clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)'
  },

  // --- NAVIGATION STACK (Right Side) ---
  navBar: { position: 'absolute', top: '85%', left: '20px', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '15px', zIndex: 1000 },
  
  navButton: { 
    background: 'rgba(10, 14, 23, 0.8)', 
    border: '1px solid rgba(0, 204, 255, 0.3)', 
    color: '#00ccff', 
    width: '50px', height: '50px', 
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', 
    backdropFilter: 'blur(4px)', transition: 'all 0.2s', outline: 'none',
    boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
    clipPath: 'polygon(30% 0, 100% 0, 100% 70%, 70% 100%, 0 100%, 0 30%)' // Hex-like tech shape
  },

  // --- BOTTOM CONSOLE (Timeline) ---
  bottomBar: { 
    position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', 
    width: '94%', maxWidth: '1200px', height: '80px', 
    background: 'linear-gradient(180deg, rgba(10,14,23,0.9) 0%, rgba(5,7,12,0.95) 100%)', 
    borderTop: '1px solid rgba(0, 204, 255, 0.4)', 
    borderBottom: '4px solid #00ccff', // Bottom anchor
    display: 'flex', alignItems: 'center', 
    justifyContent: 'space-between', padding: '0 30px', zIndex: 1000, 
    backdropFilter: 'blur(20px)', 
    clipPath: 'polygon(20px 0, calc(100% - 20px) 0, 100% 100%, 0 100%)', // Trapezoid
    boxShadow: '0 -10px 30px rgba(0,0,0,0.5)'
  },

  clockSection: { display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(0, 204, 255, 0.15)', paddingRight: '40px' },
  
  dateInput: { 
    background: 'transparent', border: 'none', color: '#fff', 
    fontFamily: '"JetBrains Mono", monospace', marginTop: '2px', padding: '4px', fontSize: '1.1rem', outline: 'none',
    letterSpacing: '1px', fontWeight: 'bold'
  },

  controlsGroup: { display: 'flex', alignItems: 'center', gap: '20px' },
  
  playButton: { 
    background: 'rgba(0, 255, 157, 0.1)', border: '1px solid #00ff9d', color: '#00ff9d', 
    padding: '8px 40px', cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace', fontWeight: 'bold', 
    fontSize: '1rem', letterSpacing: '2px', textTransform: 'uppercase',
    boxShadow: '0 0 15px rgba(0, 255, 157, 0.15)'
  },

  speedBtn: { 
    background: 'transparent', border: '1px solid rgba(0, 204, 255, 0.3)', color: '#6b8bad', 
    padding: '6px 12px', margin: '0 4px', cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace', 
    fontSize: '0.75rem', transition: '0.2s' 
  },

  numberInput: { 
    background: 'transparent', border: 'none', borderBottom: '2px solid #00ccff', 
    color: '#fff', width: '70px', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace', 
    fontSize: '1.4rem', fontWeight: 'bold', outline: 'none', margin: '0 10px'
  },

  // --- MISC / ANIMATIONS ---
  matrixText: {
    marginTop: '20px', fontSize: '0.9rem', color: '#00ccff', 
    textShadow: '0 0 10px #00ccff', letterSpacing: '4px', textTransform: 'uppercase'
  },
  
  scanBar: {
    width: '400px', height: '2px', background: '#00ccff',
    boxShadow: '0 0 25px #00ccff', marginTop: '30px',
    animation: 'scanAnim 1.5s infinite ease-in-out'
  },
  interceptList: {
    maxHeight: "220px",
    overflowY: "auto",
    paddingRight: "6px",
    marginTop: "8px",
  },

  tleWarningBar: {
    position: "absolute",
    bottom: "120px", left: "50%", transform: "translateX(-50%)",
    zIndex: 2000,
    background: "rgba(30, 0, 0, 0.85)",
    border: "1px solid #ff4444",
    borderLeft: "6px solid #ff4444",
    color: "#ffcccc",
    padding: "12px 20px",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: "0.8rem",
    maxWidth: "600px", textAlign: "center",
    backdropFilter: "blur(4px)",
    boxShadow: "0 0 20px rgba(255, 0, 0, 0.2)",
    clipPath: "polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)"
  },
};



export default GlobeViewer; 