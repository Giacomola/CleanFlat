#!/usr/bin/env python3
"""FlatClean API v4 — subtasks, assignment, login, rotation preview, history."""
import sqlite3
import time
import datetime
import random
import string
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Store the SQLite DB next to this file so the app
# works on different machines/paths without changes.
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = str(BASE_DIR / "flatclean.db")


def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS flatmates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            points INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            emoji TEXT NOT NULL DEFAULT '📋',
            interval_days INTEGER NOT NULL DEFAULT 7,
            points INTEGER NOT NULL DEFAULT 1,
            assigned_to TEXT,
            created_at REAL NOT NULL,
            FOREIGN KEY (assigned_to) REFERENCES flatmates(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS subtasks (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            title TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS subtask_completions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subtask_id TEXT NOT NULL,
            week_key TEXT NOT NULL,
            completed_at REAL NOT NULL,
            FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE,
            UNIQUE(subtask_id, week_key)
        );
        CREATE TABLE IF NOT EXISTS completions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            flatmate_id TEXT NOT NULL,
            week_key TEXT NOT NULL,
            completed_by TEXT,
            completed_at REAL NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (flatmate_id) REFERENCES flatmates(id) ON DELETE CASCADE,
            UNIQUE(task_id, week_key)
        );
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            detail TEXT NOT NULL,
            actor TEXT,
            created_at REAL NOT NULL
        );
    """)

    # Migrations
    task_cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
    if "frequency" in task_cols and "interval_days" not in task_cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN interval_days INTEGER NOT NULL DEFAULT 7")
        freq_map = {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30}
        for row in conn.execute("SELECT id, frequency FROM tasks").fetchall():
            days = freq_map.get(row["frequency"], 7)
            conn.execute("UPDATE tasks SET interval_days = ? WHERE id = ?", [days, row["id"]])
    if "assigned_to" not in task_cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN assigned_to TEXT")

    conn.commit()


db = get_db()
init_db(db)


@asynccontextmanager
async def lifespan(app):
    yield
    db.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Serve frontend (static files) from the same app so that
# a einzelner Server/Container alles bereitstellen kann.
static_dir = BASE_DIR
app.mount(
    "/",
    StaticFiles(directory=static_dir, html=True),
    name="static",
)


@app.get("/index.html")
def index_html():
    """Expliziter Index-Endpunkt (optional)."""
    index_path = static_dir / "index.html"
    if index_path.is_file():
        return FileResponse(str(index_path))
    raise HTTPException(status_code=404, detail="index.html not found")


# ─── Models ─────────────────────────────

class FlatmateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=30)

class SubtaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)

class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    emoji: str = "📋"
    interval_days: int = Field(default=7, ge=1, le=365)
    points: int = Field(default=1, ge=1, le=10)
    assigned_to: Optional[str] = None
    subtasks: Optional[List[SubtaskIn]] = None

class TaskUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    emoji: Optional[str] = None
    interval_days: Optional[int] = Field(default=None, ge=1, le=365)
    points: Optional[int] = Field(default=None, ge=1, le=10)
    assigned_to: Optional[str] = None
    clear_assignment: Optional[bool] = None
    subtasks: Optional[List[SubtaskIn]] = None

class CompleteTask(BaseModel):
    task_id: str
    week_key: str
    assigned_flatmate_id: str
    completed_by_id: str

class SubtaskComplete(BaseModel):
    subtask_id: str
    week_key: str


# ─── Helpers ────────────────────────────

def gen_id():
    ts = hex(int(time.time() * 1000))[2:]
    rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"{ts}{rand}"


def log_activity(action: str, detail: str, actor: str = None):
    db.execute(
        "INSERT INTO activity_log (action, detail, actor, created_at) VALUES (?, ?, ?, ?)",
        [action, detail, actor, time.time()]
    )
    db.commit()


def interval_label(days: int) -> str:
    if days == 1:
        return "Every day"
    if days == 7:
        return "Every week"
    if days == 14:
        return "Every 2 weeks"
    if days == 30:
        return "Every month"
    return f"Every {days} days"


def get_subtasks_for_task(task_id: str) -> list:
    rows = db.execute(
        "SELECT id, title, position FROM subtasks WHERE task_id = ? ORDER BY position",
        [task_id]
    ).fetchall()
    return [{"id": r["id"], "title": r["title"], "position": r["position"]} for r in rows]


def set_subtasks(task_id: str, subtask_list: list):
    """Replace all subtasks for a task."""
    db.execute("DELETE FROM subtask_completions WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)", [task_id])
    db.execute("DELETE FROM subtasks WHERE task_id = ?", [task_id])
    for i, st in enumerate(subtask_list):
        sid = gen_id()
        db.execute(
            "INSERT INTO subtasks (id, task_id, title, position) VALUES (?, ?, ?, ?)",
            [sid, task_id, st.title if hasattr(st, 'title') else st["title"], i]
        )
    db.commit()


# ─── Flatmates ──────────────────────────

@app.get("/api/flatmates")
def list_flatmates():
    rows = db.execute(
        "SELECT id, name, position, points, created_at FROM flatmates ORDER BY position, created_at"
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/flatmates", status_code=201)
def create_flatmate(fm: FlatmateCreate):
    fid = gen_id()
    max_pos = db.execute("SELECT COALESCE(MAX(position), -1) FROM flatmates").fetchone()[0]
    count = db.execute("SELECT COUNT(*) FROM flatmates").fetchone()[0]
    if count >= 8:
        raise HTTPException(status_code=400, detail="Maximum 8 flatmates")
    db.execute(
        "INSERT INTO flatmates (id, name, position, points, created_at) VALUES (?, ?, ?, 0, ?)",
        [fid, fm.name, max_pos + 1, time.time()]
    )
    db.commit()
    log_activity("person_added", f"{fm.name} joined the flat")
    return {"id": fid, "name": fm.name, "position": max_pos + 1, "points": 0}


@app.delete("/api/flatmates/{fid}")
def delete_flatmate(fid: str):
    row = db.execute("SELECT name FROM flatmates WHERE id = ?", [fid]).fetchone()
    name = row["name"] if row else "Unknown"
    db.execute("DELETE FROM completions WHERE flatmate_id = ?", [fid])
    db.execute("UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ?", [fid])
    db.execute("DELETE FROM flatmates WHERE id = ?", [fid])
    db.commit()
    rows = db.execute("SELECT id FROM flatmates ORDER BY position, created_at").fetchall()
    for i, r in enumerate(rows):
        db.execute("UPDATE flatmates SET position = ? WHERE id = ?", [i, r["id"]])
    db.commit()
    log_activity("person_removed", f"{name} was removed")
    return {"deleted": fid}


# ─── Tasks ──────────────────────────────

@app.get("/api/tasks")
def list_tasks():
    rows = db.execute(
        "SELECT id, name, emoji, interval_days, points, assigned_to, created_at FROM tasks ORDER BY created_at"
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["subtasks"] = get_subtasks_for_task(d["id"])
        # Resolve assigned_to name
        if d["assigned_to"]:
            fm = db.execute("SELECT name FROM flatmates WHERE id = ?", [d["assigned_to"]]).fetchone()
            d["assigned_to_name"] = fm["name"] if fm else None
        else:
            d["assigned_to_name"] = None
        result.append(d)
    return result


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate):
    tid = gen_id()
    # Validate assigned_to if provided
    if task.assigned_to:
        fm = db.execute("SELECT id FROM flatmates WHERE id = ?", [task.assigned_to]).fetchone()
        if not fm:
            raise HTTPException(status_code=400, detail="Assigned flatmate not found")

    db.execute(
        "INSERT INTO tasks (id, name, emoji, interval_days, points, assigned_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [tid, task.name, task.emoji, task.interval_days, task.points, task.assigned_to, time.time()]
    )
    db.commit()

    if task.subtasks:
        set_subtasks(tid, task.subtasks)

    assigned_label = ""
    if task.assigned_to:
        fm = db.execute("SELECT name FROM flatmates WHERE id = ?", [task.assigned_to]).fetchone()
        if fm:
            assigned_label = f", assigned to {fm['name']}"

    log_activity("task_created", f'Task "{task.name}" created ({interval_label(task.interval_days)}, {task.points} pts{assigned_label})')
    return {"id": tid, "name": task.name, "emoji": task.emoji,
            "interval_days": task.interval_days, "points": task.points, "assigned_to": task.assigned_to}


@app.put("/api/tasks/{tid}")
def update_task(tid: str, update: TaskUpdate):
    existing = db.execute("SELECT name, emoji, interval_days, points, assigned_to FROM tasks WHERE id = ?", [tid]).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")

    changes = []
    old = dict(existing)

    if update.name is not None and update.name != old["name"]:
        db.execute("UPDATE tasks SET name = ? WHERE id = ?", [update.name, tid])
        changes.append(f'name: "{old["name"]}" → "{update.name}"')
    if update.emoji is not None and update.emoji != old["emoji"]:
        db.execute("UPDATE tasks SET emoji = ? WHERE id = ?", [update.emoji, tid])
        changes.append("icon changed")
    if update.interval_days is not None and update.interval_days != old["interval_days"]:
        db.execute("UPDATE tasks SET interval_days = ? WHERE id = ?", [update.interval_days, tid])
        changes.append(f"interval: {interval_label(old['interval_days'])} → {interval_label(update.interval_days)}")
    if update.points is not None and update.points != old["points"]:
        db.execute("UPDATE tasks SET points = ? WHERE id = ?", [update.points, tid])
        changes.append(f"points: {old['points']} → {update.points}")

    # Handle assignment changes
    if update.clear_assignment:
        if old["assigned_to"] is not None:
            old_fm = db.execute("SELECT name FROM flatmates WHERE id = ?", [old["assigned_to"]]).fetchone()
            db.execute("UPDATE tasks SET assigned_to = NULL WHERE id = ?", [tid])
            changes.append(f"assignment removed ({old_fm['name'] if old_fm else 'unknown'})")
    elif update.assigned_to is not None and update.assigned_to != old["assigned_to"]:
        fm = db.execute("SELECT id, name FROM flatmates WHERE id = ?", [update.assigned_to]).fetchone()
        if not fm:
            raise HTTPException(status_code=400, detail="Assigned flatmate not found")
        db.execute("UPDATE tasks SET assigned_to = ? WHERE id = ?", [update.assigned_to, tid])
        changes.append(f"assigned to {fm['name']}")

    # Handle subtasks
    if update.subtasks is not None:
        set_subtasks(tid, update.subtasks)
        changes.append(f"subtasks updated ({len(update.subtasks)} items)")

    db.commit()

    task_name = update.name if update.name else old["name"]
    if changes:
        log_activity("task_edited", f'Task "{task_name}" edited — {", ".join(changes)}')

    updated = db.execute(
        "SELECT id, name, emoji, interval_days, points, assigned_to, created_at FROM tasks WHERE id = ?", [tid]
    ).fetchone()
    d = dict(updated)
    d["subtasks"] = get_subtasks_for_task(tid)
    return d


@app.delete("/api/tasks/{tid}")
def delete_task(tid: str):
    row = db.execute("SELECT name FROM tasks WHERE id = ?", [tid]).fetchone()
    name = row["name"] if row else "Unknown"
    db.execute("DELETE FROM subtask_completions WHERE subtask_id IN (SELECT id FROM subtasks WHERE task_id = ?)", [tid])
    db.execute("DELETE FROM subtasks WHERE task_id = ?", [tid])
    db.execute("DELETE FROM completions WHERE task_id = ?", [tid])
    db.execute("DELETE FROM tasks WHERE id = ?", [tid])
    db.commit()
    log_activity("task_deleted", f'Task "{name}" was deleted')
    return {"deleted": tid}


# ─── Schedule & Rotation ────────────────

EPOCH = datetime.date(2026, 1, 5)  # A Monday

def compute_schedule_items(week_offset: int, include_future_rotation: bool = False):
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    target_monday = monday + datetime.timedelta(weeks=week_offset)
    week_key = target_monday.isoformat()
    sunday = target_monday + datetime.timedelta(days=6)

    tasks_rows = db.execute(
        "SELECT id, name, emoji, interval_days, points, assigned_to, created_at FROM tasks ORDER BY created_at"
    ).fetchall()
    fm_rows = db.execute(
        "SELECT id, name, position, points FROM flatmates ORDER BY position"
    ).fetchall()

    week_label = f"{target_monday.strftime('%-d %b')} – {sunday.strftime('%-d %b')}"

    if not tasks_rows or not fm_rows:
        return week_key, week_label, []

    fm_list = [dict(f) for f in fm_rows]
    n_fm = len(fm_list)
    days_since_epoch = (target_monday - EPOCH).days

    items = []
    for task_idx, task in enumerate(tasks_rows):
        t = dict(task)
        interval = t["interval_days"]
        period_number = days_since_epoch // interval

        period_start_day = period_number * interval
        period_start_date = EPOCH + datetime.timedelta(days=period_start_day)
        if not (target_monday <= period_start_date <= sunday):
            if interval <= 7:
                pass
            else:
                continue

        # If task is assigned to a specific person, always show that person
        if t["assigned_to"]:
            assigned = None
            for fm in fm_list:
                if fm["id"] == t["assigned_to"]:
                    assigned = fm
                    break
            if not assigned:
                # Fallback to rotation if assigned person was deleted
                assigned_idx = (task_idx + period_number) % n_fm
                assigned = fm_list[assigned_idx]
        else:
            assigned_idx = (task_idx + period_number) % n_fm
            assigned = fm_list[assigned_idx]

        comp = db.execute(
            "SELECT completed_by, completed_at FROM completions WHERE task_id = ? AND week_key = ?",
            [t["id"], week_key]
        ).fetchone()

        completed = comp is not None
        completed_by = None
        stolen = False
        if comp:
            cb_row = db.execute(
                "SELECT name FROM flatmates WHERE id = ?", [comp["completed_by"]]
            ).fetchone()
            if cb_row:
                completed_by = cb_row["name"]
            stolen = comp["completed_by"] != assigned["id"]

        # Get subtasks and their completion status for this week
        subtask_rows = db.execute(
            "SELECT id, title, position FROM subtasks WHERE task_id = ? ORDER BY position", [t["id"]]
        ).fetchall()
        subtasks_data = []
        for st in subtask_rows:
            st_comp = db.execute(
                "SELECT id FROM subtask_completions WHERE subtask_id = ? AND week_key = ?",
                [st["id"], week_key]
            ).fetchone()
            subtasks_data.append({
                "id": st["id"],
                "title": st["title"],
                "completed": st_comp is not None,
            })

        # Future rotation (next N periods)
        rotation_preview = []
        if include_future_rotation and not t["assigned_to"]:
            for offset in range(1, n_fm + 1):
                future_period = period_number + offset
                future_idx = (task_idx + future_period) % n_fm
                rotation_preview.append({
                    "name": fm_list[future_idx]["name"],
                    "id": fm_list[future_idx]["id"],
                })

        item = {
            "task_id": t["id"],
            "task_name": t["name"],
            "emoji": t["emoji"],
            "interval_days": interval,
            "points": t["points"],
            "assigned_id": assigned["id"],
            "assigned_name": assigned["name"],
            "is_fixed_assignment": t["assigned_to"] is not None,
            "completed": completed,
            "completed_by": completed_by,
            "stolen": stolen,
            "subtasks": subtasks_data,
        }
        if include_future_rotation:
            item["rotation_preview"] = rotation_preview
        items.append(item)

    return week_key, week_label, items


@app.get("/api/schedule")
def get_schedule(week_offset: int = 0):
    week_key, week_label, items = compute_schedule_items(week_offset, include_future_rotation=True)
    return {
        "week_key": week_key,
        "week_label": week_label,
        "week_offset": week_offset,
        "items": items
    }


# ─── Complete / Uncomplete ──────────────

@app.post("/api/complete")
def complete_task_endpoint(data: CompleteTask):
    task = db.execute("SELECT name, points FROM tasks WHERE id = ?", [data.task_id]).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    existing = db.execute(
        "SELECT id FROM completions WHERE task_id = ? AND week_key = ?",
        [data.task_id, data.week_key]
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Already completed")

    points = task["points"]
    task_name = task["name"]

    db.execute(
        "UPDATE flatmates SET points = points + ? WHERE id = ?",
        [points, data.completed_by_id]
    )
    db.execute(
        "INSERT INTO completions (task_id, flatmate_id, week_key, completed_by, completed_at) VALUES (?, ?, ?, ?, ?)",
        [data.task_id, data.assigned_flatmate_id, data.week_key, data.completed_by_id, time.time()]
    )

    completer = db.execute("SELECT name FROM flatmates WHERE id = ?", [data.completed_by_id]).fetchone()
    assigned = db.execute("SELECT name FROM flatmates WHERE id = ?", [data.assigned_flatmate_id]).fetchone()
    completer_name = completer["name"] if completer else "Someone"
    assigned_name = assigned["name"] if assigned else "Someone"

    if data.completed_by_id != data.assigned_flatmate_id:
        max_pos = db.execute("SELECT COALESCE(MAX(position), 0) FROM flatmates").fetchone()[0]
        db.execute(
            "UPDATE flatmates SET position = ? WHERE id = ?",
            [max_pos + 1, data.assigned_flatmate_id]
        )
        rows = db.execute("SELECT id FROM flatmates ORDER BY position").fetchall()
        for i, r in enumerate(rows):
            db.execute("UPDATE flatmates SET position = ? WHERE id = ?", [i, r["id"]])
        db.commit()
        log_activity(
            "task_completed",
            f'{completer_name} completed "{task_name}" (assigned to {assigned_name}) — +{points} pts, {assigned_name} moved to end',
            completer_name
        )
    else:
        db.commit()
        log_activity(
            "task_completed",
            f'{completer_name} completed "{task_name}" — +{points} pts',
            completer_name
        )

    return {"ok": True, "points_awarded": points, "awarded_to": data.completed_by_id}


@app.delete("/api/complete")
def uncomplete_task(task_id: str, week_key: str):
    comp = db.execute(
        "SELECT completed_by FROM completions WHERE task_id = ? AND week_key = ?",
        [task_id, week_key]
    ).fetchone()
    if not comp:
        raise HTTPException(status_code=404, detail="Completion not found")

    task = db.execute("SELECT name, points FROM tasks WHERE id = ?", [task_id]).fetchone()
    completer = db.execute("SELECT name FROM flatmates WHERE id = ?", [comp["completed_by"]]).fetchone()

    if task:
        db.execute(
            "UPDATE flatmates SET points = MAX(0, points - ?) WHERE id = ?",
            [task["points"], comp["completed_by"]]
        )

    db.execute(
        "DELETE FROM completions WHERE task_id = ? AND week_key = ?",
        [task_id, week_key]
    )
    # Also clear subtask completions for this week
    subtask_ids = db.execute("SELECT id FROM subtasks WHERE task_id = ?", [task_id]).fetchall()
    for st in subtask_ids:
        db.execute("DELETE FROM subtask_completions WHERE subtask_id = ? AND week_key = ?", [st["id"], week_key])

    db.commit()

    task_name = task["name"] if task else "Unknown"
    completer_name = completer["name"] if completer else "Someone"
    log_activity("task_uncompleted", f'"{task_name}" completion by {completer_name} was undone')
    return {"ok": True}


# ─── Subtask Completions ───────────────

@app.post("/api/subtask/complete")
def complete_subtask(data: SubtaskComplete):
    existing = db.execute(
        "SELECT id FROM subtask_completions WHERE subtask_id = ? AND week_key = ?",
        [data.subtask_id, data.week_key]
    ).fetchone()
    if existing:
        # Toggle off
        db.execute("DELETE FROM subtask_completions WHERE subtask_id = ? AND week_key = ?",
                    [data.subtask_id, data.week_key])
        db.commit()
        return {"ok": True, "completed": False}
    else:
        db.execute(
            "INSERT INTO subtask_completions (subtask_id, week_key, completed_at) VALUES (?, ?, ?)",
            [data.subtask_id, data.week_key, time.time()]
        )
        db.commit()
        return {"ok": True, "completed": True}


# ─── Scoreboard ─────────────────────────

@app.get("/api/scoreboard")
def scoreboard():
    rows = db.execute(
        "SELECT id, name, points FROM flatmates ORDER BY points DESC, name"
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/scoreboard/reset")
def reset_scoreboard():
    db.execute("UPDATE flatmates SET points = 0")
    db.commit()
    log_activity("scores_reset", "All scores were reset to zero")
    return {"ok": True}


# ─── Activity Log ───────────────────────

@app.get("/api/history")
def get_history(limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    rows = db.execute(
        "SELECT id, action, detail, actor, created_at FROM activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [limit, offset]
    ).fetchall()
    total = db.execute("SELECT COUNT(*) FROM activity_log").fetchone()[0]
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "has_more": offset + limit < total
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
