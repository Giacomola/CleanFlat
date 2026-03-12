/* ═══════════════════════════════════════════
   FlatClean — Cleaning Rotation App (v4)
   Login, assignment, subtasks, history,
   edit tasks, rotation preview
   ═══════════════════════════════════════════ */

(function () {
  "use strict";

  // ─── API base ────────────────────────────
  // Prefer explicit ?api=<url> in the query string,
  // then sensible defaults for local development.
  var API = (function () {
    try {
      var search = (typeof window !== "undefined" && window.location && window.location.search) || "";
      var params = new URLSearchParams(search);
      var apiParam = params.get("api");
      if (apiParam) {
        return apiParam.replace(/\/$/, "");
      }

      if (typeof window !== "undefined" && window.location) {
        var loc = window.location;
        var hostname = loc.hostname || "localhost";

        if (hostname === "localhost" || hostname === "127.0.0.1") {
          return loc.protocol + "//" + hostname + ":8000";
        }

        if (loc.origin && loc.origin !== "null") {
          return loc.origin.replace(/\/$/, "");
        }
      }
    } catch (e) {
      // fall through to hard-coded default
    }

    // Fallback: local FastAPI dev server
    return "http://localhost:8000";
  })();

  // ─── State ───────────────────────────────
  var currentWeekOffset = 0;
  var flatmates = [];
  var tasks = [];
  var currentUser = null; // { id, name }
  var historyOffset = 0;
  var historyHasMore = false;
  var STORAGE_KEY_USER = "flatclean_current_user";

  // ─── Helpers ─────────────────────────────
  var AVATAR_COLORS = [
    "var(--avatar-1)", "var(--avatar-2)", "var(--avatar-3)", "var(--avatar-4)",
    "var(--avatar-5)", "var(--avatar-6)", "var(--avatar-7)", "var(--avatar-8)"
  ];

  function avatarHTML(name, index, size) {
    var initials = name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2);
    var color = AVATAR_COLORS[index % AVATAR_COLORS.length];
    var s = size ? ' style="background:' + color + ";width:" + size + "px;height:" + size + 'px;font-size:' + Math.round(size * 0.35) + 'px"' : ' style="background:' + color + '"';
    return '<div class="avatar"' + s + ">" + esc(initials) + "</div>";
  }

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function fmIndex(id) {
    var idx = flatmates.findIndex(function (f) { return f.id === id; });
    return idx >= 0 ? idx : 0;
  }

  var EMOJIS = ["🧹", "🚿", "🍳", "🗑️", "🧽", "🪣", "🧺", "🪟", "🚽", "🛁", "🧴", "🪥"];

  function intervalLabel(days) {
    if (days === 1) return "Every day";
    if (days === 7) return "Every week";
    if (days === 14) return "Every 2 weeks";
    if (days === 30) return "Every month";
    return "Every " + days + " days";
  }

  function timeAgo(ts) {
    var diff = (Date.now() / 1000) - ts;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    var d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function actionIcon(action) {
    switch (action) {
    case "task_completed":
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>';
    case "task_uncompleted":
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2.5" stroke-linecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
    case "task_created":
    case "task_edited":
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    case "task_deleted":
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>';
    case "person_added":
    case "person_removed":
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
    case "scores_reset":
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2.5" stroke-linecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
    default:
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    }
  }

  // Lightweight toast for errors / info (top of screen)
  function showToast(message, type) {
    try {
      var el = document.getElementById("toast");
      if (!el) return;
      el.textContent = message;
      el.className = "toast"; // reset
      if (type === "error") el.classList.add("toast-error");
      if (type === "success") el.classList.add("toast-success");
      el.classList.add("toast-visible");
      setTimeout(function () {
        el.classList.remove("toast-visible");
      }, 3500);
    } catch (e) {
      // ignore
    }
  }

  function persistCurrentUser() {
    try {
      if (currentUser && currentUser.id) {
        window.localStorage.setItem(STORAGE_KEY_USER, currentUser.id);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_USER);
      }
    } catch (e) {
      // ignore
    }
  }

  function getStoredUserId() {
    try {
      return window.localStorage.getItem(STORAGE_KEY_USER) || null;
    } catch (e) {
      return null;
    }
  }

  // ─── API calls ───────────────────────────
  function apiFetch(path, opts) {
    opts = opts || {};
    var url = API + path;
    return fetch(url, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () {
            throw new Error("Error " + res.status);
          }).then(function (e) {
            throw new Error(e.detail || "Error " + res.status);
          });
        }
        return res.json();
      })
      .catch(function (err) {
        showToast(err && err.message ? err.message : "Network error", "error");
        throw err;
      });
  }

  // ─── Theme toggle ───────────────────────
  (function () {
    var toggle = document.querySelector("[data-theme-toggle]");
    var root = document.documentElement;
    var currentTheme = matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", currentTheme);

    function updateIcon() {
      if (!toggle) return;
      toggle.innerHTML = currentTheme === "dark"
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      toggle.setAttribute("aria-label", "Switch to " + (currentTheme === "dark" ? "light" : "dark") + " mode");
    }

    updateIcon();
    if (toggle) {
      toggle.addEventListener("click", function () {
        currentTheme = currentTheme === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", currentTheme);
        updateIcon();
      });
    }
  })();

  // ─── Login Screen ──────────────────────
  var loginScreen = document.getElementById("login-screen");
  var appEl = document.getElementById("app");

  function showLogin() {
    loginScreen.style.display = "flex";
    appEl.style.display = "none";
    renderLoginPeople();
  }

  function renderLoginPeople() {
    var container = document.getElementById("login-people");
    var emptyEl = document.getElementById("login-empty");

    if (flatmates.length === 0) {
      container.innerHTML = "";
      emptyEl.style.display = "block";
      // Show a "skip" button to allow adding people
      container.innerHTML = '<button class="form-submit login-skip-btn" id="login-skip">Continue without login</button>';
      document.getElementById("login-skip").addEventListener("click", function () {
        currentUser = null;
        persistCurrentUser();
        enterApp();
      });
      return;
    }

    emptyEl.style.display = "none";
    var html = "";
    flatmates.forEach(function (fm, i) {
      html += '<button class="login-person-btn" data-id="' + fm.id + '">';
      html += avatarHTML(fm.name, i, 48);
      html += '<span class="login-person-name">' + esc(fm.name) + "</span>";
      html += "</button>";
    });
    container.innerHTML = html;

    container.querySelectorAll(".login-person-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        var fm = flatmates.find(function (f) { return f.id === id; });
        if (fm) {
          currentUser = { id: fm.id, name: fm.name };
          persistCurrentUser();
          enterApp();
        }
      });
    });
  }

  function enterApp() {
    loginScreen.style.display = "none";
    appEl.style.display = "flex";
    updateUserAvatar();
    loadSchedule();
    loadTasks();
  }

  function updateUserAvatar() {
    var btn = document.getElementById("user-avatar-btn");
    if (!btn) return;
    if (currentUser) {
      var idx = fmIndex(currentUser.id);
      btn.innerHTML = avatarHTML(currentUser.name, idx, 32);
      btn.title = currentUser.name + " (tap to switch)";
    } else {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>';
      btn.title = "Not logged in";
    }
  }

  // User avatar click -> show login
  document.getElementById("user-avatar-btn").addEventListener("click", function () {
    showLogin();
  });

  // ─── Tabs ────────────────────────────────
  var tabEls = document.querySelectorAll(".tab");
  tabEls.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabEls.forEach(function (t) { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
      document.getElementById("view-" + tab.dataset.tab).classList.add("active");

      if (tab.dataset.tab === "schedule") loadSchedule();
      if (tab.dataset.tab === "tasks") loadTasks();
      if (tab.dataset.tab === "flatmates") loadFlatmates();
      if (tab.dataset.tab === "scoreboard") loadScoreboard();
      if (tab.dataset.tab === "history") { historyOffset = 0; loadHistory(true); }
    });
  });

  // ─── Modal ───────────────────────────────
  var overlay = document.getElementById("modal-overlay");
  var modalTitle = document.getElementById("modal-title");
  var modalBody = document.getElementById("modal-body");

  function openModal(title, bodyHTML) {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHTML;
    overlay.style.display = "flex";
  }

  function closeModal() {
    overlay.style.display = "none";
    modalBody.innerHTML = "";
  }

  document.getElementById("modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  // ═══════════════════════════════════════════
  // Schedule
  // ═══════════════════════════════════════════

  function loadSchedule() {
    var container = document.getElementById("schedule-list");
    var empty = document.getElementById("empty-schedule");
    var loading = document.getElementById("schedule-loading");
    var titleEl = document.getElementById("schedule-title");
    var rangeEl = document.getElementById("current-week-range");

    container.style.display = "none";
    empty.style.display = "none";
    loading.style.display = "flex";

    apiFetch("/api/schedule?week_offset=" + currentWeekOffset)
      .then(function (data) {
        loading.style.display = "none";
        rangeEl.textContent = data.week_label;

        if (currentWeekOffset === 0) titleEl.textContent = "This Week";
        else if (currentWeekOffset === 1) titleEl.textContent = "Next Week";
        else if (currentWeekOffset === -1) titleEl.textContent = "Last Week";
        else titleEl.textContent = "Week of " + data.week_label.split(" – ")[0];

        if (data.items.length === 0) {
          container.style.display = "none";
          empty.style.display = "flex";
          document.getElementById("empty-schedule-title").textContent = "No tasks this week";
          document.getElementById("empty-schedule-hint").textContent = "Add people and tasks to get started";
          return;
        }

        container.style.display = "flex";
        empty.style.display = "none";

        var html = "";
        data.items.forEach(function (item) {
          var assignedIdx = fmIndex(item.assigned_id);

          html += '<div class="schedule-card' + (item.completed ? " is-completed" : "") + '">';
          html += '<div class="schedule-card-left">';
          html += avatarHTML(item.assigned_name, assignedIdx);
          html += '<div class="schedule-card-content">';
          html += '<div class="schedule-task-name">' + (item.emoji || "📋") + " " + esc(item.task_name) + "</div>";

          if (item.completed && item.stolen) {
            html += '<div class="schedule-person">' + esc(item.assigned_name) + ' <span class="stolen-badge">Done by ' + esc(item.completed_by) + "</span></div>";
          } else {
            html += '<div class="schedule-person">' + esc(item.assigned_name);
            if (item.is_fixed_assignment) html += ' <span class="fixed-badge">assigned</span>';
            html += "</div>";
          }

          html += '<div class="schedule-meta">';
          html += '<span class="schedule-freq">' + intervalLabel(item.interval_days) + "</span>";
          html += '<span class="schedule-points">' + item.points + " pt" + (item.points > 1 ? "s" : "") + "</span>";
          html += "</div>";

          // Rotation preview — shown inline right after meta, as mini-avatar row
          if (item.rotation_preview && item.rotation_preview.length > 0 && !item.is_fixed_assignment) {
            html += '<div class="rotation-preview">';
            item.rotation_preview.forEach(function (rp, rpIdx) {
              var rpFmIdx = fmIndex(rp.id);
              html += '<div class="rotation-chip">';
              html += avatarHTML(rp.name, rpFmIdx, 20);
              html += '<span class="rotation-chip-name">' + esc(rp.name) + "</span>";
              html += "</div>";
              if (rpIdx < item.rotation_preview.length - 1) {
                html += '<span class="rotation-arrow">→</span>';
              }
            });
            html += "</div>";
          }

          // Subtask checklist — immer sichtbar, nicht nur wenn der Task abgeschlossen ist
          if (item.subtasks && item.subtasks.length > 0) {
            var stDoneCount = item.subtasks.filter(function (s) { return s.completed; }).length;
            // Always show a summary line with count
            html += '<div class="subtask-summary">';
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/></svg>';
            html += '<span>' + stDoneCount + "/" + item.subtasks.length + " subtasks</span>";
            html += "</div>";
            // Immer eine anklickbare Checkliste anzeigen
            html += '<div class="subtask-list">';
            item.subtasks.forEach(function (st) {
              html += '<label class="subtask-item' + (st.completed ? " checked" : "") + '">';
              html += '<input type="checkbox" class="subtask-cb" data-sid="' + st.id + '" data-week="' + data.week_key + '"' + (st.completed ? " checked" : "") + '>';
              html += '<span class="subtask-title">' + esc(st.title) + "</span>";
              html += "</label>";
            });
            html += "</div>";
          }

          html += "</div></div>";

          // Actions
          html += '<div class="schedule-card-actions">';
          if (item.completed) {
            html += '<button class="done-btn completed" data-task="' + item.task_id + '" data-week="' + data.week_key + '" aria-label="Undo completion">';
            html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>';
            html += "</button>";
          } else {
            // Complete button: uses currentUser if logged in, else opens picker
            html += '<button class="done-btn" data-task="' + item.task_id + '" data-assigned="' + item.assigned_id + '" data-week="' + data.week_key + '" aria-label="Mark complete">';
            html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>';
            html += "</button>";
            // "I did it" link for task stealing
            if (flatmates.length > 1) {
              html += '<button class="do-it-btn" data-task="' + item.task_id + '" data-assigned="' + item.assigned_id + '" data-week="' + data.week_key + '" data-points="' + item.points + '" data-taskname="' + esc(item.task_name) + '">I did it</button>';
            }
          }
          html += "</div></div>";
        });

        container.innerHTML = html;
        attachScheduleListeners(data.week_key);
      })
      .catch(function () {
        loading.style.display = "none";
        empty.style.display = "flex";
        document.getElementById("empty-schedule-title").textContent = "Could not load schedule";
        document.getElementById("empty-schedule-hint").textContent = "Check your connection and try again";
      });
  }

  function attachScheduleListeners(weekKey) {
    // Done buttons: if currentUser is set and is the assigned person -> auto-complete
    // Otherwise open picker
    document.querySelectorAll(".schedule-card .done-btn:not(.completed)").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var taskId = btn.dataset.task;
        var assignedId = btn.dataset.assigned;
        if (currentUser) {
          // If current user IS the assigned person, self-complete
          // Otherwise, this becomes a "steal" for the current user
          completeTask(taskId, weekKey, assignedId, currentUser.id);
        } else {
          // No login: complete as assigned person (self)
          completeTask(taskId, weekKey, assignedId, assignedId);
        }
      });
    });

    // Undo completed
    document.querySelectorAll(".schedule-card .done-btn.completed").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var taskId = btn.dataset.task;
        apiFetch("/api/complete?task_id=" + taskId + "&week_key=" + weekKey, { method: "DELETE" })
          .then(function () { loadSchedule(); loadFlatmatesData(); });
      });
    });

    // "I did it" button: opens picker
    document.querySelectorAll(".do-it-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var taskId = btn.dataset.task;
        var assignedId = btn.dataset.assigned;
        var taskName = btn.dataset.taskname;
        var points = btn.dataset.points;
        openCompleteModal(taskId, weekKey, assignedId, taskName, points);
      });
    });

    // Subtask checkboxes
    document.querySelectorAll(".subtask-cb").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var sid = cb.dataset.sid;
        var wk = cb.dataset.week;
        apiFetch("/api/subtask/complete", { method: "POST", body: { subtask_id: sid, week_key: wk } })
          .then(function (res) {
            var label = cb.closest(".subtask-item");
            if (res.completed) {
              label.classList.add("checked");
              cb.checked = true;
            } else {
              label.classList.remove("checked");
              cb.checked = false;
            }
          });
      });
    });
  }

  function openCompleteModal(taskId, weekKey, assignedId, taskName, points) {
    var html = '<p style="color:var(--color-text-muted);font-size:var(--text-sm);">Who actually did <strong>' + esc(taskName) + "</strong>?</p>";
    html += '<p style="color:var(--color-text-faint);font-size:var(--text-xs);">If someone else did it, they get the ' + points + " point" + (points > 1 ? "s" : "") + " and the assigned person moves to the end of the rotation.</p>";
    html += '<div class="person-picker">';

    flatmates.forEach(function (fm, i) {
      var label = fm.id === assignedId ? "(assigned)" : "";
      var isMe = currentUser && fm.id === currentUser.id;
      html += '<button class="person-option' + (isMe ? " current-user" : "") + '" data-id="' + fm.id + '">';
      html += avatarHTML(fm.name, i, 32);
      html += '<div>';
      html += '<div class="person-option-name">' + esc(fm.name) + (isMe ? " (you)" : "") + "</div>";
      if (label) html += '<div class="person-option-label">' + label + "</div>";
      html += "</div></button>";
    });

    html += "</div>";

    openModal("Who did it?", html);

    document.querySelectorAll(".person-option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var completedById = btn.dataset.id;
        closeModal();
        completeTask(taskId, weekKey, assignedId, completedById);
      });
    });
  }

  function completeTask(taskId, weekKey, assignedId, completedById) {
    apiFetch("/api/complete", {
      method: "POST",
      body: {
        task_id: taskId,
        week_key: weekKey,
        assigned_flatmate_id: assignedId,
        completed_by_id: completedById,
      },
    }).then(function () {
      loadSchedule();
      loadFlatmatesData();
    });
  }

  // ─── Week navigation ─────────────────────
  document.getElementById("prev-week").addEventListener("click", function () {
    currentWeekOffset--;
    loadSchedule();
  });
  document.getElementById("next-week").addEventListener("click", function () {
    currentWeekOffset++;
    loadSchedule();
  });
  document.getElementById("today-btn").addEventListener("click", function () {
    currentWeekOffset = 0;
    loadSchedule();
  });

  // ═══════════════════════════════════════════
  // Tasks
  // ═══════════════════════════════════════════

  function loadTasks() {
    apiFetch("/api/tasks").then(function (data) {
      tasks = data;
      renderTasks();
    });
  }

  function renderTasks() {
    var container = document.getElementById("tasks-list");
    var empty = document.getElementById("empty-tasks");

    if (tasks.length === 0) {
      container.style.display = "none";
      empty.style.display = "flex";
      return;
    }

    container.style.display = "flex";
    empty.style.display = "none";

    var html = "";
    tasks.forEach(function (task) {
      html += '<div class="task-card">';
      html += '<div class="task-icon">' + (task.emoji || "📋") + "</div>";
      html += '<div class="task-card-content">';
      html += '<div class="task-name">' + esc(task.name) + "</div>";
      html += '<div class="task-meta">';
      html += '<span class="task-freq">' + intervalLabel(task.interval_days) + "</span>";
      html += '<span class="task-points">' + task.points + " pt" + (task.points > 1 ? "s" : "") + "</span>";
      if (task.assigned_to_name) {
        html += '<span class="task-assigned">' + esc(task.assigned_to_name) + "</span>";
      }
      html += "</div>";
      // Show subtask count
      if (task.subtasks && task.subtasks.length > 0) {
        html += '<div class="task-subtask-count">' + task.subtasks.length + " subtask" + (task.subtasks.length > 1 ? "s" : "") + "</div>";
      }
      html += "</div>";
      html += '<div class="card-actions">';
      html += '<button class="edit-btn" data-id="' + task.id + '" aria-label="Edit task">';
      html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      html += "</button>";
      html += '<button class="delete-btn" data-id="' + task.id + '" aria-label="Delete task">';
      html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += "</button></div></div>";
    });

    container.innerHTML = html;

    container.querySelectorAll(".delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        apiFetch("/api/tasks/" + btn.dataset.id, { method: "DELETE" })
          .then(function () { loadTasks(); loadSchedule(); });
      });
    });

    container.querySelectorAll(".edit-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var task = tasks.find(function (t) { return t.id === btn.dataset.id; });
        if (task) openEditTaskModal(task);
      });
    });
  }

  // ─── Task Form Builder (shared between create & edit) ───
  function buildTaskFormHTML(opts) {
    var isEdit = opts.isEdit || false;
    var task = opts.task || {};
    var selectedEmoji = task.emoji || EMOJIS[0];
    var intervalVal = task.interval_days || 7;
    var pointsVal = task.points || 1;
    var assignedTo = task.assigned_to || "";
    var subtaskList = task.subtasks || [];

    var html = '<form id="task-form">';
    html += '<div class="form-group">';
    html += '<label class="form-label" for="task-name">Task name</label>';
    html += '<input class="form-input" id="task-name" type="text" placeholder="e.g. Clean kitchen" required maxlength="50" autocomplete="off" value="' + esc(task.name || "") + '">';
    html += "</div>";

    html += '<div class="form-group">';
    html += '<label class="form-label">Icon</label>';
    html += '<div class="emoji-picker" id="emoji-picker">';
    EMOJIS.forEach(function (em) {
      html += '<button type="button" class="emoji-option' + (em === selectedEmoji ? " selected" : "") + '" data-emoji="' + em + '">' + em + "</button>";
    });
    html += "</div></div>";

    html += '<div class="form-row">';
    html += '<div class="form-group">';
    html += '<label class="form-label" for="task-interval">Interval (days)</label>';
    html += '<input class="form-input" id="task-interval" type="number" min="1" max="365" value="' + intervalVal + '">';
    html += "</div>";

    html += '<div class="form-group">';
    html += '<label class="form-label" for="task-points">Points</label>';
    html += '<select class="form-select" id="task-points">';
    for (var p = 1; p <= 10; p++) {
      html += '<option value="' + p + '"' + (p === pointsVal ? " selected" : "") + ">" + p + " pt" + (p > 1 ? "s" : "") + "</option>";
    }
    html += "</select></div></div>";

    // Assign to specific person
    html += '<div class="form-group">';
    html += '<label class="form-label" for="task-assign">Assign to (optional)</label>';
    html += '<select class="form-select" id="task-assign">';
    html += '<option value="">Rotation (everyone)</option>';
    flatmates.forEach(function (fm) {
      html += '<option value="' + fm.id + '"' + (fm.id === assignedTo ? " selected" : "") + ">" + esc(fm.name) + "</option>";
    });
    html += "</select></div>";

    // Subtasks / checklist
    html += '<div class="form-group">';
    html += '<label class="form-label">Subtasks (checklist)</label>';
    html += '<div id="subtask-inputs" class="subtask-inputs">';
    subtaskList.forEach(function (st, i) {
      html += '<div class="subtask-input-row" data-idx="' + i + '">';
      html += '<input class="form-input subtask-input" type="text" placeholder="Subtask" maxlength="100" value="' + esc(st.title) + '">';
      html += '<button type="button" class="icon-btn small remove-subtask" aria-label="Remove subtask">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      html += "</button></div>";
    });
    html += "</div>";
    html += '<button type="button" class="text-btn add-subtask-btn" id="add-subtask-btn">';
    html += '+ Add subtask</button></div>';

    html += '<button type="submit" class="form-submit">' + (isEdit ? "Save Changes" : "Create Task") + "</button>";
    html += "</form>";

    return { html: html, selectedEmoji: selectedEmoji };
  }

  function attachTaskFormListeners(opts) {
    var selectedEmoji = opts.selectedEmoji;

    document.getElementById("emoji-picker").addEventListener("click", function (e) {
      var btn = e.target.closest(".emoji-option");
      if (!btn) return;
      document.querySelectorAll(".emoji-option").forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
      selectedEmoji = btn.dataset.emoji;
      opts.selectedEmoji = selectedEmoji;
    });

    // Subtask add/remove
    document.getElementById("add-subtask-btn").addEventListener("click", function () {
      var container = document.getElementById("subtask-inputs");
      var idx = container.children.length;
      var row = document.createElement("div");
      row.className = "subtask-input-row";
      row.dataset.idx = idx;
      row.innerHTML = '<input class="form-input subtask-input" type="text" placeholder="Subtask" maxlength="100">' +
        '<button type="button" class="icon-btn small remove-subtask" aria-label="Remove subtask">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
      container.appendChild(row);
      row.querySelector(".subtask-input").focus();
      row.querySelector(".remove-subtask").addEventListener("click", function () { row.remove(); });
    });

    document.querySelectorAll(".remove-subtask").forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.closest(".subtask-input-row").remove();
      });
    });

    return opts;
  }

  function collectTaskFormData(opts) {
    var name = document.getElementById("task-name").value.trim();
    var interval = parseInt(document.getElementById("task-interval").value, 10) || 7;
    var pts = parseInt(document.getElementById("task-points").value, 10);
    var assign = document.getElementById("task-assign").value;

    var subtasks = [];
    document.querySelectorAll(".subtask-input").forEach(function (inp) {
      var val = inp.value.trim();
      if (val) subtasks.push({ title: val });
    });

    return {
      name: name,
      emoji: opts.selectedEmoji,
      interval_days: interval,
      points: pts,
      assigned_to: assign || null,
      subtasks: subtasks.length > 0 ? subtasks : null,
    };
  }

  // ─── Add Task ─────────────────────────────
  document.getElementById("add-task-btn").addEventListener("click", function () {
    var built = buildTaskFormHTML({ isEdit: false });
    openModal("New Task", built.html);
    document.getElementById("task-name").focus();

    var opts = attachTaskFormListeners({ selectedEmoji: built.selectedEmoji });

    document.getElementById("task-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var data = collectTaskFormData(opts);
      if (!data.name) return;

      var body = { name: data.name, emoji: data.emoji, interval_days: data.interval_days, points: data.points };
      if (data.assigned_to) body.assigned_to = data.assigned_to;
      if (data.subtasks) body.subtasks = data.subtasks;

      apiFetch("/api/tasks", { method: "POST", body: body }).then(function () {
        closeModal();
        loadTasks();
        loadSchedule();
      });
    });
  });

  // ─── Edit Task ────────────────────────────
  function openEditTaskModal(task) {
    var built = buildTaskFormHTML({ isEdit: true, task: task });
    openModal("Edit Task", built.html);
    document.getElementById("task-name").focus();

    var opts = attachTaskFormListeners({ selectedEmoji: built.selectedEmoji });

    document.getElementById("task-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var data = collectTaskFormData(opts);
      if (!data.name) return;

      var body = {
        name: data.name,
        emoji: data.emoji,
        interval_days: data.interval_days,
        points: data.points,
        subtasks: data.subtasks || [],
      };

      if (data.assigned_to) {
        body.assigned_to = data.assigned_to;
      } else if (task.assigned_to) {
        body.clear_assignment = true;
      }

      apiFetch("/api/tasks/" + task.id, { method: "PUT", body: body }).then(function () {
        closeModal();
        loadTasks();
        loadSchedule();
      });
    });
  }

  // ═══════════════════════════════════════════
  // Flatmates
  // ═══════════════════════════════════════════

  function loadFlatmatesData() {
    return apiFetch("/api/flatmates").then(function (data) {
      flatmates = data;
      return data;
    });
  }

  function loadFlatmates() {
    loadFlatmatesData().then(renderFlatmates);
  }

  function renderFlatmates() {
    var container = document.getElementById("flatmates-list");
    var empty = document.getElementById("empty-flatmates");

    if (flatmates.length === 0) {
      container.style.display = "none";
      empty.style.display = "flex";
      return;
    }

    container.style.display = "flex";
    empty.style.display = "none";

    var html = "";
    flatmates.forEach(function (fm, i) {
      var isMe = currentUser && fm.id === currentUser.id;
      html += '<div class="flatmate-card' + (isMe ? " is-current-user" : "") + '">';
      html += avatarHTML(fm.name, i);
      html += '<div class="flatmate-card-content">';
      html += '<div class="flatmate-name">' + esc(fm.name) + (isMe ? ' <span class="you-badge">you</span>' : "") + "</div>";
      html += '<div class="flatmate-points">' + fm.points + " point" + (fm.points !== 1 ? "s" : "") + "</div>";
      html += "</div>";
      html += '<div class="card-actions">';
      html += '<button class="delete-btn" data-id="' + fm.id + '" aria-label="Delete person">';
      html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += "</button></div></div>";
    });

    container.innerHTML = html;

    container.querySelectorAll(".delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.id;
        // If deleting self, log out
        apiFetch("/api/flatmates/" + id, { method: "DELETE" })
          .then(function () {
            if (currentUser && currentUser.id === id) {
              currentUser = null;
              persistCurrentUser();
              updateUserAvatar();
            }
            loadFlatmates();
            loadSchedule();
          });
      });
    });
  }

  // Add flatmate
  document.getElementById("add-flatmate-btn").addEventListener("click", function () {
    if (flatmates.length >= 8) {
      openModal("Limit Reached", '<p style="color:var(--color-text-muted)">Maximum 8 flatmates allowed.</p>');
      return;
    }
    var html = '<form id="flatmate-form">';
    html += '<div class="form-group">';
    html += '<label class="form-label" for="fm-name">Name</label>';
    html += '<input class="form-input" id="fm-name" type="text" placeholder="e.g. Alex" required maxlength="30" autocomplete="off">';
    html += "</div>";
    html += '<button type="submit" class="form-submit">Add Person</button>';
    html += "</form>";

    openModal("Add Person", html);
    document.getElementById("fm-name").focus();

    document.getElementById("flatmate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("fm-name").value.trim();
      if (!name) return;
      apiFetch("/api/flatmates", { method: "POST", body: { name: name } })
        .then(function () {
          closeModal();
          loadFlatmates();
          loadSchedule();
        });
    });
  });

  // ═══════════════════════════════════════════
  // Scoreboard
  // ═══════════════════════════════════════════

  function loadScoreboard() {
    apiFetch("/api/scoreboard").then(function (data) {
      var container = document.getElementById("scoreboard-list");
      var empty = document.getElementById("empty-scoreboard");

      if (data.length === 0) {
        container.style.display = "none";
        empty.style.display = "flex";
        return;
      }

      container.style.display = "flex";
      empty.style.display = "none";

      var html = "";
      data.forEach(function (fm, i) {
        var fIdx = fmIndex(fm.id);

        var rankClass = "";
        if (i === 0) rankClass = " rank-1";
        else if (i === 1) rankClass = " rank-2";
        else if (i === 2) rankClass = " rank-3";

        var isMe = currentUser && fm.id === currentUser.id;

        html += '<div class="score-card' + (isMe ? " is-current-user" : "") + '">';
        html += '<div class="score-rank' + rankClass + '">' + (i + 1) + "</div>";
        html += avatarHTML(fm.name, fIdx);
        html += '<div class="score-card-content">';
        html += '<div class="score-name">' + esc(fm.name) + (isMe ? ' <span class="you-badge">you</span>' : "") + "</div>";
        html += "</div>";
        html += '<div class="score-value">' + fm.points + ' <span class="score-label">pts</span></div>';
        html += "</div>";
      });

      container.innerHTML = html;
    });
  }

  // Reset scoreboard
  document.getElementById("reset-scores-btn").addEventListener("click", function () {
    openModal("Reset Scores", '<p style="color:var(--color-text-muted);font-size:var(--text-sm);">This will reset all points to zero. Completed tasks and rotation order are not affected.</p><button class="danger-btn" id="confirm-reset">Reset All Scores</button>');

    document.getElementById("confirm-reset").addEventListener("click", function () {
      apiFetch("/api/scoreboard/reset", { method: "POST" })
        .then(function () {
          closeModal();
          loadScoreboard();
          loadFlatmatesData();
        });
    });
  });

  // ═══════════════════════════════════════════
  // History
  // ═══════════════════════════════════════════

  function loadHistory(reset) {
    if (reset) {
      historyOffset = 0;
      document.getElementById("history-list").innerHTML = "";
    }

    apiFetch("/api/history?limit=30&offset=" + historyOffset)
      .then(function (data) {
        var container = document.getElementById("history-list");
        var empty = document.getElementById("empty-history");
        var loadMoreBtn = document.getElementById("load-more-history");

        if (data.items.length === 0 && historyOffset === 0) {
          container.style.display = "none";
          empty.style.display = "flex";
          loadMoreBtn.style.display = "none";
          return;
        }

        container.style.display = "flex";
        empty.style.display = "none";

        var html = "";
        data.items.forEach(function (entry) {
          html += '<div class="history-entry">';
          html += '<div class="history-icon">' + actionIcon(entry.action) + "</div>";
          html += '<div class="history-content">';
          html += '<div class="history-detail">' + esc(entry.detail) + "</div>";
          html += '<div class="history-time">' + timeAgo(entry.created_at) + "</div>";
          html += "</div></div>";
        });

        container.insertAdjacentHTML("beforeend", html);

        historyHasMore = data.has_more;
        historyOffset += data.items.length;
        loadMoreBtn.style.display = data.has_more ? "flex" : "none";
      });
  }

  document.getElementById("load-more-history").addEventListener("click", function () {
    loadHistory(false);
  });

  // ═══════════════════════════════════════════
  // Initial load
  // ═══════════════════════════════════════════

  loadFlatmatesData().then(function () {
    if (flatmates.length > 0) {
      // Versuche, den zuletzt gewählten Nutzer vom Gerät wiederherzustellen
      var storedId = getStoredUserId();
      if (storedId) {
        var fm = flatmates.find(function (f) { return f.id === storedId; });
        if (fm) {
          currentUser = { id: fm.id, name: fm.name };
          enterApp();
          return;
        }
      }
      // Kein gespeicherter Nutzer oder nicht mehr vorhanden → Login anzeigen
      showLogin();
    } else {
      // No people yet: skip login, go directly to app
      currentUser = null;
      enterApp();
    }
  });
})();
