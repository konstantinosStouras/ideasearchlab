/**
 * Returns the ordered list of session statuses based on phaseConfig.
 * This is the single source of truth for session flow in both the
 * frontend and Cloud Functions.
 */
export function getPhaseSequence(phaseConfig = {}) {
  const {
    individualPhaseActive = true,
    groupPhaseActive = true,
    phaseOrder = 'individual_first',
  } = phaseConfig

  const sequence = ['waiting']

  if (individualPhaseActive && groupPhaseActive) {
    if (phaseOrder === 'individual_first') {
      sequence.push('individual', 'group', 'voting')
    } else {
      sequence.push('group', 'voting', 'individual')
    }
  } else if (individualPhaseActive) {
    sequence.push('individual')
  } else if (groupPhaseActive) {
    sequence.push('group', 'voting')
  }

  sequence.push('survey', 'done')
  return sequence
}

/**
 * Given a current status and phaseConfig, return the next status.
 * Returns null if already at the end.
 */
export function getNextPhase(currentStatus, phaseConfig) {
  const sequence = getPhaseSequence(phaseConfig)
  const idx = sequence.indexOf(currentStatus)
  if (idx === -1 || idx >= sequence.length - 1) return null
  return sequence[idx + 1]
}
