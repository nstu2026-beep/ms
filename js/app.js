// ==========================================================================
// App entry point. Wires together auth, Firestore sync, and every view.
// Kept framework-free: plain DOM updates driven by Firestore's onSnapshot.
// ==========================================================================
import { auth, onAuthChange, login, signup, loginWithGoogle, resetPassword, logout, friendlyAuthError } from "./auth.js";
import {
  bootstrapNewUser, subscribeUser, updateSettings, updateMeta,
  subscribeSubjects, upsertSubject, deleteSubject, incrementSubjectCompleted,
  subscribeDay, setDay, subscribeAllDays, getDay
} from "./firestore.js";
import {
  dateKey, addDays, generateDailyTarget, carryOverFromDay, dayStatus,
  computeOverallProgress, computeHours, estimateFinishDate, computeStreaks, checkAchievements
} from "./planner.js";
import { drawBarChart, drawLineChart } from "./charts.js";
import { requestNotificationPermission, scheduleDailyReminders, notifyStreakMilestone } from "./notifications.js";
import { fireConfetti } from "./confetti.js";
import { ACHIEVEMENT_DEFS, APP_DEFAULTS } from "./config.js";

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  uid: null,
  userData: null,     // { profile, settings, meta }
  subjects: [],        // [{id, name, total, completed, durationHours}]
  daysMap: {},          // { 'YYYY-MM-DD': dayRecord }
  todayKey: dateKey(),
  calendarCursor: new Date(),
  unsubs: []
};

// ---------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ==========================================================================
// AUTH SCREEN
// ==========================================================================
const authForms = { login: $("#login-form"), signup: $("#signup-form"), reset: $("#reset-form") };
function showAuthForm(which) {
  Object.entries(authForms).forEach(([k, f]) => f.classList.toggle("hidden", k !== which));
  $("#auth-error").style.display = "none";
  const titles = {
    login: ["Welcome back", "Sign in to sync your mission across every device."],
    signup: ["Start your mission", "Create an account to begin tracking your study plan."],
    reset: ["Reset your password", "We'll email you a link to get back in."]
  };
  $("#auth-title").textContent = titles[which][0];
  $("#auth-subtitle").textContent = titles[which][1];
  $("#auth-switch").innerHTML = which === "login"
    ? `New here? <a class="link" id="show-signup">Create an account</a>`
    : `Already have an account? <a class="link" id="show-login">Sign in</a>`;
  wireAuthSwitchLinks();
}
function wireAuthSwitchLinks() {
  $("#show-signup")?.addEventListener("click", () => showAuthForm("signup"));
  $("#show-login")?.addEventListener("click", () => showAuthForm("login"));
}
wireAuthSwitchLinks();
$("#forgot-link").addEventListener("click", () => showAuthForm("reset"));

function authError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.style.display = "block";
}

authForms.login.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await login($("#login-email").value.trim(), $("#login-password").value, $("#remember-me").checked);
  } catch (err) { authError(friendlyAuthError(err)); }
});

authForms.signup.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await signup($("#signup-name").value.trim(), $("#signup-email").value.trim(), $("#signup-password").value);
  } catch (err) { authError(friendlyAuthError(err)); }
});

authForms.reset.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await resetPassword($("#reset-email").value.trim());
    toast("Reset link sent — check your inbox.");
    showAuthForm("login");
  } catch (err) { authError(friendlyAuthError(err)); }
});

$("#google-signin").addEventListener("click", async () => {
  try { await loginWithGoogle(); } catch (err) { authError(friendlyAuthError(err)); }
});

$("#signout-btn").addEventListener("click", () => logout());

// ==========================================================================
// AUTH STATE → APP BOOTSTRAP
// ==========================================================================
onAuthChange(async (user) => {
  detachAllListeners();
  if (!user) {
    $("#app").classList.remove("active");
    $("#auth-screen").classList.remove("hidden");
    return;
  }
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.add("active");
  state.uid = user.uid;

  await bootstrapNewUser(user.uid, { name: user.displayName, email: user.email });
  attachListeners(user.uid);
});

function detachAllListeners() {
  state.unsubs.forEach(u => u());
  state.unsubs = [];
}

function attachListeners(uid) {
  state.unsubs.push(subscribeUser(uid, (data) => {
    state.userData = data;
    applyTheme(data?.settings);
    renderSettingsForm(data?.settings);
    renderDashboardStats();
    renderAchievements();
    scheduleDailyReminders(data?.settings?.notifications, data?.settings?.schedule);
  }));

  state.unsubs.push(subscribeSubjects(uid, (subjects) => {
    state.subjects = subjects;
    renderSubjectEditList();
    renderSubjectProgress();
    renderDashboardStats();
    ensureTodayTarget();
    renderAnalytics();
  }));

  state.unsubs.push(subscribeAllDays(uid, (daysMap) => {
    state.daysMap = daysMap;
    renderCalendar();
    renderAnalytics();
    updateStreaksAndAchievements();
  }));

  state.unsubs.push(subscribeDay(uid, state.todayKey, (day) => {
    renderTodayView(day);
  }));
}

// ==========================================================================
// DAILY TARGET GENERATION — runs once per day, carries unfinished forward
// ==========================================================================
let targetGenerationInFlight = false;
async function ensureTodayTarget() {
  if (targetGenerationInFlight || !state.uid || state.subjects.length === 0) return;
  const existing = state.daysMap[state.todayKey];
  if (existing && existing.target) return; // already generated today

  targetGenerationInFlight = true;
  try {
    const yesterdayKey = dateKey(addDays(new Date(), -1));
    const yesterday = state.daysMap[yesterdayKey] || await getDay(state.uid, yesterdayKey);
    const carry = carryOverFromDay(yesterday);
    const dailyTarget = state.userData?.settings?.dailyClassTarget ?? APP_DEFAULTS.dailyClassTarget;
    const target = generateDailyTarget(state.subjects, dailyTarget, carry);
    await setDay(state.uid, state.todayKey, {
      date: state.todayKey,
      target,
      completed: existing?.completed || [],
      hours: 0,
      notes: existing?.notes || "",
      revision: existing?.revision || { revision: false, mcq: false, notes: false, weak: false }
    });
  } finally {
    targetGenerationInFlight = false;
  }
}

// ==========================================================================
// DASHBOARD — orbit ring, stats, today's classes, revision checklist
// ==========================================================================
function renderDashboardStats() {
  if (!state.subjects.length) return;
  const progress = computeOverallProgress(state.subjects);
  const hours = computeHours(state.subjects);
  const dailyTarget = state.userData?.settings?.dailyClassTarget ?? APP_DEFAULTS.dailyClassTarget;
  const finish = estimateFinishDate(progress.remainingClasses, dailyTarget);

  $("#stat-remaining").textContent = progress.remainingClasses;
  $("#stat-hours").textContent = `${Math.round(hours.remainingHours)}h`;
  $("#stat-finish").textContent = finish ? finish.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "🎉";
  $("#stat-streak").textContent = state.userData?.meta?.currentStreak ?? 0;

  const quotes = APP_DEFAULTS.quotes;
  $("#quote").textContent = quotes[new Date().getDate() % quotes.length];
}

function renderTodayView(day) {
  const target = day?.target || [];
  const completedList = day?.completed || [];
  const doneMap = {};
  completedList.forEach(c => { doneMap[c.subjectId] = (doneMap[c.subjectId] || 0) + c.count; });

  const targetTotal = target.reduce((s, t) => s + t.count, 0);
  const doneTotal = completedList.reduce((s, c) => s + c.count, 0);
  const pct = targetTotal > 0 ? Math.min(100, Math.round((doneTotal / targetTotal) * 100)) : 0;

  const circumference = 2 * Math.PI * 96;
  const ring = $("#orbit-progress");
  ring.setAttribute("stroke-dasharray", circumference);
  ring.setAttribute("stroke-dashoffset", circumference - (circumference * pct) / 100);
  $("#orbit-pct").textContent = `${pct}%`;

  const complete = targetTotal > 0 && doneTotal >= targetTotal;
  $("#goal-complete").classList.toggle("hidden", !complete);
  $("#goal-status").classList.toggle("hidden", complete);
  $("#goal-status").textContent = targetTotal === 0
    ? "All subjects complete — no target for today."
    : `${doneTotal} of ${targetTotal} classes done today`;

  // Today's classes list
  const list = $("#today-classes-list");
  list.innerHTML = "";
  if (target.length === 0) {
    list.innerHTML = `<p class="text-sm text-muted">Nothing scheduled — every subject is finished. 🎉</p>`;
  }
  target.forEach(t => {
    const done = doneMap[t.subjectId] || 0;
    const row = document.createElement("div");
    row.className = "check-item" + (done >= t.count ? " done" : "");
    row.innerHTML = `<span class="check-box">${done >= t.count ? "✓" : ""}</span><span>${t.name} — ${done}/${t.count} classes</span>`;
    row.addEventListener("click", () => toggleClassDone(t.subjectId, t.count, done));
    list.appendChild(row);
  });

  // Revision checklist
  const rev = day?.revision || { revision: false, mcq: false, notes: false, weak: false };
  const revLabels = { revision: "Revision", mcq: "MCQ Practice", notes: "Notes", weak: "Weak Topics" };
  const revList = $("#revision-list");
  revList.innerHTML = "";
  Object.entries(revLabels).forEach(([key, label]) => {
    const row = document.createElement("div");
    row.className = "check-item" + (rev[key] ? " done" : "");
    row.innerHTML = `<span class="check-box">${rev[key] ? "✓" : ""}</span><span>${label}</span>`;
    row.addEventListener("click", async () => {
      const next = { ...rev, [key]: !rev[key] };
      await setDay(state.uid, state.todayKey, { revision: next });
    });
    revList.appendChild(row);
  });
}

async function toggleClassDone(subjectId, targetCount, currentDone) {
  const day = state.daysMap[state.todayKey] || {};
  const completed = [...(day.completed || [])];
  const idx = completed.findIndex(c => c.subjectId === subjectId);
  const willComplete = currentDone < targetCount;
  const nextDone = willComplete ? currentDone + 1 : Math.max(0, currentDone - 1);

  if (idx >= 0) completed[idx] = { subjectId, count: nextDone };
  else completed.push({ subjectId, count: nextDone });

  const subject = state.subjects.find(s => s.id === subjectId);
  const hours = (subject?.durationHours || 2) * (willComplete ? 1 : -1);

  await setDay(state.uid, state.todayKey, {
    completed,
    hours: Math.max(0, (day.hours || 0) + hours)
  });
  await incrementSubjectCompleted(state.uid, subjectId, willComplete ? 1 : -1);

  const progress = computeOverallProgress(state.subjects);
  await updateMeta(state.uid, {
    totalCompleted: Math.max(0, (state.userData?.meta?.totalCompleted || 0) + (willComplete ? 1 : -1)),
    totalHours: Math.max(0, (state.userData?.meta?.totalHours || 0) + hours),
    lastActiveDate: state.todayKey
  });

  const target = day.target || [];
  const targetTotal = target.reduce((s, t) => s + t.count, 0);
  const doneTotal = completed.reduce((s, c) => s + c.count, 0);
  if (willComplete && targetTotal > 0 && doneTotal >= targetTotal) {
    toast("🎉 Daily goal completed!");
    fireConfetti();
  }
}

// ==========================================================================
// SUBJECT PROGRESS (dashboard, read-only bars)
// ==========================================================================
const SUBJECT_COLORS = ["#4C5FD5", "#2DD4BF", "#E8A33D", "#E5647A", "#7C8CE8", "#4CA5E8", "#9C7CE8"];
function renderSubjectProgress() {
  const el = $("#subject-progress-list");
  el.innerHTML = "";
  state.subjects.forEach((s, i) => {
    const pct = s.total > 0 ? Math.min(100, Math.round((s.completed / s.total) * 100)) : 0;
    const color = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
    const row = document.createElement("div");
    row.className = "subject-row";
    row.innerHTML = `
      <span class="subject-dot" style="background:${color}"></span>
      <span class="subject-name">${s.name}</span>
      <div class="subject-bar-track"><div class="subject-bar-fill" style="width:${pct}%; background:${color}"></div></div>
      <span class="subject-meta">${s.completed}/${s.total}</span>`;
    el.appendChild(row);
  });
}

// ==========================================================================
// SETTINGS — subjects CRUD, daily target, theme, accent, notifications, schedule
// ==========================================================================
function renderSettingsForm(settings) {
  if (!settings) return;
  $("#setting-daily-target").value = settings.dailyClassTarget ?? APP_DEFAULTS.dailyClassTarget;
  $("#setting-class-duration").value = settings.classDurationHours ?? APP_DEFAULTS.classDurationHours;
  $("#setting-theme").value = settings.theme || "dark";
  $$(".swatch").forEach(sw => sw.classList.toggle("active", sw.dataset.accent === (settings.accent || "#4C5FD5")));
  document.documentElement.style.setProperty("--indigo", settings.accent || "#4C5FD5");

  $$(".switch[data-key]").forEach(sw => {
    const key = sw.dataset.key;
    sw.classList.toggle("on", !!settings.notifications?.[key]);
  });

  renderScheduleEditList(settings.schedule || APP_DEFAULTS.schedule);
}

$("#setting-daily-target").addEventListener("change", (e) => {
  updateSettings(state.uid, { dailyClassTarget: Math.max(1, parseInt(e.target.value, 10) || 1) });
});
$("#setting-class-duration").addEventListener("change", (e) => {
  updateSettings(state.uid, { classDurationHours: Math.max(0.5, parseFloat(e.target.value) || 2) });
});
$("#setting-theme").addEventListener("change", (e) => updateSettings(state.uid, { theme: e.target.value }));

$("#accent-swatches").addEventListener("click", (e) => {
  const sw = e.target.closest(".swatch");
  if (!sw) return;
  updateSettings(state.uid, { accent: sw.dataset.accent });
});

$$(".switch[data-key]").forEach(sw => {
  sw.addEventListener("click", () => {
    const key = sw.dataset.key;
    const current = state.userData?.settings?.notifications || {};
    updateSettings(state.uid, { notifications: { ...current, [key]: !current[key] } });
  });
});

$("#enable-notifs-btn").addEventListener("click", async () => {
  const perm = await requestNotificationPermission();
  toast(perm === "granted" ? "Notifications enabled" : "Notifications not enabled");
});

$("#edit-target-btn").addEventListener("click", () => switchView("settings"));

function applyTheme(settings) {
  const theme = settings?.theme || "dark";
  document.body.dataset.theme = theme;
  $("#theme-toggle").textContent = theme === "dark" ? "🌙" : "☀️";
  if (settings?.accent) document.documentElement.style.setProperty("--indigo", settings.accent);
}
$("#theme-toggle").addEventListener("click", () => {
  const next = (state.userData?.settings?.theme || "dark") === "dark" ? "light" : "dark";
  updateSettings(state.uid, { theme: next });
});

// ---- Subject editing ----
function renderSubjectEditList() {
  const el = $("#subject-edit-list");
  el.innerHTML = "";
  state.subjects.forEach(s => {
    const row = document.createElement("div");
    row.className = "subject-edit-row";
    row.innerHTML = `
      <input type="text" value="${s.name}" data-field="name">
      <input type="number" min="0" value="${s.total}" data-field="total">
      <input type="number" min="0.5" step="0.5" value="${s.durationHours ?? 2}" data-field="durationHours">
      <button class="btn btn-ghost btn-sm" data-action="delete">✕</button>`;
    row.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("change", () => {
        const field = inp.dataset.field;
        const val = field === "name" ? inp.value.trim() : parseFloat(inp.value) || 0;
        upsertSubject(state.uid, s.id, { [field]: val });
      });
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (confirm(`Delete ${s.name}? This cannot be undone.`)) deleteSubject(state.uid, s.id);
    });
    el.appendChild(row);
  });
}

$("#add-subject-btn").addEventListener("click", () => {
  const name = prompt("Subject name?");
  if (!name) return;
  const total = parseInt(prompt("Total classes?", "10"), 10) || 10;
  const id = name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36);
  upsertSubject(state.uid, id, {
    name, total, completed: 0,
    durationHours: state.userData?.settings?.classDurationHours ?? 2,
    order: state.subjects.length
  });
});

// ---- Schedule editing ----
function renderScheduleEditList(schedule) {
  const el = $("#schedule-edit-list");
  el.innerHTML = "";
  schedule.forEach((block, i) => {
    const row = document.createElement("div");
    row.className = "subject-edit-row";
    row.style.gridTemplateColumns = "1fr 1fr auto";
    row.innerHTML = `
      <input type="text" value="${block.time}" data-field="time" ${block.locked ? "disabled" : ""}>
      <input type="text" value="${block.label}" data-field="label" ${block.locked ? "disabled" : ""}>
      <span class="text-sm text-muted">${block.locked ? "🔒 Locked" : ""}</span>`;
    row.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("change", () => {
        const next = [...schedule];
        next[i] = { ...next[i], [inp.dataset.field]: inp.value };
        updateSettings(state.uid, { schedule: next });
      });
    });
    el.appendChild(row);
  });
}

// ---- Export ----
$("#export-btn").addEventListener("click", () => {
  const data = { user: state.userData, subjects: state.subjects, days: state.daysMap };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `study-mission-backup-${state.todayKey}.json`;
  a.click();
});

// ==========================================================================
// CALENDAR
// ==========================================================================
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function renderCalendar() {
  const cursor = state.calendarCursor;
  $("#cal-month-label").textContent = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const dowRow = $("#cal-dow-row");
  if (!dowRow.childElementCount) DOW.forEach(d => {
    const el = document.createElement("div"); el.className = "cal-dow"; el.textContent = d; dowRow.appendChild(el);
  });

  const grid = $("#cal-grid");
  grid.innerHTML = "";
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDow; i++) {
    const cell = document.createElement("div"); cell.className = "cal-day empty"; grid.appendChild(cell);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(new Date(year, month, d));
    const record = state.daysMap[key];
    const status = dayStatus(record);
    const cell = document.createElement("div");
    cell.className = "cal-day" + (status === "completed" ? " completed" : status === "partial" ? " partial" : status === "missed" ? " missed" : "");
    if (key === state.todayKey) cell.classList.add("today");
    cell.textContent = d;
    cell.addEventListener("click", () => showDayDetail(key, record));
    grid.appendChild(cell);
  }
}
$("#cal-prev").addEventListener("click", () => { state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() - 1, 1); renderCalendar(); });
$("#cal-next").addEventListener("click", () => { state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + 1, 1); renderCalendar(); });

function showDayDetail(key, record) {
  const card = $("#day-detail-card");
  const body = $("#day-detail-body");
  card.classList.remove("hidden");
  if (!record || !record.target) {
    body.innerHTML = `<p class="text-sm text-muted">No data for ${key}.</p>`;
    return;
  }
  const doneMap = {};
  (record.completed || []).forEach(c => { doneMap[c.subjectId] = c.count; });
  const rows = record.target.map(t => `<div class="subject-row"><span class="subject-name">${t.name}</span><span class="subject-meta">${doneMap[t.subjectId] || 0}/${t.count}</span></div>`).join("");
  body.innerHTML = `
    <p class="text-sm text-muted mt-1">${key} · ${(record.hours || 0).toFixed(1)}h studied</p>
    ${rows}
    ${record.notes ? `<p class="text-sm mt-1">📝 ${record.notes}</p>` : ""}`;
}

// ==========================================================================
// ANALYTICS
// ==========================================================================
function renderAnalytics() {
  const keys = Object.keys(state.daysMap).sort();
  const last7 = keys.slice(-7);
  const last30 = keys.slice(-30);

  drawBarChart($("#chart-weekly"), last7.map(k => k.slice(5)), last7.map(k => (state.daysMap[k].completed || []).reduce((s, c) => s + c.count, 0)));
  drawLineChart($("#chart-monthly"), last30.map(k => k.slice(8)), last30.map(k => (state.daysMap[k].completed || []).reduce((s, c) => s + c.count, 0)));

  if (state.subjects.length) {
    drawBarChart($("#chart-subjects"), state.subjects.map(s => s.name.slice(0, 4)), state.subjects.map(s => s.total ? Math.round((s.completed / s.total) * 100) : 0), { max: 100 });
  }

  // Streak growth: cumulative "counted" days over the last 30
  let running = 0;
  const streakSeries = last30.map(k => {
    const st = dayStatus(state.daysMap[k]);
    if (st === "completed" || st === "partial") running += 1; else if (st === "missed") running = 0;
    return running;
  });
  drawLineChart($("#chart-streak"), last30.map(k => k.slice(8)), streakSeries);
}

// ==========================================================================
// STREAKS + ACHIEVEMENTS
// ==========================================================================
let lastKnownStreak = 0;
async function updateStreaksAndAchievements() {
  if (!state.uid) return;
  const { currentStreak, longestStreak, missedDays } = computeStreaks(state.daysMap);
  const meta = state.userData?.meta || {};
  if (currentStreak !== meta.currentStreak || longestStreak !== meta.longestStreak || missedDays !== meta.missedDays) {
    await updateMeta(state.uid, { currentStreak, longestStreak, missedDays });
  }
  if (currentStreak > lastKnownStreak) notifyStreakMilestone(currentStreak);
  lastKnownStreak = currentStreak;
  renderAchievements();
}

function renderAchievements() {
  if (!state.userData) return;
  const progress = computeOverallProgress(state.subjects);
  const hours = computeHours(state.subjects);
  const meta = state.userData.meta || {};
  const stats = {
    totalCompleted: meta.totalCompleted || 0,
    totalHours: hours.completedHours,
    currentStreak: meta.currentStreak || 0,
    longestStreak: meta.longestStreak || 0,
    anySubjectComplete: state.subjects.some(s => s.total > 0 && s.completed >= s.total),
    allSubjectsComplete: state.subjects.length > 0 && state.subjects.every(s => s.completed >= s.total)
  };
  const unlocked = meta.achievements || [];
  const newly = checkAchievements(stats, unlocked);
  if (newly.length && state.uid) {
    updateMeta(state.uid, { achievements: [...unlocked, ...newly] });
    newly.forEach(id => {
      const def = ACHIEVEMENT_DEFS.find(a => a.id === id);
      if (def) { toast(`🏆 Achievement unlocked: ${def.name}`); fireConfetti(); }
    });
  }

  const grid = $("#badge-grid");
  grid.innerHTML = "";
  const finalUnlocked = new Set([...unlocked, ...newly]);
  ACHIEVEMENT_DEFS.forEach(def => {
    const el = document.createElement("div");
    el.className = "badge" + (finalUnlocked.has(def.id) ? "" : " locked");
    el.innerHTML = `<div class="badge-icon">${def.icon}</div><div class="badge-name">${def.name}</div>`;
    grid.appendChild(el);
  });
}

// ==========================================================================
// VIEW ROUTING
// ==========================================================================
function switchView(name) {
  $$(".view").forEach(v => v.classList.toggle("hidden", v.id !== `view-${name}`));
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  if (name === "analytics") renderAnalytics();
  if (name === "calendar") renderCalendar();
}
$$(".nav-item").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

// ==========================================================================
// CLOCK + OFFLINE BANNER
// ==========================================================================
function tickClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  $("#today-label").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  // Roll over to a new day without requiring a page refresh.
  const key = dateKey(now);
  if (key !== state.todayKey) {
    state.todayKey = key;
    if (state.uid) {
      state.unsubs.push(subscribeDay(state.uid, key, renderTodayView));
      ensureTodayTarget();
    }
  }
}
setInterval(tickClock, 15000);
tickClock();

function updateOfflineBanner() {
  $("#offline-banner").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);
updateOfflineBanner();

// ==========================================================================
// SERVICE WORKER REGISTRATION (PWA)
// ==========================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
