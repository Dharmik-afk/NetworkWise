// @ts-check

/**
 * Return samples that can be plotted for a selected metric.
 * @param {Array<Record<string, unknown>>} samples
 * @param {string} metric
 * @returns {Array<{latitude:number, longitude:number, value:number, sample:Record<string, unknown>}>}
 */
export function toMetricSamples(samples, metric) {
    return samples
        .filter((sample) => Number.isFinite(sample.latitude)
            && Number.isFinite(sample.longitude)
            && Number.isFinite(sample[metric]))
        .map((sample) => ({
            latitude: Number(sample.latitude),
            longitude: Number(sample.longitude),
            value: Number(sample[metric]),
            sample
        }));
}

/**
 * @param {Array<{value:number}>} samples
 * @returns {{min:number, max:number}}
 */
export function metricRange(samples) {
    if (samples.length === 0) return { min: 0, max: 0 };
    const values = samples.map((sample) => sample.value);
    return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Inverse-distance interpolation in any 2D coordinate space.
 * @param {Array<{x:number, y:number, value:number}>} samples
 * @param {number} x
 * @param {number} y
 * @param {number} [power=2]
 * @returns {number|null}
 */
export function interpolateAt(samples, x, y, power = 2) {
    if (samples.length === 0) return null;
    let weightedValue = 0;
    let weightTotal = 0;

    for (const sample of samples) {
        const dx = x - sample.x;
        const dy = y - sample.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 0.0001) return sample.value;
        const weight = 1 / Math.pow(distanceSquared, power / 2);
        weightedValue += sample.value * weight;
        weightTotal += weight;
    }

    return weightedValue / weightTotal;
}

/**
 * Build a scalar interpolation grid for contour rendering.
 * @param {Array<{x:number, y:number, value:number}>} samples
 * @param {number} width
 * @param {number} height
 * @param {number} columns
 * @param {number} rows
 * @returns {{values:Array<number|null>, confidence:number[], columns:number, rows:number, cellWidth:number, cellHeight:number}}
 */
export function buildInterpolationGrid(samples, width, height, columns, rows) {
    const cellWidth = width / Math.max(1, columns - 1);
    const cellHeight = height / Math.max(1, rows - 1);
    const values = [];
    const confidence = [];
    const confidenceScale = Math.max(80, Math.min(width, height) * 0.28);

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const x = column * cellWidth;
            const y = row * cellHeight;
            values.push(interpolateAt(samples, x, y));
            const nearestDistance = samples.length === 0
                ? Infinity
                : Math.min(...samples.map((sample) => Math.hypot(sample.x - x, sample.y - y)));
            confidence.push(samples.length === 0 ? 0 : Math.exp(-nearestDistance / confidenceScale));
        }
    }

    return { values, confidence, columns, rows, cellWidth, cellHeight };
}
