// ==========================================================================
// Firestore data layer.
// All reads/writes for the signed-in user live under users/{uid}.
// Firestore's built-in offline cache (enabled below) queues writes made
// while offline and replays them automatically on reconnect, so this file
// never has to hand-roll its own sync queue.
// ==========================================================================
import {
  getFirestore, doc, collection, setDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, serverTimestamp, enableIndexedDbPersistence, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseApp } from "./auth.js";
import { APP_DEFAULTS } from "./config.js";

export const db = getFirestore(firebaseApp);

// Enable offline persistence once. Fails silently in unsupported contexts
// (e.g. multiple tabs) — the app still works, just without offline cache.
enableIndexedDbPersistence(db).catch(() => {});

const userDoc = (uid) => doc(db, "users", uid);
const subjectsCol = (uid) => collection(db, "users", uid, "subjects");
const subjectDoc = (uid, id) => doc(db, "users", uid, "subjects", id);
const daysCol = (uid) => collection(db, "users", uid, "days");
const dayDoc = (uid, dateKey) => doc(db, "users", uid, "days", dateKey);

/** Create the default document tree for a brand-new user. */
export async function bootstrapNewUser(uid, profile) {
  const existing = await getDoc(userDoc(uid));
  if (existing.exists()) return;

  await setDoc(userDoc(uid), {
    profile: { name: profile.name || "", email: profile.email || "", createdAt: serverTimestamp() },
    settings: {
      dailyClassTarget: APP_DEFAULTS.dailyClassTarget,
      classDurationHours: APP_DEFAULTS.classDurationHours,
      theme: "dark",
      accent: "#4C5FD5",
      notifications: { study: true, revision: true, goal: true, streak: true, summary: true },
      schedule: APP_DEFAULTS.schedule
    },
    meta: {
      currentStreak: 0, longestStreak: 0, missedDays: 0,
      perfectWeeks: 0, perfectMonths: 0, lastActiveDate: null,
      totalCompleted: 0, totalHours: 0, achievements: []
    }
  });

  const batch = writeBatch(db);
  APP_DEFAULTS.subjects.forEach((s, i) => {
    const id = s.name.toLowerCase().replace(/\s+/g, "-");
    batch.set(subjectDoc(uid, id), {
      name: s.name, total: s.total, completed: 0,
      durationHours: APP_DEFAULTS.classDurationHours, order: i
    });
  });
  await batch.commit();
}

/** Subscribe to the user's root document (profile + settings + meta). */
export function subscribeUser(uid, cb) {
  return onSnapshot(userDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null));
}

export function updateSettings(uid, partial) {
  return updateDoc(userDoc(uid), Object.fromEntries(
    Object.entries(partial).map(([k, v]) => [`settings.${k}`, v])
  ));
}

export function updateMeta(uid, partial) {
  return updateDoc(userDoc(uid), Object.fromEntries(
    Object.entries(partial).map(([k, v]) => [`meta.${k}`, v])
  ));
}

/** Subscribe to the subjects subcollection. */
export function subscribeSubjects(uid, cb) {
  return onSnapshot(subjectsCol(uid), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    cb(list);
  });
}

export function upsertSubject(uid, id, data) {
  return setDoc(subjectDoc(uid, id), data, { merge: true });
}
export function deleteSubject(uid, id) {
  return deleteDoc(subjectDoc(uid, id));
}
export function incrementSubjectCompleted(uid, id, delta, durationHours) {
  return getDoc(subjectDoc(uid, id)).then(snap => {
    const cur = snap.data();
    const next = Math.max(0, Math.min(cur.total, (cur.completed || 0) + delta));
    return updateDoc(subjectDoc(uid, id), { completed: next });
  });
}

/** Subscribe to a single day's record (target + progress + notes). */
export function subscribeDay(uid, dateKey, cb) {
  return onSnapshot(dayDoc(uid, dateKey), (snap) => cb(snap.exists() ? snap.data() : null));
}

export function getDay(uid, dateKey) {
  return getDoc(dayDoc(uid, dateKey)).then(s => s.exists() ? s.data() : null);
}

export function setDay(uid, dateKey, data) {
  return setDoc(dayDoc(uid, dateKey), data, { merge: true });
}

/** Fetch all day records between two YYYY-MM-DD keys (client-side filter — small dataset). */
export function subscribeAllDays(uid, cb) {
  return onSnapshot(daysCol(uid), (snap) => {
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    cb(map);
  });
}
