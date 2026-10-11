// ============================================================
//  lógica.js — Toda la lógica del cliente
//  - Llama la API (código.gs) y recibe los datos crudos
//  - Busca, filtra y calcula todo en el navegador
//  - Dibuja la credencial, dashboard y escáner
// ============================================================

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby_1g7WcsKdbwtsgwvUYimF_-aXtYfTo6n--W-WBXHYglrKs8J_xqlR8SZ8EIFLNf_wyQ/exec";

// ─── NOMBRES DE COLUMNA ─────────────────────────────────────
// Usamos el número de columna (ej. col1 = Columna B) para que no
// falle si los encabezados tienen saltos de línea o cambian.
const COL = {
    nombre: "col1",      // Columna B (índice 1)
    correo: "col2",      // Columna C (índice 2)
    telefono: "col3",    // Columna D (índice 3)
    iglesia: "col4",     // Columna E (índice 4)
    dias: "col5",        // Columna F (índice 5)
    almuerzo: "col6",    // Columna G (índice 6)
    alojamiento: "col7", // Columna H (índice 7)
    asistenciaSabado: "col8",         // Columna I (índice 8)
    asistenciaDomingo: "col9",        // Columna J (índice 9)
    almuerzoSabadoEntregado: "col10", // Columna K (índice 10)
    almuerzoDomingoEntregado: "col11", // Columna L (índice 11)
    estadoAlmuerzo: "col12"           // Columna M (índice 12)
};

// Función auxiliar para determinar si una opción de alimentación requiere almuerzo
function participanteRequiereAlmuerzo(almuerzoValor) {
    if (!almuerzoValor) return false;
    const str = String(almuerzoValor).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (str.includes("no requerire") || str.includes("no requiere") || str === "--" || str === "") {
        return false;
    }
    return str.includes("sabado") || str.includes("domingo") || str === "si" || str === "yes" || str.includes("ambos");
}

// Función auxiliar para determinar si requiere almuerzo AMBOS días (Sábado y Domingo)
function participanteRequiereAmbosAlmuerzos(almuerzoValor) {
    if (!almuerzoValor) return false;
    const str = String(almuerzoValor).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (str.includes("no requerire") || str.includes("no requiere") || str === "--" || str === "") {
        return false;
    }
    const tieneSab = str.includes("sabado");
    const tieneDom = str.includes("domingo");
    const esAmbos = (tieneSab && tieneDom) || str.includes("ambos");
    return esAmbos;
}

// Función para obtener el estado del almuerzo normalizado según si asiste 1 día o ambos días
function obtenerEstadoAlmuerzoNormalizado(estadoRaw, almuerzoValor) {
    const raw = String(estadoRaw || '').trim();
    let texto = raw || 'Pendiente';
    const lower = texto.toLowerCase();

    if (lower.includes('diario')) {
        // "Pago diario" solo aplica para quienes requieren almuerzo sábado y domingo;
        // para quienes asisten un solo día (ej. sólo sábado), es equivalente a Pago completo.
        if (participanteRequiereAmbosAlmuerzos(almuerzoValor)) {
            return 'Pago diario';
        } else {
            return 'Pago completo';
        }
    } else if (lower.includes('completo') || lower.includes('pagado')) {
        return 'Pago completo';
    } else if (lower.includes('subvencion')) {
        return 'Almuerzo subvencionado';
    } else {
        return 'Pendiente';
    }
}

let _datosCache = null;
let html5QrcodeScannerAsistencia = null;
let html5QrcodeScannerAlmuerzo = null;
let _scanPaused = false;

// ─── API: Obtener todos los datos una sola vez ───────────────
function obtenerDatos() {
    if (_datosCache) return Promise.resolve(_datosCache);

    const antiCache = Date.now() + Math.random().toString(36).substring(7);
    return fetch(`${WEB_APP_URL}?nocache=${antiCache}`, { method: 'GET', redirect: 'follow' })
        .then(r => r.json())
        .then(response => {
            if (response.error) throw new Error(response.error);
            _datosCache = response.rows;
            return _datosCache;
        });
}

// ─── BÚSQUEDA: Se hace 100% en el cliente ───────────────────
function buscarParticipante(rows, nombreBuscado) {
    const normalizeStr = str => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const queryWords = normalizeStr(nombreBuscado).split(/\s+/);

    return rows.find(row => {
        const rowName = normalizeStr(String(row[COL.nombre] || ""));
        return queryWords.every(word => rowName.includes(word));
    }) || null;
}

// ─── DASHBOARD: Cálculos en el cliente ──────────────────────
function calcularDashboard(rows) {
    let inscritos = 0;
    let inscritosSabado = 0, inscritosDomingo = 0;
    let asistentesSabado = 0, asistentesDomingo = 0;
    let almuerzos = 0;
    let almuerzosSabado = 0, almuerzosDomingo = 0;
    let almuerzosEntregadosSabado = 0, almuerzosEntregadosDomingo = 0;

    rows.forEach(row => {
        const nombre = String(row[COL.nombre] || "").trim();
        if (nombre) inscritos++;

        const dias = String(row[COL.dias] || "").toLowerCase().trim();
        if (dias.includes("sábado") || dias.includes("sabado")) inscritosSabado++;
        if (dias.includes("domingo")) inscritosDomingo++;

        const almuerzo = String(row[COL.almuerzo] || "").toLowerCase().trim();

        if (almuerzo && !almuerzo.includes("no requeriré")) {
            let pidioSabado = false;
            let pidioDomingo = false;

            if (almuerzo.includes("sábado") || almuerzo.includes("sabado")) pidioSabado = true;
            if (almuerzo.includes("domingo")) pidioDomingo = true;

            // Si la hoja tiene respuestas antiguas de "Sí" o "Yes", los sumamos a ambos
            if (almuerzo === "sí" || almuerzo === "si" || almuerzo === "yes") {
                pidioSabado = true;
                pidioDomingo = true;
            }

            if (pidioSabado) almuerzosSabado++;
            if (pidioDomingo) almuerzosDomingo++;
        }

        // Calcular asistencias reales y almuerzos entregados
        if (String(row[COL.asistenciaSabado] || "").toLowerCase() === 'sí') asistentesSabado++;
        if (String(row[COL.asistenciaDomingo] || "").toLowerCase() === 'sí') asistentesDomingo++;
        if (String(row[COL.almuerzoSabadoEntregado] || "").toLowerCase() === 'sí') almuerzosEntregadosSabado++;
        if (String(row[COL.almuerzoDomingoEntregado] || "").toLowerCase() === 'sí') almuerzosEntregadosDomingo++;
    });

    // El total general de almuerzos es la suma de los solicitados cada día
    almuerzos = almuerzosSabado + almuerzosDomingo;

    return {
        inscritos,
        inscritosSabado,
        inscritosDomingo,
        asistentesSabado,
        asistentesDomingo,
        almuerzos,
        almuerzosSabado,
        almuerzosDomingo,
        almuerzosEntregadosSabado,
        almuerzosEntregadosDomingo
    };
}

// ─── NAVEGACIÓN ─────────────────────────────────────────────
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');

    // UI/UX MAX: Expandir el contenedor a 1100px solo cuando estamos en el Panel de Administrador
    const appContent = document.querySelector('.app-content');
    if (appContent) {
        if (viewId === 'view-admin-dashboard') {
            appContent.classList.add('admin-mode');
        } else {
            appContent.classList.remove('admin-mode');
        }
    }

    if (viewId !== 'view-admin-dashboard') {
        if (html5QrcodeScannerAsistencia) {
            html5QrcodeScannerAsistencia.clear();
            const r = document.getElementById('reader-asistencia');
            if (r) r.style.display = 'none';
        }
        if (html5QrcodeScannerAlmuerzo) {
            html5QrcodeScannerAlmuerzo.clear();
            const r = document.getElementById('reader-almuerzo');
            if (r) r.style.display = 'none';
        }
    }

    if (viewId === 'view-user-login' || viewId === 'view-home') {
        limpiarCredencial();
    }
}

// ─── PESTAÑAS DEL DASHBOARD ADMIN ───────────────────────────
function switchAdminTab(tabId, btnElement) {
    document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.remove('active-tab'));
    document.getElementById(tabId).classList.add('active-tab');

    document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    btnElement.classList.add('active');
}

// ─── LOGIN ADMIN ────────────────────────────────────────────
function loginAdmin() {
    const pass = document.getElementById('adminPass').value;
    if (pass === 'imi2026') {
        document.getElementById('admin-error').style.display = 'none';
        document.getElementById('adminPass').value = '';
        switchView('view-admin-dashboard');
        cargarDatosDashboard();
    } else {
        document.getElementById('admin-error').style.display = 'block';
    }
}

// ─── LIMPIAR CREDENCIAL ─────────────────────────────────────
function limpiarCredencial() {
    const elName = document.getElementById('cred-name');
    if (elName) elName.innerText = "Cargando...";

    const elIglesia = document.getElementById('cred-iglesia');
    if (elIglesia) elIglesia.innerText = "--";

    const elAlmuerzo = document.getElementById('cred-almuerzo');
    if (elAlmuerzo) elAlmuerzo.innerText = "--";

    const elAlmuerzoBadge = document.getElementById('cred-badge-almuerzo');
    if (elAlmuerzoBadge) elAlmuerzoBadge.style.display = 'inline-flex';

    const elEstadoAlmuerzoBadge = document.getElementById('cred-badge-estado-almuerzo');
    if (elEstadoAlmuerzoBadge) {
        elEstadoAlmuerzoBadge.style.display = 'none';
        elEstadoAlmuerzoBadge.classList.remove('estado-pagado', 'estado-pago-completo', 'estado-pago-diario', 'estado-pendiente', 'estado-subvencionado');
    }

    const elEstadoAlmuerzo = document.getElementById('cred-estado-almuerzo');
    if (elEstadoAlmuerzo) elEstadoAlmuerzo.innerText = "--";

    const elEstadoIcon = document.getElementById('cred-estado-almuerzo-icon');
    if (elEstadoIcon) elEstadoIcon.className = 'ph ph-receipt';

    const elAlojamiento = document.getElementById('cred-alojamiento');
    if (elAlojamiento) elAlojamiento.innerText = "--";

    const elQr = document.getElementById('qr-container');
    if (elQr) elQr.innerHTML = '';
}

// ─── CREDENCIAL DE USUARIO ──────────────────────────────────
function generarCredencialPorNombre() {
    const inputNombre = document.getElementById('userName');
    const nombre = inputNombre ? inputNombre.value.trim() : '';
    if (!nombre) return alert('Por favor ingresa tu nombre completo');

    limpiarCredencial();
    document.getElementById('cred-name').innerText = "Buscando registro...";
    switchView('view-credential');

    // Forzamos datos frescos desde Google Sheets para evitar datos desactualizados
    _datosCache = null;

    obtenerDatos()
        .then(rows => {
            const participante = buscarParticipante(rows, nombre);

            if (participante) {
                try {
                    renderCredencial(participante);
                } catch (err) {
                    console.error('Error al generar la credencial:', err);
                    alert("Ocurrió un error al desplegar la credencial: " + err.message);
                }
            } else {
                alert(`No encontramos a: "${nombre}". Verifica que esté escrito igual que en tu inscripción.`);
                switchView('view-user-login');
            }
        })
        .catch(error => {
            console.error('Error al obtener datos:', error);
            alert("Hubo un error al conectar con la base de datos.");
            switchView('view-user-login');
        });
}

// ─── RENDER CREDENCIAL ──────────────────────────────────────
function renderCredencial(p) {
    limpiarCredencial();

    // 1. Nombre
    const elName = document.getElementById('cred-name');
    if (elName) elName.innerText = (p[COL.nombre] || '').toUpperCase();

    // 2. Iglesia
    const elIglesia = document.getElementById('cred-iglesia');
    if (elIglesia) elIglesia.innerText = p[COL.iglesia] || 'No registra';

    // 3. Almuerzo:
    // Si colocó opción (ej. 'No requeriré almuerzo', 'Sábado y Domingo'), se muestra tal cual.
    // En caso de que venga vacío, se coloca el guión '--'.
    const almuerzoRaw = String(p[COL.almuerzo] || '').trim();
    const elAlmuerzo = document.getElementById('cred-almuerzo');
    const elAlmuerzoBadge = document.getElementById('cred-badge-almuerzo');

    if (elAlmuerzo) {
        elAlmuerzo.innerText = (almuerzoRaw !== '') ? almuerzoRaw : '--';
    }
    if (elAlmuerzoBadge) {
        elAlmuerzoBadge.style.display = 'inline-flex';
    }

    // 4. Estado Almuerzo:
    // Solo debe aparecer si la persona requiere almuerzo. Si no requiere o viene vacío, se oculta completamente.
    const elEstadoAlmuerzoBadge = document.getElementById('cred-badge-estado-almuerzo');
    const elEstadoAlmuerzo = document.getElementById('cred-estado-almuerzo');
    const elEstadoIcon = document.getElementById('cred-estado-almuerzo-icon');

    const reqAlm = participanteRequiereAlmuerzo(almuerzoRaw);

    if (reqAlm && elEstadoAlmuerzoBadge && elEstadoAlmuerzo) {
        const estadoTexto = obtenerEstadoAlmuerzoNormalizado(p[COL.estadoAlmuerzo], almuerzoRaw);

        elEstadoAlmuerzo.innerText = estadoTexto;
        elEstadoAlmuerzoBadge.style.display = 'inline-flex';

        // Clases de estilo e icono según el estado
        elEstadoAlmuerzoBadge.classList.remove('estado-pagado', 'estado-pago-completo', 'estado-pago-diario', 'estado-pendiente', 'estado-subvencionado');

        if (estadoTexto === 'Pago diario') {
            elEstadoAlmuerzoBadge.classList.add('estado-pago-diario');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-calendar-plus';
        } else if (estadoTexto === 'Pago completo') {
            elEstadoAlmuerzoBadge.classList.add('estado-pago-completo');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-seal-check';
        } else if (estadoTexto === 'Almuerzo subvencionado') {
            elEstadoAlmuerzoBadge.classList.add('estado-subvencionado');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-ticket';
        } else {
            elEstadoAlmuerzoBadge.classList.add('estado-pendiente');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-clock';
        }
    } else {
        // Ocultar pastilla de estado si no requiere almuerzo o está vacío
        if (elEstadoAlmuerzoBadge) {
            elEstadoAlmuerzoBadge.style.display = 'none';
        }
    }

    // 5. Alojamiento
    const elAlojamiento = document.getElementById('cred-alojamiento');
    if (elAlojamiento) elAlojamiento.innerText = p[COL.alojamiento] || 'No aplica';

    // 6. Código QR
    const qrContainer = document.getElementById('qr-container');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        try {
            // Usamos el Nombre Completo para individualizar a cada asistente (incluso si una familia usó el mismo correo)
            // Normalizamos para remover tildes/acentos que desbordan la librería qrcodejs
            const rawQr = String(p[COL.nombre] || '').trim();
            const cleanQr = rawQr.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            new QRCode(qrContainer, {
                text: cleanQr,
                width: 200,
                height: 200,
                colorDark: "#1d4ed8",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (e) {
            console.error("Error generando código QR:", e);
            qrContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Error al generar código QR</p>';
        }
    }
}

// ─── DASHBOARD ADMIN Y LISTA ──────────────────────────────────
function cargarDatosDashboard() {
    const syncIcon = document.getElementById('sync-icon');
    if (syncIcon) syncIcon.classList.add('fa-spin');

    // Limpiamos el caché para forzar datos frescos al recargar
    _datosCache = null;

    obtenerDatos()
        .then(rows => {
            const stats = calcularDashboard(rows);
            document.getElementById('stat-inscritos').innerText = stats.inscritos;
            document.getElementById('stat-asistentes-sabado').innerText = stats.asistentesSabado;
            document.getElementById('stat-inscritos-sabado').innerText = stats.inscritosSabado;
            document.getElementById('stat-asistentes-domingo').innerText = stats.asistentesDomingo;
            document.getElementById('stat-inscritos-domingo').innerText = stats.inscritosDomingo;

            document.getElementById('stat-almuerzos-entregados-sabado').innerText = stats.almuerzosEntregadosSabado;
            document.getElementById('stat-almuerzos-sabado').innerText = stats.almuerzosSabado;
            document.getElementById('stat-almuerzos-entregados-domingo').innerText = stats.almuerzosEntregadosDomingo;
            document.getElementById('stat-almuerzos-domingo').innerText = stats.almuerzosDomingo;
            if (document.getElementById('stat-almuerzos-resumen-sabado')) document.getElementById('stat-almuerzos-resumen-sabado').innerText = stats.almuerzosSabado;
            if (document.getElementById('stat-almuerzos-resumen-domingo')) document.getElementById('stat-almuerzos-resumen-domingo').innerText = stats.almuerzosDomingo;

            renderListaAdmin(rows); // Renderizar tabla

            if (syncIcon) syncIcon.classList.remove('fa-spin');
        })
        .catch(error => {
            console.error('Error cargando dashboard:', error);
            if (syncIcon) syncIcon.classList.remove('fa-spin');
        });
}

function renderListaAdmin(rows) {
    const tbody = document.getElementById('tabla-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Mantenemos el índice original de la caché local para actualizar la fila correcta
    const inscritos = rows.map((r, i) => ({ row: r, originalIndex: i })).filter(item => String(item.row[COL.nombre]).trim() !== '');

    inscritos.forEach((item, index) => {
        const { row, originalIndex } = item;
        const nombre = row[COL.nombre] || '--';
        const correo = row[COL.correo] || '--';
        const telefono = row[COL.telefono] || '--';
        const iglesia = row[COL.iglesia] || '--';
        const dias = row[COL.dias] || '--';
        const almuerzo = row[COL.almuerzo] || '--';
        const alojamiento = row[COL.alojamiento] || '--';

        const asisSab = String(row[COL.asistenciaSabado] || "").toLowerCase() === 'sí';
        const asisDom = String(row[COL.asistenciaDomingo] || "").toLowerCase() === 'sí';
        const almSab = String(row[COL.almuerzoSabadoEntregado] || "").toLowerCase() === 'sí';
        const almDom = String(row[COL.almuerzoDomingoEntregado] || "").toLowerCase() === 'sí';

        let diasHtml = dias;
        if (asisSab || asisDom) {
            diasHtml += `<br><div>`;
            if (asisSab) diasHtml += `<span class="badge-checkin success"><i class="fas fa-check"></i> Sáb</span>`;
            if (asisDom) diasHtml += `<span class="badge-checkin success"><i class="fas fa-check"></i> Dom</span>`;
            diasHtml += `</div>`;
        }

        let almuerzoHtml = `<span class="cred-badge-extra almuerzo" style="padding: 2px 6px; box-shadow:none; display: inline-block;">${almuerzo}</span>`;
        if (almSab || almDom) {
            almuerzoHtml += `<br><div>`;
            if (almSab) almuerzoHtml += `<span class="badge-checkin warning"><i class="fas fa-utensils"></i> Sáb</span>`;
            if (almDom) almuerzoHtml += `<span class="badge-checkin warning"><i class="fas fa-utensils"></i> Dom</span>`;
            almuerzoHtml += `</div>`;
        }

        // Estado del Almuerzo (solo para quienes requieren almuerzo)
        let estadoAlmuerzoHtml = '<span style="color: var(--text-muted); font-weight: 500;">--</span>';
        if (participanteRequiereAlmuerzo(almuerzo)) {
            const estadoTexto = obtenerEstadoAlmuerzoNormalizado(row[COL.estadoAlmuerzo], almuerzo);

            if (estadoTexto === 'Pago diario') {
                estadoAlmuerzoHtml = `<span class="badge-estado-almuerzo pago-diario"><i class="ph-bold ph-calendar-plus"></i> Pago diario</span>`;
            } else if (estadoTexto === 'Pago completo') {
                estadoAlmuerzoHtml = `<span class="badge-estado-almuerzo pago-completo"><i class="ph-bold ph-check-circle"></i> Pago completo</span>`;
            } else if (estadoTexto === 'Almuerzo subvencionado') {
                estadoAlmuerzoHtml = `<span class="badge-estado-almuerzo subvencionado"><i class="ph-bold ph-seal-check"></i> Subvencionado</span>`;
            } else {
                estadoAlmuerzoHtml = `<span class="badge-estado-almuerzo pendiente"><i class="ph-bold ph-clock"></i> Pendiente</span>`;
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-weight: bold; font-size: 13px;">${index + 1}</td>
            <td><strong>${nombre}</strong></td>
            <td>${correo}</td>
            <td>${telefono}</td>
            <td>${iglesia}</td>
            <td>${diasHtml}</td>
            <td>${almuerzoHtml}</td>
            <td>${estadoAlmuerzoHtml}</td>
            <td>${alojamiento}</td>
            <td>
                <button class="btn-sm" onclick="abrirModalEditar(${originalIndex})">
                    <i class="fas fa-edit"></i> Editar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filtrarTablaAdmin() {
    const input = document.getElementById("adminSearch");
    const normalizeStr = str => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
    const queryWords = normalizeStr(input.value).split(/\s+/);

    const tbody = document.getElementById("tabla-body");
    const tr = tbody.getElementsByTagName("tr");
    let visibleCount = 1;

    // Remover fila de "No encontrado" si existe
    const noResultRow = document.getElementById("no-results-row");
    if (noResultRow) noResultRow.remove();

    for (let i = 0; i < tr.length; i++) {
        const tds = tr[i].getElementsByTagName("td");
        if (tds.length > 1) {
            let txtNombre = normalizeStr(tds[1].textContent || tds[1].innerText);
            let txtIglesia = normalizeStr(tds[4].textContent || tds[4].innerText);
            let txtDias = normalizeStr(tds[5].textContent || tds[5].innerText);
            let txtAlmuerzo = normalizeStr(tds[6].textContent || tds[6].innerText);
            let txtEstadoAlm = normalizeStr(tds[7].textContent || tds[7].innerText);
            let txtAlojamiento = normalizeStr(tds[8].textContent || tds[8].innerText);

            let combinedText = `${txtNombre} ${txtIglesia} ${txtDias} ${txtAlmuerzo} ${txtEstadoAlm} ${txtAlojamiento}`;
            
            let match = queryWords.every(word => combinedText.includes(word));

            if (match) {
                tr[i].style.display = "";
                tds[0].innerText = visibleCount++;
            } else {
                tr[i].style.display = "none";
            }
        }
    }

    // Mostrar mensaje si no hay resultados
    if (visibleCount === 1 && tr.length > 0) {
        const trVacio = document.createElement('tr');
        trVacio.id = "no-results-row";
        trVacio.innerHTML = `<td colspan="10" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
            <span style="font-size: 15px;">No se encontraron resultados para "<strong>${input.value}</strong>"</span>
        </td>`;
        tbody.appendChild(trVacio);
    }
}

// ─── MODAL DE EDICIÓN ───────────────────────────────────────
function abrirModalEditar(arrayIndex) {
    if (!_datosCache) return;
    const row = _datosCache[arrayIndex];
    if (!row) return;

    // Llenar el formulario con los datos actuales
    document.getElementById('edit-rowIndex').value = arrayIndex;
    document.getElementById('edit-nombre').value = row[COL.nombre] || '';
    document.getElementById('edit-correo').value = row[COL.correo] || '';
    document.getElementById('edit-telefono').value = row[COL.telefono] || '';

    // --- Lógica para el campo Iglesia (Select + Otros) ---
    const iglesiaVal = String(row[COL.iglesia] || '').trim();
    const iglesiaSelect = document.getElementById('edit-iglesia-select');
    const iglesiaOtro = document.getElementById('edit-iglesia-otro');

    let foundIglesia = false;
    for (let i = 0; i < iglesiaSelect.options.length; i++) {
        if (iglesiaSelect.options[i].value !== "Otros") {
            if (iglesiaSelect.options[i].value.toLowerCase() === iglesiaVal.toLowerCase()) {
                iglesiaSelect.selectedIndex = i;
                foundIglesia = true;
                break;
            }
        }
    }

    if (!foundIglesia) {
        if (iglesiaVal !== '') {
            iglesiaSelect.value = "Otros";
            iglesiaOtro.value = iglesiaVal;
            iglesiaOtro.style.display = "block";
        } else {
            iglesiaOtro.value = '';
            iglesiaOtro.style.display = "none";
            iglesiaSelect.selectedIndex = 0;
        }
    } else {
        iglesiaOtro.value = '';
        iglesiaOtro.style.display = "none";
    }

    // Función auxiliar para pre-seleccionar sin importar mayúsculas
    const setSelect = (id, val) => {
        const el = document.getElementById(id);
        const str = String(val || '').trim().toLowerCase();
        let found = false;
        for (let i = 0; i < el.options.length; i++) {
            if (el.options[i].value.toLowerCase() === str) {
                el.selectedIndex = i;
                found = true; break;
            }
        }
        if (!found) el.selectedIndex = 0;
    };

    setSelect('edit-dias', row[COL.dias]);
    setSelect('edit-almuerzo', row[COL.almuerzo]);
    const estadoAlmValor = obtenerEstadoAlmuerzoNormalizado(row[COL.estadoAlmuerzo], row[COL.almuerzo]);
    setSelect('edit-estado-almuerzo', estadoAlmValor);

    // Cargar validaciones manuales (Check-ins)
    document.getElementById('edit-asis-sab').checked = String(row[COL.asistenciaSabado] || "").toLowerCase() === 'sí';
    document.getElementById('edit-asis-dom').checked = String(row[COL.asistenciaDomingo] || "").toLowerCase() === 'sí';
    document.getElementById('edit-alm-sab').checked = String(row[COL.almuerzoSabadoEntregado] || "").toLowerCase() === 'sí';
    document.getElementById('edit-alm-dom').checked = String(row[COL.almuerzoDomingoEntregado] || "").toLowerCase() === 'sí';

    // Llamar validación visual de casillas
    toggleCheckboxes();

    // Mostrar modal
    const editModal = document.getElementById('editModal');
    editModal.style.display = 'flex';
    document.body.classList.add('no-scroll');
    _modalOpen = true;

    // Si estamos dentro de un iframe, centrar el modal en la posición visual actual
    if (window.parent && window.parent !== window) {
        document.body.classList.add('in-iframe');
        // Solicitar a WordPress o ajustar el top al área visible
        const currentScroll = window.scrollY || document.documentElement.scrollTop || 0;
        editModal.style.top = Math.max(0, currentScroll) + 'px';
        window.parent.postMessage({ type: 'lock-scroll', locked: true }, '*');
    }
}

function toggleCheckboxes() {
    const diasInscritos = document.getElementById('edit-dias').value.toLowerCase();
    const almuerzoInscrito = document.getElementById('edit-almuerzo').value.toLowerCase();

    const asisSabCheck = document.getElementById('edit-asis-sab');
    const asisDomCheck = document.getElementById('edit-asis-dom');
    const almSabCheck = document.getElementById('edit-alm-sab');
    const almDomCheck = document.getElementById('edit-alm-dom');

    const puedeSabadoAsis = diasInscritos.includes('sábado') || diasInscritos.includes('sabado') || diasInscritos.includes('ambos') || diasInscritos.includes('y');
    const puedeDomingoAsis = diasInscritos.includes('domingo') || diasInscritos.includes('ambos') || diasInscritos.includes('y');
    const puedeSabadoAlm = almuerzoInscrito.includes('sábado') || almuerzoInscrito.includes('sabado') || almuerzoInscrito === 'sí' || almuerzoInscrito === 'si' || almuerzoInscrito.includes('ambos') || almuerzoInscrito.includes('y');
    const puedeDomingoAlm = almuerzoInscrito.includes('domingo') || almuerzoInscrito === 'sí' || almuerzoInscrito === 'si' || almuerzoInscrito.includes('ambos') || almuerzoInscrito.includes('y');

    asisSabCheck.disabled = !puedeSabadoAsis;
    if (!puedeSabadoAsis) asisSabCheck.checked = false;

    asisDomCheck.disabled = !puedeDomingoAsis;
    if (!puedeDomingoAsis) asisDomCheck.checked = false;

    almSabCheck.disabled = !puedeSabadoAlm;
    if (!puedeSabadoAlm) almSabCheck.checked = false;

    almDomCheck.disabled = !puedeDomingoAlm;
    if (!puedeDomingoAlm) almDomCheck.checked = false;

    // Mostrar/ocultar selector de Estado de Almuerzo y restringir "Pago diario" solo a Sábado y Domingo
    const grupoEstadoAlmuerzo = document.getElementById('group-edit-estado-almuerzo');
    const optPagoDiario = document.getElementById('opt-edit-pago-diario');
    const selectEstadoAlmuerzo = document.getElementById('edit-estado-almuerzo');

    if (grupoEstadoAlmuerzo) {
        const requiereAlm = participanteRequiereAlmuerzo(almuerzoInscrito);
        if (requiereAlm) {
            grupoEstadoAlmuerzo.classList.remove('is-hidden');
            grupoEstadoAlmuerzo.style.removeProperty('display');

            // "Pago diario" solo está permitido para personas que requieren almuerzo sábado y domingo (2 días).
            // Para 1 solo día (ej. sólo sábado o sólo domingo), el pago es completo.
            const requiereAmbos = participanteRequiereAmbosAlmuerzos(almuerzoInscrito);
            if (optPagoDiario) {
                if (requiereAmbos) {
                    optPagoDiario.disabled = false;
                    optPagoDiario.hidden = false;
                    optPagoDiario.style.display = '';
                } else {
                    optPagoDiario.disabled = true;
                    optPagoDiario.hidden = true;
                    optPagoDiario.style.display = 'none';
                    if (selectEstadoAlmuerzo && selectEstadoAlmuerzo.value === 'Pago diario') {
                        selectEstadoAlmuerzo.value = 'Pago completo';
                    }
                }
            }
        } else {
            grupoEstadoAlmuerzo.classList.add('is-hidden');
            grupoEstadoAlmuerzo.style.setProperty('display', 'none', 'important');
        }
    }
}

function cerrarModal() {
    document.getElementById('editModal').style.display = 'none';
    document.body.classList.remove('no-scroll');
    _modalOpen = false;
    // Desbloquear scroll del parent y re-sincronizar la altura
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lock-scroll', locked: false }, '*');
    }
    setTimeout(sendHeightToParent, 50);
}

function guardarEdicion() {
    const arrayIndex = document.getElementById('edit-rowIndex').value;
    const nuevoNombre = document.getElementById('edit-nombre').value;
    const nuevoCorreo = document.getElementById('edit-correo').value;
    const nuevoTelefono = document.getElementById('edit-telefono').value;

    // Obtener valor de la iglesia
    const iglesiaSelectVal = document.getElementById('edit-iglesia-select').value;
    const nuevaIglesia = (iglesiaSelectVal === 'Otros')
        ? document.getElementById('edit-iglesia-otro').value.trim()
        : iglesiaSelectVal;

    const nuevosDias = document.getElementById('edit-dias').value;
    const nuevoAlmuerzo = document.getElementById('edit-almuerzo').value;
    const nuevoAlojamiento = document.getElementById('edit-alojamiento').value;
    let nuevoEstadoAlmuerzo = participanteRequiereAlmuerzo(nuevoAlmuerzo)
        ? (document.getElementById('edit-estado-almuerzo').value || 'Pendiente')
        : '';
    // Si no requiere ambos almuerzos y estaba en "Pago diario", forzar a "Pago completo"
    if (nuevoEstadoAlmuerzo === 'Pago diario' && !participanteRequiereAmbosAlmuerzos(nuevoAlmuerzo)) {
        nuevoEstadoAlmuerzo = 'Pago completo';
    }

    // Check-ins manuales
    const asisSab = document.getElementById('edit-asis-sab').checked ? 'Sí' : '';
    const asisDom = document.getElementById('edit-asis-dom').checked ? 'Sí' : '';
    const almSab = document.getElementById('edit-alm-sab').checked ? 'Sí' : '';
    const almDom = document.getElementById('edit-alm-dom').checked ? 'Sí' : '';

    // Indicador visual de carga
    const btnGuardar = document.querySelector('#editModal .btn-primary');
    const textoOriginal = btnGuardar.innerHTML;
    btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    btnGuardar.disabled = true;

    // Preparar carga útil (payload)
    const payload = {
        action: "update",
        rowIndex: arrayIndex,
        nombre: nuevoNombre,
        correo: nuevoCorreo,
        telefono: nuevoTelefono,
        iglesia: nuevaIglesia,
        dias: nuevosDias,
        almuerzo: nuevoAlmuerzo,
        alojamiento: nuevoAlojamiento,
        asisSab: asisSab,
        asisDom: asisDom,
        almSab: almSab,
        almDom: almDom,
        estadoAlmuerzo: nuevoEstadoAlmuerzo
    };

    fetch(WEB_APP_URL, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(payload),
        redirect: 'follow'
    })
        .then(async response => {
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                console.error("Error parseando respuesta:", text);
                throw new Error("Respuesta inválida del servidor (posiblemente falta actualizar Apps Script)");
            }
        })
        .then(data => {
            if (data.success) {
                // Actualizar la memoria caché local para no tener que recargar todo
                if (_datosCache) {
                    if (_datosCache[arrayIndex]) {
                        _datosCache[arrayIndex][COL.nombre] = nuevoNombre;
                        _datosCache[arrayIndex][COL.correo] = nuevoCorreo;
                        _datosCache[arrayIndex][COL.telefono] = nuevoTelefono;
                        _datosCache[arrayIndex][COL.iglesia] = nuevaIglesia;
                        _datosCache[arrayIndex][COL.dias] = nuevosDias;
                        _datosCache[arrayIndex][COL.almuerzo] = nuevoAlmuerzo;
                        _datosCache[arrayIndex][COL.alojamiento] = nuevoAlojamiento;
                        _datosCache[arrayIndex][COL.asistenciaSabado] = asisSab;
                        _datosCache[arrayIndex][COL.asistenciaDomingo] = asisDom;
                        _datosCache[arrayIndex][COL.almuerzoSabadoEntregado] = almSab;
                        _datosCache[arrayIndex][COL.almuerzoDomingoEntregado] = almDom;
                        _datosCache[arrayIndex][COL.estadoAlmuerzo] = nuevoEstadoAlmuerzo;
                    }
                }
                // Re-renderizar la tabla y el dashboard
                renderListaAdmin(_datosCache);
                const stats = calcularDashboard(_datosCache);
                document.getElementById('stat-inscritos').innerText = stats.inscritos;
                document.getElementById('stat-asistentes-sabado').innerText = stats.asistentesSabado;
                document.getElementById('stat-inscritos-sabado').innerText = stats.inscritosSabado;
                document.getElementById('stat-asistentes-domingo').innerText = stats.asistentesDomingo;
                document.getElementById('stat-inscritos-domingo').innerText = stats.inscritosDomingo;

                document.getElementById('stat-almuerzos-entregados-sabado').innerText = stats.almuerzosEntregadosSabado;
                document.getElementById('stat-almuerzos-sabado').innerText = stats.almuerzosSabado;
                document.getElementById('stat-almuerzos-entregados-domingo').innerText = stats.almuerzosEntregadosDomingo;
                document.getElementById('stat-almuerzos-domingo').innerText = stats.almuerzosDomingo;
                if (document.getElementById('stat-almuerzos-resumen-sabado')) document.getElementById('stat-almuerzos-resumen-sabado').innerText = stats.almuerzosSabado;
                if (document.getElementById('stat-almuerzos-resumen-domingo')) document.getElementById('stat-almuerzos-resumen-domingo').innerText = stats.almuerzosDomingo;

                cerrarModal();
                showToast("Participante actualizado correctamente", "success");
            } else {
                showToast("Error al guardar: " + data.error, "error");
            }
        })
        .catch(error => {
            console.error("Error en POST:", error);
            showToast("Error al guardar: " + error.message, "error");
        })
        .finally(() => {
            btnGuardar.innerHTML = textoOriginal;
            btnGuardar.disabled = false;
        });
}

// ─── ESCÁNER QR ─────────────────────────────────────────────
function iniciarEscaner(tipo) {
    if (!confirm('Para usar el escanear, necesitas dar permiso de acceso a la camara. Cuando tu navegador (Chrome o Safari) te lo solicite, por favor presiona Permitir. Deseas continuar?')) {
        return;
    }
    
    _scanPaused = false;

    const readerId = `reader-${tipo}`;
    const resultId = `scan-result-${tipo}`;

    document.getElementById(readerId).style.display = 'block';
    
    document.getElementById(`btn-iniciar-${tipo}`).style.setProperty('display', 'none', 'important');
    document.getElementById(`btn-cerrar-${tipo}`).style.removeProperty('display');

    let scanner = tipo === 'asistencia' ? html5QrcodeScannerAsistencia : html5QrcodeScannerAlmuerzo;

    if (!scanner) {
        scanner = new Html5Qrcode(readerId);
        if (tipo === 'asistencia') html5QrcodeScannerAsistencia = scanner;
        else html5QrcodeScannerAlmuerzo = scanner;
    }

    scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            if (_scanPaused) return; // Si el modal está abierto, ignorar los scans
            _scanPaused = true;
            procesarEscaneo(decodedText, tipo);
        },
        () => { }
    ).catch(err => {
        console.log(err);
        document.getElementById(`btn-iniciar-${tipo}`).style.removeProperty('display');
        document.getElementById(`btn-cerrar-${tipo}`).style.setProperty('display', 'none', 'important');
        document.getElementById(readerId).style.display = 'none';
        showToast("Error iniciando la cámara. Asegúrate de dar permisos.", "error");
    });
}

function cerrarEscaner(tipo) {
    const readerId = `reader-${tipo}`;
    let scanner = tipo === 'asistencia' ? html5QrcodeScannerAsistencia : html5QrcodeScannerAlmuerzo;
    
    const ocultarTodo = () => {
        document.getElementById(readerId).style.display = 'none';
        document.getElementById(`btn-iniciar-${tipo}`).style.removeProperty('display');
        document.getElementById(`btn-cerrar-${tipo}`).style.setProperty('display', 'none', 'important');
    };

    if (scanner && scanner.getState() === 2) {
        scanner.stop().then(() => {
            ocultarTodo();
        }).catch(err => {
            console.log("Error al detener", err);
            ocultarTodo();
        });
    } else {
        ocultarTodo();
    }
}

function procesarEscaneo(codigo, tipo) {
    if (!_datosCache) {
        showToast("No hay datos cargados. Actualiza el dashboard.", "error");
        return;
    }

    let decoded = codigo;
    try {
        decoded = decodeURIComponent(codigo);
    } catch (e) {}

    const normalizeStr = str => str ? String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
    const query = normalizeStr(decoded);

    // 1. Buscamos primero por nombre exacto (permite distinguir personas que comparten un mismo correo familiar)
    let rowIndex = _datosCache.findIndex(row => normalizeStr(row[COL.nombre]) === query);

    // 2. Si no coincide exacto, buscamos por palabras del nombre
    if (rowIndex === -1) {
        const queryWords = query.split(/\s+/).filter(Boolean);
        if (queryWords.length > 1) {
            rowIndex = _datosCache.findIndex(row => {
                const rowName = normalizeStr(row[COL.nombre]);
                return queryWords.every(w => rowName.includes(w));
            });
        }
    }

    // 3. Fallback: buscar por correo (por si algún participante presenta un QR generado anteriormente con el correo)
    if (rowIndex === -1) {
        rowIndex = _datosCache.findIndex(row => normalizeStr(row[COL.correo]) === query);
    }

    if (rowIndex === -1) {
        showToast("Participante no encontrado.", "error");
        setTimeout(() => { _scanPaused = false; }, 1500);
        return;
    }

    const row = _datosCache[rowIndex];

    // VALIDACIÓN ADICIONAL: Si es escaneo de almuerzo y no requiere
    if (tipo === 'almuerzo') {
        const almuerzoInscrito = String(row[COL.almuerzo] || "").toLowerCase();
        if (almuerzoInscrito.includes('no requeriré')) {
            alert('Atencion: El participante ' + row[COL.nombre] + ' indico que no requeria almuerzo. Por favor, consultar con los encargados del congreso.');
            showToast("Requiere confirmación de encargados.", "error");
            setTimeout(() => { _scanPaused = false; }, 1500);
            return; // Abortamos, no mostramos el modal de validación
        }
    }

    abrirModalValidacion(rowIndex, tipo);
}

function abrirModalValidacion(rowIndex, tipo) {
    const row = _datosCache[rowIndex];
    document.getElementById('scan-val-nombre').innerText = row[COL.nombre] || 'Sin Nombre';
    document.getElementById('scan-val-title').innerText = tipo === 'asistencia' ? 'Validar Asistencia' : 'Validar Almuerzo';

    const diasInscritos = String(row[COL.dias] || "").toLowerCase();
    const almuerzoInscrito = String(row[COL.almuerzo] || "").toLowerCase();

    let infoAlmuerzo = `Almuerzo solicitado: ${row[COL.almuerzo]}`;
    if (participanteRequiereAlmuerzo(row[COL.almuerzo])) {
        const est = obtenerEstadoAlmuerzoNormalizado(row[COL.estadoAlmuerzo], row[COL.almuerzo]);
        infoAlmuerzo += ` • Estado: ${est}`;
    }
    document.getElementById('scan-val-info').innerText = tipo === 'asistencia' ? `Días inscritos: ${row[COL.dias]}` : infoAlmuerzo;

    const actionsContainer = document.getElementById('scan-val-actions');
    actionsContainer.innerHTML = '';

    // Determinar qué botones mostrar
    let puedeSabado = false, puedeDomingo = false;

    if (tipo === 'asistencia') {
        if (diasInscritos.includes('sábado') || diasInscritos.includes('sabado') || diasInscritos.includes('ambos') || diasInscritos.includes('y')) puedeSabado = true;
        if (diasInscritos.includes('domingo') || diasInscritos.includes('ambos') || diasInscritos.includes('y')) puedeDomingo = true;
    } else {
        if (almuerzoInscrito.includes('sábado') || almuerzoInscrito.includes('sabado') || almuerzoInscrito === 'sí' || almuerzoInscrito === 'si' || almuerzoInscrito.includes('ambos') || almuerzoInscrito.includes('y')) puedeSabado = true;
        if (almuerzoInscrito.includes('domingo') || almuerzoInscrito === 'sí' || almuerzoInscrito === 'si' || almuerzoInscrito.includes('ambos') || almuerzoInscrito.includes('y')) puedeDomingo = true;
    }

    // Estado actual
    const estadoSabado = String(row[tipo === 'asistencia' ? COL.asistenciaSabado : COL.almuerzoSabadoEntregado]).toLowerCase() === 'sí';
    const estadoDomingo = String(row[tipo === 'asistencia' ? COL.asistenciaDomingo : COL.almuerzoDomingoEntregado]).toLowerCase() === 'sí';

    if (puedeSabado) {
        if (estadoSabado) {
            actionsContainer.innerHTML += `<button class="btn btn-outline" disabled><i class="ph ph-calendar-check" style="color: green; font-size: 20px;"></i> Sábado (Ya registrado)</button>`;
        } else {
            actionsContainer.innerHTML += `<button class="btn btn-primary" onclick="registrarCheckin(${rowIndex}, '${tipo}', 'sabado', this)"><i class="ph ph-calendar-blank" style="font-size: 20px;"></i> Check-in Sábado</button>`;
        }
    }

    if (puedeDomingo) {
        if (estadoDomingo) {
            actionsContainer.innerHTML += `<button class="btn btn-outline" disabled><i class="ph ph-calendar-check" style="color: green; font-size: 20px;"></i> Domingo (Ya registrado)</button>`;
        } else {
            actionsContainer.innerHTML += `<button class="btn btn-primary" onclick="registrarCheckin(${rowIndex}, '${tipo}', 'domingo', this)"><i class="ph ph-calendar-blank" style="font-size: 20px;"></i> Check-in Domingo</button>`;
        }
    }

    if (!puedeSabado && !puedeDomingo) {
        actionsContainer.innerHTML = `<p style="color: red;"><i class="fas fa-exclamation-triangle"></i> No aplica para este participante.</p>`;
    }

    document.getElementById('scanValidationModal').style.display = 'flex';
    _modalOpen = true;
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lock-scroll', locked: true }, '*');
    }
}

function cerrarModalValidacion() {
    document.getElementById('scanValidationModal').style.display = 'none';
    _modalOpen = false;
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lock-scroll', locked: false }, '*');
    }
    setTimeout(sendHeightToParent, 50);
    // Permitir escanear de nuevo
    setTimeout(() => {
        _scanPaused = false;
    }, 1000);
}

function registrarCheckin(rowIndex, tipo, dia, btnElement) {
    const row = _datosCache[rowIndex];
    let campo = "";

    if (tipo === 'asistencia' && dia === 'sabado') campo = COL.asistenciaSabado;
    if (tipo === 'asistencia' && dia === 'domingo') campo = COL.asistenciaDomingo;
    if (tipo === 'almuerzo' && dia === 'sabado') campo = COL.almuerzoSabadoEntregado;
    if (tipo === 'almuerzo' && dia === 'domingo') campo = COL.almuerzoDomingoEntregado;

    const payload = {
        action: "checkin",
        rowIndex: rowIndex,
        tipo: tipo,
        dia: dia,
        nombre: row[COL.nombre]
    };

    if (btnElement) {
        btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';
        btnElement.disabled = true;
    }

    fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: 'follow'
    }).then(async response => {
        return { success: true };
    }).catch(e => {
        console.warn("Fallo en API, actualizando localmente:", e);
    }).finally(() => {
        row[campo] = 'Sí';
        cargarDatosDashboardLocalmente();
        showToast("¡Check-in registrado exitosamente!", "success");
        abrirModalValidacion(rowIndex, tipo);
    });
}

function cargarDatosDashboardLocalmente() {
    const stats = calcularDashboard(_datosCache);
    document.getElementById('stat-inscritos').innerText = stats.inscritos;
    document.getElementById('stat-asistentes-sabado').innerText = stats.asistentesSabado;
    document.getElementById('stat-asistentes-domingo').innerText = stats.asistentesDomingo;

    document.getElementById('stat-almuerzos-entregados-sabado').innerText = stats.almuerzosEntregadosSabado;
    document.getElementById('stat-almuerzos-entregados-domingo').innerText = stats.almuerzosEntregadosDomingo;
}

// ─── TOAST NOTIFICATIONS ────────────────────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';

    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Animate out and remove after 3.5s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3500);
}

// ─── TOGGLE IGLESIA ─────────────────────────────────────────
function toggleIglesiaInput() {
    const select = document.getElementById('edit-iglesia-select');
    const input = document.getElementById('edit-iglesia-otro');
    if (select.value === 'Otros') {
        input.style.display = 'block';
        input.focus();
    } else {
        input.style.display = 'none';
        input.value = '';
    }
}

// ============================================================
// ─── VALIDACIÓN MANUAL SIN QR (OPCIÓN 2) ─────────────────────
// ============================================================
let _manualTipo = 'asistencia'; // 'asistencia' o 'almuerzo'
let _manualFilterDia = 'todos'; // 'todos', 'sabado', 'domingo'
let _manualFilterPago = 'todos'; // 'todos', 'pagado', 'pendiente'

function abrirModalManual(tipo) {
    _manualTipo = tipo;
    _manualFilterDia = 'todos';
    _manualFilterPago = 'todos';

    const input = document.getElementById('manualSearchInput');
    if (input) input.value = '';

    // Resetear tags de filtros a "Todos"
    document.querySelectorAll('#modalManualCheckin .manual-filter-group .btn-filter-tag').forEach(btn => {
        if (btn.getAttribute('data-filter-dia') === 'todos' || btn.getAttribute('data-filter-pago') === 'todos') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Ajustar encabezados según el tipo
    const titleEl = document.getElementById('manual-modal-title');
    const subtitleEl = document.getElementById('manual-modal-subtitle');
    const grupoPago = document.getElementById('manual-pago-filter-group');
    const tipoIndicador = document.getElementById('manual-tipo-indicador');

    if (tipo === 'asistencia') {
        if (titleEl) titleEl.innerHTML = `<i class="ph-bold ph-identification-card" style="font-size: 24px; color: #2563eb;"></i> Validación Manual de Ingreso (Sin QR)`;
        if (subtitleEl) subtitleEl.innerText = 'Busca a los asistentes para registrar su ingreso de Sábado o Domingo';
        if (grupoPago) grupoPago.style.display = 'none';
        if (tipoIndicador) tipoIndicador.innerHTML = `<span style="color: #2563eb; font-weight: 700;"><i class="ph-bold ph-door"></i> Modo Ingreso</span>`;
    } else {
        if (titleEl) titleEl.innerHTML = `<i class="ph-bold ph-fork-knife" style="font-size: 24px; color: #d97706;"></i> Validación Manual de Almuerzo (Sin QR)`;
        if (subtitleEl) subtitleEl.innerText = 'Verifica estado de pago y entrega de almuerzos (Sábado / Domingo)';
        if (grupoPago) grupoPago.style.display = 'flex';
        if (tipoIndicador) tipoIndicador.innerHTML = `<span style="color: #d97706; font-weight: 700;"><i class="ph-bold ph-fork-knife"></i> Modo Almuerzos</span>`;
    }

    const modal = document.getElementById('modalManualCheckin');
    if (modal) {
        modal.style.display = 'flex';
        _modalOpen = true;
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'lock-scroll', locked: true }, '*');
        }
        document.body.classList.add('no-scroll');
    }

    // Si aún no se han cargado los datos, cargarlos primero
    if (!_datosCache) {
        obtenerDatos().then(() => {
            filtrarListaManual();
        }).catch(err => {
            console.error("Error al cargar datos:", err);
            showToast("Error al cargar participantes.", "error");
        });
    } else {
        filtrarListaManual();
    }

    setTimeout(() => {
        if (input) input.focus();
    }, 150);
}

function cerrarModalManual() {
    const modal = document.getElementById('modalManualCheckin');
    if (modal) modal.style.display = 'none';
    _modalOpen = false;
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lock-scroll', locked: false }, '*');
    }
    setTimeout(sendHeightToParent, 50);
    document.body.classList.remove('no-scroll');
}

function setManualFilterDia(dia, btn) {
    _manualFilterDia = dia;
    const parent = btn.closest('.manual-filter-group');
    if (parent) {
        parent.querySelectorAll('.btn-filter-tag').forEach(b => b.classList.remove('active'));
    }
    btn.classList.add('active');
    filtrarListaManual();
}

function setManualFilterPago(pago, btn) {
    _manualFilterPago = pago;
    const parent = btn.closest('.manual-filter-group');
    if (parent) {
        parent.querySelectorAll('.btn-filter-tag').forEach(b => b.classList.remove('active'));
    }
    btn.classList.add('active');
    filtrarListaManual();
}

function filtrarListaManual() {
    if (!_datosCache) return;

    const query = document.getElementById('manualSearchInput')?.value || '';
    const normalizeStr = str => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
    const queryWords = normalizeStr(query).split(/\s+/).filter(Boolean);

    // Mapear con su rowIndex original
    let filtrados = _datosCache.map((r, i) => ({ row: r, originalIndex: i }))
        .filter(item => String(item.row[COL.nombre] || '').trim() !== '');

    // En modo almuerzo: si no hay búsqueda por texto, mostramos a los que requieren almuerzo
    if (_manualTipo === 'almuerzo' && queryWords.length === 0) {
        filtrados = filtrados.filter(item => participanteRequiereAlmuerzo(item.row[COL.almuerzo]));
    }

    // Filtro por Día
    if (_manualFilterDia === 'sabado') {
        if (_manualTipo === 'asistencia') {
            filtrados = filtrados.filter(item => {
                const d = String(item.row[COL.dias] || '').toLowerCase();
                return d.includes('sábado') || d.includes('sabado') || d.includes('ambos') || d.includes('y');
            });
        } else {
            filtrados = filtrados.filter(item => {
                const a = String(item.row[COL.almuerzo] || '').toLowerCase();
                return a.includes('sábado') || a.includes('sabado') || a === 'sí' || a === 'si' || a.includes('ambos') || a.includes('y');
            });
        }
    } else if (_manualFilterDia === 'domingo') {
        if (_manualTipo === 'asistencia') {
            filtrados = filtrados.filter(item => {
                const d = String(item.row[COL.dias] || '').toLowerCase();
                return d.includes('domingo') || d.includes('ambos') || d.includes('y');
            });
        } else {
            filtrados = filtrados.filter(item => {
                const a = String(item.row[COL.almuerzo] || '').toLowerCase();
                return a.includes('domingo') || a === 'sí' || a === 'si' || a.includes('ambos') || a.includes('y');
            });
        }
    }

    // Filtro por Estado de Pago (modo almuerzo)
    if (_manualFilterPago !== 'todos') {
        filtrados = filtrados.filter(item => {
            const estadoNormalizado = obtenerEstadoAlmuerzoNormalizado(item.row[COL.estadoAlmuerzo], item.row[COL.almuerzo]);
            if (_manualFilterPago === 'completo') {
                return estadoNormalizado === 'Pago completo';
            } else if (_manualFilterPago === 'diario') {
                return estadoNormalizado === 'Pago diario';
            } else if (_manualFilterPago === 'pendiente') {
                return estadoNormalizado === 'Pendiente';
            }
            return true;
        });
    }

    // Filtro por texto de búsqueda (nombre, apellido, iglesia)
    if (queryWords.length > 0) {
        filtrados = filtrados.filter(item => {
            const rowNombre = normalizeStr(item.row[COL.nombre]);
            const rowIglesia = normalizeStr(item.row[COL.iglesia]);
            const rowDias = normalizeStr(item.row[COL.dias]);
            const rowAlm = normalizeStr(item.row[COL.almuerzo]);
            const combined = `${rowNombre} ${rowIglesia} ${rowDias} ${rowAlm}`;
            return queryWords.every(word => combined.includes(word));
        });
    }

    // Contador informativo
    const countEl = document.getElementById('manual-results-count');
    if (countEl) {
        countEl.innerText = `Mostrando ${filtrados.length} ${filtrados.length === 1 ? 'participante' : 'participantes'}`;
    }

    renderListaManual(filtrados);
}

function renderListaManual(lista) {
    const container = document.getElementById('manual-results-list');
    if (!container) return;

    if (lista.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
                <i class="ph-bold ph-magnifying-glass" style="font-size: 32px; color: #94a3b8; margin-bottom: 8px;"></i>
                <p style="font-size: 14px; margin: 0;">No se encontraron participantes con esos filtros.</p>
            </div>
        `;
        return;
    }

    let html = '';
    lista.forEach(item => {
        const { row, originalIndex } = item;
        const nombre = (row[COL.nombre] || 'Sin Nombre').toUpperCase();
        const iglesia = row[COL.iglesia] || 'No registra iglesia';
        const dias = row[COL.dias] || '--';
        const almuerzo = row[COL.almuerzo] || '--';
        const requiereAlm = participanteRequiereAlmuerzo(almuerzo);

        // Estado Almuerzo
        let badgePagoHtml = '';
        if (requiereAlm) {
            const estTexto = obtenerEstadoAlmuerzoNormalizado(row[COL.estadoAlmuerzo], almuerzo);
            if (estTexto === 'Pago diario') {
                badgePagoHtml = `<span class="badge-estado-almuerzo pago-diario"><i class="ph-bold ph-calendar-plus"></i> Pago diario</span>`;
            } else if (estTexto === 'Pago completo') {
                badgePagoHtml = `<span class="badge-estado-almuerzo pago-completo"><i class="ph-bold ph-check-circle"></i> Pago completo</span>`;
            } else if (estTexto === 'Almuerzo subvencionado') {
                badgePagoHtml = `<span class="badge-estado-almuerzo subvencionado"><i class="ph-bold ph-seal-check"></i> Subvencionado</span>`;
            } else {
                badgePagoHtml = `<span class="badge-estado-almuerzo pendiente"><i class="ph-bold ph-clock"></i> Pendiente</span>`;
            }
        } else {
            badgePagoHtml = `<span style="font-size: 11px; color: var(--text-muted); background: #f1f5f9; padding: 3px 8px; border-radius: 12px;">Sin almuerzo</span>`;
        }

        // Acciones según _manualTipo
        let accionesHtml = '';

        if (_manualTipo === 'asistencia') {
            const diasLower = String(dias).toLowerCase();
            const puedeSab = diasLower.includes('sábado') || diasLower.includes('sabado') || diasLower.includes('ambos') || diasLower.includes('y');
            const puedeDom = diasLower.includes('domingo') || diasLower.includes('ambos') || diasLower.includes('y');
            const asistioSab = String(row[COL.asistenciaSabado] || '').toLowerCase() === 'sí';
            const asistioDom = String(row[COL.asistenciaDomingo] || '').toLowerCase() === 'sí';

            // Botón Sábado
            if (puedeSab) {
                if (asistioSab) {
                    accionesHtml += `<button class="btn-checkin-action done" disabled><i class="ph-bold ph-check-circle"></i> Sábado (Ingreso ✓)</button>`;
                } else {
                    accionesHtml += `<button class="btn-checkin-action ready primary" onclick="ejecutarCheckinManual(${originalIndex}, 'asistencia', 'sabado', this)"><i class="ph-bold ph-calendar-check"></i> Marcar Sábado</button>`;
                }
            } else {
                accionesHtml += `<span class="badge-na">No asiste Sábado</span>`;
            }

            // Botón Domingo
            if (puedeDom) {
                if (asistioDom) {
                    accionesHtml += `<button class="btn-checkin-action done" disabled><i class="ph-bold ph-check-circle"></i> Domingo (Ingreso ✓)</button>`;
                } else {
                    accionesHtml += `<button class="btn-checkin-action ready primary" onclick="ejecutarCheckinManual(${originalIndex}, 'asistencia', 'domingo', this)"><i class="ph-bold ph-calendar-check"></i> Marcar Domingo</button>`;
                }
            } else {
                accionesHtml += `<span class="badge-na">No asiste Domingo</span>`;
            }

        } else {
            // MODO ALMUERZO
            const almLower = String(almuerzo).toLowerCase();
            const pidioSab = almLower.includes('sábado') || almLower.includes('sabado') || almLower === 'sí' || almLower === 'si' || almLower.includes('ambos') || almLower.includes('y');
            const pidioDom = almLower.includes('domingo') || almLower === 'sí' || almLower === 'si' || almLower.includes('ambos') || almLower.includes('y');
            const entregoSab = String(row[COL.almuerzoSabadoEntregado] || '').toLowerCase() === 'sí';
            const entregoDom = String(row[COL.almuerzoDomingoEntregado] || '').toLowerCase() === 'sí';

            // Botón Almuerzo Sábado
            if (pidioSab) {
                if (entregoSab) {
                    accionesHtml += `<button class="btn-checkin-action done" disabled><i class="ph-bold ph-check-circle"></i> Sábado (Almuerzo ✓)</button>`;
                } else {
                    accionesHtml += `<button class="btn-checkin-action ready warning" onclick="ejecutarCheckinManual(${originalIndex}, 'almuerzo', 'sabado', this)"><i class="ph-bold ph-fork-knife"></i> Entregar Almuerzo Sáb</button>`;
                }
            } else {
                accionesHtml += `<span class="badge-na">Sin almuerzo Sáb</span>`;
            }

            // Botón Almuerzo Domingo
            if (pidioDom) {
                if (entregoDom) {
                    accionesHtml += `<button class="btn-checkin-action done" disabled><i class="ph-bold ph-check-circle"></i> Domingo (Almuerzo ✓)</button>`;
                } else {
                    accionesHtml += `<button class="btn-checkin-action ready warning" onclick="ejecutarCheckinManual(${originalIndex}, 'almuerzo', 'domingo', this)"><i class="ph-bold ph-fork-knife"></i> Entregar Almuerzo Dom</button>`;
                }
            } else {
                accionesHtml += `<span class="badge-na">Sin almuerzo Dom</span>`;
            }
        }

        html += `
            <div class="manual-card">
                <div class="manual-card-header">
                    <div>
                        <h4 class="manual-card-name">${nombre}</h4>
                        <span class="manual-card-church"><i class="ph-bold ph-church"></i> ${iglesia}</span>
                    </div>
                    <div>
                        ${badgePagoHtml}
                    </div>
                </div>
                <div class="manual-card-meta">
                    <span><i class="ph-bold ph-calendar"></i> <b>Asistencia:</b> ${dias}</span>
                    <span style="color: #cbd5e1;">|</span>
                    <span><i class="ph-bold ph-fork-knife"></i> <b>Almuerzo:</b> ${almuerzo}</span>
                </div>
                <div class="manual-card-actions">
                    ${accionesHtml}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function ejecutarCheckinManual(rowIndex, tipo, dia, btnElement) {
    const row = _datosCache[rowIndex];
    if (!row) return;

    let campo = "";
    if (tipo === 'asistencia' && dia === 'sabado') campo = COL.asistenciaSabado;
    if (tipo === 'asistencia' && dia === 'domingo') campo = COL.asistenciaDomingo;
    if (tipo === 'almuerzo' && dia === 'sabado') campo = COL.almuerzoSabadoEntregado;
    if (tipo === 'almuerzo' && dia === 'domingo') campo = COL.almuerzoDomingoEntregado;

    if (String(row[campo] || '').toLowerCase() === 'sí') {
        showToast("Ya se encuentra registrado.", "warning");
        return;
    }

    if (btnElement) {
        btnElement.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Registrando...';
        btnElement.disabled = true;
    }

    const payload = {
        action: "checkin",
        rowIndex: rowIndex,
        tipo: tipo,
        dia: dia,
        nombre: row[COL.nombre]
    };

    fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: 'follow'
    }).then(async response => {
        return { success: true };
    }).catch(e => {
        console.warn("Fallo en API, actualizando localmente:", e);
    }).finally(() => {
        row[campo] = 'Sí';
        cargarDatosDashboardLocalmente();

        const etiquetaDia = dia === 'sabado' ? 'Sábado' : 'Domingo';
        const accionTexto = tipo === 'asistencia' ? 'Ingreso' : 'Almuerzo';
        showToast(`¡${accionTexto} (${etiquetaDia}) registrado para ${row[COL.nombre]}!`, "success");

        // Refrescar la lista conservando filtros activos
        filtrarListaManual();
    });
}

// ============================================================
// COMPATIBILIDAD GLOBAL PARA WORDPRESS
// Asegura que las funciones llamadas por onclick/oninput funcionen
// incluso si el plugin de WordPress encapsula el script en un closure
// ============================================================
window.switchView = switchView;
window.switchAdminTab = switchAdminTab;
window.loginAdmin = loginAdmin;
window.limpiarCredencial = limpiarCredencial;
window.generarCredencialPorNombre = generarCredencialPorNombre;
window.cargarDatosDashboard = cargarDatosDashboard;
window.renderListaAdmin = renderListaAdmin;
window.filtrarTablaAdmin = filtrarTablaAdmin;
window.abrirModalEditar = abrirModalEditar;
window.toggleCheckboxes = toggleCheckboxes;
window.cerrarModal = cerrarModal;
window.guardarEdicion = guardarEdicion;
window.iniciarEscaner = iniciarEscaner;
window.cerrarEscaner = cerrarEscaner;
window.procesarEscaneo = procesarEscaneo;
window.abrirModalValidacion = abrirModalValidacion;
window.cerrarModalValidacion = cerrarModalValidacion;
window.registrarCheckin = registrarCheckin;
window.cargarDatosDashboardLocalmente = cargarDatosDashboardLocalmente;
window.showToast = showToast;
window.toggleIglesiaInput = toggleIglesiaInput;
window.abrirModalManual = abrirModalManual;
window.cerrarModalManual = cerrarModalManual;
window.setManualFilterDia = setManualFilterDia;
window.setManualFilterPago = setManualFilterPago;
window.filtrarListaManual = filtrarListaManual;
window.renderListaManual = renderListaManual;
window.ejecutarCheckinManual = ejecutarCheckinManual;

// --- AJUSTE AUTOMÁTICO DE ALTURA Y POSICIÓN PARA IFRAME (WORDPRESS) ---
var _modalOpen = false;

if (window.parent && window.parent !== window) {
    document.body.classList.add('in-iframe');
}

window.addEventListener('message', (event) => {
    // Si WordPress nos dice dónde está el scroll de la ventana
    if (event.data && event.data.type === 'parent-scroll') {
        const modal = document.querySelector('.modal-overlay[style*="display: flex"]');
        if (modal) {
            modal.style.top = Math.max(20, (event.data.scrollY || 0) + 40) + 'px';
        }
    }
});

function sendHeightToParent() {
    if (_modalOpen) return;
    if (window.parent && window.parent !== window) {
        const microApp = document.getElementById('micro-app');
        const height = Math.ceil(
            microApp ? microApp.getBoundingClientRect().height
                     : (document.body.scrollHeight || document.documentElement.scrollHeight || 0)
        );
        if (height > 0) {
            window.parent.postMessage({ type: 'resize-iframe', height: height }, '*');
        }
    }
}

window.addEventListener('load', () => {
    sendHeightToParent();
    setTimeout(sendHeightToParent, 300);
});
window.addEventListener('resize', () => {
    if (!_modalOpen) sendHeightToParent();
});

if (window.ResizeObserver) {
    const appResizeObserver = new ResizeObserver(() => {
        if (!_modalOpen) sendHeightToParent();
    });
    const targetEl = document.getElementById('micro-app') || document.body;
    if (targetEl) {
        appResizeObserver.observe(targetEl);
    }
}