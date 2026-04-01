import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, collection, onSnapshot, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { getPhaseSequence } from '../utils/phaseSequence'
import * as XLSX from 'xlsx'
import styles from './AdminSession.module.css'

export default function AdminSession() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [participants, setParticipants] = useState([])
  const [advancing, setAdvancing] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), snap => {
      if (snap.exists()) setSession({ id: snap.id, ...snap.data() })
    })
    return unsub
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sessions', sessionId, 'participants'),
      snap => setParticipants(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [sessionId])

  async function advancePhase() {
    if (!session) return
    setAdvancing(true)
    try {
      await httpsCallable(functions, 'advancePhase')({ sessionId })
    } catch (err) {
      console.error('advancePhase error:', err)
    } finally {
      setAdvancing(false)
    }
  }

  // ── Data export ─────────────────────────────────────
  async function exportData() {
    if (exporting) return
    setExporting(true)
    try {
      // Fetch all data collections
      const [ideasSnap, groupsSnap] = await Promise.all([
        getDocs(collection(db, 'sessions', sessionId, 'ideas')),
        getDocs(collection(db, 'sessions', sessionId, 'groups')),
      ])

      const ideas = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const groups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Fetch chat messages from each group
      const chatMessages = []
      for (const group of groups) {
        const msgSnap = await getDocs(
          collection(db, 'sessions', sessionId, 'groups', group.id, 'messages')
        )
        msgSnap.docs.forEach(d => {
          const msg = d.data()
          chatMessages.push({
            groupId: group.id,
            messageId: d.id,
            ...msg,
          })
        })
      }

      // Build workbook
      const wb = XLSX.utils.book_new()

      // ── Sheet 1: Participants ──
      const participantRows = participants.map(p => {
        const demo = p.demographics || {}
        return {
          'Participant ID': p.id,
          'Name': p.name || '',
          'Email': p.email || '',
          'Anonymous Label': p.anonymousLabel || '',
          'Group ID': p.groupId || '',
          'Status': p.status || '',
          'Individual Complete': p.individualComplete ? 'Yes' : 'No',
          'Votes Submitted': p.votesSubmitted ? 'Yes' : 'No',
          'Voted For': (p.votedFor || []).join(', '),
          'Consent Given': p.consentGiven ? 'Yes' : 'No',
          'Consent Timestamp': p.consentTimestamp || '',
          'Joined At': formatTimestamp(p.joinedAt),
          'Age': demo.age || '',
          'Gender': demo.gender || '',
          'Nationality': demo.nationality || '',
          'Country': demo.country || '',
          'Level of Study': demo.levelOfStudy || '',
          'Work Experience': demo.workExperience ?? '',
          'Occupation': demo.occupation || '',
          'English Fluency': demo.englishFluency || '',
        }
      })
      const wsParticipants = XLSX.utils.json_to_sheet(participantRows)
      autoWidth(wsParticipants, participantRows)
      XLSX.utils.book_append_sheet(wb, wsParticipants, 'Participants')

      // ── Sheet 2: Ideas ──
      const ideaRows = ideas.map(idea => ({
        'Idea ID': idea.id,
        'Title': idea.title || '',
        'Description': idea.description || '',
        'Full Text': idea.text || '',
        'Author ID': idea.authorId || '',
        'Author Name': idea.authorName || '',
        'Phase': idea.phase || '',
        'Group ID': idea.groupId || '',
        'Selected': idea.selected ? 'Yes' : 'No',
        'Vote Count': countVotes(idea.id, participants),
        'Created At': formatTimestamp(idea.createdAt),
      }))
      const wsIdeas = XLSX.utils.json_to_sheet(ideaRows)
      autoWidth(wsIdeas, ideaRows)
      XLSX.utils.book_append_sheet(wb, wsIdeas, 'Ideas')

      // ── Sheet 3: Survey Answers ──
      const surveyParticipants = participants.filter(p => p.surveyAnswers)
      if (surveyParticipants.length > 0) {
        // Collect all question keys across all participants
        const allKeys = new Set()
        surveyParticipants.forEach(p => {
          Object.keys(p.surveyAnswers).forEach(k => allKeys.add(k))
        })
        const sortedKeys = [...allKeys].sort()

        const surveyRows = surveyParticipants.map(p => {
          const row = {
            'Participant ID': p.id,
            'Name': p.name || '',
            'Anonymous Label': p.anonymousLabel || '',
            'Completed At': p.surveyCompletedAt ? formatTimestamp(p.surveyCompletedAt) : '',
          }
          sortedKeys.forEach(key => {
            const val = p.surveyAnswers[key]
            // Handle nested objects (rating_group answers)
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              row[key] = Object.entries(val).map(([k, v]) => `${k}: ${v}`).join('; ')
            } else {
              row[key] = val ?? ''
            }
          })
          return row
        })
        const wsSurvey = XLSX.utils.json_to_sheet(surveyRows)
        autoWidth(wsSurvey, surveyRows)
        XLSX.utils.book_append_sheet(wb, wsSurvey, 'Survey')
      }

      // ── Sheet 4: Chat Messages ──
      if (chatMessages.length > 0) {
        const chatRows = chatMessages
          .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
          .map(msg => ({
            'Group ID': msg.groupId,
            'Author ID': msg.authorId || '',
            'Author Label': msg.authorLabel || '',
            'Message': msg.text || '',
            'Sent At': formatTimestamp(msg.createdAt),
          }))
        const wsChat = XLSX.utils.json_to_sheet(chatRows)
        autoWidth(wsChat, chatRows)
        XLSX.utils.book_append_sheet(wb, wsChat, 'Chat Messages')
      }

      // ── Sheet 5: Groups ──
      if (groups.length > 0) {
        const groupRows = groups.map(g => ({
          'Group ID': g.id,
          'Members': (g.members || []).join(', '),
          'Member Labels': g.memberLabels
            ? Object.entries(g.memberLabels).map(([uid, label]) => `${label}`).join(', ')
            : '',
          'Status': g.status || '',
          'Final Ideas': (g.finalIdeas || []).join(', '),
          'Created At': formatTimestamp(g.createdAt),
        }))
        const wsGroups = XLSX.utils.json_to_sheet(groupRows)
        autoWidth(wsGroups, groupRows)
        XLSX.utils.book_append_sheet(wb, wsGroups, 'Groups')
      }

      // Download
      const fileName = `session_${session.code || sessionId}_data.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (err) {
      console.error('Export error:', err)
      alert('Export failed. Check the console for details.')
    } finally {
      setExporting(false)
    }
  }

  // ── Helpers ─────────────────────────────────────────

  function formatTimestamp(ts) {
    if (!ts) return ''
    const seconds = ts.seconds || ts._seconds
    if (!seconds) return String(ts)
    return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
  }

  function countVotes(ideaId, participantList) {
    let count = 0
    participantList.forEach(p => {
      if ((p.votedFor || []).includes(ideaId)) count++
    })
    return count
  }

  /** Auto-fit column widths based on content */
  function autoWidth(ws, rows) {
    if (!rows.length) return
    const keys = Object.keys(rows[0])
    const widths = keys.map(key => {
      const maxContent = Math.max(
        key.length,
        ...rows.map(r => String(r[key] || '').length)
      )
      return { wch: Math.min(maxContent + 2, 50) }
    })
    ws['!cols'] = widths
  }

  if (!session) return <div className={styles.loading}>Loading...</div>

  const sequence = getPhaseSequence(session.phaseConfig)
  const currentIndex = sequence.indexOf(session.status)
  const nextPhase = sequence[currentIndex + 1]
  const isLast = !nextPhase || nextPhase === 'done'

  const byStatus = participants.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})

  function getAutoNote() {
    const status = session.status
    if (status === 'waiting') return 'Auto-advances when a group forms'
    if (status === 'individual') return 'Auto-advances when all groups complete'
    if (status === 'group') return session.phaseConfig?.groupPhaseDuration ? 'Auto-advances when ideation timer expires' : 'Auto-advances when participants complete'
    return null
  }

  function phaseLabel(phase) {
    if (phase === 'group') return 'group ideation'
    return phase
  }

  // Data summary counts
  const surveyCount = participants.filter(p => p.surveyAnswers).length
  const votedCount = participants.filter(p => p.votesSubmitted || (p.votedFor && p.votedFor.length > 0)).length

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/admin')}>{'\u2190'} Back</button>
          <span className={styles.wordmark}>Ideation Challenge</span>
          <span className={styles.slash}>/</span>
          <span className={styles.sessionCode}>{session.code}</span>
        </div>
        <span className={`${styles.statusBadge} ${styles['status_' + session.status]}`}>
          {phaseLabel(session.status)}
        </span>
      </header>

      <main className={styles.main}>

        {/* Phase timeline */}
        <div className={styles.timelineCard}>
          <div className={styles.timeline}>
            {sequence.map((phase, i) => (
              <div
                key={phase}
                className={[
                  styles.timelineStep,
                  i < currentIndex ? styles.done : '',
                  i === currentIndex ? styles.active : '',
                ].join(' ')}
              >
                <div className={styles.timelineDot} />
                <span className={styles.timelineLabel}>{phaseLabel(phase)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.grid}>
          {/* Participant breakdown */}
          <div className="card">
            <h2 className={styles.cardTitle}>Participants <span className={styles.cardCount}>({participants.length})</span></h2>
            {participants.length === 0 ? (
              <p className={styles.emptyNote}>No participants have joined yet.</p>
            ) : (
              <>
                <div className={styles.breakdown}>
                  {Object.entries(byStatus).map(([status, count]) => (
                    <div key={status} className={styles.breakdownRow}>
                      <span className={styles.breakdownStatus}>{status}</span>
                      <span className={styles.breakdownCount}>{count}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.participantList}>
                  {participants.map(p => (
                    <div key={p.id} className={styles.participantRow}>
                      <span>{p.name || p.anonymousLabel || p.id.slice(0, 6)}</span>
                      <span className={styles.pStatus}>{p.status}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Session config summary */}
          <div className="card">
            <h2 className={styles.cardTitle}>Session Config</h2>
            <div className={styles.configList}>
              <ConfigRow label="Individual Phase" value={session.phaseConfig?.individualPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Group Phase" value={session.phaseConfig?.groupPhaseActive ? 'On' : 'Off'} />
              <ConfigRow label="Phase Order" value={session.phaseConfig?.phaseOrder?.replace('_', ' ') || 'N/A'} />
              <ConfigRow label="Group size" value={session.phaseConfig?.groupSize ?? 'N/A'} />
              <ConfigRow label="Max ideas (individual)" value={session.phaseConfig?.maxIdeasIndividual ?? 'N/A'} />
              <ConfigRow label="Ideas carried to group" value={session.phaseConfig?.ideasCarriedToGroup ?? 'N/A'} />
              <ConfigRow label="Group phase timer" value={session.phaseConfig?.groupPhaseDuration ? `${Math.round(session.phaseConfig.groupPhaseDuration / 60)} min` : 'Manual'} />
              <ConfigRow label="AI (individual)" value={session.aiConfig?.individualAI ? 'On' : 'Off'} />
              <ConfigRow label="AI (group)" value={session.aiConfig?.groupAI ? 'On' : 'Off'} />
            </div>
          </div>
        </div>

        {/* Data & Export */}
        <div className={styles.exportCard}>
          <div className={styles.exportHeader}>
            <div>
              <h2 className={styles.cardTitle}>Data &amp; Export</h2>
              <p className={styles.exportSub}>
                Download all session data as an Excel file with separate sheets for
                participants, ideas, survey responses, chat messages, and groups.
              </p>
            </div>
            <button
              className={styles.exportBtn}
              onClick={exportData}
              disabled={exporting || participants.length === 0}
            >
              {exporting ? 'Exporting...' : 'Download Excel'}
            </button>
          </div>
          <div className={styles.exportStats}>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{participants.length}</span>
              <span className={styles.statLabel}>Participants</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{votedCount}</span>
              <span className={styles.statLabel}>Voted</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statNum}>{surveyCount}</span>
              <span className={styles.statLabel}>Surveys</span>
            </div>
          </div>
        </div>

        {/* Advance control */}
        {session.status !== 'done' && (
          <div className={styles.advanceBar}>
            <div className={styles.advanceInfo}>
              <span className={styles.advanceLabel}>Current phase:</span>
              <strong>{phaseLabel(session.status)}</strong>
              {nextPhase && (
                <>
                  <span className={styles.advanceArrow}>{'\u2192'}</span>
                  <span className={styles.advanceNext}>{phaseLabel(nextPhase)}</span>
                </>
              )}
            </div>
            <div className={styles.advanceRight}>
              {getAutoNote() && (
                <span className={styles.autoNote}>{getAutoNote()}</span>
              )}
              <button
                className="btn-primary"
                onClick={advancePhase}
                disabled={advancing || isLast}
              >
                {advancing ? 'Advancing...' : isLast ? 'Session Complete' : `Force advance \u2192 ${phaseLabel(nextPhase)}`}
              </button>
            </div>
          </div>
        )}

        {session.status === 'done' && (
          <div className={styles.doneBar}>Session complete. All participants have finished.</div>
        )}
      </main>
    </div>
  )
}

function ConfigRow({ label, value }) {
  return (
    <div className={styles.configRow}>
      <span className={styles.configLabel}>{label}</span>
      <strong className={styles.configValue}>{String(value)}</strong>
    </div>
  )
}