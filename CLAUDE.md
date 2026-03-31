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
- joinSession: registers participant, immediately forms a group if enough people are waiting, starts their first phase
- advancePhase: instructor-controlled override for voting → survey → done (individual/group transitions are automatic)
- autoGroupParticipants: Firestore trigger - when all members of a group complete individual phase, moves them to group phase
- handleStragglers: callable - forms undersized groups or sends solo participants to survey for lobby stragglers
- sendAIMessage: calls LLM, stores response
- saveAISettings: saves global AI provider settings
- submitVote: records votes, tallies top ideas, auto-advances session to survey when all have voted
**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page.
**Session flow:** waiting → individual → group → voting → survey → done (order and active phases configurable per session)
**Group formation logic:**
- Groups are formed immediately at join time: as soon as X participants (groupSize) are waiting, they are assigned to a group and move to the first phase together
- groupSize is a configurable per-session parameter (default 3, min 1 for solo testing)
- Solo stragglers who cannot fill a group wait in the lobby until more join, or instructor calls handleStragglers
- Each participant is assigned an anonymous label (p1, p2, p3...) randomly at group creation; labels are shown instead of names throughout the session
- autoGroupParticipants handles the individual→group transition within a group: when all members of a group finish individual phase, that group moves to group phase automatically
- Session status auto-advances from individual→group when all groups are formed, and voting→survey when all votes are submitted
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
**Group Firestore document (new fields):**
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
- Admin advance button is labelled "Force advance" and is a manual override; most transitions happen automatically.
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
- JoinSession and GroupPhase both had this bug fixed by replacing transactions with query-then-batch pattern.
- Every phase page (SessionLobby, IndividualPhase, GroupPhase, VotingPhase, Survey) has a real-time onSnapshot listener on the participant's own document that navigates automatically when status changes. This is the core routing mechanism.
- Downloaded file changes must be manually copied into the local repo before committing.
- Git tags used for lightweight version snapshots; CLAUDE.md at repo root for project context onboarding.
**Current status:** App is live. Full participant flow is functional end to end. Group formation at join time is implemented but still being tested. Anonymous labels in group phase are implemented. Admin-only access enforced.
**Next steps when resuming:** continue testing the full participant flow with the new group-on-join logic, verify anonymous labels display correctly in group phase, test voting and survey completion.