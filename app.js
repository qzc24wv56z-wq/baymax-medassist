/* =========================================================================
   BAYMAX HEALTH ASSISTANT — app.js
   ========================================================================= */

/* ===================== RANGOS Y ESTADO ===================== */
const RANGES = {
  bpm: {low:50, high:120, critLow:40, critHigh:140},
  spo2: {low:92, critLow:88},
  tempCorp: {low:35.5, high:37.8, critHigh:39},
};

const state = {
  bpm:null, spo2:null, tempCorp:null, tempAmb:null, sound:null, ecg:null,
  lastUpdate:null,
  history:[],
  connected:false,   // true = ESP32 real o modo demo activo
  demoMode:false,
  status:'offline'
};

const profile = { name:'', lastname:'', age:null, phone:'', email:'', photo:null, avatar:null, mood:null };
let reviews = [];
let notifications = [];
let socket = null;
let simInterval = null;
let currentReviewSnapshot = null;
let cameraStream = null;

/* ===================== AVATARES PREDEFINIDOS ===================== */
const AVATAR_EMOJIS = ['🧑','👩','👨','🧕','👱‍♀️','👱','🧔','👵','👴','🧑‍🦱','👩‍🦰','🧑‍🦳'];

/* ===================== CONSEJOS Y DATOS CURIOSOS DIARIOS ===================== */
const DAILY_TIPS = [
  "Tomar agua apenas te despiertas ayuda a reactivar tu cuerpo después de horas sin hidratarte.",
  "Estirar el cuello y los hombros cada hora reduce la tensión acumulada frente a la pantalla.",
  "Dormir entre 7 y 9 horas ayuda a tu corazón y a tu memoria a funcionar mejor.",
  "Caminar 10 minutos después de comer puede ayudar a tu digestión y a estabilizar tu energía.",
  "Respirar profundo por la nariz durante un minuto puede bajar tu ritmo cardíaco en momentos de estrés.",
  "Reducir la sal en tus comidas es una de las formas más simples de cuidar tu presión arterial.",
  "Reír y pasar tiempo con quienes querés también es una forma de cuidar tu salud emocional.",
  "Evitar pantallas 30 minutos antes de dormir mejora la calidad de tu descanso.",
  "Comer frutas y verduras de distintos colores te da una variedad más amplia de nutrientes.",
  "Salir a que te dé el sol unos minutos al día ayuda a tu cuerpo a regular el sueño.",
  "Hacer pausas activas cada 45–60 minutos de trabajo ayuda a tu circulación.",
  "Escuchar música tranquila puede ayudar a bajar los niveles de estrés en pocos minutos.",
  "Llevar un vaso de agua contigo te recuerda hidratarte a lo largo del día.",
  "Anotar 3 cosas por las que estás agradecido puede mejorar tu estado de ánimo con el tiempo.",
  "Subir escaleras en vez de usar el ascensor es un pequeño ejercicio cardiovascular extra."
];
const DAILY_FACTS = [
  "El corazón de un adulto late en promedio entre 60 y 100 veces por minuto en reposo.",
  "Los pulmones tienen una superficie interna aproximada del tamaño de una cancha de tenis.",
  "La piel es el órgano más grande del cuerpo humano.",
  "El cerebro humano usa cerca del 20% de la energía total que consume el cuerpo.",
  "El nivel normal de oxígeno en sangre (SpO₂) suele estar entre 95% y 100%.",
  "La temperatura corporal puede variar ligeramente a lo largo del día, siendo más baja en la madrugada.",
  "El sonido de un latido corresponde al cierre de las válvulas del corazón.",
  "Reír varios minutos puede aumentar temporalmente el ritmo cardíaco de forma saludable, similar a un ejercicio leve.",
  "El cuerpo humano tiene aproximadamente 5 litros de sangre en promedio.",
  "Los recién nacidos tienen un ritmo cardíaco normal mucho más alto que el de un adulto.",
  "El estrés crónico puede afectar tanto el sistema cardiovascular como el sistema inmune.",
  "Hidratarse bien ayuda a que la sangre circule con más facilidad por el cuerpo.",
  "El ejercicio regular puede ayudar a bajar la frecuencia cardíaca en reposo con el tiempo.",
  "El sueño profundo es cuando el cuerpo realiza gran parte de su proceso de reparación celular.",
  "Un electrocardiograma (ECG) mide la actividad eléctrica que hace latir al corazón."
];
function seededIndex(seedStr, arrLen){
  // Genera un índice "pseudo-aleatorio" pero estable durante todo el día, a partir de la fecha.
  // Así el consejo y el dato curioso cambian cada día de forma aleatoria (no siempre en el
  // mismo orden de la lista), pero no cambian solos cada vez que recargás la página el mismo día.
  let hash = 0;
  for(let i=0;i<seedStr.length;i++){ hash = (hash*31 + seedStr.charCodeAt(i)) >>> 0; }
  return hash % arrLen;
}
function renderDailyContent(){
  const todayStr = new Date().toISOString().slice(0,10); // YYYY-MM-DD, igual durante todo el día
  const tipIdx = seededIndex(todayStr+'-tip', DAILY_TIPS.length);
  const factIdx = seededIndex(todayStr+'-fact', DAILY_FACTS.length);
  document.getElementById('dailyTipText').textContent = DAILY_TIPS[tipIdx];
  document.getElementById('dailyFactText').textContent = DAILY_FACTS[factIdx];
}
function todaysTip(){ return DAILY_TIPS[seededIndex(new Date().toISOString().slice(0,10)+'-tip', DAILY_TIPS.length)]; }
function todaysFact(){ return DAILY_FACTS[seededIndex(new Date().toISOString().slice(0,10)+'-fact', DAILY_FACTS.length)]; }

/* ===================== GUARDADO PERSISTENTE (localStorage) ===================== */
const STORAGE_KEY = 'baymax_health_assistant_v2';
function saveAll(){
  try{
    const data = {
      profile, reviews, notifications,
      history: state.history,
      prefs: {
        dark: document.getElementById('prefDark').checked,
        anim: document.getElementById('prefAnim').checked,
        sound: document.getElementById('prefSound').checked,
        voice: voiceEnabled,
        robotVoice: document.getElementById('prefRobotVoice') ? document.getElementById('prefRobotVoice').checked : true
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }catch(e){
    logLine('No se pudo guardar (almacenamiento lleno o no disponible).', 'err');
  }
}
function loadAll(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    if(data.profile) Object.assign(profile, data.profile);
    if(Array.isArray(data.reviews)) reviews = data.reviews;
    if(Array.isArray(data.notifications)) notifications = data.notifications;
    if(Array.isArray(data.history)) state.history = data.history;
    if(data.prefs){
      document.getElementById('prefDark').checked = !!data.prefs.dark;
      document.body.setAttribute('data-theme', data.prefs.dark ? 'dark' : 'light');
      document.getElementById('prefAnim').checked = data.prefs.anim !== false;
      document.body.classList.toggle('reduced-anim', data.prefs.anim === false);
      document.getElementById('prefSound').checked = data.prefs.sound !== false;
      voiceEnabled = data.prefs.voice !== false;
      if(document.getElementById('prefRobotVoice')) document.getElementById('prefRobotVoice').checked = data.prefs.robotVoice !== false;
    }
    return true;
  }catch(e){
    return false;
  }
}

/* ===================== VITALES ===================== */
const VITAL_META = [
  {key:'bpm', icon:'❤️', label:'Pulso', unit:'BPM', decimals:0},
  {key:'spo2', icon:'🫁', label:'Oxigenación', unit:'%', decimals:0},
  {key:'tempCorp', icon:'🌡️', label:'Temp. corporal', unit:'°C', decimals:1},
  {key:'tempAmb', icon:'🌤️', label:'Temp. ambiente', unit:'°C', decimals:1},
  {key:'sound', icon:'🔊', label:'Sonido', unit:'', decimals:0},
];

/* Un valor EXACTO de 0 en pulso, oxígeno o temperatura corporal no es un valor real:
   significa que el sensor no está detectando nada (electrodos/dedo mal puestos, cable
   suelto, AD8232 en "leads-off"). Antes esto se trataba igual que un valor médico
   crítico real (ej. bpm=200) y asustaba con "¡valor fuera de rango seguro!" cuando en
   realidad lo que hace falta es revisar la conexión del sensor. Ahora se distingue con
   un estado propio ('nosignal') en vez de disparar una alarma crítica. */
function isNoSignalVal(val){ return val===0; }
function computeStatus(){
  if(!state.connected) return 'offline';
  const {bpm, spo2, tempCorp} = state;
  if(bpm==null && spo2==null && tempCorp==null) return 'normal';
  const noSignal = isNoSignalVal(bpm) || isNoSignalVal(spo2) || isNoSignalVal(tempCorp);
  const critical = (bpm!=null && bpm>0 && (bpm>=RANGES.bpm.critHigh || bpm<=RANGES.bpm.critLow)) ||
    (spo2!=null && spo2>0 && spo2<RANGES.spo2.critLow) || (tempCorp!=null && tempCorp>0 && tempCorp>=RANGES.tempCorp.critHigh);
  if(critical) return 'critical';
  if(noSignal) return 'nosignal';
  const warning = (bpm!=null && (bpm<RANGES.bpm.low || bpm>RANGES.bpm.high)) ||
    (spo2!=null && spo2<RANGES.spo2.low) || (tempCorp!=null && (tempCorp<RANGES.tempCorp.low || tempCorp>RANGES.tempCorp.high));
  return warning ? 'warning' : 'normal';
}
function vitalStatus(key, val){
  if(val==null || !state.connected) return 'offline';
  if(isNoSignalVal(val)) return 'nosignal';
  if(key==='bpm') return (val>=RANGES.bpm.critHigh||val<=RANGES.bpm.critLow) ? 'critical' : (val<RANGES.bpm.low||val>RANGES.bpm.high) ? 'warning' : 'normal';
  if(key==='spo2') return val<RANGES.spo2.critLow ? 'critical' : val<RANGES.spo2.low ? 'warning' : 'normal';
  if(key==='tempCorp') return val>=RANGES.tempCorp.critHigh ? 'critical' : (val<RANGES.tempCorp.low||val>RANGES.tempCorp.high) ? 'warning' : 'normal';
  return 'normal';
}
function fmtTime(ts){ return new Date(ts).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function fmtDate(ts){ return new Date(ts).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}); }

/* ===================== RENDER PANEL ===================== */
function renderHero(){
  document.getElementById('heroFace').setAttribute('data-status', state.status==='nosignal' ? 'scanning' : state.status);
  document.getElementById('heroGreeting').textContent = profile.name ? `Hola, ${profile.name}` : '¿Cómo estás hoy?';
  const badge = document.getElementById('heroStatusBadge');
  badge.className = 'status-badge ' + state.status;
  badge.textContent = state.status==='offline' ? 'Sin conexión' : state.status==='nosignal' ? 'Sin señal del sensor' : state.status==='normal' ? 'Todo bien' : state.status==='warning' ? 'Atención requerida' : 'Aviso crítico';
  const msg = document.getElementById('heroMsg');
  msg.textContent = state.status==='offline'
    ? 'Aún no detecto un ESP32 conectado. Conecta tu dispositivo o activa el modo demostración para ver tus signos vitales en tiempo real.'
    : state.status==='nosignal' ? 'Uno de los sensores está devolviendo 0, lo que suele indicar que no hay buen contacto (electrodos, dedo o cable). Revisa la conexión del sensor.'
    : state.status==='normal' ? 'Estoy monitoreando tus signos vitales en tiempo real.'
    : state.status==='warning' ? 'Uno de tus valores está fuera del rango habitual. Vale la pena descansar un momento.'
    : '¡Hay un valor fuera de rango seguro! Si te sentís mal, buscá ayuda de un adulto responsable o un profesional de salud.';
}
function renderVitals(){
  const grid = document.getElementById('vitalsGrid');
  // Antes esta función reconstruía las 5 tarjetas por completo (innerHTML) en cada lectura.
  // Cuando el ESP32 manda datos seguido, eso reiniciaba la animación de aparición de las
  // tarjetas en cada actualización, y si las lecturas llegaban más rápido que la animación,
  // las tarjetas 2 a 5 nunca llegaban a mostrarse completas (parecía que la página se "bugueaba"
  // y solo se veía la primera tarjeta, la de Pulso). Ahora creamos las 5 tarjetas UNA sola vez
  // y en cada lectura solo actualizamos su contenido, sin volver a crear los elementos.
  if(grid.children.length !== VITAL_META.length){
    grid.innerHTML = VITAL_META.map(v=>`<div class="vcard" data-status="offline"><div class="vtop"><span class="vlabel">${v.label}</span><div class="icon-badge" data-part="icon">${v.icon}</div></div><div class="vvalue" data-part="value">--<span class="vunit">${v.unit}</span></div><div class="vtrend" data-part="trend">Esperando conexión con el ESP32</div></div>`).join('');
  }
  VITAL_META.forEach((v, idx)=>{
    const card = grid.children[idx];
    if(!card) return;
    const val = state.connected ? state[v.key] : null;
    const status = vitalStatus(v.key, val);
    const badgeClass = status==='normal' ? 'green' : status==='warning' ? 'amber' : status==='nosignal' ? 'nosignal' : '';
    const display = val==null ? '--' : val.toFixed(v.decimals);
    const range = !state.connected ? 'Esperando conexión con el ESP32'
      : status==='nosignal' ? 'Sin señal — revisa el sensor'
      : v.key==='bpm' ? `Rango normal: ${RANGES.bpm.low}–${RANGES.bpm.high} BPM`
      : v.key==='spo2' ? `Rango normal: ≥ ${RANGES.spo2.low}%`
      : v.key==='tempCorp' ? `Rango normal: ${RANGES.tempCorp.low}–${RANGES.tempCorp.high}°C`
      : 'Nivel ambiental informativo';
    card.setAttribute('data-status', status);
    card.querySelector('[data-part="icon"]').className = 'icon-badge ' + badgeClass;
    card.querySelector('[data-part="value"]').innerHTML = `${display}<span class="vunit">${v.unit}</span>`;
    card.querySelector('[data-part="trend"]').textContent = range;
  });
  document.getElementById('lastUpdateText').textContent = state.lastUpdate ? 'Última lectura: ' + fmtTime(state.lastUpdate) : 'Aún no se ha recibido ninguna lectura';
}
function renderHistory(){
  const rows = state.history.slice(-12).reverse().map(h=>`<tr><td>${fmtTime(h.ts)}</td><td>${h.bpm!=null?h.bpm:'--'}</td><td>${h.spo2!=null?h.spo2:'--'}</td><td>${h.tempCorp!=null?h.tempCorp.toFixed(1):'--'}</td><td>${h.tempAmb!=null?h.tempAmb.toFixed(1):'--'}</td><td>${h.sound!=null?h.sound:'--'}</td></tr>`).join('');
  document.getElementById('historyBody').innerHTML = rows || `<tr><td colspan="6" class="empty">Aún no hay lecturas</td></tr>`;
}
function renderNotifications(){
  const list = document.getElementById('notifList');
  document.getElementById('notifCount').textContent = notifications.length ? `(${notifications.length})` : '';
  if(!notifications.length){ list.innerHTML = `<div class="empty">No hay avisos todavía. Aquí aparecerán las alertas de Baymax.</div>`; return; }
  list.innerHTML = notifications.slice().reverse().map(n=>`<div class="notif" data-level="${n.level}"><div class="icon-badge ${n.level==='normal'?'green':n.level==='warning'?'amber':n.level==='nosignal'?'nosignal':''}" style="width:34px;height:34px;font-size:15px;">${n.level==='critical'?'🚨':n.level==='warning'?'⚠️':n.level==='nosignal'?'📡':'✅'}</div><div class="ntxt"><strong>${n.title}</strong><span>${n.body}</span></div><span class="ntime">${fmtTime(n.ts)}</span></div>`).join('');
}
function pushNotification(level, title, body){
  notifications.push({level, title, body, ts: Date.now()});
  if(notifications.length > 40) notifications.shift();
  renderNotifications();
  speak(`${title}. ${body}`);
  if(level!=='normal' && 'Notification' in window && Notification.permission==='granted'){ new Notification(title, {body}); }
  saveAll();
}
function avatarImgOrEmoji(sizeClass){
  if(profile.photo) return `<img src="${profile.photo}" alt="Foto de ${profile.name||'usuario'}">`;
  if(profile.avatar) return `<span style="font-size:${sizeClass==='big'?'34px':'22px'};">${profile.avatar}</span>`;
  return `<span style="font-size:${sizeClass==='big'?'28px':'18px'};">👤</span>`;
}
function renderReviewsList(){
  const box = document.getElementById('reviewsList');
  if(!reviews.length){ box.innerHTML = `<div class="empty">Aún no has guardado ninguna revisión.</div>`; return; }
  box.innerHTML = reviews.slice().reverse().map(r=>`
    <div class="review-card">
      ${r.photo ? `<img src="${r.photo}" alt="Foto de ${r.name||'usuario'}">` : `<div class="photo-preview empty" style="width:52px;height:52px;">${r.avatar||'👤'}</div>`}
      <div class="rc-body">
        <div class="rc-title">${r.name||'Sin nombre'} ${r.lastname||''} · ${fmtDate(r.ts)} ${fmtTime(r.ts)}</div>
        <div class="rc-meta">❤️ ${r.bpm??'--'} BPM · 🫁 ${r.spo2??'--'}% · 🌡️ ${r.tempCorp!=null?r.tempCorp.toFixed(1):'--'}°C · ${r.mood?'Estado: '+r.mood:''}</div>
      </div>
      <button class="btn btn-ghost" onclick="deleteReview('${r.id}')">Eliminar</button>
    </div>`).join('');
}
function deleteReview(id){ reviews = reviews.filter(r=>r.id!==id); renderReviewsList(); saveAll(); }
function renderSystem(){
  const items = [
    {name:'ESP32', ok: state.connected && !state.demoMode},
    {name:'Modo demostración', ok: state.demoMode},
    {name:'Sensor cardíaco (BPM)', ok: state.connected && state.bpm!=null},
    {name:'Sensor de oxígeno (SpO₂)', ok: state.connected && state.spo2!=null},
    {name:'Sensor de temperatura', ok: state.connected && state.tempCorp!=null},
    {name:'Sensor de sonido', ok: state.connected && state.sound!=null},
    {name:'ECG (AD8232)', ok: state.connected && state.ecg!=null},
  ];
  document.getElementById('systemList').innerHTML = items.map(i=>`<div class="system-row"><span class="sname">${i.name}</span><span class="system-badge ${i.ok?'ok':'off'}">${i.ok?'🟢 Conectado':'🔴 Sin datos'}</span></div>`).join('');
}
function renderProfileSummary(){
  const box = document.getElementById('profileSummary');
  if(!box) return;
  box.innerHTML = `
    <div class="ps-avatar">${avatarImgOrEmoji('big')}</div>
    <div class="ps-info">
      <strong>${profile.name||'Sin nombre'} ${profile.lastname||''}</strong>
      <span>${profile.age?profile.age+' años · ':''}${profile.phone||'Sin teléfono'}</span>
      <span>${profile.email||'Sin correo registrado'}</span>
    </div>`;
}
function renderAvatarMini(){
  const el = document.getElementById('avatarMini');
  el.innerHTML = avatarImgOrEmoji('mini');
}
function renderAll(){ renderHero(); renderVitals(); renderHistory(); renderNotifications(); renderReviewsList(); renderSystem(); renderProfileSummary(); renderAvatarMini(); renderDailyContent(); }

/* ===================== LATIDOS (visual) ===================== */
const heartWaveCanvas = document.getElementById('heartbeatWave');
const heartWaveCtx = heartWaveCanvas ? heartWaveCanvas.getContext('2d') : null;
let heartWaveX = 0;
function resizeHeartCanvas(){
  if(!heartWaveCanvas) return;
  heartWaveCanvas.width = heartWaveCanvas.clientWidth * window.devicePixelRatio;
  heartWaveCanvas.height = heartWaveCanvas.clientHeight * window.devicePixelRatio;
  heartWaveCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
window.addEventListener('resize', resizeHeartCanvas);
function drawHeartWaveTick(beat){
  if(!heartWaveCtx) return;
  const w = heartWaveCanvas.clientWidth, h = heartWaveCanvas.clientHeight;
  if(heartWaveX===0){ heartWaveCtx.clearRect(0,0,w,h); }
  if(heartWaveX >= w){ heartWaveCtx.clearRect(0,0,w,h); heartWaveX = 0; }
  const midY = h/2;
  heartWaveCtx.beginPath();
  heartWaveCtx.moveTo(heartWaveX, midY);
  const y = beat ? midY - h*0.38 : midY + (Math.random()-0.5)*3;
  heartWaveCtx.lineTo(heartWaveX+3, y);
  heartWaveCtx.lineTo(heartWaveX+6, midY);
  heartWaveCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--red') || '#E4453A';
  heartWaveCtx.lineWidth = 2;
  heartWaveCtx.stroke();
  heartWaveX += 6;
}
let heartbeatTimer = null;
function updateHeartbeatVisual(){
  const bpmEl = document.getElementById('heartbeatBpmValue');
  const statusEl = document.getElementById('heartbeatStatusText');
  if(!bpmEl) return;
  if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if(!state.connected || state.bpm==null){
    bpmEl.textContent = '--';
    statusEl.textContent = 'Conecta tu ESP32 o activa el modo demostración para ver tu ritmo cardíaco.';
    return;
  }
  bpmEl.textContent = Math.round(state.bpm);
  statusEl.textContent = state.status==='nosignal' ? 'Sin señal del sensor de pulso (0 BPM). Revisa que el electrodo/dedo tenga buen contacto.' : state.status==='critical' ? 'Ritmo fuera de rango seguro. Presta atención a cómo te sentís.' : state.status==='warning' ? 'Ritmo fuera del rango habitual.' : 'Tu ritmo cardíaco está dentro de lo esperado.';
  if(state.status==='nosignal'){ if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer=null; } return; }
  const intervalMs = Math.max(280, 60000 / Math.max(30, Math.min(220, state.bpm)));
  function beatOnce(){
    const heartSvg = document.getElementById('heartSvg');
    if(heartSvg){ heartSvg.classList.remove('beat'); void heartSvg.offsetWidth; heartSvg.classList.add('beat'); }
    document.querySelectorAll('.heartbeat-ring').forEach(r=>{ r.classList.remove('ping'); void r.offsetWidth; r.classList.add('ping'); });
    const heroHeart = document.getElementById('heroHeart');
    if(heroHeart){ heroHeart.classList.remove('beat'); void heroHeart.offsetWidth; heroHeart.classList.add('beat'); }
    drawHeartWaveTick(true);
  }
  beatOnce();
  heartbeatTimer = setInterval(beatOnce, intervalMs);
}

/* ===================== RENDER Y GUARDADO AGRUPADOS (evita que el panel se trabe) =====================
   El ESP32 puede enviar datos muy seguido (varias veces por segundo). Antes, cada mensaje
   reconstruía TODAS las tarjetas del panel (HTML) y además escribía todo en localStorage,
   lo que saturaba el navegador y hacía que las tarjetas de pulso, oxigenación, temperatura
   corporal, temperatura ambiente y sonido se vieran "trabadas"/congeladas.
   Ahora agrupamos esos renders con requestAnimationFrame (máximo uno por fotograma) y el
   guardado en localStorage se hace como mucho cada 1.5s, sin perder ningún dato porque el
   ECG (que sí necesita verse fluido) se sigue dibujando de inmediato en cada mensaje. */
let vitalsRenderQueued = false;
function scheduleVitalsRender(){
  if(vitalsRenderQueued) return;
  vitalsRenderQueued = true;
  requestAnimationFrame(()=>{
    vitalsRenderQueued = false;
    renderHero(); renderVitals(); renderHistory(); renderSystem(); updateHeartbeatVisual();
  });
}
let saveTimer = null;
function scheduleSave(){
  if(saveTimer) return;
  saveTimer = setTimeout(()=>{ saveTimer = null; saveAll(); }, 1500);
}

/* ===================== APLICAR LECTURA ===================== */
function applyReading(data){
  const prevStatus = state.status;
  if(data.bpm !== undefined) state.bpm = Number(data.bpm);
  if(data.spo2 !== undefined) state.spo2 = Number(data.spo2);
  if(data.tempCorp !== undefined) state.tempCorp = Number(data.tempCorp);
  if(data.tempAmb !== undefined) state.tempAmb = Number(data.tempAmb);
  if(data.sound !== undefined) state.sound = Number(data.sound);
  if(data.ecg !== undefined){ state.ecg = data.ecg; drawECG(Number(data.ecg)); document.getElementById('ecgValue').textContent = data.ecg; }

  state.lastUpdate = Date.now();
  state.history.push({ts:state.lastUpdate, bpm:state.bpm, spo2:state.spo2, tempCorp:state.tempCorp, tempAmb:state.tempAmb, sound:state.sound});
  if(state.history.length>60) state.history.shift();
  state.status = computeStatus();

  if(state.status !== prevStatus && state.status!=='normal' && state.status!=='offline'){
    pushNotification(state.status, state.status==='critical' ? 'Valor crítico detectado' : state.status==='nosignal' ? 'Sensor sin señal' : 'Valor fuera de rango',
      `Pulso ${state.bpm ?? '--'} BPM · SpO₂ ${state.spo2 ?? '--'}% · Temp. ${state.tempCorp!=null?state.tempCorp.toFixed(1):'--'}°C`);
  } else if(state.status==='normal' && prevStatus!=='normal' && prevStatus!=='offline'){
    pushNotification('normal', 'Valores normalizados', 'Tus signos vitales volvieron al rango habitual.');
  }
  scheduleVitalsRender();
  scheduleSave();
}
function clearReadingsOffline(){
  // No inventar datos: al desconectar, se limpian los valores en pantalla.
  state.bpm=null; state.spo2=null; state.tempCorp=null; state.tempAmb=null; state.sound=null; state.ecg=null;
  state.status = computeStatus();
  renderHero(); renderVitals(); renderSystem(); updateHeartbeatVisual();
  document.getElementById('ecgValue').textContent = '--';
}

/* ===================== SIMULACIÓN (modo demostración explícito) ===================== */
function randomWalk(val, step, min, max){ const base = val==null ? (min+max)/2 : val; return Math.max(min, Math.min(max, base + (Math.random()-0.5)*step)); }
function simulateTick(){
  applyReading({
    bpm: Math.round(randomWalk(state.bpm, 6, 45, 145)),
    spo2: Math.round(randomWalk(state.spo2, 1.5, 86, 100)),
    tempCorp: Number(randomWalk(state.tempCorp, 0.2, 35.3, 39.3).toFixed(1)),
    tempAmb: Number(randomWalk(state.tempAmb, 0.15, 20, 30).toFixed(1)),
    sound: Math.round(randomWalk(state.sound, 8, 5, 90)),
    ecg: Math.round(randomWalk(state.ecg, 400, 800, 3200))
  });
}
function startSimulation(){
  stopSimulation();
  state.connected = true; state.demoMode = true; setConnState(true, 'demo');
  simInterval = setInterval(simulateTick, 1500);
  logLine('Modo demostración activo (datos simulados). Esto NO reemplaza a tu ESP32 real.', 'info');
  setTimeout(speakConnectionTip, 1200);
}
function stopSimulation(){ if(simInterval){ clearInterval(simInterval); simInterval=null; } state.demoMode=false; }

/* ===================== CONSEJO/DATO HABLADO AL CONECTAR (hace la app más dinámica) =====================
   Cuando el ESP32 (o el modo demostración) empieza a dar datos de verdad, Baymax comenta en voz
   alta el consejo o el dato curioso del día, para que se sienta más viva y dinámica la página. */
function speakConnectionTip(){
  const useTip = Math.random() < 0.5;
  const content = useTip ? todaysTip() : todaysFact();
  const intro = useTip ? 'Ya estoy recibiendo tus datos. Aquí tienes el consejo de hoy: ' : 'Ya estoy recibiendo tus datos. Aquí tienes un dato curioso de hoy: ';
  speak(intro + content);
}

/* ===================== CONEXIÓN REAL AL ESP32 ===================== */
function setConnState(online, mode){
  const pill = document.getElementById('connPill');
  pill.setAttribute('data-state', online?'online':'offline');
  document.getElementById('connPillText').textContent = online ? (mode==='demo' ? 'Modo demostración' : 'ESP32 conectado') : 'ESP32 desconectado';
  if(!online){ state.connected = false; state.demoMode=false; state.status = computeStatus(); clearReadingsOffline(); renderHero(); renderSystem(); }
}
function logLine(text, type){
  const log = document.getElementById('connLog');
  if(!log) return;
  const div = document.createElement('div');
  div.className = type==='err' ? 'l-err' : type==='info' ? 'l-info' : '';
  div.textContent = `[${new Date().toLocaleTimeString('es-ES')}] ${text}`;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
}
function connectESP32(){
  const url = document.getElementById('wsUrl').value.trim();
  if(!url){ alert("Escribe la dirección WebSocket del ESP32.\n\nEjemplo:\nws://192.168.1.100:81"); return; }
  if(!url.startsWith('ws://') && !url.startsWith('wss://')){ alert("La URL debe comenzar con ws:// o wss://"); return; }
  try{ new URL(url); }catch(e){ alert("La URL WebSocket no es válida."); return; }
  document.getElementById('simToggle').checked = false;
  stopSimulation();
  if(socket){ try{ socket.close(); }catch(e){} }
  logLine('Intentando conectar a: ' + url, 'info');
  socket = new WebSocket(url);
  socket.onopen = function(){
    state.connected = true; state.demoMode=false; setConnState(true, 'real');
    logLine('Conexión WebSocket establecida.', 'info'); renderSystem();
    setTimeout(speakConnectionTip, 1200);
  };
  socket.onmessage = function(event){ try{ applyReading(JSON.parse(event.data)); }catch(error){ logLine('Dato recibido no válido: ' + event.data, 'err'); } };
  socket.onerror = function(){ logLine('Error de conexión WebSocket.', 'err'); state.connected = false; setConnState(false); };
  socket.onclose = function(){ logLine('Conexión cerrada.', 'err'); state.connected = false; setConnState(false); };
}
function disconnectESP32(){ if(socket){ socket.close(); socket = null; } state.connected = false; setConnState(false); logLine('ESP32 desconectado manualmente.', 'info'); }
document.getElementById('btnConnect').addEventListener('click', connectESP32);
document.getElementById('btnDisconnect').addEventListener('click', disconnectESP32);
document.getElementById('simToggle').addEventListener('change', (e)=>{
  if(e.target.checked){ if(socket){ socket.close(); socket=null; } startSimulation(); }
  else { stopSimulation(); state.connected = false; setConnState(false); logLine('Modo demostración detenido.', 'info'); }
});

/* ===================== ECG CANVAS =====================
   OJO: la sección "view-ecg" está oculta (display:none) hasta que el usuario abre esa
   pestaña. Mientras un elemento está oculto, su clientWidth/clientHeight valen 0, así
   que si medíamos el canvas solo una vez al cargar la página, se quedaba con tamaño
   0x0 para siempre y el ECG nunca se veía, aunque sí llegaran datos por WebSocket.
   Ahora volvemos a medir el canvas cada vez que se entra a la pestaña de ECG, y
   además reseteamos la transformación antes de escalar para no acumular el
   devicePixelRatio cada vez que se llama a resizeCanvas(). */
const canvas = document.getElementById('ecgCanvas');
const ctx = canvas.getContext('2d');
function resizeCanvas(){
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if(width===0 || height===0) return false; // sigue oculta, no hay nada que medir todavía
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ecgX = 0;
  return true;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
let ecgX = 0, lastECGY = 140;
function drawECG(value){
  // Si el canvas todavía no tiene tamaño real (p.ej. porque la pestaña estaba oculta
  // cuando llegó el primer dato), lo medimos ahora en vez de perder el dato.
  if(canvas.width===0 || canvas.height===0){ if(!resizeCanvas()) return; }
  const width = canvas.clientWidth, height = canvas.clientHeight;
  let y = height - (value / 4095) * height;
  y = Math.max(5, Math.min(height - 5, y));
  if(ecgX >= width){ ctx.clearRect(0, 0, width, height); ecgX = 0; lastECGY = y; }
  ctx.beginPath(); ctx.moveTo(ecgX, lastECGY); ctx.lineTo(ecgX + 2, y);
  ctx.strokeStyle = '#E4453A'; ctx.lineWidth = 2; ctx.stroke();
  lastECGY = y; ecgX += 2;
}

/* ===================== REVISIÓN GUIADA ===================== */
const SCAN_HOLD_SECONDS = 13;
let scanHoldTimer = null;
let scanHoldStart = null;
function showReviewStage(id){
  ['reviewIdle','reviewScanning','reviewResults'].forEach(s=> document.getElementById(s).classList.toggle('hidden', s!==id));
}
function goToReviewTab(){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab==='revision'));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-revision'));
}
function resetScanUI(){
  clearInterval(scanHoldTimer); scanHoldTimer = null; scanHoldStart = null;
  document.getElementById('scanStep1').dataset.active = 'true'; document.getElementById('scanStep1').dataset.done = '';
  document.getElementById('scanStep2').dataset.active = ''; document.getElementById('scanStep2').dataset.done = '';
  document.getElementById('scanTitle').textContent = 'Paso 1 de 2 — Colocá tu dedo';
  document.getElementById('scanMsg').textContent = 'Tocá y mantené presionado el corazoncito de Baymax (arriba a la izquierda de su pecho).';
  const cd = document.getElementById('scanCountdown'); cd.classList.add('hidden'); cd.textContent = SCAN_HOLD_SECONDS;
  document.getElementById('scanReleaseHint').classList.add('hidden');
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('holding','success','released');
  const ring = document.getElementById('scanRingFill');
  ring.style.transition = 'none'; ring.style.strokeDashoffset = '94.2';
}
function beginScan(){
  if(!state.connected){
    document.getElementById('reviewIdleMsg').textContent = 'Todavía no detecto un ESP32 conectado ni el modo demostración activo. Conéctalo desde la pestaña "Conexión ESP32" para poder tomar una lectura real.';
    goToReviewTab();
    speak('No puedo iniciar una revisión todavía porque no detecto tu dispositivo conectado. Conecta tu ESP32 o activa el modo demostración.');
    return;
  }
  goToReviewTab();
  showReviewStage('reviewScanning');
  resetScanUI();
  document.getElementById('heroFace').setAttribute('data-status','scanning');
  speak('Perfecto. Vamos a realizar una revisión. Mantené presionado el corazoncito de mi pecho durante trece segundos, sin soltarlo.');
}
function startScanHold(){
  if(scanHoldTimer) return;
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('released'); heart.classList.add('holding');
  document.getElementById('scanStep1').dataset.active = ''; document.getElementById('scanStep1').dataset.done = 'true';
  document.getElementById('scanStep2').dataset.active = 'true';
  document.getElementById('scanTitle').textContent = 'Paso 2 de 2 — No lo sueltes';
  document.getElementById('scanMsg').textContent = 'Perfecto, quedate así. Estoy registrando tus datos…';
  document.getElementById('scanReleaseHint').classList.add('hidden');
  const cd = document.getElementById('scanCountdown'); cd.classList.remove('hidden'); cd.textContent = SCAN_HOLD_SECONDS;
  const ring = document.getElementById('scanRingFill');
  void ring.offsetWidth;
  ring.style.transition = `stroke-dashoffset ${SCAN_HOLD_SECONDS}s linear`;
  ring.style.strokeDashoffset = '0';
  scanHoldStart = Date.now();
  scanHoldTimer = setInterval(()=>{
    const elapsed = Math.floor((Date.now()-scanHoldStart)/1000);
    const remaining = Math.max(0, SCAN_HOLD_SECONDS - elapsed);
    cd.textContent = remaining;
    cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick');
    if(remaining<=0){
      clearInterval(scanHoldTimer); scanHoldTimer = null;
      finishScanHold();
    }
  }, 1000);
}
function cancelScanHold(){
  if(!scanHoldTimer) return;
  clearInterval(scanHoldTimer); scanHoldTimer = null;
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('holding'); heart.classList.add('released');
  const ring = document.getElementById('scanRingFill');
  ring.style.transition = 'none'; ring.style.strokeDashoffset = '94.2';
  document.getElementById('scanReleaseHint').classList.remove('hidden');
  setTimeout(()=> resetScanUI(), 1100);
}
function finishScanHold(){
  const heart = document.getElementById('scanHeartBtn');
  heart.classList.remove('holding'); heart.classList.add('success');
  document.getElementById('scanTitle').textContent = '¡Listo!';
  document.getElementById('scanMsg').textContent = 'Terminé de registrar tus datos.';
  currentReviewSnapshot = { bpm:state.bpm, spo2:state.spo2, tempCorp:state.tempCorp, mood: profile.mood };
  setTimeout(()=> showResults(currentReviewSnapshot), 500);
}
(function setupScanHeartEvents(){
  const heart = document.getElementById('scanHeartBtn');
  heart.addEventListener('mousedown', startScanHold);
  heart.addEventListener('touchstart', (e)=>{ e.preventDefault(); startScanHold(); }, {passive:false});
  ['mouseup','mouseleave'].forEach(ev=> heart.addEventListener(ev, ()=>{ if(scanHoldTimer) cancelScanHold(); }));
  ['touchend','touchcancel'].forEach(ev=> heart.addEventListener(ev, ()=>{ if(scanHoldTimer) cancelScanHold(); }));
})();
function interpretation(snap){
  const s = vitalStatusRaw('bpm',snap.bpm)==='critical'||vitalStatusRaw('spo2',snap.spo2)==='critical'||vitalStatusRaw('tempCorp',snap.tempCorp)==='critical' ? 'critical'
    : vitalStatusRaw('bpm',snap.bpm)==='warning'||vitalStatusRaw('spo2',snap.spo2)==='warning'||vitalStatusRaw('tempCorp',snap.tempCorp)==='warning' ? 'warning' : 'normal';
  if(s==='normal') return { level:s, text:'Tus valores registrados están dentro de los rangos configurados para esta aplicación.' };
  if(s==='warning') return { level:s, text:'Uno de los valores registrados merece atención. Considerá descansar y, si te sentís mal o el valor sigue así, hablá con un adulto responsable o un profesional de salud.' };
  return { level:s, text:'Uno de los valores registrados está fuera del rango seguro configurado. Esta aplicación no puede determinar la causa: si te sentís mal, buscá ayuda de un adulto responsable o un profesional de salud lo antes posible.' };
}
function vitalStatusRaw(key,val){
  if(val==null) return 'normal';
  if(key==='bpm') return (val>=RANGES.bpm.critHigh||val<=RANGES.bpm.critLow) ? 'critical' : (val<RANGES.bpm.low||val>RANGES.bpm.high) ? 'warning' : 'normal';
  if(key==='spo2') return val<RANGES.spo2.critLow ? 'critical' : val<RANGES.spo2.low ? 'warning' : 'normal';
  if(key==='tempCorp') return val>=RANGES.tempCorp.critHigh ? 'critical' : (val<RANGES.tempCorp.low||val>RANGES.tempCorp.high) ? 'warning' : 'normal';
  return 'normal';
}
function recommendationsFor(snap){
  const recs = [];
  const interp = interpretation(snap);
  if(interp.level!=='normal') recs.push('🛌 Descansar');
  recs.push('💧 Tomar agua');
  if(snap.mood==='Mal' || snap.mood==='Muy mal') recs.push('🧘 Respiración', '📵 Descanso de pantalla');
  else recs.push('🚶 Movimiento suave');
  recs.push('🍎 Alimentación equilibrada');
  return [...new Set(recs)];
}
function showResults(snap){
  showReviewStage('reviewResults');
  const interp = interpretation(snap);
  document.getElementById('resultFace').setAttribute('data-status', interp.level);
  document.getElementById('heroFace').setAttribute('data-status', state.status);
  document.getElementById('resultGrid').innerHTML = `
    <div class="result-item"><div class="rlabel">❤️ Pulso</div><div class="rvalue">${snap.bpm??'--'} BPM</div></div>
    <div class="result-item"><div class="rlabel">🫁 Oxigenación</div><div class="rvalue">${snap.spo2??'--'}%</div></div>
    <div class="result-item"><div class="rlabel">🌡️ Temperatura</div><div class="rvalue">${snap.tempCorp!=null?snap.tempCorp.toFixed(1):'--'}°C</div></div>`;
  document.getElementById('interpretationBox').textContent = interp.text;
  document.getElementById('recList').innerHTML = recommendationsFor(snap).map(r=>`<span class="rec-chip">${r}</span>`).join('');
  if(interp.level==='normal'){ happyMascot('#resultFace, #heroFace'); } else { waveMascot('#resultFace'); }
  speak('He terminado de analizar las mediciones disponibles. ' + interp.text);
}
document.getElementById('btnStartReview').addEventListener('click', beginScan);
document.getElementById('btnBeginScan').addEventListener('click', beginScan);
document.getElementById('btnDiscardReview').addEventListener('click', ()=>{ showReviewStage('reviewIdle'); });
document.getElementById('btnSaveReview').addEventListener('click', ()=>{
  if(!currentReviewSnapshot) return;
  const entry = { id:'r'+Date.now(), ts:Date.now(), name:profile.name, lastname:profile.lastname, age:profile.age, photo:profile.photo, avatar:profile.avatar, mood:profile.mood,
    bpm:currentReviewSnapshot.bpm, spo2:currentReviewSnapshot.spo2, tempCorp:currentReviewSnapshot.tempCorp };
  reviews.push(entry);
  renderReviewsList();
  showReviewStage('reviewIdle');
  saveAll();
  const emailNote = profile.email ? ` Se envió un resumen simulado a ${profile.email}.` : '';
  pushNotification('normal', 'Revisión guardada', 'Tu revisión quedó registrada en el historial.' + emailNote);
  simulateEmailSend(entry);
});
function simulateEmailSend(entry){
  // No hay backend de correo real: esta función simula visualmente el envío del resumen al correo del usuario.
  if(!profile.email) return;
  logLine(`Simulando envío de resumen de revisión a ${profile.email}…`, 'info');
  setTimeout(()=> logLine(`Resumen enviado (simulado) a ${profile.email}.`, 'info'), 900);
}

/* ===================== CHAT ===================== */
/* Configuración de la IA real (Cloudflare Worker + Gemini).
   Pega aquí la URL que te da Cloudflare al desplegar worker.js.
   Si la dejas vacía o el Worker no responde, Baymax sigue funcionando
   con el sistema de respuestas por palabras clave de siempre. */
const AI_CONFIG = {
  enabled: true,
  workerUrl: 'https://baymax-ai.qzc24wv56z.workers.dev',
};

async function getAIReply(text){
  if(!AI_CONFIG.enabled || !AI_CONFIG.workerUrl || AI_CONFIG.workerUrl.includes('TU-WORKER')) return null;
  try{
    const controller = new AbortController();
    const timeoutId = setTimeout(()=> controller.abort(), 12000);
    const res = await fetch(AI_CONFIG.workerUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        message: text,
        context:{
          bpm: state.bpm, spo2: state.spo2, tempCorp: state.tempCorp,
          connected: state.connected, mood: profile.mood, name: profile.name
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if(!res.ok) return null;
    const data = await res.json();
    return data.reply || null;
  }catch(err){
    console.warn('Baymax: IA no disponible, usando respuestas locales.', err);
    return null;
  }
}
function addMsg(text, who){
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg ' + (who==='user'?'user':'bot');
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
function showTyping(){
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg bot typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
/* Detector de estado de ánimo: cubre las emociones más comunes que alguien puede
   escribirle a Baymax en el chat, con una respuesta cálida y, cuando corresponde,
   te lleva a la sección de Bienestar y deja guardado tu estado de ánimo. */
function setMoodFromChat(moodLabel){
  if(!moodLabel) return;
  profile.mood = moodLabel;
  document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===moodLabel));
  document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===moodLabel));
  const bad = moodLabel==='Mal' || moodLabel==='Muy mal';
  const supportBox = document.getElementById('wellnessSupportBox');
  if(supportBox) supportBox.style.display = bad ? 'block' : 'none';
  saveAll();
}
const MOOD_REPLIES = [
  { keys:['ansiedad','ansioso','ansiosa','nervios','nervioso','nerviosa','estrés','estres','estresado','estresada','pánico','panico','agobiado','agobiada','angustia'],
    tab:'bienestar', mood:'Mal',
    reply:'Gracias por contármelo. Vamos a la sección de Bienestar: ahí tengo pasos rápidos y un ejercicio de respiración guiada que puede ayudarte ahora mismo. Si la ansiedad es muy intensa o persiste, por favor buscá también el apoyo de una persona de confianza o un profesional de salud.' },
  { keys:['cansad','agotad','sin energía','sin energia','exhaust','sueño','no dormí','no dormi','fatiga','me quiero dormir'],
    tab:'bienestar', mood:'Mal',
    reply:'Te escucho. El cansancio es tu cuerpo pidiéndote una pausa: si podés, bajá el ritmo, hidratate y descansá un rato. Te dejo la sección de Bienestar por si querés hacer una respiración guiada antes de descansar.' },
  { keys:['triste','decaíd','decaid','deprimid','sin ganas','desanimad','llorar','llorando','me siento mal'],
    tab:'bienestar', mood:'Mal',
    reply:'Lamento que te sientas así, y me alegra que me lo hayas contado. No tenés que atravesar esto solo/a: hablar con alguien de confianza puede ayudar mucho. Mientras tanto, puedo acompañarte con un ejercicio de respiración en Bienestar.' },
  { keys:['solo','sola','soledad','aislad','nadie me'],
    tab:'bienestar', mood:'Mal',
    reply:'Sentirte solo/a pesa, y quiero que sepas que acá me tenés. Si podés, buscá también acercarte a alguien de confianza; a veces una simple llamada ayuda mucho.' },
  { keys:['miedo','asustad','temo ','me da terror'],
    tab:'bienestar',
    reply:'Entiendo que sientas miedo. Vamos a respirar juntos un momento para calmar el cuerpo, eso suele ayudar a pensar con más claridad. Si tiene que ver con tu salud ahora mismo, contame más para orientarte mejor.' },
  { keys:['enojad','enfurecid','furios','molest','irritad','rabia','bronca'],
    tab:'bienestar',
    reply:'Es válido sentir enojo. Un par de respiraciones lentas pueden bajar la intensidad antes de reaccionar. ¿Querés que hagamos el ejercicio de respiración juntos?' },
  { keys:['duele','dolor','me lastim','me golpe'],
    reply:'Lamento que te esté doliendo. Contame en qué parte del cuerpo es y qué tan intenso es del 1 al 10, así puedo orientarte mejor. Si el dolor es fuerte o repentino, buscá atención médica cuanto antes.' },
  { keys:['feliz','content','genial','de maravilla','súper bien','super bien','estoy bien','me siento bien','excelente'],
    mood:'Muy bien',
    reply:'¡Qué alegría escuchar eso! Me encanta saber que estás bien. Seguí cuidándote así, y contame si en algún momento necesitás algo.' },
  { keys:['aburrid'],
    reply:'El aburrimiento también es una señal de que tu cuerpo y mente quieren algo distinto. Podemos hacer un ejercicio de respiración o revisar tus signos vitales, si eso te ayuda a distraerte un poco.' },
  { keys:['gracias'],
    reply:'¡De nada! Estoy para acompañarte siempre que lo necesites.' },
];
function detectMood(t){
  for(const entry of MOOD_REPLIES){ if(entry.keys.some(k=>t.includes(k))) return entry; }
  return null;
}
function answerQuestion(q){
  const t = q.toLowerCase();
  if(t.includes('respiraci')) { switchTab('bienestar'); return 'Vamos a la sección de Bienestar para hacer un ejercicio de respiración juntos.'; }
  if(t.includes('últimas mediciones') || t.includes('ultimas mediciones') || t.includes('historial')) { switchTab('historial'); return 'Te muestro tus últimas mediciones en la sección de Historial.'; }
  if(t.includes('pulso') || t.includes('ritmo')) return (state.connected && state.bpm!=null) ? `Tu pulso registrado es de ${state.bpm} BPM.` : 'Todavía no tengo una lectura de pulso disponible porque no hay un ESP32 conectado ni el modo demostración activo.';
  if(t.includes('oxígeno') || t.includes('oxigeno') || t.includes('spo2')) return (state.connected && state.spo2!=null) ? `Tu oxigenación registrada es de ${state.spo2}%.` : 'Todavía no tengo una lectura de oxigenación disponible porque no hay un ESP32 conectado ni el modo demostración activo.';
  if(t.includes('temperatura')) return (state.connected && state.tempCorp!=null) ? `Tu temperatura corporal registrada es de ${state.tempCorp.toFixed(1)}°C.` : 'Todavía no tengo una lectura de temperatura disponible porque no hay un ESP32 conectado ni el modo demostración activo.';
  if(t.includes('cómo estoy') || t.includes('como estoy')) {
    if(!state.connected) return 'Todavía no tengo datos porque no hay una conexión activa. Conecta tu ESP32 o activa el modo demostración.';
    const interp = interpretation({bpm:state.bpm, spo2:state.spo2, tempCorp:state.tempCorp, mood:profile.mood});
    return interp.text;
  }
  const mood = detectMood(t);
  if(mood){
    if(mood.mood) setMoodFromChat(mood.mood);
    if(mood.tab) switchTab(mood.tab);
    return mood.reply;
  }
  return 'Contame cómo te sentís o preguntame por tu pulso, oxigenación, temperatura, tus últimas mediciones, o si querés hacer un ejercicio de respiración conmigo.';
}
async function sendChat(text){
  if(!text.trim()) return;
  addMsg(text, 'user');
  document.getElementById('chatInput').value = '';
  const typingEl = showTyping();

  // La detección local de ánimo se sigue ejecutando siempre: así Baymax
  // guarda tu estado de ánimo y te lleva a Bienestar aunque la respuesta
  // final venga de la IA.
  const moodHit = detectMood(text.toLowerCase());

  const aiReply = await getAIReply(text);
  let reply;
  if(aiReply){
    reply = aiReply;
    if(moodHit){
      if(moodHit.mood) setMoodFromChat(moodHit.mood);
      if(moodHit.tab) switchTab(moodHit.tab);
    }
  } else {
    reply = answerQuestion(text); // respaldo: sistema de reglas de siempre
  }

  typingEl.remove();
  addMsg(reply, 'bot');
  speak(reply);
}
document.getElementById('btnChatSend').addEventListener('click', ()=> sendChat(document.getElementById('chatInput').value));
document.getElementById('chatInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(e.target.value); });
document.querySelectorAll('.chip-btn').forEach(b=> b.addEventListener('click', ()=> sendChat(b.dataset.q)));

/* Reconocimiento de voz (opcional, si el navegador lo soporta) */
const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if(SpeechRecognitionClass){
  recognizer = new SpeechRecognitionClass();
  recognizer.lang = 'es-ES';
  recognizer.onresult = (e)=>{ const text = e.results[0][0].transcript; sendChat(text); };
  recognizer.onend = ()=> document.getElementById('btnMic').setAttribute('data-listening','false');
}
document.getElementById('btnMic').addEventListener('click', ()=>{
  if(!recognizer){ addMsg('Este navegador no soporta reconocimiento de voz. Escríbeme tu mensaje.', 'bot'); return; }
  document.getElementById('btnMic').setAttribute('data-listening','true');
  recognizer.start();
});

/* Burbuja flotante de Tadashi */
const chatBubbleBtn = document.getElementById('chatBubbleBtn');
const chatFloatPanel = document.getElementById('chatFloatPanel');
const chatBubbleIcon = document.getElementById('chatBubbleIcon');
const chatBubbleDot = document.getElementById('chatBubbleDot');
let chatPanelOpen = false;
let chatHasGreeted = false;

function openChatPanel(){
  chatPanelOpen = true;
  chatFloatPanel.hidden = false;
  requestAnimationFrame(()=> chatFloatPanel.classList.add('open'));
  chatBubbleBtn.setAttribute('aria-expanded','true');
  chatBubbleIcon.textContent = '✕';
  chatBubbleDot.hidden = true;
  if(!chatHasGreeted){
    chatHasGreeted = true;
    addMsg('¡Hola! Soy Tadashi. Contame cómo te sentís o preguntame por tus signos vitales.', 'bot');
  }
  document.getElementById('chatInput').focus();
}
function closeChatPanel(){
  chatPanelOpen = false;
  chatFloatPanel.classList.remove('open');
  chatBubbleBtn.setAttribute('aria-expanded','false');
  chatBubbleIcon.textContent = '💬';
  setTimeout(()=>{ if(!chatPanelOpen) chatFloatPanel.hidden = true; }, 250);
}
chatBubbleBtn.addEventListener('click', ()=> chatPanelOpen ? closeChatPanel() : openChatPanel());
document.getElementById('btnChatFloatClose').addEventListener('click', closeChatPanel);

/* ===================== BIENESTAR ===================== */
document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    profile.mood = btn.dataset.mood;
    const bad = profile.mood==='Mal' || profile.mood==='Muy mal';
    document.getElementById('wellnessSupportBox').style.display = bad ? 'block' : 'none';
    if(bad) speak('Gracias por contarme cómo te sentís. Estoy acá para acompañarte.');
    saveAll();
  });
});
let breathingActive = false;
function runBreathingCycle(){
  if(!breathingActive) return;
  const orb = document.getElementById('breatheOrb');
  const phaseEl = document.getElementById('breathePhase');
  const countEl = document.getElementById('breatheCount');
  const phases = [ {name:'Inhalar', secs:4, grow:true}, {name:'Mantener', secs:3, grow:true}, {name:'Exhalar', secs:4, grow:false} ];
  let i = 0;
  function step(){
    if(!breathingActive) return;
    const p = phases[i];
    phaseEl.textContent = p.name;
    orb.classList.toggle('grow', p.grow);
    let remaining = p.secs;
    countEl.textContent = remaining;
    const tick = setInterval(()=>{
      remaining--;
      countEl.textContent = Math.max(remaining,0);
      if(remaining<=0){
        clearInterval(tick);
        i = (i+1) % phases.length;
        if(!breathingActive) return;
        step();
      }
    },1000);
  }
  step();
}
function startBreathingExercise(){
  document.getElementById('breatheStage').classList.remove('hidden');
  breathingActive = true;
  speak('Podemos hacer un pequeño ejercicio de respiración. Seguime con la esfera: inhalá, sostené y exhalá despacio.');
  runBreathingCycle();
  document.getElementById('breatheStage').scrollIntoView({behavior:'smooth', block:'center'});
}
document.getElementById('btnStartBreathing').addEventListener('click', startBreathingExercise);
document.getElementById('btnAnxietyBreathing').addEventListener('click', startBreathingExercise);
document.getElementById('btnStopBreathing').addEventListener('click', ()=>{ breathingActive = false; document.getElementById('breatheStage').classList.add('hidden'); });

/* ===================== SISTEMA / CONFIG ===================== */
document.getElementById('prefDark').addEventListener('change', (e)=>{ document.body.setAttribute('data-theme', e.target.checked ? 'dark':'light'); saveAll(); });
document.getElementById('prefAnim').addEventListener('change', (e)=>{ document.body.classList.toggle('reduced-anim', !e.target.checked); saveAll(); });
document.getElementById('prefVoice').addEventListener('change', (e)=>{ voiceEnabled = e.target.checked; updateVoiceButton(); saveAll(); });
document.getElementById('prefSound').addEventListener('change', ()=>{ saveAll(); });
if(document.getElementById('prefRobotVoice')) document.getElementById('prefRobotVoice').addEventListener('change', saveAll);
document.getElementById('btnClearHistory').addEventListener('click', ()=>{ if(confirm('¿Eliminar todo el historial de revisiones y lecturas?')){ reviews = []; state.history = []; renderReviewsList(); renderHistory(); saveAll(); } });
document.getElementById('btnClearProfile').addEventListener('click', ()=>{
  if(!confirm('¿Eliminar tu perfil (nombre, edad, foto, estado)?')) return;
  Object.assign(profile,{name:'',lastname:'',age:null,phone:'',email:'',photo:null,avatar:null,mood:null});
  renderHero(); renderProfileSummary(); renderAvatarMini(); saveAll();
  // Sin perfil no tiene sentido dejar a la persona dentro de la app: le mostramos
  // de una vez el formulario de registro para que pueda crear uno nuevo.
  openRegistrationModal();
});
function openRegistrationModal(){
  ['regName','regLastname','regAge','regPhone','regEmail'].forEach(id=>{ document.getElementById(id).value=''; setFieldError(id, 'err'+id.slice(3), ''); });
  document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=>b.classList.remove('selected'));
  applyPhotoPreview();
  updateRegProgress();
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('welcomeModal').classList.remove('hidden');
}
document.getElementById('btnClearPhotos').addEventListener('click', ()=>{ if(confirm('¿Eliminar todas las fotografías guardadas?')){ profile.photo=null; reviews.forEach(r=>r.photo=null); renderReviewsList(); renderProfileSummary(); renderAvatarMini(); saveAll(); } });
document.getElementById('btnMyProfile').addEventListener('click', ()=> switchTab('config'));

/* ===================== MENÚ (hamburguesa) ===================== */
function setMenuOpen(open){
  document.getElementById('btnMenu').classList.toggle('open', open);
  document.getElementById('btnMenu').setAttribute('aria-expanded', open ? 'true' : 'false');
  document.getElementById('tabsNav').classList.toggle('open', open);
  document.getElementById('menuBackdrop').classList.toggle('open', open);
}
document.getElementById('btnMenu').addEventListener('click', ()=>{
  setMenuOpen(!document.getElementById('tabsNav').classList.contains('open'));
});
document.getElementById('menuBackdrop').addEventListener('click', ()=> setMenuOpen(false));

/* ===================== TABS ===================== */
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+tab));
  setMenuOpen(false);
  if(tab==='chat' || tab==='panel' || tab==='bienestar'){ waveMascot('#heroFace, .brand-face'); }
  if(tab==='ecg'){
    // Recién ahora la pestaña deja de tener display:none, así que recién ahora
    // el canvas tiene un tamaño real que medir.
    requestAnimationFrame(resizeCanvas);
  }
  if(tab==='latidos') updateHeartbeatVisual();
}
document.querySelectorAll('.tab-btn').forEach(btn=> btn.addEventListener('click', ()=> switchTab(btn.dataset.tab)));

/* ===================== RELOJ ===================== */
function tickClock(){ document.getElementById('clock').textContent = new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}); }
setInterval(tickClock, 1000); tickClock();

/* ===================== VOZ (estilo robot de cuidado, inspirado en Baymax) ===================== */
let voiceEnabled = true;
let spanishVoice = null;
const speechSupported = ('speechSynthesis' in window);
function pickRoboticVoice(voices){
  // Preferimos una voz masculina/neutra en español, de tono más grave, para acercarnos
  // al timbre cálido y "robótico-amigable" de un robot de cuidado como Baymax.
  const esVoices = voices.filter(v=>v.lang && v.lang.toLowerCase().startsWith('es'));
  const nameMatch = /male|hombre|jorge|diego|carlos|pablo|raul|raúl|juan|miguel|google\s*español/i;
  const preferred = esVoices.find(v=>nameMatch.test(v.name)) || esVoices[0];
  return preferred || voices[0] || null;
}
// Inserta micro-pausas después de puntos y comas para que la voz sintetizada
// suene más pausada y menos apurada, más parecida a la cadencia calmada y
// "acolchada" de Baymax (Web Speech API no soporta SSML, así que usamos este truco simple).
function addCarePauses(text){
  return text.replace(/([.!?])\s+/g, '$1   ').replace(/,\s+/g, ',  ');
}
function loadVoices(){ if(!speechSupported) return; const voices = window.speechSynthesis.getVoices(); spanishVoice = pickRoboticVoice(voices); }
if(speechSupported){ loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices; }
function setSpeakingVisual(on){ document.querySelectorAll('.baymax-face').forEach(f=> f.classList.toggle('speaking', on)); }

/* ===================== REACCIONES DE LA MASCOTA 3D ===================== */
// La figura 3D de Baymax saluda o salta de alegría según lo que hacés en la web
// (cambiar de pestaña, terminar una revisión con buenos resultados, etc.).
function waveMascot(selector){
  document.querySelectorAll(selector || '.baymax-face').forEach(f=>{
    f.classList.remove('waving'); void f.offsetWidth; f.classList.add('waving');
    setTimeout(()=> f.classList.remove('waving'), 1900);
  });
}
function happyMascot(selector){
  document.querySelectorAll(selector || '.baymax-face').forEach(f=>{
    f.classList.remove('happy'); void f.offsetWidth; f.classList.add('happy');
    setTimeout(()=> f.classList.remove('happy'), 650);
  });
}

/* ---- Clip real de Baymax (audio pregrabado que subiste) -----------------------------
   El navegador no puede "clonar" una voz real solo con síntesis de texto (Web Speech API
   únicamente usa las voces instaladas en el sistema/navegador). Lo que sí podemos hacer,
   y lo que hicimos aquí, es:
   1) Reproducir tu clip de audio real de Baymax en el saludo inicial (pantalla de arranque),
      que es un texto fijo y coincide con lo que dice el audio.
   2) Para todo el resto de mensajes (dinámicos: alertas, chat, resultados de revisión, etc.)
      seguimos usando síntesis de voz, pero afinada (tono más grave, más lenta, con pausas)
      para que se sienta lo más parecida posible al timbre calmado de Baymax.
   Si en el futuro quieres que TODO se escuche exactamente como el clip, se necesitaría un
   servicio externo de clonación de voz (por ejemplo, una API de texto-a-voz de pago) que
   genere audio en un servidor; eso no es posible hacerlo 100% gratis y offline solo con HTML/JS. */
const BAYMAX_HELLO_AUDIO_SRC = 'assets/audio/baymax-hola.mp3';
const baymaxHelloAudio = new Audio(BAYMAX_HELLO_AUDIO_SRC);
baymaxHelloAudio.preload = 'auto';

function playBaymaxHello(fallbackText){
  if(!voiceEnabled){ return; }
  if(!baymaxHelloAudio){ speak(fallbackText); return; }
  try{
    window.speechSynthesis && window.speechSynthesis.cancel();
    baymaxHelloAudio.pause();
    baymaxHelloAudio.currentTime = 0;
    setSpeakingVisual(true);
    baymaxHelloAudio.onended = ()=> setSpeakingVisual(false);
    baymaxHelloAudio.onerror = ()=>{ setSpeakingVisual(false); speak(fallbackText); };
    const p = baymaxHelloAudio.play();
    if(p && p.catch) p.catch((err)=>{ setSpeakingVisual(false); logLine && logLine('No se pudo reproducir el audio de Baymax: '+err, 'err'); speak(fallbackText); });
  }catch(e){ speak(fallbackText); }
}

function speak(text){
  if(!voiceEnabled || !speechSupported || !text) return;
  try{
    window.speechSynthesis.cancel();
    const robotic = document.getElementById('prefRobotVoice') ? document.getElementById('prefRobotVoice').checked : true;
    const utter = new SpeechSynthesisUtterance(robotic ? addCarePauses(text) : text);
    utter.lang = spanishVoice ? spanishVoice.lang : 'es-ES';
    if(spanishVoice) utter.voice = spanishVoice;
    // Tono grave y ritmo lento: es lo más cerca que la síntesis del navegador puede llegar
    // al timbre suave, pausado y ligeramente mecánico de Baymax.
    utter.rate = robotic ? 0.78 : 0.95;
    utter.pitch = robotic ? 0.55 : 1.0;
    utter.volume = 1;
    utter.onstart = ()=> setSpeakingVisual(true);
    utter.onend = ()=> setSpeakingVisual(false);
    utter.onerror = ()=> setSpeakingVisual(false);
    window.speechSynthesis.speak(utter);
  }catch(e){}
}
function updateVoiceButton(){
  const btn = document.getElementById('btnVoiceToggle');
  btn.setAttribute('data-state', voiceEnabled ? 'on' : 'off');
  document.getElementById('voiceIcon').textContent = voiceEnabled ? '🔊' : '🔇';
  document.getElementById('voiceLabelText').textContent = voiceEnabled ? 'Voz activada' : 'Voz silenciada';
  document.getElementById('prefVoice').checked = voiceEnabled;
}
document.getElementById('btnVoiceToggle').addEventListener('click', ()=>{ voiceEnabled = !voiceEnabled; updateVoiceButton(); if(!voiceEnabled && speechSupported) window.speechSynthesis.cancel(); });
document.getElementById('btnTestVoice').addEventListener('click', ()=>{
  if(!voiceEnabled){ voiceEnabled = true; updateVoiceButton(); }
  // Primero se escucha tu clip real de Baymax completo, y cuando termina, un ejemplo de cómo
  // suena la voz sintetizada afinada para las alertas y el resto de la app.
  if(baymaxHelloAudio){
    window.speechSynthesis && window.speechSynthesis.cancel();
    baymaxHelloAudio.currentTime = 0;
    setSpeakingVisual(true);
    baymaxHelloAudio.onended = ()=>{ setSpeakingVisual(false); speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.'); };
    baymaxHelloAudio.onerror = ()=>{ setSpeakingVisual(false); speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.'); };
    const p = baymaxHelloAudio.play();
    if(p && p.catch) p.catch(()=>{ setSpeakingVisual(false); speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.'); });
  } else if(speechSupported){
    speak('Así sueno cuando te aviso algo importante sobre tus signos vitales.');
  } else {
    logLine('Este navegador no soporta síntesis de voz.', 'err');
  }
});
document.getElementById('btnPermission').addEventListener('click', ()=>{ if(!('Notification' in window)){ logLine('Este navegador no soporta notificaciones.', 'err'); return; } Notification.requestPermission().then(p=>{ logLine('Permiso de notificaciones: ' + p, 'info'); }); });
document.getElementById('btnTestNotif').addEventListener('click', ()=>{ pushNotification('warning', 'Aviso de prueba', 'Así se verá una notificación real de Baymax.'); });

/* ===================== OJOS + PARPADEO ===================== */
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function updateEyeTracking(clientX, clientY){
  if(reduceMotion || document.body.classList.contains('reduced-anim')) return;
  document.querySelectorAll('.baymax-face').forEach(face=>{
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const dx = clientX - cx, dy = clientY - cy;
    const dist = Math.min(1, Math.hypot(dx,dy)/400);
    const max = rect.width * 0.09;
    const ox = (dx / (Math.hypot(dx,dy)||1)) * max * dist;
    const oy = (dy / (Math.hypot(dx,dy)||1)) * max * dist * 0.6;
    face.querySelectorAll('.pupil').forEach(p=>{ p.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`; });
    // Giro sutil de la cabeza en 3D hacia el cursor, para reforzar el efecto de figura tridimensional.
    const head = face.querySelector('.mascot-head');
    if(head && face.getAttribute('data-status')!=='scanning'){
      const rx = (-dy / (Math.hypot(dx,dy)||1)) * 6 * dist;
      const ry = (dx / (Math.hypot(dx,dy)||1)) * 8 * dist;
      head.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    }
  });
}
window.addEventListener('mousemove', (e)=> updateEyeTracking(e.clientX, e.clientY));
window.addEventListener('touchmove', (e)=>{ if(e.touches[0]) updateEyeTracking(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
function blinkAll(){
  if(reduceMotion || document.body.classList.contains('reduced-anim')) return;
  document.querySelectorAll('.baymax-face').forEach(f=>f.classList.add('blink'));
  setTimeout(()=>document.querySelectorAll('.baymax-face').forEach(f=>f.classList.remove('blink')), 140);
}
setInterval(blinkAll, 4200 + Math.random()*2000);

/* ===================== REGISTRO: FOTO / AVATAR / CÁMARA ===================== */
function applyPhotoPreview(){
  // Actualiza tanto la vista previa del registro como la del editor de perfil en Configuración.
  [
    {prev:'regPhotoPreview', removeBtn:'btnRegPhotoRemove'},
    {prev:'cfgPhotoPreview', removeBtn:'btnCfgPhotoRemove'}
  ].forEach(({prev:prevId, removeBtn:removeBtnId})=>{
    const prev = document.getElementById(prevId);
    const removeBtn = document.getElementById(removeBtnId);
    if(!prev) return;
    if(profile.photo){
      prev.classList.remove('empty');
      prev.innerHTML = `<img src="${profile.photo}" alt="Foto">`;
      if(removeBtn) removeBtn.classList.remove('hidden');
    } else if(profile.avatar){
      prev.classList.remove('empty');
      prev.innerHTML = `<span style="font-size:30px;">${profile.avatar}</span>`;
      if(removeBtn) removeBtn.classList.remove('hidden');
    } else {
      prev.classList.add('empty'); prev.innerHTML = '📷';
      if(removeBtn) removeBtn.classList.add('hidden');
    }
  });
  renderAvatarMini();
  renderProfileSummary();
}
document.getElementById('btnRegPhotoUpload').addEventListener('click', ()=> document.getElementById('regPhotoInput').click());
document.getElementById('regPhotoInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{ profile.photo = reader.result; profile.avatar=null; applyPhotoPreview(); saveAll(); };
  reader.readAsDataURL(file);
});
document.getElementById('btnRegPhotoRemove').addEventListener('click', ()=>{ profile.photo=null; profile.avatar=null; applyPhotoPreview(); saveAll(); });

const avatarGrid = document.getElementById('avatarGrid');
avatarGrid.innerHTML = AVATAR_EMOJIS.map(e=>`<button type="button" data-avatar="${e}">${e}</button>`).join('');
document.getElementById('btnRegPhotoAvatar').addEventListener('click', ()=>{
  avatarGrid.classList.toggle('hidden');
  document.getElementById('cameraBox').classList.add('hidden');
  stopCamera();
});
avatarGrid.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-avatar]');
  if(!btn) return;
  profile.avatar = btn.dataset.avatar;
  profile.photo = null;
  avatarGrid.querySelectorAll('button').forEach(b=>b.classList.toggle('selected', b===btn));
  applyPhotoPreview();
  saveAll();
});

const cameraBox = document.getElementById('cameraBox');
const cameraVideo = document.getElementById('cameraVideo');
const cameraCanvas = document.getElementById('cameraCanvas');
async function startCamera(videoEl, boxEl, gridToHide){
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
    videoEl.srcObject = cameraStream;
    boxEl.classList.remove('hidden');
    if(gridToHide) gridToHide.classList.add('hidden');
  }catch(err){
    alert('No se pudo acceder a la cámara. Revisa los permisos del navegador o sube una imagen en su lugar.');
  }
}
function stopCamera(boxEl){
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream = null; }
  if(boxEl) boxEl.classList.add('hidden');
  else { cameraBox.classList.add('hidden'); }
}
document.getElementById('btnRegPhotoCamera').addEventListener('click', ()=>startCamera(cameraVideo, cameraBox, avatarGrid));
document.getElementById('btnCameraCancel').addEventListener('click', ()=>stopCamera(cameraBox));
document.getElementById('btnCameraShot').addEventListener('click', ()=>{
  const w = cameraVideo.videoWidth || 320, h = cameraVideo.videoHeight || 240;
  cameraCanvas.width = w; cameraCanvas.height = h;
  const cctx = cameraCanvas.getContext('2d');
  cctx.drawImage(cameraVideo, 0, 0, w, h);
  profile.photo = cameraCanvas.toDataURL('image/jpeg', 0.85);
  profile.avatar = null;
  applyPhotoPreview();
  stopCamera(cameraBox);
  saveAll();
});

/* ---- Editor de foto/avatar en Configuración (mismo mecanismo, disponible siempre) ---- */
const cfgPhotoInputEl = document.getElementById('cfgPhotoInput');
if(cfgPhotoInputEl){
  document.getElementById('btnCfgPhotoUpload').addEventListener('click', ()=> cfgPhotoInputEl.click());
  cfgPhotoInputEl.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{ profile.photo = reader.result; profile.avatar=null; applyPhotoPreview(); saveAll(); };
    reader.readAsDataURL(file);
  });
  document.getElementById('btnCfgPhotoRemove').addEventListener('click', ()=>{ profile.photo=null; profile.avatar=null; applyPhotoPreview(); saveAll(); });

  const cfgAvatarGrid = document.getElementById('cfgAvatarGrid');
  cfgAvatarGrid.innerHTML = AVATAR_EMOJIS.map(e=>`<button type="button" data-avatar="${e}">${e}</button>`).join('');
  const cfgCameraBox = document.getElementById('cfgCameraBox');
  const cfgCameraVideo = document.getElementById('cfgCameraVideo');
  const cfgCameraCanvas = document.getElementById('cfgCameraCanvas');

  document.getElementById('btnCfgPhotoAvatar').addEventListener('click', ()=>{
    cfgAvatarGrid.classList.toggle('hidden');
    cfgCameraBox.classList.add('hidden');
    stopCamera(cfgCameraBox);
  });
  cfgAvatarGrid.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-avatar]');
    if(!btn) return;
    profile.avatar = btn.dataset.avatar;
    profile.photo = null;
    cfgAvatarGrid.querySelectorAll('button').forEach(b=>b.classList.toggle('selected', b===btn));
    applyPhotoPreview();
    saveAll();
  });

  document.getElementById('btnCfgPhotoCamera').addEventListener('click', ()=>startCamera(cfgCameraVideo, cfgCameraBox, cfgAvatarGrid));
  document.getElementById('btnCfgCameraCancel').addEventListener('click', ()=>stopCamera(cfgCameraBox));
  document.getElementById('btnCfgCameraShot').addEventListener('click', ()=>{
    const w = cfgCameraVideo.videoWidth || 320, h = cfgCameraVideo.videoHeight || 240;
    cfgCameraCanvas.width = w; cfgCameraCanvas.height = h;
    const cctx = cfgCameraCanvas.getContext('2d');
    cctx.drawImage(cfgCameraVideo, 0, 0, w, h);
    profile.photo = cfgCameraCanvas.toDataURL('image/jpeg', 0.85);
    profile.avatar = null;
    applyPhotoPreview();
    stopCamera(cfgCameraBox);
    saveAll();
  });
}

document.querySelectorAll('#regMoodGrid .mood-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    profile.mood = btn.dataset.mood;
  });
});

/* ===================== VALIDACIÓN DE FORMULARIO ===================== */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s()-]{7,15}$/;
function setFieldError(id, errId, message){
  document.getElementById(id).classList.toggle('invalid', !!message);
  document.getElementById(errId).textContent = message || '';
}
function validateForm(){
  let ok = true;
  const name = document.getElementById('regName').value.trim();
  const lastname = document.getElementById('regLastname').value.trim();
  const age = document.getElementById('regAge').value;
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim();

  if(name.length < 2){ setFieldError('regName','errName','Escribe tu nombre (mínimo 2 letras).'); ok=false; } else setFieldError('regName','errName','');
  if(lastname.length < 2){ setFieldError('regLastname','errLastname','Escribe tu apellido (mínimo 2 letras).'); ok=false; } else setFieldError('regLastname','errLastname','');
  const ageNum = Number(age);
  if(!age || isNaN(ageNum) || ageNum < 1 || ageNum > 120){ setFieldError('regAge','errAge','Ingresa una edad válida (1–120).'); ok=false; } else setFieldError('regAge','errAge','');
  if(!PHONE_RE.test(phone)){ setFieldError('regPhone','errPhone','Ingresa un número de teléfono válido.'); ok=false; } else setFieldError('regPhone','errPhone','');
  if(!EMAIL_RE.test(email)){ setFieldError('regEmail','errEmail','Ingresa un correo electrónico válido.'); ok=false; } else setFieldError('regEmail','errEmail','');

  updateRegProgress();
  return ok;
}
function updateRegProgress(){
  const fields = ['regName','regLastname','regAge','regPhone','regEmail'];
  const filled = fields.filter(id=>document.getElementById(id).value.trim().length>0).length;
  document.getElementById('regProgressFill').style.width = (filled/fields.length*100)+'%';
}
['regName','regLastname','regAge','regPhone','regEmail'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateRegProgress);
});

document.getElementById('regForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!validateForm()) return;
  profile.name = document.getElementById('regName').value.trim();
  profile.lastname = document.getElementById('regLastname').value.trim();
  profile.age = Number(document.getElementById('regAge').value);
  profile.phone = document.getElementById('regPhone').value.trim();
  profile.email = document.getElementById('regEmail').value.trim();
  // Antes se asignaba un avatar al azar si el usuario no elegía ninguno.
  // Ahora respetamos su elección: si no eligió foto ni avatar, se queda sin avatar
  // (se muestra un ícono genérico) y puede elegirlo cuando quiera desde su perfil.
  saveAll();
  document.getElementById('welcomeModal').classList.add('hidden');
  enterApp(false);
});

document.getElementById('btnGuest').addEventListener('click', ()=>{
  document.getElementById('welcomeModal').classList.add('hidden');
  enterApp(false);
});

/* ===================== BOOT + PANTALLA "PREPARANDO EXPERIENCIA" + REGISTRO ===================== */
const PREP_STEPS = [
  'Calibrando sensores virtuales…',
  'Ajustando mi voz y personalidad de cuidado…',
  'Preparando tu panel de bienestar…',
  'Cargando consejos y datos curiosos del día…'
];
function runPrepScreen(callback){
  const prep = document.getElementById('prepScreen');
  const stepsBox = document.getElementById('prepSteps');
  const msg = document.getElementById('prepMsg');
  stepsBox.innerHTML = PREP_STEPS.map((s,i)=>`<div class="prep-step" id="prepStep${i}"><span class="chk"></span><span>${s}</span></div>`).join('');
  prep.classList.remove('hidden');
  let i = 0;
  msg.textContent = PREP_STEPS[0];
  function nextStep(){
    if(i>0){ const prevEl = document.getElementById('prepStep'+(i-1)); if(prevEl){ prevEl.classList.add('done'); prevEl.querySelector('.chk').textContent='✓'; } }
    if(i >= PREP_STEPS.length){
      setTimeout(()=>{ prep.classList.add('hidden'); callback(); }, 400);
      return;
    }
    msg.textContent = PREP_STEPS[i];
    i++;
    setTimeout(nextStep, 550);
  }
  nextStep();
}

let bootProgressInterval = null;
function animateBootProgress(){
  const bar = document.getElementById('bootProgressBar');
  let pct = 0;
  bootProgressInterval = setInterval(()=>{
    pct = Math.min(100, pct + Math.random()*18);
    bar.style.width = pct + '%';
    if(pct>=100) clearInterval(bootProgressInterval);
  }, 220);
}
animateBootProgress();

document.getElementById('btnBootStart').addEventListener('click', ()=>{
  // Este es el saludo fijo de arranque, así que usamos tu clip real de Baymax en vez de la voz sintetizada.
  waveMascot('#bootFaceWrap .baymax-face');
  playBaymaxHello('Hola. Soy Baymax, tu asistente personal de bienestar.');
  const boot = document.getElementById('bootScreen');
  boot.classList.add('fade-out');
  setTimeout(()=>{
    boot.classList.add('hidden');
    if(hasSavedProfile && profile.name){
      enterApp(true);
    } else {
      runPrepScreen(()=>{
        document.getElementById('welcomeModal').classList.remove('hidden');
        updateRegProgress();
      });
    }
  }, 650);
});

function enterApp(returning){
  document.getElementById('welcomeModal').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const helloText = returning
    ? (profile.name ? `${greeting} de nuevo, ${profile.name}. Recuperé tus datos guardados. Sistema listo.` : `${greeting} de nuevo. Recuperé tus datos guardados. Sistema listo.`)
    : (profile.name ? `${greeting}, ${profile.name}. Voy a estar acompañándote mientras reviso tus signos vitales. Sistema listo, puedes comenzar a navegar.` : `${greeting}. Sistema listo, puedes comenzar a navegar.`);
  addMsg(helloText, 'bot');
  renderAll();
  updateVoiceButton();
  updateHeartbeatVisual();
  speak(helloText);
  showSystemReadyToast();
}
function showSystemReadyToast(){
  pushNotificationSilent('normal', 'Sistema listo', 'Baymax está en línea. Ya puedes navegar por todas las secciones.');
}
function pushNotificationSilent(level, title, body){
  notifications.push({level, title, body, ts: Date.now()});
  renderNotifications();
  saveAll();
}

/* ===================== INICIO ===================== */
const hasSavedProfile = loadAll();
renderAll();
updateVoiceButton();
if(hasSavedProfile){
  document.getElementById('regName').value = profile.name || '';
  document.getElementById('regLastname').value = profile.lastname || '';
  document.getElementById('regAge').value = profile.age || '';
  document.getElementById('regPhone').value = profile.phone || '';
  document.getElementById('regEmail').value = profile.email || '';
  if(profile.mood){
    document.querySelectorAll('#regMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===profile.mood));
    document.querySelectorAll('#wellnessMoodGrid .mood-btn').forEach(b=> b.classList.toggle('selected', b.dataset.mood===profile.mood));
  }
  applyPhotoPreview();
}
resizeHeartCanvas();
logLine('Página lista. Conecta tu ESP32 o activa el modo demostración.', 'info');