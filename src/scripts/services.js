'use strict';
// ================================================================
// GENESYS CRM — example.js
// CRM UI logic + Genesys Embeddable Framework integration
// + Work Automation (direct WebSocket + REST)
// ================================================================

// ── API helpers ─────────────────────────────────────────────────
const API = {
  async get(path) {
    const r = await fetch(path); return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(path, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method:'DELETE' }); return r.json();
  }
};

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IE', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IE', {day:'2-digit',month:'short',year:'numeric'});
}
function statusChip(s) {
  const map = { 'Open':'chip-open','In Progress':'chip-progress','Closed':'chip-closed','Resolved':'chip-resolved' };
  return `<span class="chip ${map[s]||'chip-open'}">${esc(s)}</span>`;
}
function priorityChip(p) {
  const map = { 'Critical':'chip-critical','High':'chip-high','Medium':'chip-medium','Low':'chip-low' };
  return `<span class="chip ${map[p]||'chip-medium'}">${esc(p)}</span>`;
}
function typeChip(t) {
  const map = { 'call':'chip-call','workitem':'chip-workitem','email':'chip-email','chat':'chip-chat' };
  return `<span class="chip ${map[t]||'chip-call'}">${esc(t)}</span>`;
}

// ── Navigation ──────────────────────────────────────────────────
const CRM = {
  currentView: 'dashboard',
  _drawerEntity: null,
  _drawerId: null,

  _currentUser: null,

  init() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
    this.navigate('dashboard');
    this._initSoftphone();
    this._initScreenPop();
    // Topbar date
    const now = new Date();
    const dateEl = document.getElementById('topbarDate');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const dashDateEl = document.getElementById('dashDate');
    if (dashDateEl) dashDateEl.textContent = now.toLocaleDateString('en-IE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    // Search
    document.getElementById('contactSearch').addEventListener('input', e => this._debounce(() => this.loadContacts(e.target.value), 300));
    document.getElementById('companySearch').addEventListener('input', e => this._debounce(() => this.loadCompanies(e.target.value), 300));
    document.getElementById('caseSearch').addEventListener('input', e => this._debounce(() => this.loadCases(e.target.value), 300));
    // Close dropdown on outside click
    document.addEventListener('click', e => {
      const dd = document.getElementById('userDropdown');
      if (dd && !document.getElementById('topbarUser').contains(e.target)) dd.style.display = 'none';
    });
    this.loadCurrentUser();
  },

  async loadCurrentUser() {
    try {
      const r = await fetch('/auth/me');
      if (r.status === 401) { window.location.href = '/login.html'; return; }
      const user = await r.json();
      this._currentUser = user;
      // Topbar
      const initials = ((user.first_name||'?')[0] + (user.last_name||'')[0]).toUpperCase();
      const fullName = `${user.first_name} ${user.last_name}`.trim() || user.username;
      const avatarEl = document.getElementById('topbarAvatar');
      const nameEl   = document.getElementById('topbarUsername');
      const roleEl   = document.getElementById('topbarRole');
      const ddName   = document.getElementById('ddName');
      const ddEmail  = document.getElementById('ddEmail');
      if (avatarEl) avatarEl.textContent = initials;
      if (nameEl)   nameEl.textContent   = fullName;
      if (roleEl)   roleEl.textContent   = user.role;
      if (ddName)   ddName.textContent   = fullName;
      if (ddEmail)  ddEmail.textContent  = user.email || user.username;
      // Admin link
      const adminLink = document.getElementById('adminLink');
      if (adminLink) adminLink.style.display = user.role === 'admin' ? 'flex' : 'none';

      // ── Integration mode ────────────────────────────────────────
      // mode: 'disabled' = no softphone, no agent bar
      //       'embedded' = full iframe softphone (default)
      //       'headless' = iframe hidden, CRM call-control bar shown
      const mode = user.can_use_integration ? (user.integration_mode || 'embedded') : 'disabled';
      this._integrationMode = mode;

      const spWrapper = document.getElementById('softphoneWrapper');
      const spTab     = document.getElementById('softphoneTab');
      const wiView    = document.getElementById('view-workitems');
      const wiNavItem = document.querySelector('.nav-item[data-view="workitems"]');
      const callBar   = document.getElementById('headlessCallBar');

      if (mode === 'disabled') {
        // Never load the framework iframe
        if (spWrapper) spWrapper.style.display = 'none';
        if (spTab)     spTab.style.display = 'none';
        if (wiView)    wiView.style.display = 'none';
        if (wiNavItem) wiNavItem.style.display = 'none';
        if (callBar)   callBar.style.display = 'none';
      } else {
        // Load the framework iframe now (src is in data-src to prevent early loading)
        const spIframe = document.getElementById('softphone');
        if (spIframe && spIframe.dataset.src && !spIframe.src) {
          spIframe.src = spIframe.dataset.src;
        }

        if (mode === 'headless') {
          // Keep iframe fully functional (WebRTC needs real dimensions + visibility)
          // but move it off-screen so it's invisible to the user
          if (spWrapper) {
            spWrapper.style.position = 'fixed';
            spWrapper.style.left = '-9999px';
            spWrapper.style.top = '0';
            spWrapper.style.width = '400px';
            spWrapper.style.height = '600px';
            spWrapper.style.visibility = 'visible';
            spWrapper.style.pointerEvents = 'none';
            spWrapper.style.zIndex = '-1';
          }
          if (spTab)   spTab.style.display = 'none';
          if (callBar) callBar.style.display = 'flex';
        }
        // 'embedded' → everything already visible by default
      }

      // ── URL parameter screen pop ─────────────────────────────────
      this._handleUrlParams();

    } catch(e) {
      window.location.href = '/login.html';
    }
  },

  // Handle URL params:
  // Contact: ?phone=, ?email=, ?contact_name=, ?genesys_id=, ?contact_id=
  // Company: ?company_name=, ?company_id=
  // Case:    ?case_title=, ?case_id=, ?workitem_id=
  // Other:   ?view=
  async _handleUrlParams() {
    const p = new URLSearchParams(window.location.search);
    const view        = p.get('view');
    const contactId   = p.get('contact_id');
    const companyId   = p.get('company_id');
    const caseId      = p.get('case_id');
    const phone       = p.get('phone');
    const email       = p.get('email');
    const contactName = p.get('contact_name');
    const genesysId   = p.get('genesys_id');
    const companyName = p.get('company_name');
    const caseTitle   = p.get('case_title');
    const workitemId  = p.get('workitem_id');

    // ── Direct ID navigation ──────────────────────────────────────
    if (contactId) {
      this.navigate('contacts');
      await this.openDrawer('contact', contactId);
      return;
    }
    if (companyId) {
      this.navigate('companies');
      await this.openDrawer('company', companyId);
      return;
    }
    if (caseId) {
      this.navigate('cases');
      await this.openDrawer('case', caseId);
      return;
    }

    // ── Contact search ────────────────────────────────────────────
    let contactQuery = null;
    if (phone)       contactQuery = `/api/contacts/search?phone=${encodeURIComponent(phone)}`;
    else if (email)  contactQuery = `/api/contacts/search?email=${encodeURIComponent(email)}`;
    else if (genesysId) contactQuery = `/api/contacts/search?genesys_id=${encodeURIComponent(genesysId)}`;
    else if (contactName) contactQuery = `/api/contacts/search?name=${encodeURIComponent(contactName)}`;

    if (contactQuery) {
      try {
        const results = await API.get(contactQuery);
        if (results.length > 0) {
          this.navigate('contacts');
          await this.openDrawer('contact', results[0].id);
        } else {
          this.navigate('contacts');
          this.openModal('contact', {
            phone: phone || '',
            email: email || '',
          });
        }
      } catch(e) {}
      return;
    }

    // ── Company search ────────────────────────────────────────────
    if (companyName) {
      try {
        const results = await API.get(`/api/companies/search?name=${encodeURIComponent(companyName)}`);
        if (results.length > 0) {
          this.navigate('companies');
          await this.openDrawer('company', results[0].id);
        } else {
          this.navigate('companies');
        }
      } catch(e) {}
      return;
    }

    // ── Case search ───────────────────────────────────────────────
    if (caseTitle || workitemId) {
      try {
        const qs = workitemId
          ? `/api/cases/search?workitem_id=${encodeURIComponent(workitemId)}`
          : `/api/cases/search?title=${encodeURIComponent(caseTitle)}`;
        const results = await API.get(qs);
        if (results.length > 0) {
          this.navigate('cases');
          await this.openDrawer('case', results[0].id);
        } else {
          this.navigate('cases');
        }
      } catch(e) {}
      return;
    }

    // ── Just navigate to a view ───────────────────────────────────
    if (view) this.navigate(view);
  },

  toggleUserMenu() {
    const dd = document.getElementById('userDropdown');
    if (dd) dd.style.display = dd.style.display === 'none' ? '' : 'none';
  },

  async openProfileModal() {
    document.getElementById('userDropdown').style.display = 'none';
    const user = this._currentUser;
    if (!user) return;
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');
    const save    = document.getElementById('modalSave');
    overlay.style.display = 'flex';
    title.textContent = 'My Profile';
    body.innerHTML = `
      <div class="drawer-field"><label>First Name</label><input id="pf_first_name" value="${esc(user.first_name||'')}"/></div>
      <div class="drawer-field"><label>Last Name</label><input id="pf_last_name" value="${esc(user.last_name||'')}"/></div>
      <div class="drawer-field"><label>Email</label><input type="email" id="pf_email" value="${esc(user.email||'')}"/></div>
      <div class="drawer-field"><label>New Password (leave blank to keep current)</label><input type="password" id="pf_password" placeholder="New password…"/></div>
      <div class="drawer-field"><label>Username</label><div style="font-family:var(--mono);font-size:12px;color:var(--text-3);padding:4px 0">${esc(user.username)}</div></div>
      <div class="drawer-field"><label>Role</label><div style="font-size:12px;color:var(--text-3);padding:4px 0">${esc(user.role)}</div></div>`;
    save.onclick = async () => {
      const body = {
        first_name: document.getElementById('pf_first_name').value.trim(),
        last_name:  document.getElementById('pf_last_name').value.trim(),
        email:      document.getElementById('pf_email').value.trim(),
      };
      const pw = document.getElementById('pf_password').value;
      if (pw) body.password = pw;
      await API.patch('/api/users/' + user.id, body);
      this.closeModal();
      this.loadCurrentUser();
    };
  },

  async logout() {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  },

  _debounceTimer: null,
  _debounce(fn, ms) { clearTimeout(this._debounceTimer); this._debounceTimer = setTimeout(fn, ms); },

  navigate(view) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.crm-view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    this.currentView = view;
    this.closeDrawer();
    if (view === 'dashboard')    this.loadDashboard();
    if (view === 'contacts')     this.loadContacts();
    if (view === 'companies')    this.loadCompanies();
    if (view === 'cases')        this.loadCases();
    if (view === 'interactions') this.loadInteractions();
  },

  // ── DASHBOARD ─────────────────────────────────────────────────
  async loadDashboard() {
    const [contacts, companies, cases, interactions] = await Promise.all([
      API.get('/api/contacts'), API.get('/api/companies'),
      API.get('/api/cases'), API.get('/api/interactions')
    ]);
    const open = cases.filter(c => c.status !== 'Closed' && c.status !== 'Resolved');
    document.getElementById('statContacts').textContent  = contacts.length;
    document.getElementById('statCompanies').textContent = companies.length;
    document.getElementById('statOpenCases').textContent = open.length;
    document.getElementById('statWorkitems').textContent = Object.keys(_wi.workitems).length;
    document.getElementById('openCasesBadge').textContent = open.length;
    document.getElementById('openCasesBadge').style.display = open.length ? '' : 'none';

    const recentCases = document.getElementById('recentCases');
    recentCases.innerHTML = cases.slice(0,8).map(c => `
      <div class="dash-item" onclick="CRM.openDrawer('case','${c.id}')">
        <div class="dash-item-icon" style="background:rgba(37,99,235,.1)">${typeChip(c.status==='Open'?'✦':'✓').replace('chip','').replace(/<[^>]+>/g,'')}</div>
        <div class="dash-item-body">
          <div class="dash-item-title">${esc(c.title)}</div>
          <div class="dash-item-sub">${esc(c.contact_name||'—')} · ${esc(c.company_name||'—')}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          ${statusChip(c.status)}
          <span class="dash-item-meta">${fmtDateShort(c.created_at)}</span>
        </div>
      </div>`).join('') || '<div class="dash-item"><div class="dash-item-body"><div class="dash-item-sub">No cases yet</div></div></div>';

    const recentInter = document.getElementById('recentInteractions');
    const iconMap = { call:'📞', workitem:'📋', email:'📧', chat:'💬' };
    recentInter.innerHTML = interactions.slice(0,8).map(i => `
      <div class="dash-item" onclick="${i.contact_id ? `CRM.openDrawer('contact','${i.contact_id}')` : ''}">
        <div class="dash-item-icon" style="background:var(--surface-3);font-size:16px;line-height:1">${iconMap[i.type]||'📞'}</div>
        <div class="dash-item-body">
          <div class="dash-item-title">${esc(i.subject||i.type)}</div>
          <div class="dash-item-sub">${esc(i.contact_name||'Unknown contact')}</div>
        </div>
        <div><span class="dash-item-meta">${fmtDateShort(i.created_at)}</span></div>
      </div>`).join('') || '<div class="dash-item"><div class="dash-item-body"><div class="dash-item-sub">No interactions yet</div></div></div>';
  },

  // ── CONTACTS ──────────────────────────────────────────────────
  async loadContacts(q = '') {
    const contacts = await API.get('/api/contacts' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    document.getElementById('contactsBody').innerHTML = contacts.map(c => `
      <tr onclick="CRM.openDrawer('contact','${c.id}')">
        <td><span class="table-link">${esc(c.first_name)} ${esc(c.last_name)}</span></td>
        <td>${esc(c.company_name||'—')}</td>
        <td>${esc(c.email||'—')}</td>
        <td>${esc(c.phone||'—')}</td>
        <td>${esc(c.title||'—')}</td>
        <td class="action-cell"><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();CRM.deleteRecord('contact','${c.id}')">Delete</button></td>
      </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text-4);padding:24px">No contacts found</td></tr>`;
  },

  // ── COMPANIES ─────────────────────────────────────────────────
  async loadCompanies(q = '') {
    const companies = await API.get('/api/companies' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    document.getElementById('companiesBody').innerHTML = companies.map(c => `
      <tr onclick="CRM.openDrawer('company','${c.id}')">
        <td><span class="table-link">${esc(c.name)}</span></td>
        <td>${esc(c.industry||'—')}</td>
        <td>${esc(c.phone||'—')}</td>
        <td>${c.website ? `<a href="${esc(c.website)}" onclick="event.stopPropagation()" target="_blank" class="table-link">${esc(c.website)}</a>` : '—'}</td>
        <td class="action-cell"><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();CRM.deleteRecord('company','${c.id}')">Delete</button></td>
      </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-4);padding:24px">No companies found</td></tr>`;
  },

  // ── CASES ─────────────────────────────────────────────────────
  async loadCases(q = '') {
    const cases = await API.get('/api/cases' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    const open = cases.filter(c => c.status !== 'Closed' && c.status !== 'Resolved').length;
    document.getElementById('openCasesBadge').textContent = open;
    document.getElementById('openCasesBadge').style.display = open ? '' : 'none';
    document.getElementById('casesBody').innerHTML = cases.map(c => `
      <tr onclick="CRM.openDrawer('case','${c.id}')">
        <td><span class="table-link">${esc(c.title)}</span></td>
        <td>${esc(c.contact_name||'—')}</td>
        <td>${esc(c.company_name||'—')}</td>
        <td>${statusChip(c.status)}</td>
        <td>${priorityChip(c.priority)}</td>
        <td>${fmtDateShort(c.created_at)}</td>
        <td class="action-cell"><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();CRM.deleteRecord('case','${c.id}')">Delete</button></td>
      </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text-4);padding:24px">No cases found</td></tr>`;
  },

  // ── INTERACTIONS ──────────────────────────────────────────────
  async loadInteractions() {
    const items = await API.get('/api/interactions');
    document.getElementById('interactionsBody').innerHTML = items.map(i => `
      <tr style="cursor:pointer" onclick="CRM.openDrawer('interaction','${i.id}')">
        <td>${typeChip(i.type)}</td>
        <td>${esc(i.contact_name||'—')}</td>
        <td>${esc(i.subject||'—')}</td>
        <td>${esc(i.notes ? i.notes.replace(/^Wrap-up: /, '') : '—')}</td>
        <td><span class="chip ${i.status==='Active'?'chip-open':'chip-closed'}">${esc(i.status)}</span></td>
        <td>${i.duration ? `${Math.round(i.duration/60)}m` : '—'}</td>
        <td>${fmtDate(i.created_at)}</td>
      </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text-4);padding:24px">No interactions yet</td></tr>`;
  },

  // ── DETAIL DRAWER ─────────────────────────────────────────────
  async openDrawer(entity, id) {
    this._drawerEntity = entity;
    this._drawerId = id;
    const drawer = document.getElementById('detailDrawer');
    const body   = document.getElementById('drawerBody');
    drawer.style.display = 'flex';
    drawer.classList.toggle('detail-drawer--wide', entity === 'interaction');
    body.innerHTML = '<div style="padding:20px;color:var(--text-4)">Loading…</div>';

    if (entity === 'contact') {
      const c = await API.get(`/api/contacts/${id}`);
      document.getElementById('drawerTitle').textContent = `${c.first_name} ${c.last_name}`;
      body.innerHTML = await this._contactDrawer(c);
    } else if (entity === 'company') {
      const c = await API.get(`/api/companies/${id}`);
      document.getElementById('drawerTitle').textContent = c.name;
      body.innerHTML = this._companyDrawer(c);
    } else if (entity === 'case') {
      const c = await API.get(`/api/cases/${id}`);
      document.getElementById('drawerTitle').textContent = `Case: ${c.title}`;
      body.innerHTML = this._caseDrawer(c);
    } else if (entity === 'interaction') {
      const i = await API.get(`/api/interactions/${id}`);
      document.getElementById('drawerTitle').textContent = `Interaction: ${i.subject || i.type}`;
      body.innerHTML = await this._interactionDrawer(i);
      if (window.ComposableDesktop) {
        window.ComposableDesktop.attachGadgets(
          {
            copilot: 'cdPanelCopilot',
            scripts: 'cdPanelScripts',
            acw: 'cdPanelAcw',
            email: 'cdPanelEmail',
            messaging: 'cdPanelMessaging',
          },
          i.genesys_id || null
        );
      }
      // CRM -> EF: if this interaction is currently active, auto-focus it in the EF
      if (i.genesys_id && this._activeCallInteractions[i.genesys_id]) {
        console.log('[CRM] openDrawer auto focusInteraction', i.genesys_id);
        this.focusInteraction(i.genesys_id);
      }
    }
    // Wire save buttons
    document.querySelectorAll('[data-save]').forEach(btn => {
      btn.addEventListener('click', () => this.saveDrawer());
    });
  },

  closeDrawer() {
    document.getElementById('detailDrawer').style.display = 'none';
    this._drawerEntity = null; this._drawerId = null;
    if (window.ComposableDesktop) window.ComposableDesktop.detachGadgets();
  },

  _pluralize(entity) {
    if (entity === 'company') return 'companies';
    if (entity === 'interaction') return 'interactions';
    return entity + 's';
  },

  async saveDrawer() {
    const body = {};
    document.querySelectorAll('#drawerBody [data-field]').forEach(el => {
      body[el.dataset.field] = el.value;
    });
    await API.patch(`/api/${this._pluralize(this._drawerEntity)}/${this._drawerId}`, body);
    this.openDrawer(this._drawerEntity, this._drawerId);
    if (this.currentView === this._drawerEntity + 's' || this.currentView === this._pluralize(this._drawerEntity)) this.navigate(this.currentView);
  },

  async deleteRecord(entity, id) {
    if (!confirm(`Delete this ${entity}?`)) return;
    await API.del(`/api/${this._pluralize(entity)}/${id}`);
    this.closeDrawer();
    this.navigate(this.currentView);
  },

  async _contactDrawer(c) {
    const companies = await API.get('/api/companies');
    const interactHTML = (c.interactions||[]).map(i => `
      <div class="interaction-item">
        <div class="interaction-icon" style="background:var(--surface-3)">${{call:'📞',workitem:'📋',email:'📧',chat:'💬'}[i.type]||'📞'}</div>
        <div class="interaction-body">
          <div class="interaction-title">${esc(i.subject||i.type)}</div>
          <div class="interaction-meta">${fmtDate(i.created_at)} ${i.duration?`· ${Math.round(i.duration/60)}m`:''}</div>
        </div>
        ${typeChip(i.type)}
      </div>`).join('') || '<div class="wi-attr-empty">No interactions yet</div>';
    const casesHTML = (c.cases||[]).map(cs => `
      <div class="dash-item" style="cursor:pointer" onclick="CRM.openDrawer('case','${cs.id}')">
        <div class="dash-item-body"><div class="dash-item-title">${esc(cs.title)}</div><div class="dash-item-sub">${fmtDateShort(cs.created_at)}</div></div>
        ${statusChip(cs.status)}
      </div>`).join('') || '<div class="wi-attr-empty">No cases</div>';
    return `
      <div class="drawer-section">
        <div class="drawer-section-title">Contact Info</div>
        <div class="drawer-field"><label>First Name</label><input data-field="first_name" value="${esc(c.first_name)}"/></div>
        <div class="drawer-field"><label>Last Name</label><input data-field="last_name" value="${esc(c.last_name)}"/></div>
        <div class="drawer-field"><label>Title</label><input data-field="title" value="${esc(c.title||'')}"/></div>
        <div class="drawer-field"><label>Email</label><input data-field="email" value="${esc(c.email||'')}"/></div>
        <div class="drawer-field"><label>Phone</label><input data-field="phone" value="${esc(c.phone||'')}"/></div>
        <div class="drawer-field"><label>Mobile</label><input data-field="mobile" value="${esc(c.mobile||'')}"/></div>
        <div class="drawer-field"><label>Company</label>
          <select data-field="company_id">
            <option value="">— None —</option>
            ${companies.map(co => `<option value="${co.id}" ${c.company_id===co.id?'selected':''}>${esc(co.name)}</option>`).join('')}
          </select></div>
        <div class="drawer-field"><label>Notes</label><textarea data-field="notes">${esc(c.notes||'')}</textarea></div>
        <div class="drawer-actions">
          <button class="btn btn-primary" data-save>Save Changes</button>
          <button class="btn btn-outline" onclick="CRM.openModal('case',{contact_id:'${c.id}',company_id:'${c.company_id||''}'})">+ New Case</button>
          <button class="btn btn-outline" onclick="CRM.logInteraction('${c.id}',null)">Log Interaction</button>
        </div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">Cases (${(c.cases||[]).length})</div>
        ${casesHTML}
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">Interaction History</div>
        <div class="interaction-list">${interactHTML}</div>
      </div>`;
  },

  _companyDrawer(c) {
    const contactsHTML = (c.contacts||[]).map(ct => `
      <div class="dash-item" onclick="CRM.openDrawer('contact','${ct.id}')">
        <div class="dash-item-body"><div class="dash-item-title">${esc(ct.first_name)} ${esc(ct.last_name)}</div><div class="dash-item-sub">${esc(ct.title||'—')} · ${esc(ct.phone||'—')}</div></div>
      </div>`).join('') || '<div class="wi-attr-empty">No contacts</div>';
    const casesHTML = (c.cases||[]).map(cs => `
      <div class="dash-item" onclick="CRM.openDrawer('case','${cs.id}')">
        <div class="dash-item-body"><div class="dash-item-title">${esc(cs.title)}</div><div class="dash-item-sub">${fmtDateShort(cs.created_at)}</div></div>
        ${statusChip(cs.status)}
      </div>`).join('') || '<div class="wi-attr-empty">No cases</div>';
    return `
      <div class="drawer-section">
        <div class="drawer-section-title">Company Info</div>
        <div class="drawer-field"><label>Name</label><input data-field="name" value="${esc(c.name)}"/></div>
        <div class="drawer-field"><label>Industry</label><input data-field="industry" value="${esc(c.industry||'')}"/></div>
        <div class="drawer-field"><label>Phone</label><input data-field="phone" value="${esc(c.phone||'')}"/></div>
        <div class="drawer-field"><label>Website</label><input data-field="website" value="${esc(c.website||'')}"/></div>
        <div class="drawer-field"><label>Address</label><input data-field="address" value="${esc(c.address||'')}"/></div>
        <div class="drawer-field"><label>Notes</label><textarea data-field="notes">${esc(c.notes||'')}</textarea></div>
        <div class="drawer-actions"><button class="btn btn-primary" data-save>Save Changes</button></div>
      </div>
      <div class="drawer-section"><div class="drawer-section-title">Contacts (${(c.contacts||[]).length})</div>${contactsHTML}</div>
      <div class="drawer-section"><div class="drawer-section-title">Cases (${(c.cases||[]).length})</div>${casesHTML}</div>`;
  },

  _caseDrawer(c) {
    const interactHTML = (c.interactions||[]).map(i => `
      <div class="interaction-item">
        <div class="interaction-icon" style="background:var(--surface-3)">${{call:'📞',workitem:'📋',email:'📧',chat:'💬'}[i.type]||'📞'}</div>
        <div class="interaction-body">
          <div class="interaction-title">${esc(i.subject||i.type)}</div>
          <div class="interaction-meta">${fmtDate(i.created_at)}</div>
        </div>
        ${typeChip(i.type)}
      </div>`).join('') || '<div class="wi-attr-empty">No interactions</div>';
    return `
      <div class="drawer-section">
        <div class="drawer-section-title">Case Details</div>
        <div class="drawer-field"><label>Title</label><input data-field="title" value="${esc(c.title)}"/></div>
        <div class="drawer-field"><label>Description</label><textarea data-field="description">${esc(c.description||'')}</textarea></div>
        <div class="drawer-field"><label>Status</label>
          <select data-field="status">
            ${['Open','In Progress','Resolved','Closed'].map(s=>`<option ${c.status===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div class="drawer-field"><label>Priority</label>
          <select data-field="priority">
            ${['Low','Medium','High','Critical'].map(p=>`<option ${c.priority===p?'selected':''}>${p}</option>`).join('')}
          </select></div>
        <div class="drawer-field"><label>Contact</label><div class="field-val">${esc(c.contact_name||'—')}</div></div>
        <div class="drawer-field"><label>Company</label><div class="field-val">${esc(c.company_name||'—')}</div></div>
        ${c.workitem_id ? `<div class="drawer-field"><label>Workitem ID</label><div class="field-val" style="font-family:var(--mono);font-size:11px">${esc(c.workitem_id)}</div></div>` : ''}
        <div class="drawer-field"><label>Created</label><div class="field-val">${fmtDate(c.created_at)}</div></div>
        <div class="drawer-actions"><button class="btn btn-primary" data-save>Save Changes</button></div>
      </div>
      <div class="drawer-section"><div class="drawer-section-title">Interactions</div><div class="interaction-list">${interactHTML}</div></div>`;
  },

  async _interactionDrawer(i) {
    const contacts  = await API.get('/api/contacts');
    const cases     = await API.get('/api/cases');
    const wrapup    = i.notes ? i.notes.replace(/^Wrap-up: /, '') : null;
    const iconMap   = { call:'📞', workitem:'📋', email:'📧', chat:'💬' };
    // Linked case (if any)
    const linkedCase = i.case_id ? cases.find(c => c.id === i.case_id) : null;
    const caseHTML = linkedCase
      ? `<div class="dash-item" style="cursor:pointer;margin-top:8px" onclick="CRM.openDrawer('case','${linkedCase.id}')">
           <div class="dash-item-body"><div class="dash-item-title">${esc(linkedCase.title)}</div><div class="dash-item-sub">${esc(linkedCase.contact_name||'')}</div></div>
           ${statusChip(linkedCase.status)}
         </div>`
      : '<div class="wi-attr-empty">No case linked</div>';
    return `
      <div class="drawer-section">
        <div class="drawer-section-title">Interaction Details</div>
        <div class="drawer-field"><label>Type</label><div class="field-val">${iconMap[i.type]||'📞'} ${esc(i.type)}</div></div>
        <div class="drawer-field"><label>Subject</label><div class="field-val">${esc(i.subject||'—')}</div></div>
        <div class="drawer-field"><label>Direction</label><div class="field-val">${esc(i.direction||'—')}</div></div>
        <div class="drawer-field"><label>Status</label><div class="field-val"><span class="chip ${i.status==='Active'?'chip-open':'chip-closed'}">${esc(i.status)}</span></div></div>
        <div class="drawer-field"><label>Duration</label><div class="field-val">${i.duration ? `${Math.round(i.duration/60)}m ${i.duration%60}s` : '—'}</div></div>
        ${wrapup ? `<div class="drawer-field"><label>Wrap-up</label><div class="field-val">${esc(wrapup)}</div></div>` : ''}
        <div class="drawer-field"><label>Started</label><div class="field-val">${fmtDate(i.started_at)}</div></div>
        <div class="drawer-field"><label>Ended</label><div class="field-val">${fmtDate(i.ended_at)}</div></div>
        ${i.genesys_id ? `<div class="drawer-field"><label>Genesys ID</label><div class="field-val" style="font-family:var(--mono);font-size:11px">${esc(i.genesys_id)}</div></div>` : ''}
        <div class="drawer-field"><label>Contact</label>
          <select id="ix_contact_id">
            <option value="">— Unknown —</option>
            ${contacts.map(c => `<option value="${c.id}" ${i.contact_id===c.id?'selected':''}>${esc(c.first_name+' '+c.last_name)}${c.company_name?' ('+c.company_name+')':''}</option>`).join('')}
          </select></div>
        <div class="drawer-actions">
          <button class="btn btn-primary" onclick="CRM._saveInteractionContact('${i.id}')">Save Contact</button>
          <button class="btn btn-outline" onclick="CRM._createCaseFromInteraction('${i.id}')">+ Create Case</button>
          ${i.genesys_id ? `<button class="btn btn-outline" onclick="CRM.focusInteraction('${i.genesys_id}')">Focus in Genesys</button>` : ''}
        </div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">Linked Case</div>
        ${caseHTML}
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">Genesys Panels</div>
        <div class="cd-drawer-dock">
          <div class="cd-dock-tabs">
            <button class="cd-dock-tab active" data-cd-tab="copilot" onclick="CRM._cdShowTab('copilot')">Copilot</button>
            <button class="cd-dock-tab" data-cd-tab="scripts" onclick="CRM._cdShowTab('scripts')">Scripts</button>
            <button class="cd-dock-tab" data-cd-tab="acw" onclick="CRM._cdShowTab('acw')">ACW</button>
            <button class="cd-dock-tab" data-cd-tab="email" onclick="CRM._cdShowTab('email')">Email</button>
            <button class="cd-dock-tab" data-cd-tab="messaging" onclick="CRM._cdShowTab('messaging')">Messaging</button>
          </div>
          <div class="cd-dock-body">
            <div class="cd-dock-panel active" data-cd-panel="copilot" id="cdPanelCopilot"></div>
            <div class="cd-dock-panel" data-cd-panel="scripts" id="cdPanelScripts"></div>
            <div class="cd-dock-panel" data-cd-panel="acw" id="cdPanelAcw"></div>
            <div class="cd-dock-panel" data-cd-panel="email" id="cdPanelEmail"></div>
            <div class="cd-dock-panel" data-cd-panel="messaging" id="cdPanelMessaging"></div>
          </div>
        </div>
      </div>`;
  },

  _cdShowTab(tab) {
    document.querySelectorAll('[data-cd-tab]').forEach(b => b.classList.toggle('active', b.dataset.cdTab === tab));
    document.querySelectorAll('[data-cd-panel]').forEach(p => p.classList.toggle('active', p.dataset.cdPanel === tab));
  },

  async _saveInteractionContact(interactionId) {
    const contactId = document.getElementById('ix_contact_id').value || null;
    await API.patch(`/api/interactions/${interactionId}`, { contact_id: contactId });
    this.openDrawer('interaction', interactionId);
    if (this.currentView === 'interactions') this.loadInteractions();
  },

  async _createCaseFromInteraction(interactionId) {
    const contactId = document.getElementById('ix_contact_id').value || null;
    // Save the contact association first if it changed
    if (contactId) {
      await API.patch(`/api/interactions/${interactionId}`, { contact_id: contactId });
    }
    const contact = contactId ? await API.get(`/api/contacts/${contactId}`) : null;
    this.openModal('case', {
      contact_id:  contactId || null,
      company_id:  contact?.company_id || null,
      interaction_id: interactionId,
    });
  },

  // ── MODAL ─────────────────────────────────────────────────────
  async openModal(type, defaults = {}) {
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');
    const save    = document.getElementById('modalSave');
    overlay.style.display = 'flex';

    if (type === 'contact') {
      title.textContent = 'New Contact';
      const companies = await API.get('/api/companies');
      body.innerHTML = `
        <div class="drawer-field"><label>First Name *</label><input id="mf_first_name" placeholder="First name"/></div>
        <div class="drawer-field"><label>Last Name *</label><input id="mf_last_name" placeholder="Last name"/></div>
        <div class="drawer-field"><label>Email</label><input id="mf_email" type="email" placeholder="email@example.com"/></div>
        <div class="drawer-field"><label>Phone</label><input id="mf_phone" placeholder="+353…"/></div>
        <div class="drawer-field"><label>Mobile</label><input id="mf_mobile" placeholder="+353…"/></div>
        <div class="drawer-field"><label>Title</label><input id="mf_title" placeholder="Job title"/></div>
        <div class="drawer-field"><label>Company</label>
          <select id="mf_company_id">
            <option value="">— None —</option>
            ${companies.map(c=>`<option value="${c.id}" ${defaults.company_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="drawer-field"><label>Notes</label><textarea id="mf_notes" placeholder="Notes…"></textarea></div>`;
      save.onclick = async () => {
        const fn = document.getElementById('mf_first_name').value.trim();
        const ln = document.getElementById('mf_last_name').value.trim();
        if (!fn || !ln) return alert('First and last name are required');
        await API.post('/api/contacts', { first_name:fn, last_name:ln, email:document.getElementById('mf_email').value, phone:document.getElementById('mf_phone').value, mobile:document.getElementById('mf_mobile').value, title:document.getElementById('mf_title').value, company_id:document.getElementById('mf_company_id').value||null, notes:document.getElementById('mf_notes').value });
        this.closeModal(); this.loadContacts();
      };
    } else if (type === 'company') {
      title.textContent = 'New Company';
      body.innerHTML = `
        <div class="drawer-field"><label>Name *</label><input id="mf_name" placeholder="Company name"/></div>
        <div class="drawer-field"><label>Industry</label><input id="mf_industry" placeholder="e.g. Technology"/></div>
        <div class="drawer-field"><label>Phone</label><input id="mf_phone" placeholder="+353…"/></div>
        <div class="drawer-field"><label>Website</label><input id="mf_website" placeholder="https://…"/></div>
        <div class="drawer-field"><label>Address</label><input id="mf_address" placeholder="Street, City"/></div>
        <div class="drawer-field"><label>Notes</label><textarea id="mf_notes"></textarea></div>`;
      save.onclick = async () => {
        const name = document.getElementById('mf_name').value.trim();
        if (!name) return alert('Name is required');
        await API.post('/api/companies', { name, industry:document.getElementById('mf_industry').value, phone:document.getElementById('mf_phone').value, website:document.getElementById('mf_website').value, address:document.getElementById('mf_address').value, notes:document.getElementById('mf_notes').value });
        this.closeModal(); this.loadCompanies();
      };
    } else if (type === 'case') {
      title.textContent = 'New Case';
      const [contacts, companies] = await Promise.all([API.get('/api/contacts'), API.get('/api/companies')]);
      body.innerHTML = `
        <div class="drawer-field"><label>Title *</label><input id="mf_title" placeholder="Case title"/></div>
        <div class="drawer-field"><label>Description</label><textarea id="mf_description" placeholder="Describe the issue…"></textarea></div>
        <div class="drawer-field"><label>Status</label>
          <select id="mf_status"><option>Open</option><option>In Progress</option><option>Resolved</option><option>Closed</option></select></div>
        <div class="drawer-field"><label>Priority</label>
          <select id="mf_priority"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select></div>
        <div class="drawer-field"><label>Contact</label>
          <select id="mf_contact_id"><option value="">— None —</option>
          ${contacts.map(c=>`<option value="${c.id}" ${defaults.contact_id===c.id?'selected':''}>${esc(c.first_name+' '+c.last_name)}</option>`).join('')}
          </select></div>
        <div class="drawer-field"><label>Company</label>
          <select id="mf_company_id"><option value="">— None —</option>
          ${companies.map(c=>`<option value="${c.id}" ${defaults.company_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        ${defaults.workitem_id ? `<input type="hidden" id="mf_workitem_id" value="${esc(defaults.workitem_id)}"/>` : ''}
        ${defaults.interaction_id ? `<input type="hidden" id="mf_interaction_id" value="${esc(defaults.interaction_id)}"/>` : ''}`;
      save.onclick = async () => {
        const title = document.getElementById('mf_title').value.trim();
        if (!title) return alert('Title is required');
        const newCase = await API.post('/api/cases', { title, description:document.getElementById('mf_description').value, status:document.getElementById('mf_status').value, priority:document.getElementById('mf_priority').value, contact_id:document.getElementById('mf_contact_id').value||null, company_id:document.getElementById('mf_company_id').value||null, workitem_id:document.getElementById('mf_workitem_id')?.value||defaults.workitem_id||null });
        // If created from an interaction, link the case back to it
        const interactionId = document.getElementById('mf_interaction_id')?.value || defaults.interaction_id || null;
        if (newCase.id && interactionId) {
          await API.patch(`/api/interactions/${interactionId}`, { case_id: newCase.id });
        }
        this.closeModal(); this.loadCases();
        if (newCase.id) this.openDrawer('case', newCase.id);
      };
    }
  },

  closeModal(event) {
    if (event && event.target !== document.getElementById('modalOverlay')) return;
    document.getElementById('modalOverlay').style.display = 'none';
  },

  // ── LOG INTERACTION ───────────────────────────────────────────
  // Map of genesysInteractionId -> { crmId, startedAt } for in-flight calls
  _activeCallInteractions: {},

  async logInteraction(contactId, genesysId, type = 'call', workitemId = null, subject = null, status = 'Active') {
    const contact = contactId ? await API.get(`/api/contacts/${contactId}`) : null;
    const caseId  = contact?.cases?.[0]?.id || null;
    const startedAt = new Date().toISOString();
    const interaction = await API.post('/api/interactions', {
      type, direction: 'inbound', contact_id: contactId,
      company_id: contact?.company_id || null,
      case_id: caseId, genesys_id: genesysId,
      workitem_id: workitemId,
      subject: subject || (type === 'call' ? 'Inbound call' : type === 'workitem' ? 'Workitem' : type),
      status, started_at: startedAt,
    });
    // Store CRM interaction id so we can PATCH it when the call ends
    if (genesysId && interaction?.id) {
      this._activeCallInteractions[genesysId] = { crmId: interaction.id, startedAt, type, contactId: contactId || null, contact: contact || null };
    }
    if (this.currentView === 'interactions') this.loadInteractions();
    if (this.currentView === 'dashboard')    this.loadDashboard();
    return interaction;
  },

  // ── MANUAL LOG INTERACTION MODAL ──────────────────────────────
  async openLogInteractionModal(defaults = {}) {
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');
    const save    = document.getElementById('modalSave');
    overlay.style.display = 'flex';
    title.textContent = 'Log Interaction';
    const [contacts, cases] = await Promise.all([API.get('/api/contacts'), API.get('/api/cases')]);
    body.innerHTML = `
      <div class="drawer-field"><label>Type *</label>
        <select id="mf_type">
          <option value="call" ${defaults.type==='call'?'selected':''}>📞 Call</option>
          <option value="workitem" ${defaults.type==='workitem'?'selected':''}>📋 Workitem</option>
          <option value="email" ${defaults.type==='email'?'selected':''}>📧 Email</option>
          <option value="chat" ${defaults.type==='chat'?'selected':''}>💬 Chat</option>
        </select></div>
      <div class="drawer-field"><label>Subject</label>
        <input id="mf_subject" placeholder="Interaction subject…" value="${esc(defaults.subject||'')}"/></div>
      <div class="drawer-field"><label>Direction</label>
        <select id="mf_direction">
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select></div>
      <div class="drawer-field"><label>Contact</label>
        <select id="mf_contact_id">
          <option value="">— None —</option>
          ${contacts.map(c=>`<option value="${c.id}" ${defaults.contact_id===c.id?'selected':''}>${esc(c.first_name+' '+c.last_name)}</option>`).join('')}
        </select></div>
      <div class="drawer-field"><label>Case</label>
        <select id="mf_case_id">
          <option value="">— None —</option>
          ${cases.map(c=>`<option value="${c.id}" ${defaults.case_id===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}
        </select></div>
      <div class="drawer-field"><label>Notes</label>
        <textarea id="mf_notes" placeholder="Notes about the interaction…">${esc(defaults.notes||'')}</textarea></div>
      <div class="drawer-field"><label>Status</label>
        <select id="mf_status">
          <option value="Completed">Completed</option>
          <option value="Active">Active</option>
          <option value="Missed">Missed</option>
        </select></div>
      ${defaults.workitem_id ? `<input type="hidden" id="mf_workitem_id" value="${esc(defaults.workitem_id)}"/>` : ''}
      ${defaults.genesys_id  ? `<input type="hidden" id="mf_genesys_id"  value="${esc(defaults.genesys_id)}"/>` : ''}`;
    save.onclick = async () => {
      const subject = document.getElementById('mf_subject').value.trim() ||
                      document.getElementById('mf_type').value;
      const interaction = await API.post('/api/interactions', {
        type:       document.getElementById('mf_type').value,
        direction:  document.getElementById('mf_direction').value,
        subject,
        contact_id: document.getElementById('mf_contact_id').value || null,
        case_id:    document.getElementById('mf_case_id').value    || null,
        notes:      document.getElementById('mf_notes').value,
        status:     document.getElementById('mf_status').value,
        workitem_id:document.getElementById('mf_workitem_id')?.value || defaults.workitem_id || null,
        genesys_id: document.getElementById('mf_genesys_id')?.value  || defaults.genesys_id  || null,
        started_at: new Date().toISOString(),
      });
      this.closeModal();
      if (this.currentView === 'interactions') this.loadInteractions();
      if (this.currentView === 'dashboard')    this.loadDashboard();
    };
  },

  // ── HEADLESS CALL CONTROL ──────────────────────────────────────
  // All call control goes through the Framework iframe via postMessage
  // (framework-default.js: updateInteractionState → PureCloud.Interaction.updateState)
  _toFramework(type, data) {
    const iframe = document.getElementById('softphone');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({ type, data }), '*');
    }
  },

  focusInteraction(conversationId) {
    if (!conversationId) return;
    console.log('[CRM] focusInteraction', conversationId);
    this._toFramework('focusInteraction', { id: conversationId });
    if (window.ComposableDesktop) window.ComposableDesktop.setInteraction(conversationId);
  },

  _headlessSetState(state, callerName, callerNum) {
    const label      = document.getElementById('hcbLabel');
    const dot        = document.getElementById('hcbDot');
    const caller     = document.getElementById('hcbCaller');
    const nameEl     = document.getElementById('hcbCallerName');
    const numEl      = document.getElementById('hcbCallerNum');
    const answer     = document.getElementById('hcbAnswer');
    const hangup     = document.getElementById('hcbHangup');
    const wrapup     = document.getElementById('hcbWrapup');
    const wrapupRow  = document.getElementById('hcbWrapupRow');
    if (!label) return;
    dot.className = 'hcb-dot';
    caller.style.display = 'none';
    answer.style.display = hangup.style.display = wrapup.style.display = 'none';
    if (wrapupRow) wrapupRow.style.display = 'none';
    if (state === 'idle') {
      label.textContent = 'No active call';
    } else if (state === 'alerting') {
      dot.className = 'hcb-dot alerting';
      label.textContent = 'Incoming call…';
      caller.style.display = ''; nameEl.textContent = callerName||'Unknown'; numEl.textContent = callerNum||'';
      answer.style.display = 'flex'; hangup.style.display = 'flex';
    } else if (state === 'connected') {
      dot.className = 'hcb-dot connected';
      label.textContent = 'On call';
      caller.style.display = ''; nameEl.textContent = callerName||'Unknown'; numEl.textContent = callerNum||'';
      hangup.style.display = 'flex';
    } else if (state === 'acw') {
      dot.className = 'hcb-dot acw';
      label.textContent = 'After call work';
      caller.style.display = ''; nameEl.textContent = callerName||'Unknown'; numEl.textContent = callerNum||'';
      wrapup.style.display = 'flex';
      if (wrapupRow) wrapupRow.style.display = 'flex';
      this._loadHeadlessWrapupCodes();
    }
  },

  async _loadHeadlessWrapupCodes() {
    const ctx = this._headlessCtx;
    if (!ctx?.conversationId || !_wi.token) return;
    try {
      const r = await this._gcApi('GET', `/api/v2/conversations/calls/${ctx.conversationId}/wrapupcodes`);
      const data = await r.json();
      const codes = data.entities || data || [];
      const sel = document.getElementById('hcbWrapupSelect');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Select wrap-up code —</option>' +
        codes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } catch(e) { console.error('[CRM] loadWrapupCodes failed', e); }
  },

  _headlessAnswer() {
    const id = this._headlessCtx?.conversationId;
    if (!id) { console.error('[CRM] Answer: no conversationId'); return; }
    this._toFramework('updateInteractionState', { action: 'pickup', id });
  },

  _headlessHangup() {
    const id = this._headlessCtx?.conversationId;
    if (!id) { console.error('[CRM] Hangup: no conversationId'); return; }
    this._toFramework('updateInteractionState', { action: 'disconnect', id });
  },

  async _headlessWrapup() {
    const ctx = this._headlessCtx;
    if (!ctx) return;
    const sel = document.getElementById('hcbWrapupSelect');
    const codeId = sel?.value;

    // Submit wrapup code via REST API if one is selected
    if (codeId && ctx.agentParticipantId && _wi.token) {
      try {
        await this._gcApi('POST',
          `/api/v2/conversations/calls/${ctx.conversationId}/participants/${ctx.agentParticipantId}/wrapupcodes`,
          [{ code: { id: codeId } }]
        );
      } catch(e) { console.error('[CRM] submitWrapup failed', e); }
    }

    // End ACW via Framework disconnect
    this._toFramework('updateInteractionState', { action: 'disconnect', id: ctx.conversationId });
    this._headlessCtx = null;
    this._headlessSetState('idle');
  },

  // ── PRESENCE / STATUS ─────────────────────────────────────────
  // Status changes go through Framework's updateUserStatus postMessage
  // (framework-default.js: updateUserStatus → PureCloud.User.updateStatus)
  _presenceDefs: [],

  async _loadPresenceDefs() {
    if (!_wi.token || !_wi.env) return;
    try {
      const r = await this._gcApi('GET', '/api/v2/presencedefinitions?pageSize=100&deactivated=false');
      const data = await r.json();
      this._presenceDefs = (data.entities || []).map(d => ({
        id: d.id,
        systemPresence: d.systemPresence,
        label: (d.languageLabels?.en_US) || d.systemPresence,
      }));
      this._renderPresenceSelect();
    } catch(e) { console.error('[CRM] loadPresenceDefs failed', e); }
  },

  _renderPresenceSelect() {
    const sel = document.getElementById('hcbPresenceSelect');
    if (!sel || !this._presenceDefs.length) return;
    const order = ['ON_QUEUE','AVAILABLE','BUSY','AWAY','BREAK','MEAL','MEETING','TRAINING','OFFLINE'];
    const sorted = [...this._presenceDefs].sort((a,b) => {
      return (order.indexOf(a.systemPresence) + 1 || 99) - (order.indexOf(b.systemPresence) + 1 || 99);
    });
    sel.innerHTML = sorted.map(d =>
      `<option value="${d.id}" data-system="${d.systemPresence}">${d.label}</option>`
    ).join('');
  },

  _setPresence(definitionId) {
    // Send via Framework iframe — it handles the presence + routing status sync internally
    this._toFramework('updateUserStatus', { id: definitionId });
  },

  _updatePresenceUI(systemPresence, definitionId) {
    const sel = document.getElementById('hcbPresenceSelect');
    if (sel && definitionId) sel.value = definitionId;
    const colors = {
      ON_QUEUE: '#10b981', AVAILABLE: '#10b981',
      BUSY: '#ef4444', AWAY: '#f59e0b',
      BREAK: '#f59e0b', MEAL: '#f59e0b',
      MEETING: '#6366f1', TRAINING: '#6366f1',
      OFFLINE: '#94a3b8',
    };
    if (sel) sel.style.borderLeftColor = colors[systemPresence] || '#94a3b8';
  },

  _updateRoutingStatusUI() {}, // no-op: routing status is handled by presence via Framework

  // Direct Genesys Cloud API call — used only for read operations (presencedefinitions, current presence/routing)
  _gcApi(method, path, body) {
    const env = _wi.env || 'mypurecloud.ie';
    return fetch(`https://api.${env}${path}`, {
      method,
      headers: { 'Authorization': 'Bearer ' + _wi.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  _initSoftphone() {
    const el = document.getElementById('softphoneWrapper');
    const handle = document.getElementById('softphoneHandle');
    let dragging = false, sx, sy, ox, oy;
    handle.addEventListener('mousedown', e => {
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      el.style.left  = (ox + e.clientX - sx) + 'px';
      el.style.top   = (oy + e.clientY - sy) + 'px';
      el.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
    document.getElementById('softphoneCollapse').addEventListener('click', () => {
      el.style.display = 'none';
      document.getElementById('softphoneTab').style.display = 'flex';
    });
    document.getElementById('softphoneTab').addEventListener('click', () => {
      el.style.display = 'flex';
      document.getElementById('softphoneTab').style.display = 'none';
    });
  },

  // ── SCREEN POP ────────────────────────────────────────────────
  _initScreenPop() {
    document.getElementById('sptClose').addEventListener('click', () => {
      document.getElementById('screenPopToast').style.display = 'none';
    });
  },

  async screenPop(searchValue, interactionId, type = 'call', workitemId = null, externalContactId = null) {
    const toast = document.getElementById('screenPopToast');
    document.getElementById('sptTitle').textContent = type === 'workitem' ? 'Workitem Assigned' : 'Incoming ' + type;
    document.getElementById('sptSub').textContent = 'Searching for contact…';
    toast.style.display = 'flex';
    document.getElementById('sptOpen').onclick = null;

    // 1. Try Genesys externalContactId first (most reliable — already recognized)
    let contact = null;
    if (externalContactId) {
      const results = await API.get(`/api/contacts/search?genesys_id=${encodeURIComponent(externalContactId)}`);
      if (results.length > 0) contact = results[0];
    }

    // 2. Fallback: phone (or email, if searchValue looks like one) search
    if (!contact && searchValue) {
      const field = searchValue.includes('@') ? 'email' : 'phone';
      const results = await API.get(`/api/contacts/search?${field}=${encodeURIComponent(searchValue)}`);
      if (results.length > 0) contact = results[0];
    }

    if (contact) {
      // If found but no externalContactId stored yet, save it for next time
      if (externalContactId && !contact.genesys_external_id) {
        API.patch(`/api/contacts/${contact.id}`, { genesys_external_id: externalContactId }).catch(() => {});
      }
      document.getElementById('sptSub').textContent = `${contact.first_name} ${contact.last_name} — ${contact.company_name || ''}`;
      document.getElementById('sptOpen').onclick = () => {
        toast.style.display = 'none';
        this.navigate('contacts');
        this.openDrawer('contact', contact.id);
      };
    } else {
      document.getElementById('sptSub').textContent = searchValue ? `Unknown: ${searchValue}` : 'No contact information';
      document.getElementById('sptOpen').textContent = '+ New Contact';
      document.getElementById('sptOpen').onclick = () => {
        toast.style.display = 'none';
        this.openModal('contact', { phone: searchValue });
      };
    }

    // Always log the interaction — with or without a matched contact
    if (type !== 'workitem') {
      await this.logInteraction(
        contact ? contact.id : null,
        interactionId, type, workitemId,
        `Inbound ${type} from ${searchValue || externalContactId || 'unknown'}`
      );
      // Store extra context for interaction focus switching
      if (this._activeCallInteractions[interactionId]) {
        this._activeCallInteractions[interactionId].searchValue       = searchValue || null;
        this._activeCallInteractions[interactionId].externalContactId = externalContactId || null;
        this._activeCallInteractions[interactionId].contact           = contact || null;
      }
    }
    document.getElementById('softphoneIndicator').classList.add('active');
    document.getElementById('agentDot').classList.add('online');
  },

  async interactionEnded(genesysId, durationSeconds, wrapupCode, typeOverride) {
    document.getElementById('softphoneIndicator').classList.remove('active');
    const active = this._activeCallInteractions[genesysId];
    if (!active) return;
    delete this._activeCallInteractions[genesysId];
    const endedAt = new Date().toISOString();
    const duration = durationSeconds != null
      ? durationSeconds
      : Math.round((Date.now() - new Date(active.startedAt).getTime()) / 1000);
    const patch = { status: 'Completed', duration, ended_at: endedAt };

    // Apply type override (e.g. 'chat', 'email') if the initial log was created as 'call'
    if (typeOverride && typeOverride !== active.type) {
      patch.type = typeOverride;
    }

    const finalWrapup = wrapupCode || active.pendingWrapup || null;
    let notes = finalWrapup ? `Wrap-up: ${finalWrapup}` : null;

    // For chat/message interactions, fetch transcript from Genesys API
    const interactionType = typeOverride || active.type;
    if (interactionType === 'chat' && _wi.token && _wi.env) {
      try {
        const transcriptText = await this._fetchChatTranscript(genesysId);
        if (transcriptText) {
          notes = (notes ? notes + '\n\n' : '') + transcriptText;
        }
      } catch(e) { console.error('[CRM] transcript fetch failed', e); }
    }

    if (notes) patch.notes = notes;
    API.patch(`/api/interactions/${active.crmId}`, patch).then(() => {
      if (this.currentView === 'interactions') this.loadInteractions();
      if (this.currentView === 'dashboard')    this.loadDashboard();
    }).catch(e => console.error('[CRM] Failed to close interaction:', e));
  },

  async _fetchChatTranscript(conversationId) {
    // GET /api/v2/conversations/messages/{conversationId}/messages
    const r = await this._gcApi('GET', `/api/v2/conversations/messages/${conversationId}/messages?pageSize=100`);
    if (!r.ok) return null;
    const data = await r.json();
    const messages = data.entities || [];
    if (!messages.length) return null;
    // Build a readable transcript
    const lines = messages
      .filter(m => m.textBody || m.body?.text)
      .map(m => {
        const ts   = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
        const from = m.from?.name || (m.direction === 'outbound' ? 'Agent' : 'Customer');
        const text = m.textBody || m.body?.text || '';
        return `[${ts}] ${from}: ${text}`;
      });
    return lines.length ? '--- Chat Transcript ---\n' + lines.join('\n') : null;
  },

  // Called when wrapup arrives separately (e.g. after interactionEnded already ran without it)
  applyWrapup(genesysId, wrapupCode) {
    // Look up the CRM interaction by genesys_id and patch just the notes
    API.get('/api/interactions').then(items => {
      const match = items.find(i => i.genesys_id === genesysId);
      if (!match) return;
      // Only update if not already set
      if (match.notes && match.notes.startsWith('Wrap-up:')) return;
      API.patch(`/api/interactions/${match.id}`, { notes: `Wrap-up: ${wrapupCode}` }).then(() => {
        if (this.currentView === 'interactions') this.loadInteractions();
        if (this.currentView === 'dashboard')    this.loadDashboard();
      }).catch(() => {});
    }).catch(() => {});
  }
};

// ================================================================
// GENESYS FRAMEWORK — postMessage handler
// ================================================================
// Track which interactionIds we've already screen-popped so we
// don't fire duplicates on every CP conversation update.
var _screenPoppedIds = {};

// Map conversationId → externalContactId populated from CP conversations
// messages, which arrive BEFORE processCallLog for chat/message interactions.
var _cpConvExtContacts = {};

window.addEventListener('message', function(event) {
  var msg;
  try { msg = JSON.parse(event.data); } catch(e) { return; }
  if (!msg) return;

  if (msg.type === 'screenPop') {
    // Intentionally ignored — interactionSubscription handles screen pop
    // with richer data (externalContactId, type detection, etc.)
    // Handling both would create duplicate CRM interactions.
  }

  if (msg.type === 'processCallLog') {
    const id       = msg.data?.interactionId;
    const duration = msg.data?.callLog?.calldurationinseconds ?? null;
    const wrapup   = msg.data?.callLog?.disposition ?? null;
    const subject  = msg.data?.callLog?.subject || '';
    const logIx    = msg.data?.interaction || {};


    // Determine type from interaction flags or subject string
    const isMsg   = logIx.isMessage || logIx.isChat;
    const isEml   = logIx.isEmail;
    const typeFromSubject = subject.toLowerCase().startsWith('chat') ? 'chat'
                          : subject.toLowerCase().startsWith('email') ? 'email'
                          : null;
    const ixType  = isMsg ? 'chat' : isEml ? 'email' : typeFromSubject;


    // ── Screen pop (create CRM interaction) ───────────────────────
    // processCallLog fires multiple times: at connected AND at end.
    // For chat/email, interactionSubscription never fires, so we use the
    // first processCallLog (isConnected: true) as the screen pop trigger.
    if (id && ixType === 'chat' && !_screenPoppedIds[id]) {
      _screenPoppedIds[id] = true;
      const extId = _cpConvExtContacts[id] || null;
      CRM.screenPop('', id, 'chat', null, extId);
    }
    if (id && ixType === 'email' && !_screenPoppedIds[id]) {
      _screenPoppedIds[id] = true;
      const extId = _cpConvExtContacts[id] || null;
      // Confirmed against a real GCEF payload: the sender's email address
      // comes through as displayAddress/ani/phone (all equal on inbound email).
      const fromAddress = logIx.displayAddress || logIx.ani || logIx.phone || logIx.address || '';
      CRM.screenPop(fromAddress, id, 'email', null, extId);
    }

    // ── Close interaction only when it is actually done ───────────
    const isDone = logIx.isDone || logIx.isDisconnected;
    if (id && isDone) {
      CRM.interactionEnded(id, duration, wrapup, ixType || null);
      delete _cpConvExtContacts[id];
    }
  }

  if (msg.type === 'interactionSubscription') {
    const cat = msg.data?.category;
    const ix  = msg.data?.interaction;
    if (cat === 'add' && ix && !_screenPoppedIds[ix.id]) {
      const ixType  = ix.isMessage ? 'chat' : ix.isEmail ? 'email' : 'call';
      // Chat/message screen pop is handled exclusively by processCallLog,
      // which fires after the CP conversations message (so extId is available).
      // Handling it here too would race against _cpConvExtContacts being populated.
      if (ixType !== 'chat' && ixType !== 'email') {
        _screenPoppedIds[ix.id] = true;
        const phone   = ix.address || ix.ani || ix.remoteAddress || '';
        const extId   = ix.externalContactId || null;
        if (phone || extId) CRM.screenPop(phone, ix.id, ixType, null, extId);
      }
      // Headless bar — store context for API calls (calls only)
      if (CRM._integrationMode === 'headless' && ixType === 'call') {
        CRM._headlessCtx = {
          conversationId:    ix.id,
          agentParticipantId: ix.agentParticipantId || ix.participantId || null,
        };
        CRM._headlessCallerName = ix.remoteName || ix.name || '';
        CRM._headlessCallerNum  = ix.address || '';
        CRM._headlessSetState('alerting', CRM._headlessCallerName, CRM._headlessCallerNum);
      }
    }
    if (ix) {
      // category:'change' delivers { old:{...}, new:{...} } — normalize to the new snapshot
      const ixNorm = (cat === 'change' && ix.new) ? ix.new : ix;
      const state  = ixNorm.state;

      // ── Focus switch: interaction promoted to CONNECTED ───────────
      // Fires on category:'change' (HELD→CONNECTED) when agent switches in EF,
      // or category:'update'/'add'. Works for both call and chat.
      if ((cat === 'change' || cat === 'update' || cat === 'add') && state === 'CONNECTED') {
        const active = CRM._activeCallInteractions[ixNorm.id];
        if (active) {
          console.log('[CRM] focus switch detected for', ixNorm.id, 'via category:', cat);
          if (window.ComposableDesktop) window.ComposableDesktop.setInteraction(ixNorm.id);
          const contact = active.contact || null;
          const toast   = document.getElementById('screenPopToast');
          const ixType  = ixNorm.isMessage ? 'chat' : ixNorm.isEmail ? 'email' : 'call';
          document.getElementById('sptTitle').textContent = 'Active: ' + ixType;
          if (contact) {
            document.getElementById('sptSub').textContent = `${contact.first_name} ${contact.last_name}${contact.company_name ? ' — ' + contact.company_name : ''}`;
            document.getElementById('sptOpen').textContent = 'Open';
            document.getElementById('sptOpen').onclick = () => {
              toast.style.display = 'none';
              CRM.navigate('contacts');
              CRM.openDrawer('contact', contact.id);
            };
            CRM.openDrawer('contact', contact.id);
          } else {
            const sv = active.searchValue || '';
            document.getElementById('sptSub').textContent = sv ? `Unknown: ${sv}` : 'No contact';
            document.getElementById('sptOpen').textContent = '+ New Contact';
            document.getElementById('sptOpen').onclick = () => {
              toast.style.display = 'none';
              CRM.openModal('contact', { phone: sv });
            };
          }
          toast.style.display = 'flex';
        }
      }

      if (CRM._integrationMode === 'headless') {
        if (state === 'CONNECTED') {
          if (ixNorm.agentParticipantId && CRM._headlessCtx) CRM._headlessCtx.agentParticipantId = ixNorm.agentParticipantId;
          CRM._headlessSetState('connected', CRM._headlessCallerName, CRM._headlessCallerNum);
        } else if (state === 'ACW') {
          CRM._headlessSetState('acw', CRM._headlessCallerName, CRM._headlessCallerNum);
        }
      }
    }
    if (cat === 'disconnect' && ix) {
      // normalize for disconnect too (may carry flat object or {old,new})
      const ixNorm = ix.new || ix;
      const ixType = ixNorm.isMessage ? 'chat' : ixNorm.isEmail ? 'email' : null;
      // For chat/message, processCallLog handles interactionEnded (with transcript).
      // For calls, handle it here from interactionSubscription disconnect.
      if (ixType !== 'chat' && ixType !== 'email') {
        delete _screenPoppedIds[ixNorm.id];
        const duration = ixNorm.interactionDurationSeconds ?? ixNorm.duration ?? null;
        CRM.interactionEnded(ixNorm.id, duration, null, null);
      }
      if (CRM._integrationMode === 'headless') {
        CRM._headlessCtx = null;
        CRM._headlessSetState('idle');
      }
    }
  }

  // Routing status updates (from CP Message topic)
  if (msg.type === 'routingStatus' || (msg.type === 'notificationSubscription' && (msg.data?.data?.topicName || msg.data?.topicName || '').includes('routingStatus'))) {
    const status = msg.data?.data?.eventBody?.routingStatus?.status
                || msg.data?.eventBody?.routingStatus?.status
                || msg.data?.routingStatus?.status
                || msg.data?.status;
    if (status && CRM._integrationMode === 'headless') {
      CRM._updateRoutingStatusUI(status);
    }
  }

  // Catch wrapup from attribute updates — fallback when processCallLog doesn't fire
  if (msg.type === 'notificationSubscription') {
    // framework.js sends: { type:'notificationSubscription', data:{ category, data:{ topicName, eventBody } } }
    // The CP payload is nested under msg.data.data
    const cpData    = msg.data?.data || {};
    const topicName = cpData.topicName || msg.data?.topicName || '';
    const eventBody = cpData.eventBody || msg.data?.eventBody || {};

    // ── "Updated interaction attributes" message ──────────────────
    // These arrive as flat attrs either directly on msg.data or nested under msg.data.data
    const flatAttrs = (typeof msg.data?.data === 'object' && msg.data?.data?.['call.conversationid'])
                      ? msg.data.data
                      : msg.data || {};
    const sfParticipantId = flatAttrs['salesforce.participantid'];
    const sfConvId        = flatAttrs['call.conversationid'];
    const sfCallState     = flatAttrs['call.state'];
    if (sfParticipantId && sfConvId && CRM._integrationMode === 'headless') {
      // Always update ctx with the latest participantId for this conversation
      if (!CRM._headlessCtx || CRM._headlessCtx.conversationId === sfConvId) {
        if (!CRM._headlessCtx) {
          CRM._headlessCtx = { conversationId: sfConvId, agentParticipantId: sfParticipantId };
        } else {
          CRM._headlessCtx.agentParticipantId = sfParticipantId;
        }
      }
    }

    // ── Interaction focus switch (embedded mode) ──────────────────
    // When the agent clicks a different interaction in the Framework,
    // that interaction fires "call.state":"CONNECTED" via attribute update.
    // Restore the toast and switch the CRM drawer for that interaction.
    if (sfCallState === 'CONNECTED' && sfConvId) {
      const active = CRM._activeCallInteractions[sfConvId];
      if (active) {
        // Restore the screen pop toast for this interaction
        const toast = document.getElementById('screenPopToast');
        const contact = active.contact;
        document.getElementById('sptTitle').textContent = 'Incoming ' + (active.type || 'call');
        if (contact) {
          document.getElementById('sptSub').textContent = `${contact.first_name} ${contact.last_name} — ${contact.company_name || ''}`;
          document.getElementById('sptOpen').textContent = 'Open';
          document.getElementById('sptOpen').onclick = () => {
            toast.style.display = 'none';
            CRM.navigate('contacts');
            CRM.openDrawer('contact', contact.id);
          };
          CRM.openDrawer('contact', contact.id);
        } else {
          const sv = active.searchValue;
          document.getElementById('sptSub').textContent = sv ? `Unknown: ${sv}` : 'No contact information';
          document.getElementById('sptOpen').textContent = '+ New Contact';
          document.getElementById('sptOpen').onclick = () => {
            toast.style.display = 'none';
            CRM.openModal('contact', { phone: sv });
          };
        }
        toast.style.display = 'flex';
      }
    }

    // Routing status from CP message
    if (topicName.includes('routingStatus') && CRM._integrationMode === 'headless') {
      const status = eventBody?.routingStatus?.status;
      if (status) CRM._updateRoutingStatusUI(status);
    }

    // Presence from CP message
    if (topicName.includes('.presence') && CRM._integrationMode === 'headless') {
      const defId = eventBody?.presenceDefinition?.id;
      const sys   = eventBody?.presenceDefinition?.systemPresence;
      if (sys) CRM._updatePresenceUI(sys, defId);
    }

    // Capture agent participantId from conversations CP message for headless API calls.
    // Also capture externalContactId per conversation for chat screen-pop fallback.
    if (topicName.includes('conversations')) {
      const participants = eventBody?.participants || [];
      const convId = eventBody?.id;

      // Track externalContactId from the customer participant
      if (convId) {
        const customerP = participants.find(p => p.purpose === 'customer' && p.externalContactId);
        if (customerP?.externalContactId) {
          _cpConvExtContacts[convId] = customerP.externalContactId;
        }
      }

      // Update headless agentParticipantId
      if (CRM._headlessCtx) {
        const agentP = participants.find(p => p.purpose === 'agent' && p.userId === _wi.userId && p.calls?.some(c => c.state === 'alerting' || c.state === 'connected'));
        if (agentP) CRM._headlessCtx.agentParticipantId = agentP.id;
      }
    }


    // Covers chat/message interactions (no call.state attribute).
    // When a chat is promoted to CONNECTED the conversations topic fires
    // with the participant moving to state 'connected'.
    if (topicName.includes('conversations') && convId) {
      participants.forEach(function(p) {
        if (p.purpose !== 'agent') return;
        // Check all media types for a newly connected participant
        const allLegs = [].concat(p.calls || [], p.chats || [], p.messages || [], p.emails || []);
        allLegs.forEach(function(leg) {
          if (leg.state !== 'connected') return;
          const active = CRM._activeCallInteractions[convId];
          if (!active) return;
          console.log('[CRM] focus switch via conversations topic for', convId);
          const contact = active.contact || null;
          const toast   = document.getElementById('screenPopToast');
          const ixType  = p.messages ? 'chat' : p.calls ? 'call' : 'call';
          document.getElementById('sptTitle').textContent = 'Active: ' + ixType;
          if (contact) {
            document.getElementById('sptSub').textContent = `${contact.first_name} ${contact.last_name}${contact.company_name ? ' — ' + contact.company_name : ''}`;
            document.getElementById('sptOpen').textContent = 'Open';
            document.getElementById('sptOpen').onclick = () => {
              toast.style.display = 'none';
              CRM.navigate('contacts');
              CRM.openDrawer('contact', contact.id);
            };
            CRM.openDrawer('contact', contact.id);
          } else {
            const sv = active.searchValue || '';
            document.getElementById('sptSub').textContent = sv ? `Unknown: ${sv}` : 'No contact';
            document.getElementById('sptOpen').textContent = '+ New Contact';
            document.getElementById('sptOpen').onclick = () => {
              toast.style.display = 'none';
              CRM.openModal('contact', { phone: sv });
            };
          }
          toast.style.display = 'flex';
        });
      });
    }



    // Wrapup from salesforce attribute
    const attrs = eventBody?.attributes || eventBody;
    const wrapupCode = attrs?.['salesforce.wrapupcode'];
    const interactionId = eventBody?.id || eventBody?.interactionId;
    if (wrapupCode && interactionId) {
      const active = CRM._activeCallInteractions[interactionId];
      if (active) {
        active.pendingWrapup = wrapupCode;
      } else {
        CRM.applyWrapup(interactionId, wrapupCode);
      }
    }
  }

  if (msg.type === 'agentSession') {
    _wi.token  = msg.data.token;
    _wi.userId = msg.data.userId;
    _wi.env    = document.getElementById('wiEnvSelect').value || msg.data.environment || 'mypurecloud.ie';
    document.getElementById('agentDot').classList.add('online');
    document.getElementById('softphoneIndicator').classList.add('active');

    // In headless mode, fetch current routing status immediately
    if (CRM._integrationMode === 'headless' && msg.data.userId && _wi.token) {
      // Small defer to ensure token is set on _wi before fetching
      setTimeout(function() {
        // Fetch routing status
        fetch('https://api.' + _wi.env + '/api/v2/users/' + _wi.userId + '/routingStatus', {
          headers: { 'Authorization': 'Bearer ' + _wi.token }
        }).then(r => r.json()).then(d => {
          CRM._updateRoutingStatusUI(d.routingStatus?.status || 'IDLE');
        }).catch(() => CRM._updateRoutingStatusUI('IDLE'));

        // Fetch presence definitions and current presence
        CRM._loadPresenceDefs().then(() => {
          fetch('https://api.' + _wi.env + '/api/v2/users/' + _wi.userId + '/presences/PURECLOUD', {
            headers: { 'Authorization': 'Bearer ' + _wi.token }
          }).then(r => r.json()).then(d => {
            const defId = d.presenceDefinition?.id;
            const sys   = d.presenceDefinition?.systemPresence;
            CRM._updatePresenceUI(sys, defId);
          }).catch(() => {});
        });
      }, 500);
    }

    // Resolve Genesys agent name via API instead of showing userId
    if (msg.data.userId) {
      fetch('https://api.' + _wi.env + '/api/v2/users/' + msg.data.userId + '?fields=name,email', {
        headers: { 'Authorization': 'Bearer ' + msg.data.token }
      })
      .then(function(r) { return r.json(); })
      .then(function(user) {
        var displayName = user.name || msg.data.userId.substring(0, 8) + '…';
        var agentNameEl = document.getElementById('agentName');
        var agentBarEl  = document.getElementById('genesysAgentBar');
        var dividerEl   = document.getElementById('agentDivider');
        if (agentNameEl) agentNameEl.textContent = displayName;
        if (agentBarEl)  agentBarEl.style.display = 'flex';
        if (dividerEl)   dividerEl.style.display = '';
      })
      .catch(function() {
        // Fallback: show truncated userId
        var agentNameEl = document.getElementById('agentName');
        var agentBarEl  = document.getElementById('genesysAgentBar');
        var dividerEl   = document.getElementById('agentDivider');
        if (agentNameEl) agentNameEl.textContent = msg.data.userId.substring(0, 8) + '…';
        if (agentBarEl)  agentBarEl.style.display = 'flex';
        if (dividerEl)   dividerEl.style.display = '';
      });

      var mu = document.getElementById('wiManualUserId');
      if (mu) mu.value = _wi.userId;
      wiConnect();
    } else {
      document.getElementById('wiManualBar').style.display = 'flex';
      var mt = document.getElementById('wiManualToken');
      if (mt) mt.value = _wi.token;
    }
  }

  if (msg.type === 'agentLogout') {
    var agentBarEl = document.getElementById('genesysAgentBar');
    var dividerEl  = document.getElementById('agentDivider');
    if (agentBarEl) agentBarEl.style.display = 'none';
    if (dividerEl)  dividerEl.style.display = 'none';
    document.getElementById('agentDot').classList.remove('online');
    window._wiDisconnect && window._wiDisconnect();
  }
});

// ================================================================
// WORK AUTOMATION ENGINE
// ================================================================
var _wi = {
  token: null, userId: null, env: 'mypurecloud.ie',
  ws: null, channelId: null, connectUri: null,
  heartbeatTimer: null, channelRefreshTimer: null,
  reconnectTimer: null, reconnectAttempts: 0, maxReconnectAttempts: 8,
  intentionalClose: false,
  workitems: {}, selectedId: null, alertingId: null,
  wrapupCodes: {}, worktypeStatuses: {},
  activeInteractions: {}  // workitemId -> CRM interaction id
};

function wiSetStatus(state) {
  var dot   = document.getElementById('wiDot');
  var label = document.getElementById('wiConnLabel');
  var discBtn = document.getElementById('wiDisconnectBtn');
  if (dot)    dot.className = 'wi-dot wi-dot--' + state;
  if (label)  label.textContent = {idle:'Disconnected',connecting:'Connecting…',connected:'Connected',error:'Error'}[state] || state;
  if (discBtn) discBtn.style.display = state === 'connected' ? '' : 'none';
  // Show manual bar when not connected
  var manBar = document.getElementById('wiManualBar');
  if (manBar) manBar.style.display = state === 'connected' ? 'none' : (_wi.token ? 'flex' : 'none');
}

function apiBase() { return 'https://api.' + _wi.env; }

function wiFetch(method, path, body) {
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + _wi.token, 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(apiBase() + path, opts).then(function(r) {
    if (r.status === 401) { wiSetStatus('error'); window._wiDisconnect && window._wiDisconnect(); throw new Error('401 Unauthorized'); }
    if (!r.ok) return r.text().then(function(t) { throw new Error(r.status + ' ' + t); });
    if (r.status === 204) return null;
    return r.json();
  });
}

function wiConnect() {
  _wi.intentionalClose = false;
  wiSetStatus('connecting');
  wiFetch('POST', '/api/v2/notifications/channels', {})
    .then(function(channel) {
      _wi.channelId = channel.id; _wi.connectUri = channel.connectUri;
      clearTimeout(_wi.channelRefreshTimer);
      _wi.channelRefreshTimer = setTimeout(wiRefreshChannel, 23 * 60 * 60 * 1000);
      return wiFetch('POST', '/api/v2/notifications/channels/' + channel.id + '/subscriptions',
        [{ id: 'v2.taskmanagement.workitems.users.' + _wi.userId }, { id: 'v2.users.' + _wi.userId + '.conversations' }])
        .then(function() { return channel.connectUri; });
    })
    .then(function(uri) { wiOpenWebSocket(uri); })
    .catch(function(err) {
      wiSetStatus('error');
      wiScheduleReconnect();
    });
}

function wiOpenWebSocket(uri) {
  if (_wi.ws) { try { _wi.ws.close(); } catch(e) {} }
  _wi.ws = new WebSocket(uri);
  _wi.ws.onopen = function() {
    _wi.reconnectAttempts = 0; wiSetStatus('connected');
    clearInterval(_wi.heartbeatTimer);
    _wi.heartbeatTimer = setInterval(function() {
      if (_wi.ws && _wi.ws.readyState === WebSocket.OPEN) _wi.ws.send(JSON.stringify({ message: 'ping' }));
    }, 60000);
    wiLoadWorkitems();
  };
  _wi.ws.onmessage = function(evt) {
    var msg; try { msg = JSON.parse(evt.data); } catch(e) { return; }
    if (msg.topicName === 'channel.metadata' && msg.eventBody && msg.eventBody.type === 'ChannelExpired') { wiRefreshChannel(); return; }
    wiHandleNotification(msg);
  };
  _wi.ws.onerror = function() { wiSetStatus('error'); };
  _wi.ws.onclose = function(evt) {
    clearInterval(_wi.heartbeatTimer);
    if (_wi.intentionalClose) { wiSetStatus('idle'); return; }
    wiSetStatus('connecting'); wiScheduleReconnect();
  };
}

function wiScheduleReconnect() {
  if (_wi.intentionalClose || _wi.reconnectAttempts >= _wi.maxReconnectAttempts) { wiSetStatus('error'); return; }
  var delay = Math.min(1000 * Math.pow(2, _wi.reconnectAttempts), 30000);
  _wi.reconnectAttempts++;
  clearTimeout(_wi.reconnectTimer);
  _wi.reconnectTimer = setTimeout(function() {
    if (_wi.connectUri) wiOpenWebSocket(_wi.connectUri); else wiConnect();
  }, delay);
}

function wiRefreshChannel() {
  wiFetch('POST', '/api/v2/notifications/channels', {})
    .then(function(channel) {
      _wi.channelId = channel.id; _wi.connectUri = channel.connectUri;
      return wiFetch('POST', '/api/v2/notifications/channels/' + channel.id + '/subscriptions',
        [{ id: 'v2.taskmanagement.workitems.users.' + _wi.userId }, { id: 'v2.users.' + _wi.userId + '.conversations' }])
        .then(function() { wiOpenWebSocket(channel.connectUri); clearTimeout(_wi.channelRefreshTimer); _wi.channelRefreshTimer = setTimeout(wiRefreshChannel, 23 * 60 * 60 * 1000); });
    })
    .catch(function() { wiScheduleReconnect(); });
}

function wiHandleNotification(msg) {
  var topic = msg.topicName || '';
  var body  = msg.eventBody || {};

  // Capture externalContactId from conversations CP messages for chat screen-pop.
  // This WS receives ALL user topics (conversations, presence, etc.) not just workitems.
  if (topic.includes('conversations') && body.id) {
    var convId = body.id;
    var participants = body.participants || [];
    var customerP = participants.find(function(p) { return p.purpose === 'customer' && p.externalContactId; });
    if (customerP && customerP.externalContactId) {
      _cpConvExtContacts[convId] = customerP.externalContactId;
    }
  }

  if (!topic.includes('workitem')) return;
  var wi = body.workitem || body;
  if (!wi || !wi.id) return;
  var prevState = (_wi.workitems[wi.id] || {}).assignmentState;
  _wi.workitems[wi.id] = Object.assign(_wi.workitems[wi.id] || {}, wi);
  // Track when workitem became Connected so we can compute duration
  if (wi.assignmentState === 'Connected' && prevState !== 'Connected') {
    _wi.workitems[wi.id]._interactionStarted = new Date().toISOString();
  }
  if (wi.assignmentState === 'Alerting' && prevState !== 'Alerting') wiShowAlert(wi);
  if (wi.assignmentState !== 'Alerting' && _wi.alertingId === wi.id) wiHideAlert();

  // Auto-create CRM interaction when agent accepts (Connected) via WS notification
  // Guard: only if API-based accept didn't already create it
  if (wi.assignmentState === 'Connected' && prevState !== 'Connected' && !_wi.activeInteractions[wi.id]) {
    _wi.workitems[wi.id]._interactionStarted = _wi.workitems[wi.id]._interactionStarted || new Date().toISOString();
    setTimeout(function() {
      // small delay to let the API-based accept path run first if both fire
      if (!_wi.activeInteractions[wi.id]) {
        wiCreateInteractionForWorkitem(_wi.workitems[wi.id] || wi);
      }
    }, 500);
  }

  // Close interaction when workitem ends
  if (wi.assignmentState === 'Terminated') {
    wiCloseInteractionForWorkitem(wi.id, 'Completed');
    delete _wi.workitems[wi.id]; delete _wi.wrapupCodes[wi.id];
    if (_wi.selectedId === wi.id) wiClearDetail();
  }
  if (wi.assignmentState === 'Disconnected' && _wi.activeInteractions[wi.id]) {
    wiCloseInteractionForWorkitem(wi.id, 'Completed');
  }
  if (wi.assignmentState === 'AfterCallWork') wiShowWrapup(wi.id);
  wiRenderList();
  if (_wi.selectedId === wi.id && _wi.workitems[wi.id]) wiRenderDetail(_wi.workitems[wi.id]);
  // Update dashboard stat
  document.getElementById('statWorkitems').textContent = Object.keys(_wi.workitems).length;
}

function wiLoadWorkitems() {
  wiFetch('POST', '/api/v2/taskmanagement/workitems/query/jobs', {
    filters: [{ name:'assigneeId', type:'String', operator:'EQ', values:[_wi.userId] }],
    pageSize: 100
  })
  .then(function(job) { return wiPollQueryJob(job.id, 0); })
  .then(function(items) {
    _wi.workitems = {};
    items.forEach(function(wi) { _wi.workitems[wi.id] = wi; });
    wiRenderList();
    document.getElementById('statWorkitems').textContent = items.length;
  })
  .catch(function(err) { console.error('[WA] Load failed:', err.message); });
}

function wiPollQueryJob(jobId, attempt) {
  return wiFetch('GET', '/api/v2/taskmanagement/workitems/query/jobs/' + jobId)
    .then(function(status) {
      var state = String(status.state || status.status || '').toLowerCase();
      if (state === 'complete' || state === 'completed' || state === 'fulfilled' || state === 'succeeded') {
        return wiFetch('GET', '/api/v2/taskmanagement/workitems/query/jobs/' + jobId + '/results?pageSize=100')
          .then(function(res) { return (res && res.entities) || []; });
      }
      if (state === 'failed' || state === 'error') throw new Error('Job failed');
      if (attempt >= 30) throw new Error('Job timed out');
      return new Promise(function(res) { setTimeout(res, 1000); }).then(function() { return wiPollQueryJob(jobId, attempt + 1); });
    });
}

function wiRenderList() {
  var ids = Object.keys(_wi.workitems);
  var countEl = document.getElementById('wiItemCount');
  var badge   = document.getElementById('wiBadge');
  var empty   = document.getElementById('wiEmpty');
  var list    = document.getElementById('wiList');
  if (countEl) countEl.textContent = ids.length;
  if (badge)   { badge.textContent = ids.length; badge.style.display = ids.length > 0 ? '' : 'none'; }
  if (!list) return;
  if (ids.length === 0) {
    if (empty) empty.style.display = '';
    Array.from(list.querySelectorAll('.wi-card')).forEach(function(c) { list.removeChild(c); });
    return;
  }
  if (empty) empty.style.display = 'none';
  var existing = {};
  Array.from(list.querySelectorAll('.wi-card')).forEach(function(c) { existing[c.dataset.id] = c; });
  Object.keys(existing).forEach(function(id) { if (!_wi.workitems[id]) list.removeChild(existing[id]); });
  ids.sort(function(a,b) {
    var wa=_wi.workitems[a],wb=_wi.workitems[b];
    if (wa.assignmentState==='Alerting'&&wb.assignmentState!=='Alerting') return -1;
    if (wb.assignmentState==='Alerting'&&wa.assignmentState!=='Alerting') return 1;
    return (wa.name||'').localeCompare(wb.name||'');
  });
  ids.forEach(function(id, idx) {
    var wi = _wi.workitems[id];
    var card = existing[id] || document.createElement('div');
    var ds = wi.assignmentState || wi.statusCategory || 'unknown';
    var sc = wiStatusClass(ds);
    card.className = 'wi-card' + (_wi.selectedId===id?' wi-card--selected':'') + (wi.assignmentState==='Alerting'?' wi-card--alerting':'');
    card.dataset.id = id;
    card.innerHTML = '<div class="wi-card-top"><span class="wi-card-name">' + esc(wi.name||'Untitled') + '</span><span class="wi-chip wi-chip--' + sc + '">' + esc(ds) + '</span></div><div class="wi-card-meta"><span>' + esc((wi.type&&wi.type.id&&wi.type.id.substring(0,8)+'…')||'') + '</span>' + (wi.dateDue?'<span>⏰ '+new Date(wi.dateDue).toLocaleDateString()+'</span>':'') + '</div>';
    card.onclick = function() { wiSelectWorkitem(id); };
    if (!existing[id]) { var ref=list.querySelectorAll('.wi-card')[idx]; if(ref) list.insertBefore(card,ref); else list.appendChild(card); }
  });
}

function wiSelectWorkitem(id) {
  _wi.selectedId = id;
  wiRenderList();
  var wi = _wi.workitems[id];
  if (wi) {
    wiRenderDetail(wi);
    // Navigate to work automation view if not already there
    if (CRM.currentView !== 'workitems') CRM.navigate('workitems');
  }
}

function wiRenderDetail(wi) {
  var empty   = document.getElementById('wiDetailEmpty');
  var content = document.getElementById('wiDetailContent');
  if (!empty || !content) return;
  empty.style.display = 'none'; content.style.display = '';
  var ds = wi.assignmentState || wi.statusCategory || 'unknown';
  var sc = wiStatusClass(ds);
  document.getElementById('wiDetailName').textContent    = wi.name || 'Untitled';
  var statusEl = document.getElementById('wiDetailStatus');
  statusEl.textContent = ds; statusEl.className = 'wi-status-chip wi-chip--' + sc;
  document.getElementById('wiDetailPriority').textContent = wi.priority != null ? wi.priority : '—';
  document.getElementById('wiDetailDue').textContent      = wi.dateDue ? new Date(wi.dateDue).toLocaleString() : '—';
  document.getElementById('wiDetailQueue').textContent    = (wi.queue&&wi.queue.name)||(wi.queue&&wi.queue.id)||'—';
  document.getElementById('wiRaw').value = JSON.stringify(wi, null, 2);
  document.getElementById('wiAcceptBtn').style.display = wi.assignmentState==='Alerting' ? '' : 'none';
  // Custom attrs
  var attrsEl = document.getElementById('wiAttrs');
  var attrs = wi.customFields || wi.attributes || {};
  var keys = Object.keys(attrs);
  attrsEl.innerHTML = keys.length === 0 ? '<div class="wi-attr-empty">No custom attributes</div>' :
    keys.map(function(k) { return '<div class="wi-attr-row"><span class="wi-attr-key">'+esc(k)+'</span><span class="wi-attr-val">'+esc(String(attrs[k]))+'</span></div>'; }).join('');
  // Status dropdown
  var statusSel = document.getElementById('wiStatusSelect');
  var curStatusId = (wi.status&&wi.status.id)||'';
  if (wi.type && wi.type.id) wiLoadWorktypeStatuses(wi.type.id, curStatusId, statusSel);
  else statusSel.innerHTML = '<option value="">— No statuses —</option>';
  // Wrapup
  var wrapSec = document.getElementById('wiWrapupSection');
  if (wrapSec) wrapSec.style.display = wi.assignmentState==='AfterCallWork' ? '' : 'none';
  if (wi.assignmentState==='AfterCallWork') wiLoadWrapupCodes(wi.id);
  // CRM bar
  wiUpdateCrmBar(wi);
}

function wiUpdateCrmBar(wi) {
  var bar = document.getElementById('wiCrmBar');
  var contactLabel  = document.getElementById('wiCrmContact');
  var createCaseBtn = document.getElementById('wiCreateCaseBtn');
  var openContactBtn= document.getElementById('wiOpenContactBtn');
  if (!bar) return;
  contactLabel.textContent = 'No linked CRM contact';
  openContactBtn.style.display = 'none';

  // Show active interaction if one exists
  var interactionId = _wi.activeInteractions[wi.id];
  var interLabel = document.getElementById('wiActiveInteraction');
  if (interLabel) {
    interLabel.textContent = interactionId ? '✓ Interaction logged (#' + interactionId.substring(0,8) + '…)' : '';
    interLabel.style.display = interactionId ? '' : 'none';
  }

  var searchTerm = wi.externalTag || wi.name;
  var doUpdate = function(contact) {
    if (contact) {
      contactLabel.textContent = contact.first_name + ' ' + contact.last_name + (contact.company_name ? ' · ' + contact.company_name : '');
      openContactBtn.style.display = '';
      openContactBtn.onclick = function() { CRM.navigate('contacts'); CRM.openDrawer('contact', contact.id); };
      createCaseBtn.onclick  = function() { CRM.openModal('case', { contact_id: contact.id, company_id: contact.company_id, workitem_id: wi.id }); };
    } else {
      createCaseBtn.onclick  = function() { CRM.openModal('case', { workitem_id: wi.id }); };
    }
  };

  if (searchTerm) {
    fetch('/api/contacts/search?name=' + encodeURIComponent(searchTerm))
      .then(function(r) { return r.json(); })
      .then(function(results) { doUpdate(results.length > 0 ? results[0] : null); })
      .catch(function() { doUpdate(null); });
  } else {
    doUpdate(null);
  }
}

// Auto-create a CRM interaction when a workitem is accepted
function wiCreateInteractionForWorkitem(wi) {
  var searchTerm = wi.externalTag || wi.name;
  var doCreate = function(contactId, companyId, caseId) {
    API.post('/api/interactions', {
      type: 'workitem',
      direction: 'inbound',
      contact_id: contactId || null,
      company_id: companyId || null,
      case_id: caseId || null,
      workitem_id: wi.id,
      subject: wi.name || 'Workitem',
      status: 'Active',
      started_at: new Date().toISOString(),
    }).then(function(interaction) {
      if (interaction && interaction.id) {
        _wi.activeInteractions[wi.id] = interaction.id;
        // Refresh interactions view if open
        if (CRM.currentView === 'interactions') CRM.loadInteractions();
        if (CRM.currentView === 'dashboard')    CRM.loadDashboard();
        // Update the CRM bar to show linked contact
        wiUpdateCrmBar(wi);
      }
    }).catch(function(e) { console.error('[WA] Failed to log interaction:', e); });
  };
  if (searchTerm) {
    fetch('/api/contacts/search?name=' + encodeURIComponent(searchTerm))
      .then(function(r) { return r.json(); })
      .then(function(results) {
        if (results.length > 0) {
          var c = results[0];
          // Find open case for this contact
          API.get('/api/contacts/' + c.id).then(function(full) {
            var openCase = (full.cases || []).find(function(cs) { return cs.status === 'Open' || cs.status === 'In Progress'; });
            doCreate(c.id, c.company_id, openCase ? openCase.id : null);
          });
        } else {
          doCreate(null, null, null);
        }
      })
      .catch(function() { doCreate(null, null, null); });
  } else {
    doCreate(null, null, null);
  }
}

// Close/update the CRM interaction when workitem ends
function wiCloseInteractionForWorkitem(workitemId, status) {
  var interactionId = _wi.activeInteractions[workitemId];
  if (!interactionId) return;
  var wi = _wi.workitems[workitemId];
  var started = wi && wi._interactionStarted ? new Date(wi._interactionStarted) : null;
  var duration = started ? Math.round((Date.now() - started.getTime()) / 1000) : null;
  API.patch('/api/interactions/' + interactionId, {
    status: status || 'Completed',
    ended_at: new Date().toISOString(),
    duration: duration,
  }).then(function() {
    delete _wi.activeInteractions[workitemId];
    if (CRM.currentView === 'interactions') CRM.loadInteractions();
    if (CRM.currentView === 'dashboard')    CRM.loadDashboard();
  }).catch(function(e) { console.error('[WA] Failed to close interaction:', e); });
}

function wiClearDetail() {
  _wi.selectedId = null;
  var empty   = document.getElementById('wiDetailEmpty');
  var content = document.getElementById('wiDetailContent');
  if (empty)   empty.style.display = '';
  if (content) content.style.display = 'none';
}

function wiShowAlert(wi) {
  _wi.alertingId = wi.id;
  var titleEl = document.getElementById('wiAlertTitle');
  var subEl   = document.getElementById('wiAlertSub');
  var alert   = document.getElementById('wiAlert');
  if (titleEl) titleEl.textContent = wi.name || 'New Workitem';
  if (subEl)   subEl.textContent   = (wi.type&&wi.type.name)||(wi.queue&&wi.queue.name)||'Routing: Alerting';
  if (alert)   alert.style.display = '';
  // Screen pop for workitem
  CRM.screenPop(wi.externalTag || null, null, 'workitem', wi.id);
  // Switch to work automation view
  CRM.navigate('workitems');
  wiSelectWorkitem(wi.id);
}
function wiHideAlert() {
  _wi.alertingId = null;
  var alert = document.getElementById('wiAlert');
  if (alert) alert.style.display = 'none';
}

function wiShowWrapup(workitemId) {
  var sec = document.getElementById('wiWrapupSection');
  if (sec) sec.style.display = '';
  wiLoadWrapupCodes(workitemId);
}

function wiLoadWrapupCodes(workitemId) {
  if (_wi.wrapupCodes[workitemId]) { wiPopulateWrapupDropdown(_wi.wrapupCodes[workitemId]); return; }
  wiFetch('GET', '/api/v2/taskmanagement/workitems/' + workitemId + '/wrapupcodes')
    .then(function(data) { var codes=(data&&data.entities)||[]; _wi.wrapupCodes[workitemId]=codes; wiPopulateWrapupDropdown(codes); })
    .catch(function(){});
}
function wiPopulateWrapupDropdown(codes) {
  var sel = document.getElementById('wiWrapupSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select wrap-up code —</option>' + codes.map(function(c) { return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'; }).join('');
}

function wiLoadWorktypeStatuses(worktypeId, currentId, selectEl) {
  if (_wi.worktypeStatuses[worktypeId]) { wiPopulateStatusDropdown(_wi.worktypeStatuses[worktypeId], currentId, selectEl); return; }
  wiFetch('GET', '/api/v2/taskmanagement/worktypes/' + worktypeId + '/statuses')
    .then(function(data) { var s=(data&&data.entities)||[]; _wi.worktypeStatuses[worktypeId]=s; wiPopulateStatusDropdown(s,currentId,selectEl); })
    .catch(function() { selectEl.innerHTML = '<option value="">— Could not load —</option>'; });
}
function wiPopulateStatusDropdown(statuses, currentId, selectEl) {
  selectEl.innerHTML = '<option value="">— Change Status —</option>' +
    statuses.map(function(s) { return '<option value="'+esc(s.id)+'"'+(s.id===currentId?' selected':'')+'>'+esc(s.name)+'</option>'; }).join('');
}

function wiAction(workitemId, patch) {
  return wiFetch('PATCH', '/api/v2/taskmanagement/workitems/' + workitemId, patch)
    .then(function(updated) {
      if (updated) {
        _wi.workitems[workitemId] = Object.assign(_wi.workitems[workitemId]||{}, updated);
        wiRenderList();
        if (_wi.selectedId === workitemId) wiRenderDetail(_wi.workitems[workitemId]);
      }
      return updated;
    });
}

function wiStatusClass(s) {
  if (!s) return 'neutral';
  s = String(s).toLowerCase();
  if (s === 'alerting')                                    return 'alerting';
  if (s === 'connected' || s === 'open' || s === 'inprogress') return 'connected';
  if (s === 'parked' || s === 'held' || s === 'idle')      return 'parked';
  if (s === 'aftercallwork' || s === 'wrapup')             return 'wrapup';
  if (s === 'terminated' || s === 'closed')                return 'closed';
  return 'neutral';
}

// ── Wire up WA buttons ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // Accept (alert banner)
  document.getElementById('wiAlertAccept').addEventListener('click', function() {
    var id = _wi.alertingId; if (!id) return;
    wiAction(id, { assignmentState:'Connected', assignee:{ id:_wi.userId } })
      .then(function() {
        wiHideAlert();
        // Trigger interaction creation immediately after accept (don't wait for WS)
        if (!_wi.activeInteractions[id] && _wi.workitems[id]) {
          _wi.workitems[id]._interactionStarted = new Date().toISOString();
          wiCreateInteractionForWorkitem(_wi.workitems[id]);
        }
      }).catch(function(e) { console.error('[WA] Accept failed:', e); });
  });

  // Decline (alert banner)
  document.getElementById('wiAlertDecline').addEventListener('click', function() {
    var id = _wi.alertingId; if (!id) return;
    wiHideAlert();
    wiAction(id, { assignmentState:'Disconnected' }).catch(function(){});
  });

  // Accept (detail)
  document.getElementById('wiAcceptBtn').addEventListener('click', function() {
    var id = _wi.selectedId; if (!id) return;
    wiAction(id, { assignmentState:'Connected', assignee:{ id:_wi.userId } })
      .then(function() {
        wiHideAlert();
        if (!_wi.activeInteractions[id] && _wi.workitems[id]) {
          _wi.workitems[id]._interactionStarted = new Date().toISOString();
          wiCreateInteractionForWorkitem(_wi.workitems[id]);
        }
      }).catch(function(e) { console.error('[WA] Accept failed:', e); });
  });

  // Park
  document.getElementById('wiParkBtn').addEventListener('click', function() {
    var id = _wi.selectedId; if (!id) return;
    wiAction(id, { assignmentState:'Parked' }).catch(function(e) { console.error('[WA] Park failed:', e); });
  });

  // Disconnect workitem
  document.getElementById('wiDisconnectWorkitemBtn').addEventListener('click', function() {
    var id = _wi.selectedId; if (!id) return;
    wiAction(id, { assignmentState:'Disconnected' })
      .catch(function(e) { console.error('[WA] Disconnect failed:', e); });
  });

  // Terminate
  document.getElementById('wiEndBtn').addEventListener('click', function() {
    var id = _wi.selectedId; if (!id) return;
    wiAction(id, { assignmentState:'Terminated' })
      .then(function() { delete _wi.workitems[id]; wiRenderList(); wiClearDetail(); })
      .catch(function(e) { console.error('[WA] Terminate failed:', e); });
  });

  // Change status
  document.getElementById('wiStatusBtn').addEventListener('click', function() {
    var id = _wi.selectedId;
    var statusId = document.getElementById('wiStatusSelect').value;
    if (!id || !statusId) return;
    wiAction(id, { statusId: statusId }).catch(function(e) { console.error('[WA] Status failed:', e); });
  });

  // Apply wrapup
  document.getElementById('wiWrapupBtn').addEventListener('click', function() {
    var id = _wi.selectedId;
    var wid = document.getElementById('wiWrapupSelect').value;
    if (!id || !wid) return;
    wiFetch('POST', '/api/v2/taskmanagement/workitems/' + id + '/wrapupcodes', [{ code:{ id:wid } }])
      .catch(function(e) { console.error('[WA] Wrapup failed:', e); });
  });

  // Transfer
  document.getElementById('wiTransferBtn').addEventListener('click', function() {
    var id = _wi.selectedId;
    var target = document.getElementById('wiTransferUserId').value.trim();
    if (!id || !target) return;
    wiFetch('POST', '/api/v2/taskmanagement/workitems/' + id + '/user/transfers', { userId: target })
      .then(function() { delete _wi.workitems[id]; wiRenderList(); wiClearDetail(); })
      .catch(function(e) { console.error('[WA] Transfer failed:', e); });
  });

  // Refresh
  document.getElementById('wiRefreshBtn').addEventListener('click', function() {
    if (_wi.token) wiLoadWorkitems();
  });

  // Manual connect
  document.getElementById('wiManualConnectBtn').addEventListener('click', function() {
    var token  = document.getElementById('wiManualToken').value.trim()  || _wi.token;
    var userId = document.getElementById('wiManualUserId').value.trim() || _wi.userId;
    if (!token || !userId) return alert('Enter both a bearer token and User ID');
    _wi.token  = token;
    _wi.userId = userId;
    _wi.env    = document.getElementById('wiEnvSelect').value || 'mypurecloud.ie';
    wiConnect();
  });

  // Log Interaction (workitem panel)
  var wiLogBtn = document.getElementById('wiLogInteractionBtn');
  if (wiLogBtn) {
    wiLogBtn.addEventListener('click', function() {
      var id = _wi.selectedId;
      var wi = id ? _wi.workitems[id] : null;
      CRM.openLogInteractionModal({
        type: 'workitem',
        subject: wi ? wi.name : '',
        workitem_id: id || null,
      });
    });
  }

  // Expose global disconnect
  window._wiDisconnect = function() {
    _wi.intentionalClose = true;
    if (_wi.ws) { try { _wi.ws.close(); } catch(e) {} _wi.ws = null; }
    clearInterval(_wi.heartbeatTimer); clearTimeout(_wi.channelRefreshTimer); clearTimeout(_wi.reconnectTimer);
    _wi.token = null; _wi.userId = null; _wi.channelId = null; _wi.connectUri = null;
    _wi.reconnectAttempts = 0; _wi.workitems = {}; _wi.selectedId = null; _wi.alertingId = null;
    _wi.wrapupCodes = {}; _wi.worktypeStatuses = {}; _wi.activeInteractions = {};
    wiRenderList(); wiClearDetail(); wiHideAlert();
    wiSetStatus('idle');
  };

  // Init CRM
  CRM.init();
});
