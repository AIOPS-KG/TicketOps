"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const { Pool, types } = require("pg");

types.setTypeParser(20, v => parseInt(v, 10));

const PORT = Number(process.env.PORT) || 5060;
const pool = new Pool({
  host:     process.env.PGHOST     || "postgres",
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "ticketops_app",
  user:     process.env.PGUSER     || "ticketops",
  password: process.env.PGPASSWORD || "Ticketops@2024!",
  max: 10,
});

function pq(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }
async function qGet(sql, p = []) { const { rows } = await pool.query(pq(sql), p); return rows[0] || null; }
async function qAll(sql, p = []) { const { rows } = await pool.query(pq(sql), p); return rows; }
async function qRun(sql, p = []) { return pool.query(pq(sql), p); }

function nextId(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}
function dateKey() { return new Date().toISOString().slice(0, 10); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 2_000_000) { reject(new Error("Payload too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : null); } catch { reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 })); } });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Access-Control-Allow-Origin": "*" });
  res.end(body);
}
function sendError(res, status, msg) { send(res, status, { ok: false, error: msg }); }

/* user helpers */
function publicUser(u) {
  const views = Array.isArray(u.allowed_views) ? u.allowed_views : [];
  const outlets = Array.isArray(u.allowed_outlets) ? u.allowed_outlets : [];
  const allowedViews = views.length ? views : defaultViews(u.role);
  return {
    id: u.id, username: u.username, name: u.name, post: u.post, role: u.role,
    technicianId: u.technician_id || "",
    accessAllOutlets: !!u.access_all_outlets,
    allowedOutlets: outlets,
    outlet: u.outlet || "",
    defaultView: u.default_view || defaultViewForRole(u.role),
    allowedViews,
  };
}
function defaultViewForRole(role) {
  if (role === "manager") return "manager";
  if (role === "technician") return "technician";
  return "dashboard";
}
function defaultViews(role) {
  if (role === "admin") return ["dashboard", "manager", "admin", "masters", "scheduler", "history", "reports"];
  if (role === "manager") return ["manager"];
  if (role === "technician") return ["technician"];
  return ["dashboard"];
}

/* data loaders */
async function getAllUsers() { return qAll("SELECT * FROM to_users ORDER BY id"); }
async function getUserById(id) { return qGet("SELECT * FROM to_users WHERE id = ?", [String(id)]); }
async function getUserByUsername(u) { return qGet("SELECT * FROM to_users WHERE lower(username) = lower(?)", [String(u)]); }

async function loadOutlets() {
  const rows = await qAll("SELECT name FROM to_outlets ORDER BY name");
  const locs = await qAll("SELECT * FROM to_outlet_locations");
  const locMap = {};
  for (const l of locs) locMap[l.outlet_name] = { branch: l.branch || "", address: l.address || "", latitude: l.latitude, longitude: l.longitude };
  return { outlets: rows.map(o => o.name), outletLocations: locMap };
}

async function loadCategories() {
  return (await qAll("SELECT * FROM to_categories ORDER BY name")).map(r => ({ id: r.id, name: r.name, description: r.description || "" }));
}

async function loadAssets() {
  return (await qAll("SELECT * FROM to_assets ORDER BY name")).map(r => ({
    id: r.id, name: r.name, category: r.category, outlet: r.outlet, status: r.status,
    make: r.make || "", model: r.model || "", serialNo: r.serial_no || "",
    installedAt: r.installed_at || "", warrantyUntil: r.warranty_until || "", notes: r.notes || "",
    ...(r.extra || {}),
  }));
}

async function loadTechnicians() {
  return (await qAll("SELECT * FROM to_technicians ORDER BY name")).map(r => ({
    id: r.id, name: r.name,
    skill: Array.isArray(r.skill) ? r.skill : [],
    status: r.status,
    quality: r.quality || 0,
    serviceOutlets: Array.isArray(r.service_outlets) ? r.service_outlets : [],
  }));
}

async function loadTickets() {
  return (await qAll("SELECT * FROM to_tickets ORDER BY created_at DESC")).map(r => ({
    id: r.id, outlet: r.outlet, category: r.category, assetId: r.asset_id,
    impact: r.impact, area: r.area || "", note: r.note || "",
    priority: r.priority, status: r.status,
    assignedTo: r.assigned_to || "", scheduledAt: r.scheduled_at || "",
    photoUrl: r.photo_url || "", photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
    createdBy: r.created_by || "",
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    latestDetail: r.latest_detail || "",
    closePrice: r.close_price || 0, closePriceBy: r.close_price_by || "", closePriceAt: r.close_price_at || "",
    evidencePhotoUrl: r.evidence_photo_url || "",
    evidencePhotoUrls: Array.isArray(r.evidence_photo_urls) ? r.evidence_photo_urls : [],
  }));
}

async function loadTasks() {
  return (await qAll("SELECT * FROM to_tasks ORDER BY date, id")).map(r => ({
    id: r.id, title: r.title, assetId: r.asset_id || "", outlet: r.outlet || "",
    assignedTo: r.assigned_to || "", ruleId: r.rule_id || "",
    status: r.status, date: r.date || "",
    completedAt: r.completed_at || "", notes: r.notes || "",
    evidenceComment: r.evidence_comment || "",
    photoUrl: r.photo_url || "",
    photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
  }));
}

async function loadMaintenanceRules() {
  return (await qAll("SELECT * FROM to_maintenance_rules ORDER BY title")).map(r => ({
    id: r.id, title: r.title, category: r.category,
    frequency: r.frequency, phase: r.phase || "Checklist",
    group: r.rule_group || "Maintenance", outlet: r.outlet || "",
    active: r.active !== false,
    recurrenceDayOfWeek: r.recurrence_day_of_week,
    recurrenceDayOfMonth: r.recurrence_day_of_month,
    recurrenceMonths: Array.isArray(r.recurrence_months) ? r.recurrence_months : [],
    assignedTechnicianId: r.assigned_technician_id || "",
    allowOutsideWindow: !!r.allow_outside_window,
  }));
}

async function loadAssignmentWindows() {
  return (await qAll("SELECT * FROM to_assignment_windows ORDER BY id")).map(r => ({ id: r.id, ...r.data }));
}

async function loadAttendancePlans() {
  return (await qAll("SELECT * FROM to_attendance_plans ORDER BY created_at")).map(r => ({
    id: r.id, technicianId: r.technician_id, status: r.status,
    startsAt: r.starts_at || "", endsAt: r.ends_at || "",
    reason: r.reason || "", createdBy: r.created_by || "",
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
}

/* reports */
function computeReports(tickets, tasks, technicians, outlets) {
  const closed = tickets.filter(t => t.status === "Closed");
  const done = tasks.filter(t => t.status === "Done").length;
  const closePriceTotal = closed.reduce((s, t) => s + Number(t.closePrice || 0), 0);
  return {
    open: tickets.filter(t => !["Closed", "Cancelled"].includes(t.status)).length,
    closed: closed.length, total: tickets.length,
    closePriceTotal, closePriceCount: closed.filter(t => Number(t.closePrice || 0) > 0).length,
    taskCompletionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    technicianCount: technicians.length,
    byOutlet: outlets.map(outlet => ({
      outlet,
      count: tickets.filter(t => t.outlet === outlet).length,
      open: tickets.filter(t => t.outlet === outlet && !["Closed", "Cancelled"].includes(t.status)).length,
      closed: tickets.filter(t => t.outlet === outlet && t.status === "Closed").length,
      closePriceTotal: tickets.filter(t => t.outlet === outlet && t.status === "Closed").reduce((s, t) => s + Number(t.closePrice || 0), 0),
    })),
  };
}

function scopeDb(full, user) {
  if (!user || user.role === "admin") return full;
  const db = { ...full };
  if (user.role === "manager") {
    const allowed = user.accessAllOutlets ? full.outlets : (user.allowedOutlets?.length ? user.allowedOutlets : (user.outlet ? [user.outlet] : []));
    db.assets = full.assets.filter(a => allowed.includes(a.outlet));
    db.tasks = full.tasks.filter(t => allowed.includes(t.outlet));
    db.tickets = full.tickets.filter(t => allowed.includes(t.outlet));
  }
  if (user.role === "technician" && user.technicianId) {
    db.technicians = full.technicians.filter(t => t.id === user.technicianId);
    db.tasks = full.tasks.filter(t => t.assignedTo === user.technicianId);
    db.tickets = full.tickets.filter(t => t.assignedTo === user.technicianId || t.createdBy === user.id);
  }
  return db;
}

async function buildFullState(user) {
  const allUsers = await getAllUsers();
  const { outlets, outletLocations } = await loadOutlets();
  const categories = await loadCategories();
  const assets = await loadAssets();
  const technicians = await loadTechnicians();
  const tickets = await loadTickets();
  const tasks = await loadTasks();
  const maintenanceRules = await loadMaintenanceRules();
  const assignmentTimeWindows = await loadAssignmentWindows();
  const attendancePlans = await loadAttendancePlans();
  const full = {
    users: allUsers.map(publicUser), outlets, outletLocations, categories, assets, technicians,
    tickets, tasks, maintenanceRules, assignmentTimeWindows, attendancePlans, ticketHistory: [],
  };
  const scoped = scopeDb(full, user);
  scoped.reports = computeReports(scoped.tickets, scoped.tasks, scoped.technicians, outlets);
  scoped.storage = "postgresql";
  scoped.stitch = { configured: false, endpoint: "" };
  return scoped;
}

/* maintenance task generation */
function isRuleDue(rule, day) {
  const date = new Date(day + "T00:00:00");
  const dow = date.getDay(), dom = date.getDate(), month = date.getMonth();
  const freq = String(rule.frequency || "daily").toLowerCase();
  if (freq === "daily") return true;
  if (freq === "weekly") return dow === (Number.isInteger(rule.recurrenceDayOfWeek) ? rule.recurrenceDayOfWeek : 1);
  const maxDom = new Date(date.getFullYear(), month + 1, 0).getDate();
  const targetDom = Math.min(rule.recurrenceDayOfMonth != null ? rule.recurrenceDayOfMonth : 1, maxDom);
  if (freq === "monthly") return dom === targetDom;
  const defaults = { quarterly: [0,3,6,9], "half-yearly": [0,6], yearly: [0] };
  const targetMonths = (Array.isArray(rule.recurrenceMonths) && rule.recurrenceMonths.length) ? rule.recurrenceMonths : (defaults[freq] || []);
  return targetMonths.includes(month) && dom === targetDom;
}

async function refreshTodayTasks() {
  const day = dateKey();
  const rules = (await loadMaintenanceRules()).filter(r => r.active && isRuleDue(r, day));
  if (!rules.length) return 0;
  const technicians = (await loadTechnicians()).sort((a, b) => a.name.localeCompare(b.name));
  const existing = await qAll("SELECT id, outlet, rule_id, assigned_to FROM to_tasks WHERE date = ?", [day]);
  const existingKeys = new Set(existing.map(t => `${t.outlet}|${t.rule_id}`));
  const existingIds = new Set(existing.map(t => t.id));
  const loadMap = {};
  for (const tech of technicians) loadMap[tech.id] = existing.filter(t => t.assigned_to === tech.id).length;
  const { outlets } = await loadOutlets();
  const assets = await loadAssets();
  let seq = existing.length + 1;
  function nextTaskId() {
    const base = "TASK-" + day.replace(/-/g, "") + "-";
    let id = base + String(seq).padStart(3, "0");
    while (existingIds.has(id)) { seq++; id = base + String(seq).padStart(3, "0"); }
    existingIds.add(id); seq++;
    return id;
  }
  let added = 0;
  for (const outlet of outlets) {
    const outletAssets = assets.filter(a => a.status === "Active" && a.outlet === outlet);
    for (const rule of rules) {
      if (rule.outlet && rule.outlet !== outlet) continue;
      const taskKey = `${outlet}|${rule.id}`;
      if (existingKeys.has(taskKey)) continue;
      const eligible = technicians.filter(t => !t.serviceOutlets?.length || t.serviceOutlets.includes(outlet));
      if (!eligible.length) continue;
      const preferred = rule.assignedTechnicianId ? eligible.find(t => t.id === rule.assignedTechnicianId) : null;
      const tech = preferred || eligible.reduce((best, t) => {
        if (!best) return t;
        const bl = loadMap[best.id] || 0, tl = loadMap[t.id] || 0;
        return tl < bl || (tl === bl && t.name.localeCompare(best.name) < 0) ? t : best;
      }, null);
      if (!tech) continue;
      const asset = outletAssets.find(a => a.category === rule.category) || outletAssets[0];
      if (!asset) continue;
      const id = nextTaskId();
      const title = (rule.phase || "Checklist") + ": " + rule.title;
      const notes = (rule.group || "Maintenance") + " / " + rule.frequency + (rule.allowOutsideWindow ? " / outside window allowed" : "");
      await qRun("INSERT INTO to_tasks (id,title,asset_id,outlet,assigned_to,rule_id,status,date,completed_at,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, title, asset.id, outlet, tech.id, rule.id, "Pending", day, "", notes]);
      existingKeys.add(taskKey);
      loadMap[tech.id] = (loadMap[tech.id] || 0) + 1;
      added++;
    }
  }
  return added;
}

function priorityForImpact(impact) {
  if (impact === "Service stopped" || impact === "Food safety risk") return "P1";
  if (impact === "Customer visible") return "P2";
  if (impact === "Cosmetic") return "P4";
  return "P3";
}

function csvCell(v) {
  const text = Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : String(v == null ? "" : v);
  return '"' + text.replace(/"/g, '""') + '"';
}
function toCsv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  return [keys.join(","), ...rows.map(r => keys.map(k => csvCell(r[k])).join(","))].join("\n");
}

async function seed() {
  const n = await qGet("SELECT COUNT(*) AS n FROM to_users");
  if (Number(n.n) > 0) return;
  const users = [
    { id: "U-ADMIN-AIOPS", username: "aiops", password_plain: "AIops", name: "AIops", post: "Admin Control Panel Operator", role: "admin", access_all_outlets: true, allowed_outlets: [], default_view: "dashboard", allowed_views: ["dashboard","manager","admin","masters","scheduler","history","reports"], technician_id: null, outlet: null },
    { id: "U-MGR-PRATIK", username: "pratik.patel", password_plain: "pratik123", name: "Pratik Patel", post: "Outlet Manager", role: "manager", access_all_outlets: true, allowed_outlets: [], default_view: "manager", allowed_views: ["manager"], technician_id: null, outlet: "aiko surat" },
    { id: "U-TECH-VICKY", username: "vicky", password_plain: "vicky123", name: "Vicky", post: "Technician", role: "technician", access_all_outlets: false, allowed_outlets: ["aiko surat","Capiche"], default_view: "technician", allowed_views: ["technician"], technician_id: "T1", outlet: null },
  ];
  for (const u of users) {
    await qRun("INSERT INTO to_users (id,username,password_plain,name,post,role,access_all_outlets,allowed_outlets,outlet,default_view,allowed_views,technician_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [u.id, u.username, u.password_plain, u.name, u.post, u.role, u.access_all_outlets, JSON.stringify(u.allowed_outlets), u.outlet, u.default_view, JSON.stringify(u.allowed_views), u.technician_id]);
  }
  await qRun("INSERT INTO to_outlets (name) VALUES (?),(?)", ["aiko surat", "Capiche"]);
  await qRun("INSERT INTO to_outlet_locations (outlet_name,address) VALUES (?,'Surat'),(?,'Surat')", ["aiko surat", "Capiche"]);
  for (const [id, name, desc] of [["C-AC","AC","Air conditioning"],["C-REF","Refrigeration","Freezers, chillers"],["C-ELEC","Electrical","Power, panels"],["C-PLUMB","Plumbing","Water supply, drains"],["C-KITCHEN","Kitchen Equipment","Ovens, fryers"]]) {
    await qRun("INSERT INTO to_categories (id,name,description) VALUES (?,?,?)", [id, name, desc]);
  }
  await qRun("INSERT INTO to_technicians (id,name,skill,status,quality,service_outlets) VALUES (?,?,?,?,?,?)",
    ["T1", "Vicky", JSON.stringify(["AC","Electrical"]), "Present", 92, JSON.stringify(["aiko surat","Capiche"])]);
  console.log("Default seed data inserted.");
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS to_users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_plain TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '', post TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user',
      technician_id TEXT, access_all_outlets BOOLEAN NOT NULL DEFAULT FALSE,
      allowed_outlets JSONB NOT NULL DEFAULT '[]', outlet TEXT,
      default_view TEXT NOT NULL DEFAULT 'dashboard', allowed_views JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS to_outlets (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS to_outlet_locations (
      outlet_name TEXT PRIMARY KEY REFERENCES to_outlets(name) ON DELETE CASCADE,
      branch TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION
    );
    CREATE TABLE IF NOT EXISTS to_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS to_assets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      outlet TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Active',
      make TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      serial_no TEXT NOT NULL DEFAULT '', installed_at TEXT NOT NULL DEFAULT '',
      warranty_until TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      extra JSONB NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS to_technicians (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
      skill JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'Present',
      quality INTEGER NOT NULL DEFAULT 0, service_outlets JSONB NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS to_tickets (
      id TEXT PRIMARY KEY, outlet TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      asset_id TEXT NOT NULL DEFAULT '', impact TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'P3', status TEXT NOT NULL DEFAULT 'New',
      assigned_to TEXT NOT NULL DEFAULT '', scheduled_at TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '', photo_urls JSONB NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      latest_detail TEXT NOT NULL DEFAULT '', close_price DOUBLE PRECISION,
      close_price_by TEXT, close_price_at TEXT,
      evidence_photo_url TEXT NOT NULL DEFAULT '', evidence_photo_urls JSONB NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS to_tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', asset_id TEXT NOT NULL DEFAULT '',
      outlet TEXT NOT NULL DEFAULT '', assigned_to TEXT NOT NULL DEFAULT '',
      rule_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Pending',
      date TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', evidence_comment TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '', photo_urls JSONB NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS to_maintenance_rules (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
      frequency TEXT NOT NULL DEFAULT 'daily', phase TEXT NOT NULL DEFAULT 'Checklist',
      rule_group TEXT NOT NULL DEFAULT 'Maintenance', outlet TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      recurrence_day_of_week INTEGER, recurrence_day_of_month INTEGER,
      recurrence_months JSONB NOT NULL DEFAULT '[]',
      assigned_technician_id TEXT NOT NULL DEFAULT '',
      allow_outside_window BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS to_assignment_windows (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS to_attendance_plans (
      id TEXT PRIMARY KEY, technician_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Present', starts_at TEXT NOT NULL DEFAULT '',
      ends_at TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_to_tickets_status ON to_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_to_tickets_outlet ON to_tickets(outlet);
    CREATE INDEX IF NOT EXISTS idx_to_tasks_date ON to_tasks(date);
    CREATE INDEX IF NOT EXISTS idx_to_tasks_assigned ON to_tasks(assigned_to);
  `);
}

/* ===== request handler ===== */
async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-TicketOps-User,X-TicketOps-Role" });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const m = req.method.toUpperCase();

  if (!pathname.startsWith("/api/")) { res.writeHead(404); return res.end("Not found"); }

  try {
    const allUsers = await getAllUsers();
    const userId = req.headers["x-ticketops-user"] || "";
    const user = userId ? allUsers.find(u => u.id === userId) : null;
    const pu = user ? publicUser(user) : null;

    function requireAuth() { if (!pu) { sendError(res, 401, "Login required"); return false; } return true; }
    function requireAdmin() { if (!pu || pu.role !== "admin") { sendError(res, 403, "Admin only"); return false; } return true; }

    /* health */
    if (pathname === "/api/health" && m === "GET") return send(res, 200, { ok: true, name: "TicketOps Local API", storage: "postgresql" });

    /* stitch stubs */
    if (pathname === "/api/stitch/status" && m === "GET") return send(res, 200, { configured: false, connected: false, endpoint: "", tools: [] });
    if (pathname === "/api/stitch/call" && m === "POST") return sendError(res, 503, "Stitch not configured");

    /* auth */
    if (pathname === "/api/auth/login" && m === "POST") {
      const body = await readBody(req) || {};
      const uname = String(body.username || "").trim().toLowerCase();
      const pw = String(body.password || "");
      const u = await getUserByUsername(uname);
      if (!u || u.password_plain !== pw) return sendError(res, 401, "Invalid username or password");
      return send(res, 200, { user: publicUser(u) });
    }
    if (pathname === "/api/auth/demo-users" && m === "GET") return send(res, 200, { users: allUsers.map(publicUser) });
    if (pathname === "/api/auth/change-password" && m === "POST") {
      if (!requireAuth()) return;
      const body = await readBody(req) || {};
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (user.password_plain !== current) return sendError(res, 400, "Current password is incorrect");
      if (next.length < 8) return sendError(res, 400, "New password must be at least 8 characters");
      if (next !== String(body.confirmPassword || "")) return sendError(res, 400, "Passwords do not match");
      await qRun("UPDATE to_users SET password_plain = ? WHERE id = ?", [next, user.id]);
      return send(res, 200, { ok: true });
    }

    /* admin reset password */
    const resetPwMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (resetPwMatch && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const targetId = decodeURIComponent(resetPwMatch[1]);
      const target = allUsers.find(u => u.id === targetId);
      if (!target) return sendError(res, 404, "User not found");
      const pw = String(body.newPassword || ("Tmp-" + crypto.randomUUID().slice(0, 8)));
      if (pw.length < 8) return sendError(res, 400, "Password must be at least 8 characters");
      await qRun("UPDATE to_users SET password_plain = ? WHERE id = ?", [pw, targetId]);
      return send(res, 200, { ok: true, username: target.username, temporaryPassword: pw });
    }

    /* bootstrap */
    if (pathname === "/api/bootstrap" && m === "GET") {
      if (!requireAuth()) return;
      await refreshTodayTasks();
      return send(res, 200, await buildFullState(pu));
    }

    /* categories list */
    if (pathname === "/api/categories" && m === "GET") {
      if (!requireAdmin()) return;
      return send(res, 200, await loadCategories());
    }

    /* technician dashboard */
    if (pathname === "/api/technician/dashboard" && m === "GET") {
      if (!pu || pu.role !== "technician") return sendError(res, 403, "Technician only");
      const [techs, tasks, tickets] = await Promise.all([loadTechnicians(), loadTasks(), loadTickets()]);
      const techId = pu.technicianId;
      return send(res, 200, { technician: techs.find(t => t.id === techId) || null, tasks: tasks.filter(t => t.assignedTo === techId), tickets: tickets.filter(t => t.assignedTo === techId) });
    }
    if (pathname === "/api/technician/tasks/today" && m === "GET") {
      if (!pu || pu.role !== "technician") return sendError(res, 403, "Technician only");
      const today = dateKey();
      return send(res, 200, (await loadTasks()).filter(t => t.assignedTo === pu.technicianId && (!t.date || t.date === today)));
    }
    const techTaskMatch = pathname.match(/^\/api\/technician\/tasks\/([^/]+)\/status$/);
    if (techTaskMatch && m === "POST") {
      if (!pu || pu.role !== "technician") return sendError(res, 403, "Technician only");
      const body = await readBody(req) || {};
      const taskId = decodeURIComponent(techTaskMatch[1]);
      const status = body.status === "done" ? "Done" : "Not Done";
      await qRun("UPDATE to_tasks SET status=?,completed_at=?,evidence_comment=?,photo_url=?,photo_urls=? WHERE id=?",
        [status, status === "Done" ? new Date().toISOString() : "", body.comment || "", body.photoUrl || "", JSON.stringify(body.photoUrls || []), taskId]);
      const state = await buildFullState(pu);
      return send(res, 200, { task: (await loadTasks()).find(t => t.id === taskId), reports: state.reports });
    }

    /* task status (general) */
    const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
    if (taskStatusMatch && m === "PATCH") {
      if (!requireAuth()) return;
      const body = await readBody(req) || {};
      const taskId = decodeURIComponent(taskStatusMatch[1]);
      const status = body.status || "Done";
      await qRun("UPDATE to_tasks SET status=?,completed_at=?,evidence_comment=?,photo_url=?,photo_urls=? WHERE id=?",
        [status, status === "Done" ? new Date().toISOString() : "", body.comment || "", body.photoUrl || "", JSON.stringify(body.photoUrls || []), taskId]);
      const state = await buildFullState(pu);
      return send(res, 200, { task: (await loadTasks()).find(t => t.id === taskId), reports: state.reports });
    }
    const taskDeleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskDeleteMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_tasks WHERE id = ?", [decodeURIComponent(taskDeleteMatch[1])]);
      return send(res, 200, { ok: true });
    }
    if (pathname === "/api/tasks/refresh" && m === "POST") {
      if (!requireAdmin()) return;
      return send(res, 200, { generated: await refreshTodayTasks(), date: dateKey() });
    }

    /* tickets */
    if (pathname === "/api/tickets" && m === "POST") {
      if (!requireAuth()) return;
      const body = await readBody(req) || {};
      if (!body.outlet || !body.category || !body.impact) return sendError(res, 400, "outlet, category and impact are required");
      const id = nextId("TK-");
      await qRun("INSERT INTO to_tickets (id,outlet,category,asset_id,impact,area,note,priority,status,assigned_to,scheduled_at,photo_url,photo_urls,created_by,latest_detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, body.outlet, body.category, body.assetId||"", body.impact, body.area||"", body.note||"", priorityForImpact(body.impact), body.assignedTo?"Assigned":"New", body.assignedTo||"", body.scheduledAt||"", body.photoUrl||"", JSON.stringify(body.photoUrls||[]), pu.id, body.note||"Created"]);
      return send(res, 201, (await loadTickets()).find(t => t.id === id));
    }
    const ticketAssignMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/assign$/);
    if (ticketAssignMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(ticketAssignMatch[1]);
      const techId = body.technicianId || body.assignedTo || "";
      await qRun("UPDATE to_tickets SET assigned_to=?,scheduled_at=?,status=?,latest_detail='Assigned',updated_at=NOW() WHERE id=?", [techId, body.scheduledAt||"", techId?"Assigned":"New", id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ticket: (await loadTickets()).find(t => t.id === id), reports: state.reports });
    }
    const ticketScheduleMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/schedule$/);
    if (ticketScheduleMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(ticketScheduleMatch[1]);
      await qRun("UPDATE to_tickets SET scheduled_at=?,updated_at=NOW() WHERE id=?", [body.scheduledAt||"", id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ticket: (await loadTickets()).find(t => t.id === id), reports: state.reports });
    }
    const ticketAcceptMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/accept$/);
    if (ticketAcceptMatch && m === "POST") {
      if (!pu || pu.role !== "technician") return sendError(res, 403, "Technician only");
      const id = decodeURIComponent(ticketAcceptMatch[1]);
      await qRun("UPDATE to_tickets SET status='Acknowledged',latest_detail='Accepted by technician',updated_at=NOW() WHERE id=?", [id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ticket: (await loadTickets()).find(t => t.id === id), reports: state.reports });
    }
    const ticketRejectMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/reject$/);
    if (ticketRejectMatch && m === "POST") {
      if (!pu || pu.role !== "technician") return sendError(res, 403, "Technician only");
      const body = await readBody(req) || {};
      const id = decodeURIComponent(ticketRejectMatch[1]);
      await qRun("UPDATE to_tickets SET status='New',assigned_to='',latest_detail=?,updated_at=NOW() WHERE id=?", [body.reason||"Rejected", id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ticket: (await loadTickets()).find(t => t.id === id), reports: state.reports });
    }
    const ticketUnassignMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/assignment$/);
    if (ticketUnassignMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      const id = decodeURIComponent(ticketUnassignMatch[1]);
      await qRun("UPDATE to_tickets SET status='New',assigned_to='',scheduled_at='',updated_at=NOW() WHERE id=?", [id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ticket: (await loadTickets()).find(t => t.id === id), reports: state.reports });
    }
    const ticketStatusMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/status$/);
    if (ticketStatusMatch && m === "PATCH") {
      if (!requireAuth()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(ticketStatusMatch[1]);
      const sets = ["status=?","latest_detail=?","evidence_photo_url=?","evidence_photo_urls=?","updated_at=NOW()"];
      const vals = [body.status, body.detail||body.status, body.evidencePhotoUrl||"", JSON.stringify(body.evidencePhotoUrls||[])];
      if (body.status === "Closed" && Number(body.closePrice||0) > 0) {
        sets.push("close_price=?","close_price_by=?","close_price_at=?");
        vals.push(Number(body.closePrice), body.closePriceBy||pu.id, body.closePriceAt||new Date().toISOString());
      }
      vals.push(id);
      await qRun(`UPDATE to_tickets SET ${sets.join(",")} WHERE id=?`, vals);
      const state = await buildFullState(pu);
      return send(res, 200, { ticket: (await loadTickets()).find(t => t.id === id), reports: state.reports });
    }
    const ticketDeleteMatch = pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (ticketDeleteMatch && m === "DELETE") {
      if (!requireAuth()) return;
      await qRun("DELETE FROM to_tickets WHERE id = ?", [decodeURIComponent(ticketDeleteMatch[1])]);
      return send(res, 200, { ok: true });
    }

    /* technician status / attendance */
    const techStatusMatch = pathname.match(/^\/api\/technicians\/([^/]+)\/status$/);
    if (techStatusMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(techStatusMatch[1]);
      await qRun("UPDATE to_technicians SET status = ? WHERE id = ?", [body.status, id]);
      const state = await buildFullState(pu);
      return send(res, 200, { technician: (await loadTechnicians()).find(t => t.id === id), reports: state.reports });
    }
    const techAttendMatch = pathname.match(/^\/api\/technicians\/([^/]+)\/attendance$/);
    if (techAttendMatch && m === "POST") {
      if (!requireAuth()) return;
      const body = await readBody(req) || {};
      const techId = decodeURIComponent(techAttendMatch[1]);
      if (!await qGet("SELECT id FROM to_technicians WHERE id=?", [techId])) return sendError(res, 404, "Technician not found");
      await qRun("UPDATE to_technicians SET status=? WHERE id=?", [body.status||"Present", techId]);
      const planId = nextId("ATT-");
      await qRun("INSERT INTO to_attendance_plans (id,technician_id,status,starts_at,ends_at,reason,created_by) VALUES (?,?,?,?,?,?,?)",
        [planId, techId, body.status||"Present", body.startsAt||new Date().toISOString(), body.endsAt||"", body.reason||"", pu.name||pu.username]);
      const state = await buildFullState(pu);
      return send(res, 201, { plan: (await loadAttendancePlans()).find(p => p.id === planId), reports: state.reports });
    }

    /* CRUD: outlets */
    if (pathname === "/api/outlets" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const name = String(body.name||"").trim();
      if (!name) return sendError(res, 400, "Outlet name is required");
      try { await qRun("INSERT INTO to_outlets (name) VALUES (?)", [name]); } catch(e) { if (e.code !== "23505") throw e; }
      await qRun("INSERT INTO to_outlet_locations (outlet_name,branch,address,latitude,longitude) VALUES (?,?,?,?,?) ON CONFLICT(outlet_name) DO NOTHING",
        [name, body.branch||"", body.address||"", body.latitude||null, body.longitude||null]);
      const state = await buildFullState(pu);
      return send(res, 200, { name, reports: state.reports });
    }
    const outletMatch = pathname.match(/^\/api\/outlets\/(.+)$/);
    if (outletMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const oldName = decodeURIComponent(outletMatch[1]);
      const newName = String(body.name||oldName).trim();
      if (newName !== oldName) {
        await qRun("INSERT INTO to_outlets (name) VALUES (?) ON CONFLICT DO NOTHING", [newName]);
        for (const tbl of ["to_assets","to_tickets","to_tasks","to_maintenance_rules"]) await qRun(`UPDATE ${tbl} SET outlet=? WHERE outlet=?`, [newName, oldName]);
        await qRun("UPDATE to_outlet_locations SET outlet_name=? WHERE outlet_name=?", [newName, oldName]);
        await qRun("DELETE FROM to_outlets WHERE name=?", [oldName]);
      }
      await qRun("INSERT INTO to_outlet_locations (outlet_name,branch,address,latitude,longitude) VALUES (?,?,?,?,?) ON CONFLICT(outlet_name) DO UPDATE SET branch=EXCLUDED.branch,address=EXCLUDED.address,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude",
        [newName, body.branch||"", body.address||"", body.latitude||null, body.longitude||null]);
      const state = await buildFullState(pu);
      return send(res, 200, { name: newName, reports: state.reports });
    }
    if (outletMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_outlets WHERE name=?", [decodeURIComponent(outletMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* CRUD: categories */
    if (pathname === "/api/categories" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = body.id || nextId("C-");
      await qRun("INSERT INTO to_categories (id,name,description) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description",
        [id, String(body.name||""), String(body.description||"")]);
      const state = await buildFullState(pu);
      return send(res, 200, { id, name: body.name, description: body.description, reports: state.reports });
    }
    const catMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
    if (catMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(catMatch[1]);
      if (body.name !== undefined) await qRun("UPDATE to_categories SET name=? WHERE id=?", [body.name, id]);
      if (body.description !== undefined) await qRun("UPDATE to_categories SET description=? WHERE id=?", [body.description, id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await qGet("SELECT * FROM to_categories WHERE id=?", [id])), reports: state.reports });
    }
    if (catMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_categories WHERE id=?", [decodeURIComponent(catMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* CRUD: assets */
    if (pathname === "/api/assets" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = body.id || nextId("A-");
      const { id:_, name, category, outlet, status, make, model, serialNo, installedAt, warrantyUntil, notes, ...extra } = body;
      await qRun("INSERT INTO to_assets (id,name,category,outlet,status,make,model,serial_no,installed_at,warranty_until,notes,extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, String(name||""), String(category||""), String(outlet||""), String(status||"Active"), String(make||""), String(model||""), String(serialNo||""), String(installedAt||""), String(warrantyUntil||""), String(notes||""), JSON.stringify(extra||{})]);
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await loadAssets()).find(a => a.id === id), reports: state.reports });
    }
    const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (assetMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(assetMatch[1]);
      const sets = []; const vals = [];
      for (const [k,col] of [["name","name"],["category","category"],["outlet","outlet"],["status","status"],["make","make"],["model","model"],["serialNo","serial_no"],["installedAt","installed_at"],["warrantyUntil","warranty_until"],["notes","notes"]]) {
        if (body[k] !== undefined) { sets.push(`${col}=?`); vals.push(body[k]); }
      }
      if (sets.length) { vals.push(id); await qRun(`UPDATE to_assets SET ${sets.join(",")} WHERE id=?`, vals); }
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await loadAssets()).find(a => a.id === id), reports: state.reports });
    }
    if (assetMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_assets WHERE id=?", [decodeURIComponent(assetMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* CRUD: technicians */
    if (pathname === "/api/technicians" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = body.id || nextId("T");
      await qRun("INSERT INTO to_technicians (id,name,skill,status,quality,service_outlets) VALUES (?,?,?,?,?,?)",
        [id, String(body.name||""), JSON.stringify(body.skill||[]), String(body.status||"Present"), Number(body.quality||0), JSON.stringify(body.serviceOutlets||[])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await loadTechnicians()).find(t => t.id === id), reports: state.reports });
    }
    const techCrudMatch = pathname.match(/^\/api\/technicians\/([^/]+)$/);
    if (techCrudMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(techCrudMatch[1]);
      const sets = []; const vals = [];
      if (body.name !== undefined) { sets.push("name=?"); vals.push(body.name); }
      if (body.skill !== undefined) { sets.push("skill=?"); vals.push(JSON.stringify(body.skill)); }
      if (body.status !== undefined) { sets.push("status=?"); vals.push(body.status); }
      if (body.quality !== undefined) { sets.push("quality=?"); vals.push(Number(body.quality)); }
      if (body.serviceOutlets !== undefined) { sets.push("service_outlets=?"); vals.push(JSON.stringify(body.serviceOutlets)); }
      if (sets.length) { vals.push(id); await qRun(`UPDATE to_technicians SET ${sets.join(",")} WHERE id=?`, vals); }
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await loadTechnicians()).find(t => t.id === id), reports: state.reports });
    }
    if (techCrudMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_technicians WHERE id=?", [decodeURIComponent(techCrudMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* CRUD: admin users */
    if (pathname === "/api/admin/users" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = body.id || nextId("U-");
      const pw = body.passwordPlain || body.password || "";
      await qRun("INSERT INTO to_users (id,username,password_plain,name,post,role,technician_id,access_all_outlets,allowed_outlets,outlet,default_view,allowed_views) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, String(body.username||"").toLowerCase(), pw, String(body.name||""), String(body.post||""), String(body.role||"user"), body.technicianId||null, !!body.accessAllOutlets, JSON.stringify(body.allowedOutlets||[]), body.outlet||null, body.defaultView||defaultViewForRole(body.role), JSON.stringify(body.allowedViews||defaultViews(body.role))]);
      const state = await buildFullState(pu);
      return send(res, 200, { ...publicUser(await getUserById(id)), reports: state.reports });
    }
    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(adminUserMatch[1]);
      const sets = []; const vals = [];
      for (const [k,col] of [["name","name"],["post","post"],["role","role"],["outlet","outlet"],["defaultView","default_view"],["technicianId","technician_id"]]) {
        if (body[k] !== undefined) { sets.push(`${col}=?`); vals.push(body[k]); }
      }
      if (body.accessAllOutlets !== undefined) { sets.push("access_all_outlets=?"); vals.push(!!body.accessAllOutlets); }
      if (body.allowedOutlets !== undefined) { sets.push("allowed_outlets=?"); vals.push(JSON.stringify(body.allowedOutlets)); }
      if (body.allowedViews !== undefined) { sets.push("allowed_views=?"); vals.push(JSON.stringify(body.allowedViews)); }
      if (body.passwordPlain !== undefined) { sets.push("password_plain=?"); vals.push(body.passwordPlain); }
      if (sets.length) { vals.push(id); await qRun(`UPDATE to_users SET ${sets.join(",")} WHERE id=?`, vals); }
      const state = await buildFullState(pu);
      return send(res, 200, { ...publicUser(await getUserById(id)), reports: state.reports });
    }
    if (adminUserMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_users WHERE id=?", [decodeURIComponent(adminUserMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* CRUD: maintenance rules */
    if (pathname === "/api/maintenance-rules" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = body.id || nextId("MR-");
      await qRun("INSERT INTO to_maintenance_rules (id,title,category,frequency,phase,rule_group,outlet,active,recurrence_day_of_week,recurrence_day_of_month,recurrence_months,assigned_technician_id,allow_outside_window) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, String(body.title||""), String(body.category||""), String(body.frequency||"daily"), String(body.phase||"Checklist"), String(body.group||"Maintenance"), String(body.outlet||""), body.active!==false, body.recurrenceDayOfWeek??null, body.recurrenceDayOfMonth??null, JSON.stringify(body.recurrenceMonths||[]), String(body.assignedTechnicianId||""), !!body.allowOutsideWindow]);
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await loadMaintenanceRules()).find(r => r.id === id), reports: state.reports });
    }
    if (pathname === "/api/maintenance-rules" && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_maintenance_rules");
      return send(res, 200, { ok: true });
    }
    const mrMatch = pathname.match(/^\/api\/maintenance-rules\/([^/]+)$/);
    if (mrMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(mrMatch[1]);
      const sets = []; const vals = [];
      for (const [k,col] of [["title","title"],["category","category"],["frequency","frequency"],["phase","phase"],["outlet","outlet"],["assignedTechnicianId","assigned_technician_id"]]) { if (body[k]!==undefined) { sets.push(`${col}=?`); vals.push(body[k]); } }
      if (body.group !== undefined) { sets.push("rule_group=?"); vals.push(body.group); }
      if (body.active !== undefined) { sets.push("active=?"); vals.push(!!body.active); }
      if (body.allowOutsideWindow !== undefined) { sets.push("allow_outside_window=?"); vals.push(!!body.allowOutsideWindow); }
      if (body.recurrenceDayOfWeek !== undefined) { sets.push("recurrence_day_of_week=?"); vals.push(body.recurrenceDayOfWeek); }
      if (body.recurrenceDayOfMonth !== undefined) { sets.push("recurrence_day_of_month=?"); vals.push(body.recurrenceDayOfMonth); }
      if (body.recurrenceMonths !== undefined) { sets.push("recurrence_months=?"); vals.push(JSON.stringify(body.recurrenceMonths)); }
      if (sets.length) { vals.push(id); await qRun(`UPDATE to_maintenance_rules SET ${sets.join(",")} WHERE id=?`, vals); }
      const state = await buildFullState(pu);
      return send(res, 200, { ...(await loadMaintenanceRules()).find(r => r.id === id), reports: state.reports });
    }
    if (mrMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_maintenance_rules WHERE id=?", [decodeURIComponent(mrMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* CRUD: assignment windows */
    if (pathname === "/api/assignment-windows" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = body.id || nextId("WIN-");
      await qRun("INSERT INTO to_assignment_windows (id,data) VALUES (?,?)", [id, JSON.stringify(body)]);
      const state = await buildFullState(pu);
      return send(res, 200, { id, ...body, reports: state.reports });
    }
    const winMatch = pathname.match(/^\/api\/assignment-windows\/([^/]+)$/);
    if (winMatch && m === "PATCH") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const id = decodeURIComponent(winMatch[1]);
      const row = await qGet("SELECT * FROM to_assignment_windows WHERE id=?", [id]);
      if (!row) return sendError(res, 404, "Not found");
      const updated = { ...(row.data||{}), ...body, id };
      await qRun("UPDATE to_assignment_windows SET data=? WHERE id=?", [JSON.stringify(updated), id]);
      const state = await buildFullState(pu);
      return send(res, 200, { ...updated, reports: state.reports });
    }
    if (winMatch && m === "DELETE") {
      if (!requireAdmin()) return;
      await qRun("DELETE FROM to_assignment_windows WHERE id=?", [decodeURIComponent(winMatch[1])]);
      const state = await buildFullState(pu);
      return send(res, 200, { ok: true, reports: state.reports });
    }

    /* reports export */
    const exportMatch = pathname.match(/^\/api\/reports\/export\/([^/]+)$/);
    if (exportMatch && m === "GET") {
      if (!requireAdmin()) return;
      const type = exportMatch[1];
      let rows = [];
      if (type === "tickets") rows = await loadTickets();
      else if (type === "tasks") rows = await loadTasks();
      else if (type === "technicians") rows = await loadTechnicians();
      else if (type === "outlets") { const { outlets } = await loadOutlets(); rows = outlets.map(name => ({ name })); }
      else return sendError(res, 400, "Unknown export type");
      const csv = toCsv(rows);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ticketops-${type}.csv"`, "Access-Control-Allow-Origin": "*" });
      return res.end(csv);
    }

    /* monthly backup */
    const backupMatch = pathname.match(/^\/api\/backups\/monthly\/([^/]+)$/);
    if (backupMatch && m === "GET") {
      if (!requireAdmin()) return;
      const month = decodeURIComponent(backupMatch[1]);
      if (!/^\d{4}-\d{2}$/.test(month)) return sendError(res, 400, "Use YYYY-MM format");
      const { outlets, outletLocations } = await loadOutlets();
      const [cats, assets, techs, rules, windows, allTickets, allTasks] = await Promise.all([loadCategories(), loadAssets(), loadTechnicians(), loadMaintenanceRules(), loadAssignmentWindows(), loadTickets(), loadTasks()]);
      return send(res, 200, { type: "ticketops-monthly-backup", month, createdAt: new Date().toISOString(), storage: "postgresql", outlets, outletLocations, categories: cats, assets, technicians: techs, maintenanceRules: rules, assignmentTimeWindows: windows, tickets: allTickets.filter(t => String(t.createdAt||"").slice(0,7)===month), tasks: allTasks.filter(t => String(t.date||"").slice(0,7)===month) });
    }

    /* backup stubs */
    if (pathname === "/api/backups/drive/status" && m === "GET") return send(res, 200, { configured: false, message: "Drive backups not supported in local mode" });
    if (pathname === "/api/backups/drive/run" && m === "POST") return sendError(res, 503, "Drive backups not supported");
    if (pathname === "/api/backups/drive/install" && m === "POST") return sendError(res, 503, "Drive backups not supported");
    if (pathname === "/api/backups/report" && m === "POST") {
      if (!requireAdmin()) return;
      const body = await readBody(req) || {};
      const { outlets } = await loadOutlets();
      const tickets = body.tickets || [], tasks = body.tasks || [];
      return send(res, 200, { month: body.month, totals: { tickets: tickets.length, openTickets: tickets.filter(t=>!["Closed","Cancelled"].includes(t.status)).length, closedTickets: tickets.filter(t=>t.status==="Closed").length, tasks: tasks.length, completedTasks: tasks.filter(t=>t.status==="Done").length, taskCompletionRate: tasks.length ? Math.round(tasks.filter(t=>t.status==="Done").length/tasks.length*100) : 0 }, byOutlet: outlets.map(o=>({ outlet:o, tickets:tickets.filter(t=>t.outlet===o).length, closed:tickets.filter(t=>t.outlet===o&&t.status==="Closed").length, tasks:tasks.filter(t=>t.outlet===o).length, doneTasks:tasks.filter(t=>t.outlet===o&&t.status==="Done").length })) });
    }

    /* reset */
    if (pathname === "/api/reset" && m === "POST") {
      if (!requireAdmin()) return;
      for (const tbl of ["to_tickets","to_tasks","to_assets","to_technicians","to_maintenance_rules","to_assignment_windows","to_attendance_plans","to_outlet_locations","to_outlets","to_categories","to_users"]) await qRun(`DELETE FROM ${tbl}`);
      await seed();
      return send(res, 200, { ok: true });
    }

    sendError(res, 404, "Unknown endpoint: " + m + " " + pathname);
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 500) console.error("Error:", err.message);
    sendError(res, code, err.message || "Server error");
  }
}

(async () => {
  await pool.query("SELECT 1");
  console.log("PostgreSQL connected");
  await initSchema();
  await seed();
  http.createServer(handle).listen(PORT, "0.0.0.0", () => console.log("TicketOps backend on port " + PORT));
})().catch(err => { console.error("Startup failed:", err); process.exit(1); });
