import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildInterpolationGrid,
    interpolateAt,
    metricRange,
    toMetricSamples
} from '../public/map-data.mjs';

test('toMetricSamples filters invalid coordinates and missing metrics', () => {
    const samples = toMetricSamples([
        { latitude: 10, longitude: 20, downloadSpeedMbps: 50 },
        { latitude: 'bad', longitude: 20, downloadSpeedMbps: 60 },
        { latitude: 11, longitude: 21, downloadSpeedMbps: null },
        { latitude: 12, longitude: 22, downloadSpeedMbps: 75 }
    ], 'downloadSpeedMbps');

    assert.deepEqual(samples.map(({ latitude, longitude, value }) => ({ latitude, longitude, value })), [
        { latitude: 10, longitude: 20, value: 50 },
        { latitude: 12, longitude: 22, value: 75 }
    ]);
});

test('metricRange returns a stable zero range for no samples', () => {
    assert.deepEqual(metricRange([]), { min: 0, max: 0 });
    assert.deepEqual(metricRange([{ value: 12 }, { value: 48 }, { value: 30 }]), { min: 12, max: 48 });
});

test('interpolateAt returns the exact sample value at a sample location', () => {
    assert.equal(interpolateAt([
        { x: 0, y: 0, value: 20 },
        { x: 10, y: 0, value: 80 }
    ], 0, 0), 20);
});

test('interpolateAt weights nearby samples more strongly', () => {
    const value = interpolateAt([
        { x: 0, y: 0, value: 20 },
        { x: 10, y: 0, value: 80 }
    ], 2, 0);

    assert.ok(value > 20 && value < 50);
});

test('buildInterpolationGrid preserves dimensions and interpolates every cell', () => {
    const grid = buildInterpolationGrid([
        { x: 0, y: 0, value: 10 },
        { x: 10, y: 0, value: 30 }
    ], 10, 10, 3, 2);

    assert.equal(grid.values.length, 6);
    assert.equal(grid.columns, 3);
    assert.equal(grid.rows, 2);
    assert.equal(grid.values[0], 10);
    assert.equal(grid.values[2], 30);
    assert.ok(grid.values.every((value) => value !== null));
    assert.equal(grid.confidence.length, 6);
    assert.equal(grid.confidence[0], 1);
});
