const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

async function dbInit() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.");
  }

  await pool.query(schema);

  await pool.query(
    `INSERT INTO settings (id, school_name, address, phone)
     VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [
      "Aliyy Bin Umar Tahfizul Qur'an Wa Ulumuddeen",
      "Behind Umar Wade Wade Filling Station",
      "07035147904 / 09043842355"
    ]
  );

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const exists = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
  if (!exists.rowCount) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
      [username, hash]
    );
    console.log(`Created admin user: ${username}`);
  }
}

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new pgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

function clean(v) {
  return typeof v === "string" ? v.trim() : (v ?? null);
}

function normalizeStudent(body) {
  return {
    full_name: clean(body.full_name),
    dob: clean(body.dob) || null,
    gender: clean(body.gender) || null,
    nationality: clean(body.nationality) || null,
    state: clean(body.state) || null,
    lga: clean(body.lga) || null,
    class_level: clean(body.class_level) || null,
    programme: clean(body.programme) || null,
    guardian: clean(body.guardian) || null,
    guardian_phone: clean(body.guardian_phone) || null,
    alt_phone: clean(body.alt_phone) || null,
    previous_school: clean(body.previous_school) || null,
    address: clean(body.address) || null,
    quran_level: clean(body.quran_level) || null,
    medical: clean(body.medical) || null,
    notes: clean(body.notes) || null
  };
}

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: Boolean(req.session.userId),
    username: req.session.username || null
  });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  try {
    const username = clean(req.body.username);
    const password = req.body.password || "";
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username=$1",
      [username]
    );
    if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    req.session.userId = result.rows[0].id;
    req.session.username = result.rows[0].username;
    res.json({ ok: true, username: result.rows[0].username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const [students, classes, fees, quran] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM students"),
      pool.query("SELECT COUNT(DISTINCT class_level)::int AS count FROM students WHERE class_level IS NOT NULL AND class_level <> ''"),
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric AS total FROM fees"),
      pool.query("SELECT COUNT(*)::int AS count FROM quran_records")
    ]);
    res.json({
      students: students.rows[0].count,
      classes: classes.rows[0].count,
      fees: Number(fees.rows[0].total),
      quranRecords: quran.rows[0].count
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load dashboard." });
  }
});

app.get("/api/students", requireAuth, async (req, res) => {
  try {
    const q = clean(req.query.search) || "";
    const c = clean(req.query.class_level) || "";
    const g = clean(req.query.gender) || "";
    const result = await pool.query(
      `SELECT * FROM students
       WHERE ($1 = '' OR full_name ILIKE '%' || $1 || '%' OR reg_no ILIKE '%' || $1 || '%')
         AND ($2 = '' OR class_level=$2)
         AND ($3 = '' OR gender=$3)
       ORDER BY class_level, gender, full_name`,
      [q,c,g]
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load students." });
  }
});

app.post("/api/students", requireAuth, async (req, res) => {
  const s = normalizeStudent(req.body);
  if (!s.full_name) return res.status(400).json({ error: "Student full name is required." });
  if (!["Class 1","Class 2","Class 3"].includes(s.class_level)) return res.status(400).json({ error: "Please select Class 1, Class 2 or Class 3." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seq = await client.query("SELECT nextval('student_reg_seq') AS n");
    const n = Number(seq.rows[0].n);
    const regNo = `ABU-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;

    const result = await client.query(
      `INSERT INTO students
       (reg_no, full_name, dob, gender, nationality, state, lga, class_level, programme,
        guardian, guardian_phone, alt_phone, previous_school, address, quran_level, medical, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [regNo, s.full_name, s.dob, s.gender, s.nationality, s.state, s.lga, s.class_level,
       s.programme, s.guardian, s.guardian_phone, s.alt_phone, s.previous_school,
       s.address, s.quran_level, s.medical, s.notes]
    );
    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Could not register student." });
  } finally {
    client.release();
  }
});

app.put("/api/students/:id", requireAuth, async (req, res) => {
  const s = normalizeStudent(req.body);
  if (!s.full_name) return res.status(400).json({ error: "Student full name is required." });
  try {
    const result = await pool.query(
      `UPDATE students SET
       full_name=$1,dob=$2,gender=$3,nationality=$4,state=$5,lga=$6,class_level=$7,programme=$8,
       guardian=$9,guardian_phone=$10,alt_phone=$11,previous_school=$12,address=$13,quran_level=$14,
       medical=$15,notes=$16,updated_at=NOW()
       WHERE id=$17 RETURNING *`,
      [s.full_name,s.dob,s.gender,s.nationality,s.state,s.lga,s.class_level,s.programme,
       s.guardian,s.guardian_phone,s.alt_phone,s.previous_school,s.address,s.quran_level,
       s.medical,s.notes,req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Student not found." });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update student." });
  }
});

app.delete("/api/students/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM students WHERE id=$1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Student not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete student." });
  }
});

app.get("/api/students/:id/full", requireAuth, async (req, res) => {
  try {
    const [student, fees, quran] = await Promise.all([
      pool.query("SELECT * FROM students WHERE id=$1", [req.params.id]),
      pool.query("SELECT * FROM fees WHERE student_id=$1 ORDER BY payment_date DESC, created_at DESC", [req.params.id]),
      pool.query("SELECT * FROM quran_records WHERE student_id=$1 ORDER BY record_date DESC, created_at DESC", [req.params.id])
    ]);
    if (!student.rowCount) return res.status(404).json({ error: "Student not found." });
    res.json({ student: student.rows[0], fees: fees.rows, quran: quran.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load student profile." });
  }
});

app.get("/api/classes", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.class_level,
              COUNT(s.id)::int AS total,
              COUNT(s.id) FILTER (WHERE s.gender='Male')::int AS male,
              COUNT(s.id) FILTER (WHERE s.gender='Female')::int AS female
       FROM (VALUES ('Class 1'),('Class 2'),('Class 3')) AS c(class_level)
       LEFT JOIN students s ON s.class_level=c.class_level
       GROUP BY c.class_level
       ORDER BY c.class_level`
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load classes." });
  }
});

app.get("/api/attendance", requireAuth, async (req, res) => {
  try {
    const date = clean(req.query.date) || new Date().toISOString().slice(0,10);
    const result = await pool.query(
      `SELECT s.id,s.reg_no,s.full_name,s.class_level,s.gender,
              COALESCE(a.status,'Absent') AS status
       FROM students s LEFT JOIN attendance a
         ON a.student_id=s.id AND a.attendance_date=$1
       WHERE ($2='' OR s.class_level=$2) AND ($3='' OR s.gender=$3)
       ORDER BY s.class_level,s.gender,s.full_name`,
      [date, clean(req.query.class_level)||'', clean(req.query.gender)||'']
    );
    res.json(result.rows);
  } catch(e){ console.error(e); res.status(500).json({error:"Could not load attendance."}); }
});

app.post("/api/attendance", requireAuth, async (req,res)=>{
  try {
    const date=clean(req.body.attendance_date)||new Date().toISOString().slice(0,10);
    const entries=Array.isArray(req.body.entries)?req.body.entries:[];
    if(!entries.length) return res.status(400).json({error:"No attendance entries supplied."});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      for(const x of entries){
        if(!x.student_id || !['Present','Absent','Late'].includes(x.status)) continue;
        await client.query(`INSERT INTO attendance(student_id,attendance_date,status) VALUES($1,$2,$3)
          ON CONFLICT(student_id,attendance_date) DO UPDATE SET status=EXCLUDED.status`,[x.student_id,date,x.status]);
      }
      await client.query('COMMIT');
    } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    res.json({ok:true,date});
  } catch(e){ await pool.query('ROLLBACK').catch(()=>{}); console.error(e); res.status(500).json({error:"Could not save attendance."}); }
});

app.get("/api/attendance/report", requireAuth, async (req,res)=>{
  try {
    const from=clean(req.query.from)||new Date().toISOString().slice(0,10);
    const to=clean(req.query.to)||from;
    const result=await pool.query(`
      SELECT s.reg_no,s.full_name,s.class_level,s.gender,
        COUNT(a.id) FILTER (WHERE a.status='Present')::int AS present,
        COUNT(a.id) FILTER (WHERE a.status='Absent')::int AS absent,
        COUNT(a.id) FILTER (WHERE a.status='Late')::int AS late
      FROM students s LEFT JOIN attendance a ON a.student_id=s.id AND a.attendance_date BETWEEN $1 AND $2
      WHERE ($3='' OR s.class_level=$3) AND ($4='' OR s.gender=$4)
      GROUP BY s.id ORDER BY s.class_level,s.gender,s.full_name`,
      [from,to,clean(req.query.class_level)||'',clean(req.query.gender)||'']);
    res.json(result.rows);
  } catch(e){console.error(e);res.status(500).json({error:"Could not load attendance report."});}
});

app.get("/api/fees", requireAuth, async (req, res) => {
  try {
    const c=clean(req.query.class_level)||'', g=clean(req.query.gender)||'';
    const result = await pool.query(
      `SELECT f.*, s.full_name, s.reg_no, s.class_level, s.gender
       FROM fees f JOIN students s ON s.id=f.student_id
       WHERE ($1='' OR s.class_level=$1) AND ($2='' OR s.gender=$2)
       ORDER BY f.payment_date DESC, f.created_at DESC`, [c,g]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: "Could not load fees." });
  }
});

app.post("/api/fees", requireAuth, async (req, res) => {
  try {
    const studentId = clean(req.body.student_id);
    const amount = Number(req.body.amount);
    const feeType = clean(req.body.fee_type);
    if (!studentId || !Number.isFinite(amount) || amount < 0 || !feeType) {
      return res.status(400).json({ error: "Student, amount and fee type are required." });
    }
    const result = await pool.query(
      `INSERT INTO fees(student_id,amount,fee_type,payment_date,receipt_no,note)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [studentId, amount, feeType, clean(req.body.payment_date) || new Date().toISOString().slice(0,10),
       clean(req.body.receipt_no) || null, clean(req.body.note) || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save payment." });
  }
});

app.delete("/api/fees/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM fees WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not delete payment." });
  }
});

app.get("/api/quran", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT q.*, s.full_name, s.reg_no
       FROM quran_records q JOIN students s ON s.id=q.student_id
       ORDER BY q.record_date DESC, q.created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: "Could not load Qur'an records." });
  }
});

app.post("/api/quran", requireAuth, async (req, res) => {
  try {
    const studentId = clean(req.body.student_id);
    const partName = clean(req.body.part_name);
    if (!studentId || !partName) return res.status(400).json({ error: "Student and Qur'an part are required." });
    const result = await pool.query(
      `INSERT INTO quran_records(student_id,part_name,status,record_date,note)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [studentId, partName, clean(req.body.status) || "Completed",
       clean(req.body.record_date) || new Date().toISOString().slice(0,10),
       clean(req.body.note) || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save Qur'an record." });
  }
});

app.delete("/api/quran/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM quran_records WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not delete Qur'an record." });
  }
});

app.get("/api/settings", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT school_name,address,phone FROM settings WHERE id=1");
  res.json(result.rows[0]);
});

app.put("/api/settings", requireAuth, async (req, res) => {
  const schoolName = clean(req.body.school_name);
  const address = clean(req.body.address);
  const phone = clean(req.body.phone);
  if (!schoolName || !address || !phone) return res.status(400).json({ error: "All school settings are required." });
  const result = await pool.query(
    `UPDATE settings SET school_name=$1,address=$2,phone=$3,updated_at=NOW()
     WHERE id=1 RETURNING school_name,address,phone`,
    [schoolName,address,phone]
  );
  res.json(result.rows[0]);
});

app.put("/api/password", requireAuth, async (req, res) => {
  try {
    const current = req.body.current_password || "";
    const next = req.body.new_password || "";
    if (next.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
    const user = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.session.userId]);
    if (!user.rowCount || !(await bcrypt.compare(current, user.rows[0].password_hash))) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    const hash = await bcrypt.hash(next, 12);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.session.userId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not change password." });
  }
});

app.get("/api/export/students.csv", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM students ORDER BY created_at DESC");
  const headers = ["reg_no","full_name","dob","gender","class_level","programme","guardian","guardian_phone","state","lga","address","quran_level"];
  const esc = v => `"${String(v ?? "").replaceAll('"','""')}"`;
  const csv = [
    headers.join(","),
    ...result.rows.map(r => headers.map(h => esc(r[h])).join(","))
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="students.csv"');
  res.send(csv);
});

app.get("/api/backup.json", requireAuth, async (req, res) => {
  const [settings, students, fees, quran, attendance] = await Promise.all([
    pool.query("SELECT school_name,address,phone FROM settings WHERE id=1"),
    pool.query("SELECT * FROM students ORDER BY created_at"),
    pool.query("SELECT * FROM fees ORDER BY created_at"),
    pool.query("SELECT * FROM quran_records ORDER BY created_at"),
    pool.query("SELECT * FROM attendance ORDER BY attendance_date, created_at")
  ]);
  const backup = {
    exportedAt: new Date().toISOString(),
    settings: settings.rows[0],
    students: students.rows,
    fees: fees.rows,
    quran: quran.rows,
    attendance: attendance.rows
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="school-backup.json"');
  res.send(JSON.stringify(backup, null, 2));
});

app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

dbInit()
  .then(() => {
    app.listen(PORT, () => console.log(`School portal running on port ${PORT}`));
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
