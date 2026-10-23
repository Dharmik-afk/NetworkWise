// @ts-check
'use strict';

import SpeedTest from '/vendor/speedtest.js';

const elements = {
    button: document.querySelector('#testButton'),
    meter: document.querySelector('#meter'),
    speedValue: document.querySelector('#speedValue'),
    meterLabel: document.querySelector('#meterLabel'),
    progressBar: document.querySelector('#progressBar'),
    transferDetail: document.querySelector('#transferDetail'),
    status: document.querySelector('#status'),
    saveStatus: document.querySelector('#saveStatus'),
    locationDialog: document.querySelector('#locationDialog'),
    pingResult: document.querySelector('#pingResult'),
    downloadResult: document.querySelector('#downloadResult'),
    uploadResult: document.querySelector('#uploadResult')
};

function formatSpeed(mbps) {
    if (!Number.isFinite(mbps)) return '—';
    return mbps >= 100 ? Math.round(mbps).toString() : mbps.toFixed(1);
}

function displayMetric(element, value, unit) {
    element.innerHTML = Number.isFinite(value) ? `${Math.round(value * 10) / 10} <small>${unit}</small>` : `— <small>${unit}</small>`;
}

async function getLocation() {
    if (!window.isSecureContext) {
        throw new Error('Location requires a trusted HTTPS connection. Accept or trust the localhost certificate, then reload.');
    }
    if (!navigator.geolocation) {
        throw new Error('This browser does not provide location access for this page.');
    }

    if (navigator.permissions?.query) {
        try {
            const permission = await navigator.permissions.query({ name: 'geolocation' });
            if (permission.state === 'denied') {
                throw new Error('Location is blocked for this site. Allow it in browser settings, then reload.');
            }
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('Location is blocked')) throw error;
        }
    }

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                altitude: position.coords.altitude,
                accuracy: position.coords.accuracy
            }),
            (error) => reject(new Error(error.code === error.PERMISSION_DENIED
                ? 'The browser blocked location. Allow it for this site and try again.'
                : error.code === error.POSITION_UNAVAILABLE
                    ? 'Location is allowed, but no position is available.'
                    : 'Getting your position timed out.')),
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
        );
    });
}

function askToShareLocation() {
    return new Promise((resolve) => {
        const onClose = () => {
            elements.locationDialog.removeEventListener('close', onClose);
            resolve(elements.locationDialog.returnValue === 'share');
        };
        elements.locationDialog.addEventListener('close', onClose);
        elements.locationDialog.showModal();
    });
}

async function getMetadata() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const userAgentData = navigator.userAgentData;
    let deviceModel = 'Unavailable in browser';
    let osVersion = userAgentData?.platform || navigator.platform || 'Unavailable in browser';

    if (userAgentData?.getHighEntropyValues) {
        try {
            const details = await userAgentData.getHighEntropyValues(['model', 'platformVersion']);
            deviceModel = details.model || deviceModel;
            osVersion = `${userAgentData.platform || ''} ${details.platformVersion || ''}`.trim() || osVersion;
        } catch {
            // Browsers may withhold User-Agent Client Hints for privacy.
        }
    }

    return {
        deviceModel,
        osVersion,
        networkType: connection?.effectiveType || connection?.type || 'Unavailable in browser',
        carrier: 'Unavailable in browser'
    };
}

async function saveResult(downloadSpeedMbps, uploadSpeedMbps, pingMs, gps) {
    const response = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            downloadSpeedMbps,
            uploadSpeedMbps,
            pingMs,
            ...(gps ? { gps } : {}),
            metadata: await getMetadata(),
            timestamp: new Date().toISOString()
        })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'The result could not be saved.');
    return result;
}

function setMeter(speed, progress, label) {
    const safeProgress = Math.max(0, Math.min(progress, 1));
    elements.speedValue.textContent = formatSpeed(speed);
    elements.meter.style.setProperty('--progress', `${safeProgress * 360}deg`);
    elements.progressBar.style.width = `${safeProgress * 100}%`;
    elements.meterLabel.textContent = label;
}

function runCloudflareTest() {
    return new Promise((resolve, reject) => {
        const test = new SpeedTest({ autoStart: false });
        test.onPhaseChange = ({ measurement }) => {
            const phase = measurement.type;
            const labels = { latency: 'Measuring latency', download: 'Measuring download', upload: 'Measuring upload' };
            elements.status.textContent = `Cloudflare: ${labels[phase] || 'Measuring connection quality'}…`;
            elements.meterLabel.textContent = labels[phase] || 'Measuring connection quality';
        };
        test.onResultsChange = ({ type }) => {
            const results = test.results;
            const downloadMbps = results.getDownloadBandwidth();
            const uploadMbps = results.getUploadBandwidth();
            const pingMs = results.getUnloadedLatency();
            displayMetric(elements.pingResult, pingMs, 'ms');
            displayMetric(elements.downloadResult, Number.isFinite(downloadMbps) ? downloadMbps / 1_000_000 : undefined, 'Mbps');
            displayMetric(elements.uploadResult, Number.isFinite(uploadMbps) ? uploadMbps / 1_000_000 : undefined, 'Mbps');
            const isUpload = type === 'upload';
            const currentMbps = isUpload ? uploadMbps : downloadMbps;
            setMeter(Number.isFinite(currentMbps) ? currentMbps / 1_000_000 : NaN, 0.25, isUpload ? 'Upload in progress' : 'Download in progress');
        };
        test.onError = (message) => {
            test.pause();
            reject(new Error(`Cloudflare speed test failed: ${message}`));
        };
        test.onFinish = (results) => resolve({
            downloadSpeedMbps: results.getDownloadBandwidth() === undefined ? null : results.getDownloadBandwidth() / 1_000_000,
            uploadSpeedMbps: results.getUploadBandwidth() === undefined ? null : results.getUploadBandwidth() / 1_000_000,
            pingMs: results.getUnloadedLatency() ?? null
        });
        test.play();
    });
}

async function runTest() {
    elements.button.disabled = true;
    elements.button.textContent = 'Testing…';
    elements.status.textContent = 'Cloudflare network quality test';
    elements.pingResult.innerHTML = '— <small>ms</small>';
    elements.downloadResult.innerHTML = '— <small>Mbps</small>';
    elements.uploadResult.innerHTML = '— <small>Mbps</small>';
    elements.saveStatus.textContent = '';
    elements.transferDetail.textContent = 'Measurements run from your browser to Cloudflare.';
    setMeter(NaN, 0, 'Preparing test');

    try {
        let gps = null;
        elements.status.textContent = 'Choose whether to share your location…';
        if (await askToShareLocation()) {
            elements.status.textContent = 'Requesting your location…';
            try {
                gps = await getLocation();
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Location is unavailable.';
                elements.saveStatus.textContent = `${message} Your speed result will still be saved.`;
            }
        } else {
            elements.saveStatus.textContent = 'Continuing without location. Your speed result will still be saved.';
        }

        const metrics = await runCloudflareTest();
        displayMetric(elements.pingResult, metrics.pingMs, 'ms');
        displayMetric(elements.downloadResult, metrics.downloadSpeedMbps, 'Mbps');
        displayMetric(elements.uploadResult, metrics.uploadSpeedMbps, 'Mbps');
        setMeter(metrics.downloadSpeedMbps, 1, 'Test complete');
        elements.transferDetail.textContent = 'Test measured by Cloudflare';
        elements.status.textContent = 'Test complete.';
        elements.saveStatus.textContent = 'Saving your result…';
        const savedResult = await saveResult(metrics.downloadSpeedMbps, metrics.uploadSpeedMbps, metrics.pingMs, gps);
        elements.saveStatus.textContent = `Result saved (record #${savedResult.recordId}).`;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        if (elements.meterLabel.textContent !== 'Test complete') {
            setMeter(NaN, 0, 'Unable to test');
            elements.status.textContent = message;
        } else {
            elements.saveStatus.textContent = message;
        }
    } finally {
        elements.button.disabled = false;
        elements.button.textContent = 'Run again';
    }
}

elements.button.addEventListener('click', runTest);
