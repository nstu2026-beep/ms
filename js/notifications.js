// ==========================================================================
// Browser Notifications API wrapper. Everything here degrades gracefully
// when the user hasn't granted permission — it never throws.
// ==========================================================================

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return Notification.permission === "denied" ? "denied" : await Notification.requestPermission();
}

export function notify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "icons/icon-192.png" });
  } catch (_) { /* no-op — some browsers require a service-worker registration */ }
}

/**
 * Schedule the day's local reminders (study block start, revision time,
 * end-of-day goal check, and a summary). Uses setTimeout, so reminders
 * reset naturally on each page load — good enough for a PWA without
 * push infrastructure.
 */
export function scheduleDailyReminders(settingsNotifications, scheduleBlocks) {
  clearScheduledReminders();
  if (!settingsNotifications) return;
  const now = new Date();

  const fireAt = (timeLabel, cb) => {
    const parsed = parseTimeLabel(timeLabel);
    if (!parsed) return;
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.h, parsed.m, 0, 0);
    const ms = target.getTime() - now.getTime();
    if (ms <= 0) return;
    const id = setTimeout(cb, ms);
    window.__missionTimers.push(id);
  };

  window.__missionTimers = window.__missionTimers || [];

  if (settingsNotifications.study) {
    (scheduleBlocks || []).filter(b => b.label === "Study").forEach(b => {
      fireAt(b.time, () => notify("Study block starting", `Time to focus: ${b.time}`, "study"));
    });
  }
  if (settingsNotifications.revision) {
    const revisionBlock = (scheduleBlocks || []).find(b => b.label === "Revision");
    if (revisionBlock) fireAt(revisionBlock.time, () => notify("Revision time", "Run through today's checklist.", "revision"));
  }
  if (settingsNotifications.goal) {
    fireAt("9:00 PM", () => notify("Goal check", "How's today's mission looking?", "goal"));
  }
  if (settingsNotifications.summary) {
    fireAt("10:30 PM", () => notify("Daily summary", "See how today went in Study Mission.", "summary"));
  }
}

export function clearScheduledReminders() {
  (window.__missionTimers || []).forEach(id => clearTimeout(id));
  window.__missionTimers = [];
}

export function notifyStreakMilestone(streak) {
  if ([3, 7, 14, 30, 60, 100].includes(streak)) {
    notify("Streak milestone 🔥", `You're on a ${streak}-day streak. Keep it alive!`, "streak");
  }
}

function parseTimeLabel(label) {
  // Accepts "6:00 AM", "6:30–8:30" (uses the start), "11:00"
  const first = label.split(/[–-]/)[0].trim();
  const m = first.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, m: min };
}
