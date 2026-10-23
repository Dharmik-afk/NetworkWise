// @ts-check
'use strict';

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
let gradientCanvas = null;
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
    return points.filter((point) => Number.isFinite(point[activeMetric]));
}

function speedColor(ratio) {
    const stops = [
        { at: 0, rgb: [204, 36, 29] },
        { at: 0.35, rgb: [215, 153, 33] },
        { at: 0.68, rgb: [184, 187, 38] },
        { at: 1, rgb: [142, 192, 124] }
    ];
    const value = Math.max(0, Math.min(1, ratio));
    let index = 0;
    while (index < stops.length - 2 && value > stops[index + 1].at) index += 1;
    const lower = stops[index];
    const upper = stops[index + 1];
    const part = (value - lower.at) / (upper.at - lower.at);
    const channels = lower.rgb.map((channel, channelIndex) => Math.round(channel + (upper.rgb[channelIndex] - channel) * part));
    return `rgb(${channels[0]} ${channels[1]} ${channels[2]})`;
}

function renderGradient() {
    renderScheduled = false;
    if (!gradientCanvas) return;

    const size = map.getSize();
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(gradientCanvas, topLeft);
    gradientCanvas.width = Math.max(1, Math.round(size.x));
    gradientCanvas.height = Math.max(1, Math.round(size.y));

    const context = gradientCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, size.x, size.y);

    const activePoints = getMetricPoints().map((point) => ({
        x: map.latLngToLayerPoint([point.latitude, point.longitude]).x - topLeft.x,
        y: map.latLngToLayerPoint([point.latitude, point.longitude]).y - topLeft.y,
        value: point[activeMetric]
    }));
    if (activePoints.length === 0) return;

    const sampleStep = 12;
    const cellSize = sampleStep + 1;
    for (let y = 0; y < size.y; y += sampleStep) {
        for (let x = 0; x < size.x; x += sampleStep) {
            let weightedTotal = 0;
            let weightTotal = 0;
            for (const point of activePoints) {
                const dx = x + sampleStep / 2 - point.x;
                const dy = y + sampleStep / 2 - point.y;
                const distanceSquared = dx * dx + dy * dy;
                if (distanceSquared < 1) {
                    weightedTotal = point.value;
                    weightTotal = 1;
                    break;
                }
                const weight = 1 / distanceSquared;
                weightedTotal += point.value * weight;
                weightTotal += weight;
            }
            const estimate = weightedTotal / weightTotal;
            const ratio = maxMetric === minMetric ? 0.5 : (estimate - minMetric) / (maxMetric - minMetric);
            context.fillStyle = speedColor(ratio);
            context.fillRect(x, y, cellSize, cellSize);
        }
    }
}

function scheduleGradientRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(renderGradient);
}

function updateGradient() {
    const metricPoints = getMetricPoints();
    elements.legendTitle.textContent = activeMetric === 'downloadSpeedMbps' ? 'Download speed' : 'Upload speed';
    if (metricPoints.length === 0) {
        minMetric = 0;
        maxMetric = 0;
        elements.legendMin.textContent = '—';
        elements.legendMax.textContent = '—';
        scheduleGradientRender();
        return;
    }

    const values = metricPoints.map((point) => point[activeMetric]);
    minMetric = Math.min(...values);
    maxMetric = Math.max(...values);
    elements.legendMin.textContent = formatSpeed(minMetric);
    elements.legendMax.textContent = formatSpeed(maxMetric);
    scheduleGradientRender();
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
        if (response.status === 401) {
            window.location.assign('/admin/login');
            return;
        }
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
        updateGradient();
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
        gradientCanvas = L.DomUtil.create('canvas', 'idw-canvas');
        leafletMap.getPanes().overlayPane.appendChild(gradientCanvas);
        leafletMap.on('moveend zoomend resize', scheduleGradientRender);
        scheduleGradientRender();
    },
    onRemove(leafletMap) {
        leafletMap.off('moveend zoomend resize', scheduleGradientRender);
        gradientCanvas?.remove();
        gradientCanvas = null;
    }
});

new canvasLayer().addTo(map);
elements.speedMode.addEventListener('change', () => {
    activeMetric = elements.speedMode.value;
    updateGradient();
});
elements.locateButton.addEventListener('click', showCurrentLocation);
loadPoints();
