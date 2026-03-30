const functions = require('firebase-functions')
const admin = require('firebase-admin')

admin.initializeApp()

// Export each module's functions
const session = require('./session')
const grouping = require('./grouping')
const ai = require('./ai')
const voting = require('./voting')

exports.joinSession = session.joinSession
exports.advancePhase = session.advancePhase

exports.autoGroupParticipants = grouping.autoGroupParticipants

exports.sendAIMessage = ai.sendAIMessage
exports.saveAISettings = ai.saveAISettings

exports.submitVote = voting.submitVote
