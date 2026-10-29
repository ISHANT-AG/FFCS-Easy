# FFCS easy

A simple, free timetable planner. Choose year → branch → courses → upload your faculty options → preferences → timetable.

## Run

In this folder, run `python3 -m http.server 5173 --bind 127.0.0.1`, then open http://127.0.0.1:5173. No install, account or paid API required. Run tests with Node 18+: `node --test tests/*.test.js`.

## Student flow

- Year means current study year for Fall 2026–27: second year maps to admission batch 2025, third to 2024, fourth to 2023. The supplied catalogue supports only those available programmes. Unsupported years show an empty state.
- Branch selection loads the college-provided courses. Students can add or remove courses.
- Faculty sections always start empty. Each student uploads their own PDF for each course. Recognised, valid rows save automatically and show the filename with a saved status. Invalid/unreadable rows remain editable for correction. Manual entry/editing is inside a collapsed section. No shared/mock dataset is loaded into a student's plan.
- Preferred and avoided faculty are optional comma-separated names; matching ignores casing and repeated spaces. Preferences are soft; avoid is a hard exclusion. Existing strict faculty support remains in the engine.
- Timing options: no preference/minimal gaps, morning (try to finish by 13:15), evening (all meetings start at or after 13:15 and end by 19:30), or whole day (spread through the day).
- Lunch keeps either 11:40–13:10 or 13:15–14:45 free daily; switch off to allow skipping lunch.
- Day scholar ends classes before bus departure minus walking time (default departure 16:20, walk 10 minutes). Bus timing is inside a collapsed section.
- Less travel softly penalises consecutive AB2/AB02 ↔ nearby building transitions. AB1, Lab Complex and other venues currently form the nearby group.
- Each course has an Online checkbox. Online courses stay in the course list/credit total but need no faculty upload and are excluded entirely from timetable scheduling. Existing options are retained if Online is switched off.
- Up to four timetable alternatives, with printing/PDF through the browser. No overlapping meetings. NIL project faculty appear on the shortlist without adding meetings.

## Data and processing

`data/catalogue.json` is the college course list. Historical screenshot/PDF datasets remain in `data/` as development fixtures; the student interface never fetches or prefills them. Files are processed in the browser. PDF reading downloads PDF.js 4.10.38 on demand. That download needs internet and uses no paid API. Image/JSON uploads are unsupported; the runtime validates PDF headers. Fonts have system fallbacks. There is no backend upload endpoint.

The simple UI uses a new localStorage key (`ffcs-simple-v2`) so previous shared/demo sections cannot prefill personal faculty lists. The old key is preserved unchanged. Course and preference edits autosave locally. Unfinished correction drafts are saved locally and valid drafts are committed when continuing.

Each weekly section must contain its complete slot bundle. Independently chosen theory/labs must be entered as valid combined options; automatic linking isn't implemented. Future PDFs and OCR layouts can require manual corrections. Source-session clash/registered labels are ignored. Seat counts are snapshots; verify current seats in FFCS. Eligibility and prerequisites remain the student's responsibility.

The solver uses bounded search (250,000 nodes), retains four best-scoring choices and labels truncated searches. Whole-day spreading is a ranking heuristic. Project-only courses without faculty data can remain in the plan without meetings.

## Source

- `src/app.js`: simple workflow, uploads, review and local persistence.
- `src/engine.js`, `src/worker.js`: rules, scoring and background scheduling.
- `src/portal.js`: portal PDF parsing; legacy screenshot parser is retained only for existing development fixtures.
- `tests/`: scheduling rules and sanitised data/import fixtures.

Upload merges are atomic: invalid data does not partly save. Reuploading an existing faculty/slot/venue combination refreshes its seat count without duplication. Browser verification used the actual CPP and Swachh Bharat PDFs: each saved all 14 sections automatically and survived refresh.

Image/OCR work stopped at the user’s request. Uploads accept PDF files only, with runtime extension/header validation; previously saved course data is preserved.

## Distinct timetables and same-time faculty switching

The solver groups equivalent faculty options by canonical full slot bundle and building group, searches timing/zone combinations, and deduplicates resulting schedules by course-to-slot assignments. The UI requests up to 24 distinct timing combinations; fewer appear when fewer are found. Candidate selection modestly favours differences in course/slot assignments among similarly ranked schedules. Search remains bounded and truncation is disclosed.

Every chosen course retains all eligible same-bundle faculty alternatives, including options in another building group. The results screen exposes a timetable selector and per-course faculty dropdowns. Switching faculty updates meeting labels/venues, shortlist, score and travel metrics without moving any class times. Avoided faculty, strict choices, zero seats and different bundles cannot be selected. NIL project choices do not create additional timing alternatives. Changes affect only the selected result and do not overwrite the student's uploaded options or preferences. Current results/overrides remain session-only, as before.

Browser verification used a separate localhost origin to preserve the existing 127.0.0.1 plan. The actual CPP PDF produced 9 timing combinations from 14 sections. RAM KUMAR → ANKUR JAIN at A14+D11+D12 updated faculty/venue while preserving all grid positions. Unit coverage additionally checks 24 multi-course permutations, filtering and cross-building travel recalculation.

## Short shortlist and in-cell faculty changes

The UI and worker now request/enforce at most five shortlisted distinct schedules. Same-slot faculty controls live inside timetable class cells rather than in a separate alternatives panel. Changing one meeting's faculty updates all meetings of that course, the venue and travel metrics while retaining times. Dropdowns are omitted for single-choice cells; print output replaces controls with the selected faculty text. NIL/project selections remain visible in the collapsed selected-faculty summary because they have no timetable cell.

`EVS_CHY1006_Faculty.pdf` was prepared from the two latest supplied EVS screenshots as a user-facing output. It has 22 text-readable sections, snapshot seat counts and the original session's clash labels. Import ignores those source clash labels. Both direct PDF extraction and the portal importer were checked against the transcribed 22-row fixture.

## Generation responsiveness

The search now prepares slot masks, meeting items and faculty preference costs once per representative section. Leaf candidates remain lightweight; full same-time faculty alternatives are attached only to the final shortlist. Overlap/lunch checks use the fixed 42-slot grid as bit masks. The existing rules, scoring and distinct-layout grouping remain unchanged.

Search stops at 250,000 nodes or approximately 3 seconds, whichever comes first, returning the best shortlist found and reporting truncation. An unfinished search with no result is explicitly distinguished from a completed infeasibility search. Progress messages do not complete the job. `src/generation.js` handles cancellation, stale responses, worker/startup errors and a 10-second safety timeout; all terminal paths leave loading and offer a retry without clearing uploads. Back/Cancel stops the current worker.

A local ten-course benchmark fell from about 72 seconds to under 1 second. A separate browser session with the full course list and all seven weekly-course PDFs displayed four results in approximately 0.5 seconds. These are measured sample timings, not a guarantee for every plan/device. Lifecycle, timeout, full-plan and all-six-day lunch-mask regressions are covered by tests.

## PDF export and strict exclusions

The default shortlist and worker cap are now five distinct timetables (fewer when fewer valid arrangements exist). Avoid faculty is a hard exclusion in search, same-time alternatives, faculty switching and export eligibility checks. It accepts case/spacing/punctuation differences and standalone name-part queries: `sanat` excludes SANAT JAIN; `ram` does not match GARIMA. Multiple names can be separated by commas, semicolons or newlines. It does not use fuzzy typo matching.

A section with zero available seats, whether numeric 0, string `0`, or padded zero, is excluded per faculty/slot section. Another open section of the same faculty remains eligible. Blank seats remain unknown rather than zero. Neither avoided faculty nor full sections are used as fallbacks when constraints leave no valid timetable. Reuploads refresh matching section counts and invalidate old results.

Download PDF now draws the selected timetable directly into a landscape A4 PDF using client-side jsPDF 2.5.2 (downloaded from jsDelivr on first export). No timetable data is sent to a server. The export is independent of browser viewport/scroll position, includes all six weekday columns and full wrapped faculty names/venues, and checks that chosen sections remain eligible before exporting. Standard Ctrl+P styles also remove minimum widths and scroll clipping.

The actual browser download was verified as one landscape page with all weekdays. Browser regression checked all five options and their dropdown content after avoiding SARATHKUMAR and setting KANNAN S's only section to zero seats; neither appeared. The downloaded PDF also excluded both. These checks used a separate localhost test origin; the student's 127.0.0.1 plan was left untouched.

## Detailed regression audit — 29 October 2026

Final run: 73 tests passed, including 600 randomized scenarios checked against an independent exhaustive reference and 32 full-semester preference combinations. Browser audit: 44 passing assertions on an isolated localhost origin. Responsive layout checked at 390/768/1440px and a real landscape PDF download rendered and inspected.

Reupload identity canonicalizes faculty, slot ordering and venue aliases so a new zero-seat count cannot leave an old eligible duplicate. Repeated NIL project entries preserve their occurrence and separate seat counts; reuploading the same list stays idempotent. Optional project readiness matches Continue validation. Wrapped PDF rows are supported and recognized partial lists fail atomically. Export rejects stale removed/edited sections.
