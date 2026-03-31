# CLAUDE.md — Project Notes for AI Assistant
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
- advancePhase: instructor-controlled override for voting → survey → done (individual/group transitions are automatic)
- autoGroupParticipants: Firestore trigger - when all members of a group complete individual phase, moves them to group phase
- handleStragglers: callable - forms undersized groups or sends solo participants to survey for lobby stragglers
- sendAIMessage: calls LLM, stores response
- saveAISettings: saves global AI provider settings
- submitVote: records votes, tallies top ideas, auto-advances session to survey when all have voted
- onParticipantUpdated: Firestore trigger - when a participant's status becomes 'done', checks if all participants are done and advances session status to 'done'
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page.
**Session flow:** waiting → individual → group → voting → survey → done (order and active phases configurable per session)
**Group formation logic:**
- Groups are formed immediately at join time via tryFormGroup() in session.js: as soon as X participants (groupSize) are waiting, they are assigned to a group and move to the first phase together
- tryFormGroup receives joiningUid and explicitly includes the joining participant in the count even if Firestore hasn't reflected the write yet (fixes read-after-write race condition)
- groupSize is a configurable per-session parameter (default 3, min 1 for solo testing)
- Solo stragglers who cannot fill a group wait in the lobby until more join, or instructor calls handleStragglers
- Each participant is assigned an anonymous label (p1, p2, p3...) randomly at group creation; labels are shown instead of names throughout the session
- autoGroupParticipants handles the individual→group transition within a group: when all members of a group finish individual phase, that group moves to group phase automatically
- Session status auto-advances from individual→group when all groups are formed, and voting→survey when all votes are submitted
- Session status auto-advances from survey→done via onParticipantUpdated trigger when all participants have status 'done'
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
  memberLabels: { uid: 'p1', uid: 'p2', ... },  // anonymous labels
  status, finalIdeas, createdAt
}
participants/{uid}: {
  ...,
  anonymousLabel: 'p1',  // their own label for this group
  groupId, status, individualComplete, votedFor
}
```
**Admin:**
- Only admin@admin.com can access /admin routes. Other users are redirected to /join.
- Logging in as admin@admin.com redirects directly to /admin.
- Session delete is allowed only for admin@admin.com (Firestore rule: isAdmin()).
- Admin advance button is labelled "Force advance → [phase]" and is a manual override; most transitions happen automatically.
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
**IndividualPhase.jsx:**
- Submission count banner shows: "{doneCount} of {groupSize} group members have submitted."
- doneCount = groupMembers.filter(m => m.individualComplete).length (no self-correction needed, Firestore listener updates correctly)
- groupMembers is populated via onSnapshot query on participants where groupId matches
**Survey.jsx:**
- On submit, writes status: 'done', surveyAnswers, surveyCompletedAt to participant doc directly (no Cloud Function)
- onParticipantUpdated trigger in session.js detects all-done and advances session to 'done'
**Firestore security rules highlights:**
- Sessions: read by any signed-in user, create by signed-in user, update by session instructor, delete by admin@admin.com only
- Participants: read by instructor OR any session participant OR owner (needed for pre-join getDoc check)
- Groups: read by session members, write only via Cloud Functions (admin SDK bypasses rules)
- Ideas: read by session members, create by session participants (own ideas only)
**SPA routing:** 404.html at root of konstantinosStouras.github.io catches unknown paths and redirects to /lab/ideasearchlab/?redirect=... The inject step in deploy.yml injects a script into index.html that reads the redirect param and restores the URL.
**Split-screen UI:** main app on left, AI chat on right, draggable divider. When AI is off the left panel fills full width.
**Survey questions:** fixed in src/data/surveyQuestions.js, conditional on session config via showIf functions.
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
**Current status:** App is live. Admin panel UI improvements complete. Auto-group-on-join implemented and race condition fixed. survey→done auto-advance implemented via onParticipantUpdated trigger. IndividualPhase submission count display fixed. Full participant flow testing in progress.
**Next steps when resuming:** continue testing the full participant flow end to end -- verify group formation triggers correctly on join, anonymous labels display in group phase, voting works, survey completes and session advances to done automatically.