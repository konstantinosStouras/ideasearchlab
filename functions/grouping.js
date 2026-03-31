const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * autoGroupParticipants
 *
 * Firestore-triggered. Fires when a participant document is updated.
 * Handles the individual_first rolling transition: when all members of a group
 * complete the individual phase, move that group to the group phase.
 * Also auto-advances the session status when all groups are in group phase.
 */
exports.autoGroupParticipants = functions.firestore
  .document('sessions/{sessionId}/participants/{participantId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()

    // Only act when individualComplete flips from false to true
    if (before.individualComplete === after.individualComplete) return
    if (!after.individualComplete) return

    const groupId = after.groupId
    if (!groupId) return // not in a group yet (still waiting in lobby)

    const { sessionId } = context.params
    const sessionRef = db.collection('sessions').doc(sessionId)

    // Query group members OUTSIDE transaction (transactions don't support queries)
    const sessionSnap = await sessionRef.get()
    if (!sessionSnap.exists) return

    const session = sessionSnap.data()

    // Only run during individual_first flow
    if (
      !session.phaseConfig?.individualPhaseActive ||
      !session.phaseConfig?.groupPhaseActive ||
      session.phaseConfig?.phaseOrder !== 'individual_first'
    ) return

    // Get all members of this participant's group
    const groupMembersSnap = await sessionRef.collection('participants')
      .where('groupId', '==', groupId)
      .get()

    const members = groupMembersSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // Check if ALL members of this group have completed individual phase
    const allGroupDone = members.every(m => {
      if (m.id === change.after.id) return true // this one just flipped
      return m.individualComplete
    })

    if (!allGroupDone) {
      // Not all group members done yet - mark as waiting_for_group
      await change.after.ref.update({ status: 'waiting_for_group' })
      return
    }

    // All group members done - move them all to group phase using a batch
    const batch = db.batch()
    const groupMemberIds = members.map(m => m.id)

    members.forEach(m => {
      batch.update(sessionRef.collection('participants').doc(m.id), {
        status: 'group',
      })
    })

    // Check if ALL participants in the session are now resolved.
    // Account for all members of THIS group (they are about to be moved
    // to 'group' in this batch but Firestore hasn't committed yet).
    const allParticipantsSnap = await sessionRef.collection('participants').get()
    const allSessionDone = allParticipantsSnap.docs.every(d => {
      if (groupMemberIds.includes(d.id)) return true // being moved to group in this batch
      const p = d.data()
      return ['group', 'voting', 'survey', 'done'].includes(p.status)
    })

    if (allSessionDone && session.status === 'individual') {
      batch.update(sessionRef, {
        status: 'group',
        phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }

    await batch.commit()
  })


/**
 * handleStragglers
 *
 * HTTPS callable - instructor can trigger this manually to handle
 * any participants still waiting in the lobby (not enough joined to fill a group).
 * Forms undersized groups or sends solo participants to survey.
 */
exports.handleStragglers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId } = data
  if (!sessionId) throw new functions.https.HttpsError('invalid-argument', 'sessionId required.')

  const sessionRef = db.collection('sessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')

  const session = sessionSnap.data()
  if (session.instructorId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the instructor can do this.')
  }

  const groupSize = session.phaseConfig?.groupSize ?? 3
  const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'
  const individualActive = session.phaseConfig?.individualPhaseActive ?? true
  const firstPhase = (individualActive && phaseOrder === 'individual_first') ? 'individual' : 'group'

  const waitingSnap = await sessionRef.collection('participants')
    .where('status', '==', 'waiting')
    .get()

  const waiting = waitingSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const batch = db.batch()

  if (waiting.length === 0) return { handled: 0 }

  if (waiting.length === 1) {
    batch.update(
      sessionRef.collection('participants').doc(waiting[0].id),
      { status: 'survey' }
    )
  } else {
    // Form an undersized group with whoever is left
    const shuffled = [...waiting].sort(() => Math.random() - 0.5)
    const groupRef = sessionRef.collection('groups').doc()
    const memberLabels = {}
    shuffled.forEach((p, i) => { memberLabels[p.id] = `p${i + 1}` })

    batch.set(groupRef, {
      members: shuffled.map(p => p.id),
      memberLabels,
      status: 'active',
      finalIdeas: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    shuffled.forEach(p => {
      batch.update(sessionRef.collection('participants').doc(p.id), {
        groupId: groupRef.id,
        status: firstPhase,
        anonymousLabel: memberLabels[p.id],
      })
    })
  }

  await batch.commit()
  return { handled: waiting.length }
})