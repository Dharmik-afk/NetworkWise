// @ts-check
'use strict';

import { buildInterpolationGrid, metricRange, toMetricSamples } from './map-data.mjs';

const points = [];
const elements = {
    speedMode: document.querySelector('#speedMode'),
    locateButton: document.querySelector('#locateButton'),
    status: document.querySelector('#mapStatus'),
    legendTitle: document.querySelector('#legendTitle'),
    legendMin: document.querySelector('#legendMin'),
    legendMax: document.querySelector('#legendMax')
};

const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([20, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const sampleLayer = L.layerGroup().addTo(map);
let currentLocationMarker = null;
let contourCanvas = null;
let renderScheduled = false;
let activeMetric = 'downloadSpeedMbps';
let minMetric = 0;
let maxMetric = 0;

function setStatus(message) {
    elements.status.textContent = message;
}

function formatSpeed(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getMetricPoints() {
    return toMetricSamples(points, activeMetric);
}

function purpleSurfaceColor(ratio) {
    const stops = [
        [29, 16, 48],
        [67, 32, 101],
        [126, 58, 168],
        [192, 91, 230]
    ];
    const band = Math.max(0, Math.min(stops.length - 1, Math.floor(ratio * stops.length)));
    const color = stops[band];
    return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function renderSurface() {
    renderScheduled = false;
    if (!contourCanvas) return;

    const size = map.getSize();
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(contourCanvas, topLeft);
    contourCanvas.width = Math.max(1, Math.round(size.x));
    contourCanvas.height = Math.max(1, Math.round(size.y));

    const context = contourCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, size.x, size.y);

    const activePoints = getMetricPoints().map((point) => ({
        x: map.latLngToLayerPoint([point.latitude, point.longitude]).x - topLeft.x,
        y: map.latLngToLayerPoint([point.latitude, point.longitude]).y - topLeft.y,
        value: point.value
    }));
    if (activePoints.length === 0) return;

    const grid = buildInterpolationGrid(activePoints, size.x, size.y,
        Math.max(18, Math.ceil(size.x / 18)), Math.max(14, Math.ceil(size.y / 18)));
    const range = metricRange(activePoints);
    const bands = 7;

    for (let row = 0; row < grid.rows - 1; row += 1) {
        for (let column = 0; column < grid.columns - 1; column += 1) {
            const index = row * grid.columns + column;
            const values = [grid.values[index], grid.values[index + 1],
                grid.values[index + grid.columns + 1], grid.values[index + grid.columns]];
            if (values.some((value) => value === null)) continue;
            const average = values.reduce((sum, value) => sum + value, 0) / values.length;
            const ratio = range.max === range.min ? .5 : (average - range.min) / (range.max - range.min);
            const flooredRatio = Math.floor(Math.max(0, Math.min(1, ratio)) * bands) / (bands - 1);
            const confidence = Math.min(
                grid.confidence[index], grid.confidence[index + 1],
                grid.confidence[index + grid.columns], grid.confidence[index + grid.columns + 1]
            );
            context.globalAlpha = .08 + confidence * .7;
            context.fillStyle = purpleSurfaceColor(flooredRatio);
            context.fillRect(column * grid.cellWidth, row * grid.cellHeight,
                grid.cellWidth + 1, grid.cellHeight + 1);
        }
    }
    context.globalAlpha = 1;
}

function scheduleSurfaceRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(renderSurface);
}

function updateContours() {
    const metricPoints = getMetricPoints();
    elements.legendTitle.textContent = activeMetric === 'downloadSpeedMbps' ? 'Download speed' : 'Upload speed';
    const range = metricRange(metricPoints);
    minMetric = range.min;
    maxMetric = range.max;
    elements.legendMin.textContent = metricPoints.length === 0 ? '—' : formatSpeed(range.min);
    elements.legendMax.textContent = metricPoints.length === 0 ? '—' : formatSpeed(range.max);
    scheduleSurfaceRender();
}

function addSamplesToMap() {
    sampleLayer.clearLayers();
    for (const point of points) {
        const marker = L.marker([point.latitude, point.longitude], {
            icon: L.divIcon({ className: 'sample-marker', iconSize: [12, 12], iconAnchor: [6, 6] })
        });
        const download = point.downloadSpeedMbps === null ? '—' : `${formatSpeed(point.downloadSpeedMbps)} Mbps`;
        const upload = point.uploadSpeedMbps === null ? '—' : `${formatSpeed(point.uploadSpeedMbps)} Mbps`;
        marker.bindPopup(`<strong>Download:</strong> ${download}<br><strong>Upload:</strong> ${upload}<br><strong>Tested:</strong> ${new Date(point.timestamp).toLocaleString()}`);
        sampleLayer.addLayer(marker);
    }
}

function fitSampleBounds() {
    if (points.length === 0) return;
    if (points.length === 1) {
        map.setView([points[0].latitude, points[0].longitude], 13);
        return;
    }
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
}

async function loadPoints() {
    try {
        const response = await fetch('/api/network-speeds', { cache: 'no-store' });
        if (!response.ok) throw new Error('The speed samples could not be loaded.');
        const data = await response.json();
        points.push(...data.points);
        if (points.length === 0) {
            setStatus('No GPS-tagged speed results are available yet.');
        } else {
            setStatus(`${points.length} GPS-tagged speed sample${points.length === 1 ? '' : 's'} loaded.`);
            addSamplesToMap();
            fitSampleBounds();
        }
        updateContours();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to load speed samples.');
    }
}

function showCurrentLocation() {
    if (!navigator.geolocation) {
        setStatus('This browser does not provide location access.');
        return;
    }
    if (!window.isSecureContext) {
        setStatus('Location needs a secure page. This Wi-Fi HTTP address can show speed samples, but the browser blocks live location.');
        return;
    }

    elements.locateButton.disabled = true;
    setStatus('Requesting your location…');
    navigator.geolocation.getCurrentPosition((position) => {
        const location = L.latLng(position.coords.latitude, position.coords.longitude);
        if (currentLocationMarker) currentLocationMarker.remove();
        currentLocationMarker = L.marker(location, {
            icon: L.divIcon({ className: 'user-location-marker', iconSize: [22, 22], iconAnchor: [11, 11] }),
            zIndexOffset: 1000
        }).addTo(map).bindPopup('You are here').openPopup();

        if (points.length === 0) {
            map.flyTo(location, 13, { duration: 0.8 });
        } else if (!map.getBounds().contains(location)) {
            map.panInside(location, { padding: [48, 48], animate: true, duration: 0.8 });
        }
        setStatus('Your location is shown on the map.');
        elements.locateButton.disabled = false;
    }, (error) => {
        const message = error.code === error.PERMISSION_DENIED
            ? 'Location permission is blocked. Allow it in your browser and device settings, then try again.'
            : error.code === error.TIMEOUT
                ? 'Getting your location timed out. Check device location services and retry.'
                : 'Your position is unavailable. Check device location services and retry.';
        setStatus(message);
        elements.locateButton.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

const canvasLayer = L.Layer.extend({
    onAdd(leafletMap) {
        contourCanvas = L.DomUtil.create('canvas', 'contour-canvas');
        leafletMap.getPanes().overlayPane.appendChild(contourCanvas);
        leafletMap.on('moveend zoomend resize', scheduleSurfaceRender);
        scheduleSurfaceRender();
    },
    onRemove(leafletMap) {
        leafletMap.off('moveend zoomend resize', scheduleSurfaceRender);
        contourCanvas?.remove();
        contourCanvas = null;
    }
});

new canvasLayer().addTo(map);
elements.speedMode.addEventListener('change', () => {
    activeMetric = elements.speedMode.value;
    updateContours();
});
elements.locateButton.addEventListener('click', showCurrentLocation);
loadPoints();
