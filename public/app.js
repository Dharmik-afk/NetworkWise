// @ts-check
'use strict';

const TEST_SIZE_BYTES = 35 * 1024 * 1024;
const PING_ATTEMPTS = 3;

const elements = {
    button: document.querySelector('#testButton'),
    meter: document.querySelector('#meter'),
    speedValue: document.querySelector('#speedValue'),
    meterLabel: document.querySelector('#meterLabel'),
    progressBar: document.querySelector('#progressBar'),
    transferDetail: document.querySelector('#transferDetail'),
    status: document.querySelector('#status'),
    saveStatus: document.querySelector('#saveStatus'),
    pingResult: document.querySelector('#pingResult'),
    downloadResult: document.querySelector('#downloadResult')
};

function formatSpeed(mbps) {
    if (!Number.isFinite(mbps)) return '—';
    return mbps >= 100 ? Math.round(mbps).toString() : mbps.toFixed(1);
}

function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Location is not supported by this browser.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                altitude: position.coords.altitude,
                accuracy: position.coords.accuracy
            }),
            () => reject(new Error('Location permission is required to save this result.')),
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
        );
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

async function saveResult(downloadSpeedMbps, pingMs, gps) {
    const response = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            downloadSpeedMbps,
            pingMs,
            ...(gps ? { gps } : {}),
            metadata: await getMetadata(),
            timestamp: new Date().toISOString()
        })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(result?.error || 'The result could not be saved.');
    }
    return result;
}

function setMeter(speed, progress, label) {
    const safeProgress = Math.max(0, Math.min(progress, 1));
    elements.speedValue.textContent = formatSpeed(speed);
    elements.meter.style.setProperty('--progress', `${safeProgress * 360}deg`);
    elements.progressBar.style.width = `${safeProgress * 100}%`;
    elements.meterLabel.textContent = label;
}

async function measurePing() {
    const samples = [];
    for (let index = 0; index < PING_ATTEMPTS; index += 1) {
        const start = performance.now();
        const response = await fetch(`/api/speedtest/ping?t=${Date.now()}-${index}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('The latency check failed.');
        await response.text();
        samples.push(performance.now() - start);
    }
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

async function measureDownload() {
    const response = await fetch(`/api/speedtest/download?size=${TEST_SIZE_BYTES}&t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error('The download test could not start.');

    const totalBytes = Number(response.headers.get('content-length')) || TEST_SIZE_BYTES;
    const reader = response.body.getReader();
    const startedAt = performance.now();
    let receivedBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.01);
        const currentSpeed = (receivedBytes * 8) / elapsedSeconds / 1_000_000;
        const progress = receivedBytes / totalBytes;
        setMeter(currentSpeed, progress, 'Measuring download');
        elements.transferDetail.textContent = `${(receivedBytes / 1024 / 1024).toFixed(1)} of ${(totalBytes / 1024 / 1024).toFixed(0)} MB`;
    }

    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    return (receivedBytes * 8) / elapsedSeconds / 1_000_000;
}

async function runTest() {
    elements.button.disabled = true;
    elements.button.textContent = 'Testing…';
    elements.status.textContent = 'Checking latency…';
    elements.pingResult.innerHTML = '— <small>ms</small>';
    elements.downloadResult.innerHTML = '— <small>Mbps</small>';
    elements.saveStatus.textContent = '';
    elements.transferDetail.textContent = '35 MB download test';
    setMeter(NaN, 0, 'Checking latency');

    try {
        let gps = null;
        elements.status.textContent = 'Requesting your location…';
        try {
            gps = await getLocation();
        } catch {
            elements.saveStatus.textContent = 'Location unavailable. Your speed result will still be saved.';
        }
        elements.status.textContent = 'Checking latency…';
        const ping = await measurePing();
        elements.pingResult.innerHTML = `${Math.round(ping)} <small>ms</small>`;
        elements.status.textContent = 'Measuring your download speed…';
        const download = await measureDownload();
        setMeter(download, 1, 'Download complete');
        elements.downloadResult.innerHTML = `${formatSpeed(download)} <small>Mbps</small>`;
        elements.transferDetail.textContent = '35 MB transferred';
        elements.status.textContent = 'Test complete.';
        elements.saveStatus.textContent = 'Saving your result…';
        const savedResult = await saveResult(download, ping, gps);
        elements.saveStatus.textContent = `Result saved (record #${savedResult.recordId}).`;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        if (elements.meterLabel.textContent !== 'Download complete') {
            setMeter(NaN, 0, 'Unable to test');
            elements.transferDetail.textContent = '35 MB download test';
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
