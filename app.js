import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, reauthenticateWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ---------- Constants ---------- */
const NOW = new Date();
const RY = NOW.getMonth() >= 6 ? NOW.getFullYear() - 1 : NOW.getFullYear() - 2; // último ejercicio de renta presentado
const STAGES = [
  ['nuevo','Nuevo'],
  ['docs','Recopilando documentación'],
  ['listo','Expediente completo'],
  ['banco','En estudio en banco'],
  ['tasacion','Tasación'],
  ['aprobado','Aprobado (FEIN)'],
  ['firmado','Firmado'],
  ['descartado','Descartado']
];
const STAGE = Object.fromEntries(STAGES);
const CLOSED = ['firmado','descartado'];
const PERFILES = [['ajena','Trabajador por cuenta ajena'],['societario','Autónomo societario con nómina'],['autonomo','Autónomo'],['funcionario','Funcionario']];
const ESTADOS = [['soltero','Soltero/a'],['casado','Casado/a'],['pareja','Pareja de hecho'],['divorciado','Divorciado/a'],['separado','Separado/a'],['viudo','Viudo/a']];
const CONTRATOS = ['Indefinido','Temporal','Fijo discontinuo','Autónomo','Funcionario de carrera','Funcionario interino','Otro'];
const CCAA = ['Andalucía','Aragón','Asturias','Illes Balears','Canarias','Cantabria','Castilla-La Mancha','Castilla y León','Cataluña','Comunitat Valenciana','Extremadura','Galicia','La Rioja','Comunidad de Madrid','Región de Murcia','Navarra','País Vasco','Ceuta','Melilla'];
const TIPOS_HIP = ['Compra de vivienda habitual','Compra de segunda vivienda','Cambio de banco (subrogación)','Ampliación o refinanciación','Autopromoción','Otra'];
const TIPOLOGIAS = ['Piso','Ático','Dúplex','Casa o chalet','Adosado','Planta baja','Estudio','Local','Terreno','Otra'];

const DOCS = {
  lopd:{label:'Documento de LOPD firmado', hint:'Imprescindible para tramitar la operación', file:'LOPD firmado'},
  notaSimple:{label:'Nota simple de la vivienda que se adquiere', validDays:90, file:'Nota simple'},
  arras:{label:'Contrato de arras y justificante', file:'Arras - contrato y justificante'},
  alquiler:{label:'Contrato de alquiler con opción a compra', file:'Alquiler con opcion a compra'},
  tasacion:{label:'Informe y certificado de tasación', file:'Tasacion - informe y certificado'},
  dni:{label:'Fotocopia del DNI/NIE', file:'DNI-NIE'},
  renta1:{label:`Declaración de la renta de ${RY} o certificado de retenciones de ${RY}`, file:`Renta ${RY}`},
  renta2:{label:`Declaración de la renta de ${RY-1} y ${RY}`, file:`Renta ${RY-1} y ${RY}`},
  trimIRPF:{label:'Impuestos trimestrales de IRPF del año en curso', file:'Trimestrales IRPF'},
  trimIVA:{label:'Impuestos trimestrales de IVA del año en curso', file:'Trimestrales IVA'},
  ivaAnual:{label:'Impuesto anual de IVA (modelo 390)', file:'IVA anual 390'},
  nombramiento:{label:'Carta de nombramiento o toma de posesión como funcionario', file:'Nombramiento funcionario'},
  vidaLaboral:{label:'Vida laboral actualizada', hint:'Con menos de un mes de antigüedad', validDays:30, file:'Vida laboral'},
  nominas:{label:'3 últimas nóminas', validDays:40, file:'Nominas'},
  recibos:{label:'3 últimos recibos de cualquier financiación en activo', validDays:40, file:'Recibos financiaciones'},
  sentencia:{label:'Sentencia de divorcio', file:'Sentencia divorcio'},
  convenio:{label:'Convenio regulador', hint:'Tiene hijos menores a cargo', file:'Convenio regulador'},
  movimientos:{label:'Movimientos de los últimos 3 meses', hint:'De la cuenta donde recibe los ingresos y tiene los ahorros', validDays:30, file:'Movimientos 3 meses'}
};

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const has = v => v !== undefined && v !== null && String(v).trim() !== '';
const eur = n => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n || 0);
const pct = n => (isFinite(n) ? (n * 100).toFixed(1).replace('.', ',') : '—') + ' %';
const days = ts => Math.floor((Date.now() - ts) / 86400000);
const kb = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const opts = (list, val, blank = true) => (blank ? '<option value="">—</option>' : '') + list.map(o => {
  const [v, l] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}"${String(val ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
}).join('');
const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sin nombre';
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3200); }
function titularName(x){ return (x.titulares[0] && x.titulares[0].nombre) || 'Sin nombre'; }

/* ---------- Firebase + Google Drive ---------- */
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const fdb = getFirestore(fbApp);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file'); // solo los archivos que crea esta app

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

/* Datos:  Firestore      usuarios/{uid}/expedientes/{id}
   PDF:    Google Drive   Mi unidad/Expedientes/{referencia y titular}/*.pdf */
const Store = {
  uid: null, col: null, unsub: null, pending: new Map(), inflight: new Set(),
  token: null, tokenExp: 0, _root: null,
  start(uid, onChange){
    this.uid = uid;
    this.col = collection(fdb, 'usuarios', uid, 'expedientes');
    this.unsub = onSnapshot(this.col,
      snap => onChange(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
      err => {
        if (err.code === 'permission-denied'){ signOut(auth).finally(() => renderLogin('Esta cuenta de Google no tiene acceso a la herramienta.')); }
        else toast('Se perdió la conexión. Recarga la página.');
      });
  },
  stop(){ if (this.unsub) this.unsub(); this.unsub = null; this.uid = null; this.col = null; this.token = null; this._root = null; },
  save(x){ this.pending.set(x.id, JSON.parse(JSON.stringify(x))); this._flush(x.id); },
  async _flush(id){
    if (this.inflight.has(id)) return;
    const data = this.pending.get(id); if (!data) return;
    this.pending.delete(id); this.inflight.add(id);
    try{ await setDoc(doc(this.col, id), data); }
    catch(e){
      if (e.code === 'unavailable'){ await new Promise(r => setTimeout(r, 1000)); try{ await setDoc(doc(this.col, id), data); }catch(e2){ toast('No se pudo guardar. Revisa la conexión.'); } }
      else if (e.code === 'permission-denied') toast('Sin permiso para guardar. Revisa las reglas de Firestore.');
      else toast('No se pudo guardar el expediente.');
    }
    finally{ this.inflight.delete(id); if (this.pending.has(id)) this._flush(id); }
  },
  busy(id){ return this.pending.has(id) || this.inflight.has(id); },
  async remove(x){ await deleteDoc(doc(this.col, x.id)); },

  /* Acceso a Drive: el permiso dura una hora; después se renueva con un clic */
  setToken(result){
    const c = GoogleAuthProvider.credentialFromResult(result);
    if (c && c.accessToken){
      this.token = c.accessToken; this.tokenExp = Date.now() + 55 * 60000;
      try{ sessionStorage.setItem('drive-token', JSON.stringify({ t: this.token, e: this.tokenExp, u: result.user.uid })); }catch(e){}
    }
    updateDriveUi();
  },
  loadToken(uid){
    try{ const s = JSON.parse(sessionStorage.getItem('drive-token') || 'null'); if (s && s.u === uid && s.e > Date.now()){ this.token = s.t; this.tokenExp = s.e; } }catch(e){}
  },
  driveReady(){ return !!this.token && Date.now() < this.tokenExp; },
  async connectDrive(){ this.setToken(await reauthenticateWithPopup(auth.currentUser, provider)); },
  async api(url, opts = {}){
    if (!this.driveReady()){ updateDriveUi(); throw { code: 'drive/auth' }; }
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + this.token } });
    if (r.status === 401){ this.token = null; updateDriveUi(); throw { code: 'drive/auth' }; }
    if (r.status === 403){ const t = await r.text(); throw { code: /storageQuota/i.test(t) ? 'drive/quota' : /accessNotConfigured|has not been used|disabled/i.test(t) ? 'drive/api-off' : 'drive/forbidden' }; }
    if (!r.ok) throw { code: 'drive/error', status: r.status };
    return r;
  },
  async createFolder(name, parent){
    const r = await this.api(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
    return (await r.json()).id;
  },
  async rootFolder(){
    if (this._root) return this._root;
    const q = encodeURIComponent(`name='Expedientes' and mimeType='${FOLDER}' and trashed=false and 'root' in parents`);
    const j = await (await this.api(`${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`)).json();
    this._root = (j.files && j.files[0] && j.files[0].id) || await this.createFolder('Expedientes', 'root');
    return this._root;
  },
  async expFolder(x){
    if (!x.driveFolderId) x.driveFolderId = await this.createFolder(clean(`${x.ref} ${titularName(x)}`), await this.rootFolder());
    return x.driveFolderId;
  },
  async upload(file, x, name){
    const parent = await this.expFolder(x);
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, parents: [parent], mimeType: 'application/pdf' })], { type: 'application/json' }));
    form.append('file', file);
    const r = await this.api(`${DRIVE_UP}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form });
    return 'd:' + (await r.json()).id;
  },
  fileUrl(r){ return `https://drive.google.com/file/d/${r.slice(2)}/view`; },
  async getBlob(r){ return (await this.api(`${DRIVE}/files/${r.slice(2)}?alt=media`)).blob(); },
  async _trash(id){ try{ await this.api(`${DRIVE}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }catch(e){} },
  deleteFile(r){ return this._trash(r.slice(2)); },
  trashFolder(x){ return x.driveFolderId ? this._trash(x.driveFolderId) : Promise.resolve(); },
  async saveFile(name, blob){
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); return true;
  }
};
function driveMsg(code){
  return { 'drive/auth': 'Hay que reconectar Google Drive: pulsa "Conectar Google Drive" arriba y vuelve a intentarlo.',
    'drive/quota': 'Tu Google Drive está lleno.', 'drive/api-off': 'La API de Google Drive no está activada en el proyecto (paso de configuración).',
    'drive/forbidden': 'Google Drive ha denegado el acceso.' }[code] || 'No se pudo completar la operación con Google Drive.';
}
function updateDriveUi(){
  const b = $('#driveBtn'); if (!b) return;
  b.hidden = !Store.uid || Store.driveReady();
}
async function ensureDrive(){
  if (Store.driveReady()) return true;
  try{ await Store.connectDrive(); toast('Google Drive conectado.'); return true; }
  catch(e){ toast(e && e.code === 'auth/popup-blocked' ? 'El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes para esta web.' : 'No se pudo conectar con Google Drive.'); return false; }
}
setInterval(updateDriveUi, 60000);

/* ---------- Domain ---------- */
function newTitular(p = {}){ return { id: 't' + rid(), nombre:'', edad:'', nif:'DNI', estadoCivil:'', perfil:'', contrato:'', antiguedad:'', ingresos:'', pagas:'14', tieneFin:'', finCuota:'', finCapital:'', hijos:'', otrosIngresos:'', otrasPropiedades:'', avalistas:'', bancos:'', ...p }; }

function checklist(x){
  const groups = [];
  const op = [{ key:'op:lopd', ...DOCS.lopd }];
  if (x.op.producto === 'hipoteca'){
    op.push({ key:'op:notaSimple', ...DOCS.notaSimple });
    if (x.op.arras) op.push({ key:'op:arras', ...DOCS.arras });
    if (x.op.alquiler) op.push({ key:'op:alquiler', ...DOCS.alquiler });
    if (x.op.tasacion) op.push({ key:'op:tasacion', ...DOCS.tasacion });
  }
  groups.push({ id:'op', title:'Documentos de la operación', folder:'Operacion', items: op });
  x.titulares.forEach((t, i) => {
    const k = d => ({ key: t.id + ':' + d, ...DOCS[d] });
    const it = [k('dni')];
    if (t.perfil === 'ajena' || t.perfil === 'societario') it.push(k('renta1'), k('vidaLaboral'), k('nominas'));
    else if (t.perfil === 'autonomo') it.push(k('renta2'), k('trimIRPF'), k('trimIVA'), k('ivaAnual'), k('vidaLaboral'));
    else if (t.perfil === 'funcionario') it.push(k('renta1'), k('nombramiento'), k('nominas'));
    if (t.tieneFin === 'si' || num(t.finCuota) > 0) it.push(k('recibos'));
    if (t.estadoCivil === 'divorciado' || t.estadoCivil === 'separado'){ it.push(k('sentencia')); if (num(t.hijos) > 0) it.push(k('convenio')); }
    it.push(k('movimientos'));
    const perfil = (PERFILES.find(p => p[0] === t.perfil) || [,'situación laboral sin indicar'])[1];
    groups.push({ id: t.id, title: `Titular ${i + 1}: ${t.nombre || 'sin nombre'}`, sub: perfil, folder: `Titular ${i + 1} - ${clean(t.nombre || 'sin nombre')}`, items: it, noPerfil: !t.perfil });
  });
  return groups;
}
function itemState(x, item){
  const f = (x.files || {})[item.key] || [];
  if (f.length){
    const newest = Math.max(...f.map(z => z.at));
    if (item.validDays && days(newest) > item.validDays) return { s:'stale', age: days(newest) };
    return { s:'ok' };
  }
  if ((x.na || {})[item.key]) return { s:'na' };
  return { s:'pending' };
}
function progress(x){
  let total = 0, done = 0, stale = 0; const pending = [];
  for (const g of checklist(x)) for (const it of g.items){
    total++; const st = itemState(x, it).s;
    if (st !== 'pending') done++; else pending.push({ g, it });
    if (st === 'stale') stale++;
  }
  return { total, done, stale, pending, complete: total > 0 && done === total };
}
function viab(x){
  const o = x.op, T = x.titulares;
  const ingresos = T.reduce((a, t) => a + num(t.ingresos) * (num(t.pagas) || 12) / 12 + num(t.otrosIngresos), 0);
  const otras = T.reduce((a, t) => a + num(t.finCuota), 0);
  const edadMax = Math.max(0, ...T.map(t => num(t.edad)));
  const plazo = num(o.plazo) || (o.producto === 'hipoteca' ? 30 : 8);
  const r = num(o.interes) / 1200, n = plazo * 12;
  let precio = 0, gastos = 0, prestamo = 0, ltv = NaN;
  if (o.producto === 'hipoteca'){
    precio = num(o.precio); gastos = precio * num(o.gastosPct) / 100;
    prestamo = Math.max(0, precio - (num(o.ahorros) - gastos));
    ltv = precio ? prestamo / precio : NaN;
  } else prestamo = num(o.importe);
  const cuota = prestamo ? (r ? prestamo * r / (1 - Math.pow(1 + r, -n)) : prestamo / n) : 0;
  const dti = ingresos ? (cuota + otras) / ingresos : NaN;
  const plazoMaxEdad = edadMax ? Math.max(0, 75 - edadMax) : null;
  return { ingresos, otras, precio, gastos, prestamo, ltv, cuota, dti, plazo, plazoMaxEdad, edadMax };
}
function nextRef(){
  const y = NOW.getFullYear();
  const max = Object.values(S.exps).reduce((m, x) => { const mm = /EXP-(\d{4})-(\d+)/.exec(x.ref || ''); return mm && +mm[1] === y ? Math.max(m, +mm[2]) : m; }, 0);
  return `EXP-${y}-${String(max + 1).padStart(3, '0')}`;
}
function setStage(x, s, auto){
  if (x.stage === s) return;
  x.stage = s; x.stageSince = Date.now(); (x.history ||= []).push({ stage: s, at: Date.now(), auto: !!auto });
}
function autoStage(x){
  const p = progress(x); const any = Object.values(x.files || {}).some(a => a.length);
  if (x.stage === 'nuevo' && any) setStage(x, 'docs', true);
  if ((x.stage === 'nuevo' || x.stage === 'docs') && p.complete){ setStage(x, 'listo', true); toast('Documentación completa. Expediente movido a "Expediente completo".'); }
}

/* ---------- State ---------- */
const S = { exps: {}, view: 'board', openId: null, q: '', loaded: false };
function cur(){ return S.exps[S.openId]; }
let saveT = null;
function touch(x, now){ x.updatedAt = Date.now(); clearTimeout(saveT); if (now) Store.save(x); else saveT = setTimeout(() => Store.save(x), 500); }

function editing(){
  const a = document.activeElement;
  return !!a && a !== document.body && $('#app').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}
function onData(list){
  const incoming = {}; list.forEach(x => incoming[x.id] = x);
  const open = S.view === 'detail' && S.openId && S.exps[S.openId];
  const inc = open && incoming[S.openId];
  // El expediente abierto manda: nunca se sustituye mientras se guarda, mientras escribes
  // o si lo que llega no es más reciente que lo que tienes en pantalla.
  if (open && inc && (Store.busy(open.id) || editing() || (inc.updatedAt || 0) <= (open.updatedAt || 0))) incoming[S.openId] = open;
  if (open && !inc && S.loaded) incoming[S.openId] = open;
  const firstLoad = !S.loaded; S.loaded = true;
  const reRenderDetail = open && inc && incoming[S.openId] !== open;
  S.exps = incoming;
  if (S.view === 'board' || firstLoad) render();
  else if (reRenderDetail) renderDetail(true);
}

/* ---------- Render: board ---------- */
function render(){ if (!Store.uid) return; S.view === 'detail' && cur() ? renderDetail() : renderBoard(); }

function renderBoard(){
  S.view = 'board'; S.openId = null;
  const all = Object.values(S.exps).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const q = S.q.trim().toLowerCase();
  const list = q ? all.filter(x => [x.ref, x.op.municipio, x.op.email, x.op.telefono, ...x.titulares.map(t => t.nombre)].join(' ').toLowerCase().includes(q)) : all;
  const activos = all.filter(x => !CLOSED.includes(x.stage));
  const conPend = activos.filter(x => !progress(x).complete).length;
  const revisar = activos.reduce((a, x) => a + progress(x).stale, 0);
  const parados = activos.filter(x => days(x.stageSince || x.createdAt) > 7).length;
  const app = $('#app');
  if (!S.loaded){ app.innerHTML = '<p class="hint" style="padding:40px 0;text-align:center">Cargando expedientes…</p>'; return; }
  if (!all.length){
    app.innerHTML = `<div class="board-empty"><h2>Aún no hay expedientes</h2><p>Responde unas preguntas y te diré qué documentación pedir para cada titular.</p><p><button class="btn primary" data-act="new">Crear el primer expediente</button></p></div>`;
    return;
  }
  app.innerHTML = `
    <div class="today">
      <div><strong class="num">${activos.length}</strong><span>expedientes activos</span></div>
      <div class="${conPend ? 'warn' : ''}"><strong class="num">${conPend}</strong><span>con documentación pendiente</span></div>
      <div class="${revisar ? 'warn' : ''}"><strong class="num">${revisar}</strong><span>documentos por revisar vigencia</span></div>
      <div class="${parados ? 'bad' : ''}"><strong class="num">${parados}</strong><span>parados más de 7 días</span></div>
    </div>
    <div class="board">${STAGES.map(([s, label]) => {
      const cards = list.filter(x => x.stage === s);
      return `<section class="col" data-stage="${s}" aria-label="${esc(label)}"><h3>${esc(label)}<span class="num">${cards.length}</span></h3>
        ${cards.map(cardHtml).join('') || `<div class="empty">${q ? 'Sin resultados' : 'Arrastra aquí un expediente'}</div>`}</section>`;
    }).join('')}</div>`;
}
function cardHtml(x){
  const p = progress(x), v = viab(x), d = days(x.stageSince || x.createdAt);
  const tags = [];
  if (p.stale) tags.push(`<span class="tag warn">${p.stale} por revisar</span>`);
  if (!CLOSED.includes(x.stage) && d > 7) tags.push(`<span class="tag bad">${d} días en esta fase</span>`);
  else if (!CLOSED.includes(x.stage)) tags.push(`<span class="tag">${d === 0 ? 'Hoy' : d === 1 ? '1 día' : d + ' días'} en esta fase</span>`);
  if (isFinite(v.dti) && v.dti > .40) tags.push(`<span class="tag bad">Endeudamiento ${pct(v.dti)}</span>`);
  const amount = x.op.producto === 'hipoteca' ? (num(x.op.precio) ? eur(num(x.op.precio)) : '') : (num(x.op.importe) ? eur(num(x.op.importe)) : '');
  return `<article class="card" draggable="true" data-id="${esc(x.id)}" data-ref="${esc(x.ref)}" tabindex="0">
    <h4>${esc(titularName(x))}${x.titulares.length > 1 ? ` <span class="sub">+${x.titulares.length - 1}</span>` : ''}</h4>
    <div class="sub">${x.op.producto === 'hipoteca' ? 'Hipoteca' : 'Préstamo personal'}${amount ? ', ' + amount : ''}${x.op.municipio ? ', ' + esc(x.op.municipio) : ''}</div>
    <div class="bar${p.complete ? ' done' : ''}"><i style="width:${p.total ? p.done / p.total * 100 : 0}%"></i></div>
    <div class="meta"><span class="num">${p.done} de ${p.total} documentos</span>${p.complete ? '<span style="color:var(--ok);font-weight:600">Completo</span>' : ''}</div>
    <div class="tags">${tags.join('')}</div>
  </article>`;
}

/* ---------- Render: detail ---------- */
function renderDetail(keepScroll){
  const x = cur(); if (!x) return renderBoard();
  S.view = 'detail';
  const y = window.scrollY;
  const o = x.op, hip = o.producto === 'hipoteca';
  const f = (path, label, type = 'text', extra = '') => {
    const v = o[path] ?? '';
    return `<div class="f"><label for="op-${path}">${label}</label><input id="op-${path}" data-op="${path}" type="${type}" value="${esc(v)}" ${type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''} ${extra}></div>`;
  };
  const sel = (path, label, list) => `<div class="f"><label for="op-${path}">${label}</label><select id="op-${path}" data-op="${path}">${opts(list, o[path])}</select></div>`;
  $('#app').innerHTML = `
    <p style="margin:0"><button class="btn ghost small" data-act="back">&larr; Volver al tablero</button></p>
    <section class="folder">
      <div class="ref">${esc(x.ref)}</div>
      <div class="folder-head">
        <div class="grow"><h1 id="dTitle">${esc(x.titulares.map(t => t.nombre).filter(Boolean).join(' y ') || 'Expediente sin nombre')}</h1>
          <p id="dSub"></p></div>
        <label class="stage-pick">Fase<select id="stageSel">${opts(STAGES, x.stage, false)}</select></label>
      </div>
      <div class="folder-edge" id="edge"><i></i></div>
    </section>
    <div class="detail">
      <div>
        <section class="sec" id="s1">
          <h2>1. Datos básicos de la operación</h2>
          <div class="fields">
            <div class="f"><label for="op-producto">Producto</label><select id="op-producto" data-op="producto">${opts([['hipoteca','Hipoteca'],['prestamo','Préstamo personal']], o.producto, false)}</select></div>
            ${hip ? sel('tipo','Tipo de operación de financiación hipotecaria', TIPOS_HIP) + f('precio','Precio de compraventa (€)','number') + f('ahorros','Ahorros a aportar (€)','number')
                  : f('importe','Importe solicitado (€)','number') + f('finalidad','Finalidad del préstamo')}
            ${sel('ccaa','Comunidad Autónoma', CCAA)}
            ${f('municipio', hip ? 'Municipio de la compraventa' : 'Municipio')}
            ${hip ? sel('tipologia','Tipología del inmueble', TIPOLOGIAS) : ''}
            ${f('telefono','Teléfono de contacto','tel','autocomplete="off"')}
            ${f('email','Correo electrónico de contacto','email','autocomplete="off"')}
          </div>
          ${hip ? `<div class="checks">
            <label><input type="checkbox" data-opc="arras" ${o.arras ? 'checked' : ''}> Hay contrato de arras</label>
            <label><input type="checkbox" data-opc="alquiler" ${o.alquiler ? 'checked' : ''}> Es alquiler con opción a compra</label>
            <label><input type="checkbox" data-opc="tasacion" ${o.tasacion ? 'checked' : ''}> Ya hay tasación</label>
          </div>` : ''}
        </section>
        <section class="sec" id="s2">
          <h2>2. Datos de los titulares</h2>
          <p class="lead">Una columna por cada titular. Las filas marcadas en azul cambian la documentación que se pide.</p>
          ${titTable(x)}
          ${x.titulares.length < 4 ? '<button class="btn small addt" data-act="addTit">Añadir titular</button>' : ''}
        </section>
        <section class="sec" id="s3">
          <h2>3. Documentación necesaria</h2>
          <p class="lopd-note">Todas las operaciones deben tener el documento de LOPD firmado para poder tramitarse.</p>
          <p class="lead">Solo se admiten archivos PDF. Puedes subir varios por documento o arrastrarlos encima de la línea.</p>
          <div id="checklist"></div>
        </section>
        <section class="sec" id="s4">
          <h2>4. Notas</h2>
          <textarea id="notas" placeholder="Observaciones, condiciones del banco, llamadas pendientes…">${esc(x.notas || '')}</textarea>
        </section>
      </div>
      <aside class="side" id="side"></aside>
    </div>`;
  refreshDerived();
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
}

const TROWS = [
  ['nombre','Datos del titular','text'],
  ['edad','Edad','number'],
  ['nif','Tipo de NIF (DNI / NIE)','select',['DNI','NIE']],
  ['estadoCivil','Estado civil','select',ESTADOS,1],
  ['perfil','Situación laboral','select',PERFILES,1],
  ['contrato','Tipo de contrato','select',CONTRATOS],
  ['antiguedad','Antigüedad (empresa / actividad)','text'],
  ['ingresos','Ingresos netos mensuales (€)','number'],
  ['pagas','Número de pagas','select',['12','14','15','16']],
  ['tieneFin','Tiene otras financiaciones','select',[['no','No'],['si','Sí']],1],
  ['finCuota','Otras financiaciones: importe mensual (€)','number',null,1],
  ['finCapital','Otras financiaciones: capital pendiente (€)','number'],
  ['hijos','Hijos menores a cargo','number',null,1],
  ['otrosIngresos','Otros ingresos (€ al mes)','number'],
  ['otrasPropiedades','Otras propiedades','text'],
  ['avalistas','Posibilidad de avalistas','select',['Sí','No']],
  ['bancos','Banco/s con los que trabaja','text']
];
function titTable(x){
  const T = x.titulares;
  const head = `<thead><tr><th scope="col">Titular</th>${T.map((t, i) => `<td><div class="colhead">Titular ${i + 1}${T.length > 1 ? `<button class="btn ghost small danger" data-act="delTit" data-tid="${t.id}">Quitar</button>` : ''}</div></td>`).join('')}</tr></thead>`;
  const rows = TROWS.map(([k, label, type, list, key]) => `<tr class="${key ? 'key' : ''}"><th scope="row">${label}</th>${T.map(t => {
    const id = `t-${t.id}-${k}`;
    const ctl = type === 'select'
      ? `<select id="${id}" data-tid="${t.id}" data-tk="${k}" aria-label="${esc(label)}">${opts(list, t[k])}</select>`
      : `<input id="${id}" data-tid="${t.id}" data-tk="${k}" type="${type}" value="${esc(t[k])}" aria-label="${esc(label)}" ${type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''}>`;
    return `<td class="cell">${ctl}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="tscroll"><table class="tit">${head}<tbody>${rows}</tbody></table></div>`;
}

function refreshDerived(){
  const x = cur(); if (!x) return;
  const p = progress(x), v = viab(x), hip = x.op.producto === 'hipoteca';
  $('#dTitle').textContent = x.titulares.map(t => t.nombre).filter(Boolean).join(' y ') || 'Expediente sin nombre';
  $('#dSub').textContent = `${hip ? (x.op.tipo || 'Hipoteca') : 'Préstamo personal'}${x.op.municipio ? ', ' + x.op.municipio : ''}. Creado el ${new Date(x.createdAt).toLocaleDateString('es-ES')}.`;
  const edge = $('#edge'); edge.classList.toggle('done', p.complete); edge.firstElementChild.style.width = (p.total ? p.done / p.total * 100 : 0) + '%';
  $('#stageSel').value = x.stage;

  /* checklist */
  $('#checklist').innerHTML = checklist(x).map(g => {
    const gd = g.items.filter(it => itemState(x, it).s !== 'pending').length;
    return `<div class="group"><h3>${esc(g.title)}<span class="num">${gd} de ${g.items.length}</span></h3>
      ${g.sub ? `<div class="hint" style="margin:-4px 0 6px">${esc(g.sub)}${g.noPerfil ? '. Indícala en la tabla de titulares para ver toda su documentación.' : ''}</div>` : ''}
      ${g.items.map(it => itemHtml(x, it)).join('')}</div>`;
  }).join('');

  /* side */
  const assumeOpen = !!document.querySelector('.assume[open]');
  $('#side').innerHTML = `
    <div class="panel">
      <h2>Documentación</h2>
      <div class="prog-num num">${p.done}<small> de ${p.total} documentos</small></div>
      ${p.stale ? `<p class="hint warn" style="margin:6px 0 0">${p.stale} documento${p.stale > 1 ? 's' : ''} con más antigüedad de la recomendada.</p>` : ''}
      ${p.pending.length ? `<ul class="pending-list">${p.pending.slice(0, 5).map(z => `<li>${esc(z.it.file)}${z.g.id !== 'op' && !z.g.title.endsWith('sin nombre') ? ' (' + esc(z.g.title.split(': ')[1] || '') + ')' : ''}</li>`).join('')}${p.pending.length > 5 ? `<li>y ${p.pending.length - 5} más</li>` : ''}</ul>` : ''}
      <div class="stack">
        <button class="btn primary" data-act="zip">Descargar expediente (.zip)</button>
        <button class="btn" data-act="resumen">Descargar resumen (PDF)</button>
        ${p.complete ? '' : `<p class="hint" style="margin:0;text-align:center">Faltan ${p.pending.length} documento${p.pending.length === 1 ? '' : 's'}. Aparecerán como pendientes en el resumen.</p>`}
        ${(x.envios || []).length ? (() => { const e = x.envios[x.envios.length - 1]; return `<p class="hint" style="margin:0;text-align:center">Última descarga: ${new Date(e.at).toLocaleString('es-ES', { dateStyle:'short', timeStyle:'short' })}, con ${e.aportados} de ${e.total} documentos.</p>`; })() : ''}
        <button class="btn" data-act="msg" ${p.pending.length ? '' : 'disabled'}>Pedir documentación pendiente</button>
      </div>
    </div>
    <div class="panel">
      <h2>Números de la operación</h2>
      ${viabHtml(x, v, hip)}
      <details class="assume"${assumeOpen ? ' open' : ''}>
        <summary>Ajustar supuestos del cálculo</summary>
        <div class="params">
          ${hip ? `<div class="f"><label for="p-g">Gastos %</label><input id="p-g" data-op="gastosPct" type="number" step="0.5" min="0" inputmode="decimal" value="${esc(x.op.gastosPct)}"></div>` : ''}
          <div class="f"><label for="p-i">Interés %</label><input id="p-i" data-op="interes" type="number" step="0.05" min="0" inputmode="decimal" value="${esc(x.op.interes)}"></div>
          <div class="f"><label for="p-p">Plazo años</label><input id="p-p" data-op="plazo" type="number" step="1" min="1" inputmode="numeric" value="${esc(x.op.plazo)}"></div>
        </div>
      </details>
      <p class="fine">Orientativo y solo para ti: no se incluye en el resumen del broker.</p>
    </div>
    <div class="panel">
      <h2>Expediente</h2>
      <p class="hint" style="margin:0 0 10px">En "${esc(STAGE[x.stage])}" desde hace ${days(x.stageSince || x.createdAt)} día${days(x.stageSince || x.createdAt) === 1 ? '' : 's'}.</p>
      <button class="btn small danger" data-act="delExp">Eliminar expediente</button>
    </div>`;
}
function meter(label, val, max, a, b, empty, note){
  const ok = isFinite(val);
  const cls = !ok ? '' : val > b ? 'bad' : val > a ? 'warn' : 'ok';
  const pos = v => Math.min(100, Math.max(0, v / max * 100));
  return `<div class="meter-block">
    <div class="meter-head"><span>${label}</span><strong class="num ${cls}">${ok ? pct(val) : '—'}</strong></div>
    <div class="meter" style="--a:${pos(a)}%;--b:${pos(b)}%" role="img" aria-label="${esc(label)}: ${ok ? pct(val) : 'sin datos'}">
      ${ok ? `<i style="left:${pos(val)}%"></i>` : ''}
    </div>
    <div class="meter-scale num"><span style="left:${pos(a)}%">${Math.round(a * 100)} %</span><span style="left:${pos(b)}%">${Math.round(b * 100)} %</span></div>
    <p class="meter-note">${ok ? note : empty}</p>
  </div>`;
}
function viabHtml(x, v, hip){
  let h = '';
  if (hip){
    const total = v.precio + v.gastos, aport = Math.min(num(x.op.ahorros), total);
    if (v.precio){
      const wA = total ? aport / total * 100 : 0;
      h += `<div class="cover">
        <div class="meter-head"><span>Cómo se paga la compra</span><strong class="num">${eur(total)}</strong></div>
        <div class="stackbar" role="img" aria-label="Ahorros ${eur(aport)}, a financiar ${eur(v.prestamo)}">
          <i class="sa" style="width:${wA}%"></i><i class="sb" style="width:${100 - wA}%"></i>
        </div>
        <div class="legend num"><span><b class="dot sa"></b>Ahorros ${eur(aport)}</span><span><b class="dot sb"></b>A financiar ${eur(v.prestamo)}</span></div>
        <p class="meter-note">Precio ${eur(v.precio)} más ${eur(v.gastos)} de gastos estimados.${num(x.op.ahorros) < v.gastos ? ' <span class="warn-t">Los ahorros no cubren ni los gastos.</span>' : ''}</p>
      </div>`;
    } else h += '<p class="meter-note" style="margin:0 0 14px">Añade el precio de compraventa y los ahorros para ver cómo se reparte la compra.</p>';
    h += meter('Financiación sobre el precio', v.ltv, 1, .8, .9, 'Falta el precio de compraventa.',
      !isFinite(v.ltv) ? '' : v.ltv > .9 ? 'Muy por encima de lo habitual: normalmente se financia hasta el 80 %.' : v.ltv > .8 ? 'Por encima del 80 % habitual; pocas entidades llegan a este nivel.' : 'Dentro del 80 % que suelen financiar los bancos.');
  }
  h += meter('Endeudamiento con la nueva cuota', v.dti, .6, .35, .4, 'Faltan los ingresos de los titulares.',
    !isFinite(v.dti) ? '' : `Cuotas ${eur(v.cuota + v.otras)} al mes sobre ingresos de ${eur(v.ingresos)} al mes.`);
  const plazoWarn = v.plazoMaxEdad !== null && v.plazo > v.plazoMaxEdad;
  h += `<div class="cuota"><div><span>Cuota estimada</span><strong class="num">${v.prestamo ? eur(v.cuota) : '—'}<small> al mes</small></strong></div>
    <p class="meter-note">${esc(String(x.op.interes || 0).replace('.', ','))} % a ${v.plazo} años${v.plazoMaxEdad !== null ? `. <span class="${plazoWarn ? 'warn-t' : ''}">Plazo máximo por edad: ${v.plazoMaxEdad} años.</span>` : '.'}</p></div>`;
  return h;
}
function itemHtml(x, it){
  const st = itemState(x, it); const files = (x.files || {})[it.key] || [];
  const box = st.s === 'ok' ? '✓' : st.s === 'stale' ? '!' : st.s === 'na' ? '–' : '';
  const status = st.s === 'ok' ? 'Subido' : st.s === 'stale' ? 'Revisar vigencia' : st.s === 'na' ? 'No aplica' : 'Pendiente';
  return `<div class="item ${st.s}" data-key="${esc(it.key)}">
    <div class="box" aria-hidden="true">${box}</div>
    <div><div class="lbl">${esc(it.label)}<span class="sr">: ${status}</span></div>
      ${it.hint ? `<div class="hint">${esc(it.hint)}</div>` : ''}
      ${st.s === 'stale' ? `<div class="hint warn">Subido hace ${st.age} días. Comprueba que sigue vigente o sube uno nuevo.</div>` : ''}
      ${files.length ? `<ul class="files">${files.map((fl, i) => `<li>${`<a href="#" data-act="open" data-key="${esc(it.key)}" data-i="${i}">${esc(fl.name)}</a>`}<span class="hint num">${kb(fl.size)}, ${new Date(fl.at).toLocaleDateString('es-ES')}</span><button class="x" data-act="delFile" data-key="${esc(it.key)}" data-i="${i}" aria-label="Quitar ${esc(fl.name)}">×</button></li>`).join('')}</ul>` : ''}
    </div>
    <div class="acts">
      ${files.length ? '' : `<button class="btn ghost small" data-act="na" data-key="${esc(it.key)}">${st.s === 'na' ? 'Sí aplica' : 'No aplica'}</button>`}
      <button class="btn small" data-act="up" data-key="${esc(it.key)}">${files.length ? 'Añadir PDF' : 'Subir PDF'}</button>
    </div>
  </div>`;
}

/* ---------- Uploads ---------- */
async function isPdf(file){
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return false;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const s = String.fromCharCode(...head);
  return s.includes('%PDF-');
}
async function addFiles(key, fileList){
  const x = cur(); if (!x) return;
  if (!Store.driveReady()){ toast('Conecta Google Drive (botón de arriba) y vuelve a subir el archivo.'); updateDriveUi(); return; }
  const g = checklist(x).find(z => z.items.some(it => it.key === key)); const it = g && g.items.find(z => z.key === key);
  const baseName = `${g ? (g.id === 'op' ? 'Operacion' : g.folder) : 'Documento'} - ${it ? it.file : 'PDF'}`;
  const files = [...fileList]; let ok = 0;
  for (const file of files){
    if (!(await isPdf(file))){ toast(`"${file.name}" no es un PDF. Solo se admiten archivos PDF.`); continue; }
    if (file.size > 20 * 1048576){ toast(`"${file.name}" pesa más de 20 MB. Comprímelo antes de subirlo.`); continue; }
    try{
      toast(`Subiendo ${file.name}…`);
      const ref = await Store.upload(file, x, `${baseName}.pdf`);
      ((x.files ||= {})[key] ||= []).push({ ref, name: file.name, size: file.size, at: Date.now() });
      if (x.na) delete x.na[key];
      ok++;
    }catch(e){
      toast(driveMsg(e && e.code)); if (e && e.code === 'drive/auth') break;
    }
  }
  if (ok || x.driveFolderId){ autoStage(x); touch(x, true); refreshDerived(); if (ok) toast(ok === 1 ? 'PDF subido a tu Drive.' : `${ok} PDF subidos a tu Drive.`); }
}

/* ---------- ZIP y ficha ---------- */
function resumenPdf(x){
  const { jsPDF } = window.jspdf; const d = new jsPDF({ unit:'mm', format:'a4' });
  const W = 210, M = 16, INK = [21,44,68], BRAND = [31,78,121], STEEL = [221,231,241], MUTED = [81,101,122];
  const OK = [43,117,85], WARN = [143,92,14], BAD = [163,55,45];
  const o = x.op, hip = o.producto === 'hipoteca', p = progress(x), v = viab(x);
  const money = n => has(n) && isFinite(num(n)) ? new Intl.NumberFormat('es-ES',{maximumFractionDigits:0}).format(num(n)) + ' EUR' : '-';
  const pc = n => isFinite(n) ? (n * 100).toFixed(1).replace('.', ',') + ' %' : '-';
  const val = v2 => has(v2) ? String(v2) : '-';
  const lbl = (list, v2) => (list.find(z => z[0] === v2) || [, v2])[1];
  const fecha = new Date();
  const fechaTxt = fecha.toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' }) + ', ' + fecha.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
  let y = 0;
  const brk = h => { if (y + h > 280){ d.addPage(); y = 20; } };
  const section = t => { brk(20); d.setFont('helvetica','bold'); d.setFontSize(12.5); d.setTextColor(...INK); d.text(t, M, y); y += 2; d.setDrawColor(...INK); d.setLineWidth(.5); d.line(M, y, W - M, y); y += 4; };
  const base = { margin:{ left:M, right:M, top:18, bottom:18 }, theme:'grid',
    styles:{ font:'helvetica', fontSize:9, textColor:INK, lineColor:[200,212,224], lineWidth:.2, cellPadding:2.2, overflow:'linebreak', valign:'middle' },
    headStyles:{ fillColor:BRAND, textColor:255, fontStyle:'bold' } };
  const table = opts => { d.autoTable({ ...base, startY: y, ...opts }); y = d.lastAutoTable.finalY + 8; };
  const kv = rows => table({ body: rows, columnStyles:{ 0:{ cellWidth:70, fillColor:STEEL, fontStyle:'bold' } } });

  /* Cabecera */
  d.setFillColor(...BRAND); d.rect(0, 0, W, 34, 'F');
  d.setTextColor(255); d.setFont('helvetica','bold'); d.setFontSize(18);
  d.text('Resumen del expediente', M, 15);
  d.setFontSize(11); d.text(x.ref, W - M, 15, { align:'right' });
  d.setFont('helvetica','normal'); d.setFontSize(10);
  d.text(`${x.titulares.map(t => t.nombre).filter(Boolean).join(' y ') || 'Titulares sin nombre'}`, M, 23);
  d.text(`${hip ? (o.tipo || 'Hipoteca') : 'Préstamo personal'}. Fase: ${STAGE[x.stage]}.`, M, 29);
  d.text(`Generado el ${fechaTxt}`, W - M, 29, { align:'right' });
  y = 44;

  /* Estado de la documentación */
  d.setTextColor(...INK); d.setFont('helvetica','bold'); d.setFontSize(11);
  const aport = checklist(x).reduce((a, g) => a + g.items.filter(it => ['ok','stale'].includes(itemState(x, it).s)).length, 0);
  const noAplica = p.total - p.pending.length - aport;
  d.text(`Documentación aportada: ${aport} de ${p.total}${noAplica ? ` (${noAplica} no aplica${noAplica > 1 ? 'n' : ''})` : ''}`, M, y);
  d.setFont('helvetica','normal'); d.setFontSize(9.5); d.setTextColor(...MUTED);
  const estadoTxt = p.complete ? 'Expediente completo.' : `Faltan ${p.pending.length} documento${p.pending.length === 1 ? '' : 's'}, marcados como pendientes en el apartado 3.`;
  d.text(estadoTxt + (p.stale ? ` ${p.stale} con antigüedad a revisar.` : ''), W - M, y, { align:'right' });
  y += 3; d.setFillColor(...STEEL); d.rect(M, y, W - 2 * M, 3, 'F');
  d.setFillColor(...(p.complete ? OK : BRAND)); d.rect(M, y, (W - 2 * M) * (p.total ? (p.total - p.pending.length) / p.total : 0), 3, 'F');
  y += 11;

  /* 1. Operación */
  section('1. Datos básicos de la operación');
  const opRows = [['Producto', hip ? 'Hipoteca' : 'Préstamo personal']];
  if (hip) opRows.push(['Tipo de operación', val(o.tipo)], ['Precio de compraventa', money(o.precio)], ['Ahorros a aportar', money(o.ahorros)]);
  else opRows.push(['Importe solicitado', money(o.importe)], ['Finalidad', val(o.finalidad)]);
  opRows.push(['Comunidad Autónoma', val(o.ccaa)], [hip ? 'Municipio de la compraventa' : 'Municipio', val(o.municipio)]);
  if (hip) opRows.push(['Tipología del inmueble', val(o.tipologia)],
    ['Situaciones de la operación', [o.arras && 'Contrato de arras', o.alquiler && 'Alquiler con opción a compra', o.tasacion && 'Tasación realizada'].filter(Boolean).join(', ') || 'Ninguna']);
  opRows.push(['Teléfono de contacto', val(o.telefono)], ['Correo electrónico de contacto', val(o.email)]);
  kv(opRows);

  /* 2. Titulares */
  section('2. Datos de los titulares');
  const tv = (t, k, type, list) => {
    let v2 = t[k];
    if (list && Array.isArray(list[0])) v2 = lbl(list, v2);
    if (type === 'number' && /€/.test(TROWS.find(r => r[0] === k)[1])) return money(v2);
    return val(v2);
  };
  table({
    head: [['', ...x.titulares.map((_, i) => `Titular ${i + 1}`)]],
    body: TROWS.map(([k, label, type, list]) => [label.replace(' (€)', '').replace(' (€ al mes)', ' (al mes)'), ...x.titulares.map(t => tv(t, k, type, list))]),
    columnStyles:{ 0:{ cellWidth:62, fillColor:STEEL, fontStyle:'bold' } }
  });

  /* 4. Documentación */
  section('3. Documentación del expediente');
  d.setFont('helvetica','normal'); d.setFontSize(9); d.setTextColor(...MUTED);
  d.text(`Situación a ${fechaTxt}. Los documentos marcados como aportados se incluyen en la carpeta del expediente.`, M, y); y += 5;
  checklist(x).forEach((g, gi) => {
    const rows = g.items.map(it => {
      const st = itemState(x, it); const files = (x.files || {})[it.key] || [];
      const estado = st.s === 'ok' ? 'Aportado' : st.s === 'stale' ? 'Aportado, revisar vigencia' : st.s === 'na' ? 'No aplica' : 'Pendiente';
      const arch = files.length ? files.map((f, i) => `${clean(it.file)}${files.length > 1 ? ` (${i + 1})` : ''}.pdf, ${new Date(f.at).toLocaleDateString('es-ES')}`).join('\n') : '-';
      return [estado, it.label, arch];
    });
    brk(24);
    table({
      head: [[{ content: `${g.title}${g.sub ? '  (' + g.sub + ')' : ''}`, colSpan: 3 }], ['Estado', 'Documento', 'Archivo en la carpeta']],
      body: rows,
      columnStyles:{ 0:{ cellWidth:34, fontStyle:'bold' }, 2:{ cellWidth:58, fontSize:8 } },
      didParseCell: h => {
        if (h.section === 'head' && h.row.index === 1){ h.cell.styles.fillColor = STEEL; h.cell.styles.textColor = INK; }
        if (h.section === 'body' && h.column.index === 0){
          const t = h.cell.raw; h.cell.styles.textColor = t === 'Aportado' ? OK : t === 'Pendiente' ? BAD : t === 'No aplica' ? MUTED : WARN;
        }
      }
    });
    y -= 3;
  });
  y += 3;
  /* 5. Notas */
  section('4. Notas');
  d.setFont('helvetica','normal'); d.setFontSize(9.5); d.setTextColor(...INK);
  d.splitTextToSize(x.notas || 'Sin notas.', W - 2 * M).forEach(l => { brk(5); d.text(l, M, y); y += 4.8; });

  /* Pie */
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++){
    d.setPage(i); d.setFont('helvetica','normal'); d.setFontSize(8); d.setTextColor(...MUTED);
    d.text(`${x.ref}. Resumen generado el ${fechaTxt}.`, M, 290);
    d.text(`Página ${i} de ${n}`, W - M, 290, { align:'right' });
  }
  return d.output('blob');
}
function registrarEnvio(x, tipo){
  const p = progress(x);
  const aportados = checklist(x).reduce((a, g) => a + g.items.filter(it => ['ok','stale'].includes(itemState(x, it).s)).length, 0);
  (x.envios ||= []).push({ at: Date.now(), tipo, aportados, total: p.total });
  touch(x, true); refreshDerived();
}
function libsOk(){
  if (!window.JSZip || !window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable){ toast('No se han podido cargar las herramientas de descarga. Recarga la página.'); return false; }
  return true;
}
async function downloadResumen(){
  const x = cur(); if (!x || !libsOk()) return;
  const name = clean(`${x.ref} ${titularName(x)}`) + ' - Resumen.pdf';
  if (await Store.saveFile(name, resumenPdf(x))){ registrarEnvio(x, 'resumen'); toast('Resumen descargado.'); }
}
async function downloadZip(){
  const x = cur(); if (!x || !libsOk()) return;
  const hasFiles = Object.values(x.files || {}).some(a => a.length);
  if (hasFiles && !(await ensureDrive())) return;
  toast('Preparando el expediente…');
  const base = clean(`${x.ref} ${titularName(x)}`);
  const zip = new JSZip(); const root = zip.folder(base);
  root.file('00 Resumen del expediente.pdf', resumenPdf(x));
  let missing = 0; const groups = checklist(x);
  for (let gi = 0; gi < groups.length; gi++){
    const g = groups[gi];
    const withFiles = g.items.filter(it => ((x.files || {})[it.key] || []).length);
    if (!withFiles.length) continue;
    const sub = root.folder(`${String(gi + 1).padStart(2, '0')} ${g.folder}`);
    for (const it of withFiles){
      const files = x.files[it.key];
      for (let i = 0; i < files.length; i++){
        try{ sub.file(`${clean(it.file)}${files.length > 1 ? ` (${i + 1})` : ''}.pdf`, await Store.getBlob(files[i].ref)); }
        catch(e){ missing++; }
      }
    }
  }
  const blob = await zip.generateAsync({ type:'blob' });
  if (await Store.saveFile(base + '.zip', blob)){
    registrarEnvio(x, 'zip');
    toast(missing ? `Descargado, pero ${missing} archivo${missing > 1 ? 's' : ''} no se pudo recuperar. Revisa la conexión con Google Drive.` : 'Expediente descargado.');
  }
}

/* ---------- Mensaje al cliente ---------- */
function pendingMessage(x){
  const p = progress(x); const first = (titularName(x) || '').split(' ')[0];
  const byGroup = {};
  p.pending.forEach(({ g, it }) => (byGroup[g.id] ||= { g, items: [] }).items.push(it));
  let t = `Hola${first && first !== 'Sin' ? ' ' + first : ''}, para seguir con tu ${x.op.producto === 'hipoteca' ? 'hipoteca' : 'préstamo'} necesito la siguiente documentación en PDF:\n`;
  Object.values(byGroup).forEach(({ g, items }) => {
    t += `\n${g.id === 'op' ? 'De la operación' : (g.title.split(': ')[1] && g.title.split(': ')[1] !== 'sin nombre' ? 'De ' + g.title.split(': ')[1] : g.title)}:\n`;
    items.forEach(it => { t += `- ${it.label}${it.hint && it.key !== 'op:lopd' ? ' (' + it.hint.toLowerCase() + ')' : ''}\n`; });
  });
  return t + '\nCuando lo tengas, me lo envías por aquí. ¡Gracias!';
}
function openMessage(){
  const x = cur(); const msg = pendingMessage(x);
  const phone = (x.op.telefono || '').replace(/\D/g, ''); const wa = phone ? (phone.length === 9 ? '34' + phone : phone) : '';
  $('#dlgIn').innerHTML = `
    <div class="dlg-head"><h2>Pedir documentación pendiente</h2><p>Revisa el texto y envíalo por el canal que prefieras.</p></div>
    <div class="dlg-body"><textarea id="msgTxt" style="min-height:260px">${esc(msg)}</textarea></div>
    <div class="dlg-foot"><button class="btn" data-act="close">Cerrar</button>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        ${x.op.email ? `<a class="btn" id="mailA" target="_blank" rel="noopener" href="mailto:${esc(x.op.email)}">Correo</a>` : ''}
        ${wa ? `<a class="btn" id="waA" target="_blank" rel="noopener" href="#">WhatsApp</a>` : ''}
        <button class="btn primary" data-act="copyMsg">Copiar texto</button></span></div>`;
  const sync = () => { const v = $('#msgTxt').value;
    if ($('#waA')) $('#waA').href = `https://wa.me/${wa}?text=${encodeURIComponent(v)}`;
    if ($('#mailA')) $('#mailA').href = `mailto:${x.op.email}?subject=${encodeURIComponent('Documentación pendiente ' + x.ref)}&body=${encodeURIComponent(v)}`; };
  $('#msgTxt').addEventListener('input', sync); sync();
  $('#dlg').showModal();
}

/* ---------- Asistente de nuevo expediente ---------- */
let W = null;
function openWizard(){
  W = { step: 0, producto: '', n: 0, tits: [], arras: null, alquiler: null, tasacion: null, err: '' };
  drawWizard(); $('#dlg').showModal();
}
function wSteps(){ return W.producto === 'prestamo' ? ['producto','n','tits','res'] : ['producto','n','tits','op','res']; }
function chip(group, val, label, pressed, small = ''){ return `<button type="button" class="chip" data-w="${group}" data-v="${esc(val)}" aria-pressed="${pressed}">${esc(label)}${small ? `<small>${esc(small)}</small>` : ''}</button>`; }
function wExp(){
  return { op: { producto: W.producto || 'hipoteca', arras: !!W.arras, alquiler: !!W.alquiler, tasacion: !!W.tasacion }, titulares: W.tits.map(t => newTitular(t)), files: {}, na: {} };
}
function drawWizard(){
  const steps = wSteps(); const s = steps[W.step];
  let body = '';
  if (s === 'producto') body = `<div class="q"><p>¿Qué vas a tramitar?</p><div class="chips">
      ${chip('producto','hipoteca','Hipoteca', W.producto === 'hipoteca','Compra, cambio de banco…')}
      ${chip('producto','prestamo','Préstamo personal', W.producto === 'prestamo','Sin garantía hipotecaria')}</div></div>`;
  if (s === 'n') body = `<div class="q"><p>¿Cuántos titulares tendrá la operación?</p><div class="chips">${[1,2,3,4].map(n => chip('n', n, String(n), W.n === n)).join('')}</div></div>`;
  if (s === 'tits') body = W.tits.map((t, i) => `<div class="tblock"><h3>Titular ${i + 1}</h3>
      <div class="q"><div class="f"><label for="wn${i}">Nombre y apellidos</label><input id="wn${i}" data-wt="${i}" data-k="nombre" value="${esc(t.nombre)}" autocomplete="off"></div></div>
      <div class="q"><p>Situación laboral</p><div class="chips">${PERFILES.map(([v, l]) => chip('perfil:' + i, v, l, t.perfil === v)).join('')}</div></div>
      <div class="q"><p>Estado civil</p><div class="chips">${ESTADOS.map(([v, l]) => chip('estadoCivil:' + i, v, l, t.estadoCivil === v)).join('')}</div></div>
      ${t.estadoCivil === 'divorciado' || t.estadoCivil === 'separado' ? `<div class="q"><p>¿Tiene hijos menores a cargo?</p><div class="chips">${chip('hijos:' + i, '1', 'Sí', t.hijos === '1')}${chip('hijos:' + i, '0', 'No', t.hijos === '0')}</div></div>` : ''}
      <div class="q" style="margin-bottom:0"><p>¿Tiene otras financiaciones en activo? (préstamos, tarjetas, coche…)</p><div class="chips">${chip('tieneFin:' + i, 'si', 'Sí', t.tieneFin === 'si')}${chip('tieneFin:' + i, 'no', 'No', t.tieneFin === 'no')}</div></div>
    </div>`).join('');
  if (s === 'op') body = [['arras','¿Hay contrato de arras firmado?'],['alquiler','¿Es un alquiler con opción a compra?'],['tasacion','¿Ya se ha hecho la tasación?']].map(([k, q]) =>
      `<div class="q"><p>${q}</p><div class="chips">${chip(k, '1', 'Sí', W[k] === true)}${chip(k, '0', 'No', W[k] === false)}</div></div>`).join('');
  if (s === 'res'){
    const x = wExp(); const g = checklist(x); const total = g.reduce((a, z) => a + z.items.length, 0);
    body = `<div class="result"><div class="total"><strong class="num">${total} documentos</strong> a recopilar para este expediente.</div>
      ${g.map(z => `<h3>${esc(z.title)}</h3><ul>${z.items.map(it => `<li>${esc(it.label)}${it.hint ? ` <span class="hint">(${esc(it.hint.toLowerCase())})</span>` : ''}</li>`).join('')}</ul>`).join('')}
      <p class="fine">Podrás completar el resto de datos, cambiar estas respuestas y subir los PDF dentro del expediente.</p></div>`;
  }
  const titles = { producto:'Nuevo expediente', n:'Titulares', tits:'Sobre cada titular', op:'Sobre la operación', res:'Documentación necesaria' };
  $('#dlgIn').innerHTML = `
    <div class="dlg-head"><h2>${titles[s]}</h2><p>Paso ${W.step + 1} de ${steps.length}</p><div class="steps">${steps.map((_, i) => `<i class="${i <= W.step ? 'on' : ''}"></i>`).join('')}</div></div>
    <div class="dlg-body">${body}${W.err ? `<p class="err">${esc(W.err)}</p>` : ''}</div>
    <div class="dlg-foot"><button class="btn" data-act="${W.step ? 'wBack' : 'close'}">${W.step ? 'Atrás' : 'Cancelar'}</button>
      <button class="btn primary" data-act="${s === 'res' ? 'wCreate' : 'wNext'}">${s === 'res' ? 'Crear expediente' : 'Continuar'}</button></div>`;
}
function wValidate(){
  const s = wSteps()[W.step];
  if (s === 'producto' && !W.producto) return 'Elige hipoteca o préstamo personal.';
  if (s === 'n' && !W.n) return 'Indica cuántos titulares hay.';
  if (s === 'tits'){ for (let i = 0; i < W.tits.length; i++){ const t = W.tits[i];
    if (!t.perfil) return `Falta la situación laboral del titular ${i + 1}.`;
    if (!t.estadoCivil) return `Falta el estado civil del titular ${i + 1}.`;
    if ((t.estadoCivil === 'divorciado' || t.estadoCivil === 'separado') && !has(t.hijos)) return `Indica si el titular ${i + 1} tiene hijos menores a cargo.`;
    if (!t.tieneFin) return `Indica si el titular ${i + 1} tiene otras financiaciones.`; } }
  if (s === 'op' && [W.arras, W.alquiler, W.tasacion].some(v => v === null)) return 'Responde las tres preguntas.';
  return '';
}
function wCreate(){
  const base = wExp(); const now = Date.now();
  const x = { id: 'e' + rid(), ref: nextRef(), createdAt: now, updatedAt: now, stage: 'nuevo', stageSince: now, history: [{ stage:'nuevo', at: now }],
    op: { ...base.op, tipo:'', precio:'', ahorros:'', importe:'', finalidad:'', ccaa:'', municipio:'', tipologia:'', telefono:'', email:'',
          gastosPct: 10, interes: base.op.producto === 'hipoteca' ? 3 : 7, plazo: base.op.producto === 'hipoteca' ? 30 : 8 },
    titulares: base.titulares, files: {}, na: {}, notas: '' };
  S.exps[x.id] = x; Store.save(x);
  $('#dlg').close(); S.openId = x.id; S.view = 'detail'; renderDetail();
  toast(`Expediente ${x.ref} creado.`);
}

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const w = e.target.closest('[data-w]');
  if (w && W){
    const [g, i] = w.dataset.w.split(':'); const v = w.dataset.v;
    if (g === 'producto') W.producto = v;
    else if (g === 'n'){ W.n = +v; while (W.tits.length < W.n) W.tits.push({ nombre:'', perfil:'', estadoCivil:'', hijos:'', tieneFin:'' }); W.tits.length = W.n; }
    else if (['arras','alquiler','tasacion'].includes(g)) W[g] = v === '1';
    else { W.tits[+i][g] = v; if (g === 'estadoCivil' && v !== 'divorciado' && v !== 'separado') W.tits[+i].hijos = ''; }
    W.err = ''; const sc = $('.dlg-body') ? $('.dlg-body').scrollTop : 0; drawWizard(); if ($('.dlg-body')) $('.dlg-body').scrollTop = sc; return;
  }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act; const x = cur();
  if (act === 'open') e.preventDefault();
  switch (act){
    case 'new': openWizard(); break;
    case 'back': S.view = 'board'; renderBoard(); window.scrollTo(0, 0); break;
    case 'close': $('#dlg').close(); break;
    case 'wNext': W.err = wValidate(); if (!W.err) W.step++; drawWizard(); break;
    case 'wBack': W.step--; W.err = ''; drawWizard(); break;
    case 'wCreate': wCreate(); break;
    case 'addTit': x.titulares.push(newTitular()); touch(x); renderDetail(true); break;
    case 'delTit': {
      const t = x.titulares.find(z => z.id === b.dataset.tid);
      const nFiles = Object.entries(x.files || {}).filter(([k]) => k.startsWith(t.id + ':')).reduce((a, [, v]) => a + v.length, 0);
      if (!confirm(`¿Quitar a ${t.nombre || 'este titular'}?${nFiles ? ` Sus ${nFiles} PDF se moverán a la papelera de tu Drive.` : ''}`)) break;
      if (nFiles && !(await ensureDrive())) break;
      for (const [k, v] of Object.entries(x.files || {})) if (k.startsWith(t.id + ':')){ for (const fl of v) await Store.deleteFile(fl.ref); delete x.files[k]; }
      x.titulares = x.titulares.filter(z => z.id !== t.id); touch(x, true); renderDetail(true); break; }
    case 'up': {
      if (!Store.driveReady()){ if (await ensureDrive()) toast('Google Drive conectado. Pulsa otra vez "Subir PDF".'); break; }
      $('#picker').dataset.key = b.dataset.key; $('#picker').value = ''; $('#picker').click(); break; }
    case 'na': { const k = b.dataset.key; x.na ||= {}; if (x.na[k]) delete x.na[k]; else x.na[k] = true; autoStage(x); touch(x, true); refreshDerived(); break; }
    case 'open': {
      const fl = x.files[b.dataset.key][+b.dataset.i];
      window.open(Store.fileUrl(fl.ref), '_blank', 'noopener');
      break; }
    case 'delFile': {
      const arr = x.files[b.dataset.key]; const fl = arr[+b.dataset.i];
      if (!confirm(`¿Quitar "${fl.name}" del expediente? Se moverá a la papelera de tu Drive.`)) break;
      if (!(await ensureDrive())) break;
      await Store.deleteFile(fl.ref); arr.splice(+b.dataset.i, 1); if (!arr.length) delete x.files[b.dataset.key];
      touch(x, true); refreshDerived(); break; }
    case 'zip': downloadZip(); break;
    case 'resumen': downloadResumen(); break;
    case 'msg': openMessage(); break;
    case 'copyMsg': {
      const v = $('#msgTxt').value;
      try{ await navigator.clipboard.writeText(v); toast('Texto copiado.'); }
      catch(err){ $('#msgTxt').select(); try{ document.execCommand('copy'); toast('Texto copiado.'); }catch(e2){ toast('Selecciona el texto y cópialo manualmente.'); } }
      break; }
    case 'delExp': {
      const n = Object.values(x.files || {}).reduce((a, v) => a + v.length, 0);
      if (!confirm(`¿Eliminar el expediente ${x.ref}?${n || x.driveFolderId ? ' Su carpeta de Drive se moverá a la papelera.' : ''} No se puede deshacer desde aquí.`)) break;
      if (x.driveFolderId){ if (!(await ensureDrive())) break; await Store.trashFolder(x); }
      await Store.remove(x); delete S.exps[x.id]; S.view = 'board'; renderBoard(); toast('Expediente eliminado.'); break; }
  }
});
document.addEventListener('keydown', e => {
  const c = e.target.closest && e.target.closest('.card');
  if (c && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); S.openId = c.dataset.id; renderDetail(); }
});
$('#app').addEventListener('click', e => {
  const c = e.target.closest('.card'); if (c){ S.openId = c.dataset.id; renderDetail(); }
});
$('#homeBtn').onclick = () => { if (!Store.uid) return; S.view = 'board'; renderBoard(); };
$('#newBtn').onclick = openWizard;
$('#search').addEventListener('input', e => { if (!Store.uid) return; S.q = e.target.value; if (S.view !== 'board'){ S.view = 'board'; } renderBoard(); });
$('#picker').addEventListener('change', e => { if (e.target.files.length) addFiles(e.target.dataset.key, e.target.files); });

let derT = null;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.wt !== undefined && W){ W.tits[+el.dataset.wt][el.dataset.k] = el.value; return; }
  const x = cur(); if (!x || S.view !== 'detail') return;
  if (el.dataset.op){ x.op[el.dataset.op] = el.value; if (el.dataset.op === 'producto'){ touch(x, true); renderDetail(true); return; } }
  else if (el.dataset.opc){ x.op[el.dataset.opc] = el.checked; }
  else if (el.dataset.tid && el.dataset.tk){ const t = x.titulares.find(z => z.id === el.dataset.tid); if (t) t[el.dataset.tk] = el.value; }
  else if (el.id === 'notas'){ x.notas = el.value; touch(x); return; }
  else return;
  touch(x);
  clearTimeout(derT);
  const inSide = el.closest('#side');
  derT = setTimeout(() => { if (inSide){ const id = el.id, pos = el.selectionStart; refreshDerived(); const n = document.getElementById(id); if (n){ n.focus(); try{ n.setSelectionRange(pos, pos); }catch(_){ } } } else refreshDerived(); }, inSide ? 600 : 200);
});
document.addEventListener('change', e => {
  const x = cur();
  if (e.target.id === 'stageSel' && x){ setStage(x, e.target.value); touch(x, true); refreshDerived(); toast(`Movido a "${STAGE[x.stage]}".`); }
  if (e.target.dataset && e.target.dataset.opc && x){ x.op[e.target.dataset.opc] = e.target.checked; touch(x); refreshDerived(); }
});

/* drag and drop: kanban */
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('.card'); if (!c) return; e.dataTransfer.setData('text/x-exp', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
document.addEventListener('dragend', e => { const c = e.target.closest && e.target.closest('.card'); if (c) c.classList.remove('dragging'); document.querySelectorAll('.over,.drop').forEach(n => n.classList.remove('over','drop')); });
document.addEventListener('dragover', e => {
  const col = e.target.closest('.col'); const item = e.target.closest('.item');
  const isFile = [...(e.dataTransfer.types || [])].includes('Files');
  if (col && !isFile){ e.preventDefault(); document.querySelectorAll('.col.over').forEach(n => n !== col && n.classList.remove('over')); col.classList.add('over'); }
  else if (item && isFile){ e.preventDefault(); document.querySelectorAll('.item.drop').forEach(n => n !== item && n.classList.remove('drop')); item.classList.add('drop'); }
});
document.addEventListener('dragleave', e => { const n = e.target.closest && e.target.closest('.col,.item'); if (n && !n.contains(e.relatedTarget)) n.classList.remove('over','drop'); });
document.addEventListener('drop', e => {
  const col = e.target.closest('.col'); const item = e.target.closest('.item');
  const id = e.dataTransfer.getData('text/x-exp');
  if (col && id){ e.preventDefault(); const x = S.exps[id]; col.classList.remove('over'); if (x && x.stage !== col.dataset.stage){ setStage(x, col.dataset.stage); x.updatedAt = Date.now(); Store.save(x); renderBoard(); toast(`${titularName(x)} movido a "${STAGE[x.stage]}".`); } return; }
  if (item && e.dataTransfer.files.length){ e.preventDefault(); item.classList.remove('drop'); addFiles(item.dataset.key, e.dataTransfer.files); }
});
window.addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files') && !e.target.closest('.item')) e.preventDefault(); });
window.addEventListener('drop', e => { if (!e.target.closest('.item')) e.preventDefault(); });

/* ---------- Acceso ---------- */
function renderLogin(msg = ''){
  S.view = 'login';
  $('#app').innerHTML = `
    <div class="login">
      <h1>Expedientes</h1>
      <p>Entra con tu cuenta de Google. Los PDF se guardarán en la carpeta "Expedientes" de tu Google Drive.</p>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <button class="btn primary" type="button" id="gBtn">Entrar con Google</button>
    </div>`;
  $('#gBtn').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Abriendo Google…';
    try{ Store.setToken(await signInWithPopup(auth, provider)); }
    catch(err){
      const m = { 'auth/popup-closed-by-user':'Has cerrado la ventana de Google antes de terminar.', 'auth/popup-blocked':'El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes para esta web.', 'auth/unauthorized-domain':'Este dominio no está autorizado en Firebase (Authentication > Settings > Dominios autorizados).', 'auth/operation-not-allowed':'El acceso con Google no está activado en Firebase.', 'auth/network-request-failed':'Sin conexión a internet.' }[err.code] || 'No se pudo iniciar sesión.';
      renderLogin(m);
    }
  });
}

$('#driveBtn').addEventListener('click', () => ensureDrive());

onAuthStateChanged(auth, user => {
  if (user){
    document.body.classList.remove('auth-out');
    $('#userBox').innerHTML = `<span>${esc(user.email)}</span><button class="btn ghost small" id="logoutBtn" type="button">Salir</button>`;
    $('#logoutBtn').onclick = () => { try{ sessionStorage.removeItem('drive-token'); }catch(e){} signOut(auth); };
    S.loaded = false; S.exps = {}; S.view = 'board'; S.openId = null;
    Store.loadToken(user.uid);
    renderBoard();
    Store.start(user.uid, onData);
    updateDriveUi();
  } else {
    Store.stop(); S.exps = {}; S.loaded = false; S.openId = null;
    document.body.classList.add('auth-out'); $('#userBox').innerHTML = ''; updateDriveUi();
    if (S.view !== 'login') renderLogin();
  }
});
