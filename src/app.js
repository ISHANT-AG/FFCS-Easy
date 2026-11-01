import { downloadTimetablePdf, downloadTwinTimetablePdf } from './pdf-export.js';
import { startGeneration } from './generation.js';
import { mergeSections, needsFaculty } from './sections.js';
import { pdfItemsToText } from './pdf-text.js';
import {
  TIMES,
  DAYS,
  PRESETS,
  validateSection,
  END,
  changeFaculty,
  slotBundle,
  dailyPattern,
  solveTwin,
  findCommonCourses,
  normalizeCourseCode,
  changeTwinFaculty,
} from './engine.js';
import { parsePortalText } from './portal.js';
import { validatePdfUpload } from './uploads.js';

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const uid = () => crypto.randomUUID();

const catalogue = await fetch('data/catalogue.json').then((r) => r.json());
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
  MSI: 'Integrated M.Sc · Biotechnology',
};

const KEY = 'ffcs-simple-v2';
const KEY_TWIN = 'ffcs-twin-v1';
const KEY_MODE = 'ffcs-active-mode-v1';

let appMode = 'individual';
try {
  const m = localStorage.getItem(KEY_MODE);
  if (m === 'twin' || m === 'individual') appMode = m;
} catch {}

let saved;
try {
  saved = JSON.parse(localStorage.getItem(KEY));
} catch {}

let savedTwin;
try {
  savedTwin = JSON.parse(localStorage.getItem(KEY_TWIN));
} catch {}

let state = {
  step: 0,
  year: '',
  branch: '',
  courses: [],
  preset: 'compact',
  settings: { lunch: true, travel: true, bus: false, busTime: '16:20', walkMinutes: 10 },
  ...saved,
};

let twinState = {
  step: 0,
  student1: {
    name: 'You',
    year: '',
    branch: '',
    courses: [],
    preset: 'compact',
    settings: { lunch: true, travel: true, bus: false, busTime: '16:20', walkMinutes: 10 },
  },
  student2: {
    name: 'Friend',
    year: '',
    branch: '',
    courses: [],
    preset: 'compact',
    settings: { lunch: true, travel: true, bus: false, busTime: '16:20', walkMinutes: 10 },
  },
  ...savedTwin,
};

let result = null,
  resultIndex = 0,
  busy = false,
  worker = null,
  job = 0;

let twinResult = null,
  twinResultIndex = 0,
  twinActiveStudentTab = 0,
  showNoCommonModal = false;

let drafts = state.pendingUploads || {};
let twinDrafts = [{}, {}];
let uploading = new Set();
let openDetails = new Set();

function persist() {
  try {
    if (appMode === 'twin') {
      localStorage.setItem(KEY_TWIN, JSON.stringify(twinState));
    } else {
      localStorage.setItem(KEY, JSON.stringify({ ...state, pendingUploads: drafts }));
    }
    localStorage.setItem(KEY_MODE, appMode);
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
  if (appMode === 'twin') {
    twinResult = null;
  } else {
    result = null;
  }
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
    only: '',
  };
}

const isCustom = (c) => Boolean(c.custom || (!c.batch && c.custom !== false));

const prefix = (year = state.year) => String(27 - Number(year)).padStart(2, '0');

function availableBranches(year = state.year) {
  if (!year) return [];
  const p = prefix(year);
  const fromCat = [
    ...new Set(
      catalogue.filter((c) => c.batch && c.batch.startsWith(p)).map((c) => c.batch.slice(2))
    ),
  ];
  if (Number(year) === 4) {
    return [...new Set([...fromCat, ...Object.keys(branches)])].sort();
  }
  return fromCat.sort();
}

function loadCourses(target = state) {
  const p = prefix(target.year);
  target.courses = catalogue.filter((c) => c.batch === p + target.branch).map(course);
  if (target === state) drafts = {};
  invalidate();
}

function go(step) {
  if (busy) {
    worker?.terminate();
    job++;
    busy = false;
  }
  if (appMode === 'twin') {
    twinState.step = step;
  } else {
    state.step = step;
  }
  persist();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function switchMode(newMode) {
  if (appMode === newMode) return;
  if (busy) {
    worker?.terminate();
    job++;
    busy = false;
  }
  appMode = newMode;
  persist();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function render() {
  const isTwin = appMode === 'twin';
  const currentStep = isTwin ? twinState.step : state.step;

  const individualSteps = ['Courses', 'Faculty', 'Preferences', 'Timetable'];
  const name1 = twinState.student1.name || 'You';
  const name2 = twinState.student2.name || 'Friend';
  const twinSteps = ['Courses', `${name1} Faculty`, `${name2} Faculty`, 'Preferences', 'Timetable'];
  const steps = isTwin ? twinSteps : individualSteps;

  const step0Credits = isTwin
    ? Math.max(
        twinState.student1.courses.reduce((n, c) => n + Number(c.credits || 0), 0),
        twinState.student2.courses.reduce((n, c) => n + Number(c.credits || 0), 0)
      )
    : state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);

  const individualIntros = [
    {
      title: 'Let’s plan your semester.',
      sub: 'Pick your year and branch to load your official college course list.',
    },
    {
      title: 'Your courses. Your faculty.',
      sub: 'Upload the PDF options available in your FFCS registration portal.',
    },
    {
      title: 'How do you like your day?',
      sub: 'Set your class timing, lunch break, and travel preferences.',
    },
    {
      title: 'A week that works for you.',
      sub: 'Compare timetable alternatives and tailor your faculty selections.',
    },
  ];

  const twinIntros = [
    {
      title: 'Plan your timetable with a friend.',
      sub: 'Enter details for both students to find common courses and coordinate classes.',
    },
    {
      title: `Faculty options for ${name1}.`,
      sub: `Upload the PDF section allocations available in ${name1}’s registration portal.`,
    },
    {
      title: `Faculty options for ${name2}.`,
      sub: `Upload the PDF section allocations available in ${name2}’s registration portal.`,
    },
    {
      title: 'Class timing & campus routines.',
      sub: 'Set individual timing, lunch break, and travel preferences for both students.',
    },
    {
      title: 'Your paired timetable options.',
      sub: 'Explore clash-free schedule combinations matched for maximum shared classes.',
    },
  ];

  const intros = isTwin ? twinIntros : individualIntros;

  const viewFn = isTwin
    ? [
        twinCoursesView,
        () => twinFacultyView(0),
        () => twinFacultyView(1),
        twinPreferencesView,
        twinResultsView,
      ][currentStep]
    : [coursesView, facultyView, preferencesView, resultsView][currentStep];

  $('#app').innerHTML = `
    <div class="app">
      <header class="app-header">
        <div class="header-brand-wrap">
          <a class="brand" href="./" aria-label="FFCS easy home">
            <img src="assets/logo.png" alt="FFCS Easy" class="brand-logo-img">
          </a>
          <div class="brand-meta">
            <span class="meta-slash" aria-hidden="true">/</span>
            <span class="semester-pill">Fall 2026–27</span>
          </div>
          <button type="button" class="watch-demo" id="watch-demo" aria-haspopup="dialog"><svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 3.5v13l10-6.5z"/></svg><span>Watch demo</span></button>
        </div>

        <nav class="stepper" aria-label="Steps">
          <ol class="stepper-list">
            ${steps
              .map((s, i) => {
                const isCurrent = i === currentStep;
                const isCompleted = i < currentStep;
                const isUpcoming = i > currentStep;
                const connector =
                  i > 0
                    ? `<li class="stepper-connector ${i <= currentStep ? 'is-active' : ''}" aria-hidden="true"></li>`
                    : '';
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
              })
              .join('')}
          </ol>
        </nav>
      </header>

      <div class="mode-switcher-bar">
        <div class="mode-segmented-control" role="tablist" aria-label="Planning mode">
          <button type="button" role="tab" id="mode-individual" class="mode-tab ${appMode === 'individual' ? 'is-active' : ''}" aria-selected="${appMode === 'individual'}">
            <span class="mode-tab-title">Individual FFCS</span>
          </button>
          <button type="button" role="tab" id="mode-twin" class="mode-tab ${appMode === 'twin' ? 'is-active' : ''}" aria-selected="${appMode === 'twin'}">
            <span class="mode-tab-title">Twin FFCS</span>
            <span class="mode-tab-badge">Plan with a friend</span>
          </button>
        </div>
      </div>

      <main class="main-content">
        <div class="intro">
          <h1>${intros[currentStep]?.title || ''}</h1>
          <p>${intros[currentStep]?.sub || ''}</p>
        </div>

        ${viewFn()}

        <footer class="app-footer">
          <div>
            ${currentStep > 0 ? '<button id="back" class="secondary-btn">← Back</button>' : ''}
          </div>
          <div>
            ${
              currentStep < (isTwin ? 4 : 3)
                ? `
              <button id="next" class="primary" ${
                isTwin
                  ? (!twinState.student1.courses.length && currentStep === 0) ||
                    (!twinState.student2.courses.length && currentStep === 0) ||
                    uploading.size
                    ? 'disabled'
                    : ''
                  : (!state.courses.length && currentStep === 0) ||
                      (currentStep === 0 && step0Credits > 27) ||
                      uploading.size
                    ? 'disabled'
                    : ''
              }>
                ${
                  isTwin
                    ? currentStep === 3
                      ? 'Make our timetables'
                      : currentStep === 0
                        ? `Continue to ${name1}’s faculty →`
                        : currentStep === 1
                          ? `Continue to ${name2}’s faculty →`
                          : 'Continue →'
                    : currentStep === 2
                      ? 'Make my timetable'
                      : 'Continue →'
                }
              </button>
            `
                : ''
            }
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
                ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${String(y) === String(state.year) ? 'selected' : ''}>${['', '1st', '2nd', '3rd', '4th', '5th'][y]} year</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="branch">Branch</label>
              <select id="branch" aria-label="Branch" ${state.year && branchesList.length ? '' : 'disabled'}>
                <option value="">${state.year ? 'Choose your branch' : 'Select year first'}</option>
                ${state.year ? branchesList.map((b) => `<option value="${b}" ${b === state.branch ? 'selected' : ''}>${esc(branches[b] || b)}</option>`).join('') : ''}
              </select>
            </div>
          </div>
        </section>

        ${
          state.branch
            ? `
          <section class="panel summary-panel">
            <div class="summary-stat-grid">
              <div class="stat-card">
                <span class="stat-num">${state.courses.length}</span>
                <span class="stat-label">Courses</span>
              </div>
              <div class="stat-card">
                <span class="stat-num ${totalCredits > 27 ? 'is-overflow' : ''}">${totalCredits}</span>
                <span class="stat-label">Credits ${totalCredits > 27 ? '(max 27)' : ''}</span>
              </div>
            </div>
          </section>

          <section class="panel add-course-panel">
            <details class="add-course-details" id="details-add-course" ${openDetails.has('add-course') ? 'open' : ''}>
              <summary class="add-course-summary">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>
                <span>Add a course</span>
              </summary>
              <form id="add-course" class="add-course-form">
                <div class="field">
                  <label class="field-label" for="add-code">Course code</label>
                  <input id="add-code" name="code" placeholder="e.g. CSE2001" required style="text-transform: uppercase;">
                </div>
                <div class="field">
                  <label class="field-label" for="add-name">Course title</label>
                  <input id="add-name" name="name" placeholder="e.g. Data Structures" required>
                </div>
                <div class="field">
                  <label class="field-label" for="add-credits">Credits</label>
                  <input id="add-credits" name="credits" type="number" min="1" max="27" value="3" required>
                </div>
                <label class="checkbox-row" for="add-project">
                  <input id="add-project" name="project" type="checkbox">
                  <span>No weekly classes (Project course)</span>
                </label>
                <button type="submit" class="secondary-btn" style="width: 100%; justify-content: center;">Add to my list</button>
              </form>
            </details>
          </section>
        `
            : ''
        }
      </aside>

      <div class="courses-main">
        ${
          showEmptyCatalogue
            ? `
          <section class="panel empty-state-panel" role="status">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.75">
                <path d="M4 19.5v-15A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 01-2.5-2.5z"/><path d="M6 6h10M6 10h10M6 14h6"/>
              </svg>
            </div>
            <h3>Course list unavailable for Year ${state.year}</h3>
            <p>The university registration catalog for this year has not been uploaded yet. Please select a year with an available course list.</p>
          </section>
        `
            : !state.year
              ? `
          <section class="panel empty-state-panel intro-empty-panel">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.75">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <h3>Select your study year</h3>
            <p>Choose your current year and branch on the left to review your registered courses.</p>
          </section>
        `
              : state.year && !state.branch
                ? `
          <section class="panel empty-state-panel intro-empty-panel">
            <div class="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.75">
                <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>
              </svg>
            </div>
            <h3>Now choose your branch</h3>
            <p>Select your engineering branch to populate your standard semester courses.</p>
          </section>
        `
                : `
          <section class="panel course-list-panel">
            <div class="panel-header">
              <div>
                <h2>Your registered courses</h2>
                <p class="panel-subtitle">Review your course list before uploading faculty options</p>
              </div>
              <span class="badge ${totalCredits > 27 ? 'badge-danger' : 'badge-neutral'}">${state.courses.length} courses · ${totalCredits} / 27 credits</span>
            </div>

            ${
              state.courses.length === 0
                ? `
              <div class="empty-branch-courses-notice">
                <div class="notice-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                    <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
                  </svg>
                </div>
                <div>
                  <strong>No prescribed courses in the catalogue for ${esc(branches[state.branch] || state.branch)} (Year ${state.year}).</strong>
                  <p>Fourth-year students can add their backlog, elective, or capstone project courses on the left using <strong>+ Add a course</strong>.</p>
                </div>
              </div>
            `
                : ''
            }

            <div class="course-list">
              ${state.courses
                .map(
                  (c) => `
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
              `
                )
                .join('')}
            </div>
          </section>
        `
        }
      </div>
    </div>
  `;
}

function facultyView() {
  const readyCourses = state.courses.filter((c) => !needsFaculty(c));
  const progressPct = state.courses.length
    ? Math.round((readyCourses.length / state.courses.length) * 100)
    : 100;

  return `
    <div class="faculty-layout">
      <aside class="faculty-navigator-wrap">
        <div class="faculty-navigator panel">
          <div class="nav-header">
            <span class="nav-title">Upload progress</span>
            <span class="nav-count">${readyCourses.length} of ${state.courses.length} ready</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${progressPct}%;"></div>
          </div>
          <button id="jump-incomplete" class="jump-btn ${progressPct === 100 ? 'is-all-ready' : ''}">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8l5 5 5-5"/></svg>
            <span>${progressPct === 100 ? 'All courses ready' : 'Next course needing list'}</span>
          </button>
          <ul class="nav-pills-list">
            ${state.courses
              .map((c) => {
                const isReady = !needsFaculty(c);
                const isOnline = c.online;
                const statusClass = isOnline
                  ? 'badge-slate'
                  : isReady
                    ? 'badge-success'
                    : 'badge-amber';
                const statusLabel = isOnline
                  ? 'Online'
                  : c.sections.length
                    ? `${c.sections.length} options`
                    : 'Needs PDF';
                return `
                <li class="nav-pill-item">
                  <button type="button" class="nav-pill-btn" data-nav-target="${c.id}">
                    <span class="course-code-badge">${esc(c.code)}</span>
                    <span class="nav-pill-name">${esc(c.name)}</span>
                    <span class="badge ${statusClass}">${statusLabel}</span>
                  </button>
                </li>
              `;
              })
              .join('')}
          </ul>
        </div>
      </aside>

      <div class="faculty-cards-list">
        ${state.courses
          .map((c) => {
            const hasError = Boolean(c.uploadError);
            const isReady = !needsFaculty(c);
            const isUploading = uploading.has(c.id);
            const d = drafts[c.id];
            const statusClass = c.online
              ? 'badge-slate'
              : isReady
                ? 'badge-success'
                : 'badge-amber';
            const statusText = c.online
              ? 'Online'
              : c.sections.length
                ? `${c.sections.length} saved`
                : 'No list yet';

            return `
            <article class="faculty-card panel ${c.online ? 'is-online' : ''} ${hasError ? 'has-error' : ''}" id="card-${c.id}">
              <header class="faculty-card-header">
                <div class="faculty-header-left">
                  <div class="faculty-title-row">
                    <span class="course-code-badge">${esc(c.code)}</span>
                    <h3 class="course-title">${esc(c.name)}</h3>
                  </div>
                  <div class="course-meta">
                    <span class="meta-tag">${c.credits} credits</span>
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

              ${
                c.online
                  ? `
                <div class="online-banner">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                    <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
                  </svg>
                  <span>Not included in your timetable.</span>
                </div>
              `
                  : `
                <div class="faculty-card-body">
                  ${
                    hasError
                      ? `
                    <div class="upload-error-box" role="alert">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
                        <circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v4M8 11.5h.01"/>
                      </svg>
                      <div>
                        <strong>Upload failed:</strong> ${esc(c.uploadError)}
                      </div>
                    </div>
                  `
                      : ''
                  }

                  ${
                    isUploading
                      ? `
                    <div class="upload-reading" role="status">
                      <div class="spinner" aria-hidden="true"></div>
                      <span>Reading your list…</span>
                    </div>
                  `
                      : c.sections.length && !d
                        ? `
                    <div class="upload-success-bar">
                      <div class="success-details">
                        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="8" cy="8" r="6.5"/><path d="M5 8l2 2 4-4"/>
                        </svg>
                        <span class="file-name">${esc(c.lastUpload || 'Faculty list')}</span>
                        <span class="meta-dot">·</span>
                        <strong>${c.sections.length} options saved</strong>
                      </div>
                      <label class="reupload-btn" title="Upload another PDF for this course">
                        <span>Re-upload</span>
                        <input type="file" accept=".pdf,application/pdf" data-upload="${c.id}" class="sr-only">
                      </label>
                    </div>
                  `
                        : `
                    <div class="upload-dropzone" data-dropzone="${c.id}">
                      <div class="dropzone-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>
                      </div>
                      <div class="dropzone-text">
                        <strong>Upload faculty list PDF</strong>
                        <p>Drop PDF here or <label class="browse-link">browse<input type="file" accept=".pdf,application/pdf" data-upload="${c.id}" class="sr-only"></label> · PDF only</p>
                      </div>
                    </div>
                  `
                  }

                  ${
                    d
                      ? `
                    <div class="draft-correction-box" role="alert">
                      <p class="draft-msg">${esc(d.message)}</p>
                      <textarea data-draft="${c.id}" aria-label="Correct ${esc(c.code)} rows" rows="5">${esc(d.text)}</textarea>
                      <div class="draft-actions">
                        <small class="field-hint">${c.scheduled ? 'Format: Faculty | All weekly slots | Venue | Seats' : 'Format: Faculty | NIL | NIL | Seats'}</small>
                        <button data-save-draft="${c.id}" class="primary btn-sm">Save corrections</button>
                      </div>
                    </div>
                  `
                      : ''
                  }

                  <div class="faculty-preferences-grid">
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
                      <textarea data-edit="${c.id}" aria-label="Edit ${esc(c.code)} options" rows="5" placeholder="Faculty name | A11+A12 | AB1-102 | 70">${esc(c.sections.map((s) => [s.faculty, s.slots, s.venue, s.seats ?? ''].join(' | ')).join('\n'))}</textarea>
                      <div class="manual-options-footer">
                        <small class="field-hint">${c.scheduled ? 'Faculty | All weekly slots | Venue | Seats' : 'Faculty | NIL | NIL | Seats'}</small>
                        <button data-save-edit="${c.id}" class="btn-sm">Save options</button>
                      </div>
                    </div>
                  </details>
                </div>
              `
              }
            </article>
          `;
          })
          .join('')}
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
          ['balanced', 'Whole day', 'Spread classes across the day'],
        ]
          .map(
            ([id, name, sub]) => `
          <button type="button" data-preset="${id}" class="timing-card choice ${state.preset === id ? 'is-selected selected' : ''}">
            <div class="timing-title">
              <b>${name}</b>
              ${state.preset === id ? '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3.5 8.5l3 3 6-7"/></svg>' : ''}
            </div>
            <small class="timing-desc">${sub}</small>
          </button>
        `
          )
          .join('')}
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
        <p id="generation-status" class="field-hint">Checking your course slots…</p>
        <button id="cancel-generation" class="secondary-btn">Cancel</button>
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
          <button id="retry-generation" class="primary">Try again</button>
          <button id="review-faculty" class="secondary-btn">Review faculty lists</button>
          <button id="review-settings" class="secondary-btn">Change preferences</button>
        </div>
      </section>
    `;
  }

  const base = new Map(
    result.results[0].chosen.map((x) => [x.course.code, slotBundle(x.section, x.course.scheduled)])
  );
  const changed = (s) =>
    s.chosen.filter(
      (x) => x.course.scheduled !== false && base.get(x.course.code) !== slotBundle(x.section)
    ).length;
  const first = r.items.length
    ? TIMES[Math.min(...r.items.map((x) => x.period))].split('–')[0]
    : '—';
  const last = r.items.length
    ? TIMES[Math.max(...r.items.map((x) => x.period))].split('–')[1]
    : '—';

  return `
    ${result.morningFallback ? '<div class="notice-box subtle-note" style="margin-bottom:16px">A morning-only timetable was not found. These alternatives include later classes.</div>' : ''}
    ${
      result.truncated
        ? `
      <div class="notice-box subtle-note" style="margin-bottom: 16px;">
        <svg class="notice-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
          <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
        </svg>
        <span>Best combinations found within the search limit.</span>
      </div>
    `
        : ''
    }

    <div class="result-toolbar result-tools">
      <div class="option-tabs tabs" role="tablist" aria-label="Timetable options">
        ${result.results
          .map((s, i) => {
            const sFirst = s.items.length
              ? TIMES[Math.min(...s.items.map((x) => x.period))].split('–')[0]
              : '—';
            const sLast = s.items.length
              ? TIMES[Math.max(...s.items.map((x) => x.period))].split('–')[1]
              : '—';
            const moved = changed(s);
            const sameRoutine = i > 0 && dailyPattern(s) === dailyPattern(result.results[0]);
            return `
            <button data-result="${i}" class="tab-btn ${i === resultIndex ? 'is-selected selected' : ''}" role="tab" aria-selected="${i === resultIndex}">
              <span class="tab-label">Option ${i + 1}</span>
              <span class="tab-sub">${sFirst}–${sLast} · ${s.metrics.gaps} gaps · ${s.metrics.travel} AB2${sameRoutine ? ' · Same routine' : ''}${moved ? ' · ' + moved + ' courses moved' : ''}</span>
            </button>
          `;
          })
          .join('')}
      </div>

      <div class="result-actions">
        <button id="print" class="secondary-btn">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6V2h8v4M4 12H2.5A1.5 1.5 0 011 10.5v-3A1.5 1.5 0 012.5 6h11A1.5 1.5 0 0115 7.5v3a1.5 1.5 0 01-1.5 1.5H12M4 9h8v5H4V9z"/></svg>
          <span>Download PDF</span>
        </button>
        <button id="browser-print" class="secondary-btn" title="Open system print dialog">
          <span>Print</span>
        </button>
      </div>
    </div>

    <div class="metrics-summary-bar">
      <div class="summary-pill">
        <span><b>${first} – ${last}</b> campus day</span>
      </div>
      <div class="summary-pill">
        <span><b>${r.metrics.gaps}</b> gap slots</span>
      </div>
      <div class="summary-pill">
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
              ${DAYS.map((d) => `<th class="day-header">${d.slice(0, 3)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${TIMES.map(
              (t, p) => `
              <tr>
                <th class="time-header-col">${t}</th>
                ${DAYS.map((_, d) => {
                  const x = r.items.find((x) => x.day === d && x.period === p);
                  const courseIdx = x ? state.courses.findIndex((c) => c.code === x.course) : -1;
                  const colorIdx = (courseIdx >= 0 ? courseIdx : 0) % 5;
                  const selected = x ? r.chosen.find((v) => v.course.code === x.course) : null;
                  const sameTime = selected?.alternatives || [];
                  return `
                    <td class="timetable-cell">
                      ${
                        x
                          ? `
                        <div class="event color${colorIdx}">
                          <b class="event-code">${esc(x.course)}</b>
                          ${sameTime.length > 1 ? `<select class="event-faculty-select" data-faculty-course="${esc(x.course)}" aria-label="Faculty for ${esc(x.course)} ${DAYS[d]} ${x.code}">${sameTime.map((a) => `<option value="${esc(a.id)}" ${a.id === selected.section.id ? 'selected' : ''}>${esc(a.faculty)} · ${esc(a.venue)}</option>`).join('')}</select><span class="event-faculty print-faculty">${esc(x.faculty)}</span>` : `<span class="event-faculty">${esc(x.faculty)}</span>`}
                          <small class="event-venue">${esc(x.venue)}</small>
                        </div>
                      `
                          : `
                        <span class="free-slot free">—</span>
                      `
                      }
                    </td>
                  `;
                }).join('')}
              </tr>
            `
            ).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <details class="panel selected-faculty-drawer" id="details-selected-faculty" ${openDetails.has('selected-faculty') ? 'open' : ''}>
      <summary class="selected-faculty-summary">
        <span>Selected faculty summary</span>
      </summary>
      <div class="faculty-breakdown-list">
        ${r.chosen
          .map(
            ({ course: c, section: s }) => `
          <div class="course-row">
            <div>
              <strong>${esc(c.code)} · ${esc(s.faculty)}</strong>
              <small style="display: block; color: var(--color-text-muted); margin-top: 2px;">${esc(s.slots)} · ${esc(s.venue)}${s.seats ? ` · ${esc(s.seats)} seats` : ''}</small>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </details>

    <p class="subtle-note" style="text-align: center; margin-top: 14px;">
      Check available seats in FFCS before registering.
    </p>
  `;
}

// ============================================================================
// Twin FFCS Views
// ============================================================================

function twinCoursesView() {
  const s1 = twinState.student1;
  const s2 = twinState.student2;
  const branchesList1 = availableBranches(s1.year);
  const branchesList2 = availableBranches(s2.year);
  const total1 = s1.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
  const total2 = s2.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
  const common = findCommonCourses(s1.courses, s2.courses);
  const commonScheduled = common.filter((c) => c.isScheduled);

  return `
    <div class="twin-courses-layout">
      <div class="common-summary-banner">
        <div class="common-summary-header">
          <div class="common-summary-title">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 2a2 2 0 100 4 2 2 0 000-4zM6 6a2 2 0 100 4 2 2 0 000-4zM3 14v-1a3 3 0 013-3h1M13 14v-1a3 3 0 00-3-3H9"/>
            </svg>
            <span>
              ${
                common.length
                  ? `${common.length} common course${common.length > 1 ? 's' : ''} found`
                  : 'Add courses for both students to identify common classes'
              }
            </span>
          </div>
          ${
            common.length
              ? `
            <span class="badge badge-success">
              ${commonScheduled.length} scheduled on campus ${common.length > commonScheduled.length ? `· ${common.length - commonScheduled.length} project/online` : ''}
            </span>
          `
              : ''
          }
        </div>

        ${
          common.length
            ? `
          <div class="common-courses-pills">
            ${common
              .map(
                (c) => `
              <span class="common-course-tag" title="${esc(c.name)}">
                <span>${esc(c.code)}</span>
                ${c.isScheduled ? '<small>· Together</small>' : '<small>· Project/Online</small>'}
              </span>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>

      ${
        showNoCommonModal
          ? `
        <div class="twin-modal-backdrop" id="no-common-modal">
          <div class="twin-modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div class="twin-modal-header">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-warning);">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              <h3 id="modal-title">No common courses</h3>
            </div>
            <div class="twin-modal-body">
              Your selected course lists don’t share any courses. Edit your courses or continue with Individual FFCS.
            </div>
            <div class="twin-modal-actions">
              <button type="button" class="secondary-btn" id="close-no-common-modal">Edit courses</button>
              <button type="button" class="primary" id="switch-to-individual-modal">Continue with Individual FFCS</button>
            </div>
          </div>
        </div>
      `
          : ''
      }

      <div class="twin-students-grid">
        <!-- Student 1 Card -->
        <article class="twin-student-card panel">
          <header class="twin-student-header">
            <div class="twin-name-input-wrap">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="8" cy="5" r="3"/><path d="M2.5 14a5.5 5.5 0 0111 0"/>
              </svg>
              <input type="text" id="twin-name-0" class="twin-name-input" value="${esc(s1.name)}" placeholder="Your name" aria-label="First student name">
            </div>
            <span class="badge ${total1 > 27 ? 'badge-danger' : 'badge-neutral'}">${s1.courses.length} courses · ${total1}/27 cr</span>
          </header>

          <div class="fields-stack">
            <div class="field">
              <label class="field-label" for="twin-year-0">Study year for ${esc(s1.name)}</label>
              <select id="twin-year-0" aria-label="Year for ${esc(s1.name)}">
                <option value="">Choose year</option>
                ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${String(y) === String(s1.year) ? 'selected' : ''}>${['', '1st', '2nd', '3rd', '4th', '5th'][y]} year</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="twin-branch-0">Branch for ${esc(s1.name)}</label>
              <select id="twin-branch-0" aria-label="Branch for ${esc(s1.name)}" ${s1.year && branchesList1.length ? '' : 'disabled'}>
                <option value="">${s1.year ? 'Choose branch' : 'Select year first'}</option>
                ${s1.year ? branchesList1.map((b) => `<option value="${b}" ${b === s1.branch ? 'selected' : ''}>${esc(branches[b] || b)}</option>`).join('') : ''}
              </select>
            </div>
          </div>

          ${
            s1.branch && s1.courses.length === 0
              ? `
            <div class="empty-branch-courses-notice">
              <p>No standard prescribed courses found for ${esc(branches[s1.branch] || s1.branch)} (Year ${s1.year}). Add backlog, elective or project courses below.</p>
            </div>
          `
              : ''
          }

          <div class="course-list">
            ${s1.courses
              .map(
                (c) => `
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
                    <span>${c.type === 'PJ' || !c.scheduled ? 'Project' : esc(c.type || 'Lecture')}</span>
                  </div>
                </div>
                <button class="remove-course-btn" data-twin-remove="0:${c.id}" aria-label="Remove ${esc(c.name)} for ${esc(s1.name)}" title="Remove course">
                  <svg class="icon-trash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M6.5 7.5v4.5M9.5 7.5v4.5M3.5 4.5l.8 8.6a1.5 1.5 0 001.5 1.4h4.4a1.5 1.5 0 001.5-1.4l.8-8.6"/></svg>
                </button>
              </div>
            `
              )
              .join('')}
          </div>

          <details class="add-course-details" id="details-twin-add-0">
            <summary class="add-course-summary">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>
              <span>Add course for ${esc(s1.name)}</span>
            </summary>
            <form id="twin-add-course-0" class="add-course-form">
              <div class="field">
                <label class="field-label" for="twin-add-code-0">Course code</label>
                <input id="twin-add-code-0" name="code" placeholder="e.g. CSE2001" required style="text-transform: uppercase;">
              </div>
              <div class="field">
                <label class="field-label" for="twin-add-name-0">Course title</label>
                <input id="twin-add-name-0" name="name" placeholder="e.g. Data Structures" required>
              </div>
              <div class="field">
                <label class="field-label" for="twin-add-credits-0">Credits</label>
                <input id="twin-add-credits-0" name="credits" type="number" min="1" max="27" value="3" required>
              </div>
              <label class="checkbox-row" for="twin-add-project-0">
                <input id="twin-add-project-0" name="project" type="checkbox">
                <span>No weekly classes (Project course)</span>
              </label>
              <button type="submit" class="secondary-btn" style="width: 100%; justify-content: center;">Add to ${esc(s1.name)}’s list</button>
            </form>
          </details>
        </article>

        <!-- Student 2 Card -->
        <article class="twin-student-card panel">
          <header class="twin-student-header">
            <div class="twin-name-input-wrap">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="8" cy="5" r="3"/><path d="M2.5 14a5.5 5.5 0 0111 0"/>
              </svg>
              <input type="text" id="twin-name-1" class="twin-name-input" value="${esc(s2.name)}" placeholder="Friend's name" aria-label="Second student name">
            </div>
            <span class="badge ${total2 > 27 ? 'badge-danger' : 'badge-neutral'}">${s2.courses.length} courses · ${total2}/27 cr</span>
          </header>

          <div class="fields-stack">
            <div class="field">
              <label class="field-label" for="twin-year-1">Study year for ${esc(s2.name)}</label>
              <select id="twin-year-1" aria-label="Year for ${esc(s2.name)}">
                <option value="">Choose year</option>
                ${[1, 2, 3, 4, 5].map((y) => `<option value="${y}" ${String(y) === String(s2.year) ? 'selected' : ''}>${['', '1st', '2nd', '3rd', '4th', '5th'][y]} year</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="twin-branch-1">Branch for ${esc(s2.name)}</label>
              <select id="twin-branch-1" aria-label="Branch for ${esc(s2.name)}" ${s2.year && branchesList2.length ? '' : 'disabled'}>
                <option value="">${s2.year ? 'Choose branch' : 'Select year first'}</option>
                ${s2.year ? branchesList2.map((b) => `<option value="${b}" ${b === s2.branch ? 'selected' : ''}>${esc(branches[b] || b)}</option>`).join('') : ''}
              </select>
            </div>
          </div>

          ${
            s2.branch && s2.courses.length === 0
              ? `
            <div class="empty-branch-courses-notice">
              <p>No standard prescribed courses found for ${esc(branches[s2.branch] || s2.branch)} (Year ${s2.year}). Add backlog, elective or project courses below.</p>
            </div>
          `
              : ''
          }

          <div class="course-list">
            ${s2.courses
              .map(
                (c) => `
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
                    <span>${c.type === 'PJ' || !c.scheduled ? 'Project' : esc(c.type || 'Lecture')}</span>
                  </div>
                </div>
                <button class="remove-course-btn" data-twin-remove="1:${c.id}" aria-label="Remove ${esc(c.name)} for ${esc(s2.name)}" title="Remove course">
                  <svg class="icon-trash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M6.5 7.5v4.5M9.5 7.5v4.5M3.5 4.5l.8 8.6a1.5 1.5 0 001.5 1.4h4.4a1.5 1.5 0 001.5-1.4l.8-8.6"/></svg>
                </button>
              </div>
            `
              )
              .join('')}
          </div>

          <details class="add-course-details" id="details-twin-add-1">
            <summary class="add-course-summary">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>
              <span>Add course for ${esc(s2.name)}</span>
            </summary>
            <form id="twin-add-course-1" class="add-course-form">
              <div class="field">
                <label class="field-label" for="twin-add-code-1">Course code</label>
                <input id="twin-add-code-1" name="code" placeholder="e.g. CSE2001" required style="text-transform: uppercase;">
              </div>
              <div class="field">
                <label class="field-label" for="twin-add-name-1">Course title</label>
                <input id="twin-add-name-1" name="name" placeholder="e.g. Data Structures" required>
              </div>
              <div class="field">
                <label class="field-label" for="twin-add-credits-1">Credits</label>
                <input id="twin-add-credits-1" name="credits" type="number" min="1" max="27" value="3" required>
              </div>
              <label class="checkbox-row" for="twin-add-project-1">
                <input id="twin-add-project-1" name="project" type="checkbox">
                <span>No weekly classes (Project course)</span>
              </label>
              <button type="submit" class="secondary-btn" style="width: 100%; justify-content: center;">Add to ${esc(s2.name)}’s list</button>
            </form>
          </details>
        </article>
      </div>
    </div>
  `;
}

function twinFacultyView(studentIdx) {
  const student = studentIdx === 0 ? twinState.student1 : twinState.student2;
  const readyCourses = student.courses.filter((c) => !needsFaculty(c));
  const progressPct = student.courses.length
    ? Math.round((readyCourses.length / student.courses.length) * 100)
    : 100;

  return `
    <div class="faculty-layout">
      <aside class="faculty-navigator-wrap">
        <div class="faculty-navigator panel">
          <div class="nav-header">
            <span class="nav-title">${esc(student.name)}’s uploads</span>
            <span class="nav-count">${readyCourses.length} of ${student.courses.length} ready</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${progressPct}%;"></div>
          </div>
          <button id="jump-incomplete" class="jump-btn ${progressPct === 100 ? 'is-all-ready' : ''}">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8l5 5 5-5"/></svg>
            <span>${progressPct === 100 ? 'All courses ready' : 'Next course needing list'}</span>
          </button>
          <ul class="nav-pills-list">
            ${student.courses
              .map((c) => {
                const isReady = !needsFaculty(c);
                const isOnline = c.online;
                const statusClass = isOnline
                  ? 'badge-slate'
                  : isReady
                    ? 'badge-success'
                    : 'badge-amber';
                const statusLabel = isOnline
                  ? 'Online'
                  : c.sections.length
                    ? `${c.sections.length} options`
                    : 'Needs PDF';
                return `
                <li class="nav-pill-item">
                  <button type="button" class="nav-pill-btn" data-nav-target="${c.id}">
                    <span class="course-code-badge">${esc(c.code)}</span>
                    <span class="nav-pill-name">${esc(c.name)}</span>
                    <span class="badge ${statusClass}">${statusLabel}</span>
                  </button>
                </li>
              `;
              })
              .join('')}
          </ul>
        </div>
      </aside>

      <div class="faculty-cards-list">
        ${student.courses
          .map((c) => {
            const hasError = Boolean(c.uploadError);
            const isReady = !needsFaculty(c);
            const isUploading = uploading.has(`${studentIdx}:${c.id}`);
            const d = twinDrafts[studentIdx]?.[c.id];
            const statusClass = c.online
              ? 'badge-slate'
              : isReady
                ? 'badge-success'
                : 'badge-amber';
            const statusText = c.online
              ? 'Online'
              : c.sections.length
                ? `${c.sections.length} saved`
                : 'No list yet';

            return `
            <article class="faculty-card panel ${c.online ? 'is-online' : ''} ${hasError ? 'has-error' : ''}" id="card-${c.id}">
              <header class="faculty-card-header">
                <div class="faculty-header-left">
                  <div class="faculty-title-row">
                    <span class="course-code-badge">${esc(c.code)}</span>
                    <h3 class="course-title">${esc(c.name)}</h3>
                  </div>
                  <div class="course-meta">
                    <span class="meta-tag">${c.credits} credits</span>
                    <span class="meta-dot">·</span>
                    <span>${c.scheduled ? 'Weekly classes' : 'No weekly classes (Project)'}</span>
                  </div>
                </div>
                <div class="faculty-header-right">
                  <label class="online-toggle" title="Skip this course when planning timetable">
                    <input type="checkbox" data-twin-online="${studentIdx}:${c.id}" ${c.online ? 'checked' : ''} aria-label="Online ${esc(c.code)}">
                    <span>Online · skip in timetable</span>
                  </label>
                  <span class="badge ${statusClass}">${statusText}</span>
                </div>
              </header>

              ${
                c.online
                  ? `
                <div class="online-banner">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75">
                    <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
                  </svg>
                  <span>Not included in ${esc(student.name)}’s timetable.</span>
                </div>
              `
                  : `
                <div class="faculty-card-body">
                  ${
                    hasError
                      ? `
                    <div class="upload-error-box" role="alert">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
                        <circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v4M8 11.5h.01"/>
                      </svg>
                      <div>
                        <strong>Upload failed:</strong> ${esc(c.uploadError)}
                      </div>
                    </div>
                  `
                      : ''
                  }

                  ${
                    isUploading
                      ? `
                    <div class="upload-reading" role="status">
                      <div class="spinner" aria-hidden="true"></div>
                      <span>Reading ${esc(student.name)}’s list…</span>
                    </div>
                  `
                      : c.sections.length && !d
                        ? `
                    <div class="upload-success-bar">
                      <div class="success-details">
                        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="8" cy="8" r="6.5"/><path d="M5 8l2 2 4-4"/>
                        </svg>
                        <span class="file-name">${esc(c.lastUpload || 'Faculty list')}</span>
                        <span class="meta-dot">·</span>
                        <strong>${c.sections.length} options saved for ${esc(student.name)}</strong>
                      </div>
                      <label class="reupload-btn" title="Upload another PDF for this course">
                        <span>Re-upload</span>
                        <input type="file" accept=".pdf,application/pdf" data-twin-upload="${studentIdx}:${c.id}" class="sr-only">
                      </label>
                    </div>
                  `
                        : `
                    <div class="upload-dropzone" data-twin-dropzone="${studentIdx}:${c.id}">
                      <div class="dropzone-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>
                      </div>
                      <div class="dropzone-text">
                        <strong>Upload faculty PDF for ${esc(student.name)}</strong>
                        <p>Drop PDF here or <label class="browse-link">browse<input type="file" accept=".pdf,application/pdf" data-twin-upload="${studentIdx}:${c.id}" class="sr-only"></label> · PDF only</p>
                      </div>
                    </div>
                  `
                  }

                  ${
                    d
                      ? `
                    <div class="draft-correction-box" role="alert">
                      <p class="draft-msg">${esc(d.message)}</p>
                      <textarea data-twin-draft="${studentIdx}:${c.id}" aria-label="Correct ${esc(c.code)} rows" rows="5">${esc(d.text)}</textarea>
                      <div class="draft-actions">
                        <small class="field-hint">${c.scheduled ? 'Format: Faculty | All weekly slots | Venue | Seats' : 'Format: Faculty | NIL | NIL | Seats'}</small>
                        <button data-twin-save-draft="${studentIdx}:${c.id}" class="primary btn-sm">Save corrections</button>
                      </div>
                    </div>
                  `
                      : ''
                  }

                  <div class="faculty-preferences-grid">
                    <div class="field">
                      <label class="field-label" for="twin-pref-${studentIdx}-${c.id}">
                        Preferred faculty <span class="optional-tag">(optional)</span>
                      </label>
                      <input id="twin-pref-${studentIdx}-${c.id}" data-twin-preferred="${studentIdx}:${c.id}" value="${esc(c.preferred.join(', '))}" placeholder="Faculty name">
                    </div>
                    <div class="field">
                      <label class="field-label" for="twin-avoid-${studentIdx}-${c.id}">
                        Avoid faculty <span class="optional-tag">(optional)</span>
                      </label>
                      <input id="twin-avoid-${studentIdx}-${c.id}" data-twin-avoid="${studentIdx}:${c.id}" value="${esc(c.avoid.join(', '))}" placeholder="Faculty name">
                    </div>
                  </div>

                  <details class="manual-options-details" id="details-manual-${studentIdx}-${c.id}" ${openDetails.has(`manual-${studentIdx}-${c.id}`) ? 'open' : ''}>
                    <summary class="manual-options-summary">
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>
                      <span>${c.sections.length ? 'View or edit options' : 'Enter options manually'}</span>
                    </summary>
                    <div class="manual-options-content">
                      <textarea data-twin-edit="${studentIdx}:${c.id}" aria-label="Edit ${esc(c.code)} options" rows="5" placeholder="Faculty name | A11+A12 | AB1-102 | 70">${esc(c.sections.map((s) => [s.faculty, s.slots, s.venue, s.seats ?? ''].join(' | ')).join('\n'))}</textarea>
                      <div class="manual-options-footer">
                        <small class="field-hint">${c.scheduled ? 'Faculty | All weekly slots | Venue | Seats' : 'Faculty | NIL | NIL | Seats'}</small>
                        <button data-twin-save-edit="${studentIdx}:${c.id}" class="btn-sm">Save options</button>
                      </div>
                    </div>
                  </details>
                </div>
              `
              }
            </article>
          `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function twinPreferencesView() {
  const s1 = twinState.student1;
  const s2 = twinState.student2;

  const renderStudentPrefs = (student, idx) => `
    <article class="twin-student-card panel" style="flex: 1;">
      <div class="panel-header">
        <h2>${esc(student.name)}’s routine</h2>
        <span class="badge badge-neutral">${idx === 0 ? 'Student 1' : 'Student 2'}</span>
      </div>

      <div class="field-label" style="margin-bottom: 8px;">Class timing preset</div>
      <div class="timing-grid" style="grid-template-columns: 1fr 1fr;">
        ${[
          ['compact', 'No preference', 'Minimise gaps'],
          ['morning', 'Morning', 'Finish by 1:15 pm'],
          ['evening', 'Evening', 'Start after 1:15 pm'],
          ['balanced', 'Whole day', 'Spread classes'],
        ]
          .map(
            ([id, name, sub]) => `
          <button type="button" data-twin-preset="${idx}:${id}" class="timing-card choice ${student.preset === id ? 'is-selected selected' : ''}">
            <div class="timing-title">
              <b>${name}</b>
              ${student.preset === id ? '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3.5 8.5l3 3 6-7"/></svg>' : ''}
            </div>
            <small class="timing-desc">${sub}</small>
          </button>
        `
          )
          .join('')}
      </div>

      <div class="toggles-list">
        <label class="toggle-row toggle" for="twin-lunch-${idx}">
          <div class="toggle-info">
            <strong>Keep a lunch break</strong>
            <small class="toggle-desc">One midday slot stays free daily.</small>
          </div>
          <div class="switch">
            <input id="twin-lunch-${idx}" type="checkbox" ${student.settings.lunch ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </div>
        </label>

        <label class="toggle-row toggle" for="twin-bus-${idx}">
          <div class="toggle-info">
            <strong>Day scholar</strong>
            <small class="toggle-desc">Finish before bus departure.</small>
          </div>
          <div class="switch">
            <input id="twin-bus-${idx}" type="checkbox" ${student.settings.bus ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </div>
        </label>

        <label class="toggle-row toggle" for="twin-travel-${idx}">
          <div class="toggle-info">
            <strong>Less travel</strong>
            <small class="toggle-desc">Fewer consecutive AB2 switches.</small>
          </div>
          <div class="switch">
            <input id="twin-travel-${idx}" type="checkbox" ${student.settings.travel ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </div>
        </label>
      </div>

      <details class="bus-timing-panel" id="details-twin-bus-${idx}" ${student.settings.bus || openDetails.has(`twin-bus-${idx}`) ? 'open' : ''}>
        <summary class="manual-options-summary">Bus timing settings</summary>
        <div class="fields-grid" style="margin-top: 12px;">
          <div class="field">
            <label class="field-label" for="twin-busTime-${idx}">Bus departure</label>
            <input id="twin-busTime-${idx}" type="time" value="${esc(student.settings.busTime)}" required>
          </div>
          <div class="field">
            <label class="field-label" for="twin-walkMinutes-${idx}">Walk to bus (min)</label>
            <input id="twin-walkMinutes-${idx}" type="number" min="0" max="120" value="${student.settings.walkMinutes}">
          </div>
        </div>
      </details>
    </article>
  `;

  return `
    <div class="twin-students-grid">
      ${renderStudentPrefs(s1, 0)}
      ${renderStudentPrefs(s2, 1)}
    </div>
  `;
}

function twinResultsView() {
  const pair = twinResult?.results?.[twinResultIndex];
  if (busy) {
    return `
      <section class="panel empty state-panel" role="status">
        <div class="spinner" style="width: 36px; height: 36px; margin: 0 auto 16px;"></div>
        <h2>Coordinating paired timetables…</h2>
        <p id="generation-status" class="field-hint">Matching shared course sections and avoiding clashes…</p>
        <button id="cancel-generation" class="secondary-btn">Cancel</button>
      </section>
    `;
  }
  if (!twinResult) {
    return `
      <section class="panel empty state-panel">
        <h2>Ready to create paired timetables</h2>
        <p>Coordinate clash-free schedules with maximum classes together.</p>
        <button id="twin-regenerate" class="primary">Make our timetables</button>
      </section>
    `;
  }
  if (!pair) {
    return `
      <section class="panel state-panel">
        <div class="state-icon" style="color: var(--color-warning);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.75">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
        </div>
        <h2>No compatible pair found</h2>
        <p>${esc(twinResult.reason || 'No clash-free paired timetable meets all rules for both students.')}</p>
        <div class="state-actions">
          <button id="twin-retry-generation" class="primary">Try again</button>
          <button id="twin-review-faculty" class="secondary-btn">Review faculty lists</button>
          <button id="twin-review-settings" class="secondary-btn">Change preferences</button>
        </div>
      </section>
    `;
  }

  const name1 = twinState.student1.name || 'You';
  const name2 = twinState.student2.name || 'Friend';
  const summary = pair.matchSummary;
  const isOptimal = summary.isMaxPossible;

  return `
    ${twinResult.morningFallback1 ? `<div class="notice-box subtle-note" style="margin-bottom:12px">A morning-only timetable was not found for ${esc(name1)}. Alternatives include later classes.</div>` : ''}
    ${twinResult.morningFallback2 ? `<div class="notice-box subtle-note" style="margin-bottom:12px">A morning-only timetable was not found for ${esc(name2)}. Alternatives include later classes.</div>` : ''}
    ${
      twinResult.truncated
        ? `
      <div class="notice-box subtle-note" style="margin-bottom: 16px;">
        <svg class="notice-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
          <circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5h.01"/>
        </svg>
        <span>Best paired combinations found within search limit.</span>
      </div>
    `
        : ''
    }

    <!-- Paired Match Headline Banner -->
    <div class="twin-match-banner">
      <div class="twin-match-title-row">
        <div>
          <div class="twin-match-headline">
            ${isOptimal ? 'Together' : 'Best match found: Together'} in ${summary.together} of ${summary.commonScheduled} common courses
          </div>
          <p class="field-hint" style="margin: 4px 0 0;">
            ${summary.together === summary.commonScheduled ? '🎉 Complete match! You and your friend attend all common scheduled classes together.' : `${summary.sameTime} at the same time with different faculty · ${summary.differentTime} at different times.`}
          </p>
        </div>
        <div class="result-actions">
          <button id="export-twin-both" class="primary btn-sm">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6V2h8v4M4 12H2.5A1.5 1.5 0 011 10.5v-3A1.5 1.5 0 012.5 6h11A1.5 1.5 0 0115 7.5v3a1.5 1.5 0 01-1.5 1.5H12M4 9h8v5H4V9z"/></svg>
            <span>Download both (Combined PDF)</span>
          </button>
          <button id="export-twin-student1" class="secondary-btn btn-sm">
            <span>${esc(name1)}’s PDF</span>
          </button>
          <button id="export-twin-student2" class="secondary-btn btn-sm">
            <span>${esc(name2)}’s PDF</span>
          </button>
        </div>
      </div>

      <div class="twin-courses-status-grid">
        ${summary.courses
          .map((c) => {
            const isTogether = c.status === 'together';
            const isSameTime = c.status === 'same_time';
            const badgeClass = isTogether
              ? 'badge-success'
              : isSameTime
                ? 'badge-amber'
                : 'badge-neutral';
            const label = isTogether
              ? '✓ Together · Same class'
              : isSameTime
                ? '⏱ Same time · Diff faculty'
                : c.status === 'project'
                  ? 'Project (no weekly slots)'
                  : c.status === 'online'
                    ? 'Online'
                    : '≠ Different time';
            return `
            <div class="twin-course-status-card">
              <div class="twin-course-status-top">
                <strong>${esc(c.code)}</strong>
                <span class="badge ${badgeClass}">${label}</span>
              </div>
              <small class="course-name" style="color: var(--color-text-secondary);">${esc(c.name)}</small>
              ${c.reason && !isTogether ? `<span class="twin-course-status-reason">${esc(c.reason)}</span>` : ''}
            </div>
          `;
          })
          .join('')}
      </div>
    </div>

    <!-- Toolbar: Option Tabs -->
    <div class="result-toolbar result-tools" style="margin-top: 14px;">
      <div class="option-tabs tabs" role="tablist" aria-label="Paired timetable options">
        ${twinResult.results
          .map((p, i) => {
            const together = p.matchSummary.together;
            const total = p.matchSummary.commonScheduled;
            return `
            <button data-twin-result="${i}" class="tab-btn ${i === twinResultIndex ? 'is-selected selected' : ''}" role="tab" aria-selected="${i === twinResultIndex}">
              <span class="tab-label">Option ${i + 1}</span>
              <span class="tab-sub">${together}/${total} together · ${p.student1.metrics.gaps + p.student2.metrics.gaps} total gaps</span>
            </button>
          `;
          })
          .join('')}
      </div>
    </div>

    <!-- Mobile view toggle -->
    <div class="twin-mobile-view-tabs">
      <div class="mode-segmented-control" role="tablist">
        <button type="button" class="mode-tab ${twinActiveStudentTab === 0 ? 'is-active' : ''}" id="tab-student1">
          <span>${esc(name1)}</span>
        </button>
        <button type="button" class="mode-tab ${twinActiveStudentTab === 1 ? 'is-active' : ''}" id="tab-student2">
          <span>${esc(name2)}</span>
        </button>
      </div>
    </div>

    <!-- Timetables for both students -->
    <div class="twin-grids-container" style="display: flex; flex-direction: column; gap: 24px;">
      ${renderTimetableGrid(pair.student1, 0, name1, name2, pair.matchSummary)}
      ${renderTimetableGrid(pair.student2, 1, name2, name1, pair.matchSummary)}
    </div>
  `;
}

function renderTimetableGrid(schedule, studentIdx, studentName, partnerName, matchSummary) {
  const togetherCodes = new Set(
    (matchSummary?.courses || [])
      .filter((c) => c.status === 'together')
      .map((c) => c.code.toUpperCase())
  );

  const isHiddenMobile = twinActiveStudentTab !== studentIdx ? 'is-hidden-mobile' : '';

  return `
    <section class="twin-student-timetable-section ${isHiddenMobile}">
      <div class="twin-student-timetable-heading">
        <h3>${esc(studentName)}’s timetable</h3>
        <span class="subtle-note">${schedule.metrics.gaps} gap slots · ${schedule.metrics.travel} AB2 transitions</span>
      </div>

      <div class="panel timetable-wrapper timetable-panel" style="padding: 0; overflow: hidden;">
        <div class="table-scroll-container table-wrap">
          <table class="timetable-table">
            <thead>
              <tr>
                <th class="time-header-col">Time</th>
                ${DAYS.map((d) => `<th class="day-header">${d.slice(0, 3)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${TIMES.map(
                (t, p) => `
                <tr>
                  <th class="time-header-col">${t}</th>
                  ${DAYS.map((_, d) => {
                    const x = schedule.items.find((x) => x.day === d && x.period === p);
                    const isTogether = x && togetherCodes.has(x.course.toUpperCase());
                    const selected = x
                      ? schedule.chosen.find((v) => v.course.code === x.course)
                      : null;
                    const sameTime = selected?.alternatives || [];
                    const bothAlts = selected?.bothAlternatives || [];

                    return `
                      <td class="timetable-cell">
                        ${
                          x
                            ? `
                          <div class="event ${isTogether ? 'event-together' : ''}">
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
                              <b class="event-code">${esc(x.course)}</b>
                              ${isTogether ? `<span class="together-badge" title="Attending together with ${esc(partnerName)}">👥 Together</span>` : ''}
                            </div>
                            ${
                              sameTime.length > 1
                                ? `
                              <select class="event-faculty-select" data-twin-faculty-course="${studentIdx}:${esc(x.course)}" aria-label="Faculty for ${esc(x.course)} ${DAYS[d]}">
                                ${bothAlts.length > 1 ? `<optgroup label="Change for BOTH (keeps together)">${bothAlts.map((a) => `<option value="both:${esc(a.id)}" ${a.id === selected.section.id ? 'selected' : ''}>✓ Both: ${esc(a.faculty)} (${esc(a.venue)})</option>`).join('')}</optgroup>` : ''}
                                <optgroup label="Change for ${esc(studentName)} only">
                                  ${sameTime.map((a) => `<option value="single:${esc(a.id)}" ${a.id === selected.section.id && !bothAlts.some((b) => b.id === a.id) ? 'selected' : ''}>${esc(a.faculty)} (${esc(a.venue)})</option>`).join('')}
                                </optgroup>
                              </select>
                            `
                                : `<span class="event-faculty">${esc(x.faculty)}</span>`
                            }
                            <small class="event-venue">${esc(x.venue)}</small>
                          </div>
                        `
                            : `
                          <span class="free-slot free">—</span>
                        `
                        }
                      </td>
                    `;
                  }).join('')}
                </tr>
              `
              ).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function bind() {
  $('#watch-demo')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dialog = $('#demo-dialog');
    $('#demo-player').src = 'https://www.youtube-nocookie.com/embed/MFKUypP14OA?rel=0';
    dialog.showModal();
  });

  // Mode switcher tabs
  $('#mode-individual')?.addEventListener('click', () => switchMode('individual'));
  $('#mode-twin')?.addEventListener('click', () => switchMode('twin'));

  document.querySelectorAll('[data-step]').forEach((b) => {
    b.onclick = () => go(Number(b.dataset.step));
  });

  document.querySelectorAll('.credit-name-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const parent = btn.closest('.credit-author');
      const wasOpen = parent?.classList.contains('is-open');
      document.querySelectorAll('.credit-author').forEach((a) => a.classList.remove('is-open'));
      if (!wasOpen) parent?.classList.add('is-open');
    };
  });
  document.querySelectorAll('.credit-popover').forEach((pop) => {
    pop.onclick = (e) => e.stopPropagation();
  });
  document.onclick = () => {
    document.querySelectorAll('.credit-author').forEach((a) => a.classList.remove('is-open'));
  };

  const isTwin = appMode === 'twin';
  const currentStep = isTwin ? twinState.step : state.step;

  $('#back')?.addEventListener('click', () => go(currentStep - 1));

  $('#next')?.addEventListener('click', () => {
    if (isTwin) {
      if (twinState.step === 0) {
        if (!twinState.student1.courses.length || !twinState.student2.courses.length) {
          return toast('Please add at least one course for both students.');
        }
        const common = findCommonCourses(twinState.student1.courses, twinState.student2.courses);
        if (!common.length) {
          showNoCommonModal = true;
          render();
          return;
        }
      } else if (twinState.step === 1) {
        const missing = twinState.student1.courses.filter(needsFaculty);
        if (missing.length) {
          return toast(
            `Upload faculty options for ${missing.map((c) => c.code).join(', ')} for ${twinState.student1.name || 'Student 1'}.`
          );
        }
      } else if (twinState.step === 2) {
        const missing = twinState.student2.courses.filter(needsFaculty);
        if (missing.length) {
          return toast(
            `Upload faculty options for ${missing.map((c) => c.code).join(', ')} for ${twinState.student2.name || 'Student 2'}.`
          );
        }
      }
      twinState.step === 3 ? generateTwin() : go(twinState.step + 1);
    } else {
      if (state.step === 0) {
        const total = state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
        if (total > 27) {
          return toast(
            `Cannot proceed: Total credits (${total}) exceed 27. Please remove courses.`
          );
        }
      }
      if (state.step === 1) {
        for (const id of Object.keys(drafts)) {
          if (
            state.courses.some((c) => c.id === id && !c.online) &&
            !saveOptions(id, drafts[id].text, false)
          ) {
            return;
          }
        }
        const missing = state.courses.filter(needsFaculty);
        if (missing.length) {
          return toast('Upload faculty options for ' + missing.map((c) => c.code).join(', ') + '.');
        }
      }
      state.step === 2 ? generate() : go(state.step + 1);
    }
  });

  // Individual Mode Handlers
  $('#year')?.addEventListener('change', (e) => {
    state.year = e.target.value;
    state.branch = '';
    state.courses = [];
    invalidate();
    render();
  });

  $('#branch')?.addEventListener('change', (e) => {
    state.branch = e.target.value;
    loadCourses(state);
    render();
  });

  document.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => {
      state.courses = state.courses.filter((c) => c.id !== b.dataset.remove);
      invalidate();
      render();
    };
  });

  $('#add-course')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const code = String(data.get('code')).trim().toUpperCase();
    const name = String(data.get('name')).trim();
    const credits = Number(data.get('credits'));
    const isProject = data.get('project') === 'on';

    if (!code || !name) return toast('Please enter both course code and name.');
    if (state.courses.some((c) => c.code === code))
      return toast('Course ' + code + ' is already in your list.');

    const currentCredits = state.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
    if (currentCredits + credits > 27)
      return toast(`Exceeds 27 credits limit (Current: ${currentCredits} / 27).`);

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
      only: '',
    });
    invalidate();
    render();
    toast('Course added: ' + code);
  });

  // Twin Mode Handlers
  $('#twin-name-0')?.addEventListener('input', (e) => {
    twinState.student1.name = e.target.value;
    persist();
  });
  $('#twin-name-1')?.addEventListener('input', (e) => {
    twinState.student2.name = e.target.value;
    persist();
  });

  $('#twin-year-0')?.addEventListener('change', (e) => {
    twinState.student1.year = e.target.value;
    twinState.student1.branch = '';
    twinState.student1.courses = [];
    invalidate();
    render();
  });
  $('#twin-year-1')?.addEventListener('change', (e) => {
    twinState.student2.year = e.target.value;
    twinState.student2.branch = '';
    twinState.student2.courses = [];
    invalidate();
    render();
  });

  $('#twin-branch-0')?.addEventListener('change', (e) => {
    twinState.student1.branch = e.target.value;
    loadCourses(twinState.student1);
    render();
  });
  $('#twin-branch-1')?.addEventListener('change', (e) => {
    twinState.student2.branch = e.target.value;
    loadCourses(twinState.student2);
    render();
  });

  document.querySelectorAll('[data-twin-remove]').forEach((b) => {
    b.onclick = () => {
      const [idxStr, id] = b.dataset.twinRemove.split(':');
      const idx = Number(idxStr);
      const student = idx === 0 ? twinState.student1 : twinState.student2;
      student.courses = student.courses.filter((c) => c.id !== id);
      invalidate();
      render();
    };
  });

  $('#twin-add-course-0')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAddTwinCourse(0, e.target);
  });
  $('#twin-add-course-1')?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAddTwinCourse(1, e.target);
  });

  function handleAddTwinCourse(studentIdx, form) {
    const student = studentIdx === 0 ? twinState.student1 : twinState.student2;
    const data = new FormData(form);
    const code = String(data.get('code')).trim().toUpperCase();
    const name = String(data.get('name')).trim();
    const credits = Number(data.get('credits'));
    const isProject = data.get('project') === 'on';

    if (!code || !name) return toast('Please enter both course code and title.');
    if (student.courses.some((c) => c.code === code))
      return toast(`${code} is already in ${student.name}’s list.`);

    const currentCredits = student.courses.reduce((n, c) => n + Number(c.credits || 0), 0);
    if (currentCredits + credits > 27)
      return toast(`Exceeds 27 credits limit (Current: ${currentCredits} / 27).`);

    student.courses.push({
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
      only: '',
    });
    invalidate();
    render();
    toast(`Course added for ${student.name}: ${code}`);
  }

  // No common modal buttons
  $('#close-no-common-modal')?.addEventListener('click', () => {
    showNoCommonModal = false;
    render();
  });
  $('#switch-to-individual-modal')?.addEventListener('click', () => {
    showNoCommonModal = false;
    switchMode('individual');
  });

  // Twin Upload Handlers
  document.querySelectorAll('[data-twin-upload]').forEach((el) => {
    el.onchange = () => {
      const [idxStr, id] = el.dataset.twinUpload.split(':');
      readTwinUpload(Number(idxStr), id, el.files[0]);
    };
  });

  document.querySelectorAll('[data-twin-dropzone]').forEach((zone) => {
    const [idxStr, id] = zone.dataset.twinDropzone.split(':');
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) readTwinUpload(Number(idxStr), id, file);
    });
  });

  document.querySelectorAll('[data-twin-online]').forEach((el) => {
    el.onchange = () => {
      const [idxStr, id] = el.dataset.twinOnline.split(':');
      const student = Number(idxStr) === 0 ? twinState.student1 : twinState.student2;
      const c = student.courses.find((x) => x.id === id);
      if (c) {
        c.online = el.checked;
        invalidate();
        render();
      }
    };
  });

  document.querySelectorAll('[data-twin-preferred]').forEach((el) => {
    el.onchange = () => {
      const [idxStr, id] = el.dataset.twinPreferred.split(':');
      const student = Number(idxStr) === 0 ? twinState.student1 : twinState.student2;
      const c = student.courses.find((x) => x.id === id);
      if (c) {
        c.preferred = el.value
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        invalidate();
      }
    };
  });

  document.querySelectorAll('[data-twin-avoid]').forEach((el) => {
    el.onchange = () => {
      const [idxStr, id] = el.dataset.twinAvoid.split(':');
      const student = Number(idxStr) === 0 ? twinState.student1 : twinState.student2;
      const c = student.courses.find((x) => x.id === id);
      if (c) {
        c.avoid = el.value
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        invalidate();
      }
    };
  });

  document.querySelectorAll('[data-twin-save-edit]').forEach((btn) => {
    btn.onclick = () => {
      const [idxStr, id] = btn.dataset.twinSaveEdit.split(':');
      const textarea = $(`[data-twin-edit="${idxStr}:${id}"]`);
      if (textarea) saveTwinOptions(Number(idxStr), id, textarea.value);
    };
  });

  document.querySelectorAll('[data-twin-save-draft]').forEach((btn) => {
    btn.onclick = () => {
      const [idxStr, id] = btn.dataset.twinSaveDraft.split(':');
      const textarea = $(`[data-twin-draft="${idxStr}:${id}"]`);
      if (textarea) saveTwinOptions(Number(idxStr), id, textarea.value, true);
    };
  });

  // Twin Preferences Presets
  document.querySelectorAll('[data-twin-preset]').forEach((btn) => {
    btn.onclick = () => {
      const [idxStr, preset] = btn.dataset.twinPreset.split(':');
      const student = Number(idxStr) === 0 ? twinState.student1 : twinState.student2;
      student.preset = preset;
      invalidate();
      render();
    };
  });

  // Twin Setting Toggles
  ['lunch', 'bus', 'travel'].forEach((key) => {
    [0, 1].forEach((idx) => {
      const el = $(`#twin-${key}-${idx}`);
      if (el) {
        el.onchange = () => {
          const student = idx === 0 ? twinState.student1 : twinState.student2;
          student.settings[key] = el.checked;
          invalidate();
          render();
        };
      }
    });
  });

  [0, 1].forEach((idx) => {
    const student = idx === 0 ? twinState.student1 : twinState.student2;
    $(`#twin-busTime-${idx}`)?.addEventListener('change', (e) => {
      student.settings.busTime = e.target.value;
      invalidate();
    });
    $(`#twin-walkMinutes-${idx}`)?.addEventListener('change', (e) => {
      student.settings.walkMinutes = Number(e.target.value) || 0;
      invalidate();
    });
  });

  // Twin Results Toolbar & Actions
  document.querySelectorAll('[data-twin-result]').forEach((btn) => {
    btn.onclick = () => {
      twinResultIndex = Number(btn.dataset.twinResult);
      render();
    };
  });

  $('#tab-student1')?.addEventListener('click', () => {
    twinActiveStudentTab = 0;
    render();
  });
  $('#tab-student2')?.addEventListener('click', () => {
    twinActiveStudentTab = 1;
    render();
  });

  // Twin In-Cell Faculty Dropdown
  document.querySelectorAll('[data-twin-faculty-course]').forEach((select) => {
    select.onchange = () => {
      const [idxStr, courseCode] = select.dataset.twinFacultyCourse.split(':');
      const val = select.value;
      const isBoth = val.startsWith('both:');
      const sectionId = val.replace(/^(both|single):/, '');
      const studentIdx = Number(idxStr);
      try {
        twinResult.results[twinResultIndex] = changeTwinFaculty(
          twinResult.results[twinResultIndex],
          studentIdx,
          courseCode,
          sectionId,
          isBoth,
          twinState.student1.settings,
          twinState.student2.settings,
          twinState.student1.preset,
          twinState.student2.preset
        );
        render();
        toast(
          isBoth ? 'Faculty changed for both students.' : 'Faculty changed for this timetable.'
        );
      } catch (err) {
        toast(err.message || 'Could not change faculty.');
      }
    };
  });

  // Twin Exports
  $('#export-twin-both')?.addEventListener('click', () => exportTwinPdf('both'));
  $('#export-twin-student1')?.addEventListener('click', () => exportTwinPdf('student1'));
  $('#export-twin-student2')?.addEventListener('click', () => exportTwinPdf('student2'));

  $('#twin-regenerate')?.addEventListener('click', generateTwin);
  $('#twin-retry-generation')?.addEventListener('click', generateTwin);
  $('#twin-review-faculty')?.addEventListener('click', () => go(1));
  $('#twin-review-settings')?.addEventListener('click', () => go(3));

  // Individual Upload Handlers
  document.querySelectorAll('[data-online]').forEach((el) => {
    el.onchange = () => {
      const c = state.courses.find((c) => c.id === el.dataset.online);
      if (c) {
        c.online = el.checked;
        invalidate();
        render();
      }
    };
  });

  document.querySelectorAll('[data-upload]').forEach((el) => {
    el.onchange = () => readUpload(el.dataset.upload, el.files[0]);
  });

  document.querySelectorAll('[data-dropzone]').forEach((zone) => {
    const id = zone.dataset.dropzone;
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) readUpload(id, file);
    });
  });

  for (const key of ['preferred', 'avoid']) {
    document.querySelectorAll(`[data-${key}]`).forEach((el) => {
      el.onchange = () => {
        const c = state.courses.find((c) => c.id === el.dataset[key]);
        if (c) {
          c[key] = el.value
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          invalidate();
        }
      };
    });
  }

  document.querySelectorAll('[data-save-edit]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.saveEdit;
      const textarea = $(`[data-edit="${id}"]`);
      if (textarea) saveOptions(id, textarea.value);
    };
  });

  document.querySelectorAll('[data-save-draft]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.saveDraft;
      const textarea = $(`[data-draft="${id}"]`);
      if (textarea) saveOptions(id, textarea.value, true);
    };
  });

  // Individual Presets & Results
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.onclick = () => {
      state.preset = btn.dataset.preset;
      invalidate();
      render();
    };
  });

  ['lunch', 'bus', 'travel'].forEach((key) => {
    const el = $(`#${key}`);
    if (el) {
      el.onchange = () => {
        state.settings[key] = el.checked;
        invalidate();
        render();
      };
    }
  });

  $('#busTime')?.addEventListener('change', (e) => {
    state.settings.busTime = e.target.value;
    invalidate();
  });
  $('#walkMinutes')?.addEventListener('change', (e) => {
    state.settings.walkMinutes = Number(e.target.value) || 0;
    invalidate();
  });

  document.querySelectorAll('[data-result]').forEach((btn) => {
    btn.onclick = () => {
      resultIndex = Number(btn.dataset.result);
      render();
    };
  });

  document.querySelectorAll('[data-faculty-course]').forEach((select) => {
    select.onchange = () => {
      const courseCode = select.dataset.facultyCourse;
      const sectionId = select.value;
      try {
        result.results[resultIndex] = changeFaculty(
          result.results[resultIndex],
          courseCode,
          sectionId,
          state.settings,
          state.preset
        );
        render();
      } catch (err) {
        toast(err.message || 'Could not change faculty.');
      }
    };
  });

  $('#print')?.addEventListener('click', downloadPdf);
  $('#browser-print')?.addEventListener('click', () => window.print());
  $('#cancel-generation')?.addEventListener('click', () => {
    worker?.terminate();
    job++;
    busy = false;
    render();
  });
  $('#regenerate')?.addEventListener('click', generate);
  $('#retry-generation')?.addEventListener('click', generate);
  $('#review-faculty')?.addEventListener('click', () => go(1));
  $('#review-settings')?.addEventListener('click', () => go(2));
}

async function exportTwinPdf(which) {
  const pair = twinResult?.results?.[twinResultIndex];
  if (!pair) return;
  try {
    await downloadTwinTimetablePdf(pair, {
      option: twinResultIndex + 1,
      which,
      courses1: twinState.student1.courses,
      courses2: twinState.student2.courses,
    });
  } catch (error) {
    toast(error.message || 'Could not export paired PDF.');
  }
}

async function pdfText(file) {
  const pdf = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdf.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const doc = await pdf.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i),
      content = await page.getTextContent();
    text += pdfItemsToText(content.items);
  }
  return text;
}

async function readUpload(id, file) {
  if (!file) return;
  const c = state.courses.find((c) => c.id === id);
  if (!c) return;
  uploading.add(id);
  delete c.uploadError;
  render();
  try {
    await validatePdfUpload(file);
    const text = await pdfText(file),
      parsed = parsePortalText(text);
    if (parsed.code !== c.code)
      throw Error('This PDF is for ' + parsed.code + '. Upload it under that course.');
    const rows = (parsed.sections || []).map((s) => ({ ...s, id: uid() }));
    const reviewText = rows.length
      ? rows.map((s) => [s.faculty, s.slots, s.venue, s.seats ?? ''].join(' | ')).join('\n')
      : text;
    try {
      c.sections = mergeSections(c, rows);
      c.lastUpload = file.name;
      delete drafts[id];
      delete c.uploadError;
      invalidate();
      toast(`${c.code}: ${c.sections.length} options saved.`);
    } catch (validation) {
      drafts[id] = {
        text: reviewText,
        message: 'Please correct these rows before continuing: ' + validation.message,
      };
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

async function readTwinUpload(studentIdx, id, file) {
  if (!file) return;
  const student = studentIdx === 0 ? twinState.student1 : twinState.student2;
  const c = student.courses.find((c) => c.id === id);
  if (!c) return;
  const key = `${studentIdx}:${id}`;
  uploading.add(key);
  delete c.uploadError;
  render();
  try {
    await validatePdfUpload(file);
    const text = await pdfText(file),
      parsed = parsePortalText(text);
    if (parsed.code !== c.code)
      throw Error(
        `This PDF is for ${parsed.code}. Upload it under that course for ${student.name}.`
      );
    const rows = (parsed.sections || []).map((s) => ({ ...s, id: uid() }));
    const reviewText = rows.length
      ? rows.map((s) => [s.faculty, s.slots, s.venue, s.seats ?? ''].join(' | ')).join('\n')
      : text;
    try {
      c.sections = mergeSections(c, rows);
      c.lastUpload = file.name;
      delete twinDrafts[studentIdx][id];
      delete c.uploadError;
      invalidate();
      toast(`${c.code} for ${student.name}: ${c.sections.length} options saved.`);
    } catch (validation) {
      twinDrafts[studentIdx][id] = {
        text: reviewText,
        message: 'Please correct these rows before continuing: ' + validation.message,
      };
      persist();
    }
  } catch (e) {
    c.uploadError = e.message;
    toast(e.message);
  } finally {
    uploading.delete(key);
    render();
  }
}

function saveOptions(id, text, isDraft = false) {
  const c = state.courses.find((c) => c.id === id);
  if (!c) return false;
  try {
    const rows = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [faculty, slots, venue, seats] = line.split('|').map((s) => s.trim());
        return { id: uid(), faculty, slots, venue, seats };
      });
    c.sections = mergeSections(c, rows);
    delete drafts[id];
    delete c.uploadError;
    invalidate();
    render();
    toast(`${c.code}: options saved.`);
    return true;
  } catch (err) {
    toast('Error saving options: ' + err.message);
    return false;
  }
}

function saveTwinOptions(studentIdx, id, text, isDraft = false) {
  const student = studentIdx === 0 ? twinState.student1 : twinState.student2;
  const c = student.courses.find((c) => c.id === id);
  if (!c) return false;
  try {
    const rows = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [faculty, slots, venue, seats] = line.split('|').map((s) => s.trim());
        return { id: uid(), faculty, slots, venue, seats };
      });
    c.sections = mergeSections(c, rows);
    delete twinDrafts[studentIdx][id];
    delete c.uploadError;
    invalidate();
    render();
    toast(`${c.code} for ${student.name}: options saved.`);
    return true;
  } catch (err) {
    toast('Error saving options: ' + err.message);
    return false;
  }
}

async function downloadPdf() {
  const schedule = result?.results?.[resultIndex];
  if (!schedule) return;
  const button = $('#print');
  if (button) {
    button.disabled = true;
    button.textContent = 'Preparing PDF…';
  }
  try {
    await downloadTimetablePdf(schedule, { option: resultIndex + 1, courses: state.courses });
  } catch (error) {
    toast(error.message || 'Could not export PDF. Please try again.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Download PDF';
    }
  }
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
  worker = startGeneration(
    { id, courses: state.courses, settings: state.settings, preset: state.preset, limit: 5 },
    {
      onProgress: (progress) => {
        if (id !== job) return;
        const message = $('#generation-status');
        if (message)
          message.textContent = progress.found
            ? 'Shortlisting a few useful timetables…'
            : 'Checking your course slots…';
      },
      onResult: (data) => {
        if (id !== job) return;
        result = data;
        busy = false;
        render();
      },
    }
  );
}

function generateTwin() {
  worker?.terminate();
  twinState.step = 4;
  busy = true;
  twinResult = null;
  twinResultIndex = 0;
  persist();
  const id = ++job;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });

  const payload = {
    id,
    mode: 'twin',
    students: [
      {
        name: twinState.student1.name || 'You',
        courses: twinState.student1.courses,
        settings: twinState.student1.settings,
        preset: twinState.student1.preset,
      },
      {
        name: twinState.student2.name || 'Friend',
        courses: twinState.student2.courses,
        settings: twinState.student2.settings,
        preset: twinState.student2.preset,
      },
    ],
    limit: 5,
  };

  worker = startGeneration(payload, {
    onProgress: (progress) => {
      if (id !== job) return;
      const message = $('#generation-status');
      if (message)
        message.textContent = progress.found
          ? `Found ${progress.found} paired combinations…`
          : 'Coordinating class timings between both students…';
    },
    onResult: (data) => {
      if (id !== job) return;
      twinResult = data;
      busy = false;
      render();
    },
  });
}

render();

// Keep the player outside step renders; closing unloads it and stops playback.
const demoDialog = $('#demo-dialog');
$('#close-demo').onclick = () => demoDialog.close();
demoDialog.addEventListener('click', (e) => {
  if (e.target === demoDialog) {
    const r = demoDialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      demoDialog.close();
  }
});
demoDialog.addEventListener('close', () => {
  $('#demo-player').removeAttribute('src');
  $('#watch-demo')?.focus();
});
