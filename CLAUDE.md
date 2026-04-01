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
**NPM dependencies of note:** `xlsx` (SheetJS) for client-side Excel export in the admin panel.
**Cloud Functions (all in europe-west1):**
- joinSession: registers participant, immediately forms a group if enough people are waiting, starts their first phase. Passes joiningUid to tryFormGroup to avoid Firestore read-after-write race condition.
- advancePhase: instructor-controlled override for any phase transition (manual "Force advance" button). Calls `tallyGroupVotes()` when transitioning from group to survey, which reads all participants' `votedFor` arrays, counts votes per idea, and stores the top 3 as `finalIdeas` on each group document.
- autoGroupParticipants: Firestore trigger -- when all members of a group complete individual phase, moves them to group phase. Session auto-advance check accounts for all group members being moved in the batch (not just the triggering participant), fixing a bug where session status stayed on "individual" even after all participants moved to group.
- handleStragglers: callable -- forms undersized groups or sends solo participants to survey for lobby stragglers
- sendAIMessage: calls LLM, stores response in `sessions/{sessionId}/aiMessages`
- saveAISettings: saves global AI provider settings
- submitVote: legacy Cloud Function, still deployed but no longer called by the frontend. Voting now happens via direct Firestore writes from GroupPhase.jsx.
- onParticipantUpdated: Firestore trigger -- when a participant's status becomes 'done', checks if all participants are done and advances session status to 'done'
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page.
**Session flow:** waiting -> individual -> group -> survey -> done (order and active phases configurable per session). Note: 'voting' was removed from the backend phase sequence. Voting now happens client-side as a sub-phase within GroupPhase.

## Participant onboarding flow
The participant join flow now has four steps before reaching the session lobby:
1. **JoinSession** (`src/pages/JoinSession.jsx`): Enter session code. Validates code client-side via Firestore query. If participant is new, navigates to Welcome. If already registered (rejoining), skips directly to SessionLobby.
2. **Welcome** (`src/pages/Welcome.jsx` + `Welcome.module.css`): Displays study overview with dynamic phase descriptions based on session's `phaseConfig`. Adapts text for individual-first, group-first, individual-only, or group-only configurations. Amazon Voucher paragraph only shown when group phase is active. "I agree and continue" button navigates to Registration.
3. **Registration** (`src/pages/Registration.jsx` + `Registration.module.css`): Collects demographics (Age, Gender, Nationality, Country, Level of Study, Work Experience, Occupation, English Fluency) plus two consent checkboxes. Nationality and Country use dropdown menus with full 195-country list. Work Experience is a number input validated 0-50. On submit, calls `joinSession` Cloud Function, then writes demographics to participant doc via `updateDoc`. Data stored as `demographics` object + `consentGiven` + `consentTimestamp` on participant document.
4. **SessionLobby**: Existing page, unchanged.

Routes added to `App.jsx`: `/session/:sessionId/welcome` and `/session/:sessionId/register`, both wrapped in SessionWrapper.

## Idea data model
Ideas have structured fields:
```
ideas/{ideaId}: {
  title: string,          // idea title (bold display)
  description: string,    // description (smaller text below)
  text: string,           // combined "title: description" for backward compatibility
  authorId, authorName, phase, groupId, votes, createdAt,
  selected: boolean       // true if user chose this as a top idea for group phase
}
```
Note: vote counts are NOT stored on idea documents. They are derived client-side by counting across all group members' `votedFor` arrays on their participant documents.

## IndividualPhase.jsx
- **Two-view structure**: Instructions view (shown first with "Start" button), then workspace view.
- **Instructions page**: Full-page card with study instructions, dynamic duration from `individualPhaseDuration`, task checklist, group-phase warning (conditional).
- **Collapsible Task Brief**: Shown in workspace, contains the sleep wellness product design prompt, example product with image (`public/images/sleep-mask-example.png`), evaluation criteria (Novelty, Feasibility, Financial Value, Overall Quality), AI note (conditional), and selection instructions.
- **Structured idea submission**: Two fields, "Idea title" and "Description", rendered in pill-shaped cards (border-radius: 20px) with bold title, gradient separator line, and smaller description text.
- **Inline editing**: Pencil icon appears on hover, click enters edit mode with editable fields + Save/Cancel.
- **Delete**: Trash bin icon appears on hover (red on hover), calls `deleteDoc`.
- **Double-click selection**: Double-click toggles idea selection for group carry-over. Selected cards get accent border, glow, and "Selected" badge. Selection bar shows count ("Selected ideas: 2 / 3"). Maximum controlled by `ideasCarriedToGroup`.
- **Finish & Submit**: Disabled until at least one idea is selected. Does participant `updateDoc` first (critical), then idea selection batch separately (non-critical, fails gracefully if Firestore rules missing).
- **Static image**: Example sleep mask image at `public/images/sleep-mask-example.png`. The `<img>` tag hides itself via `onError` if file not found.
- **Navigation**: Listens for status changes via onSnapshot. Navigates to group, survey, or done. The old `voting` navigation was removed since voting is no longer a separate phase.

## GroupPhase.jsx (major update -- two client-side sub-phases with chat)
GroupPhase handles two sub-phases via a client-side `subPhase` state toggle ('ideation' or 'voting'). This is purely a UI toggle per participant, not a Firestore status change. The participant's Firestore status stays as 'group' throughout.

### Group Ideation sub-phase (default)
- **Title**: "Group Ideation Phase"
- **Top right**: Timer + "Proceed to Voting" button (accent pill)
- **Left column**: Individual Ideas (selected/carried from individual phase), chronological order
- **Right column**: Split vertically into Group Ideas (top, max 45% height with add form) and Group Chat (bottom, fills remaining space)
- Title + description submission form (dashed-border pill card) for adding group ideas

### Group Voting sub-phase (after clicking "Proceed to Voting")
- **Title**: "Group Voting Phase"
- **Top right**: Timer + vote counter (0/3) + "Submit Votes" button (disabled until 3 votes, locks votes on click)
- **Left column**: ALL ideas merged (individual + group) in one scrollable list, sorted by votes descending. Each pill shows a small "individual" or "group" phase tag.
- **Right column**: Group Chat only, taking full column height (no Group Ideas header)
- Double-click any idea pill to toggle a vote (max 3 per participant)
- Votes stored as `votedFor` array on the participant's own document (direct `updateDoc`), not on idea docs
- Vote counts derived in real-time by iterating all group members' `votedFor` arrays (from the existing members onSnapshot listener)
- "Votes: N" badge shown on idea pills that have votes
- Voted pills get accent border + glow. Maxed-out pills get dimmed opacity
- After clicking "Submit Votes": writes `votesSubmitted: true` and `votedAt` to participant doc, locks the UI (double-clicks ignored), button replaced by green "Votes submitted" badge
- Member chips show checkmark next to members who have submitted votes
- Compact voting hint text with inline "Back to ideation" link
- Chat remains active during voting

### Group Chat (both sub-phases)
- Messages stored in Firestore subcollection: `sessions/{sessionId}/groups/{groupId}/messages/{messageId}`
- Each message: `{ authorId, authorLabel, text, createdAt }`
- Real-time `onSnapshot` listener, ordered by `createdAt` ascending
- WhatsApp-style bubbles: own messages right-aligned with accent tint, others left-aligned with sender's anonymous label (p1, p2) shown above
- Small timestamp on bottom-right of each bubble
- Header shows "Group Chat" with subtitle "Discuss and refine your ideas"
- Auto-scroll to newest message
- Empty state: "No messages yet. Start the conversation!"

### Individual ideas filter (unchanged)
- Prefers ideas with `selected: true`. Falls back to latest N by `createdAt` if no selected ideas found (handles case where selection batch failed due to Firestore rules).

### Vote tallying (backend)
When the instructor clicks "Force advance" from group to survey, `advancePhase` in session.js calls `tallyGroupVotes()`:
- Reads all active groups and their members' `votedFor` arrays
- Counts votes per idea across all group members
- Stores the top 3 idea IDs as `finalIdeas` on each group document
- Marks group status as 'done' with `votingCompletedAt` timestamp

## VotingPhase.jsx (retired)
The separate VotingPhase page is no longer used. The `/voting` route can be removed from App.jsx. The old VotingPhase.jsx and VotingPhase.module.css files remain in the repo but are not imported anywhere.

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

## Firestore security rules
**Ideas subcollection:**
```
allow update: if request.auth.uid == resource.data.authorId;
allow delete: if request.auth.uid == resource.data.authorId;
```
- Authors can edit/delete their own ideas (title, description, selected flag)

**Participants subcollection:**
- Participants need self-update permission for writing `votedFor`, `votesSubmitted`, `votedAt`, `surveyAnswers`, `status: 'done'`, etc.
```
allow update: if request.auth.uid == request.resource.id;
```

**Group chat messages** (nested inside groups match):
```
match /messages/{messageId} {
  allow read: if request.auth != null;
  allow create: if request.auth != null;
}
```
- Participants can read all chat messages and create new messages
- No editing or deleting chat messages

**Group formation logic:**
- Groups are formed immediately at join time via tryFormGroup() in session.js: as soon as X participants (groupSize) are waiting, they are assigned to a group and move to the first phase together
- tryFormGroup receives joiningUid and explicitly includes the joining participant in the count even if Firestore hasn't reflected the write yet (fixes read-after-write race condition)
- groupSize is a configurable per-session parameter (default 3, min 1 for solo testing)
- Solo stragglers who cannot fill a group wait in the lobby until more join, or instructor calls handleStragglers
- Each participant is assigned an anonymous label (p1, p2, p3...) randomly at group creation; labels are shown instead of names throughout the session
- autoGroupParticipants handles the individual->group transition within a group: when all members of a group finish individual phase, that group moves to group phase automatically
- Session status auto-advances from individual->group when all groups are formed
- Session status auto-advances from survey->done via onParticipantUpdated trigger when all participants have status 'done'

**Phase sequence (backend, `getPhaseSequence` in session.js and phaseSequence.js):**
- 'voting' has been removed from the sequence
- Both individual and group active (individual_first): waiting, individual, group, survey, done
- Both active (group_first): waiting, group, individual, survey, done
- Individual only: waiting, individual, survey, done
- Group only: waiting, group, survey, done

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
  status, finalIdeas, createdAt, votingCompletedAt
}
groups/{groupId}/messages/{messageId}: {
  authorId: string,
  authorLabel: string,   // e.g. 'p1'
  text: string,
  createdAt: serverTimestamp
}
participants/{uid}: {
  ...,
  anonymousLabel: 'p1',
  groupId, status, individualComplete,
  votedFor: [ideaId, ideaId, ideaId],  // up to 3 idea IDs
  votesSubmitted: boolean,              // true after clicking "Submit Votes"
  votedAt: serverTimestamp,
  demographics: { age, gender, nationality, country, levelOfStudy, workExperience, occupation, englishFluency },
  consentGiven: boolean,
  consentTimestamp: string,
  surveyAnswers: { ... },
  surveyCompletedAt: serverTimestamp
}
```
**AI Messages Firestore collection:**
```
sessions/{sessionId}/aiMessages/{messageId}: {
  role: 'user' | 'assistant',
  text: string,
  scope: 'individual' | 'group',
  scopeId: string,        // participant UID or groupId
  authorId: string,        // participant UID or 'ai'
  authorName: string,
  timestamp: serverTimestamp
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
- phaseLabel() helper displays human-friendly labels: "group ideation" for group status
- Two-column grid: Participants panel (with breakdown chips and list) + Session Config panel
- Config panel includes "Group phase timer" row showing minutes or "Manual"
- ConfigRow uses CSS module classes (configRow, configLabel, configValue) not inline styles
- Advance bar at bottom: current phase, arrow, next phase, auto-note, Force advance button
- Participant display falls back to anonymousLabel or truncated ID if name is missing

**Data & Export section (AdminSession.jsx):**
- Sits below the Participants/Config grid, above the advance bar
- Shows three stat boxes: Participants count, Voted count, Surveys completed count
- "Download Excel" button fetches all session data on-demand from Firestore and generates a multi-sheet `.xlsx` file
- Uses the `xlsx` (SheetJS) npm package for client-side Excel generation
- Excel file name: `session_{CODE}_data.xlsx`
- **Sheet 1 -- Participants**: ID, name, email, anonymous label, group ID, status, individual complete, votes submitted, voted for (comma-separated IDs), consent, demographics (all fields), joined at
- **Sheet 2 -- Ideas**: ID, title, description, full text, author, phase, group ID, selected flag, vote count (tallied from participants' votedFor arrays), created at
- **Sheet 3 -- Survey**: One row per participant who completed the survey. Fixed columns (ID, name, label, completed at) plus one column per survey question key. Nested rating_group answers flattened to "key: value; key: value" strings.
- **Sheet 4 -- Group Chat**: Group ID, author ID, author label, message text, sent at. Sorted chronologically. Fetched from each group's messages subcollection.
- **Sheet 5 -- AI Chat**: Role (user/assistant), scope, scope ID, author ID, author name, message text, timestamp. Covers both user inputs and LLM responses. Fetched from `sessions/{sessionId}/aiMessages` ordered by timestamp.
- **Sheet 6 -- Groups**: Group ID, members, member labels, status, final ideas, created at.
- Column widths auto-fitted based on content (capped at 50 chars)

**Survey.jsx:**
- On submit, writes status: 'done', surveyAnswers, surveyCompletedAt to participant doc directly (no Cloud Function)
- onParticipantUpdated trigger in session.js detects all-done and advances session to 'done'

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
- Every phase page (SessionLobby, IndividualPhase, GroupPhase, Survey) has a real-time onSnapshot listener on the participant's own document that navigates automatically when status changes. This is the core routing mechanism.
- GroupPhase handles both ideation and voting as client-side sub-phases via a `subPhase` state toggle. The participant's Firestore status stays 'group' throughout. There is no separate 'voting' status in Firestore.
- Voting uses `votedFor` array on participant documents (not on idea docs). Vote counts are derived client-side by iterating all group members' votedFor arrays. This avoids needing special Firestore rules for cross-user idea updates.
- `tallyGroupVotes()` in session.js is called by `advancePhase` when transitioning group->survey. It reads all participants' votedFor arrays, tallies votes, and stores top 3 as finalIdeas on group docs.
- Downloaded file changes must be manually copied into the local repo before committing -- Claude cannot push to GitHub directly.
- CSS module filenames are case-sensitive on the GitHub Pages build server. Always use dots not underscores (Admin.module.css not Admin_module.css).
- Browser cache can mask deployed changes. Use Ctrl+Shift+R or incognito to verify.
- Git tags used for lightweight version snapshots; CLAUDE.md at repo root for project context onboarding.
- autoGroupParticipants session-advance check must account for all group members in the current batch, not just the triggering participant. Using only change.after.id causes the check to fail for groups of 2+ because the other members still show old status in Firestore before the batch commits.
- Atomic writeBatch operations fail entirely if any single write fails. For operations mixing critical updates (participant status) with non-critical ones (idea selection flags), separate them into independent calls so the critical path succeeds even if the non-critical batch fails due to missing Firestore rules.
- GroupPhase individual ideas filter must fall back to "latest N by createdAt" when no ideas have `selected: true`, to handle the case where the selection batch failed due to Firestore rules.
- The `xlsx` npm package must be installed (`npm install xlsx`) for the admin export to work. It's a client-side dependency used in AdminSession.jsx.

## Files changed in latest session (voting client-side, chat, data export)

**Updated files:**
- `src/pages/GroupPhase.jsx` + `.module.css` -- complete rewrite: two client-side sub-phases (ideation/voting), "Proceed to Voting" button, "Submit Votes" button with lock, merged idea list in voting mode, group chat panel, vote badges, phase tags
- `src/pages/IndividualPhase.jsx` -- removed `voting` status navigation (voting phase no longer exists)
- `src/pages/AdminSession.jsx` + `.module.css` -- added Data & Export card with Excel download (6 sheets including AI Chat), removed voting-specific config rows
- `functions/session.js` -- removed 'voting' from `getPhaseSequence`, added `tallyGroupVotes()` called on group->survey transition, removed voting participant status case from `advancePhase`

**Files that still need updating:**
- `src/utils/phaseSequence.js` -- must remove 'voting' from the frontend phase sequence to match the backend
- `src/App.jsx` -- can remove the `/session/:sessionId/voting` route (optional, dead route causes no harm)

**Orphaned Cloud Functions (still deployed, safe to delete):**
- `autoAdvanceOnTimer` -- no longer in local source code, Firebase will prompt to delete on next deploy
- `submitVote` -- still exported from voting.js but no longer called by the frontend

**Retired files (still in repo, no longer imported):**
- `src/pages/VotingPhase.jsx` + `VotingPhase.module.css` -- replaced by GroupPhase voting sub-phase

**Static assets needed:**
- `public/images/sleep-mask-example.png` -- example product image for task brief (gracefully hidden if missing)

**Current status:** Full flow deployed with group ideation/voting as client-side sub-phases, group chat, data export with AI chat logs, and updated phase sequence. Voting phase removed from backend sequence. Admin can download all session data as Excel.

**Next steps when resuming:**
1. Update `src/utils/phaseSequence.js` to remove 'voting' from frontend sequence
2. End-to-end test of the full participant flow (group size 1 for solo, short timers)
3. Add sleep mask image to public/images/
4. Optionally clean up orphaned Cloud Functions (autoAdvanceOnTimer, submitVote)
5. Update Firestore security rules for participant self-update (votedFor, votesSubmitted) and group chat messages