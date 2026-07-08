import './style.css';

import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/progress/linear-progress.js';

type JobStatus = 'new' | 'uploading' | 'building' | 'done' | 'error';

type JobMeta = {
  originalFilename?: string;
  packageName?: string;
  versionName?: string;
  versionCode?: string;
  appLabel?: string;
  appLabelRef?: string;
};

type Job = {
  id: string;
  status: JobStatus;
  meta?: JobMeta;
  logs?: string;
  error?: string;
  outputReady?: boolean;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app');

const state: {
  job: Job | null;
  pollTimer: number | null;
  file: File | null;
  analysis: any | null;
  analysisLoading: boolean;
} = {
  job: null,
  pollTimer: null,
  file: null,
  analysis: null,
  analysisLoading: false
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function render() {
  const job = state.job;
  const uploadDisabled = !state.file || (job && job.status !== 'done' && job.status !== 'error');

  app.innerHTML = `
    <main class="shell">
      <header class="hero">
        <div class="hero__tag">apktool-web</div>
        <h1 class="hero__title">Repackage (resign) APKs for installability.</h1>
        <p class="hero__sub">
          Upload an APK and get back a resigned APK for download. Output is also copied into
          <code>~/mini/Downloads</code>.
        </p>
      </header>

      <section class="card">
        <div class="card__title">Upload APK</div>
        <div class="uploader" id="dropzone">
          <div class="uploader__inner">
            <div class="uploader__hint">Drop an APK here, or choose a file.</div>
            <div class="uploader__row">
              <input id="file" type="file" accept=".apk" />
              <md-filled-button id="upload" ${uploadDisabled ? 'disabled' : ''}>
                Upload and repackage
              </md-filled-button>
            </div>
            <div class="uploader__file">${state.file ? esc(state.file.name) : 'No file selected'}</div>
          </div>
        </div>
        ${job ? renderStatus(job) : ''}
        ${job && job.outputReady ? `
          <div class="actions">
            <a class="download" href="/api/jobs/${encodeURIComponent(job.id)}/download">Download repacked APK</a>
          </div>
        ` : ''}
      </section>

      ${job ? `
        <section class="card">
          <div class="card__title">
            Logs
            ${job.id ? `
              <span class="card__actions">
                <a class="download" href="/api/jobs/${encodeURIComponent(job.id)}/log" target="_blank" rel="noreferrer">Open full log</a>
                <a class="download" href="/api/jobs/${encodeURIComponent(job.id)}/log-analysis" target="_blank" rel="noreferrer">Open analysis JSON</a>
              </span>
            ` : ''}
          </div>
          <pre class="logs">${esc(job.logs || '')}</pre>
        </section>
      ` : ''}

      ${job && job.id ? `
        <section class="card">
          <div class="card__title">Log analysis</div>
          <div class="actions">
            <md-outlined-button id="refreshAnalysis" ${state.analysisLoading ? 'disabled' : ''}>
              ${state.analysisLoading ? 'Loading…' : 'Refresh analysis'}
            </md-outlined-button>
          </div>
          ${state.analysis ? renderAnalysis(state.analysis) : `<div class="muted">No analysis loaded yet.</div>`}
        </section>
      ` : ''}

      <footer class="footer">
        <div class="footer__pill">Note: This flow resigns the APK. It does not rebuild resources or change the manifest.</div>
      </footer>
    </main>
  `;

  wire();
}

function renderStatus(job: Job) {
  const statusLine =
    job.status === 'error'
      ? `<div class="status status--err">Error: ${esc(job.error || 'unknown error')}</div>`
      : `<div class="status">Status: <strong>${esc(job.status)}</strong>${job.meta?.packageName ? ` • <span class="mono">${esc(job.meta.packageName)}</span>` : ''}</div>`;

  const showProgress = job.status === 'uploading' || job.status === 'decoding' || job.status === 'building';
  return `
    <div class="statuswrap">
      ${statusLine}
      ${showProgress ? `<md-linear-progress indeterminate></md-linear-progress>` : ''}
    </div>
  `;
}

function wire() {
  const fileEl = document.querySelector<HTMLInputElement>('#file')!;
  const uploadBtn = document.querySelector<HTMLElement>('#upload')!;
  const dropzone = document.querySelector<HTMLElement>('#dropzone')!;

  fileEl.onchange = () => {
    state.file = fileEl.files?.[0] ?? null;
    render();
  };

  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add('uploader--drag');
  };
  dropzone.ondragleave = () => dropzone.classList.remove('uploader--drag');
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('uploader--drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      state.file = f;
      render();
    }
  };

  uploadBtn.onclick = async () => {
    if (!state.file) return;
    await upload(state.file);
  };

  const ra = document.querySelector<HTMLElement>('#refreshAnalysis');
  if (ra) {
    ra.onclick = async () => {
      await refreshAnalysis();
    };
  }
}

function renderAnalysis(a: any) {
  const summary = a?.summary || {};
  const commands: Array<any> = Array.isArray(a?.commands) ? a.commands : [];
  const failures: Array<any> = Array.isArray(a?.failures) ? a.failures : [];
  return `
    <div class="analysis">
      <div class="analysis__row">
        <div><strong>Lines</strong>: ${esc(String(summary.lines ?? ''))}</div>
        <div><strong>Command exits</strong>: ${esc(String(summary.commandExits ?? ''))}</div>
        <div><strong>Failure hints</strong>: ${esc(String(summary.failureHints ?? ''))}</div>
      </div>

      ${commands.length ? `
        <div class="analysis__title">Commands</div>
        <div class="analysis__table">
          ${commands.map((c) => `
            <div class="analysis__tr">
              <div class="analysis__td mono">${esc(String(c.label ?? ''))}</div>
              <div class="analysis__td">runs=${esc(String(c.runs ?? ''))}</div>
              <div class="analysis__td">totalMs=${esc(String(c.totalDurationMs ?? ''))}</div>
              <div class="analysis__td">lastCode=${esc(String(c.lastCode ?? ''))}</div>
              <div class="analysis__td">lastSignal=${esc(String(c.lastSignal ?? ''))}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${failures.length ? `
        <div class="analysis__title">Recent failures</div>
        <pre class="logs">${esc(failures.map((f) => f.line).slice(-20).join('\\n'))}</pre>
      ` : ''}
    </div>
  `;
}

async function upload(file: File) {
  state.job = { id: '', status: 'uploading' };
  state.analysis = null;
  render();

  const fd = new FormData();
  fd.append('apk', file, file.name);

  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) {
    state.job = { id: '', status: 'error', error: data?.error || `HTTP ${res.status}`, logs: data?.logs || '' };
    render();
    return;
  }

  state.job = data as Job;
  state.analysis = null;

  startPolling();
  render();
}

function startPolling() {
  if (!state.job?.id) return;
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = window.setInterval(async () => {
    if (!state.job?.id) return;
    const res = await fetch(`/api/jobs/${encodeURIComponent(state.job.id)}`);
    if (!res.ok) return;
    const data = (await res.json()) as Job;
    state.job = data;
    if (data.status === 'done' || data.status === 'error') {
      if (state.pollTimer) window.clearInterval(state.pollTimer);
      state.pollTimer = null;
      // Pull analysis once at the end (also available via button).
      refreshAnalysis().catch(() => {});
    }
    render();
  }, 1000);
}

async function refreshAnalysis() {
  if (!state.job?.id) return;
  state.analysisLoading = true;
  render();
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(state.job.id)}/log-analysis`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.analysis = await res.json();
  } catch (e: any) {
    state.analysis = { summary: { error: String(e?.message || e) }, commands: [], failures: [], tail: [] };
  } finally {
    state.analysisLoading = false;
    render();
  }
}

render();
