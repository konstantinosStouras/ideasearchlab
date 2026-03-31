const functions = require('firebase-functions').region('europe-west1')
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * autoGroupParticipants
 *
 * Firestore-triggered function. Fires whenever a participant document is updated.
 * When a participant's individualComplete flips to true, checks how many
 * unassigned completed participants exist. If 3 or more are ready, forms a group.
 *
 * Handles remainders:
 *   - 2 left: forms a group of 2
 *   - 1 left after session ends: moves them directly to survey
 *
 * Uses a Firestore transaction to prevent race conditions when multiple
 * participants complete at the same time.
 */
exports.autoGroupParticipants = functions.firestore
  .document('sessions/{sessionId}/participants/{participantId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()

    // Only act when individualComplete flips from false to true
    if (before.individualComplete === after.individualComplete) return
    if (!after.individualComplete) return
    if (after.groupId) return // already assigned

    const { sessionId } = context.params
    const sessionRef = db.collection('sessions').doc(sessionId)

    // Run inside a transaction to avoid race conditions
    await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef)
      if (!sessionSnap.exists) return

      const session = sessionSnap.data()

      // Only run rolling formation during individual_first flow
      if (
        !session.phaseConfig?.individualPhaseActive ||
        !session.phaseConfig?.groupPhaseActive ||
        session.phaseConfig?.phaseOrder !== 'individual_first'
      ) return

      const groupSize = session.phaseConfig?.groupSize ?? 3

      // Find all unassigned completed participants
      const readySnap = await tx.get(
        sessionRef.collection('participants')
          .where('individualComplete', '==', true)
          .where('groupId', '==', null)
      )

      const ready = readySnap.docs.map(d => ({ id: d.id, ...d.data() }))

      if (ready.length >= groupSize) {
        // Enough for a full group: take the first groupSize and form a group
        const toGroup = ready.slice(0, groupSize)
        await formGroup(tx, sessionRef, toGroup)

        // Mark the rest as waiting_for_group
        ready.slice(groupSize).forEach(p => {
          tx.update(sessionRef.collection('participants').doc(p.id), {
            status: 'waiting_for_group',
          })
        })
        return
      }

      // Fewer than groupSize are ready. Check if anyone is still working.
      const allSnap = await tx.get(sessionRef.collection('participants'))
      const anyStillWorking = allSnap.docs.some(d => {
        const p = d.data()
        return !p.individualComplete && !p.groupId
      })

      if (anyStillWorking) {
        // More participants still coming, keep everyone waiting
        ready.forEach(p => {
          tx.update(sessionRef.collection('participants').doc(p.id), {
            status: 'waiting_for_group',
          })
        })
        return
      }

      // Nobody left working. Handle remainders.
      if (ready.length === 1) {
        // Solo straggler goes directly to survey
        tx.update(sessionRef.collection('participants').doc(ready[0].id), {
          status: 'survey',
        })
      } else if (ready.length >= 2) {
        // Form a smaller group with whoever is left
        await formGroup(tx, sessionRef, ready)
      }
    })
  })


/**
 * Forms a group from the given participants.
 * Creates the group document and updates each participant.
 * Must be called inside a Firestore transaction.
 */
async function formGroup(tx, sessionRef, members) {
  const groupRef = sessionRef.collection('groups').doc()

  tx.set(groupRef, {
    members: members.map(m => m.id),
    status: 'active',
    finalIdeas: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  members.forEach(m => {
    tx.update(sessionRef.collection('participants').doc(m.id), {
      groupId: groupRef.id,
      status: 'group',
    })
  })
}


/**
 * handleStragglers
 *
 * HTTPS callable - instructor can trigger this manually to handle
 * any participants still in waiting_for_group at the end of the session.
 * 1 leftover -> send directly to survey
 * 2 leftovers -> form a group of 2
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

  const stragglersSnap = await sessionRef.collection('participants')
    .where('status', '==', 'waiting_for_group')
    .get()

  const stragglers = stragglersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const batch = db.batch()

  if (stragglers.length === 0) {
    return { handled: 0 }
  }

  // Pack stragglers into groups using the session's groupSize.
  // Any final solo leftover goes directly to survey.
  let i = 0
  while (i < stragglers.length) {
    const remaining = stragglers.length - i
    if (remaining === 1) {
      batch.update(
        sessionRef.collection('participants').doc(stragglers[i].id),
        { status: 'survey' }
      )
      i++
    } else {
      const size = Math.min(groupSize, remaining)
      const groupMembers = stragglers.slice(i, i + size)
      const groupRef = sessionRef.collection('groups').doc()
      batch.set(groupRef, {
        members: groupMembers.map(m => m.id),
        status: 'active',
        finalIdeas: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      groupMembers.forEach(m => {
        batch.update(sessionRef.collection('participants').doc(m.id), {
          groupId: groupRef.id,
          status: 'group',
        })
      })
      i += size
    }
  }

  await batch.commit()
  return { handled: stragglers.length }
})