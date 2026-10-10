// ============================================================
// TTG — Time To Go (v2, map-first)
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

const MODE_ICON = { bus: "🚌", subway: "🚇", train: "🚆" };
const DEFAULT_CENTER = [41.3874, 2.1686]; // Barcelona

// --- Simulated arrivals for the demo system (replace per city) ---
const DEMO_ARRIVALS = [
  { route: "10",  destination: "Downtown",      minutesAway: 14 },
  { route: "10",  destination: "Downtown",      minutesAway: 29 },
  { route: "42",  destination: "Airport",       minutesAway: 22 },
  { route: "red", destination: "Northgate",    minutesAway: 6  },
  { route: "red", destination: "South End",    minutesAway: 16 },
  { route: "lw",  destination: "Union Station", minutesAway: 35 },
];

const TRANSIT_SYSTEMS = [
  {
    id: "demo",
    name: "Demo City Transit",
    city: "Demo City",
    country: "—",
    routes: [
      { id: "10",  name: "Route 10",      mode: "bus"    },
      { id: "42",  name: "Route 42",      mode: "bus"    },
      { id: "red", name: "Red Line",      mode: "subway" },
      { id: "lw",  name: "Lakeshore West", mode: "train" },
    ],
    stops: [
      { id: "demo-100", name: "Plaça de Catalunya", routes: ["10", "42", "red", "lw"], lat: 41.3874, lng: 2.1686 },
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
  fillRoutes();
  fillStops();
  renderStopMarkers();
  loadCameraFeed();
  refreshArrivals();
  setInterval(refreshArrivals, 30000); // re-fetch arrivals every 30s
  setInterval(tick, 1000);            // smooth countdown every second
}

document.addEventListener("DOMContentLoaded", init);
