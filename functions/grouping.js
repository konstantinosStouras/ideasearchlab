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

      // Find all unassigned completed participants
      const readySnap = await tx.get(
        sessionRef.collection('participants')
          .where('individualComplete', '==', true)
          .where('groupId', '==', null)
      )

      const ready = readySnap.docs.map(d => ({ id: d.id, ...d.data() }))

      if (ready.length < 2) {
        // Only 1 ready, update their status to waiting_for_group
        tx.update(change.after.ref, { status: 'waiting_for_group' })
        return
      }

      if (ready.length === 2) {
        // Check: is the session phase about to end (all participants done)?
        const allSnap = await tx.get(sessionRef.collection('participants'))
        const allParticipants = allSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const totalUnassigned = allParticipants.filter(
          p => !p.groupId && p.id !== ready[0].id && p.id !== ready[1].id
        )

        const anyStillInIndividual = totalUnassigned.some(
          p => !p.individualComplete
        )

        if (anyStillInIndividual) {
          // More participants still working, keep waiting
          ready.forEach(p => {
            const ref = sessionRef.collection('participants').doc(p.id)
            tx.update(ref, { status: 'waiting_for_group' })
          })
          return
        }

        // No one left in individual phase: form a group of 2
        await formGroup(tx, sessionRef, ready)
        return
      }

      // 3+ ready: take the first 3 and form a group
      const toGroup = ready.slice(0, 3)
      await formGroup(tx, sessionRef, toGroup)

      // Mark the rest as waiting_for_group
      ready.slice(3).forEach(p => {
        tx.update(sessionRef.collection('participants').doc(p.id), {
          status: 'waiting_for_group',
        })
      })
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

  const stragglersSnap = await sessionRef.collection('participants')
    .where('status', '==', 'waiting_for_group')
    .get()

  const stragglers = stragglersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const batch = db.batch()

  if (stragglers.length === 0) {
    return { handled: 0 }
  }

  if (stragglers.length === 1) {
    batch.update(
      sessionRef.collection('participants').doc(stragglers[0].id),
      { status: 'survey' }
    )
  } else if (stragglers.length === 2) {
    const groupRef = sessionRef.collection('groups').doc()
    batch.set(groupRef, {
      members: stragglers.map(s => s.id),
      status: 'active',
      finalIdeas: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    stragglers.forEach(s => {
      batch.update(sessionRef.collection('participants').doc(s.id), {
        groupId: groupRef.id,
        status: 'group',
      })
    })
  } else {
    // More than 2: form as many groups of 3 as possible, recurse remainder
    // (shouldn't happen in normal flow but handle gracefully)
    let i = 0
    while (i < stragglers.length) {
      const remaining = stragglers.length - i
      const groupSize = remaining === 1 ? 1 : remaining === 2 ? 2 : 3
      const groupMembers = stragglers.slice(i, i + groupSize)

      if (groupSize === 1) {
        batch.update(
          sessionRef.collection('participants').doc(groupMembers[0].id),
          { status: 'survey' }
        )
      } else {
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
      }
      i += groupSize
    }
  }

  await batch.commit()
  return { handled: stragglers.length }
})
