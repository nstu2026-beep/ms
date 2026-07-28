// ==========================================================================
// Pure planning logic. No Firebase calls here — this file only computes,
// so it can be unit-tested and reasoned about in isolation.
// ==========================================================================
import { ACHIEVEMENT_DEFS } from "./config.js";

/** Local YYYY-MM-DD key for a Date (never UTC, so "today" matches the device's clock). */
export function dateKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/**
 * Build today's target class list.
 * Rules: prioritize subjects with the highest remaining classes; carry
 * unfinished classes from yesterday's target on top of the fresh daily quota.
 */
export function generateDailyTarget(subjects, dailyClassTarget, carryOverCount = 0) {
  const remaining = subjects
    .map(s => ({ id: s.id, name: s.name, remaining: Math.max(0, s.total - s.completed) }))
    .filter(s => s.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  const need = dailyClassTarget + carryOverCount;
  const target = [];
  let idx = 0;
  let assigned = 0;
  while (assigned < need && remaining.some(s => s.remaining > 0)) {
    const s = remaining[idx % remaining.length];
    if (s.remaining > 0) {
      const existing = target.find(t => t.subjectId === s.id);
      if (existing) existing.count += 1; else target.push({ subjectId: s.id, name: s.name, count: 1 });
      s.remaining -= 1;
      assigned += 1;
    }
    idx += 1;
    if (idx > need * remaining.length + remaining.length) break; // safety valve
  }
  return target;
}

/** How many classes in `target` remain uncompleted, given a completed map { subjectId: count }. */
export function carryOverFromDay(dayRecord) {
  if (!dayRecord || !dayRecord.target) return 0;
  const doneMap = {};
  (dayRecord.completed || []).forEach(c => { doneMap[c.subjectId] = (doneMap[c.subjectId] || 0) + c.count; });
  let carry = 0;
  dayRecord.target.forEach(t => {
    const done = doneMap[t.subjectId] || 0;
    carry += Math.max(0, t.count - done);
  });
  return carry;
}

export function dayStatus(dayRecord) {
  if (!dayRecord || !dayRecord.target || dayRecord.target.length === 0) return "empty";
  const targetTotal = dayRecord.target.reduce((s, t) => s + t.count, 0);
  const doneTotal = (dayRecord.completed || []).reduce((s, c) => s + c.count, 0);
  if (doneTotal <= 0) return "missed";
  if (doneTotal >= targetTotal) return "completed";
  return "partial";
}

/** Aggregate overall progress across all subjects. */
export function computeOverallProgress(subjects) {
  const totalClasses = subjects.reduce((s, x) => s + x.total, 0);
  const completedClasses = subjects.reduce((s, x) => s + Math.min(x.completed, x.total), 0);
  const remainingClasses = Math.max(0, totalClasses - completedClasses);
  const pct = totalClasses > 0 ? Math.round((completedClasses / totalClasses) * 100) : 0;
  return { totalClasses, completedClasses, remainingClasses, pct };
}

export function computeHours(subjects) {
  const totalHours = subjects.reduce((s, x) => s + x.total * (x.durationHours || 2), 0);
  const completedHours = subjects.reduce((s, x) => s + Math.min(x.completed, x.total) * (x.durationHours || 2), 0);
  return { totalHours, completedHours, remainingHours: Math.max(0, totalHours - completedHours) };
}

/** Estimate a finish date assuming the current daily class target holds steady. */
export function estimateFinishDate(remainingClasses, dailyClassTarget) {
  if (remainingClasses <= 0) return null;
  if (dailyClassTarget <= 0) return null;
  const days = Math.ceil(remainingClasses / dailyClassTarget);
  return addDays(new Date(), days);
}

/**
 * Recompute streak counters from a map of { dateKey: dayRecord }.
 * A day "counts" if its status is completed or partial (user showed up);
 * a fully missed day (target existed, nothing done) breaks the streak.
 */
export function computeStreaks(daysMap) {
  const keys = Object.keys(daysMap).sort();
  let current = 0, longest = 0, missed = 0, running = 0;
  const today = dateKey();

  keys.forEach(k => {
    const status = dayStatus(daysMap[k]);
    if (status === "completed" || status === "partial") {
      running += 1;
      longest = Math.max(longest, running);
    } else if (status === "missed") {
      running = 0;
      missed += 1;
    }
    // "empty" days (no target generated, e.g. before signup) don't affect streak
  });

  // Current streak = trailing run ending today or yesterday (grace for "not yet logged today")
  let i = keys.length - 1;
  let trail = 0;
  while (i >= 0) {
    const status = dayStatus(daysMap[keys[i]]);
    if (status === "completed" || status === "partial") { trail += 1; i -= 1; }
    else if (keys[i] === today && status !== "missed") { i -= 1; } // today in progress, skip
    else break;
  }
  current = trail;

  return { currentStreak: current, longestStreak: longest, missedDays: missed };
}

/** Determine newly unlocked achievement ids given current stats and already-unlocked ids. */
export function checkAchievements(stats, alreadyUnlocked) {
  const unlocked = new Set(alreadyUnlocked || []);
  const newly = [];
  ACHIEVEMENT_DEFS.forEach(def => {
    if (!unlocked.has(def.id) && def.check(stats)) newly.push(def.id);
  });
  return newly;
}
