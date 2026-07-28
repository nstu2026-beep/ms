// ==========================================================================
// Firebase project configuration.
// Replace every value below with the config object from:
// Firebase Console → Project settings → General → Your apps → SDK setup.
// See README.md for the full step-by-step setup guide.
// ==========================================================================

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Default app configuration — safe to tweak without touching logic files.
export const APP_DEFAULTS = {
  dailyClassTarget: 4,
  classDurationHours: 2,
  subjects: [
    { name: "Bangla", total: 22 },
    { name: "English", total: 18 },
    { name: "Accounting", total: 17 },
    { name: "Management", total: 11 },
    { name: "Math", total: 14 },
    { name: "Analytical", total: 6 }
  ],
  schedule: [
    { time: "6:00 AM", label: "Wake Up", locked: false },
    { time: "6:30–8:30", label: "Study", locked: false },
    { time: "9:00–11:00", label: "Study", locked: false },
    { time: "11:30–1:30", label: "Study", locked: false },
    { time: "1:30–2:30", label: "Lunch", locked: false },
    { time: "2:30–4:30", label: "Study", locked: false },
    { time: "4:45–9:00", label: "Tuition", locked: true },
    { time: "9:30–10:30", label: "Revision", locked: false },
    { time: "11:00", label: "Sleep", locked: false }
  ],
  quotes: [
    "Discipline is choosing between what you want now and what you want most.",
    "Small daily missions add up to a big result.",
    "Progress, not perfection.",
    "Every completed class is a step closer to the finish line.",
    "Consistency beats intensity.",
    "Your streak is proof you show up — keep going."
  ]
};

export const ACHIEVEMENT_DEFS = [
  { id: "first_class", name: "First Class", icon: "🎯", check: s => s.totalCompleted >= 1 },
  { id: "ten_classes", name: "10 Classes", icon: "🔟", check: s => s.totalCompleted >= 10 },
  { id: "twentyfive_classes", name: "25 Classes", icon: "🎖️", check: s => s.totalCompleted >= 25 },
  { id: "fifty_classes", name: "50 Classes", icon: "🏅", check: s => s.totalCompleted >= 50 },
  { id: "hundred_hours", name: "100 Hours", icon: "⏱️", check: s => s.totalHours >= 100 },
  { id: "week_streak", name: "7-Day Streak", icon: "🔥", check: s => s.currentStreak >= 7 || s.longestStreak >= 7 },
  { id: "month_streak", name: "30-Day Streak", icon: "🌟", check: s => s.longestStreak >= 30 },
  { id: "subject_done", name: "Subject Completed", icon: "📘", check: s => s.anySubjectComplete },
  { id: "all_done", name: "All Subjects Completed", icon: "👑", check: s => s.allSubjectsComplete }
];
