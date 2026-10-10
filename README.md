# TTG — Time To Go

Show the incoming bus or train you need to take, get told verbally when to leave the house to make it to the stop, and — where available — watch a synced live camera as your ride rolls in. Built to work worldwide: every transit system plugs in through one adapter.

## The app

Map-first, Google-Maps-style: a full-screen interactive map centered on your location, a search bar up top, and your trip controls in a bottom sheet (side panel on desktop).

- **Map** — Leaflet + OpenStreetMap tiles. Free forever, no API key, no billing, no signup. Your stops appear as markers; tap one to track it.
- **Search** — place search via Nominatim (also free, no key), biased toward your current map view.
- **Location** — one tap centers the map on you (browser geolocation).
- **Trip logic** — pick system → route → stop, set your walk time. TTG subtracts walk time plus a 2-minute safety buffer from the next arrival and tells you when to leave — on screen and out loud.
- **Live cameras** — where a transit agency exposes stop/station cameras, the feed appears synced to your stop.
- **Live vehicles** — cute vehicle icons (bus, steam train, sleek metro, SF-style tram, each with a little driver) drive around the map in real time. The art lives as data URIs in `assets/vehicles.js` (generated file — the GitHub connector only pushes text, so PNGs can't go up as binaries). Real trackers only report positions ~every 30 seconds, so TTG interpolates between each vehicle's last two fixes every animation frame — the icons glide at a smooth constant speed instead of teleporting fix-to-fix. A filter circle at the bottom-left expands into a bar where you can show/hide each transport type; your choice is remembered.

## Transit adapters

Every city plugs in through the `TRANSIT_SYSTEMS` registry in `app.js`: routes with a `mode` (`bus`, `subway`, `train`, `tram`) and a `path` (the polyline the vehicle icons follow), stops with `lat`/`lng`, a `getArrivals(stopId)` implementation (most agencies publish GTFS-realtime), and an optional `getCameraUrl(stopId)`. To make the vehicle icons real, replace the simulated `pollVehicleFeed()` with your agency's vehicle-positions feed — the interpolation layer consumes plain `{lat, lng, t}` fixes, so it works identically on real data. The countdown, voice alerts, map markers, and UI work unchanged for every system you add. A commented Transport-for-London example is included.

## Transit adapters

Every city plugs in through the `TRANSIT_SYSTEMS` registry in `app.js`: routes with a `mode` (`bus`, `subway`, `train`), stops with `lat`/`lng`, a `getArrivals(stopId)` implementation (most agencies publish GTFS-realtime), and an optional `getCameraUrl(stopId)`. The countdown, voice alerts, map markers, and UI work unchanged for every system you add. A commented Transport-for-London example is included.

## Run it

No build step — it's static files. Serve the folder (GitHub Pages works as-is):

```sh
python3 -m http.server 8000
# then open http://localhost:8000 (geolocation needs https or localhost)
```

## Status

v2. Arrival and vehicle-position data is simulated until real transit feeds are plugged in. Next: wire a real GTFS-realtime feed for your city.
