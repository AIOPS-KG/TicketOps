"use strict";
// One-time migration: load the live GAS/Sheets snapshot (gas-bootstrap-snapshot-2026-07-20.json)
// into the self-hosted Postgres backend's schema (to_* tables). Run inside the
// ticketops-backend container, which already has `pg` installed and network
// access to the `postgres` container.
//
// Known gaps (schema has no column for these — dropped on import, not silently
// invented): maintenanceRules.startTime/endTime/reminderDays/createdAt,
// tasks.evidenceAt. ticket/task photoCount fields are bootstrap-only derived
// values, not stored columns — also dropped, harmless.
//
// Password handling: GAS never returns real passwords via the API (publicUser
// strips them). Users present in Code.gs's DEFAULT_PASSWORDS map get that
// password. Users NOT in that map (added after the map was written) get a
// placeholder "<firstname>123" password and MUST be told to reset it.

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DEFAULT_PASSWORDS = {
  aiops: "AIops", "chintan.patel": "chintan123", "meet.patel": "meet123", demo: "demo123",
  manish: "manish123", "pratik.patel": "pratik123", "hussain.sheikh": "hussain123",
  "rahil.shah": "rahil123", "umang.naidu": "umang123", "viren.barapatre": "viren123",
  vicky: "vicky123", "rahul.patil": "rahul123", abrar: "abrar123", uday: "uday123", hiten: "hiten123",
};

function placeholderPassword(username) {
  const first = String(username).split(".")[0].toLowerCase();
  return first + "123";
}

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "ticketops_app",
  user: process.env.PGUSER || "ticketops",
  password: process.env.PGPASSWORD || "Ticketops@2024!",
});

function pq(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }
async function run(sql, params = []) { return pool.query(pq(sql), params); }

async function main() {
  const snapshotPath = path.join(__dirname, "gas-bootstrap-snapshot-2026-07-20.json");
  const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const db = raw.body || raw;

  console.log("Source counts:", {
    users: db.users.length, outlets: db.outlets.length, categories: db.categories.length,
    assets: db.assets.length, technicians: db.technicians.length, tickets: db.tickets.length,
    tasks: db.tasks.length, maintenanceRules: db.maintenanceRules.length,
    assignmentTimeWindows: db.assignmentTimeWindows.length, attendancePlans: db.attendancePlans.length,
  });

  console.log("Wiping existing rows...");
  await run(`TRUNCATE to_tickets, to_tasks, to_attendance_plans, to_assignment_windows,
             to_maintenance_rules, to_assets, to_technicians, to_outlet_locations,
             to_outlets, to_categories, to_users RESTART IDENTITY CASCADE`);

  const placeholders = [];

  console.log("Inserting users...");
  for (const u of db.users) {
    const known = DEFAULT_PASSWORDS[u.username];
    const pw = known || placeholderPassword(u.username);
    if (!known) placeholders.push(u.username);
    await run(
      `INSERT INTO to_users (id,username,password_plain,name,post,role,technician_id,access_all_outlets,allowed_outlets,outlet,default_view,allowed_views)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id, u.username, pw, u.name || "", u.post || "", u.role || "user",
       u.technicianId || null, !!u.accessAllOutlets, JSON.stringify(u.allowedOutlets || []),
       u.outlet || null, u.defaultView || "dashboard", JSON.stringify(u.allowedViews || [])]
    );
  }

  console.log("Inserting outlets + locations...");
  for (const name of db.outlets) {
    await run(`INSERT INTO to_outlets (name) VALUES (?)`, [name]);
  }
  for (const [name, loc] of Object.entries(db.outletLocations || {})) {
    await run(
      `INSERT INTO to_outlet_locations (outlet_name,branch,address,latitude,longitude) VALUES (?,?,?,?,?)`,
      [name, loc.branch || "", loc.address || "", loc.latitude ?? null, loc.longitude ?? null]
    );
  }

  console.log("Inserting categories...");
  for (const c of db.categories) {
    await run(`INSERT INTO to_categories (id,name,description) VALUES (?,?,?)`, [c.id, c.name, c.description || ""]);
  }

  console.log("Inserting assets...");
  for (const a of db.assets) {
    const { id, name, category, outlet, status, make, model, serialNo, installedAt, warrantyUntil, notes, ...rest } = a;
    await run(
      `INSERT INTO to_assets (id,name,category,outlet,status,make,model,serial_no,installed_at,warranty_until,notes,extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, name || "", category || "", outlet || "", status || "Active", make || "", model || "",
       serialNo || "", installedAt || "", warrantyUntil || "", notes || "", JSON.stringify(rest)]
    );
  }

  console.log("Inserting technicians...");
  for (const t of db.technicians) {
    const skillArray = Array.isArray(t.skills) ? t.skills : (Array.isArray(t.skill) ? t.skill : []);
    await run(
      `INSERT INTO to_technicians (id,name,skill,status,quality,service_outlets) VALUES (?,?,?,?,?,?)`,
      [t.id, t.name || "", JSON.stringify(skillArray), t.status || "Present", t.quality || 0, JSON.stringify(t.serviceOutlets || [])]
    );
  }

  console.log("Inserting maintenance rules...");
  for (const r of db.maintenanceRules) {
    await run(
      `INSERT INTO to_maintenance_rules (id,title,category,frequency,phase,rule_group,outlet,active,recurrence_day_of_week,recurrence_day_of_month,recurrence_months,assigned_technician_id,allow_outside_window)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.title || "", r.category || "", r.frequency || "daily", r.phase || "Checklist",
       r.group || "Maintenance", r.outlet || "", r.active !== false,
       r.recurrenceDayOfWeek ?? null, r.recurrenceDayOfMonth ?? null,
       JSON.stringify(r.recurrenceMonths || []), r.assignedTechnicianId || "", !!r.allowOutsideWindow]
    );
  }

  console.log("Inserting assignment windows...");
  for (const w of db.assignmentTimeWindows) {
    const { id, ...data } = w;
    await run(`INSERT INTO to_assignment_windows (id,data) VALUES (?,?)`, [id, JSON.stringify(data)]);
  }

  console.log("Inserting attendance plans...");
  for (const p of db.attendancePlans) {
    await run(
      `INSERT INTO to_attendance_plans (id,technician_id,status,starts_at,ends_at,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [p.id, p.technicianId || "", p.status || "Present", p.startsAt || "", p.endsAt || "",
       p.reason || "", p.createdBy || "", p.createdAt || new Date().toISOString()]
    );
  }

  console.log("Inserting tickets...");
  for (const t of db.tickets) {
    await run(
      `INSERT INTO to_tickets (id,outlet,category,asset_id,impact,area,note,priority,status,assigned_to,scheduled_at,photo_url,photo_urls,created_by,created_at,updated_at,latest_detail,close_price,close_price_by,close_price_at,evidence_photo_url,evidence_photo_urls)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.outlet || "", t.category || "", t.assetId || "", t.impact || "", t.area || "", t.note || "",
       t.priority || "P3", t.status || "New", t.assignedTo || "", t.scheduledAt || "",
       t.photoUrl || "", JSON.stringify(t.photoUrls || []), t.createdBy || "",
       t.createdAt || new Date().toISOString(), t.updatedAt || new Date().toISOString(),
       t.latestDetail || "", t.closePrice || null, t.closePriceBy || null, t.closePriceAt || null,
       t.evidencePhotoUrl || "", JSON.stringify(t.evidencePhotoUrls || [])]
    );
  }

  console.log("Inserting tasks...");
  for (const t of db.tasks) {
    await run(
      `INSERT INTO to_tasks (id,title,asset_id,outlet,assigned_to,rule_id,status,date,completed_at,notes,evidence_comment,photo_url,photo_urls)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.title || "", t.assetId || "", t.outlet || "", t.assignedTo || "", t.ruleId || "",
       t.status || "Pending", t.date || "", t.completedAt || "", t.notes || "",
       t.evidenceComment || "", t.photoUrl || "", JSON.stringify(t.photoUrls || [])]
    );
  }

  console.log("\nVerifying final counts...");
  const tables = ["to_users","to_outlets","to_categories","to_assets","to_technicians","to_tickets","to_tasks","to_maintenance_rules","to_assignment_windows","to_attendance_plans"];
  for (const tbl of tables) {
    const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM ${tbl}`);
    console.log(`  ${tbl}: ${rows[0].n}`);
  }

  if (placeholders.length) {
    console.log(`\n${placeholders.length} users got a PLACEHOLDER password (firstname+123) — not their real password: ${placeholders.join(", ")}`);
  }

  await pool.end();
  console.log("\nMigration complete.");
}

main().catch(err => { console.error("MIGRATION FAILED:", err); process.exit(1); });
