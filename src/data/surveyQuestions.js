/**
 * surveyQuestions.js
 *
 * Fixed survey questions shown to all participants at session end.
 * To add/remove questions: edit this file only.
 *
 * Question types:
 *   'likert'   - 1-7 scale
 *   'freetext' - open text area
 *
 * showIf (optional): function(session) => bool
 *   If provided, question only shows when it returns true.
 */

export const SURVEY_QUESTIONS = [
  {
    id: 'q_satisfy',
    text: 'I am satisfied with the ideas generated in this session.',
    type: 'likert',
  },
  {
    id: 'q_creative',
    text: 'The session helped me think more creatively than I would have on my own.',
    type: 'likert',
  },
  {
    id: 'q_collab',
    text: 'Collaborating with my group was productive.',
    type: 'likert',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },
  {
    id: 'q_ai_useful',
    text: 'The AI assistant was useful for my ideation process.',
    type: 'likert',
    showIf: (session) =>
      session?.aiConfig?.individualAI || session?.aiConfig?.groupAI,
  },
  {
    id: 'q_ai_distract',
    text: 'The AI assistant was distracting or reduced my focus.',
    type: 'likert',
    showIf: (session) =>
      session?.aiConfig?.individualAI || session?.aiConfig?.groupAI,
  },
  {
    id: 'q_open',
    text: 'Any other comments about your experience in this session?',
    type: 'freetext',
  },
]
