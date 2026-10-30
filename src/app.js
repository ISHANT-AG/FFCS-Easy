import {downloadTimetablePdf} from './pdf-export.js';
import { startGeneration } from './generation.js';
import { mergeSections, needsFaculty } from './sections.js';
import { pdfItemsToText } from './pdf-text.js';
import { TIMES, DAYS, PRESETS, validateSection, END, changeFaculty, slotBundle } from './engine.js';
import { parsePortalText } from './portal.js';
import { validatePdfUpload } from './uploads.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();

const catalogue = await fetch('data/catalogue.json').then(r => r.json());
const branches = {
  BAC: 'ECE · AI & Cybernetics',
  BAI: 'CSE · AI & Machine Learning',
  BAS: 'Aerospace Engineering',
  BBA: 'Business Administration',
  BCE: 'Computer Science & Engineering',
  BCG: 'CSE · Gaming Technology',
  BCY: 'CSE · Cyber Security',
  BEC: 'Electronics & Communication',
  BET: 'CSE · Education Technology',
  BEY: 'CSE · E-Commerce',
  BHI: 'CSE · Health Informatics',
  BME: 'Mechanical Engineering',
  BMR: 'Mechanical · AI & Robotics',
  BOE: 'Bio Engineering',
  BSA: 'CSE · Cloud Computing',
  MEI: 'Integrated M.Tech · Cyber Security',
  MIB: 'Integrated M.Tech · AI & Bioinformatics',
  MIM: 'Integrated M.Tech · AI',
  MIP: 'Integrated M.Tech · Data Science',
  MSI: 'Integrated M.Sc · Biotechnology'
};

const KEY = 'ffcs-simple-v2';
let saved;
try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { }

let state = {
  step: 0,
  year: '',
  branch: '',
  courses: [],
  preset: 'compact',
  settings: { lunch: true, travel: true, bus: false, busTime: '16:20', walkMinutes: 10 },
  ...saved
};

let result = null, resultIndex = 0, busy = false, worker = null, job = 0;
let drafts = state.pendingUploads || {};
let uploading = new Set();
let openDetails = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, pendingUploads: drafts }));
  } catch {
    toast('Could not save on this device.');
  }
}

function toast(t) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = t;
  el.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('visible'), 4000);
}

function invalidate() {
  worker?.terminate();
  job++;
  busy = false;
  result = null;
  persist();
}

function course(r) {
  return {
    ...r,
    id: uid(),
    custom: false,
    scheduled: r.type !== 'PJ',
    online: false,
    sections: [],
    preferred: [],
    avoid: [],
    only: ''
  };
}

const isCustom = c => Boolean(c.custom || (!c.batch && c.custom !== false));

const prefix = () => String(27 - Number(state.year)).padStart(2, '0');

function availableBranches() {
  if (!state.year) return [];
  return [...new Set(catalogue.filter(c => c.batch.startsWith(prefix())).map(c => c.batch.slice(2)))].sort();
}

function loadCourses() {
  state.courses = catalogue.filter(c => c.batch === prefix() + state.branch).map(course);
  drafts = {};
  invalidate();
}

function go(step) {
  if (busy) { worker?.terminate(); job++; busy = false; }
  state.step = step;
  persist();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function render() {
  const steps = ['Courses', 'Faculty', 'Preferences', 'Timetable'];
  const step0Credits = state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
  const intros = [
    { title: 'Let’s plan your semester.', sub: 'Pick your year and branch to load your official college course list.' },
    { title: 'Your courses. Your faculty.', sub: 'Upload the PDF options available in your FFCS registration portal.' },
    { title: 'How do you like your day?', sub: 'Set your class timing, lunch break, and travel preferences.' },
    { title: 'A week that works for you.', sub: 'Compare timetable alternatives and tailor your faculty selections.' }
  ];

  $('#app').innerHTML = `
    <div class="app">
      <header class="app-header">
        <div class="header-brand-wrap">
          <a class="brand" href="/" aria-label="FFCS easy home">
            <span class="brand-monogram" aria-hidden="true">FFCS</span>
            <span class="brand-title">easy</span>
          </a>
          <div class="brand-meta">
            <span class="meta-slash" aria-hidden="true">/</span>
            <span class="semester-pill">Fall 2026–27</span>
          </div>
        </div>

        <nav class="stepper" aria-label="Steps">
          <ol class="stepper-list">
            ${steps.map((s, i) => {
    const isCurrent = i === state.step;
    const isCompleted = i < state.step;
    const isUpcoming = i > state.step;
    const connector = i > 0 ? `<li class="stepper-connector ${i <= state.step ? 'is-active' : ''}" aria-hidden="true"></li>` : '';
    return `
                ${connector}
                <li class="stepper-item ${isCurrent ? 'is-current' : ''} ${isCompleted ? 'is-completed' : ''} ${isUpcoming ? 'is-upcoming' : ''}">
                  <button data-step="${i}" class="stepper-btn" ${isUpcoming ? 'disabled' : ''} aria-current="${isCurrent ? 'step' : 'false'}">
                    <span class="stepper-badge" aria-hidden="true">
                      ${isCompleted ? '<svg class="icon-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>' : i + 1}
                    </span>
                    <span class="stepper-label">${s}</span>
                  </button>
                </li>
              `;
  }).join('')}
          </ol>
        </nav>
      </header>

      <main class="main-content">
        <div class="intro">
          <h1>${intros[state.step].title}</h1>
          <p>${intros[state.step].sub}</p>
        </div>

        ${[coursesView, facultyView, preferencesView, resultsView][state.step]()}

        <footer class="app-footer">
          <div>
            ${state.step > 0 ? '<button id="back" class="secondary-btn">← Back</button>' : ''}
          </div>
          <div>
            ${state.step < 3 ? `
              <button id="next" class="primary" ${(!state.courses.length && state.step === 0) || (state.step === 0 && step0Credits > 27) || uploading.size ? 'disabled' : ''}>
                ${state.step === 2 ? 'Make my timetable' : 'Continue →'}
              </button>
            ` : ''}
          </div>
        </footer>
      </main>

      <footer class="app-bottom-credits">
        <div class="credits-note">
          Made with <span class="credits-heart" aria-label="love">❤️</span> by 
          <span class="credit-author">
            <button type="button" class="credit-name-btn" aria-label="Ishant Agrawal links">Ishant Agrawal</button>
            <span class="credit-popover" role="tooltip">
              <a href="https://github.com/ISHANT-AG" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
              <span class="popover-sep">·</span>
              <a href="https://www.linkedin.com/in/ishant-agarwal-266b22364/" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
            </span>
          </span>
          &amp; 
          <span class="credit-author">
            <button type="button" class="credit-name-btn" aria-label="Prisha Sharma links">Prisha Sharma</button>
            <span class="credit-popover" role="tooltip">
              <a href="https://github.com/prishaaaS11" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
              <span class="popover-sep">·</span>
              <a href="https://www.linkedin.com/in/prisha-sharma-400bb13ba/" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
            </span>
          </span>
        </div>
        <div class="bottom-note">Designed for VIT students · Registration data saved on your device</div>
      </footer>
    </div>
  `;

  bind();
}

function coursesView() {
  const branchesList = availableBranches();
  const totalCredits = state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
  const showEmptyCatalogue = state.year && !branchesList.length;

  return `
    <div class="courses-layout">
      <aside class="courses-sidebar">
        <section class="panel">
          <div class="panel-header">
            <h2>Registration setup</h2>
            <span class="badge badge-neutral">Step 1 of 4</span>
          </div>
          <div class="fields-stack">
            <div class="field">
              <label class="field-label" for="year">Current study year</label>
              <select id="year" aria-label="Current study year">
                <option value="">Choose your year</option>
                ${[1, 2, 3, 4, 5].map(y => `<option value="${y}" ${String(y) === String(state.year) ? 'selected' : ''}>${['', '1st', '2nd', '3rd', '4th', '5th'][y]} year</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="branch">Branch</label>
              <select id="branch" aria-label="Branch" ${state.year && branchesList.length ? '' : 'disabled'}>
                <option value="">${state.year ? 'Choose your branch' : 'Select year first'}</option>
                ${state.year ? branchesList.map(b => `<option value="${b}" ${b === state.branch ? 'selected' : ''}>${esc(branches[b] || b)}</option>`).join('') : ''}
              </select>
            </div>
          </div>
        </section>

        ${state.branch ? `
          <section class="panel summary-panel">
            <div class="summary-stat-grid">
              <div class="stat-card">
                <span class="stat-num">${state.courses.length}</span>
                <span class="stat-label">Courses</span>
              </div>
              <div class="stat-card">
                <span class="stat-num">${totalCredits}<small style="font-size: 13px; font-weight: 500; color: var(--color-text-tertiary);"> / 27</small></span>
                <span class="stat-label">Credits (Max 27)</span>
              </div>
            </div>
          </section>

          <section class="panel add-course-card">
            <details class="add-course-drawer" id="details-add-course" ${openDetails.has('add-course') ? 'open' : ''}>
              <summary class="add-course-summary">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>
                <span>Add custom course</span>
              </summary>
              <form id="add-course" class="add-course-form">
                <div class="field">
                  <label class="field-label" for="add-course-name">Course name</label>
                  <input id="add-course-name" name="name" required placeholder="e.g. Distributed Systems">
                </div>
                <div class="field">
                  <label class="field-label" for="add-course-code">Course code</label>
                  <input id="add-course-code" name="code" required placeholder="e.g. CSE4001" pattern="[A-Za-z0-9_-]+">
                </div>
                <div class="field">
                  <label class="field-label" for="add-course-credits">Credits</label>
                  <input id="add-course-credits" type="number" name="credits" min="0" max="27" value="3" required>
                </div>
                <label class="checkbox-label" style="margin-top: 4px;">
                  <input type="checkbox" name="project">
                  <span>No weekly classes (Project)</span>
                </label>
                <button type="submit" class="btn-sm primary" style="margin-top: 10px; width: 100%;">Add course</button>
              </form>
            </details>
          </section>
        ` : ''}
      </aside>

      <div class="courses-main">
        ${showEmptyCatalogue ? `
          <section class="panel empty-state-panel" role="status">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.75">
                <path d="M4 19.5v-15A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 01-2.5-2.5z"/><path d="M6 6h10M6 10h10M6 14h6"/>
              </svg>
            </div>
            <h3>Course list unavailable for Year ${state.year}</h3>
            <p>The university registration catalog for this year has not been uploaded yet. Please select a year with an available course list.</p>
          </section>
        ` : !state.year ? `
          <section class="panel empty-state-panel intro-empty-panel">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.75">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <h3>Select your study year</h3>
            <p>Choose your current year and branch on the left to review your registered courses.</p>
          </section>
        ` : state.year && !state.branch ? `
          <section class="panel empty-state-panel intro-empty-panel">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.75">
                <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>
              </svg>
            </div>
            <h3>Now choose your branch</h3>
            <p>Select your engineering branch to populate your standard semester courses.</p>
          </section>
        ` : `
          <section class="panel course-list-panel">
            <div class="panel-header">
              <div>
                <h2>Your registered courses</h2>
                <p class="panel-subtitle">Review your course list before uploading faculty options</p>
              </div>
              <span class="badge ${totalCredits > 27 ? 'badge-danger' : 'badge-neutral'}">${state.courses.length} courses · ${totalCredits} / 27 credits</span>
            </div>
            <div class="course-list">
              ${state.courses.map(c => `
                <div class="course-row ${isCustom(c) ? 'is-custom-course' : ''}">
                  <div class="course-info">
                    <div class="course-name-row">
                      <strong class="course-name">${esc(c.name)}</strong>
                      <span class="course-code-badge">${esc(c.code)}</span>
                      ${isCustom(c) ? '<span class="badge badge-amber">Custom</span>' : ''}
                    </div>
                    <div class="course-meta">
                      <span class="meta-tag">${c.credits} cr</span>
                      <span class="meta-dot">·</span>
                      <span>${c.type === 'PJ' || !c.scheduled ? 'Project (no weekly slots)' : esc(c.type || 'Lecture')}</span>
                      ${c.category ? `<span class="meta-dot">·</span><span class="category-pill">${esc(c.category)}</span>` : ''}
                    </div>
                  </div>
                  <button class="remove-course-btn" data-remove="${c.id}" aria-label="Remove ${esc(c.name)}" title="Remove course">
                    <svg class="icon-trash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M6.5 7.5v4.5M9.5 7.5v4.5M3.5 4.5l.8 8.6a1.5 1.5 0 001.5 1.4h4.4a1.5 1.5 0 001.5-1.4l.8-8.6"/>
                    </svg>
                  </button>
                </div>
              `).join('')}
            </div>
          </section>
        `}
      </div>
    </div>
  `;
}

function facultyView() {
  const readyCourses = state.courses.filter(c => !needsFaculty(c));
  const progressPct = state.courses.length ? Math.round((readyCourses.length / state.courses.length) * 100) : 100;

  return `
    <div class="faculty-workspace">
      <aside class="faculty-navigator">
        <div class="navigator-card panel">
          <div class="nav-progress-header">
            <span class="nav-progress-title">Upload Progress</span>
            <span class="nav-progress-count">${readyCourses.length} of ${state.courses.length} ready</span>
          </div>
          <div class="progress-bar-track" aria-hidden="true">
            <div class="progress-bar-fill" style="width: ${progressPct}%;"></div>
          </div>

          <button type="button" id="jump-incomplete" class="btn-jump-incomplete">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
            <span>Next course needing list</span>
          </button>

          <div class="nav-course-list" role="navigation" aria-label="Course upload navigator">
            ${state.courses.map(c => {
    let statusText = 'Needs PDF';
    let statusClass = 'badge-amber';
    if (c.online) {
      statusText = 'Online';
      statusClass = 'badge-slate';
    } else if (uploading.has(c.id)) {
      statusText = 'Reading…';
      statusClass = 'badge-amber';
    } else if (c.uploadError) {
      statusText = 'Error';
      statusClass = 'badge-danger';
    } else if (drafts[c.id]) {
      statusText = 'Check rows';
      statusClass = 'badge-amber';
    } else if (c.sections.length) {
      statusText = `${c.sections.length} options`;
      statusClass = 'badge-ready';
    } else if (c.scheduled === false) {
      statusText = 'No weekly classes';
      statusClass = 'badge-slate';
    }
    return `
                <button type="button" class="nav-course-item" data-nav-target="${c.id}" aria-label="Jump to ${esc(c.code)}">
                  <div class="nav-course-left">
                    <span class="course-code-badge">${esc(c.code)}</span>
                    <span class="nav-item-name">${esc(c.name)}</span>
                  </div>
                  <span class="badge ${statusClass}">${statusText}</span>
                </button>
              `;
  }).join('')}
          </div>
        </div>
      </aside>

      <div class="faculty-list">
        ${state.courses.map(c => {
    const d = drafts[c.id];
    const isUploading = uploading.has(c.id);
    const hasError = Boolean(c.uploadError);

    let statusText = 'No list yet';
    let statusClass = 'badge-neutral';
    if (c.online) {
      statusText = 'Online';
      statusClass = 'badge-slate';
    } else if (isUploading) {
      statusText = 'Reading PDF…';
      statusClass = 'badge-amber';
    } else if (d) {
      statusText = 'Needs a quick fix';
      statusClass = 'badge-amber';
    } else if (hasError) {
      statusText = 'Upload failed';
      statusClass = 'badge-danger';
    } else if (c.sections.length) {
      statusText = `${c.sections.length} options`;
      statusClass = 'badge-ready';
    } else if (c.scheduled === false) {
      statusText = 'No weekly classes';
      statusClass = 'badge-slate';
    }

    return `
            <article class="faculty-card ${c.online ? 'is-online' : ''} ${isCustom(c) ? 'is-custom-course' : ''}" id="card-${c.id}" data-course-id="${c.id}">
              <header class="faculty-card-header">
                <div class="faculty-course-header-left">
                  <div class="faculty-title-row">
                    <span class="course-code-badge">${esc(c.code)}</span>
                    <h2 class="faculty-course-name">${esc(c.name)}</h2>
                    ${isCustom(c) ? '<span class="badge badge-amber">Custom</span>' : ''}
                  </div>
                  <div class="faculty-course-meta">
                    <span>${c.credits} credits</span>
                    <span class="meta-dot">·</span>
                    <span>${c.scheduled ? 'Weekly classes' : 'No weekly classes (Project)'}</span>
                  </div>
                </div>
                <div class="faculty-header-right">
                  <label class="online-toggle" title="Skip this course when planning timetable">
                    <input type="checkbox" data-online="${c.id}" ${c.online ? 'checked' : ''} aria-label="Online ${esc(c.code)}">
                    <span>Online · skip in timetable</span>
                  </label>
                  <span class="badge ${statusClass}">${statusText}</span>
                </div>
              </header>

              ${c.online ? `
                <div class="online-banner">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                    <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
                  </svg>
                  <span>Not included in your timetable.</span>
                </div>
              ` : `
                <div class="faculty-card-body">
                  ${hasError ? `
                    <div class="upload-error-box" role="alert">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
                        <circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v4M8 11.5h.01"/>
                      </svg>
                      <div>
                        <strong>Upload failed:</strong> ${esc(c.uploadError)}
                      </div>
                    </div>
                  ` : ''}

                  ${isUploading ? `
                    <div class="upload-reading" role="status">
                      <div class="spinner" aria-hidden="true"></div>
                      <span>Reading your list…</span>
                    </div>
                  ` : c.sections.length && !d ? `
                    <div class="upload-success-bar">
                      <div class="success-details">
                        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="8" cy="8" r="6.5"/><path d="M5 8l2 2 4-4"/>
                        </svg>
                        <span class="file-name">${esc(c.lastUpload || 'Faculty list')}</span>
                        <span class="meta-dot">·</span>
                        <strong>${c.sections.length} options saved</strong>
                      </div>
                      <label class="reupload-btn">
                        <span>↑ Add another file</span>
                        <input type="file" data-upload="${c.id}" accept=".pdf,application/pdf" class="visually-hidden-file-input">
                      </label>
                    </div>
                  ` : `
                    <div class="upload-dropzone" data-dropzone="${c.id}">
                      <input type="file" id="upload-${c.id}" data-upload="${c.id}" accept=".pdf,application/pdf" class="visually-hidden-file-input">
                      <label for="upload-${c.id}" class="dropzone-label">
                        <div class="dropzone-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 9l-4-4-4 4M12 5v12"/>
                          </svg>
                        </div>
                        <div class="dropzone-content">
                          <div class="dropzone-title">Upload faculty list PDF</div>
                          <div class="dropzone-sub">Drop PDF here or <span class="browse-link">browse</span> · <small>PDF only</small></div>
                        </div>
                      </label>
                    </div>
                  `}

                  ${d ? `
                    <div class="draft-review-box" role="region" aria-label="Review ${esc(c.code)} faculty options">
                      <div class="draft-review-header">
                        <h3>Check these rows</h3>
                        <p>${esc(d.message || 'Check the names and slots, then add these options.')}</p>
                      </div>
                      <textarea aria-label="Review ${esc(c.code)} faculty options" data-draft="${c.id}" rows="5" class="review-textarea">${esc(d.text)}</textarea>
                      <small class="field-hint">Faculty | Slots | Venue | Seats</small>
                      <div class="review-actions">
                        <button data-save-draft="${c.id}" class="primary btn-sm">Add options</button>
                        <button data-cancel-draft="${c.id}" class="btn-sm">Cancel</button>
                      </div>
                    </div>
                  ` : ''}

                  <div class="faculty-pref-fields">
                    <div class="field">
                      <label class="field-label" for="pref-${c.id}">
                        Preferred faculty <span class="optional-tag">(optional)</span>
                      </label>
                      <input id="pref-${c.id}" data-preferred="${c.id}" value="${esc(c.preferred.join(', '))}" placeholder="Faculty name">
                    </div>
                    <div class="field">
                      <label class="field-label" for="avoid-${c.id}">
                        Avoid faculty <span class="optional-tag">(optional)</span>
                      </label>
                      <input id="avoid-${c.id}" data-avoid="${c.id}" value="${esc(c.avoid.join(', '))}" placeholder="Faculty name">
                    </div>
                  </div>

                  <details class="manual-options-details" id="details-manual-${c.id}" ${openDetails.has('manual-' + c.id) ? 'open' : ''}>
                    <summary class="manual-options-summary">
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>
                      <span>${c.sections.length ? 'View or edit options' : 'Enter options manually'}</span>
                    </summary>
                    <div class="manual-options-content">
                      <textarea data-edit="${c.id}" aria-label="Edit ${esc(c.code)} options" rows="5" placeholder="Faculty name | A11+A12 | AB1-102 | 70">${esc(c.sections.map(s => [s.faculty, s.slots, s.venue, s.seats ?? ''].join(' | ')).join('\n'))}</textarea>
                      <div class="manual-options-footer">
                        <small class="field-hint">${c.scheduled ? 'Faculty | All weekly slots | Venue | Seats' : 'Faculty | NIL | NIL | Seats'}</small>
                        <button data-save-edit="${c.id}" class="btn-sm">Save options</button>
                      </div>
                    </div>
                  </details>
                </div>
              `}
            </article>
          `;
  }).join('')}
      </div>
    </div>
  `;
}

function preferencesView() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Class timing</h2>
        <span class="badge badge-neutral">Preferences</span>
      </div>
      <div class="timing-grid">
        ${[
      ['compact', 'No preference', 'Minimise gaps between classes'],
      ['morning', 'Morning', 'Try to finish by 1:15 pm'],
      ['evening', 'Evening', 'Classes from 1:15 pm – 7:30 pm'],
      ['balanced', 'Whole day', 'Spread classes across the day']
    ].map(([id, name, sub]) => `
          <button type="button" data-preset="${id}" class="timing-card choice ${state.preset === id ? 'is-selected selected' : ''}">
            <div class="timing-title">
              <b>${name}</b>
              ${state.preset === id ? '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3.5 8.5l3 3 6-7"/></svg>' : ''}
            </div>
            <small class="timing-desc">${sub}</small>
          </button>
        `).join('')}
      </div>

      <div class="toggles-list">
        <label class="toggle-row toggle" for="lunch">
          <div class="toggle-info">
            <strong>Keep a lunch break</strong>
            <small class="toggle-desc">One of the two midday slots stays free.</small>
          </div>
          <div class="switch">
            <input id="lunch" type="checkbox" ${state.settings.lunch ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </div>
        </label>

        <label class="toggle-row toggle" for="bus">
          <div class="toggle-info">
            <strong>Day scholar</strong>
            <small class="toggle-desc">Finish before the bus leaves.</small>
          </div>
          <div class="switch">
            <input id="bus" type="checkbox" ${state.settings.bus ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </div>
        </label>

        <label class="toggle-row toggle" for="travel">
          <div class="toggle-info">
            <strong>Less travel between classes</strong>
            <small class="toggle-desc">Avoid back-to-back trips to AB2 when possible.</small>
          </div>
          <div class="switch">
            <input id="travel" type="checkbox" ${state.settings.travel ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </div>
        </label>
      </div>

      <details class="bus-timing-panel" id="details-bus" ${state.settings.bus || openDetails.has('bus') ? 'open' : ''}>
        <summary class="manual-options-summary">Bus timing settings</summary>
        <div class="fields-grid" style="margin-top: 12px;">
          <div class="field">
            <label class="field-label" for="busTime">Bus leaves at</label>
            <input id="busTime" type="time" value="${esc(state.settings.busTime)}" required>
          </div>
          <div class="field">
            <label class="field-label" for="walkMinutes">Walk to the bus stop (minutes)</label>
            <input id="walkMinutes" type="number" min="0" max="120" value="${state.settings.walkMinutes}">
          </div>
        </div>
      </details>
    </section>
  `;
}

function resultsView() {
  const r = result?.results?.[resultIndex];
  if (busy) {
    return `
      <section class="panel empty state-panel" role="status">
        <div class="spinner" style="width: 36px; height: 36px; margin: 0 auto 16px;"></div>
        <h2>Generating timetable combinations…</h2>
        <p id="generation-status" class="field-hint">Checking your course slots…</p><button id="cancel-generation" class="secondary-btn">Cancel</button>
      </section>
    `;
  }
  if (!result) {
    return `
      <section class="panel empty state-panel">
        <h2>Ready to create your timetable</h2>
        <p>Generate your semester schedules with one click.</p>
        <button id="regenerate" class="primary">Make my timetable</button>
      </section>
    `;
  }
  if (!r) {
    return `
      <section class="panel state-panel">
        <div class="state-icon" style="color: var(--color-warning);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.75">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
        </div>
        <h2>Let’s adjust a little.</h2>
        <p>${esc(result.reason || 'No feasible timetable matches all rules.')}</p>
        <div class="state-actions">
          <button id="retry-generation" class="primary">Try again</button><button id="review-faculty" class="secondary-btn">Review faculty lists</button>
          <button id="review-settings" class="secondary-btn">Change preferences</button>
        </div>
      </section>
    `;
  }

  const base = new Map(result.results[0].chosen.map(x => [x.course.code, slotBundle(x.section, x.course.scheduled)]));
  const changed = s => s.chosen.filter(x => x.course.scheduled !== false && base.get(x.course.code) !== slotBundle(x.section)).length;
  const first = r.items.length ? TIMES[Math.min(...r.items.map(x => x.period))].split('–')[0] : '—';
  const last = r.items.length ? TIMES[Math.max(...r.items.map(x => x.period))].split('–')[1] : '—';

  return `
    ${result.truncated ? `
      <div class="notice-box subtle-note" style="margin-bottom: 16px;">
        <svg class="notice-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
          <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
        </svg>
        <span>Best combinations found within the search limit.</span>
      </div>
    ` : ''}

    <div class="result-toolbar result-tools">
      <div class="option-tabs tabs" role="tablist" aria-label="Timetable options">
        ${result.results.map((s, i) => {
    const sFirst = s.items.length ? TIMES[Math.min(...s.items.map(x => x.period))].split('–')[0] : '—';
    const sLast = s.items.length ? TIMES[Math.max(...s.items.map(x => x.period))].split('–')[1] : '—';
    const moved = changed(s);
    return `
            <button data-result="${i}" class="tab-btn ${i === resultIndex ? 'is-selected selected' : ''}" role="tab" aria-selected="${i === resultIndex}">
              <span class="tab-label">Option ${i + 1}</span>
              <span class="tab-sub">${sFirst}–${sLast} · ${s.metrics.gaps} gaps · ${s.metrics.travel} AB2${moved ? ' · ' + moved + ' moved' : ''}</span>
            </button>
          `;
  }).join('')}
      </div>

      <select id="schedule-choice" class="visually-hidden-select" aria-label="Select timetable combination">
        ${result.results.map((s, i) => `<option value="${i}" ${i === resultIndex ? 'selected' : ''}>Option ${i + 1}${i ? ' · ' + changed(s) + ' moved' : ''}</option>`).join('')}
      </select>

      <button id="print" class="secondary-btn">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75">
          <path d="M4 6V2h8v4M4 12H2.5A1.5 1.5 0 011 10.5v-3A1.5 1.5 0 012.5 6h11A1.5 1.5 0 0115 7.5v3a1.5 1.5 0 01-1.5 1.5H12M4 9h8v5H4V9z"/>
        </svg>
        <span>Download PDF</span>
      </button>
    </div>

    <div class="comparison-summary-bar">
      <div class="summary-pill">
        <span class="pill-dot"></span>
        <span><b>${first}</b> first class</span>
      </div>
      <div class="summary-pill">
        <span class="pill-dot"></span>
        <span><b>${last}</b> last class</span>
      </div>
      <div class="summary-pill">
        <span class="pill-dot"></span>
        <span><b>${r.metrics.gaps}</b> free gap slots</span>
      </div>
      <div class="summary-pill">
        <span class="pill-dot"></span>
        <span><b>${r.metrics.travel}</b> AB2 room transitions</span>
      </div>
      <div class="summary-pill pill-subtle">
        <span>${result.results.length} shortlisted options</span>
      </div>
    </div>

    <div class="print-only" style="display: none; margin-bottom: 14px;">
      <h1 style="font-size: 20px; font-weight: 700; color: var(--color-primary); margin: 0 0 4px;">FFCS easy · Timetable (Option ${resultIndex + 1})</h1>
      <p style="font-size: 12px; color: var(--color-text-muted); margin: 0;">Fall 2026–27 · ${r.metrics.gaps} free slots · ${r.metrics.travel} AB2 transitions</p>
    </div>

    <div class="scroll-hint" aria-hidden="true">
      <span>Swipe table horizontally to view all weekdays</span>
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3l5 5-5 5"/></svg>
    </div>

    <section class="panel timetable-wrapper timetable-panel" style="padding: 0; overflow: hidden;">
      <div class="table-scroll-container table-wrap">
        <table class="timetable-table">
          <thead>
            <tr>
              <th class="time-header-col">Time</th>
              ${DAYS.map(d => `<th class="day-header">${d.slice(0, 3)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${TIMES.map((t, p) => `
              <tr>
                <th class="time-header-col">${t}</th>
                ${DAYS.map((_, d) => {
    const x = r.items.find(x => x.day === d && x.period === p);
    const courseIdx = x ? state.courses.findIndex(c => c.code === x.course) : -1;
    const colorIdx = (courseIdx >= 0 ? courseIdx : 0) % 5;
    const selected = x ? r.chosen.find(v => v.course.code === x.course) : null;
    const sameTime = selected?.alternatives || [];
    return `
                    <td class="timetable-cell">
                      ${x ? `
                        <div class="event color${colorIdx}">
                          <b class="event-code">${esc(x.course)}</b>
                          ${sameTime.length > 1 ? `<select class="event-faculty-select" data-faculty-course="${esc(x.course)}" aria-label="Faculty for ${esc(x.course)} ${DAYS[d]} ${x.code}">${sameTime.map(a => `<option value="${esc(a.id)}" ${a.id === selected.section.id ? 'selected' : ''}>${esc(a.faculty)} · ${esc(a.venue)}</option>`).join('')}</select><span class="event-faculty print-faculty">${esc(x.faculty)}</span>` : `<span class="event-faculty">${esc(x.faculty)}</span>`}
                          <small class="event-venue">${esc(x.venue)}</small>
                        </div>
                      ` : `
                        <span class="free-slot free">—</span>
                      `}
                    </td>
                  `;
  }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <details class="panel selected-faculty-drawer" id="details-selected-faculty" ${openDetails.has('selected-faculty') ? 'open' : ''}>
      <summary class="selected-faculty-summary">
        <span>Selected faculty summary</span>
      </summary>
      <div class="faculty-breakdown-list">
        ${r.chosen.map(({ course: c, section: s }) => `
          <div class="course-row">
            <div>
              <strong>${esc(c.code)} · ${esc(s.faculty)}</strong>
              <small style="display: block; color: var(--color-text-muted); margin-top: 2px;">${esc(s.slots)} · ${esc(s.venue)}${s.seats ? ` · ${esc(s.seats)} seats` : ''}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </details>

    <p class="subtle-note" style="text-align: center; margin-top: 14px;">
      Check available seats in FFCS before registering.
    </p>
  `;
}

function bind() {
  document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => go(Number(b.dataset.step)));

  document.querySelectorAll('.credit-name-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const parent = btn.closest('.credit-author');
      const wasOpen = parent?.classList.contains('is-open');
      document.querySelectorAll('.credit-author').forEach(a => a.classList.remove('is-open'));
      if (!wasOpen) parent?.classList.add('is-open');
    };
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.credit-author').forEach(a => a.classList.remove('is-open'));
  });

  $('#back')?.addEventListener('click', () => go(state.step - 1));

  $('#next')?.addEventListener('click', () => {
    if (state.step === 0) {
      const total = state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
      if (total > 27) {
        return toast(`Cannot proceed: Total credits (${total}) exceed the maximum limit of 27. Please remove courses.`);
      }
    }
    if (state.step === 1) {
      for (const id of Object.keys(drafts)) {
        if (state.courses.some(c => c.id === id && !c.online) && !saveOptions(id, drafts[id].text, false)) return;
      }
      const missing = state.courses.filter(needsFaculty);
      if (missing.length) return toast('Upload faculty options for ' + missing.map(c => c.code).join(', ') + '.');
    }
    state.step === 2 ? generate() : go(state.step + 1);
  });

  $('#year')?.addEventListener('change', e => {
    state.year = e.target.value;
    state.branch = '';
    state.courses = [];
    invalidate();
    render();
  });

  $('#branch')?.addEventListener('change', e => {
    state.branch = e.target.value;
    loadCourses();
    render();
  });

  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    state.courses = state.courses.filter(c => c.id !== b.dataset.remove);
    invalidate();
    render();
  });

  $('#add-course')?.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(e.target);
    const code = String(data.get('code')).trim().toUpperCase();
    const name = String(data.get('name')).trim();
    const credits = Number(data.get('credits'));
    const isProject = data.get('project') === 'on';

    if (!code || !name) return toast('Please enter both course code and name.');
    if (state.courses.some(c => c.code === code)) return toast('Course ' + code + ' is already in your list.');

    const currentCredits = state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
    if (currentCredits >= 27) {
      return toast('Credit limit fulfilled! You have already reached the maximum limit of 27 credits.');
    }
    if (currentCredits + credits > 27) {
      return toast(`Cannot add course: Adding ${credits} credits exceeds the 27 credits limit (Current: ${currentCredits} / 27).`);
    }

    state.courses.push({
      id: uid(),
      custom: true,
      code,
      name,
      credits,
      type: isProject ? 'PJ' : 'LT',
      scheduled: !isProject,
      online: false,
      sections: [],
      preferred: [],
      avoid: [],
      only: ''
    });
    invalidate();
    render();
    toast('Course added: ' + code);
  });

  $('#jump-incomplete')?.addEventListener('click', () => {
    const nextIncomplete = state.courses.find(needsFaculty);
    if (nextIncomplete) {
      const card = document.getElementById('card-' + nextIncomplete.id);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('is-highlighted');
        setTimeout(() => card.classList.remove('is-highlighted'), 1500);
      }
    } else {
      toast('All required courses have faculty lists uploaded!');
    }
  });

  document.querySelectorAll('[data-nav-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.navTarget;
      const card = document.getElementById('card-' + targetId);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('is-highlighted');
        setTimeout(() => card.classList.remove('is-highlighted'), 1500);
      }
    });
  });

  document.querySelectorAll('[data-online]').forEach(el => el.onchange = () => {
    const c = state.courses.find(c => c.id === el.dataset.online);
    if (c) {
      c.online = el.checked;
      invalidate();
      render();
    }
  });

  document.querySelectorAll('[data-upload]').forEach(el => el.onchange = () => readUpload(el.dataset.upload, el.files[0]));

  document.querySelectorAll('[data-dropzone]').forEach(zone => {
    const id = zone.dataset.dropzone;
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragleave', e => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) readUpload(id, file);
    });
  });

  for (const key of ['preferred', 'avoid']) {
    document.querySelectorAll(`[data-${key}]`).forEach(el => {
      const update = () => {
        const c = state.courses.find(c => c.id === el.dataset[key]);
        if (c) {
          c[key] = el.value.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
          invalidate();
        }
      };
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
  }

  document.querySelectorAll('[data-draft]').forEach(el => el.oninput = () => {
    if (drafts[el.dataset.draft]) {
      drafts[el.dataset.draft].text = el.value;
      persist();
    }
  });

  document.querySelectorAll('[data-save-draft]').forEach(b => b.onclick = () => saveOptions(b.dataset.saveDraft, drafts[b.dataset.saveDraft].text, false));
  document.querySelectorAll('[data-save-edit]').forEach(b => b.onclick = () => saveOptions(b.dataset.saveEdit, document.querySelector(`[data-edit="${b.dataset.saveEdit}"]`).value, true));
  document.querySelectorAll('[data-cancel-draft]').forEach(b => b.onclick = () => {
    delete drafts[b.dataset.cancelDraft];
    persist();
    render();
  });

  for (const key of ['lunch', 'bus', 'travel', 'busTime', 'walkMinutes']) {
    $('#' + key)?.addEventListener('change', e => {
      if (!e.target.validity.valid || (['busTime', 'walkMinutes'].includes(key) && e.target.value === '')) {
        render();
        return;
      }
      state.settings[key] = ['lunch', 'bus', 'travel'].includes(key) ? e.target.checked : key === 'walkMinutes' ? Number(e.target.value) : e.target.value;
      invalidate();
      render();
    });
  }

  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    state.preset = b.dataset.preset;
    invalidate();
    render();
  });

  document.querySelectorAll('[data-result]').forEach(b => b.onclick = () => {
    resultIndex = Number(b.dataset.result);
    render();
  });

  $('#schedule-choice')?.addEventListener('change', e => {
    resultIndex = Number(e.target.value);
    render();
  });

  document.querySelectorAll('[data-faculty-course]').forEach(el => {
    el.onchange = () => {
      try {
        result.results[resultIndex] = changeFaculty(
          result.results[resultIndex],
          el.dataset.facultyCourse,
          el.value,
          state.settings,
          state.preset
        );
        render();
        toast('Faculty updated. Timings stay the same.');
      } catch (e) {
        render();
        toast(e.message);
      }
    };
  });

  $('#print')?.addEventListener('click', downloadPdf);
  $('#regenerate')?.addEventListener('click', generate);
  $('#retry-generation')?.addEventListener('click', generate);
  $('#cancel-generation')?.addEventListener('click', () => go(2));
  $('#review-faculty')?.addEventListener('click', () => go(1));
  $('#review-settings')?.addEventListener('click', () => go(2));

  document.querySelectorAll('details').forEach(el => {
    el.addEventListener('toggle', () => {
      const id = el.id.replace('details-', '');
      if (el.open) openDetails.add(id);
      else openDetails.delete(id);
    });
  });
}

function saveOptions(id, text, replace) {
  try {
    const c = state.courses.find(c => c.id === id), rows = [];
    for (const line of text.split('\n').filter(s => s.trim())) {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 3 || parts.length > 4) throw Error('Use Faculty | Slots | Venue | Seats for each row.');
      const [faculty, slots, venue, seats = ''] = parts;
      rows.push({ id: uid(), faculty, slots, venue, seats });
    }
    c.sections = replace && !rows.length ? [] : mergeSections(replace ? { ...c, sections: [] } : c, rows);
    delete drafts[id];
    delete c.uploadError;
    invalidate();
    render();
    toast('Faculty options saved.');
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

async function pdfText(file) {
  const pdf = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdf.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const doc = await pdf.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), content = await page.getTextContent();
    text += pdfItemsToText(content.items);
  }
  return text;
}

async function readUpload(id, file) {
  if (!file) return;
  const c = state.courses.find(c => c.id === id);
  if (!c) return;
  uploading.add(id);
  delete c.uploadError;
  render();
  try {
    await validatePdfUpload(file);
    const text = await pdfText(file), parsed = parsePortalText(text);
    if (parsed.code !== c.code) throw Error('This PDF is for ' + parsed.code + '. Upload it under that course.');
    const rows = (parsed.sections || []).map(s => ({ ...s, id: uid() }));
    const reviewText = rows.length ? rows.map(s => [s.faculty, s.slots, s.venue, s.seats ?? ''].join(' | ')).join('\n') : text;
    try {
      c.sections = mergeSections(c, rows);
      c.lastUpload = file.name;
      delete drafts[id];
      delete c.uploadError;
      invalidate();
      toast(`${c.code}: ${c.sections.length} options saved.`);
    } catch (validation) {
      drafts[id] = { text: reviewText, message: 'Please correct these rows before continuing: ' + validation.message };
      persist();
    }
  } catch (e) {
    c.uploadError = e.message;
    toast(e.message);
  } finally {
    uploading.delete(id);
    render();
  }
}

async function downloadPdf(){
 const schedule=result?.results?.[resultIndex];if(!schedule)return;
 const button=$('#print');if(button){button.disabled=true;button.textContent='Preparing PDF…';}
 try{await downloadTimetablePdf(schedule,{option:resultIndex+1,courses:state.courses});}
 catch(error){toast(error.message||'Could not export PDF. Please try again.');}
 finally{if(button){button.disabled=false;button.textContent='Download PDF';}}
}

function generate() {
  worker?.terminate();
  state.step = 3;
  busy = true;
  result = null;
  resultIndex = 0;
  persist();
  const id = ++job;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  worker = startGeneration({ id, courses: state.courses, settings: state.settings, preset: state.preset, limit: 5 }, {
    onProgress: progress => {
      if (id !== job) return;
      const message = $('#generation-status');
      if (message) message.textContent = progress.found ? 'Shortlisting a few useful timetables…' : 'Checking your course slots…';
    },
    onResult: data => {
      if (id !== job) return;
      result = data;
      busy = false;
      render();
    }
  });
}

render();
