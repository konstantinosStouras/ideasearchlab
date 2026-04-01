# CLAUDE.md -- Project Notes for AI Assistant
Paste the contents of this file at the start of any new Claude conversation
to give Claude full context about this project instantly.
---
## Project Notes: Ideation Challenge App
**What it is:** A research app for structured group ideation sessions with individual and group phases, optional AI assistance, and post-session surveys. Built for Kostas Stouras (researcher/instructor at ideasearchlab).
**Live URL:** https://www.stouras.com/lab/ideasearchlab/
**Source code repo:** github.com/konstantinosStouras/ideasearchlab
**Main site repo:** github.com/konstantinosStouras/konstantinosStouras.github.io
**Local source code path:** C:\Users\User\Documents\GitHub\ideasearchlab
**Deployment:** GitHub Actions workflow builds the React app and pushes dist/ into konstantinosStouras.github.io/lab/ideasearchlab/. Triggered automatically on every push to main. The workflow does git pull --rebase before copying files to avoid push rejection.
**Firebase project:** ideasearchlab (region: europe-west1)
**Firebase services used:** Firestore, Authentication (Email/Password), Cloud Functions (Node 20, europe-west1)
**Frontend:** React + Vite, React Router with basename="/lab/ideasearchlab"
**Cloud Functions (all in europe-west1):**
- joinSession: registers participant, immediately forms a group if enough people are waiting, starts their first phase. Passes joiningUid to tryFormGroup to avoid Firestore read-after-write race condition.
- advancePhase: instructor-controlled override for voting -> survey -> done (individual/group transitions are automatic)
- autoGroupParticipants: Firestore trigger - when all members of a group complete individual phase, moves them to group phase. Session auto-advance check accounts for all group members being moved in the batch (not just the triggering participant), fixing a bug where session status stayed on "individual" even after all participants moved to group.
- handleStragglers: callable - forms undersized groups or sends solo participants to survey for lobby stragglers
- sendAIMessage: calls LLM, stores response
- saveAISettings: saves global AI provider settings
- submitVote: records votes, tallies top ideas, auto-advances session to survey when all have voted
- onParticipantUpdated: Firestore trigger - when a participant's status becomes 'done', checks if all participants are done and advances session status to 'done'
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page.
**Session flow:** waiting -> individual -> group -> voting -> survey -> done (order and active phases configurable per session)

## Participant onboarding flow (new)
The participant join flow now has four steps before reaching the session lobby:
1. **JoinSession** (`src/pages/JoinSession.jsx`): Enter session code. Validates code client-side via Firestore query. If participant is new, navigates to Welcome. If already registered (rejoining), skips directly to SessionLobby.
2. **Welcome** (`src/pages/Welcome.jsx` + `Welcome.module.css`): NEW page. Displays study overview with dynamic phase descriptions based on session's `phaseConfig`. Adapts text for individual-first, group-first, individual-only, or group-only configurations. Amazon Voucher paragraph only shown when group phase is active. "I agree and continue" button navigates to Registration.
3. **Registration** (`src/pages/Registration.jsx` + `Registration.module.css`): NEW page. Collects demographics (Age, Gender, Nationality, Country, Level of Study, Work Experience, Occupation, English Fluency) plus two consent checkboxes. Nationality and Country use dropdown menus with full 195-country list. Work Experience is a number input validated 0-50. On submit, calls `joinSession` Cloud Function, then writes demographics to participant doc via `updateDoc`. Data stored as `demographics` object + `consentGiven` + `consentTimestamp` on participant document.
4. **SessionLobby**: Existing page, unchanged.

Routes added to `App.jsx`: `/session/:sessionId/welcome` and `/session/:sessionId/register`, both wrapped in SessionWrapper.

## Idea data model (updated)
Ideas now have structured fields instead of just `text`:
```
ideas/{ideaId}: {
  title: string,          // idea title (bold display)
  description: string,    // description (smaller text below)
  text: string,           // combined "title: description" for backward compatibility
  authorId, authorName, phase, groupId, votes, createdAt,
  selected: boolean       // true if user chose this as a top idea for group phase
}
```

## IndividualPhase.jsx (major update)
- **Two-view structure**: Instructions view (shown first with "Start" button), then workspace view.
- **Instructions page**: Full-page card with study instructions, dynamic duration from `individualPhaseDuration`, task checklist, group-phase warning (conditional).
- **Collapsible Task Brief**: Shown in workspace, contains the sleep wellness product design prompt, example product with image (`public/images/sleep-mask-example.png`), evaluation criteria (Novelty, Feasibility, Financial Value, Overall Quality), AI note (conditional), and selection instructions.
- **Structured idea submission**: Two fields, "Idea title" and "Description", rendered in pill-shaped cards (border-radius: 20px) with bold title, gradient separator line, and smaller description text.
- **Inline editing**: Pencil icon appears on hover, click enters edit mode with editable fields + Save/Cancel.
- **Delete**: Trash bin icon appears on hover (red on hover), calls `deleteDoc`. Requires Firestore rule: `allow delete: if request.auth.uid == resource.data.authorId;`
- **Double-click selection**: Double-click toggles idea selection for group carry-over. Selected cards get accent border, glow, and "Selected" badge. Selection bar shows count ("Selected ideas: 2 / 3"). Maximum controlled by `ideasCarriedToGroup`.
- **Finish & Submit**: Disabled until at least one idea is selected. Does participant `updateDoc` first (critical), then idea selection batch separately (non-critical, fails gracefully if Firestore rules missing).
- **Static image**: Example sleep mask image at `public/images/sleep-mask-example.png`. The `<img>` tag hides itself via `onError` if file not found.

## GroupPhase.jsx (updated)
- **Consistent pill card design**: Same oval pill cards as IndividualPhase with title/separator/description pattern.
- **Title + description submission**: Group idea form now has two fields ("Idea title" and "Description") instead of single textarea. Writes `title`, `description`, and `text` to Firestore.
- **Individual ideas filter with fallback**: Prefers ideas with `selected: true`. Falls back to latest N by `createdAt` if no selected ideas found (handles case where selection batch failed due to Firestore rules).
- **Voting navigation fix**: Status listener now handles `voting` status (was missing, caused participants to get stuck on group phase when instructor advanced to voting).
- **IdeaPill component**: Shared render function for individual and group idea cards with author label, you-tag, title, divider, description.

## Survey (redesigned)
- **surveyQuestions.js** (`src/data/surveyQuestions.js`): Completely rewritten with 12 questions across 4 sections:
  - "Your Experience" (Q1-Q4): difficulty, satisfaction, idea rating group, collaboration comfort
  - "Creativity and Idea Generation" (Q5): supporting others' ideas
  - "Reflection" (Q6-Q7): two freetext questions
  - "Questions about sleep wellness" (Q8-Q12): importance, activities, product purchases, interest, prior experience
- **New question types**: `likert5` (1-5 scale with custom anchors), `rating_group` (sub-items each rated 1-5), `radio` (pill buttons with optional conditional follow-up), `freetext`
- **Exports**: `SURVEY_TITLE`, `SURVEY_SUBTITLE`, `SURVEY_QUESTIONS`
- **Survey.jsx**: Questions grouped into section cards. Connected-dot scale for likert5 (dots on a track line). Table grid for rating_group with alternating row shading. Pill-shaped radio buttons. Conditional follow-up field (Q10). Proper validation for all types including nested groups and conditional follow-ups.
- **Survey.module.css**: Section cards with shaded headers, responsive layout.

## Firestore security rules (needs update)
Ideas subcollection needs these rules added for edit/delete/selection to work:
```
allow update: if request.auth.uid == resource.data.authorId;
allow delete: if request.auth.uid == resource.data.authorId;
```
Without these, edit/delete buttons and idea selection flags fail silently. The participant submission flow was restructured to work regardless (participant update happens first, idea batch is non-critical).

**Group formation logic:**
- Groups are formed immediately at join time via tryFormGroup() in session.js: as soon as X participants (groupSize) are waiting, they are assigned to a group and move to the first phase together
- tryFormGroup receives joiningUid and explicitly includes the joining participant in the count even if Firestore hasn't reflected the write yet (fixes read-after-write race condition)
- groupSize is a configurable per-session parameter (default 3, min 1 for solo testing)
- Solo stragglers who cannot fill a group wait in the lobby until more join, or instructor calls handleStragglers
- Each participant is assigned an anonymous label (p1, p2, p3...) randomly at group creation; labels are shown instead of names throughout the session
- autoGroupParticipants handles the individual->group transition within a group: when all members of a group finish individual phase, that group moves to group phase automatically
- Session status auto-advances from individual->group when all groups are formed, and voting->survey when all votes are submitted
- Session status auto-advances from survey->done via onParticipantUpdated trigger when all participants have status 'done'
**Key config objects per session:**
```
phaseConfig: {
  individualPhaseActive, groupPhaseActive, phaseOrder,
  maxIdeasIndividual, ideasCarriedToGroup, groupSize,
  individualPhaseDuration, groupPhaseDuration, votingDuration
}
aiConfig: {
  individualAI, groupAI, model, temperature,
  maxTokens, systemPrompt, personality, contextWindow
}
```
**Group Firestore document:**
```
groups/{groupId}: {
  members: [uid, uid, ...],
  memberLabels: { uid: 'p1', uid: 'p2', ... },
  status, finalIdeas, createdAt
}
participants/{uid}: {
  ...,
  anonymousLabel: 'p1',
  groupId, status, individualComplete, votedFor,
  demographics: { age, gender, nationality, country, levelOfStudy, workExperience, occupation, englishFluency },
  consentGiven: boolean,
  consentTimestamp: string
}
```
**Admin:**
- Only admin@admin.com can access /admin routes. Other users are redirected to /join.
- Logging in as admin@admin.com redirects directly to /admin.
- Session delete is allowed only for admin@admin.com (Firestore rule: isAdmin()).
- Admin advance button is labelled "Force advance -> [phase]" and is a manual override; most transitions happen automatically.
- Language throughout uses "participants" not "players".
**Admin UI (Admin.jsx + Admin.module.css):**
- Two-column layout: left = Create/Edit session form, right = Active/Completed sessions list
- Each form section has a small 11px hint text (sectionHint class) below the section heading
- cardSubtitle class used under card titles for descriptive text
- After creating a session, a vivid code box appears (createdCodeBox) below the Create button and above Setup Summary, showing the session code with a dashed accent border. No auto-navigation -- admin opens the session from the right panel.
- Code box hint text: "Share this code before your session begins. Participants join at: stouras.com/lab/ideasearchlab" (with clickable link)
- joinHint class shows at the bottom of the Active Sessions panel
- Setup Summary sits below the code box at the bottom of the left card
- CSS module filenames must be Admin.module.css and AdminSession.module.css (dot not underscore) -- GitHub Pages build is case-sensitive
**AdminSession.jsx + AdminSession.module.css (host control room):**
- Header: back button, wordmark, slash, session code, status badge
- Phase timeline rendered inside a timelineCard div (not raw text)
- Two-column grid: Participants panel (with breakdown chips and list) + Session Config panel
- ConfigRow uses CSS module classes (configRow, configLabel, configValue) not inline styles
- Advance bar at bottom: current phase, arrow, next phase, auto-note, Force advance button
- Participant display falls back to anonymousLabel or truncated ID if name is missing
- Phase order value humanised (individual_first -> individual first)
**Survey.jsx:**
- On submit, writes status: 'done', surveyAnswers, surveyCompletedAt to participant doc directly (no Cloud Function)
- onParticipantUpdated trigger in session.js detects all-done and advances session to 'done'
**Firestore security rules highlights:**
- Sessions: read by any signed-in user, create by signed-in user, update by session instructor, delete by admin@admin.com only
- Participants: read by instructor OR any session participant OR owner (needed for pre-join getDoc check)
- Groups: read by session members, write only via Cloud Functions (admin SDK bypasses rules)
- Ideas: read by session members, create by session participants (own ideas only), update/delete by author (NEEDS ADDING)
**SPA routing:** 404.html at root of konstantinosStouras.github.io catches unknown paths and redirects to /lab/ideasearchlab/?redirect=... The inject step in deploy.yml injects a script into index.html that reads the redirect param and restores the URL.
**Split-screen UI:** main app on left, AI chat on right, draggable divider. When AI is off the left panel fills full width.
**To deploy any frontend change:**
```
cd C:\Users\User\Documents\GitHub\ideasearchlab
git add .
git commit -m "your message"
git push
```
GitHub Actions handles the rest automatically.
**To redeploy Cloud Functions:**
```
cd C:\Users\User\Documents\GitHub\ideasearchlab
firebase deploy --only functions
```
Note: Firebase detects unchanged functions and skips them. If a redeploy is skipped unexpectedly, add a trivial comment change to force detection.
**Key learnings and gotchas:**
- Firestore transactions (db.runTransaction) do NOT support query reads (tx.get with .where()). Only document reads (tx.get(docRef)) work inside transactions. Use batch writes instead when queries are needed.
- Firestore read-after-write race condition: querying immediately after a .set() may not include the just-written document. Fix by passing the new document's ID explicitly and injecting it into the result if missing.
- JoinSession and GroupPhase both had transaction bugs fixed by replacing transactions with query-then-batch pattern.
- Every phase page (SessionLobby, IndividualPhase, GroupPhase, VotingPhase, Survey) has a real-time onSnapshot listener on the participant's own document that navigates automatically when status changes. This is the core routing mechanism.
- Downloaded file changes must be manually copied into the local repo before committing -- Claude cannot push to GitHub directly.
- CSS module filenames are case-sensitive on the GitHub Pages build server. Always use dots not underscores (Admin.module.css not Admin_module.css).
- Browser cache can mask deployed changes. Use Ctrl+Shift+R or incognito to verify.
- Git tags used for lightweight version snapshots; CLAUDE.md at repo root for project context onboarding.
- autoGroupParticipants session-advance check must account for all group members in the current batch, not just the triggering participant. Using only change.after.id causes the check to fail for groups of 2+ because the other members still show old status in Firestore before the batch commits.
- Atomic writeBatch operations fail entirely if any single write fails. For operations mixing critical updates (participant status) with non-critical ones (idea selection flags), separate them into independent calls so the critical path succeeds even if the non-critical batch fails due to missing Firestore rules.
- GroupPhase individual ideas filter must fall back to "latest N by createdAt" when no ideas have `selected: true`, to handle the case where the selection batch failed due to Firestore rules.

## Files changed in this session

**New files created:**
- `src/pages/Welcome.jsx` + `src/pages/Welcome.module.css` -- study overview with dynamic phase descriptions
- `src/pages/Registration.jsx` + `src/pages/Registration.module.css` -- demographics form with country dropdowns and consent

**Updated files:**
- `src/App.jsx` -- added Welcome and Registration routes
- `src/pages/JoinSession.jsx` -- validates code client-side, navigates to Welcome for new participants
- `src/pages/IndividualPhase.jsx` + `.module.css` -- instructions page, structured ideas (title+description), pill cards, edit/delete, double-click selection, collapsible task brief
- `src/pages/GroupPhase.jsx` + `.module.css` -- matching pill cards, title+description submission, selection fallback, voting navigation fix
- `src/pages/Survey.jsx` + `.module.css` -- redesigned with section cards, new question type renderers
- `src/data/surveyQuestions.js` -- 12 questions across 4 sections with new types

**Static assets needed:**
- `public/images/sleep-mask-example.png` -- example product image for task brief (gracefully hidden if missing)

**Firestore rules needed (not yet applied):**
- Ideas subcollection: `allow update/delete: if request.auth.uid == resource.data.authorId;`

**Current status:** Welcome, Registration, IndividualPhase (with instructions + structured ideas), GroupPhase (with pill cards and fallback), and Survey (redesigned) are all deployed. Core flow works end to end. Firestore idea update/delete rules still need to be added for edit, delete, and selection persistence to work.

**Next steps when resuming:**
1. Add Firestore security rules for idea update/delete
2. Merge voting into group phase: moderator selection with group approval (design discussion started but not yet implemented)
3. Test full end-to-end flow with Firestore rules in place
4. Add sleep mask image to public/images/