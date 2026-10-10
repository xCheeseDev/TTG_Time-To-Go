// ============================================================
// TTG — Time To Go (v4: map-first + live vehicles + camera follow)
//
// PURPOSE:
//   Show you the incoming bus or train you need to take, verbally
//   tell you when to leave the house to make it to your stop or
//   station, and provide a synced video feed — where available —
//   showing a truly live view of your ride as it passes specific
//   stops and stations.
//
//   Covers: buses, subways/metro, and above-ground trains
//   (regional rail like GO, intercity like VIA).
//
//   TTG works WORLDWIDE. Every transit system plugs in through the
//   TRANSIT_SYSTEMS registry below. To add a city:
//
//     1. Add an entry: { id, name, city, country, routes, stops,
//        getArrivals, getCameraUrl }.
//     2. Give each route a mode: "bus", "subway", or "train".
//     3. Give each stop a lat/lng so it appears on the map.
//     4. Implement getArrivals(stopId) using that agency's
//        real-time API (most publish GTFS-realtime). Return:
//          [{ route, destination, minutesAway }]
//     5. Implement getCameraUrl(stopId) if the agency exposes
//        stop/station cameras; return null otherwise.
//
//   The countdown, voice alerts and UI work unchanged for every
//   system and mode you add.
// ============================================================

const BUFFER_MINUTES = 2; // safety buffer so you never miss it

const MODE_ICON = { bus: "🚌", subway: "🚇", train: "🚆", tram: "🚋" };
const DEFAULT_CENTER = [41.3874, 2.1686]; // Barcelona

// --- Simulated arrivals for the demo system (replace per city) ---
const DEMO_ARRIVALS = [
  { route: "10",  destination: "Downtown",      minutesAway: 14 },
  { route: "10",  destination: "Downtown",      minutesAway: 29 },
  { route: "42",  destination: "Airport",       minutesAway: 22 },
  { route: "red", destination: "Northgate",    minutesAway: 6  },
  { route: "red", destination: "South End",    minutesAway: 16 },
  { route: "lw",  destination: "Union Station", minutesAway: 35 },
  { route: "t1",  destination: "Barceloneta", minutesAway: 11 },
];

const TRANSIT_SYSTEMS = [
  {
    id: "demo",
    name: "Demo City Transit",
    city: "Demo City",
    country: "—",
    routes: [
      { id: "10",  name: "Route 10",      mode: "bus",
        path: [[41.3874,2.1686],[41.3935,2.1695],[41.3990,2.1715],[41.4036,2.1744]] },
      { id: "42",  name: "Route 42",      mode: "bus",
        path: [[41.3874,2.1686],[41.3820,2.1780],[41.3780,2.1850],[41.3755,2.1900]] },
      { id: "red", name: "Red Line",      mode: "subway",
        path: [[41.3874,2.1686],[41.3960,2.1630],[41.4060,2.1570],[41.4145,2.1527]] },
      { id: "lw",  name: "Lakeshore West", mode: "train",
        path: [[41.3874,2.1686],[41.3850,2.1520],[41.3825,2.1370],[41.3809,2.1228]] },
      { id: "t1",  name: "T1 Tramvia",    mode: "tram",
        path: [[41.3874,2.1686],[41.3800,2.1760],[41.3755,2.1900]] },
    ],
    stops: [
      { id: "demo-100", name: "Plaça de Catalunya", routes: ["10", "42", "red", "lw", "t1"], lat: 41.3874, lng: 2.1686 },
      { id: "demo-200", name: "Sagrada Família",    routes: ["10"],                   lat: 41.4036, lng: 2.1744 },
      { id: "demo-300", name: "Barceloneta Beach",  routes: ["42"],                   lat: 41.3755, lng: 2.1900 },
      { id: "demo-400", name: "Park Güell",         routes: ["red"],                  lat: 41.4145, lng: 2.1527 },
      { id: "demo-500", name: "Camp Nou",           routes: ["lw"],                   lat: 41.3809, lng: 2.1228 },
    ],
    // TODO: replace with fetch() to this agency's real-time API.
    async getArrivals(stopId) {
      return DEMO_ARRIVALS.map((b) => ({ ...b }));
    },
    // TODO: return a stream URL when a camera exists for the stop/station.
    async getCameraUrl(stopId) {
      return null;
    },
    // TODO: return this agency's real traffic/station camera positions.
    async getTrafficCameras() {
      return DEMO_CAMERAS.map((c) => ({ ...c }));
    },
  },

  // ---- How a real major system plugs in (example) ----
  // {
  //   id: "tfl",
  //   name: "Transport for London",
  //   city: "London",
  //   country: "UK",
  //   routes: [
  //     { id: "15",       name: "Route 15",    mode: "bus"    },
  //     { id: "northern", name: "Northern Line", mode: "subway" },
  //   ],
  //   stops: [ { id: "490008660N", name: "Oxford Circus", routes: ["15", "northern"],
  //              lat: 51.5154, lng: -0.1419 } ],
  //   async getArrivals(stopId) {
  //     const res = await fetch(`https://api.tfl.gov.uk/StopPoint/${stopId}/Arrivals?app_key=YOUR_KEY`);
  //     const data = await res.json();
  //     return data.map((a) => ({
  //       route: a.lineId,
  //       destination: a.destinationName,
  //       minutesAway: Math.max(1, Math.round(a.timeToStation / 60)),
  //     }));
  //   },
  //   async getCameraUrl(stopId) { return null; },
  // },
];

const state = {
  systemId: TRANSIT_SYSTEMS[0].id,
  routeId: "all", // or a specific route id: "the bus or train you need to take"
  stopId: TRANSIT_SYSTEMS[0].stops[0].id,
  walkMinutes: 8,
  voiceOn: false,
  said: {},       // announcements already spoken (don't repeat)
  arrivals: [],
  userLatLng: null,
};

function system() {
  return TRANSIT_SYSTEMS.find((s) => s.id === state.systemId);
}

function routeById(id) {
  return system().routes.find((r) => r.id === id) || { id, name: id, mode: "bus" };
}

// ---------------- voice ----------------
function speak(text) {
  if (!state.voiceOn || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.cancel(); // never stack up old announcements
  speechSynthesis.speak(u);
}

function announceOnce(key, text) {
  if (state.said[key]) return;
  state.said[key] = true;
  speak(text);
}

// Natural phrasing per mode: "route 10" vs "the Red Line"
function spokenRoute(route) {
  return route.mode === "bus" ? `route ${route.id}` : `the ${route.name}`;
}

// ---------------- camera feed ----------------
async function loadCameraFeed() {
  const box = document.getElementById("cameraBox");
  try {
    const url = await system().getCameraUrl(state.stopId);
    if (url) {
      box.classList.remove("camera-placeholder");
      box.innerHTML = `<video src="${url}" autoplay muted playsinline controls></video>`;
      return;
    }
  } catch (e) {
    console.warn("Camera feed failed:", e);
  }
  box.classList.add("camera-placeholder");
  box.innerHTML = `
    <p>📷 No live camera linked for this stop yet.</p>
    <p class="small">Where a camera feed exists for your stop or station, it appears here — synced to your location so you can watch your ride pass in real time.</p>`;
}

// ---------------- arrivals ----------------
async function refreshArrivals() {
  try {
    state.arrivals = await system().getArrivals(state.stopId);
  } catch (e) {
    console.warn("Arrival fetch failed:", e);
    state.arrivals = [];
  }
  tick();
}

// ---------------- main loop ----------------
function tick() {
  let arrivals = [...state.arrivals].sort((a, b) => a.minutesAway - b.minutesAway);
  if (state.routeId !== "all") {
    arrivals = arrivals.filter((b) => b.route === state.routeId);
  }
  const next = arrivals[0];

  const busInfo = document.getElementById("busInfo");
  const badge = document.getElementById("leaveBadge");

  if (!next) {
    busInfo.innerHTML = "<p>No upcoming arrivals match. Try another route or stop.</p>";
    badge.textContent = "—";
    badge.className = "leave-badge waiting";
    return;
  }

  const route = routeById(next.route);
  const icon = MODE_ICON[route.mode] || "🚌";
  const stopName = (system().stops.find((s) => s.id === state.stopId) || {}).name || "";
  const leaveIn = Math.max(0, Math.ceil(next.minutesAway - state.walkMinutes - BUFFER_MINUTES));
  const spoken = spokenRoute(route);

  busInfo.innerHTML = `
    <p class="route">${icon} ${route.name} — ${next.destination}</p>
    <p class="eta">Arrives in ~${Math.ceil(next.minutesAway)} min · ${stopName}</p>
  `;

  if (leaveIn <= 0) {
    badge.textContent = "🚨 LEAVE NOW";
    badge.className = "leave-badge now";
    announceOnce(`now-${route.id}-${Math.ceil(next.minutesAway)}`,
      `Leave now to catch ${spoken} to ${next.destination}.`);
  } else if (leaveIn <= 5) {
    badge.textContent = `Leave in ${leaveIn} min`;
    badge.className = "leave-badge soon";
    announceOnce(`soon-${route.id}-${leaveIn}`,
      `Leave in ${leaveIn} minutes to catch ${spoken} to ${next.destination}.`);
  } else {
    badge.textContent = `Leave in ${leaveIn} min`;
    badge.className = "leave-badge waiting";
  }
}

// ---------------- map ----------------
let map = null;
let userMarker = null;
let searchMarker = null;
const stopMarkers = {}; // stopId -> L.Marker

function stopIcon(selected) {
  return L.divIcon({
    className: "stop-marker" + (selected ? " selected" : ""),
    html: "🚏",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function initMap() {
  map = L.map("map", { zoomControl: false }).setView(DEFAULT_CENTER, 13);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Free tiles, no API key, no account: OpenStreetMap standard.
  // (CARTO's basemaps now watermark without a key, so we use OSM direct.)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  renderStopMarkers();
  initVehicleLayer();
  locateUser(false);

  document.getElementById("locateBtn").addEventListener("click", () => locateUser(true));
}

function renderStopMarkers() {
  // clear old
  Object.values(stopMarkers).forEach((m) => map.removeLayer(m));
  for (const k of Object.keys(stopMarkers)) delete stopMarkers[k];

  system().stops.forEach((stop) => {
    if (stop.lat == null || stop.lng == null) return;
    const marker = L.marker([stop.lat, stop.lng], {
      icon: stopIcon(stop.id === state.stopId),
      title: stop.name,
    }).addTo(map);
    marker.bindPopup(`<b>${stop.name}</b><br><button data-stop="${stop.id}" class="popup-btn">Track this stop</button>`);
    marker.on("click", () => {
      // popup button wires up after open
      setTimeout(() => {
        const btn = document.querySelector(`button[data-stop="${stop.id}"]`);
        if (btn) btn.addEventListener("click", () => selectStop(stop.id, true));
      }, 50);
    });
    stopMarkers[stop.id] = marker;
  });
}

function selectStop(stopId, flyTo) {
  state.stopId = stopId;
  state.said = {};
  document.getElementById("stopSelect").value = stopId;
  // refresh selected highlight
  Object.entries(stopMarkers).forEach(([id, m]) => m.setIcon(stopIcon(id === stopId)));
  const stop = system().stops.find((s) => s.id === stopId);
  if (flyTo && stop && stop.lat != null) map.flyTo([stop.lat, stop.lng], 15, { duration: 0.8 });
  loadCameraFeed();
  refreshArrivals();
}

function locateUser(announce) {
  if (!("geolocation" in navigator)) {
    if (announce) alert("Geolocation isn't available in this browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      state.userLatLng = latlng;
      if (userMarker) {
        userMarker.setLatLng(latlng);
      } else {
        userMarker = L.marker(latlng, {
          icon: L.divIcon({ className: "user-marker", html: "", iconSize: [18, 18], iconAnchor: [9, 9] }),
          title: "You are here",
        }).addTo(map);
      }
      map.flyTo(latlng, 14, { duration: 1 });
    },
    () => {
      if (announce) alert("Couldn't get your location — check the browser permission.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------------- live vehicle tracking ----------------
// Shows live bus/train/metro/tram icons driving around the map.
//
// How the smoothness works: real trackers (GTFS-RT vehicle positions,
// agency APIs) only emit a new position roughly every 30 seconds. If we
// just jumped each icon fix-to-fix, motion would look like teleporting.
// Instead this layer keeps each vehicle's last TWO fixes and
// interpolates between them every animation frame, so icons glide at a
// constant smooth speed. If a poll is late, it dead-reckons a little
// past the last fix along the same heading, then holds.
//
// The demo "feed" below simulates those 30s polls. When a real agency
// feed is plugged in, only pollVehicleFeed() changes — the
// interpolation layer works identically on real fixes.
const TRACK_INTERVAL_MS = 30000; // real trackers poll ~every 30s

const VEHICLE_ICON = {
  bus:    { src: () => VEHICLE_IMG.bus,   size: [64, 44] },
  subway: { src: () => VEHICLE_IMG.metro, size: [77, 44] },
  train:  { src: () => VEHICLE_IMG.train, size: [56, 44] },
  tram:   { src: () => VEHICLE_IMG.tram,  size: [64, 44] },
};

// Modes the user wants to see; persisted so it survives reloads.
let vehicleModes = (() => {
  const defaults = { bus: true, subway: true, train: true, tram: true };
  try {
    const saved = JSON.parse(localStorage.getItem("ttg-vehicle-modes"));
    if (saved) return { ...defaults, ...saved };
  } catch (e) { /* corrupted storage -> defaults */ }
  return defaults;
})();

// Ground-truth simulation standing in for a real agency feed.
// Each entry: { id, routeId, mode, path, cum, total, dist, dir, speed,
//               marker, fixA, fixB }
const fleet = [];

function haversineM(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLng = (b[1] - a[1]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Position at `d` meters along a path (with cumulative segment lengths).
function pointAtDistance(path, cum, d) {
  d = Math.max(0, Math.min(cum[cum.length - 1], d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / segLen;
  const a = path[i - 1], b = path[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function vehicleIcon(routeId, mode) {
  const cfg = VEHICLE_ICON[mode] || VEHICLE_ICON.bus;
  return L.divIcon({
    className: "vehicle",
    html: `<img src="${cfg.src()}" alt="${mode}" style="width:${cfg.size[0]}px;height:${cfg.size[1]}px">` +
          `<span class="vehicle-badge">${routeId}</span>`,
    iconSize: [cfg.size[0], cfg.size[1]],
    iconAnchor: [cfg.size[0] / 2, cfg.size[1] / 2],
  });
}

function spawnFleet() {
  // routeId, how many vehicles, cruising speed (m/s)
  const specs = [
    { routeId: "10",  count: 2, speed: 8 },
    { routeId: "42",  count: 2, speed: 8 },
    { routeId: "red", count: 2, speed: 12 },
    { routeId: "lw",  count: 2, speed: 16 },
    { routeId: "t1",  count: 2, speed: 7 },
  ];
  const now = Date.now();
  specs.forEach(({ routeId, count, speed }) => {
    const route = routeById(routeId);
    if (!route.path) return;
    const path = route.path;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversineM(path[i - 1], path[i]));
    const total = cum[cum.length - 1];
    for (let n = 0; n < count; n++) {
      const dist = (total * (n + 0.5)) / count; // spread along the line
      const dir = n % 2 === 0 ? 1 : -1;
      const pB = pointAtDistance(path, cum, dist);
      const pA = pointAtDistance(path, cum, dist - dir * speed * (TRACK_INTERVAL_MS / 1000));
      const v = {
        id: `${routeId}-${n}`, routeId, mode: route.mode,
        path, cum, total, dist, dir, speed,
        fixA: { lat: pA[0], lng: pA[1], t: now - TRACK_INTERVAL_MS },
        fixB: { lat: pB[0], lng: pB[1], t: now },
        marker: null,
      };
      const label = route.mode === "bus" ? `Route ${route.name.replace("Route ", "")}` : route.name;
      v.marker = L.marker([pB[0], pB[1]], {
        icon: vehicleIcon(routeId, route.mode),
        title: `${label} — tap for live camera`,
        zIndexOffset: 500,
      });
      v.marker.on("click", () => openFollowCard(v));
      fleet.push(v);
    }
  });
  applyVehicleVisibility();
}

// One "poll" of the (simulated) tracking feed: advance every vehicle's
// ground truth by a full interval and emit a fresh fix, exactly like a
// real API returning new vehicle positions.
function pollVehicleFeed() {
  const now = Date.now();
  fleet.forEach((v) => {
    v.dist += v.dir * v.speed * (TRACK_INTERVAL_MS / 1000);
    if (v.dist >= v.total) { v.dist = 2 * v.total - v.dist; v.dir = -1; } // ping-pong
    if (v.dist <= 0)       { v.dist = -v.dist;               v.dir = 1; }
    const [lat, lng] = pointAtDistance(v.path, v.cum, v.dist);
    v.fixA = v.fixB;
    v.fixB = { lat, lng, t: now };
  });
}

// Every animation frame: place each icon by interpolating between its
// last two fixes. Constant speed, zero jumping.
function renderVehicles() {
  const now = Date.now();
  for (const v of fleet) {
    if (!v.marker || !vehicleModes[v.mode]) continue;
    const dt = v.fixB.t - v.fixA.t;
    let alpha = dt > 0 ? (now - v.fixA.t) / dt : 1;
    alpha = Math.min(alpha, 1.5); // dead-reckon briefly past the last fix, then hold
    const lat = v.fixA.lat + (v.fixB.lat - v.fixA.lat) * alpha;
    const lng = v.fixA.lng + (v.fixB.lng - v.fixA.lng) * alpha;
    v.rendered = [lat, lng];
    v.marker.setLatLng([lat, lng]);
  }
  if (follow.vehicle) {
    checkCameraHandoff(now);
    drawFollowFrame(now);
  }
  requestAnimationFrame(renderVehicles);
}

function applyVehicleVisibility() {
  if (!map) return;
  fleet.forEach((v) => {
    const show = !!vehicleModes[v.mode];
    const onMap = map.hasLayer(v.marker);
    if (show && !onMap) v.marker.addTo(map);
    if (!show && onMap) map.removeLayer(v.marker);
  });
  if (follow.vehicle && !vehicleModes[follow.vehicle.mode]) closeFollowCard();
}

function initVehicleLayer() {
  spawnFleet();
  pollVehicleFeed(); // first real fix immediately so nothing sits still
  preloadSprites();
  refreshTrafficCameras();
  renderVehicles();
  setInterval(pollVehicleFeed, TRACK_INTERVAL_MS);
}

// ---------------- transport filter (circle -> expanding bar) ----------------
function initTransportFilter() {
  const fab = document.getElementById("transportFab");
  const bar = document.getElementById("transportBar");
  fab.addEventListener("click", () => bar.classList.toggle("open"));
  bar.querySelectorAll(".transport-chip").forEach((chip) => {
    const mode = chip.dataset.mode;
    const sync = () => chip.setAttribute("aria-pressed", String(!!vehicleModes[mode]));
    sync();
    chip.addEventListener("click", () => {
      vehicleModes[mode] = !vehicleModes[mode];
      try { localStorage.setItem("ttg-vehicle-modes", JSON.stringify(vehicleModes)); } catch (e) {}
      sync();
      applyVehicleVisibility();
    });
  });
}

// ---------------- traffic cameras + LIVE vehicle follow ----------------
// Clicking a vehicle icon opens a LIVE follow card showing that vehicle's
// camera feed. The app "scours" the transit system's traffic/station
// cameras (via getTrafficCameras()), picks the one nearest the vehicle,
// and hands off to the next camera as the vehicle drives out of range —
// like watching it pass from camera to camera.
//
// Demo feeds are simulated on a canvas (watermarked SIMULATED FEED). A
// real agency would return stream URLs from getTrafficCameras() and the
// card would play them in a <video> element instead.
const DEMO_CAMERAS = [
  { id: "cam-cat",  name: "Plaça de Catalunya", lat: 41.3874, lng: 2.1686 },
  { id: "cam-eix",  name: "Gran Via / Eixample", lat: 41.3935, lng: 2.1695 },
  { id: "cam-sag",  name: "Sagrada Família",    lat: 41.4036, lng: 2.1744 },
  { id: "cam-pob",  name: "Poblenou",           lat: 41.3820, lng: 2.1780 },
  { id: "cam-bar",  name: "Barceloneta",        lat: 41.3755, lng: 2.1900 },
  { id: "cam-gra",  name: "Gràcia",             lat: 41.3960, lng: 2.1630 },
  { id: "cam-gue",  name: "Park Güell",         lat: 41.4145, lng: 2.1527 },
  { id: "cam-san",  name: "Sants",              lat: 41.3850, lng: 2.1520 },
  { id: "cam-les",  name: "Les Corts",          lat: 41.3825, lng: 2.1370 },
  { id: "cam-camp", name: "Camp Nou",           lat: 41.3809, lng: 2.1228 },
];
const HANDOFF_RADIUS_M = 600; // switch cameras when the vehicle leaves this range
const MODE_TO_IMGKEY = { bus: "bus", subway: "metro", train: "train", tram: "tram" };

let trafficCameras = [];
const follow = { vehicle: null, camera: null, camSince: 0, handoffAt: 0, lastCheck: 0 };
const spriteImgs = {};

async function refreshTrafficCameras() {
  try {
    trafficCameras = (await system().getTrafficCameras()) || [];
  } catch (e) {
    console.warn("Traffic camera fetch failed:", e);
    trafficCameras = [];
  }
}

function nearestCamera(lat, lng) {
  let best = null, bestD = Infinity;
  for (const c of trafficCameras) {
    const d = haversineM([lat, lng], [c.lat, c.lng]);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= HANDOFF_RADIUS_M ? best : null;
}

function preloadSprites() {
  Object.entries(MODE_TO_IMGKEY).forEach(([mode, key]) => {
    const img = new Image();
    img.src = VEHICLE_IMG[key];
    spriteImgs[mode] = img;
  });
}

function updateFollowTitle() {
  const title = document.getElementById("followTitle");
  const sub = document.getElementById("followCam");
  if (follow.camera) {
    title.textContent = `LIVE · ${follow.camera.name}`;
    sub.textContent = "traffic camera";
  } else {
    title.textContent = "LIVE · no camera in range";
    sub.textContent = "following on map until coverage resumes";
  }
}

function openFollowCard(v) {
  follow.vehicle = v;
  const pos = v.rendered || [v.fixB.lat, v.fixB.lng];
  follow.camera = nearestCamera(pos[0], pos[1]);
  follow.camSince = Date.now();
  follow.handoffAt = 0;
  const route = routeById(v.routeId);
  const label = route.mode === "bus" ? `Route ${route.name.replace("Route ", "")}` : route.name;
  document.getElementById("followVehicle").textContent =
    `${MODE_ICON[route.mode] || "🚌"} ${label}`;
  document.getElementById("followCard").hidden = false;
  updateFollowTitle();
}

function closeFollowCard() {
  follow.vehicle = null;
  follow.camera = null;
  document.getElementById("followCard").hidden = true;
}

// Throttled: re-scour cameras a couple of times a second and hand off
// when a nearer camera takes over (or coverage drops out).
function checkCameraHandoff(now) {
  const v = follow.vehicle;
  if (!v || !v.rendered || now - follow.lastCheck < 700) return;
  follow.lastCheck = now;
  const cam = nearestCamera(v.rendered[0], v.rendered[1]);
  const changed = (cam && !follow.camera) || (!cam && follow.camera) ||
    (cam && follow.camera && cam.id !== follow.camera.id);
  if (changed) {
    follow.camera = cam;
    follow.camSince = now;
    follow.handoffAt = now;
    updateFollowTitle();
  }
}

function drawFollowFrame(now) {
  const v = follow.vehicle;
  if (!v) return;
  const canvas = document.getElementById("followCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // --- street scene ---
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, "#8fb8dd"); sky.addColorStop(1, "#d9e9f4");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.55);
  const seed = follow.camera
    ? [...follow.camera.id].reduce((a, c) => a + c.charCodeAt(0), 0) : 7;
  let bx = 0, i = 0;
  while (bx < W) {
    const bw = 34 + ((seed * (i + 3) * 37) % 30);
    const bh = H * (0.18 + ((seed * (i + 5) * 53) % 20) / 100);
    ctx.fillStyle = "#93a3b5";
    ctx.fillRect(bx, H * 0.55 - bh, bw, bh);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let wy = H * 0.55 - bh + 6; wy < H * 0.55 - 8; wy += 10)
      for (let wx = bx + 5; wx < bx + bw - 6; wx += 10) ctx.fillRect(wx, wy, 5, 6);
    bx += bw + 6; i++;
  }
  ctx.fillStyle = "#3a3f46"; ctx.fillRect(0, H * 0.55, W, H * 0.45);
  ctx.fillStyle = "#f2c14e"; ctx.fillRect(0, H * 0.55, W, 3);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (let x = 8; x < W; x += 44) ctx.fillRect(x, H * 0.55 + H * 0.24, 24, 3);

  const img = spriteImgs[v.mode];
  const iw = 120;
  const ih = img && img.naturalWidth ? (iw * img.naturalHeight) / img.naturalWidth : 80;
  const iy = H * 0.55 + H * 0.45 - ih - 8;

  if (!follow.camera) {
    ctx.fillStyle = "rgba(10,15,20,0.55)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffd54a"; ctx.font = "bold 13px system-ui"; ctx.textAlign = "center";
    ctx.fillText("📷 no traffic camera in range", W / 2, H / 2 - 6);
    ctx.fillStyle = "#9fd3ab"; ctx.font = "11px system-ui";
    ctx.fillText("following on map until coverage resumes", W / 2, H / 2 + 12);
  } else {
    const period = 5000; // one drive-past per camera view
    const t = ((now - follow.camSince) % period) / period;
    if (img && img.complete && img.naturalWidth) {
      if (v.dir >= 0) {
        ctx.drawImage(img, -iw + t * (W + 2 * iw), iy, iw, ih);
      } else {
        const xm = (W + iw) - t * (W + 2 * iw);
        ctx.save();
        ctx.translate(xm + iw, 0); ctx.scale(-1, 1);
        ctx.drawImage(img, 0, iy, iw, ih);
        ctx.restore();
      }
    }
    if (now - follow.handoffAt < 700) {
      ctx.fillStyle = "rgba(10,15,20,0.6)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff"; ctx.font = "bold 13px system-ui"; ctx.textAlign = "center";
      ctx.fillText("📡 switching camera…", W / 2, H / 2);
    }
  }

  // --- overlays ---
  const ts = new Date(now), pad = (n) => String(n).padStart(2, "0");
  ctx.textAlign = "left"; ctx.font = "bold 11px system-ui";
  ctx.fillStyle = "#ff3b30";
  ctx.beginPath(); ctx.arc(12, 14, 5, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillText("LIVE", 22, 18);
  ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(`${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`, W - 8, 18);
  const tag = "SIMULATED FEED";
  ctx.font = "9px system-ui";
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(W - tw - 14, H - 20, tw + 8, 14);
  ctx.fillStyle = "#ffd54a";
  ctx.fillText(tag, W - 10, H - 9);
}

function initFollowCard() {
  document.getElementById("followClose").addEventListener("click", closeFollowCard);
}

// ---------------- place search (Nominatim, free, no key) ----------------
let searchTimer = null;

async function runSearch(query) {
  const box = document.getElementById("searchResults");
  if (!query.trim()) { box.hidden = true; return; }
  try {
    const center = map ? map.getCenter() : { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5` +
      `&q=${encodeURIComponent(query)}` +
      `&viewbox=${center.lng - 1},${center.lat + 1},${center.lng + 1},${center.lat - 1}&bounded=0`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const results = await res.json();
    if (!results.length) {
      box.innerHTML = `<div class="search-item muted">No places found.</div>`;
    } else {
      box.innerHTML = results.map((r, i) =>
        `<div class="search-item" data-i="${i}"><b>${r.name || "Place"}</b><br><span class="muted">${r.display_name}</span></div>`
      ).join("");
      box.querySelectorAll(".search-item[data-i]").forEach((el) => {
        el.addEventListener("click", () => {
          const r = results[+el.dataset.i];
          const latlng = [+r.lat, +r.lon];
          if (searchMarker) map.removeLayer(searchMarker);
          searchMarker = L.marker(latlng).addTo(map).bindPopup(`<b>${r.name || "Place"}</b>`).openPopup();
          map.flyTo(latlng, 15, { duration: 0.8 });
          box.hidden = true;
        });
      });
    }
    box.hidden = false;
  } catch (e) {
    console.warn("Search failed:", e);
  }
}

function initSearch() {
  const input = document.getElementById("searchInput");
  const box = document.getElementById("searchResults");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(input.value), 400);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(searchTimer); runSearch(input.value); }
    if (e.key === "Escape") box.hidden = true;
  });
  document.getElementById("searchBtn").addEventListener("click", () => runSearch(input.value));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-bar")) box.hidden = true;
  });
}

// ---------------- panel ----------------
function initPanel() {
  const panel = document.getElementById("tripPanel");
  const toggle = document.getElementById("panelToggle");
  toggle.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    toggle.textContent = collapsed ? "▴" : "▾";
  });
}

// ---------------- setup UI ----------------
function fillRoutes() {
  const sel = document.getElementById("routeSelect");
  sel.innerHTML = `<option value="all">All routes</option>`;
  system().routes.forEach((r) => {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = `${MODE_ICON[r.mode] || "🚌"} ${r.name}`;
    sel.appendChild(o);
  });
  state.routeId = "all";
}

function fillStops() {
  const sel = document.getElementById("stopSelect");
  sel.innerHTML = "";
  system().stops.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
  state.stopId = system().stops[0].id;
  state.said = {};
}

function init() {
  const systemSelect = document.getElementById("systemSelect");
  TRANSIT_SYSTEMS.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.name} — ${s.city}, ${s.country}`;
    systemSelect.appendChild(o);
  });
  systemSelect.addEventListener("change", (e) => {
    state.systemId = e.target.value;
    fillRoutes();
    fillStops();
    renderStopMarkers();
    refreshTrafficCameras();
    loadCameraFeed();
    refreshArrivals();
  });

  document.getElementById("routeSelect").addEventListener("change", (e) => {
    state.routeId = e.target.value;
    state.said = {};
    tick();
  });

  document.getElementById("stopSelect").addEventListener("change", (e) => {
    selectStop(e.target.value, true);
  });

  document.getElementById("walkMinutes").addEventListener("change", (e) => {
    state.walkMinutes = Math.max(1, parseInt(e.target.value, 10) || 8);
    state.said = {};
    tick();
  });

  const voiceBtn = document.getElementById("voiceBtn");
  voiceBtn.addEventListener("click", () => {
    state.voiceOn = !state.voiceOn;
    voiceBtn.textContent = state.voiceOn
      ? "🔊 Voice announcements ON"
      : "🔇 Enable voice announcements";
    if (state.voiceOn) speak("Voice announcements enabled. I'll tell you when to leave the house.");
  });

  // Demo helper: pretend a minute passed so you can watch it work.
  document.getElementById("demoBtn").addEventListener("click", () => {
    DEMO_ARRIVALS.forEach((b) => { b.minutesAway = Math.max(0.5, b.minutesAway - 1); });
    state.said = {};
    refreshArrivals();
  });

  initMap();
  initSearch();
  initPanel();
  initTransportFilter();
  initFollowCard();
  fillRoutes();
  fillStops();
  renderStopMarkers();
  loadCameraFeed();
  refreshArrivals();
  setInterval(refreshArrivals, 30000); // re-fetch arrivals every 30s
  setInterval(tick, 1000);            // smooth countdown every second
}

document.addEventListener("DOMContentLoaded", init);
