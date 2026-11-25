/**
 * DataScrub & SQLBox AI — In-Browser Dataset Cleaner, Profiler & SQL Sandbox
 */
(function () {
  'use strict';

  const CONFIG_KEY = 'kg_ai_config';
  const SAMPLE_CSV = `id,name,department,salary,email
1, Alice Sharma ,Engineering,125000,alice@acme.io
2,Bob Verma,Sales,82000,bob@acme.io
2,Bob Verma,Sales,82000,bob@acme.io
3,Charvi Patel,  Engineering ,138000,charvi@acme.io
4,Devansh Joshi,AI Research,,devansh@acme.io
5,Esha Nair,Product,108000,
6,Rohan Mehta,AI Research,149000,rohan@acme.io
4,Devansh Joshi,AI Research,,devansh@acme.io`;

  const rawDataInput = document.getElementById('rawDataInput');
  const fileInput = document.getElementById('fileInput');
  const btnSample = document.getElementById('btnSample');
  const btnAutoClean = document.getElementById('btnAutoClean');
  const btnDownloadCsv = document.getElementById('btnDownloadCsv');
  const btnDownloadJson = document.getElementById('btnDownloadJson');
  const columnProfileBox = document.getElementById('columnProfileBox');
  const sqlAskInput = document.getElementById('sqlAskInput');
  const sqlQueryInput = document.getElementById('sqlQueryInput');
  const btnRunSql = document.getElementById('btnRunSql');
  const btnAiSql = document.getElementById('btnAiSql');
  const sqlStatus = document.getElementById('sqlStatus');
  const sqlResultTable = document.getElementById('sqlResultTable');
  const aiEngineBadge = document.getElementById('aiEngineBadge');

  const statRows = document.getElementById('statRows');
  const statCols = document.getElementById('statCols');
  const statDupes = document.getElementById('statDupes');
  const statNulls = document.getElementById('statNulls');

  let currentRecords = [];

  function getAiConfig() {
    try {
      const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      if (cfg.provider && cfg.provider !== 'offline') {
        aiEngineBadge.textContent = `Engine: ${cfg.provider.toUpperCase()} + SQL`;
        return cfg;
      }
    } catch {}
    aiEngineBadge.textContent = 'Engine: Local SQL + Profiler';
    return { provider: 'offline' };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        row.push(cell); cell = '';
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length > 0) {
      row.push(cell);
      if (row.some(c => c !== '')) rows.push(row);
    }
    if (rows.length < 2) return [];
    const headers = rows[0].map((h, idx) => h.trim() || `col_${idx + 1}`);
    return rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        const raw = (r[i] ?? '').trim();
        if (raw === '' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'n/a') {
          obj[h] = null;
        } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
          obj[h] = Number(raw);
        } else {
          obj[h] = raw;
        }
      });
      return obj;
    });
  }

  function parseInput(cleanMode = false) {
    const raw = rawDataInput.value.trim();
    if (!raw) { currentRecords = []; renderAll(); return; }
    let records = [];
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        records = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        records = parseCsv(raw);
      }
    } else {
      records = parseCsv(raw);
    }

    let dupesRemoved = 0;
    let nullsFixed = 0;

    if (cleanMode && records.length > 0) {
      const seen = new Set();
      const deduped = [];
      records.forEach(rec => {
        const normalized = {};
        Object.keys(rec).forEach(k => {
          const cleanKey = k.trim();
          let v = rec[k];
          if (typeof v === 'string') v = v.replace(/\s+/g, ' ').trim();
          if (v === '' || v === undefined || v === null) {
            v = 'N/A';
            nullsFixed++;
          }
          normalized[cleanKey] = v;
        });
        const sig = JSON.stringify(normalized);
        if (seen.has(sig)) dupesRemoved++;
        else { seen.add(sig); deduped.push(normalized); }
      });
      records = deduped;
      rawDataInput.value = toCsv(records);
    }

    statDupes.textContent = dupesRemoved;
    statNulls.textContent = nullsFixed;
    currentRecords = records;
    renderAll();
  }

  function toCsv(records) {
    if (!records || records.length === 0) return '';
    const cols = Object.keys(records[0]);
    const esc = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...records.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  }

  function renderProfile() {
    if (!currentRecords.length) { columnProfileBox.innerHTML = ''; return; }
    const cols = Object.keys(currentRecords[0]);
    statRows.textContent = currentRecords.length;
    statCols.textContent = cols.length;
    columnProfileBox.innerHTML = cols.map(c => {
      const nulls = currentRecords.filter(r => r[c] === null || r[c] === '' || r[c] === 'N/A').length;
      const sampleVal = currentRecords.find(r => r[c] !== null && r[c] !== 'N/A')?.[c];
      const dtype = typeof sampleVal === 'number' ? 'NUM' : 'STR';
      return `<span class="col-chip"><b>${c}</b> (${dtype}${nulls ? ` • ${nulls} missing` : ''})</span>`;
    }).join('');
  }

  function runSql() {
    if (!currentRecords.length) {
      sqlResultTable.innerHTML = '<div style="padding:1.2rem;color:#64748b;">Load or paste a dataset first.</div>';
      return;
    }
    const query = sqlQueryInput.value.trim();
    try {
      alasql('DROP TABLE IF EXISTS dataset');
      alasql('CREATE TABLE dataset');
      alasql.tables.dataset.data = currentRecords;
      const t0 = performance.now();
      const res = alasql(query);
      const ms = (performance.now() - t0).toFixed(1);
      const rows = Array.isArray(res) ? res : [];
      sqlStatus.textContent = `Returned ${rows.length} rows in ${ms} ms`;
      sqlStatus.className = 'hint';
      renderTable(rows);
    } catch (err) {
      sqlStatus.textContent = `SQL Error: ${err.message}`;
      sqlStatus.className = 'hint err';
    }
  }

  function renderTable(rows) {
    if (!rows.length) {
      sqlResultTable.innerHTML = '<div style="padding:1.2rem;color:#64748b;">Query returned 0 rows.</div>';
      return;
    }
    const cols = Object.keys(rows[0]);
    sqlResultTable.innerHTML = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 100).map(r => `<tr>${cols.map(c => `<td>${r[c] ?? 'NULL'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderAll() {
    if (!currentRecords.length) {
      statRows.textContent = '0'; statCols.textContent = '0';
    }
    renderProfile();
    runSql();
  }

  btnAutoClean.addEventListener('click', () => parseInput(true));
  btnRunSql.addEventListener('click', runSql);
  rawDataInput.addEventListener('input', () => parseInput(false));
  btnSample.addEventListener('click', () => { rawDataInput.value = SAMPLE_CSV; parseInput(false); });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    rawDataInput.value = await file.text();
    parseInput(false);
  });

  function downloadFile(content, filename, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
  }
  btnDownloadCsv.addEventListener('click', () => downloadFile(toCsv(currentRecords), 'cleaned_dataset.csv', 'text/csv'));
  btnDownloadJson.addEventListener('click', () => downloadFile(JSON.stringify(currentRecords, null, 2), 'cleaned_dataset.json', 'application/json'));

  btnAiSql.addEventListener('click', async () => {
    const ask = sqlAskInput.value.trim();
    if (!ask || !currentRecords.length) return;
    const cols = Object.keys(currentRecords[0]).join(', ');
    const cfg = getAiConfig();
    if (cfg.provider === 'offline') {
      sqlQueryInput.value = `SELECT * FROM dataset LIMIT 10`;
      sqlStatus.textContent = 'Offline fallback SQL applied (enable Ollama/Gemini in Krishna.OS for NL->SQL)';
      runSql();
      return;
    }
    btnAiSql.textContent = 'Translating...';
    const prompt = `Write ONLY a valid AlaSQL query against table \`dataset\` with columns (${cols}). Request: ${ask}. No markdown fences.`;
    try {
      let sql = '';
      if (cfg.provider === 'ollama') {
        const res = await fetch(cfg.endpoint || 'http://localhost:11434/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: cfg.model || 'qwen2.5:3b', messages: [{ role: 'user', content: prompt }], stream: false })
        });
        sql = (await res.json()).message?.content || '';
      } else if (cfg.provider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || 'gemini-4-hydrogen'}:generateContent?key=${cfg.apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        sql = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        const res = await fetch(cfg.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }] })
        });
        sql = (await res.json()).choices?.[0]?.message?.content || '';
      }
      sqlQueryInput.value = sql.replace(/```sql|```/gi, '').trim();
      runSql();
    } catch (err) {
      sqlStatus.textContent = `AI SQL error: ${err.message}`;
      sqlStatus.className = 'hint err';
    } finally {
      btnAiSql.textContent = 'Ask AI -> SQL ✨';
    }
  });

  getAiConfig();
  rawDataInput.value = SAMPLE_CSV;
  parseInput(false);
})();
