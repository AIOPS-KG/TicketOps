const DB_SHEET_NAME = "ticketops_db";
const SNAPSHOT_SHEET_NAME = "compiled_snapshot";
const DB_KEY = "db";
const DB_CHUNK_SIZE = 45000;
const BACKUP_FOLDER_NAME = "TicketOps Backups";
const BACKUP_RETENTION_DAYS = 31;
const BACKUP_TRIGGER_HOURS = [9, 12, 15, 18, 21];
const BACKUP_FILE_PREFIX = "ticketops-backup-";
const DEFAULT_PASSWORDS = {
  aiops: "AIops",
  "chintan.patel": "chintan123",
  "meet.patel": "meet123",
  demo: "demo123",
  manish: "manish123",
  "pratik.patel": "pratik123",
  "hussain.sheikh": "hussain123",
  "rahil.shah": "rahil123",
  "umang.naidu": "umang123",
  "viren.barapatre": "viren123",
  vicky: "vicky123",
  "rahul.patil": "rahul123",
  abrar: "abrar123",
  uday: "uday123",
  hiten: "hiten123"
};

const DEFAULT_DB = {
  users: [
    { id: "U-ADMIN-AIOPS", username: "aiops", password: "AIops", name: "AIops", post: "Admin Control Panel Operator", role: "admin", accessAllOutlets: true, allowedOutlets: [], defaultView: "dashboard", allowedViews: ["dashboard", "manager", "admin", "masters", "scheduler", "reports"] },
    { id: "U-MGR-PRATIK", username: "pratik.patel", password: "pratik123", name: "Pratik Patel", post: "Outlet Manager", role: "manager", outlet: "aiko surat", accessAllOutlets: true, allowedOutlets: [], defaultView: "manager", allowedViews: ["manager"] },
    { id: "U-TECH-VICKY", username: "vicky", password: "vicky123", name: "Vicky", post: "Technician", role: "technician", technicianId: "T1", accessAllOutlets: false, allowedOutlets: ["aiko surat", "Capiche"], defaultView: "technician", allowedViews: ["technician"] }
  ],
  outlets: ["aiko surat", "Capiche"],
  outletLocations: {
    "aiko surat": { address: "Surat", latitude: null, longitude: null },
    Capiche: { address: "Surat", latitude: null, longitude: null }
  },
  categories: [
    { id: "C-AC", name: "AC", description: "Air conditioning and ventilation" },
    { id: "C-REF", name: "Refrigeration", description: "Freezers, chillers, cold rooms" },
    { id: "C-ELEC", name: "Electrical", description: "Power, panels, lighting" },
    { id: "C-PLUMB", name: "Plumbing", description: "Water supply, drains, dishwash area" },
    { id: "C-KITCHEN", name: "Kitchen Equipment", description: "Ovens, fryers, burners, dishwashers" }
  ],
  assets: [],
  technicians: [
    { id: "T1", name: "Vicky", skill: ["AC", "Electrical"], status: "Present", quality: 92, serviceOutlets: ["aiko surat", "Capiche"] }
  ],
  tickets: [],
  tasks: [],
  assignmentTimeWindows: [],
  maintenanceRules: [],
  attendancePlans: [],
  ticketHistory: []
};

function doGet() {
  return jsonResponse({ ok: true, body: { ok: true, name: "TicketOps Google Sheets API", storage: "google-sheets" } });
}

function doPost(e) {
  try {
    const envelope = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    return jsonResponse(handleRequest(envelope));
  } catch (error) {
    return jsonResponse({ ok: false, status: 500, error: error && error.message ? error.message : "Server error" });
  }
}

function serverRequest(envelope) {
  return handleRequest(envelope || {});
}

function importTicketOpsJson(jsonText) {
  const db = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
  saveDb(normalizeDb(db));
  return { ok: true, rows: JSON.stringify(db).length };
}

function resetTicketOpsDemoData() {
  saveDb(normalizeDb(JSON.parse(JSON.stringify(DEFAULT_DB))));
  return { ok: true };
}

function handleRequest(envelope) {
  const method = String(envelope.method || "GET").toUpperCase();
  const path = normalizePath(envelope.path || "/api/health");
  const body = envelope.body || {};
  const headers = envelope.headers || {};
  const db = loadDb();
  const user = userFromHeaders(db, headers);

  if (method === "GET" && path === "/api/health") return ok({ ok: true, name: "TicketOps Google Sheets API", storage: "google-sheets", auth: "demo" });
  if (method === "GET" && path === "/api/stitch/status") return requireAdmin(user, () => ok({ configured: false, connected: false, endpoint: "", tools: [], error: "Stitch is not configured in the Google Sheets backend" }));
  if (method === "POST" && path === "/api/stitch/call") return requireAdmin(user, () => fail(503, "Stitch is not configured in the Google Sheets backend"));
  if (method === "POST" && path === "/api/auth/login") return login(db, body);
  if (method === "GET" && path === "/api/auth/demo-users") return requireLoggedIn(user, () => ok({ users: (db.users || []).map(publicUser) }));
  if (method === "POST" && path === "/api/auth/change-password") return changePassword(db, user, body);
  if (method === "POST" && /^\/api\/admin\/users\/[^/]+\/reset-password$/.test(path)) return resetPassword(db, user, segment(path, 3), body);
  if (method === "GET" && path === "/api/bootstrap") return requireLogin(user, () => { if (!db.__readOnlyFallback) refreshTodayTasks(db); return ok(bootstrapForUser(db, user)); });
  if (method === "GET" && /^\/api\/tickets\/[^/]+\/photos$/.test(path)) return requireLoggedIn(user, () => ticketPhotos(db, user, segment(path, 2)));
  if (method === "GET" && /^\/api\/tasks\/[^/]+\/photos$/.test(path)) return requireLoggedIn(user, () => taskPhotos(db, user, segment(path, 2)));
  if (method === "GET" && path === "/api/categories") return requireAdmin(user, () => ok(db.categories || []));
  if (method === "GET" && path === "/api/backups/drive/status") return requireAdmin(user, () => ok(driveBackupStatus()));
  if (method === "POST" && path === "/api/backups/drive/run") return requireAdmin(user, () => ok(createDriveBackup("manual")));
  if (method === "POST" && path === "/api/backups/drive/install") return requireAdmin(user, () => ok(installDriveBackupTriggers()));
  if (method === "POST" && path === "/api/backups/drive/restore") return requireAdmin(user, () => ok(restoreFromDriveBackup(body)));
  if (method === "GET" && path.startsWith("/api/reports/export/")) return requireAdmin(user, () => ok(exportCsv(db, segment(path, 3))));
  if (method === "GET" && path.startsWith("/api/backups/monthly/")) return requireAdmin(user, () => monthlyBackup(db, decodeURIComponent(segment(path, 3))));
  if (method === "POST" && path === "/api/backups/report") return requireAdmin(user, () => ok(backupReport(body)));
  if (method === "GET" && path === "/api/admin/digest/preview") return requireAdmin(user, () => ok(buildDailyDigest(db)));
  if (method === "POST" && path === "/api/admin/digest/run") return requireAdmin(user, () => ok(sendDailyDigest()));
  if (method === "POST" && path === "/api/admin/digest/install") return requireAdmin(user, () => ok(installDailyDigestTrigger(body)));
  if (method === "GET" && path === "/api/technician/dashboard") return requireRole(user, "technician", () => ok(technicianDashboard(db, user.technicianId)));
  if (method === "GET" && path === "/api/technician/tasks/today") return requireRole(user, "technician", () => ok(todayTasksForTechnician(db, user.technicianId)));
  if (method === "POST" && /^\/api\/technician\/tasks\/[^/]+\/status$/.test(path)) return requireRole(user, "technician", () => updateTaskStatus(db, segment(path, 3), body.status === "done" ? "Done" : "Not Done", body));
  if (method === "PATCH" && /^\/api\/tasks\/[^/]+\/status$/.test(path)) return requireLoggedIn(user, () => updateTaskStatus(db, segment(path, 2), body.status || "Done", body));
  if (method === "DELETE" && /^\/api\/tasks\/[^/]+$/.test(path)) return requireAdmin(user, () => deleteById(db, "tasks", segment(path, 2)));
  if (method === "POST" && path === "/api/tasks/refresh") return requireAdmin(user, () => { var n = refreshTodayTasks(db); return ok({ generated: n, date: dateKey() }); });
  if (method === "POST" && path === "/api/tickets") return requireLoggedIn(user, () => createTicket(db, body, user));
  if (method === "PATCH" && /^\/api\/tickets\/[^/]+\/assign$/.test(path)) return requireAdmin(user, () => assignTicket(db, segment(path, 2), body, user));
  if (method === "PATCH" && /^\/api\/tickets\/[^/]+\/schedule$/.test(path)) return requireAdmin(user, () => updateTicket(db, segment(path, 2), { scheduledAt: body.scheduledAt || "" }, user, body.scheduledAt ? "Scheduled for " + body.scheduledAt : "Schedule cleared"));
  if (method === "POST" && /^\/api\/tickets\/[^/]+\/accept$/.test(path)) return requireRole(user, "technician", () => updateTicket(db, segment(path, 2), { status: "Acknowledged", latestDetail: "Accepted by technician" }, user, "Accepted by technician"));
  if (method === "POST" && /^\/api\/tickets\/[^/]+\/reject$/.test(path)) return requireRole(user, "technician", () => updateTicket(db, segment(path, 2), { status: "New", assignedTo: "", latestDetail: body.reason || "Rejected" }, user, "Rejected" + (body.reason ? ": " + body.reason : "")));
  if (method === "DELETE" && /^\/api\/tickets\/[^/]+\/assignment$/.test(path)) return requireAdmin(user, () => updateTicket(db, segment(path, 2), { status: "New", assignedTo: "", scheduledAt: "" }, user, "Assignment removed"));
  if (method === "DELETE" && /^\/api\/tickets\/[^/]+$/.test(path)) return requireLoggedIn(user, () => deleteById(db, "tickets", segment(path, 2)));
  if (method === "POST" && path === "/api/admin/photos/migrate") return requireAdmin(user, () => migratePhotosToDrive(db, body));
  if (method === "PATCH" && /^\/api\/tickets\/[^/]+\/status$/.test(path)) return requireLoggedIn(user, () => {
    var evidenceUrls = storePhotoList(body.evidencePhotoUrls, "ticket-evidence-" + segment(path, 2));
    var fields = { status: body.status, latestDetail: body.detail || body.status, evidencePhotoUrl: evidenceUrls[0] || storePhotoValue(body.evidencePhotoUrl, "ticket-evidence-" + segment(path, 2)), evidencePhotoUrls: evidenceUrls };
    if (body.status === "Closed" && Number(body.closePrice || 0) > 0) {
      fields.closePrice = Number(body.closePrice);
      fields.closePriceBy = body.closePriceBy || user.id;
      fields.closePriceAt = body.closePriceAt || new Date().toISOString();
    }
    var statusAction = "Status → " + body.status + (body.detail && body.detail !== body.status ? " — " + body.detail : "");
    return updateTicket(db, segment(path, 2), fields, user, statusAction);
  });
  if (method === "PATCH" && /^\/api\/technicians\/[^/]+\/status$/.test(path)) return requireAdmin(user, () => updateTechnician(db, segment(path, 2), { status: body.status }));
  if (method === "POST" && /^\/api\/technicians\/[^/]+\/attendance$/.test(path)) return requireLoggedIn(user, () => createAttendancePlan(db, segment(path, 2), body, user));
  if (method === "POST" && path === "/api/reset") return requireAdmin(user, () => { saveDb(DEFAULT_DB); return ok({ ok: true }); });

  const crud = crudRoute(path, method, body, user, db);
  if (crud) return crud;
  return fail(404, "Unknown API route: " + method + " " + path);
}

function crudRoute(path, method, body, user, db) {
  const routes = [
    { base: "/api/assets", key: "assets", id: "id", prefix: "A-" },
    { base: "/api/outlets", key: "outlets", id: null, prefix: "" },
    { base: "/api/categories", key: "categories", id: "id", prefix: "C-" },
    { base: "/api/technicians", key: "technicians", id: "id", prefix: "T" },
    { base: "/api/admin/users", key: "users", id: "id", prefix: "U-" },
    { base: "/api/assignment-windows", key: "assignmentTimeWindows", id: "id", prefix: "WIN-" },
    { base: "/api/maintenance-rules", key: "maintenanceRules", id: "id", prefix: "MR-" }
  ];
  for (const route of routes) {
    if (path === route.base && method === "POST") return requireAdmin(user, () => createRow(db, route, body));
    if (path.indexOf(route.base + "/") === 0 && method === "PATCH") return requireAdmin(user, () => patchRow(db, route, decodeURIComponent(path.slice(route.base.length + 1)), body));
    if (path.indexOf(route.base + "/") === 0 && method === "DELETE") return requireAdmin(user, () => deleteRow(db, route, decodeURIComponent(path.slice(route.base.length + 1))));
  }
  if (path === "/api/maintenance-rules" && method === "DELETE") return requireAdmin(user, () => { db.maintenanceRules = []; saveDb(db); return ok({ ok: true }); });
  return null;
}

function loadDb() {
  const chunked = loadChunkedDb();
  if (chunked) return chunked;
  const sheet = dbSheet();
  const finder = sheet.createTextFinder(DB_KEY).matchEntireCell(true).findNext();
  if (!finder) {
    saveDb(DEFAULT_DB);
    return normalizeDb(JSON.parse(JSON.stringify(DEFAULT_DB)));
  }
  const row = finder.getRow();
  const text = String(sheet.getRange(row, 2).getValue() || "");
  if (!text) return normalizeDb(JSON.parse(JSON.stringify(DEFAULT_DB)));
  const parsed = parseDbJson(text, "ticketops_db");
  return usableDb(parsed) ? normalizeDb(parsed) : fallbackDb("ticketops_db is invalid or has no users");
}

function saveDb(db) {
  if (db && db.__readOnlyFallback) {
    throw new Error("Live DB snapshot is in recovery fallback; refusing to overwrite stored Sheet data.");
  }
  const normalized = normalizeDb(db);
  saveChunkedDb(normalized);
  const sheet = dbSheet();
  sheet.getRange(1, 1, 1, 3).setValues([["key", "json", "updated_at"]]);
  sheet.getRange(2, 1, 1, 3).setValues([[DB_KEY, JSON.stringify({ storage: "compiled_snapshot", updatedAt: new Date().toISOString() }), new Date().toISOString()]]);
}

function dbSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DB_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(DB_SHEET_NAME);
  return sheet;
}

function snapshotSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SNAPSHOT_SHEET_NAME);
  return sheet;
}

// Chunk cells are written with a fixed "#" prefix so Sheets can never coerce
// the value: a raw chunk starting with "'" gets its apostrophe silently
// stripped, "=" becomes a formula, and TRUE/numeric-looking text gets
// re-typed — any of which corrupts the reassembled JSON (this bit us on
// 2026-07-03). The prefix is stripped on read; legacy unprefixed chunks
// (written before the fix) are read as-is.
const CHUNK_TEXT_PREFIX = "#";

function decodeChunkCell(value) {
  const text = String(value == null ? "" : value);
  return text.indexOf(CHUNK_TEXT_PREFIX) === 0 ? text.slice(CHUNK_TEXT_PREFIX.length) : text;
}

function loadChunkedDb() {
  const sheet = snapshotSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues()
    .filter((row) => String(row[1] || "").indexOf("ticketops_db_") === 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!rows.length) return null;
  const text = rows.map((row) => decodeChunkCell(row[2])).join("");
  if (!text) return null;
  const parsed = parseDbJson(text, "compiled_snapshot");
  return usableDb(parsed) ? normalizeDb(parsed) : null;
}

function parseDbJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("TicketOps DB JSON parse failed", {
      source: source,
      length: String(text || "").length,
      message: error && error.message ? error.message : String(error)
    });
    return null;
  }
}

function fallbackDb(reason) {
  console.error("TicketOps DB fallback activated", { reason: reason || "unknown" });
  const db = normalizeDb(JSON.parse(JSON.stringify(DEFAULT_DB)));
  db.__readOnlyFallback = true;
  db.__fallbackReason = reason || "unknown";
  return db;
}

function usableDb(db) {
  return Boolean(db && typeof db === "object" && Array.isArray(db.users) && db.users.length);
}

function saveChunkedDb(db) {
  const sheet = snapshotSheet();
  const text = JSON.stringify(normalizeDb(db));
  const chunks = [];
  for (let index = 0; index < text.length; index += DB_CHUNK_SIZE) {
    chunks.push(text.slice(index, index + DB_CHUNK_SIZE));
  }
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 4).setValues([["chunk_index", "chunk_key", "json_chunk", "updated_at"]]);
  if (chunks.length) {
    const now = new Date().toISOString();
    const range = sheet.getRange(2, 1, chunks.length, 4);
    range.setNumberFormat("@");
    range.setValues(chunks.map((chunk, index) => [index, `ticketops_db_${index}`, CHUNK_TEXT_PREFIX + chunk, now]));
    // Read-back check: if reassembly doesn't round-trip, fail loudly instead of
    // leaving a corrupt snapshot behind for the next reader.
    const readBack = sheet.getRange(2, 3, chunks.length, 1).getValues().map((row) => decodeChunkCell(row[0])).join("");
    if (readBack !== text) throw new Error("Snapshot write verification failed — chunked data did not round-trip; aborting save.");
  }
}

function dateKey() {
  var d = new Date();
  return d.toISOString().slice(0, 10);
}

function frequencyLabel(value) {
  var labels = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", "half-yearly": "Half Yearly", yearly: "Yearly" };
  return labels[String(value || "").toLowerCase()] || "Scheduled";
}

function normalizeIntegerInRange(value, min, max, fallback) {
  var n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : (fallback !== undefined ? fallback : null);
}

function isMaintenanceRuleDue(rule, day) {
  if (!day) day = dateKey();
  var date = new Date(day + "T00:00:00");
  var dow = date.getDay();
  var dom = date.getDate();
  var month = date.getMonth();
  var freq = String(rule.frequency || "daily").toLowerCase();
  var targetDow = normalizeIntegerInRange(rule.recurrenceDayOfWeek, 0, 6, 1);
  var maxDom = new Date(date.getFullYear(), month + 1, 0).getDate();
  var targetDom = Math.min(normalizeIntegerInRange(rule.recurrenceDayOfMonth, 1, 31, 1), maxDom);
  var defaultMonths = { quarterly: [0, 3, 6, 9], "half-yearly": [0, 6], yearly: [0] };
  var targetMonths = (Array.isArray(rule.recurrenceMonths) && rule.recurrenceMonths.length)
    ? rule.recurrenceMonths
    : (defaultMonths[freq] || []);
  if (freq === "daily") return true;
  if (freq === "weekly") return dow === targetDow;
  if (freq === "monthly") return dom === targetDom;
  if (freq === "quarterly" || freq === "half-yearly" || freq === "yearly") return targetMonths.indexOf(month) !== -1 && dom === targetDom;
  return false;
}

function checklistTechnicians(db) {
  return (db.technicians || []).slice().sort(function(a, b) { return String(a.name).localeCompare(String(b.name)); });
}

function balancedChecklistTechnician(technicians, loadMap) {
  if (!technicians.length) return null;
  return technicians.reduce(function(selected, tech) {
    if (!selected) return tech;
    var sl = loadMap[selected.id] || 0;
    var tl = loadMap[tech.id] || 0;
    if (tl < sl) return tech;
    if (tl === sl && String(tech.name).localeCompare(String(selected.name)) < 0) return tech;
    return selected;
  }, null);
}

function technicianCoversOutlet(tech, outlet) {
  if (!outlet) return true;
  var outlets = Array.isArray(tech.serviceOutlets) ? tech.serviceOutlets : [];
  return !outlets.length || outlets.indexOf(outlet) !== -1;
}

function maintenanceRuleById(db, ruleId) {
  return (db.maintenanceRules || []).find(function(r) { return r.id === ruleId; }) || null;
}

function maintenanceRuleAssignments(db, rule) {
  var explicit = (db.maintenanceRuleAssignments || []).filter(function(a) { return a.ruleId === rule.id && a.active !== false; });
  if (explicit.length) return explicit;
  if (rule.outlet) {
    return [{ id: rule.id + ":" + rule.outlet, ruleId: rule.id, outlet: rule.outlet, assignedTechnicianId: rule.assignedTechnicianId || "", active: true }];
  }
  return [];
}

function maintenanceRuleTechnician(db, rule, loadMap, fallbackTechnicians, outlet) {
  var allTechs = fallbackTechnicians || checklistTechnicians(db);
  if (rule && rule.assignedTechnicianId) {
    var assigned = allTechs.find(function(t) { return t.id === rule.assignedTechnicianId; });
    if (assigned) return assigned;
  }
  var targetOutlet = outlet || (rule && rule.outlet) || "";
  var eligible = allTechs.filter(function(t) { return technicianCoversOutlet(t, targetOutlet); });
  var map = loadMap || {};
  if (!loadMap) {
    eligible.forEach(function(t) { map[t.id] = 0; });
  }
  return balancedChecklistTechnician(eligible, map);
}

function isChecklistTask(task) {
  var title = String(task.title || "");
  return title.indexOf("Morning Opening:") === 0 || title.indexOf("Checklist:") === 0 || title.indexOf("Mid-Day:") === 0 || title.indexOf("Closing:") === 0 || title.indexOf("Weekly:") === 0 || title.indexOf("Daily check") === 0;
}

function generateTodayTasks(db, day) {
  if (!day) day = dateKey();
  var rules = (db.maintenanceRules || []).filter(function(rule) {
    return rule.active !== false && isMaintenanceRuleDue(rule, day);
  });
  var technicians = checklistTechnicians(db);
  var loadMap = {};
  technicians.forEach(function(tech) {
    loadMap[tech.id] = (db.tasks || []).filter(function(t) { return t.date === day && t.assignedTo === tech.id && isChecklistTask(t); }).length;
  });
  var existingKeys = {};
  var existingIds = {};
  (db.tasks || []).forEach(function(t) {
    if (t.date === day) existingKeys[day + "|" + t.outlet + "|" + (t.ruleId || t.title)] = true;
    existingIds[t.id] = true;
  });
  var sequence = (db.tasks || []).filter(function(t) { return t.date === day; }).length + 1;
  function nextTaskId() {
    var base = "TASK-" + day.replace(/-/g, "") + "-";
    var id = base + String(sequence).padStart(3, "0");
    while (existingIds[id]) { sequence += 1; id = base + String(sequence).padStart(3, "0"); }
    existingIds[id] = true;
    sequence += 1;
    return id;
  }
  var added = [];
  (db.outlets || []).forEach(function(outlet) {
    var outletAssets = (db.assets || []).filter(function(a) { return a.status === "Active" && a.outlet === outlet; });
    rules.forEach(function(rule) {
      var assignments = maintenanceRuleAssignments(db, rule);
      var assignment = assignments.find(function(a) { return a.outlet === outlet; });
      if (!assignment) return;
      var asset = outletAssets.find(function(a) { return a.category === rule.category; }) || outletAssets[0];
      var effectiveRule = Object.assign({}, rule, { assignedTechnicianId: assignment.assignedTechnicianId || rule.assignedTechnicianId || "", outlet: outlet });
      var tech = maintenanceRuleTechnician(db, effectiveRule, loadMap, technicians, outlet);
      if (!asset || !tech) return;
      var title = (rule.phase || "Checklist") + ": " + rule.title;
      var taskKey = day + "|" + outlet + "|" + rule.id;
      if (existingKeys[taskKey]) return;
      existingKeys[taskKey] = true;
      var task = {
        id: nextTaskId(),
        title: title,
        assetId: asset.id,
        outlet: outlet,
        assignedTo: tech.id,
        ruleId: rule.id,
        status: "Pending",
        date: day,
        completedAt: "",
        notes: (rule.group || "Maintenance") + " / " + frequencyLabel(rule.frequency) + (rule.allowOutsideWindow ? " / outside window allowed" : "")
      };
      added.push(task);
      loadMap[tech.id] = (loadMap[tech.id] || 0) + 1;
    });
  });
  db.tasks = (db.tasks || []).concat(added);
  return added.length;
}

function refreshTodayTasks(db) {
  var day = dateKey();
  var generated = generateTodayTasks(db, day);
  if (generated > 0) saveDb(db);
  return generated;
}

function normalizeDb(db) {
  const next = db || {};
  ["users", "outlets", "categories", "assets", "technicians", "tickets", "tasks", "assignmentTimeWindows", "maintenanceRules", "attendancePlans", "ticketHistory"].forEach((key) => {
    if (!Array.isArray(next[key])) next[key] = [];
  });
  if (!next.outletLocations || typeof next.outletLocations !== "object") next.outletLocations = {};
  return next;
}

function normalizePath(path) {
  const raw = String(path || "/");
  const withoutQuery = raw.split("?")[0];
  return withoutQuery.startsWith("/") ? withoutQuery : "/" + withoutQuery;
}

function segment(path, index) {
  return decodeURIComponent(String(path).split("/")[index + 1] || "");
}

function ok(body) {
  return { ok: true, status: 200, body };
}

function fail(status, error) {
  return { ok: false, status, error, body: { error } };
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function userFromHeaders(db, headers) {
  const id = String(headers["X-TicketOps-User"] || headers["x-ticketops-user"] || "");
  return (db.users || []).find((user) => user.id === id) || null;
}

function publicUser(user) {
  const copy = Object.assign({}, user);
  delete copy.password;
  delete copy.passwordHash;
  delete copy.passwordPlain;
  copy.allowedViews = normalizeAllowedViews(copy);
  if (!copy.defaultView || copy.allowedViews.indexOf(copy.defaultView) === -1) copy.defaultView = defaultViewForRole(copy.role);
  return copy;
}

function normalizeAllowedViews(user) {
  if (Array.isArray(user.allowedViews) && user.allowedViews.length) return user.allowedViews;
  if (user.role === "admin") return ["dashboard", "manager", "admin", "masters", "scheduler", "history", "reports"];
  if (user.role === "manager") return ["manager"];
  if (user.role === "technician") return ["technician"];
  return ["dashboard"];
}

function defaultViewForRole(role) {
  if (role === "manager") return "manager";
  if (role === "technician") return "technician";
  return "dashboard";
}

// Brute-force guard: 5 failed attempts per username locks login for 10 minutes.
// CacheService needs no extra OAuth scope and expires entries on its own.
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_SECONDS = 600;

function login(db, body) {
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const cache = CacheService.getScriptCache();
  const failKey = "login-fail:" + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= LOGIN_FAIL_LIMIT) return fail(429, "Too many failed attempts. Try again in a few minutes.");
  const user = (db.users || []).find((item) => String(item.username || "").toLowerCase() === username);
  const accepted = Boolean(user) && (password === String(user.password || "") || password === String(user.passwordPlain || "") || password === DEFAULT_PASSWORDS[username]);
  if (!accepted) {
    cache.put(failKey, String(fails + 1), LOGIN_FAIL_WINDOW_SECONDS);
    return fail(401, "Invalid username or password");
  }
  cache.remove(failKey);
  return ok({ user: publicUser(user) });
}

function changePassword(db, user, body) {
  if (!user) return fail(401, "Login required");
  const current = String(body.currentPassword || "");
  const accepted = current === String(user.password || "") || current === String(user.passwordPlain || "") || current === DEFAULT_PASSWORDS[user.username];
  if (!accepted) return fail(400, "Current password is incorrect");
  const next = String(body.newPassword || "");
  if (next.length < 8) return fail(400, "New password must be at least 8 characters");
  if (next !== String(body.confirmPassword || "")) return fail(400, "New password confirmation does not match");
  user.passwordPlain = next;
  saveDb(db);
  return ok({ ok: true });
}

function resetPassword(db, admin, userId, body) {
  if (!admin || admin.role !== "admin") return fail(403, "Only admin can reset passwords");
  const user = (db.users || []).find((item) => item.id === userId);
  if (!user) return fail(404, "User not found");
  const password = String(body.newPassword || ("Tmp-" + Utilities.getUuid().slice(0, 8)));
  if (password.length < 8) return fail(400, "Reset password must be at least 8 characters");
  user.passwordPlain = password;
  saveDb(db);
  return ok({ ok: true, username: user.username, temporaryPassword: password });
}

function requireLoggedIn(user, fn) {
  return user ? fn() : fail(401, "Login required");
}

function requireLogin(user, fn) {
  return requireLoggedIn(user, fn);
}

function requireAdmin(user, fn) {
  return user && user.role === "admin" ? fn() : fail(403, "Only admin can perform this action");
}

function requireRole(user, role, fn) {
  return user && user.role === role ? fn() : fail(403, role + " access only");
}

// Shallow scoping: filters build new arrays but share the item objects with db.
// Nothing downstream mutates items in place (slimming and publicUser copy first),
// which keeps bootstrap free of the old double JSON deep-copy of the whole DB.
function scopedDbForUser(db, user) {
  const copy = normalizeDb(Object.assign({}, db));
  if (!user) return copy;
  if (user.role === "manager") {
    const outlets = outletAccessForUser(user, db);
    copy.assets = copy.assets.filter((asset) => outlets.indexOf(asset.outlet) !== -1);
    copy.tasks = copy.tasks.filter((task) => outlets.indexOf(task.outlet) !== -1);
    copy.tickets = copy.tickets.filter((ticket) => outlets.indexOf(ticket.outlet) !== -1);
  }
  if (user.role === "technician" && user.technicianId) {
    copy.technicians = copy.technicians.filter((tech) => tech.id === user.technicianId);
    copy.tasks = copy.tasks.filter((task) => task.assignedTo === user.technicianId);
    copy.tickets = copy.tickets.filter((ticket) => ticket.assignedTo === user.technicianId || ticket.createdBy === user.id);
  }
  return copy;
}

// Photos live in Google Drive, not in the sheet DB. Incoming data: URIs are
// uploaded to the photos folder (anyone-with-link view, matching the app's
// anonymous-web-app posture) and only a short serving URL is stored. Keeping
// blobs out of the DB JSON keeps loadDb/saveDb fast for every request.
const PHOTO_FOLDER_NAME = "TicketOps Photos";
const PHOTO_FOLDER_PROP = "TICKETOPS_PHOTO_FOLDER_ID";
const PHOTO_FIELDS = {
  tickets: [["photoUrl", "photoUrls"], ["evidencePhotoUrl", "evidencePhotoUrls"], ["", "resolutionPhotoUrls"]],
  tasks: [["photoUrl", "photoUrls"], ["evidencePhotoUrl", ""]]
};

function photoFolder() {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty(PHOTO_FOLDER_PROP);
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (error) {
      props.deleteProperty(PHOTO_FOLDER_PROP);
    }
  }
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty(PHOTO_FOLDER_PROP, folder.getId());
  return folder;
}

function drivePhotoUrl(fileId) {
  return "https://lh3.googleusercontent.com/d/" + fileId;
}

function isDataUriPhoto(value) {
  return String(value || "").indexOf("data:") === 0;
}

function uploadPhotoToDrive(dataUri, label) {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUri || ""));
  if (!match) return dataUri;
  const contentType = match[1] || "image/jpeg";
  const extension = (contentType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
  const bytes = Utilities.base64Decode(match[2]);
  const name = "photo-" + (label || "item") + "-" + new Date().getTime() + "-" + Utilities.getUuid().slice(0, 6) + "." + extension;
  const file = photoFolder().createFile(Utilities.newBlob(bytes, contentType, name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return drivePhotoUrl(file.getId());
}

function storePhotoValue(value, label) {
  return isDataUriPhoto(value) ? uploadPhotoToDrive(value, label) : (value || "");
}

function storePhotoList(list, label) {
  return (Array.isArray(list) ? list : []).filter(Boolean).map((value) => storePhotoValue(value, label));
}

// Walks every photo field on an item and moves data: URIs to Drive. Returns the
// number of photos moved (0 = item already clean).
function movePhotosToDrive(item, fieldPairs, label) {
  let moved = 0;
  fieldPairs.forEach((pair) => {
    const singleKey = pair[0];
    const listKey = pair[1];
    if (singleKey && isDataUriPhoto(item[singleKey])) {
      item[singleKey] = uploadPhotoToDrive(item[singleKey], label);
      moved += 1;
    }
    if (listKey && Array.isArray(item[listKey]) && item[listKey].some(isDataUriPhoto)) {
      item[listKey] = item[listKey].filter(Boolean).map((value) => {
        if (!isDataUriPhoto(value)) return value;
        moved += 1;
        return uploadPhotoToDrive(value, label);
      });
    }
  });
  // Keep single/list variants consistent after migration.
  if (moved && fieldPairs[0][0] && fieldPairs[0][1] && !item[fieldPairs[0][0]] && Array.isArray(item[fieldPairs[0][1]]) && item[fieldPairs[0][1]].length) {
    item[fieldPairs[0][0]] = item[fieldPairs[0][1]][0];
  }
  return moved;
}

// POST /api/admin/photos/migrate {limit} — moves embedded photos out of the
// sheet DB into Drive in bounded batches (Apps Script has a ~6 min execution
// cap). Call repeatedly until remaining === 0.
function migratePhotosToDrive(db, body) {
  const limit = Math.max(1, Math.min(Number((body && body.limit) || 40), 200));
  let migrated = 0;
  [["tickets", PHOTO_FIELDS.tickets], ["tasks", PHOTO_FIELDS.tasks]].forEach((entry) => {
    const key = entry[0];
    const pairs = entry[1];
    (db[key] || []).forEach((item) => {
      if (migrated >= limit) return;
      migrated += movePhotosToDrive(item, pairs, key.slice(0, -1) + "-" + (item.id || "x"));
    });
  });
  if (migrated > 0) saveDb(db);
  let remaining = 0;
  [["tickets", PHOTO_FIELDS.tickets], ["tasks", PHOTO_FIELDS.tasks]].forEach((entry) => {
    (db[entry[0]] || []).forEach((item) => {
      entry[1].forEach((pair) => {
        if (pair[0] && isDataUriPhoto(item[pair[0]])) remaining += 1;
        if (pair[1] && Array.isArray(item[pair[1]])) remaining += item[pair[1]].filter(isDataUriPhoto).length;
      });
    });
  });
  return ok({ migrated, remaining, dbBytes: JSON.stringify(db).length });
}

// Bootstrap ships photo COUNTS instead of base64 blobs; clients fetch full photos
// on demand via /api/tickets/:id/photos and /api/tasks/:id/photos. Short http(s)
// URLs (the Drive links) stay inline — only heavy data: URIs are stripped.
const PHOTO_INLINE_MAX_CHARS = 512;

function heavyPhotoValue(value) {
  const text = String(value || "");
  return text.length > PHOTO_INLINE_MAX_CHARS || text.indexOf("data:") === 0;
}

function inlinePhotoCount(single, list) {
  const urls = (Array.isArray(list) ? list : []).filter(Boolean);
  return urls.length ? urls.length : (single ? 1 : 0);
}

function slimPhotoFields(item, pairs) {
  const copy = Object.assign({}, item);
  let omitted = false;
  pairs.forEach((pair) => {
    const singleKey = pair[0];
    const listKey = pair[1];
    const countKey = pair[2];
    const single = singleKey ? copy[singleKey] : "";
    const list = Array.isArray(copy[listKey]) ? copy[listKey] : [];
    copy[countKey] = inlinePhotoCount(single, list);
    if (list.some(heavyPhotoValue)) {
      copy[listKey] = [];
      omitted = true;
    }
    if (singleKey && heavyPhotoValue(single)) {
      copy[singleKey] = "";
      omitted = true;
    }
  });
  if (omitted) copy.photosOmitted = true;
  return copy;
}

function slimTicketForBootstrap(ticket) {
  return slimPhotoFields(ticket, [
    ["photoUrl", "photoUrls", "photoCount"],
    ["evidencePhotoUrl", "evidencePhotoUrls", "evidencePhotoCount"],
    ["", "resolutionPhotoUrls", "resolutionPhotoCount"]
  ]);
}

function slimTaskForBootstrap(task) {
  return slimPhotoFields(task, [
    ["photoUrl", "photoUrls", "photoCount"],
    ["evidencePhotoUrl", "evidencePhotoUrls", "evidencePhotoCount"]
  ]);
}

function bootstrapForUser(db, user) {
  const scoped = scopedDbForUser(db, user);
  scoped.tickets = scoped.tickets.map(slimTicketForBootstrap);
  scoped.tasks = scoped.tasks.map(slimTaskForBootstrap);
  scoped.users = scoped.users.map(publicUser);
  scoped.reports = reports(scoped);
  scoped.storage = "google-sheets";
  scoped.stitch = { configured: false, endpoint: "" };
  return scoped;
}

function userCanSeeTicket(db, user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === "manager") return outletAccessForUser(user, db).indexOf(ticket.outlet) !== -1;
  if (user.role === "technician") return ticket.assignedTo === user.technicianId || ticket.createdBy === user.id;
  return true;
}

function userCanSeeTask(db, user, task) {
  if (!user || !task) return false;
  if (user.role === "manager") return outletAccessForUser(user, db).indexOf(task.outlet) !== -1;
  if (user.role === "technician") return task.assignedTo === user.technicianId;
  return true;
}

function ticketPhotos(db, user, id) {
  const ticket = (db.tickets || []).find((item) => item.id === id);
  if (!ticket || !userCanSeeTicket(db, user, ticket)) return fail(404, "Ticket not found");
  return ok({
    id: ticket.id,
    photoUrl: ticket.photoUrl || "",
    photoUrls: (ticket.photoUrls || []).filter(Boolean),
    evidencePhotoUrl: ticket.evidencePhotoUrl || "",
    evidencePhotoUrls: (ticket.evidencePhotoUrls || []).filter(Boolean),
    resolutionPhotoUrls: (ticket.resolutionPhotoUrls || []).filter(Boolean)
  });
}

function taskPhotos(db, user, id) {
  const task = (db.tasks || []).find((item) => item.id === id);
  if (!task || !userCanSeeTask(db, user, task)) return fail(404, "Task not found");
  return ok({
    id: task.id,
    photoUrl: task.photoUrl || "",
    photoUrls: (task.photoUrls || []).filter(Boolean),
    evidencePhotoUrl: task.evidencePhotoUrl || "",
    evidencePhotoUrls: (task.evidencePhotoUrls || []).filter(Boolean)
  });
}

function outletAccessForUser(user, db) {
  if (user.accessAllOutlets) return db.outlets || [];
  if (Array.isArray(user.allowedOutlets) && user.allowedOutlets.length) return user.allowedOutlets;
  return user.outlet ? [user.outlet] : [];
}

function reports(db) {
  const tickets = db.tickets || [];
  const tasks = db.tasks || [];
  const closedTickets = tickets.filter((ticket) => ticket.status === "Closed");
  const doneTasks = tasks.filter((task) => task.status === "Done").length;
  const closePriceTotal = closedTickets.reduce((sum, ticket) => sum + Number(ticket.closePrice || 0), 0);
  return {
    open: tickets.filter((ticket) => ["Closed", "Cancelled"].indexOf(ticket.status) === -1).length,
    closed: closedTickets.length,
    total: tickets.length,
    closePriceTotal,
    closePriceCount: closedTickets.filter((ticket) => Number(ticket.closePrice || 0) > 0).length,
    taskCompletionRate: tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0,
    technicianCount: (db.technicians || []).length,
    byOutlet: (db.outlets || []).map((outlet) => ({
      outlet,
      count: tickets.filter((ticket) => ticket.outlet === outlet).length,
      open: tickets.filter((ticket) => ticket.outlet === outlet && ["Closed", "Cancelled"].indexOf(ticket.status) === -1).length,
      closed: tickets.filter((ticket) => ticket.outlet === outlet && ticket.status === "Closed").length,
      closePriceTotal: tickets.filter((ticket) => ticket.outlet === outlet && ticket.status === "Closed").reduce((sum, ticket) => sum + Number(ticket.closePrice || 0), 0)
    }))
  };
}

function nextId(items, prefix) {
  return prefix + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function createRow(db, route, body) {
  if (route.key === "outlets") {
    const name = String(body.name || "").trim();
    if (!name) return fail(400, "Outlet name is required");
    if (db.outlets.indexOf(name) === -1) db.outlets.push(name);
    db.outletLocations[name] = { branch: body.branch || "", address: body.address || "", latitude: body.latitude || null, longitude: body.longitude || null };
    saveDb(db);
    return ok({ name, reports: reports(db) });
  }
  const row = Object.assign({}, body);
  row.id = row.id || nextId(db[route.key], route.prefix);
  if (route.key === "users" && !row.passwordPlain && row.password) row.passwordPlain = row.password;
  db[route.key].push(row);
  saveDb(db);
  return ok(Object.assign({}, row, { reports: reports(db) }));
}

function renameOutletEverywhere(db, oldName, name) {
  // Rename every reference to an outlet across all collections: item.outlet strings
  // plus the allowedOutlets (users) and serviceOutlets (technicians) arrays.
  ["assets", "tickets", "tasks", "users", "technicians", "maintenanceRules", "maintenanceRuleAssignments", "attendancePlans", "assignmentTimeWindows"].forEach(function(key) {
    (db[key] || []).forEach(function(item) {
      if (item.outlet === oldName) item.outlet = name;
      ["allowedOutlets", "serviceOutlets"].forEach(function(listKey) {
        if (Array.isArray(item[listKey])) {
          item[listKey] = item[listKey].map(function(value) { return value === oldName ? name : value; });
        }
      });
    });
  });
}

function patchRow(db, route, id, body) {
  if (route.key === "outlets") {
    const oldName = id;
    const name = String(body.name || oldName).trim();
    db.outlets = db.outlets.map((item) => item === oldName ? name : item);
    renameOutletEverywhere(db, oldName, name);
    const previousLocation = db.outletLocations[oldName] || {};
    delete db.outletLocations[oldName];
    db.outletLocations[name] = {
      branch: body.branch || previousLocation.branch || "",
      address: body.address || previousLocation.address || "",
      latitude: body.latitude != null ? body.latitude : (previousLocation.latitude || null),
      longitude: body.longitude != null ? body.longitude : (previousLocation.longitude || null)
    };
    saveDb(db);
    return ok({ name, reports: reports(db) });
  }
  const item = db[route.key].find((row) => row[route.id] === id);
  if (!item) return fail(404, "Record not found");
  Object.keys(body || {}).forEach((key) => { item[key] = body[key]; });
  saveDb(db);
  return ok(Object.assign({}, item, { reports: reports(db) }));
}

function deleteRow(db, route, id) {
  if (route.key === "outlets") {
    db.outlets = db.outlets.filter((item) => item !== id);
    delete db.outletLocations[id];
  } else {
    db[route.key] = db[route.key].filter((row) => row[route.id] !== id);
  }
  saveDb(db);
  return ok({ ok: true, reports: reports(db) });
}

function deleteById(db, key, id) {
  db[key] = (db[key] || []).filter((item) => item.id !== id);
  saveDb(db);
  return ok({ ok: true, reports: reports(db) });
}

function createTicket(db, body, user) {
  if (!body.outlet || !body.category || !body.impact) return fail(400, "outlet, category and impact are required");
  const ticketId = nextId(db.tickets, "TK-");
  const photoUrls = storePhotoList(body.photoUrls && body.photoUrls.length ? body.photoUrls : (body.photoUrl ? [body.photoUrl] : []), "ticket-" + ticketId);
  const ticket = {
    id: ticketId,
    outlet: body.outlet,
    category: body.category,
    assetId: body.assetId || "",
    impact: body.impact,
    area: body.area || "",
    note: body.note || "",
    priority: priorityForImpact(body.impact),
    status: body.assignedTo ? "Assigned" : "New",
    assignedTo: body.assignedTo || "",
    scheduledAt: body.scheduledAt || "",
    photoUrl: photoUrls[0] || "",
    photoUrls: photoUrls,
    createdBy: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestDetail: body.note || "Created",
    history: []
  };
  appendTicketHistory(ticket, "Created" + (body.assignedTo ? " (pre-assigned)" : ""), user);
  db.tickets.unshift(ticket);
  saveDb(db);
  return { ok: true, status: 201, body: ticket };
}

function priorityForImpact(impact) {
  if (impact === "Service stopped" || impact === "Food safety risk") return "P1";
  if (impact === "Customer visible") return "P2";
  if (impact === "Cosmetic") return "P4";
  return "P3";
}

// Append-only per-ticket audit trail. Capped so a long-lived ticket cannot
// bloat the snapshot.
const TICKET_HISTORY_MAX = 50;

function appendTicketHistory(ticket, action, actor) {
  if (!Array.isArray(ticket.history)) ticket.history = [];
  ticket.history.push({
    at: new Date().toISOString(),
    action: String(action || "Updated"),
    by: (actor && (actor.name || actor.username || actor.id)) || "system"
  });
  if (ticket.history.length > TICKET_HISTORY_MAX) ticket.history = ticket.history.slice(-TICKET_HISTORY_MAX);
}

function updateTicket(db, id, fields, actor, action) {
  const ticket = db.tickets.find((item) => item.id === id);
  if (!ticket) return fail(404, "Ticket not found");
  Object.keys(fields || {}).forEach((key) => { ticket[key] = fields[key]; });
  ticket.updatedAt = new Date().toISOString();
  appendTicketHistory(ticket, action || (fields && fields.status ? "Status → " + fields.status : "Updated"), actor);
  saveDb(db);
  return ok({ ticket, reports: reports(db) });
}

function assignTicket(db, id, body, actor) {
  const techId = body.technicianId || body.assignedTo || "";
  const tech = techId ? (db.technicians || []).find((item) => item.id === techId) : null;
  const action = techId ? "Assigned to " + ((tech && tech.name) || techId) : "Unassigned";
  return updateTicket(db, id, { assignedTo: techId, scheduledAt: body.scheduledAt || "", status: techId ? "Assigned" : "New", latestDetail: "Assigned" }, actor, action);
}

function updateTechnician(db, id, fields) {
  const tech = db.technicians.find((item) => item.id === id);
  if (!tech) return fail(404, "Technician not found");
  Object.keys(fields || {}).forEach((key) => { tech[key] = fields[key]; });
  saveDb(db);
  return ok({ technician: tech, reports: reports(db) });
}

function updateTaskStatus(db, id, status, body) {
  const task = db.tasks.find((item) => item.id === id);
  if (!task) return fail(404, "Task not found");
  task.status = status;
  task.evidenceComment = body.comment || task.evidenceComment || "";
  task.photoUrl = storePhotoValue(body.photoUrl, "task-" + id) || task.photoUrl || "";
  task.photoUrls = body.photoUrls ? storePhotoList(body.photoUrls, "task-" + id) : (task.photoUrls || []);
  task.completedAt = status === "Done" ? new Date().toISOString() : "";
  saveDb(db);
  return ok({ task, reports: reports(db) });
}

function createAttendancePlan(db, technicianId, body, user) {
  const status = body.status || "Present";
  const tech = db.technicians.find((item) => item.id === technicianId);
  if (!tech) return fail(404, "Technician not found");
  tech.status = status;
  const plan = {
    id: nextId(db.attendancePlans, "ATT-"),
    technicianId,
    status,
    startsAt: body.startsAt || new Date().toISOString(),
    endsAt: body.endsAt || "",
    reason: body.reason || "",
    createdBy: user.name || user.username || "",
    createdAt: new Date().toISOString()
  };
  db.attendancePlans.push(plan);
  saveDb(db);
  return { ok: true, status: 201, body: { plan, reports: reports(db) } };
}

function technicianDashboard(db, technicianId) {
  return {
    technician: (db.technicians || []).find((tech) => tech.id === technicianId) || null,
    tasks: (db.tasks || []).filter((task) => task.assignedTo === technicianId),
    tickets: (db.tickets || []).filter((ticket) => ticket.assignedTo === technicianId)
  };
}

function todayTasksForTechnician(db, technicianId) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return (db.tasks || []).filter((task) => task.assignedTo === technicianId && (!task.date || task.date === today));
}

function exportCsv(db, type) {
  const rows = type === "tasks" ? db.tasks : type === "technicians" ? db.technicians : type === "outlets" ? (db.outlets || []).map((name) => ({ name })) : db.tickets;
  const keys = Object.keys(rows[0] || { empty: "" });
  const csv = [keys.join(",")].concat(rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))).join("\n");
  return { filename: "ticketops-" + type + ".csv", csv };
}

function csvCell(value) {
  const text = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value || "") : String(value == null ? "" : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function monthlyBackup(db, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(400, "Use month format YYYY-MM");
  return ok({
    type: "ticketops-monthly-backup",
    month,
    createdAt: new Date().toISOString(),
    storage: "google-sheets",
    outlets: db.outlets,
    outletLocations: db.outletLocations,
    categories: db.categories,
    assets: db.assets,
    technicians: db.technicians,
    maintenanceRules: db.maintenanceRules,
    assignmentTimeWindows: db.assignmentTimeWindows,
    tickets: (db.tickets || []).filter((ticket) => String(ticket.createdAt || ticket.updatedAt || "").slice(0, 7) === month),
    tasks: (db.tasks || []).filter((task) => String(task.date || task.createdAt || "").slice(0, 7) === month)
  });
}

function scheduledDriveBackup() {
  return createDriveBackup("scheduled");
}

function createDriveBackup(reason) {
  const db = loadDb();
  if (db.__readOnlyFallback) throw new Error("Backup skipped because live DB is in recovery fallback.");
  const normalized = normalizeDb(JSON.parse(JSON.stringify(db)));
  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd-HH-mm-ss");
  const counts = backupCounts(normalized);
  const payload = {
    type: "ticketops-full-drive-backup",
    version: 1,
    reason: reason || "manual",
    createdAt: now.toISOString(),
    timezone: Session.getScriptTimeZone(),
    retentionDays: BACKUP_RETENTION_DAYS,
    counts,
    db: normalized
  };
  const json = JSON.stringify(payload);
  const checksum = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json)
    .map(function(byte) { return ("0" + ((byte < 0 ? byte + 256 : byte).toString(16))).slice(-2); })
    .join("");
  payload.sha256 = checksum;
  const finalJson = JSON.stringify(payload);
  const folder = backupFolder();
  const filename = BACKUP_FILE_PREFIX + stamp + "-u" + counts.users + "-t" + counts.tickets + "-tasks" + counts.tasks + ".json";
  const file = folder.createFile(filename, finalJson, "application/json");
  file.setDescription("TicketOps full DB backup. sha256=" + checksum + "; createdAt=" + payload.createdAt);
  const cleanup = cleanupOldDriveBackups(folder, now);
  return {
    ok: true,
    fileId: file.getId(),
    fileName: filename,
    folderId: folder.getId(),
    folderName: folder.getName(),
    createdAt: payload.createdAt,
    retentionDays: BACKUP_RETENTION_DAYS,
    deletedOldFiles: cleanup.deleted,
    keptFiles: cleanup.kept,
    counts,
    sha256: checksum
  };
}

function backupCounts(db) {
  return {
    users: (db.users || []).length,
    outlets: (db.outlets || []).length,
    categories: (db.categories || []).length,
    assets: (db.assets || []).length,
    technicians: (db.technicians || []).length,
    tickets: (db.tickets || []).length,
    tasks: (db.tasks || []).length,
    maintenanceRules: (db.maintenanceRules || []).length,
    attendancePlans: (db.attendancePlans || []).length,
    ticketHistory: (db.ticketHistory || []).length
  };
}

function backupFolder() {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty("TICKETOPS_BACKUP_FOLDER_ID");
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (error) {
      props.deleteProperty("TICKETOPS_BACKUP_FOLDER_ID");
    }
  }
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty("TICKETOPS_BACKUP_FOLDER_ID", folder.getId());
  return folder;
}

function cleanupOldDriveBackups(folder, now) {
  const cutoff = now.getTime() - (BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const files = folder.getFiles();
  let deleted = 0;
  let kept = 0;
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().indexOf(BACKUP_FILE_PREFIX) !== 0) continue;
    if (file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true);
      deleted += 1;
    } else {
      kept += 1;
    }
  }
  return { deleted, kept };
}

function restoreFromDriveBackup(body) {
  var fileId = body && body.fileId;
  if (!fileId) throw new Error("fileId is required");
  var content = DriveApp.getFileById(fileId).getBlob().getDataAsString();
  var payload = JSON.parse(content);
  var db = (payload.type === "ticketops-full-drive-backup" && payload.db) ? payload.db : payload;
  var result = importTicketOpsJson(db);
  return {
    ok: true,
    fileId: fileId,
    users: (db.users || []).length,
    tickets: (db.tickets || []).length,
    tasks: (db.tasks || []).length,
    bytesWritten: result.rows
  };
}

function driveBackupStatus() {
  const folder = backupFolder();
  const files = folder.getFiles();
  const backups = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().indexOf(BACKUP_FILE_PREFIX) !== 0) continue;
    backups.push({
      id: file.getId(),
      name: file.getName(),
      createdAt: file.getDateCreated().toISOString(),
      size: file.getSize()
    });
  }
  backups.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return {
    folderId: folder.getId(),
    folderName: folder.getName(),
    retentionDays: BACKUP_RETENTION_DAYS,
    scheduleHours: BACKUP_TRIGGER_HOURS,
    expectedMonthlyFiles: BACKUP_TRIGGER_HOURS.length * 30,
    backupCount: backups.length,
    latest: backups.slice(0, 10),
    triggers: ScriptApp.getProjectTriggers()
      .filter(function(trigger) { return trigger.getHandlerFunction() === "scheduledDriveBackup"; })
      .map(function(trigger) { return { handler: trigger.getHandlerFunction(), eventType: String(trigger.getEventType()) }; })
  };
}

function installDriveBackupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "scheduledDriveBackup") ScriptApp.deleteTrigger(trigger);
  });
  BACKUP_TRIGGER_HOURS.forEach(function(hour) {
    ScriptApp.newTrigger("scheduledDriveBackup")
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .nearMinute(0)
      .create();
  });
  const firstBackup = createDriveBackup("install-verification");
  const status = driveBackupStatus();
  return {
    ok: true,
    installedTriggers: BACKUP_TRIGGER_HOURS.length,
    scheduleHours: BACKUP_TRIGGER_HOURS,
    retentionDays: BACKUP_RETENTION_DAYS,
    firstBackup,
    status
  };
}

// ---- Daily digest (8am email to admins) ----------------------------------
// Recipients live in the TICKETOPS_DIGEST_RECIPIENTS script property
// (comma-separated), set via POST /api/admin/digest/install {recipients}.
const DIGEST_RECIPIENTS_PROP = "TICKETOPS_DIGEST_RECIPIENTS";

function digestRecipients() {
  const stored = PropertiesService.getScriptProperties().getProperty(DIGEST_RECIPIENTS_PROP) || "";
  return stored.split(",").map((item) => item.trim()).filter(Boolean);
}

function buildDailyDigest(db) {
  const now = new Date();
  const today = dateKey();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const tickets = db.tickets || [];
  const tasks = db.tasks || [];
  const isOpen = (ticket) => ["Closed", "Cancelled"].indexOf(ticket.status) === -1;
  const openP1 = tickets.filter((ticket) => isOpen(ticket) && ticket.priority === "P1")
    .map((ticket) => ({ id: ticket.id, outlet: ticket.outlet, note: ticket.note || "", ageHours: Math.round((now.getTime() - new Date(ticket.createdAt).getTime()) / 3600000) }));
  const todayTasks = tasks.filter((task) => task.date === today);
  const doneToday = todayTasks.filter((task) => task.status === "Done").length;
  return {
    date: today,
    open: tickets.filter(isOpen).length,
    openP1,
    createdYesterday: tickets.filter((ticket) => String(ticket.createdAt || "").slice(0, 10) === yesterday).length,
    closedYesterday: tickets.filter((ticket) => ticket.status === "Closed" && String(ticket.updatedAt || "").slice(0, 10) === yesterday).length,
    checklistToday: { done: doneToday, total: todayTasks.length, rate: todayTasks.length ? Math.round((doneToday / todayTasks.length) * 100) : 0 },
    monthClosePriceTotal: tickets.filter((ticket) => ticket.status === "Closed" && String(ticket.closePriceAt || ticket.updatedAt || "").slice(0, 7) === month)
      .reduce((sum, ticket) => sum + Number(ticket.closePrice || 0), 0),
    recipients: digestRecipients()
  };
}

function digestHtml(digest) {
  const p1Rows = digest.openP1.length
    ? digest.openP1.map((t) => "<li><b>" + t.id + "</b> — " + t.outlet + " — " + t.note + " (" + t.ageHours + "h old)</li>").join("")
    : "<li>None 🎉</li>";
  return "<h2>TicketOps — " + digest.date + "</h2>" +
    "<p><b>" + digest.open + "</b> tickets open · <b>" + digest.createdYesterday + "</b> new yesterday · <b>" + digest.closedYesterday + "</b> closed yesterday</p>" +
    "<p>Today's checklist: <b>" + digest.checklistToday.done + "/" + digest.checklistToday.total + "</b> (" + digest.checklistToday.rate + "%)</p>" +
    "<p>Month repair spend: <b>Rs. " + digest.monthClosePriceTotal + "</b></p>" +
    "<h3>Open P1 (critical)</h3><ul>" + p1Rows + "</ul>" +
    "<p><a href=\"https://ticketops-silk.vercel.app\">Open TicketOps</a></p>";
}

function sendDailyDigest() {
  const recipients = digestRecipients();
  if (!recipients.length) throw new Error("No digest recipients configured. POST /api/admin/digest/install with {recipients:\"a@b.com,c@d.com\"} first.");
  const digest = buildDailyDigest(loadDb());
  MailApp.sendEmail({
    to: recipients.join(","),
    subject: "TicketOps daily digest — " + digest.date + " (" + digest.open + " open, " + digest.openP1.length + " P1)",
    htmlBody: digestHtml(digest)
  });
  return { ok: true, sentTo: recipients, date: digest.date };
}

function installDailyDigestTrigger(body) {
  if (body && body.recipients) {
    PropertiesService.getScriptProperties().setProperty(DIGEST_RECIPIENTS_PROP, String(body.recipients));
  }
  if (!digestRecipients().length) throw new Error("Pass {recipients:\"a@b.com\"} — no recipients configured.");
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === "sendDailyDigest") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("sendDailyDigest").timeBased().everyDays(1).atHour(8).nearMinute(0).create();
  return { ok: true, recipients: digestRecipients(), schedule: "daily 08:00 " + Session.getScriptTimeZone() };
}

function backupReport(backup) {
  const tickets = backup.tickets || [];
  const tasks = backup.tasks || [];
  return {
    month: backup.month,
    totals: {
      tickets: tickets.length,
      openTickets: tickets.filter((ticket) => ["Closed", "Cancelled"].indexOf(ticket.status) === -1).length,
      closedTickets: tickets.filter((ticket) => ticket.status === "Closed").length,
      tasks: tasks.length,
      completedTasks: tasks.filter((task) => task.status === "Done").length,
      taskCompletionRate: tasks.length ? Math.round((tasks.filter((task) => task.status === "Done").length / tasks.length) * 100) : 0
    },
    byOutlet: (backup.outlets || []).map((outlet) => ({
      outlet,
      tickets: tickets.filter((ticket) => ticket.outlet === outlet).length,
      closed: tickets.filter((ticket) => ticket.outlet === outlet && ticket.status === "Closed").length,
      tasks: tasks.filter((task) => task.outlet === outlet).length,
      doneTasks: tasks.filter((task) => task.outlet === outlet && task.status === "Done").length
    }))
  };
}
