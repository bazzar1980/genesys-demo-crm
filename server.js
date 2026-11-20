/**
 * Genesys Cloud CRM — server.js
 * Express + Node:SQLite + session-based auth
 */
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const express = require('express');
const crypto  = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'crm.db');
const db = new DatabaseSync(DB_PATH);

// ── Schema ────────────────────────────────────────────────────────
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT,
    role        TEXT DEFAULT 'agent',
    can_use_integration INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT, phone TEXT,
    website TEXT, address TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT, phone TEXT, mobile TEXT, company_id TEXT REFERENCES companies(id),
    title TEXT, notes TEXT, genesys_external_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    status TEXT DEFAULT 'Open', priority TEXT DEFAULT 'Medium',
    contact_id TEXT REFERENCES contacts(id), company_id TEXT REFERENCES companies(id),
    assigned_to TEXT, workitem_id TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, direction TEXT,
    contact_id TEXT REFERENCES contacts(id), company_id TEXT REFERENCES companies(id),
    case_id TEXT REFERENCES cases(id), genesys_id TEXT, workitem_id TEXT,
    subject TEXT, notes TEXT, duration INTEGER, status TEXT DEFAULT 'Active',
    started_at TEXT, ended_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Migrations ────────────────────────────────────────────────────
try {
  db.exec(`ALTER TABLE contacts ADD COLUMN genesys_external_id TEXT`);
} catch (e) { /* already exists */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN integration_mode TEXT DEFAULT 'embedded'`);
} catch (e) { /* already exists */ }
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hashPassword = (p) => crypto.createHash('sha256').update(p + 'genesys-crm-salt').digest('hex');

// ── Seed admin user + demo data ───────────────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get();
if (userCount.n === 0) {
  db.prepare(`INSERT INTO users (id,username,password_hash,first_name,last_name,email,role,can_use_integration)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    uid(), 'admin', hashPassword('admin'), 'Admin', 'User', 'admin@crm.local', 'admin', 1
  );
  db.prepare(`INSERT INTO users (id,username,password_hash,first_name,last_name,email,role,can_use_integration)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    uid(), 'agent', hashPassword('agent'), 'Demo', 'Agent', 'agent@crm.local', 'agent', 1
  );
  console.log('Seeded users: admin/admin and agent/agent');
}
const cnt = db.prepare('SELECT COUNT(*) as n FROM companies').get();
if (cnt.n === 0) {
  const cid1 = uid(), cid2 = uid();
  db.prepare(`INSERT INTO companies (id,name,industry,phone,website,address) VALUES (?,?,?,?,?,?)`).run(cid1,'Acme Corporation','Manufacturing','+353 1 555 0100','https://acme.example.com','10 Business Park, Dublin 2');
  db.prepare(`INSERT INTO companies (id,name,industry,phone,website,address) VALUES (?,?,?,?,?,?)`).run(cid2,'Globex Ltd','Technology','+353 1 555 0200','https://globex.example.com','25 Tech Quarter, Dublin 4');
  const contacts = [
    [uid(),'Alice','Murphy','alice.murphy@acme.example.com','+353 87 100 1001','',cid1,'Head of Operations'],
    [uid(),'Bob','Kelly','bob.kelly@acme.example.com','+353 87 100 1002','',cid1,'Support Manager'],
    [uid(),'Carol','Quinn','carol.quinn@globex.example.com','+353 87 200 2001','',cid2,'CTO'],
    [uid(),'David','Walsh','david.walsh@globex.example.com','+353 87 200 2002','',cid2,'Account Manager'],
  ];
  const ic = db.prepare(`INSERT INTO contacts (id,first_name,last_name,email,phone,mobile,company_id,title) VALUES (?,?,?,?,?,?,?,?)`);
  contacts.forEach(c => ic.run(...c));
  const icase = db.prepare(`INSERT INTO cases (id,title,description,status,priority,contact_id,company_id) VALUES (?,?,?,?,?,?,?)`);
  icase.run(uid(),'Integration setup issue','Unable to configure Genesys Cloud Embeddable Framework','Open','High',contacts[0][0],cid1);
  icase.run(uid(),'Billing query Q1','Invoice discrepancy for March 2026','In Progress','Medium',contacts[1][0],cid1);
  icase.run(uid(),'API rate limit exceeded','Hitting notification API limits in production','Open','Critical',contacts[2][0],cid2);
}

// ── Express setup ─────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow embedding in Genesys Cloud iframes (apps.mypurecloud.ie etc.)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.mypurecloud.com https://*.mypurecloud.ie https://*.mypurecloud.com.au https://*.mypurecloud.jp https://*.mypurecloud.de https://*.pure.cloud");
  // Do NOT set X-Frame-Options — it conflicts with CSP frame-ancestors
  next();
});

// Static assets served first (CSS, JS, framework.js — no auth)
// But protected HTML files are handled by explicit routes below
app.use('/css',     express.static(path.join(__dirname, 'src', 'css')));
app.use('/scripts', express.static(path.join(__dirname, 'src', 'scripts')));
app.use('/img',     express.static(path.join(__dirname, 'src', 'img')));
app.use('/framework.js', (req, res) => res.sendFile(path.join(__dirname, 'src', 'framework.js')));

// ── Session middleware ─────────────────────────────────────────────
function getSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/crm_session=([^;]+)/);
  if (!match) return null;
  const session = db.prepare(`SELECT s.*,u.id as user_id,u.username,u.first_name,u.last_name,u.email,u.role,u.can_use_integration,u.integration_mode
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.expires_at > datetime('now')`).get(match[1]);
  return session || null;
}
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.redirect('/login.html');
  req.session = s;
  next();
}
function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  if (s.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  req.session = s;
  next();
}
function requireApiAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Unauthorized' });
  req.session = s;
  next();
}

// ── Auth routes (public) ──────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'login.html'));
});
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'login.html'));
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE username=? AND password_hash=?`)
    .get(username, hashPassword(password));
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const sessionId = uid();
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8h
  db.prepare(`INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)`).run(sessionId, user.id, expires);
  const secureCookie = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', 'crm_session=' + sessionId + '; Path=/; HttpOnly; SameSite=' + (secureCookie ? 'None; Secure' : 'Lax'));
  res.json({ ok: true, role: user.role });
});

app.post('/auth/logout', (req, res) => {
  const raw = req.headers.cookie || '';
  const match = raw.match(/crm_session=([^;]+)/);
  if (match) db.prepare(`DELETE FROM sessions WHERE id=?`).run(match[1]);
  const secureCookie = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', 'crm_session=; Path=/; Max-Age=0; SameSite=' + (secureCookie ? 'None; Secure' : 'Lax'));
  res.json({ ok: true });
});

app.get('/auth/me', requireApiAuth, (req, res) => {
  const { user_id, username, first_name, last_name, email, role, can_use_integration, integration_mode } = req.session;
  res.json({ id: user_id, username, first_name, last_name, email, role, can_use_integration: !!can_use_integration, integration_mode: integration_mode || 'embedded' });
});

// ── Protect main app ──────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));
app.get('/index.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));

// ── URL parameter screen-pop: /open?phone=+39...&view=contact ─────
// Supported params: phone, email, contact_id, company_id, case_id
// Optional: view=contacts|cases|interactions|dashboard
app.get('/open', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));

app.get('/admin', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'src', 'admin.html'));
});

// ── Users API (admin only) ────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id,username,first_name,last_name,email,role,can_use_integration,integration_mode,created_at FROM users ORDER BY created_at`).all());
});
app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, first_name, last_name, email, role, can_use_integration, integration_mode } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const id = uid();
    db.prepare(`INSERT INTO users (id,username,password_hash,first_name,last_name,email,role,can_use_integration,integration_mode) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, username, hashPassword(password), first_name||'', last_name||'', email||'', role||'agent', can_use_integration?1:0, integration_mode||'embedded');
    res.status(201).json(db.prepare(`SELECT id,username,first_name,last_name,email,role,can_use_integration,integration_mode FROM users WHERE id=?`).get(id));
  } catch(e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});
app.patch('/api/users/:id', requireApiAuth, (req, res) => {
  // Agents can only update their own profile (not role/permissions)
  const isSelf = req.session.user_id === req.params.id;
  const isAdmin = req.session.role === 'admin';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
  const allowed = isAdmin
    ? ['first_name','last_name','email','role','can_use_integration','integration_mode']
    : ['first_name','last_name','email'];
  const f = allowed.filter(x => req.body[x] !== undefined);
  if (req.body.password) {
    db.prepare(`UPDATE users SET password_hash=?,updated_at=? WHERE id=?`).run(hashPassword(req.body.password), now(), req.params.id);
  }
  if (f.length) db.prepare(`UPDATE users SET ${f.map(x=>`${x}=?`).join(',')},updated_at=? WHERE id=?`)
    .run(...f.map(x => x === 'can_use_integration' ? (req.body[x]?1:0) : req.body[x]), now(), req.params.id);
  res.json(db.prepare(`SELECT id,username,first_name,last_name,email,role,can_use_integration,integration_mode FROM users WHERE id=?`).get(req.params.id));
});
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (req.session.user_id === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM users WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── CRM API (auth required) ───────────────────────────────────────
app.get('/api/companies', requireApiAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  res.json(q ? db.prepare(`SELECT * FROM companies WHERE name LIKE ? OR industry LIKE ? ORDER BY name`).all(q,q)
             : db.prepare(`SELECT * FROM companies ORDER BY name`).all());
});
app.get('/api/companies/:id', requireApiAuth, (req, res) => {
  const row = db.prepare(`SELECT * FROM companies WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({error:'Not found'});
  row.contacts = db.prepare(`SELECT * FROM contacts WHERE company_id=? ORDER BY last_name`).all(req.params.id);
  row.cases    = db.prepare(`SELECT * FROM cases WHERE company_id=? ORDER BY created_at DESC`).all(req.params.id);
  res.json(row);
});
app.post('/api/companies', requireApiAuth, (req, res) => {
  try {
    const {name,industry,phone,website,address,notes} = req.body;
    const n = v => (v === undefined || v === '') ? null : v;
    const id = uid();
    db.prepare(`INSERT INTO companies (id,name,industry,phone,website,address,notes) VALUES (?,?,?,?,?,?,?)`).run(id,name,n(industry),n(phone),n(website),n(address),n(notes));
    res.status(201).json(db.prepare(`SELECT * FROM companies WHERE id=?`).get(id));
  } catch(e) {
    console.error('[POST /api/companies]', e);
    res.status(500).json({ error: e.message });
  }
});
app.patch('/api/companies/:id', requireApiAuth, (req, res) => {
  const f = ['name','industry','phone','website','address','notes'].filter(x=>req.body[x]!==undefined);
  if (f.length) db.prepare(`UPDATE companies SET ${f.map(x=>`${x}=?`).join(',')},updated_at=? WHERE id=?`).run(...f.map(x=>req.body[x]),now(),req.params.id);
  res.json(db.prepare(`SELECT * FROM companies WHERE id=?`).get(req.params.id));
});
app.delete('/api/companies/:id', requireApiAuth, (req,res) => { db.prepare(`DELETE FROM companies WHERE id=?`).run(req.params.id); res.json({ok:true}); });
app.get('/api/companies/search', requireApiAuth, (req, res) => {
  const { name } = req.query;
  if (!name) return res.json([]);
  res.json(db.prepare(`SELECT * FROM companies WHERE name LIKE ? ORDER BY name`).all(`%${name}%`));
});

app.get('/api/contacts', requireApiAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  res.json(q
    ? db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? ORDER BY c.last_name`).all(q,q,q,q)
    : db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id ORDER BY c.last_name`).all());
});
app.get('/api/contacts/search', requireApiAuth, (req, res) => {
  const {phone, email, name, genesys_id} = req.query;
  let rows = [];
  if (genesys_id) {
    rows = db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.genesys_external_id=?`).all(genesys_id);
  } else if (phone) {
    const cl = phone.replace(/[\s\-\(\)\+]/g,'');
    rows = db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone,' ',''),'-',''),'(',''),')',''),'+','') LIKE ? OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.mobile,' ',''),'-',''),'(',''),')',''),'+','') LIKE ?`).all(`%${cl}%`,`%${cl}%`);
  } else if (email) {
    rows = db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.email LIKE ?`).all(`%${email}%`);
  } else if (name) {
    rows = db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.first_name||' '||c.last_name LIKE ?`).all(`%${name}%`);
  }
  res.json(rows);
});
app.get('/api/contacts/:id', requireApiAuth, (req, res) => {
  const row = db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({error:'Not found'});
  row.cases        = db.prepare(`SELECT * FROM cases WHERE contact_id=? ORDER BY created_at DESC`).all(req.params.id);
  row.interactions = db.prepare(`SELECT * FROM interactions WHERE contact_id=? ORDER BY created_at DESC LIMIT 20`).all(req.params.id);
  res.json(row);
});
app.post('/api/contacts', requireApiAuth, (req, res) => {
  const {first_name,last_name,email,phone,mobile,company_id,title,notes,genesys_external_id} = req.body;
  const n = v => (v === undefined || v === '') ? null : v;
  const id = uid();
  db.prepare(`INSERT INTO contacts (id,first_name,last_name,email,phone,mobile,company_id,title,notes,genesys_external_id) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id,first_name,last_name,n(email),n(phone),n(mobile),n(company_id),n(title),n(notes),n(genesys_external_id));
  res.status(201).json(db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.id=?`).get(id));
});
app.patch('/api/contacts/:id', requireApiAuth, (req, res) => {
  const f = ['first_name','last_name','email','phone','mobile','company_id','title','notes','genesys_external_id'].filter(x=>req.body[x]!==undefined);
  if (f.length) db.prepare(`UPDATE contacts SET ${f.map(x=>`${x}=?`).join(',')},updated_at=? WHERE id=?`).run(...f.map(x=>req.body[x]===''?null:req.body[x]),now(),req.params.id);
  res.json(db.prepare(`SELECT c.*,co.name as company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.id=?`).get(req.params.id));
});
app.delete('/api/contacts/:id', requireApiAuth, (req,res) => { db.prepare(`DELETE FROM contacts WHERE id=?`).run(req.params.id); res.json({ok:true}); });

app.get('/api/cases', requireApiAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  res.json(q
    ? db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id WHERE cs.title LIKE ? OR cs.description LIKE ? ORDER BY cs.created_at DESC`).all(q,q)
    : db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id ORDER BY cs.created_at DESC`).all());
});
app.get('/api/cases/:id', requireApiAuth, (req, res) => {
  const row = db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id WHERE cs.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({error:'Not found'});
  row.interactions = db.prepare(`SELECT * FROM interactions WHERE case_id=? ORDER BY created_at DESC`).all(req.params.id);
  res.json(row);
});
app.post('/api/cases', requireApiAuth, (req, res) => {
  try {
    const {title,description,status,priority,contact_id,company_id,assigned_to,workitem_id} = req.body;
    const n = v => (v === undefined || v === '') ? null : v;
    const id = uid();
    db.prepare(`INSERT INTO cases (id,title,description,status,priority,contact_id,company_id,assigned_to,workitem_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, n(title), n(description), n(status)||'Open', n(priority)||'Medium', n(contact_id), n(company_id), n(assigned_to), n(workitem_id));
    res.status(201).json(db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id WHERE cs.id=?`).get(id));
  } catch(e) {
    console.error('[POST /api/cases]', e);
    res.status(500).json({ error: e.message });
  }
});
app.patch('/api/cases/:id', requireApiAuth, (req, res) => {
  const f = ['title','description','status','priority','contact_id','company_id','assigned_to','workitem_id'].filter(x=>req.body[x]!==undefined);
  if (f.length) db.prepare(`UPDATE cases SET ${f.map(x=>`${x}=?`).join(',')},updated_at=? WHERE id=?`).run(...f.map(x=>req.body[x]),now(),req.params.id);
  res.json(db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id WHERE cs.id=?`).get(req.params.id));
});
app.delete('/api/cases/:id', requireApiAuth, (req,res) => { db.prepare(`DELETE FROM cases WHERE id=?`).run(req.params.id); res.json({ok:true}); });
app.get('/api/cases/search', requireApiAuth, (req, res) => {
  const { title, workitem_id } = req.query;
  if (workitem_id) {
    return res.json(db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id WHERE cs.workitem_id=?`).all(workitem_id));
  }
  if (title) {
    return res.json(db.prepare(`SELECT cs.*,c.first_name||' '||c.last_name as contact_name,co.name as company_name FROM cases cs LEFT JOIN contacts c ON c.id=cs.contact_id LEFT JOIN companies co ON co.id=cs.company_id WHERE cs.title LIKE ? ORDER BY cs.created_at DESC`).all(`%${title}%`));
  }
  res.json([]);
});

app.get('/api/interactions', requireApiAuth, (req, res) => {
  res.json(db.prepare(`SELECT i.*,c.first_name||' '||c.last_name as contact_name FROM interactions i LEFT JOIN contacts c ON c.id=i.contact_id ORDER BY i.created_at DESC LIMIT 100`).all());
});
app.get('/api/interactions/:id', requireApiAuth, (req, res) => {
  const row = db.prepare(`SELECT i.*,c.first_name||' '||c.last_name as contact_name,c.company_id FROM interactions i LEFT JOIN contacts c ON c.id=i.contact_id WHERE i.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});
app.post('/api/interactions', requireApiAuth, (req, res) => {
  try {
    const {type,direction,contact_id,company_id,case_id,genesys_id,workitem_id,subject,notes,duration,status,started_at,ended_at} = req.body;
    const n = v => (v === undefined || v === null || v === '' || typeof v === 'object') ? null : String(v) === '' ? null : v;
    const num = v => { const x = Number(v); return (v === undefined || v === null || v === '' || typeof v === 'object' || isNaN(x)) ? null : x; };
    const id = uid();
    db.prepare(`INSERT INTO interactions (id,type,direction,contact_id,company_id,case_id,genesys_id,workitem_id,subject,notes,duration,status,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, n(type), n(direction), n(contact_id), n(company_id), n(case_id), n(genesys_id), n(workitem_id), n(subject), n(notes), num(duration), n(status)||'Completed', n(started_at)||now(), n(ended_at));
    res.status(201).json(db.prepare(`SELECT * FROM interactions WHERE id=?`).get(id));
  } catch(e) {
    console.error('[POST /api/interactions]', e);
    res.status(500).json({ error: e.message });
  }
});
app.patch('/api/interactions/:id', requireApiAuth, (req, res) => {
  const f = ['type','contact_id','case_id','subject','notes','duration','status','ended_at'].filter(x=>req.body[x]!==undefined);
  if (f.length) db.prepare(`UPDATE interactions SET ${f.map(x=>`${x}=?`).join(',')} WHERE id=?`).run(...f.map(x=>req.body[x]),req.params.id);
  res.json(db.prepare(`SELECT * FROM interactions WHERE id=?`).get(req.params.id));
});

// ── Local HTTP and optional HTTPS ─────────────────────────────────
app.set('trust proxy', 1);
const httpPort = Number(process.env.PORT || 8080);
http.createServer(app).listen(httpPort, () => {
  console.log('CRM running at http://localhost:' + httpPort + ' (demo accounts: admin/admin, agent/agent)');
});

const defaultKeyFile = path.join(__dirname, 'https-requirements', 'localhost.key');
const defaultCertFile = path.join(__dirname, 'https-requirements', 'localhost.crt');
const keyFile = process.env.SSL_KEY_FILE || defaultKeyFile;
const certFile = process.env.SSL_CERT_FILE || defaultCertFile;
const caFile = process.env.SSL_CA_FILE;
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  const sslOptions = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
    ...(caFile ? { ca: fs.readFileSync(caFile) } : {}),
    requestCert: false
  };
  // Genesys' framework-local-secure mode uses the standard HTTPS port.
  const httpsPort = Number(process.env.HTTPS_PORT || 443);
  https.createServer(sslOptions, app).listen(httpsPort, () => {
    console.log('HTTPS enabled at https://localhost:' + httpsPort);
  });
} else {
  console.log('HTTPS is disabled. Set SSL_KEY_FILE and SSL_CERT_FILE to enable Genesys iframe integration.');
}
