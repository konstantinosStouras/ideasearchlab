import { useParams, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import styles from './Welcome.module.css'

export default function Welcome() {
  const { sessionId } = useParams()
  const { session, loading } = useSession()
  const navigate = useNavigate()

  if (loading) {
    return <div className={styles.loading}>Loading session...</div>
  }

  if (!session) {
    return <div className={styles.loading}>Session not found.</div>
  }

  const pc = session.phaseConfig || {}
  const phases = getPhases(pc)

  function handleContinue() {
    navigate(`/session/${sessionId}/register`)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>Ideation Challenge</span>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Welcome to the Ideation Challenge</h1>
        <p className={styles.pageSubtitle}>
          Generate, evaluate, and select promising health &amp; wellness product concepts.
        </p>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Welcome</h2>

          <p className={styles.bodyText}>
            You are about to take part in an ideation challenge focused on generating
            and evaluating new product concepts in the{' '}
            <strong>health and wellness market</strong>.
          </p>

          <p className={styles.bodyText}>
            The goal of this study is to understand how people generate best ideas
            when developing new products for an existing or an emerging market.
          </p>

          <p className={styles.bodyText}>
            The study will involve {phases.length} phase{phases.length !== 1 ? 's' : ''}:
          </p>

          <ul className={styles.phaseList}>
            {phases.map((phase, i) => (
              <li key={phase.key} className={styles.phaseItem}>
                <strong>Phase {i + 1} - {phase.title}:</strong>
                <span className={styles.phaseDesc}>{phase.description}</span>
              </li>
            ))}
          </ul>

          {pc.groupPhaseActive && (
            <p className={styles.bodyText}>
              We will evaluate the quality of your ideas independently through external
              reviewers. If an idea selected by your group is among the top 5 ideas among
              all groups, then you will receive an award in the form of an Amazon Voucher
              worth 50 euros.
            </p>
          )}

          <p className={styles.bodyText}>
            Please follow the instructions carefully and complete each phase within
            the specific time.
          </p>

          <p className={styles.bodyText}>
            Thank you for taking part in the study.
          </p>

          <button className={`btn-primary ${styles.continueBtn}`} onClick={handleContinue}>
            I agree and continue
          </button>
        </div>
      </main>
    </div>
  )
}

/**
 * Builds an ordered list of phase descriptions based on session config.
 * Adjusts dynamically for individual-only, group-only, individual-first, or group-first.
 */
function getPhases(phaseConfig) {
  const {
    individualPhaseActive = true,
    groupPhaseActive = true,
    phaseOrder = 'individual_first',
  } = phaseConfig

  const phases = []

  if (individualPhaseActive && groupPhaseActive) {
    const indiv = {
      key: 'individual',
      title: 'Individual Ideation Phase',
      description: 'Work independently to come up with three potential product ideas.',
    }
    const group = {
      key: 'group',
      title: 'Group Ideation Phase',
      description: 'Join a group to share, discuss, and refine ideas together.',
    }

    if (phaseOrder === 'individual_first') {
      phases.push(indiv, group)
    } else {
      phases.push(group, indiv)
    }

    phases.push({
      key: 'voting',
      title: 'Final Selection',
      description: 'As a group, review all ideas and agree on the top 3 ideas.',
    })
  } else if (individualPhaseActive) {
    phases.push({
      key: 'individual',
      title: 'Individual Ideation Phase',
      description: 'Work independently to come up with potential product ideas.',
    })
  } else if (groupPhaseActive) {
    phases.push({
      key: 'group',
      title: 'Group Ideation Phase',
      description: 'Join a group to share, discuss, and refine ideas together.',
    })
    phases.push({
      key: 'voting',
      title: 'Final Selection',
      description: 'As a group, review all ideas and agree on the top ideas.',
    })
  }

  return phases
}