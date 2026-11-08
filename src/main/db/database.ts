import Database from 'better-sqlite3'

export type DB = Database.Database

/** Ordered, append-only migrations. Never edit a shipped entry; add a new one. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE employees (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    bio TEXT NOT NULL,
    desk_id TEXT NOT NULL,
    appearance TEXT NOT NULL
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    goal TEXT NOT NULL,
    phase TEXT NOT NULL,
    git_enabled INTEGER NOT NULL,
    base_branch TEXT,
    plan_summary TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acceptance TEXT NOT NULL,
    kind TEXT NOT NULL,
    assignee_id TEXT NOT NULL REFERENCES employees(id),
    status TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    result_summary TEXT,
    last_error TEXT,
    changed_files TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_tasks_project ON tasks(project_id);

  CREATE TABLE task_deps (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on)
  );

  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    session_id TEXT,
    cwd TEXT NOT NULL,
    model TEXT,
    cost_usd REAL,
    num_turns INTEGER,
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX idx_runs_project ON runs(project_id);

  CREATE TABLE run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    tool_name TEXT,
    is_error INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_run_events_run ON run_events(run_id, seq);

  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    resolution TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: adaptive execution, context reuse, local validation and real efficiency metrics
  `
  ALTER TABLE projects ADD COLUMN strategy TEXT;
  ALTER TABLE projects ADD COLUMN complexity TEXT;
  ALTER TABLE projects ADD COLUMN context_summary TEXT;

  ALTER TABLE tasks ADD COLUMN rationale TEXT;
  ALTER TABLE tasks ADD COLUMN size TEXT NOT NULL DEFAULT 'm';
  ALTER TABLE tasks ADD COLUMN files TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN validation TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN checks TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN model TEXT;
  ALTER TABLE tasks ADD COLUMN fix_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN conflicts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN started_at INTEGER;
  ALTER TABLE tasks ADD COLUMN finished_at INTEGER;

  ALTER TABLE runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'work';
  ALTER TABLE runs ADD COLUMN input_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN output_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN cache_read_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN cache_write_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN duration_ms INTEGER;
  ALTER TABLE runs ADD COLUMN api_ms INTEGER;
  ALTER TABLE runs ADD COLUMN pid INTEGER;
  UPDATE runs SET purpose = 'plan' WHERE kind = 'planning';
  `,
  // v3: capability-based staffing, priorities, consults, notifications, manager log
  `
  ALTER TABLE employees ADD COLUMN specialization TEXT NOT NULL DEFAULT '';
  ALTER TABLE employees ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE employees ADD COLUMN kinds TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE employees ADD COLUMN hired_at INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN consults INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN note TEXT;

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_notifications_created ON notifications(created_at);

  CREATE TABLE manager_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_manager_actions_project ON manager_actions(project_id, created_at);
  `,
  // v4: delivery lifecycle, validation history, project knowledge
  `
  ALTER TABLE tasks ADD COLUMN delivery_id TEXT;

  CREATE TABLE deliveries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id TEXT,
    number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    request TEXT NOT NULL,
    status TEXT NOT NULL,
    base_sha TEXT,
    head_sha TEXT,
    summary TEXT,
    limitations TEXT NOT NULL DEFAULT '[]',
    screenshot TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    decided_at INTEGER,
    decision_note TEXT
  );
  CREATE INDEX idx_deliveries_project ON deliveries(project_id, number);

  CREATE TABLE validations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    delivery_id TEXT,
    run_id TEXT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    checks TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX idx_validations_project ON validations(project_id, started_at);

  CREATE TABLE knowledge (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    files TEXT NOT NULL DEFAULT '[]',
    hashes TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_knowledge_project ON knowledge(project_id, created_at);
  `,
  // v5: long-term memory: topic-keyed facts with provenance and freshness, per-run context metrics
  `
  ALTER TABLE knowledge ADD COLUMN topic TEXT;
  ALTER TABLE knowledge ADD COLUMN title TEXT;
  ALTER TABLE knowledge ADD COLUMN rationale TEXT;
  ALTER TABLE knowledge ADD COLUMN alternatives TEXT;
  ALTER TABLE knowledge ADD COLUMN commit_sha TEXT;
  ALTER TABLE knowledge ADD COLUMN confidence TEXT NOT NULL DEFAULT 'reported';
  ALTER TABLE knowledge ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE knowledge ADD COLUMN author TEXT NOT NULL DEFAULT 'agent';
  ALTER TABLE knowledge ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE knowledge ADD COLUMN last_used_at INTEGER;
  ALTER TABLE knowledge ADD COLUMN updated_at INTEGER;
  UPDATE knowledge SET status = CASE WHEN stale = 1 THEN 'stale' ELSE 'active' END,
    topic = kind || ':' || id, title = substr(text, 1, 80), updated_at = created_at;
  CREATE UNIQUE INDEX idx_knowledge_topic ON knowledge(project_id, topic);

  ALTER TABLE runs ADD COLUMN context_ids TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE runs ADD COLUMN context_chars INTEGER;
  ALTER TABLE runs ADD COLUMN explore_calls INTEGER;
  `,
  // v6: skills engine: per-run routing record and reviewed third-party skill installs
  `
  ALTER TABLE runs ADD COLUMN skills TEXT;

  CREATE TABLE skill_installs (
    id TEXT PRIMARY KEY,
    catalog_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    path TEXT NOT NULL,
    sha TEXT NOT NULL,
    status TEXT NOT NULL,
    files TEXT NOT NULL DEFAULT '[]',
    findings TEXT NOT NULL DEFAULT '[]',
    skill_md TEXT NOT NULL DEFAULT '',
    downloaded_at INTEGER NOT NULL,
    approved_at INTEGER
  );
  `,
  // v7: quality engine: per-task plan and criteria reports, audit/visual reports, founder exceptions
  `
  ALTER TABLE tasks ADD COLUMN quality_plan TEXT;
  ALTER TABLE tasks ADD COLUMN criteria TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tasks ADD COLUMN repair_stop TEXT;
  CREATE TABLE quality_reports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    delivery_id TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    findings TEXT NOT NULL DEFAULT '[]',
    metrics TEXT NOT NULL DEFAULT '{}',
    shots TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX quality_reports_project ON quality_reports(project_id, started_at);
  CREATE TABLE quality_exceptions (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(delivery_id, dimension)
  );
  `,
  // v8: product mode: one product spec per project; tasks belong to milestones
  `
  ALTER TABLE tasks ADD COLUMN milestone INTEGER;
  CREATE TABLE product_specs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    spec TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v9: company director: per-project budget and pause
  `
  ALTER TABLE projects ADD COLUMN budget_usd REAL;
  ALTER TABLE projects ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
  `,
  // v10: execution engine: requested reasoning effort per run
  `
  ALTER TABLE runs ADD COLUMN effort TEXT;
  `,
  // v11: conversation: what you sent (text, attachments, target) and answers to questions
  `
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    intent TEXT NOT NULL,
    text TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    employee_id TEXT,
    task_id TEXT,
    delivery_id TEXT,
    run_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_project ON messages(project_id, created_at);
  `,
  // v12: why a memory was set aside (changed/removed file, superseded, conflicting decision)
  `
  ALTER TABLE knowledge ADD COLUMN status_note TEXT;
  `,
  // v13: the execution strategy each result used (telemetry per strategy)
  `
  ALTER TABLE deliveries ADD COLUMN strategy TEXT;
  `,
  // v14: no more Autopia budgets (Claude Code's own plan limits apply). Settings and history are kept;
  // only the old caps are cleared and any open "reached its budget" decision is closed.
  `
  UPDATE projects SET budget_usd = NULL;
  UPDATE approvals SET status = 'resolved', resolution = 'superseded: Autopia no longer uses budgets', resolved_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE kind = 'budget' AND status = 'pending';
  DELETE FROM settings WHERE key = 'maxBudgetUsdPerRun';
  `,
  // v15: task recovery: why an interrupted task stopped, what is preserved, and how it continues
  `
  ALTER TABLE tasks ADD COLUMN recovery TEXT;
  `,
  // v16: attention: what each notification is about, its cause, repeats, and when it was resolved.
  // Older notifications are history: they keep their text and count as resolved.
  `
  ALTER TABLE notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'info';
  ALTER TABLE notifications ADD COLUMN key TEXT;
  ALTER TABLE notifications ADD COLUMN approval_id TEXT;
  ALTER TABLE notifications ADD COLUMN delivery_id TEXT;
  ALTER TABLE notifications ADD COLUMN employee_id TEXT;
  ALTER TABLE notifications ADD COLUMN priority INTEGER NOT NULL DEFAULT 10;
  ALTER TABLE notifications ADD COLUMN count INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE notifications ADD COLUMN updated_at INTEGER;
  ALTER TABLE notifications ADD COLUMN resolved_at INTEGER;
  UPDATE notifications SET updated_at = created_at, resolved_at = created_at, read = 1;
  CREATE INDEX idx_notifications_open ON notifications(resolved_at, key);
  `,
  // v17: offices. Each project lives in an office type; new projects get their own team. Existing
  // projects stay in the original Tech Startup with the original team (project_id NULL).
  `
  ALTER TABLE projects ADD COLUMN office_type TEXT NOT NULL DEFAULT 'startup';
  ALTER TABLE employees ADD COLUMN project_id TEXT;
  CREATE INDEX idx_employees_project ON employees(project_id);
  `,
  // v18: what a result did when it was actually run in the project folder
  `
  ALTER TABLE deliveries ADD COLUMN verification TEXT;
  `,
  // v19: who an instruction sent during the work reached
  `
  ALTER TABLE messages ADD COLUMN routing TEXT;
  `,
  // v20: the code map: what each source file defines and calls, updated file by file
  `
  CREATE TABLE code_files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    mtime REAL NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (project_id, file)
  );
  CREATE TABLE code_symbols (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    exported INTEGER NOT NULL
  );
  CREATE INDEX idx_code_symbols ON code_symbols(project_id, file);
  CREATE TABLE code_refs (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    name TEXT NOT NULL
  );
  CREATE INDEX idx_code_refs ON code_refs(project_id, name);
  CREATE INDEX idx_code_refs_file ON code_refs(project_id, file);
  `,
  // v21: a check run knows what it ran and exactly which code it ran against
  `
  ALTER TABLE validations ADD COLUMN command TEXT;
  ALTER TABLE validations ADD COLUMN stamp TEXT;
  `
]

export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  migrate(db)
  return db
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
