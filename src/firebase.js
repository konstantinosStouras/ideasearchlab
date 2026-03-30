import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: "AIzaSyAPaJwdXmJhn8WVQDxwFZx5N5kX2loL5zY",
  authDomain: "ideasearchlab.firebaseapp.com",
  projectId: "ideasearchlab",
  storageBucket: "ideasearchlab.firebasestorage.app",
  messagingSenderId: "368057681732",
  appId: "1:368057681732:web:35d8aba8d387abc364f911",
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'europe-west1')
