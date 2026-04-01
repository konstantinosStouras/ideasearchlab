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
- advancePhase: instructor-controlled override for any phase transition (manual "Force advance" button)
- autoAdvanceOnTimer: callable by any participant when a phase timer expires. Validates server-side that the timer has actually expired (with 5s tolerance for clock skew), then advances session and all participants in the current phase. Idempotent: returns early if session already advanced past the requested fromPhase.
- autoGroupParticipants: Firestore trigger - when all members of a group complete individual phase, moves them to group phase. Session auto-advance check accounts for all group members being moved in the batch (not just the triggering participant), fixing a bug where session status stayed on "individual" even after all participants moved to group.
- handleStragglers: callable - forms undersized groups or sends solo participants to survey for lobby stragglers
- sendAIMessage: calls LLM, stores response
- saveAISettings: saves global AI provider settings
- submitVote: records votes, tallies top ideas, auto-advances session to survey when all have voted (legacy, kept for backward compatibility)
- onParticipantUpdated: Firestore trigger - when a participant's status becomes 'done', checks if all participants are done and advances session status to 'done'
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page.
**Session flow:** waiting -> individual -> group (ideation) -> voting (group voting) -> survey -> done (order and active phases configurable per session)

## Participant onboarding flow
The participant join flow now has four steps before reaching the session lobby:
1. **JoinSession** (`src/pages/JoinSession.jsx`): Enter session code. Validates code client-side via Firestore query. If participant is new, navigates to Welcome. If already registered (rejoining), skips directly to SessionLobby.
2. **Welcome** (`src/pages/Welcome.jsx` + `Welcome.module.css`): Displays study overview with dynamic phase descriptions based on session's `phaseConfig`. Adapts text for individual-first, group-first, individual-only, or group-only configurations. Amazon Voucher paragraph only shown when group phase is active. "I agree and continue" button navigates to Registration.
3. **Registration** (`src/pages/Registration.jsx` + `Registration.module.css`): Collects demographics (Age, Gender, Nationality, Country, Level of Study, Work Experience, Occupation, English Fluency) plus two consent checkboxes. Nationality and Country use dropdown menus with full 195-country list. Work Experience is a number input validated 0-50. On submit, calls `joinSession` Cloud Function, then writes demographics to participant doc via `updateDoc`. Data stored as `demographics` object + `consentGiven` + `consentTimestamp` on participant document.
4. **SessionLobby**: Existing page, unchanged.

Routes added to `App.jsx`: `/session/:sessionId/welcome` and `/session/:sessionId/register`, both wrapped in SessionWrapper.

## Idea data model
Ideas now have structured fields instead of just `text`:
```
ideas/{ideaId}: {
  title: string,          // idea title (bold display)
  description: string,    // description (smaller text below)
  text: string,           // combined "title: description" for backward compatibility
  authorId, authorName, phase, groupId, votes, createdAt,
  selected: boolean,      // true if user chose this as a top idea for group phase
  votedBy: [uid, ...]     // array of participant UIDs who voted for this idea (group voting)
}
```

## IndividualPhase.jsx (major update)
- **Two-view structure**: Instructions view (shown first with "Start" button), then workspace view.
- **Instructions page**: Full-page card with study instructions, dynamic duration from `individualPhaseDuration`, task checklist, group-phase warning (conditional).
- **Collapsible Task Brief**: Shown in workspace, contains the sleep wellness product design prompt, example product with image (`public/images/sleep-mask-example.png`), evaluation criteria (Novelty, Feasibility, Financial Value, Overall Quality), AI note (conditional), and selection instructions.
- **Structured idea submission**: Two fields, "Idea title" and "Description", rendered in pill-shaped cards (border-radius: 20px) with bold title, gradient separator line, and smaller description text.
- **Inline editing**: Pencil icon appears on hover, click enters edit mode with editable fields + Save/Cancel.
- **Delete**: Trash bin icon appears on hover (red on hover), calls `deleteDoc`.
- **Double-click selection**: Double-click toggles idea selection for group carry-over. Selected cards get accent border, glow, and "Selected" badge. Selection bar shows count ("Selected ideas: 2 / 3"). Maximum controlled by `ideasCarriedToGroup`.
- **Finish & Submit**: Disabled until at least one idea is selected. Does participant `updateDoc` first (critical), then idea selection batch separately (non-critical, fails gracefully if Firestore rules missing).
- **Static image**: Example sleep mask image at `public/images/sleep-mask-example.png`. The `<img>` tag hides itself via `onError` if file not found.

## GroupPhase.jsx (major update -- dual mode with chat)
GroupPhase now handles two sub-phases in a single component, determined by participant status:
- **`group` status = Group Ideation Phase**: idea creation enabled, chat enabled, AI panel shown (if configured)
- **`voting` status = Group Voting Phase**: idea creation form hidden, chat stays, double-click voting enabled, AI panel hidden

### Layout (both modes)
- **Two-column grid**: Left column = Individual Ideas (selected/carried from individual phase). Right column = split vertically into Group Ideas (top, max 45% height, scrollable) and Group Chat (bottom, fills remaining space).
- **Pill card design**: Same oval pill cards as IndividualPhase with title/separator/description pattern, author label (p1, p2...), "you" tag.

### Group Ideation mode
- Title + description submission form (dashed-border pill card) for adding group ideas
- Chat for real-time group discussion
- Timer uses `groupPhaseDuration` (default 900s = 15min)
- When timer expires, calls `autoAdvanceOnTimer({ sessionId, fromPhase: 'group' })` to advance all participants to voting

### Group Voting mode
- Add idea form hidden
- Double-click any idea pill to toggle a vote (max 3 votes per participant)
- Votes tracked via `votedBy` array on idea docs using `arrayUnion`/`arrayRemove` (no separate votes counter, avoids sync issues)
- Ideas sorted by vote count descending (most voted float to top)
- "Votes: N" badge shown on top-right of pill cards with votes
- Voted pills get accent border + glow. Maxed-out pills get dimmed (0.45 opacity)
- Vote counter in top bar shows "2 / 3" style display
- Timer uses `votingDuration` (default 300s = 5min)
- When timer expires, calls `autoAdvanceOnTimer({ sessionId, fromPhase: 'voting' })` to advance to survey
- Chat remains active during voting for group discussion

### Group Chat
- Messages stored in Firestore subcollection: `sessions/{sessionId}/groups/{groupId}/messages/{messageId}`
- Each message: `{ authorId, text, createdAt }`
- Real-time `onSnapshot` listener, ordered by `createdAt` ascending
- WhatsApp-style bubbles: own messages right-aligned with accent tint, others left-aligned with sender's anonymous label (p1, p2) shown above
- Small timestamp on bottom-right of each bubble
- Enter to send, Shift+Enter for new line
- Auto-scroll to newest message
- Available in both ideation and voting modes

### Individual ideas filter (unchanged)
- Prefers ideas with `selected: true`. Falls back to latest N by `createdAt` if no selected ideas found (handles case where selection batch failed due to Firestore rules).

## VotingPhase.jsx (retired)
The separate VotingPhase page is no longer used. The `/voting` route in App.jsx now renders `<GroupPhase />` which handles the voting sub-phase internally based on participant status. The old VotingPhase.jsx and VotingPhase.module.css files remain in the repo but are not imported anywhere.

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

## Firestore security rules (updated)
Rules were updated to support idea editing/deleting, voting, and group chat:

**Ideas subcollection:**
```
allow update: if isSessionParticipant(sessionId)
  && (request.auth.uid == resource.data.authorId
      || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['votedBy']));
allow delete: if isSessionParticipant(sessionId)
  && request.auth.uid == resource.data.authorId;
```
- Authors can edit/delete their own ideas (title, description, selected flag)
- Any session participant can modify only the `votedBy` array (for casting/removing votes)

**Group chat messages** (nested inside groups match):
```
match /messages/{messageId} {
  allow read: if isSessionMember(sessionId);
  allow create: if isSessionParticipant(sessionId)
    && request.resource.data.authorId == request.auth.uid;
  allow update, delete: if false;
}
```
- Participants can read all chat messages and create messages attributed to themselves
- No editing or deleting chat messages

**Group formation logic:**
- Groups are formed immediately at join time via tryFormGroup() in session.js: as soon as X participants (groupSize) are waiting, they are assigned to a group and move to the first phase together
- tryFormGroup receives joiningUid and explicitly includes the joining participant in the count even if Firestore hasn't reflected the write yet (fixes read-after-write race condition)
- groupSize is a configurable per-session parameter (default 3, min 1 for solo testing)
- Solo stragglers who cannot fill a group wait in the lobby until more join, or instructor calls handleStragglers
- Each participant is assigned an anonymous label (p1, p2, p3...) randomly at group creation; labels are shown instead of names throughout the session
- autoGroupParticipants handles the individual->group transition within a group: when all members of a group finish individual phase, that group moves to group phase automatically
- Session status auto-advances from individual->group when all groups are formed
- Session status auto-advances from group->voting when ideation timer expires (via autoAdvanceOnTimer)
- Session status auto-advances from voting->survey when voting timer expires (via autoAdvanceOnTimer)
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
groups/{groupId}/messages/{messageId}: {
  authorId: string,
  text: string,
  createdAt: serverTimestamp
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
- Phase Timers section labels: "Individual", "Group Ideation", "Group Voting" (renamed from "Group" and "Voting")
- Summary shows phases as "Individual -> Group Ideation -> Group Voting" and timers as "Xmin individual, Xmin group ideation, Xmin group voting"
- CSS module filenames must be Admin.module.css and AdminSession.module.css (dot not underscore) -- GitHub Pages build is case-sensitive
**AdminSession.jsx + AdminSession.module.css (host control room):**
- Header: back button, wordmark, slash, session code, status badge
- Phase timeline rendered inside a timelineCard div (not raw text)
- phaseLabel() helper displays human-friendly labels: "group ideation" for group status, "group voting" for voting status
- Two-column grid: Participants panel (with breakdown chips and list) + Session Config panel
- Config panel includes "Group ideation timer" and "Group voting timer" rows showing minutes or "Manual"
- ConfigRow uses CSS module classes (configRow, configLabel, configValue) not inline styles
- Advance bar at bottom: current phase, arrow, next phase, auto-note, Force advance button
- Auto-advance notes context-aware: "Auto-advances when ideation timer expires" for group, "Auto-advances when voting timer expires" for voting
- Participant display falls back to anonymousLabel or truncated ID if name is missing
**Survey.jsx:**
- On submit, writes status: 'done', surveyAnswers, surveyCompletedAt to participant doc directly (no Cloud Function)
- onParticipantUpdated trigger in session.js detects all-done and advances session to 'done'
**Firestore security rules highlights:**
- Sessions: read by any signed-in user, create by signed-in user, update by session instructor, delete by admin@admin.com only
- Participants: read by instructor OR any session participant OR owner (needed for pre-join getDoc check)
- Groups: read by session members, write only via Cloud Functions (admin SDK bypasses rules)
- Group messages: read by session members, create by participants (own messages only), no edit/delete
- Ideas: read by session members, create by session participants (own ideas only), update by author OR votedBy-only changes by any participant, delete by author
**SPA routing:** 404.html at root of konstantinosStouras.github.io catches unknown paths and redirects to /lab/ideasearchlab/?redirect=... The inject step in deploy.yml injects a script into index.html that reads the redirect param and restores the URL.
**Split-screen UI:** main app on left, AI chat on right, draggable divider. When AI is off the left panel fills full width. AI panel hidden during group voting sub-phase.
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
- GroupPhase handles both `group` and `voting` participant statuses internally (sub-phase detection). The `/voting` route in App.jsx also renders GroupPhase, so participants arriving at either URL get the correct view.
- autoAdvanceOnTimer is idempotent: multiple clients calling it simultaneously when a timer expires is safe. The function checks session.status !== fromPhase and returns early if already advanced. Worst case: two concurrent calls both advance, setting the same values (harmless).
- Voting uses `votedBy` array on idea docs instead of a separate `votes` counter. Vote count is computed as `votedBy.length` on the client. This avoids arrayUnion/increment sync issues.
- Downloaded file changes must be manually copied into the local repo before committing -- Claude cannot push to GitHub directly.
- CSS module filenames are case-sensitive on the GitHub Pages build server. Always use dots not underscores (Admin.module.css not Admin_module.css).
- Browser cache can mask deployed changes. Use Ctrl+Shift+R or incognito to verify.
- Git tags used for lightweight version snapshots; CLAUDE.md at repo root for project context onboarding.
- autoGroupParticipants session-advance check must account for all group members in the current batch, not just the triggering participant. Using only change.after.id causes the check to fail for groups of 2+ because the other members still show old status in Firestore before the batch commits.
- Atomic writeBatch operations fail entirely if any single write fails. For operations mixing critical updates (participant status) with non-critical ones (idea selection flags), separate them into independent calls so the critical path succeeds even if the non-critical batch fails due to missing Firestore rules.
- GroupPhase individual ideas filter must fall back to "latest N by createdAt" when no ideas have `selected: true`, to handle the case where the selection batch failed due to Firestore rules.

## Files changed in latest session (group chat + voting merge)

**Updated files:**
- `src/App.jsx` -- `/voting` route now renders GroupPhase instead of VotingPhase; VotingPhase import removed
- `src/pages/GroupPhase.jsx` + `.module.css` -- dual ideation/voting mode, group chat, auto-advance on timer, double-click voting with votedBy array, vote badges, idea sorting
- `src/pages/Admin.jsx` -- timer labels renamed to "Group Ideation" / "Group Voting", summary text updated
- `src/pages/AdminSession.jsx` -- phaseLabel() helper, config shows ideation/voting timers, context-aware auto-advance notes
- `functions/session.js` -- added autoAdvanceOnTimer Cloud Function
- `functions/index.js` -- exports autoAdvanceOnTimer
- Firestore security rules -- ideas update/delete rules added, group chat messages subcollection rules added

**Retired files (still in repo, no longer imported):**
- `src/pages/VotingPhase.jsx` + `VotingPhase.module.css` -- replaced by GroupPhase voting sub-phase

**Static assets needed:**
- `public/images/sleep-mask-example.png` -- example product image for task brief (gracefully hidden if missing)

**Current status:** Full flow deployed with group ideation/voting split, group chat, auto-advance on timer expiry, and updated Firestore rules. VotingPhase retired in favor of GroupPhase dual-mode.

**Next steps when resuming:**
1. End-to-end test of the full participant flow (group size 1 for solo, short timers to test auto-advance)
2. Add sleep mask image to public/images/
3. Consider persisting top 3 voted ideas to group document's finalIdeas field after voting completes