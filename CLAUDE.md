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

**Deployment:** GitHub Actions workflow builds the React app and pushes dist/ into konstantinosStouras.github.io/lab/ideasearchlab/. Triggered automatically on every push to main.

**Firebase project:** ideasearchlab (region: europe-west1)

**Firebase services used:** Firestore, Authentication (Email/Password), Cloud Functions (Node 20, europe-west1)

**Frontend:** React + Vite, React Router with basename="/lab/ideasearchlab"

**Cloud Functions (all in europe-west1):**
- joinSession: validates session code, registers participant
- advancePhase: moves session to next phase
- autoGroupParticipants: rolling group formation (Firestore trigger)
- sendAIMessage: calls LLM, stores response
- saveAISettings: saves global AI provider settings
- submitVote: records votes, tallies top 3

**AI providers supported:** Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google). Keys stored in Firestore settings/ai document, managed via /admin/ai-settings page.

**Session flow:** waiting → individual → group → voting → survey → done (order and active phases configurable per session)

**Rolling group formation:** as soon as 3 participants complete individual phase they are grouped immediately, without waiting for everyone. Groups of 2 for leftover pairs, solo stragglers go to survey.

**Key config objects per session:**
```
phaseConfig: {
  individualPhaseActive, groupPhaseActive, phaseOrder,
  maxIdeasIndividual, ideasCarriedToGroup,
  individualPhaseDuration, groupPhaseDuration, votingDuration
}
aiConfig: {
  individualAI, groupAI, model, temperature,
  maxTokens, systemPrompt, personality, contextWindow
}
```

**Split-screen UI:** main app on left, AI chat on right, draggable divider. When AI is off the left panel fills full width.

**Survey questions:** fixed in src/data/surveyQuestions.js, conditional on session config via showIf functions.

**To deploy any change:**
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

**Current status:** App is live and working. All 6 Cloud Functions deployed in europe-west1. AI Settings page working at /admin/ai-settings with keys saved for Claude, OpenAI, and Gemini.

**Next steps when resuming:** test the full participant flow end to end, debug any issues that come up, then refine stage by stage.