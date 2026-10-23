// @ts-check
'use strict';
const body = document.querySelector('#results');
const status = document.querySelector('#status');
const sort = document.querySelector('#sort');
let results = [];
const cell = (value) => { const element = document.createElement('td'); element.textContent = value; return element; };
function renderResults() { const ordered = [...results]; const mode = sort.value; ordered.sort((a, b) => { if (mode === 'time-asc') return new Date(a.created_at) - new Date(b.created_at); if (mode === 'download-desc') return Number(b.download_speed_mbps ?? -1) - Number(a.download_speed_mbps ?? -1); if (mode === 'ping-asc') return Number(a.ping_ms ?? Infinity) - Number(b.ping_ms ?? Infinity); return new Date(b.created_at) - new Date(a.created_at); }); const rows = document.createDocumentFragment(); for (const item of ordered) { const row = document.createElement('tr'); const location = item.latitude === null ? 'Not shared' : `${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}`; row.append(cell(new Date(item.created_at).toLocaleString()), cell(item.download_speed_mbps === null ? '—' : `${item.download_speed_mbps} Mbps`), cell(item.ping_ms === null ? '—' : `${item.ping_ms} ms`), cell(location), cell(item.network_type || '—')); rows.append(row); } body.replaceChildren(rows); }
async function loadResults() { try { const response = await fetch('/api/admin/results'); if (response.status === 401) return location.assign('/admin/login'); const data = await response.json(); results = data.results; renderResults(); status.textContent = `${results.length} results loaded.`; } catch { status.textContent = 'Unable to load results.'; } } sort.addEventListener('change', renderResults); loadResults();
