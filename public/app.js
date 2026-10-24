// @ts-check
'use strict';

import SpeedTest from '/vendor/speedtest.js';

/* ════════════════════════════════════════════════════════════════
   DOM references
   ════════════════════════════════════════════════════════════════ */
const elements = {
    button:         /** @type {HTMLButtonElement}  */ (document.querySelector('#testButton')),
    btnLabel:       /** @type {HTMLElement}        */ (document.querySelector('#btnLabel')),
    meter:          /** @type {HTMLElement}        */ (document.querySelector('#meter')),
    hexProgress:    /** @type {SVGPolygonElement}  */ (document.querySelector('#hexProgress')),
    speedValue:     /** @type {HTMLElement}        */ (document.querySelector('#speedValue')),
    speedUnit:      /** @type {HTMLElement}        */ (document.querySelector('#speedUnit')),
    meterLabel:     /** @type {HTMLElement}        */ (document.querySelector('#meterLabel')),
    progressBar:    /** @type {HTMLElement}        */ (document.querySelector('#progressBar')),
    segBar:         /** @type {HTMLElement}        */ (document.querySelector('#segBar')),
    transferDetail: /** @type {HTMLElement}        */ (document.querySelector('#transferDetail')),
    status:         /** @type {HTMLElement}        */ (document.querySelector('#status')),
    saveStatus:     /** @type {HTMLElement}        */ (document.querySelector('#saveStatus')),
    locationDialog: /** @type {HTMLDialogElement}  */ (document.querySelector('#locationDialog')),
    pingResult:     /** @type {HTMLElement}        */ (document.querySelector('#pingResult')),
    downloadResult: /** @type {HTMLElement}        */ (document.querySelector('#downloadResult')),
    uploadResult:   /** @type {HTMLElement}        */ (document.querySelector('#uploadResult')),
    rippleContainer:/** @type {HTMLElement}        */ (document.querySelector('#rippleContainer')),
    speedCard:      /** @type {HTMLElement}        */ (document.querySelector('.speed-card')),
};

/* ════════════════════════════════════════════════════════════════
   Utility helpers
   ════════════════════════════════════════════════════════════════ */
/**
 * @param {number} mbps
 * @returns {string}
 */
function formatSpeed(mbps) {
    if (!Number.isFinite(mbps)) return '—';
    return mbps >= 100 ? Math.round(mbps).toString() : mbps.toFixed(1);
}

/**
 * @param {HTMLElement} element
 * @param {number|undefined} value
 * @param {string} unit
 */
function displayMetric(element, value, unit) {
    element.innerHTML = Number.isFinite(value)
        ? `${Math.round(/** @type {number} */(value) * 10) / 10} <small>${unit}</small>`
        : `— <small>${unit}</small>`;
}

/* ════════════════════════════════════════════════════════════════
   Magnetic button — shifts toward cursor up to ±10 px
   ════════════════════════════════════════════════════════════════ */
const MAX_MAGNET = 10; // px

if (elements.button) {
    elements.button.addEventListener('mousemove', (e) => {
        const rect = elements.button.getBoundingClientRect();
        const cx   = rect.left + rect.width  / 2;
        const cy   = rect.top  + rect.height / 2;
        const dx   = ((e.clientX - cx) / (rect.width  / 2)) * MAX_MAGNET;
        const dy   = ((e.clientY - cy) / (rect.height / 2)) * MAX_MAGNET;
        elements.button.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    });

    elements.button.addEventListener('mouseleave', () => {
        elements.button.style.transform = 'translate(0px, 0px)';
    });
}

/* ════════════════════════════════════════════════════════════════
   Button text slide — animated label swap
   ════════════════════════════════════════════════════════════════ */
/**
 * @param {string} text
 */
function setButtonLabel(text) {
    if (!elements.btnLabel || !elements.button) return;
    elements.btnLabel.textContent = text;
    elements.button.classList.remove('label-change');
    // Force reflow to restart the animation
    void elements.button.offsetWidth;
    elements.button.classList.add('label-change');
}

/* ════════════════════════════════════════════════════════════════
   Ripple — diamond-shaped angular ripple on click
   ════════════════════════════════════════════════════════════════ */
if (elements.button && elements.rippleContainer) {
    elements.button.addEventListener('click', (e) => {
        const rect   = elements.rippleContainer.getBoundingClientRect();
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        ripple.style.left = `${e.clientX - rect.left}px`;
        ripple.style.top  = `${e.clientY - rect.top}px`;
        elements.rippleContainer.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    });
}

/* ════════════════════════════════════════════════════════════════
   Segmented progress bar — 20 blocks fill one by one
   ════════════════════════════════════════════════════════════════ */
const SEG_COUNT = 20;

/**
 * Fill 0-20 segments based on progress value 0-1.
 * @param {number} progress  — 0 to 1
 */
function setSegBar(progress) {
    if (!elements.segBar) return;
    const segs = /** @type {NodeListOf<HTMLElement>} */ (
        elements.segBar.querySelectorAll('.seg')
    );
    const filledCount = Math.round(Math.max(0, Math.min(progress, 1)) * SEG_COUNT);
    segs.forEach((seg, i) => {
        seg.classList.toggle('active',      i < filledCount && i < 14);
        seg.classList.toggle('active-late', i < filledCount && i >= 14);
    });
}

/* ════════════════════════════════════════════════════════════════
   Hex gauge — stroke-dashoffset driven progress ring
   ════════════════════════════════════════════════════════════════ */

/** Perimeter of the hex polygon: 6 × R where R=88 → 528 */
const HEX_PERIMETER = 528;

/**
 * Update hex gauge and segmented bar.
 * Signature kept identical to original for all call-sites.
 * @param {number} speed      — Mbps (can be NaN)
 * @param {number} progress   — 0 to 1
 * @param {string} label
 */
function setMeter(speed, progress, label) {
    const safeProgress = Math.max(0, Math.min(progress, 1));

    // Speed value text
    elements.speedValue.textContent = formatSpeed(speed);

    // Hex gauge stroke-dashoffset (528 = empty, 0 = full)
    if (elements.hexProgress) {
        const offset = HEX_PERIMETER * (1 - safeProgress);
        elements.hexProgress.style.strokeDashoffset = String(offset);
    }

    // Legacy hidden bar kept for any external reliance
    if (elements.progressBar) {
        elements.progressBar.style.width = `${safeProgress * 100}%`;
    }

    // Segmented bar
    setSegBar(safeProgress);

    // Label with fade
    if (elements.meterLabel) {
        elements.meterLabel.style.opacity = '0';
        setTimeout(() => {
            elements.meterLabel.textContent = label;
            elements.meterLabel.style.opacity = '1';
        }, 150);
    }
}

/* ════════════════════════════════════════════════════════════════
   Location, metadata, persistence, and speed-test logic
   ════════════════════════════════════════════════════════════════ */

/**
 * @returns {Promise<{latitude:number,longitude:number,altitude:number|null,accuracy:number}>}
 */
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
                latitude:  position.coords.latitude,
                longitude: position.coords.longitude,
                altitude:  position.coords.altitude,
                accuracy:  position.coords.accuracy
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

/** @returns {Promise<boolean>} */
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

/**
 * @returns {Promise<{deviceModel:string,osVersion:string,networkType:string,carrier:string}>}
 */
async function getMetadata() {
    const connection    = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const userAgentData = navigator.userAgentData;
    let deviceModel = 'Unavailable in browser';
    let osVersion   = userAgentData?.platform || navigator.platform || 'Unavailable in browser';

    if (userAgentData?.getHighEntropyValues) {
        try {
            const details = await userAgentData.getHighEntropyValues(['model', 'platformVersion']);
            deviceModel = details.model || deviceModel;
            osVersion   = `${userAgentData.platform || ''} ${details.platformVersion || ''}`.trim() || osVersion;
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

/**
 * @param {number|null} downloadSpeedMbps
 * @param {number|null} uploadSpeedMbps
 * @param {number|null} pingMs
 * @param {{latitude:number,longitude:number,altitude:number|null,accuracy:number}|null} gps
 */
async function saveResult(downloadSpeedMbps, uploadSpeedMbps, pingMs, gps) {
    const response = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            downloadSpeedMbps,
            uploadSpeedMbps,
            pingMs,
            ...(gps ? { gps } : {}),
            metadata:  await getMetadata(),
            timestamp: new Date().toISOString()
        })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'The result could not be saved.');
    return result;
}

/** @returns {Promise<{downloadSpeedMbps:number|null,uploadSpeedMbps:number|null,pingMs:number|null}>} */
function runCloudflareTest() {
    return new Promise((resolve, reject) => {
        // Use multiple payload sizes to reduce the bias of a single fixed-size
        // request. The configured payload totals about 97 MB across both directions.
        const test = new SpeedTest({
            autoStart: false,
            bandwidthPercentile: 0.5,
            measurements: [
                { type: 'latency', numPackets: 20 },
                { type: 'download', bytes: 1e5, count: 3 },
                { type: 'download', bytes: 1e6, count: 3 },
                { type: 'download', bytes: 1e7, count: 2 },
                { type: 'download', bytes: 2.5e7, count: 1 },
                { type: 'upload', bytes: 1e5, count: 3 },
                { type: 'upload', bytes: 1e6, count: 3 },
                { type: 'upload', bytes: 1e7, count: 2 },
                { type: 'upload', bytes: 2.5e7, count: 1 }
            ]
        });

        test.onPhaseChange = ({ measurement }) => {
            const phase  = measurement.type;
            const labels = {
                latency:  'Measuring latency',
                download: 'Measuring download',
                upload:   'Measuring upload'
            };
            elements.status.textContent    = `Cloudflare: ${labels[phase] || 'Measuring connection quality'}…`;
            setMeter(NaN, 0, labels[phase] || 'Measuring connection quality');
        };

        test.onError = (message) => {
            test.pause();
            reject(new Error(`Cloudflare speed test failed: ${message}`));
        };

        test.onFinish = (results) => resolve({
            downloadSpeedMbps: results.getDownloadBandwidth()  === undefined ? null : results.getDownloadBandwidth()  / 1_000_000,
            uploadSpeedMbps:   results.getUploadBandwidth()    === undefined ? null : results.getUploadBandwidth()    / 1_000_000,
            pingMs:            results.getUnloadedLatency()    ?? null
        });

        test.play();
    });
}

async function runTest() {
    elements.button.disabled = true;
    setButtonLabel('Testing…');
    elements.status.textContent        = 'Cloudflare network quality test';
    elements.pingResult.innerHTML      = '— <small>ms</small>';
    elements.downloadResult.innerHTML  = '— <small>Mbps</small>';
    elements.uploadResult.innerHTML    = '— <small>Mbps</small>';
    elements.saveStatus.textContent    = '';
    elements.transferDetail.textContent = 'Measurements run from your browser to Cloudflare.';
    setMeter(NaN, 0, 'Preparing test');

    setSegBar(0);
    elements.meter.setAttribute('data-active', 'true');
    elements.speedCard?.setAttribute('data-testing', 'true');
    document.body.setAttribute('data-testing', 'true');

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
        displayMetric(elements.pingResult,     metrics.pingMs,           'ms');
        displayMetric(elements.downloadResult, metrics.downloadSpeedMbps, 'Mbps');
        displayMetric(elements.uploadResult,   metrics.uploadSpeedMbps,   'Mbps');
        setMeter(metrics.downloadSpeedMbps, 1, 'Test complete');
        elements.transferDetail.textContent = 'Test measured by Cloudflare';
        elements.status.textContent         = 'Test complete.';
        elements.saveStatus.textContent     = 'Saving your result…';
        const savedResult = await saveResult(
            metrics.downloadSpeedMbps, metrics.uploadSpeedMbps, metrics.pingMs, gps
        );
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
        setButtonLabel('Run again');
        elements.meter.removeAttribute('data-active');
        elements.speedCard?.removeAttribute('data-testing');
        document.body.removeAttribute('data-testing');
    }
}

elements.button.addEventListener('click', runTest);

/* ════════════════════════════════════════════════════════════════
   Workspace navigation and coverage summary
   ════════════════════════════════════════════════════════════════ */
const workspace = {
    app: /** @type {HTMLElement|null} */ (document.querySelector('.site-app')),
    sidebar: /** @type {HTMLElement|null} */ (document.querySelector('#siteSidebar')),
    menuToggle: /** @type {HTMLButtonElement|null} */ (document.querySelector('#sidebarToggle')),
    closeButton: /** @type {HTMLButtonElement|null} */ (document.querySelector('#sidebarClose')),
    scrim: /** @type {HTMLElement|null} */ (document.querySelector('#sidebarScrim')),
    links: /** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('.nav-link')),
    sections: /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.workspace-section')),
    sampleCount: /** @type {HTMLElement|null} */ (document.querySelector('#coverageSampleCount')),
    coverageStatus: /** @type {HTMLElement|null} */ (document.querySelector('#coverageStatus'))
};

function closeSidebar() {
    workspace.sidebar?.classList.remove('is-open');
    workspace.scrim?.classList.remove('is-visible');
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const collapsed = workspace.app?.classList.contains('sidebar-collapsed') ?? false;
    workspace.menuToggle?.setAttribute('aria-expanded', String(mobile ? false : !collapsed));
    workspace.menuToggle?.setAttribute('aria-label', mobile ? 'Open navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

function openSidebar() {
    workspace.sidebar?.classList.add('is-open');
    workspace.scrim?.classList.add('is-visible');
    workspace.menuToggle?.setAttribute('aria-expanded', 'true');
    workspace.menuToggle?.setAttribute('aria-label', 'Close navigation');
}

closeSidebar();

workspace.menuToggle?.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
        if (workspace.sidebar?.classList.contains('is-open')) closeSidebar();
        else openSidebar();
        return;
    }

    const collapsed = workspace.app?.classList.toggle('sidebar-collapsed') ?? false;
    workspace.menuToggle?.setAttribute('aria-expanded', String(!collapsed));
    workspace.menuToggle?.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
});
workspace.closeButton?.addEventListener('click', closeSidebar);
workspace.scrim?.addEventListener('click', closeSidebar);
workspace.links.forEach((link) => link.addEventListener('click', closeSidebar));
window.matchMedia('(max-width: 760px)').addEventListener('change', (event) => {
    if (!event.matches) closeSidebar();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && workspace.sidebar?.classList.contains('is-open')) {
        closeSidebar();
        workspace.menuToggle?.focus();
    }
});

if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        workspace.links.forEach((link) => link.classList.toggle('is-active', link.dataset.section === visible.target.id));
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, .2, .5] });
    workspace.sections.forEach((section) => sectionObserver.observe(section));
}

async function loadCoverageSummary() {
    if (!workspace.sampleCount || !workspace.coverageStatus) return;
    try {
        const response = await fetch('/api/network-speeds', { cache: 'no-store' });
        if (!response.ok) throw new Error('Map data is temporarily unavailable.');
        const data = await response.json();
        const count = Array.isArray(data.points) ? data.points.length : 0;
        workspace.sampleCount.textContent = String(count).padStart(2, '0');
        workspace.coverageStatus.textContent = count === 0
            ? 'The first GPS-tagged test will start this map.'
            : `Showing the latest ${count} GPS-tagged sample${count === 1 ? '' : 's'}.`;
    } catch {
        workspace.sampleCount.textContent = '—';
        workspace.coverageStatus.textContent = 'Map data will appear when samples are available.';
    }
}

loadCoverageSummary();
