// ============================================================
//  lógica.js — Toda la lógica del cliente (Sábado 24)
//  - Llama la API (código.gs) y recibe los datos del Google Sheet
//  - Busca, filtra y calcula métricas en el navegador
//  - Dibuja la credencial, dashboard y escáner
// ============================================================

// URL de tu aplicación web de Google Apps Script (implementación nueva)
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzuy3DIa_vJg0zZVi9j95YSErhymrjCbeAxv2yXHCmuwKcF6Y6YcOYk5xIRj4DMqd8elw/exec";

// ─── NOMBRES DE COLUMNA ─────────────────────────────────────
// Mapeado con la estructura de Form_Responses en Google Sheets
const COL = {
    timestamp: "col0",        // Columna A (Marca temporal)
    nombre: "col1",           // Columna B (Nombre completo)
    denominacion: "col2",     // Columna C (Denominación)
    iglesia: "col3",          // Columna D (Iglesia)
    almuerzo: "col4",         // Columna E (¿Almorzarás?)
    sabeLlegar: "col5",       // Columna F (¿Sabes llegar al templo?)
    comoLlegar: "col6",       // Columna G (Detalle llegada)
    asistencia: "col7",       // Columna H (Check-in Asistencia Sábado 24)
    almuerzoEntregado: "col8",// Columna I (Check-in Almuerzo Sábado 24)
    estadoPago: "col9"        // Columna J (Estado de Pago)
};

// Función auxiliar para determinar si la respuesta indica que almorzará
function participanteRequiereAlmuerzo(almuerzoValor) {
    if (!almuerzoValor) return false;
    const str = String(almuerzoValor).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (str.includes("no") || str === "--" || str === "") {
        return false;
    }
    return str.includes("si") || str.includes("yes") || str.includes("almuerzo");
}

// Función para obtener el estado de pago normalizado
function obtenerEstadoPagoNormalizado(estadoRaw) {
    const raw = String(estadoRaw || '').trim();
    const lower = raw.toLowerCase();

    if (lower.includes('completo') || lower.includes('pagado')) {
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

// ─── BÚSQUEDA: En el cliente ───────────────────────────────
function buscarParticipante(rows, nombreBuscado) {
    const normalizeStr = str => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const queryWords = normalizeStr(nombreBuscado).split(/\s+/);

    return rows.find(row => {
        const rowName = normalizeStr(String(row[COL.nombre] || ""));
        return queryWords.every(word => rowName.includes(word));
    }) || null;
}

// ─── DASHBOARD: Cálculos de Métricas Sábado 24 ─────────────
function calcularDashboard(rows) {
    let inscritos = 0;
    let asistentes = 0;
    let almuerzosSolicitados = 0;
    let almuerzosEntregados = 0;
    let pagosCompletos = 0;
    let pagosPendientes = 0;
    let pagosSubvencionados = 0;

    rows.forEach(row => {
        const nombre = String(row[COL.nombre] || "").trim();
        if (nombre) inscritos++;

        // Asistencias reales (Columna H)
        if (String(row[COL.asistencia] || "").toLowerCase() === 'sí' || String(row[COL.asistencia] || "").toLowerCase() === 'si') {
            asistentes++;
        }

        // Almuerzos solicitados (Columna E)
        const reqAlm = participanteRequiereAlmuerzo(row[COL.almuerzo]);
        if (reqAlm) {
            almuerzosSolicitados++;

            // Estados de Pago
            const estado = obtenerEstadoPagoNormalizado(row[COL.estadoPago]);
            if (estado === 'Pago completo') pagosCompletos++;
            else if (estado === 'Almuerzo subvencionado') pagosSubvencionados++;
            else pagosPendientes++;
        }

        // Almuerzos entregados (Columna I)
        if (String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'sí' || String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'si') {
            almuerzosEntregados++;
        }
    });

    return {
        inscritos,
        asistentes,
        almuerzosSolicitados,
        almuerzosEntregados,
        pagosCompletos,
        pagosPendientes,
        pagosSubvencionados
    };
}

// ─── NAVEGACIÓN ─────────────────────────────────────────────
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active-view'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active-view');

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
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active-tab');

    document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
}

// ─── LOGIN ADMIN ────────────────────────────────────────────
function loginAdmin() {
    const pass = document.getElementById('adminPass').value;
    if (pass === 'cjef2026' || pass === 'admin24') {
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

    const elDenom = document.getElementById('cred-denominacion');
    if (elDenom) elDenom.innerText = "--";

    const elIglesia = document.getElementById('cred-iglesia');
    if (elIglesia) elIglesia.innerText = "--";

    const elAlmuerzo = document.getElementById('cred-almuerzo');
    if (elAlmuerzo) elAlmuerzo.innerText = "--";

    const elEstadoBadge = document.getElementById('cred-badge-estado-almuerzo');
    if (elEstadoBadge) {
        elEstadoBadge.style.display = 'none';
        elEstadoBadge.classList.remove('estado-pagado', 'estado-pago-completo', 'estado-pendiente', 'estado-subvencionado');
    }

    const elEstadoAlmuerzo = document.getElementById('cred-estado-almuerzo');
    if (elEstadoAlmuerzo) elEstadoAlmuerzo.innerText = "--";

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

    // 2. Denominación
    const elDenom = document.getElementById('cred-denominacion');
    if (elDenom) elDenom.innerText = p[COL.denominacion] || 'No especificada';

    // 3. Iglesia
    const elIglesia = document.getElementById('cred-iglesia');
    if (elIglesia) elIglesia.innerText = p[COL.iglesia] || 'No registra';

    // 4. Almuerzo
    const almuerzoRaw = String(p[COL.almuerzo] || '').trim();
    const elAlmuerzo = document.getElementById('cred-almuerzo');
    if (elAlmuerzo) elAlmuerzo.innerText = (almuerzoRaw !== '') ? almuerzoRaw : 'No';

    // 5. Estado de Pago
    const elEstadoBadge = document.getElementById('cred-badge-estado-almuerzo');
    const elEstadoAlmuerzo = document.getElementById('cred-estado-almuerzo');
    const elEstadoIcon = document.getElementById('cred-estado-almuerzo-icon');

    const reqAlm = participanteRequiereAlmuerzo(almuerzoRaw);

    if (reqAlm && elEstadoBadge && elEstadoAlmuerzo) {
        const estadoTexto = obtenerEstadoPagoNormalizado(p[COL.estadoPago]);

        elEstadoAlmuerzo.innerText = estadoTexto;
        elEstadoBadge.style.display = 'inline-flex';
        elEstadoBadge.classList.remove('estado-pagado', 'estado-pago-completo', 'estado-pendiente', 'estado-subvencionado');

        if (estadoTexto === 'Pago completo') {
            elEstadoBadge.classList.add('estado-pago-completo');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-seal-check';
        } else if (estadoTexto === 'Almuerzo subvencionado') {
            elEstadoBadge.classList.add('estado-subvencionado');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-ticket';
        } else {
            elEstadoBadge.classList.add('estado-pendiente');
            if (elEstadoIcon) elEstadoIcon.className = 'ph ph-clock';
        }
    } else if (elEstadoBadge) {
        elEstadoBadge.style.display = 'none';
    }

    // 6. Código QR
    const qrContainer = document.getElementById('qr-container');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        try {
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

    _datosCache = null;

    obtenerDatos()
        .then(rows => {
            const stats = calcularDashboard(rows);
            document.getElementById('stat-inscritos').innerText = stats.inscritos;
            document.getElementById('stat-asistentes').innerText = stats.asistentes;
            document.getElementById('stat-inscritos-total').innerText = stats.inscritos;

            document.getElementById('stat-almuerzos-entregados').innerText = stats.almuerzosEntregados;
            document.getElementById('stat-almuerzos-solicitados').innerText = stats.almuerzosSolicitados;

            if (document.getElementById('stat-pagos-completos')) {
                document.getElementById('stat-pagos-completos').innerText = stats.pagosCompletos;
            }
            if (document.getElementById('stat-pagos-pendientes')) {
                document.getElementById('stat-pagos-pendientes').innerText = stats.pagosPendientes;
            }

            renderListaAdmin(rows);

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

    const inscritos = rows
        .filter(r => String(r[COL.nombre]).trim() !== '')
        .map(r => ({ row: r, originalIndex: r.rowIndex }));

    inscritos.forEach((item, index) => {
        const { row, originalIndex } = item;
        const nombre = row[COL.nombre] || '--';
        const denominacion = row[COL.denominacion] || '--';
        const iglesia = row[COL.iglesia] || '--';
        const almuerzo = row[COL.almuerzo] || '--';

        const asistio = String(row[COL.asistencia] || "").toLowerCase() === 'sí' || String(row[COL.asistencia] || "").toLowerCase() === 'si';
        const almuerzoEntregado = String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'sí' || String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'si';

        // Badge Asistencia
        let asisHtml = asistio
            ? `<span class="badge-checkin success"><i class="fas fa-check"></i> Presente</span>`
            : `<span style="color: var(--text-muted); font-size: 13px;">No registrado</span>`;

        // Badge Almuerzo Entregado
        let almEntregaHtml = almuerzoEntregado
            ? `<span class="badge-checkin warning"><i class="fas fa-utensils"></i> Entregado</span>`
            : `<span style="color: var(--text-muted); font-size: 13px;">Pendiente</span>`;

        // Estado del Pago (solo si solicitó almuerzo)
        let estadoPagoHtml = '<span style="color: var(--text-muted); font-weight: 500;">--</span>';
        if (participanteRequiereAlmuerzo(almuerzo)) {
            const estadoTexto = obtenerEstadoPagoNormalizado(row[COL.estadoPago]);

            if (estadoTexto === 'Pago completo') {
                estadoPagoHtml = `<span class="badge-estado-almuerzo pago-completo"><i class="ph-bold ph-check-circle"></i> Pagado</span>`;
            } else if (estadoTexto === 'Almuerzo subvencionado') {
                estadoPagoHtml = `<span class="badge-estado-almuerzo subvencionado"><i class="ph-bold ph-seal-check"></i> Subvencionado</span>`;
            } else {
                estadoPagoHtml = `<span class="badge-estado-almuerzo pendiente"><i class="ph-bold ph-clock"></i> Pendiente</span>`;
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-weight: bold; font-size: 13px;">${index + 1}</td>
            <td><strong>${nombre}</strong></td>
            <td>${denominacion}</td>
            <td>${iglesia}</td>
            <td><span class="cred-badge-extra almuerzo" style="padding: 2px 8px; box-shadow:none;">${almuerzo}</span></td>
            <td>${asisHtml}</td>
            <td>${almEntregaHtml}</td>
            <td>${estadoPagoHtml}</td>
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

    const noResultRow = document.getElementById("no-results-row");
    if (noResultRow) noResultRow.remove();

    for (let i = 0; i < tr.length; i++) {
        const tds = tr[i].getElementsByTagName("td");
        if (tds.length > 1) {
            let txtNombre = normalizeStr(tds[1].textContent || tds[1].innerText);
            let txtDenom = normalizeStr(tds[2].textContent || tds[2].innerText);
            let txtIglesia = normalizeStr(tds[3].textContent || tds[3].innerText);
            let txtAlm = normalizeStr(tds[4].textContent || tds[4].innerText);
            let txtEstadoPago = normalizeStr(tds[7].textContent || tds[7].innerText);

            let combinedText = `${txtNombre} ${txtDenom} ${txtIglesia} ${txtAlm} ${txtEstadoPago}`;
            let match = queryWords.every(word => combinedText.includes(word));

            if (match) {
                tr[i].style.display = "";
                tds[0].innerText = visibleCount++;
            } else {
                tr[i].style.display = "none";
            }
        }
    }

    if (visibleCount === 1 && tr.length > 0) {
        const trVacio = document.createElement('tr');
        trVacio.id = "no-results-row";
        trVacio.innerHTML = `<td colspan="9" style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
            <span style="font-size: 15px;">No se encontraron resultados para "<strong>${input.value}</strong>"</span>
        </td>`;
        tbody.appendChild(trVacio);
    }
}

// ─── GESTIÓN DE SCROLL Y MODALES ──────────────────────────────
var _modalOpen = false;
let _scrollLockY = 0;

function bloquearScrollFondo() {
    _scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('no-scroll');
    document.body.classList.add('no-scroll');
    _modalOpen = true;

    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lock-scroll', locked: true }, '*');
    }
}

function desbloquearScrollFondo() {
    document.documentElement.classList.remove('no-scroll');
    document.body.classList.remove('no-scroll');
    _modalOpen = false;

    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lock-scroll', locked: false }, '*');
    }

    if (typeof _scrollLockY === 'number') {
        window.scrollTo(0, _scrollLockY);
    }
    setTimeout(sendHeightToParent, 50);
}

// ─── MODAL DE EDICIÓN ───────────────────────────────────────
function abrirModalEditar(sheetRowIndex) {
    if (!_datosCache) return;
    const row = _datosCache.find(r => r.rowIndex === sheetRowIndex);
    if (!row) return;

    document.getElementById('edit-rowIndex').value = sheetRowIndex;
    document.getElementById('edit-nombre').value = row[COL.nombre] || '';
    document.getElementById('edit-denominacion').value = row[COL.denominacion] || '';
    document.getElementById('edit-iglesia').value = row[COL.iglesia] || '';

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

    setSelect('edit-almuerzo', row[COL.almuerzo]);
    const estadoPagoValor = obtenerEstadoPagoNormalizado(row[COL.estadoPago]);
    setSelect('edit-estado-almuerzo', estadoPagoValor);

    // Cargar validaciones manuales (Check-ins)
    const asisCheck = document.getElementById('edit-asis-sab');
    const almCheck = document.getElementById('edit-alm-sab');
    if (asisCheck) asisCheck.checked = String(row[COL.asistencia] || "").toLowerCase() === 'sí' || String(row[COL.asistencia] || "").toLowerCase() === 'si';
    if (almCheck) almCheck.checked = String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'sí' || String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'si';

    toggleCheckboxes();

    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModal.style.top = '';
        editModal.style.display = 'flex';
        const modalContent = editModal.querySelector('.modal-content');
        if (modalContent) modalContent.scrollTop = 0;
    }
    bloquearScrollFondo();
}

function toggleCheckboxes() {
    const almuerzoInscrito = document.getElementById('edit-almuerzo').value.toLowerCase();
    const almSabCheck = document.getElementById('edit-alm-sab');
    const grupoEstadoAlmuerzo = document.getElementById('group-edit-estado-almuerzo');

    const requiereAlm = participanteRequiereAlmuerzo(almuerzoInscrito);

    if (almSabCheck) {
        almSabCheck.disabled = !requiereAlm;
        if (!requiereAlm) almSabCheck.checked = false;
    }

    if (grupoEstadoAlmuerzo) {
        if (requiereAlm) {
            grupoEstadoAlmuerzo.style.display = 'block';
        } else {
            grupoEstadoAlmuerzo.style.display = 'none';
        }
    }
}

function cerrarModal() {
    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModal.style.display = 'none';
        editModal.style.top = '';
    }
    desbloquearScrollFondo();
}

function guardarEdicion() {
    const arrayIndex = document.getElementById('edit-rowIndex').value;
    const nuevoNombre = document.getElementById('edit-nombre').value;
    const nuevaDenom = document.getElementById('edit-denominacion').value;
    const nuevaIglesia = document.getElementById('edit-iglesia').value;
    const nuevoAlmuerzo = document.getElementById('edit-almuerzo').value;
    const nuevoEstadoPago = participanteRequiereAlmuerzo(nuevoAlmuerzo)
        ? (document.getElementById('edit-estado-almuerzo').value || 'Pendiente')
        : '';

    const asis = document.getElementById('edit-asis-sab').checked ? 'Sí' : '';
    const alm = document.getElementById('edit-alm-sab').checked ? 'Sí' : '';

    const btnGuardar = document.querySelector('#editModal .btn-primary');
    const textoOriginal = btnGuardar.innerHTML;
    btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    btnGuardar.disabled = true;

    const payload = {
        action: "update",
        rowIndex: arrayIndex,
        nombre: nuevoNombre,
        denominacion: nuevaDenom,
        iglesia: nuevaIglesia,
        almuerzo: nuevoAlmuerzo,
        asistencia: asis,
        almuerzoEntregado: alm,
        estadoPago: nuevoEstadoPago
    };

    fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: 'follow'
    })
        .then(async response => {
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                console.error("Error parseando respuesta:", text);
                throw new Error("Respuesta inválida del servidor");
            }
        })
        .then(data => {
            if (data.success) {
                const sheetIdx = parseInt(arrayIndex);
                const cachedRow = _datosCache.find(r => r.rowIndex === sheetIdx);
                if (cachedRow) {
                    cachedRow[COL.nombre] = nuevoNombre;
                    cachedRow[COL.denominacion] = nuevaDenom;
                    cachedRow[COL.iglesia] = nuevaIglesia;
                    cachedRow[COL.almuerzo] = nuevoAlmuerzo;
                    cachedRow[COL.asistencia] = asis;
                    cachedRow[COL.almuerzoEntregado] = alm;
                    cachedRow[COL.estadoPago] = nuevoEstadoPago;
                }

                renderListaAdmin(_datosCache);
                cargarDatosDashboardLocalmente();
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
    if (!confirm('Para usar el escáner, necesitas dar permiso de acceso a la cámara. Cuando tu navegador te lo solicite, por favor presiona Permitir. ¿Deseas continuar?')) {
        return;
    }

    _scanPaused = false;
    const readerId = `reader-${tipo}`;

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
            if (_scanPaused) return;
            _scanPaused = true;
            procesarEscaneo(decodedText, tipo);
        },
        () => { }
    ).catch(err => {
        console.log(err);
        document.getElementById(`btn-iniciar-${tipo}`).style.removeProperty('display');
        document.getElementById(`btn-cerrar-${tipo}`).style.setProperty('display', 'none', 'important');
        document.getElementById(readerId).style.display = 'none';
        showToast("Error iniciando la cámara. Asegúrate de otorgar permisos.", "error");
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
    } catch (e) { }

    const normalizeStr = str => str ? String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
    const query = normalizeStr(decoded);

    let foundRow = _datosCache.find(row => normalizeStr(row[COL.nombre]) === query);

    if (!foundRow) {
        const queryWords = query.split(/\s+/).filter(Boolean);
        if (queryWords.length > 1) {
            foundRow = _datosCache.find(row => {
                const rowName = normalizeStr(row[COL.nombre]);
                return queryWords.every(w => rowName.includes(w));
            });
        }
    }

    if (!foundRow) {
        showToast("Participante no encontrado.", "error");
        setTimeout(() => { _scanPaused = false; }, 1500);
        return;
    }

    if (tipo === 'almuerzo') {
        const reqAlm = participanteRequiereAlmuerzo(foundRow[COL.almuerzo]);
        if (!reqAlm) {
            alert('Atención: El participante ' + foundRow[COL.nombre] + ' indicó que NO requería almuerzo.');
            showToast("No tiene almuerzo registrado.", "error");
            setTimeout(() => { _scanPaused = false; }, 1500);
            return;
        }
    }

    abrirModalValidacion(foundRow.rowIndex, tipo);
}

function abrirModalValidacion(sheetRowIndex, tipo) {
    const row = _datosCache.find(r => r.rowIndex === sheetRowIndex);
    if (!row) return;
    document.getElementById('scan-val-nombre').innerText = row[COL.nombre] || 'Sin Nombre';
    document.getElementById('scan-val-title').innerText = tipo === 'asistencia' ? 'Validar Asistencia (Sábado 24)' : 'Validar Almuerzo (Sábado 24)';

    let infoTexto = `Iglesia: ${row[COL.iglesia] || 'No registra'}`;
    if (tipo === 'almuerzo') {
        const est = obtenerEstadoPagoNormalizado(row[COL.estadoPago]);
        infoTexto += ` • Estado de Pago: ${est}`;
    }
    document.getElementById('scan-val-info').innerText = infoTexto;

    const actionsContainer = document.getElementById('scan-val-actions');
    actionsContainer.innerHTML = '';

    const yaRegistrado = (tipo === 'asistencia')
        ? (String(row[COL.asistencia] || "").toLowerCase() === 'sí' || String(row[COL.asistencia] || "").toLowerCase() === 'si')
        : (String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'sí' || String(row[COL.almuerzoEntregado] || "").toLowerCase() === 'si');

    if (yaRegistrado) {
        actionsContainer.innerHTML = `<button class="btn btn-outline" disabled><i class="ph ph-check-circle" style="color: green; font-size: 20px;"></i> ${tipo === 'asistencia' ? 'Ingreso' : 'Almuerzo'} Ya Registrado ✓</button>`;
    } else {
        const accionTexto = tipo === 'asistencia' ? 'Registrar Ingreso (Sábado 24)' : 'Entregar Almuerzo (Sábado 24)';
        actionsContainer.innerHTML = `<button class="btn btn-primary" onclick="registrarCheckin(${sheetRowIndex}, '${tipo}', this)"><i class="ph ph-check" style="font-size: 20px;"></i> ${accionTexto}</button>`;
    }

    const scanModal = document.getElementById('scanValidationModal');
    if (scanModal) {
        scanModal.style.top = '';
        scanModal.style.display = 'flex';
        const modalContent = scanModal.querySelector('.modal-content');
        if (modalContent) modalContent.scrollTop = 0;
    }
    bloquearScrollFondo();
}

function cerrarModalValidacion() {
    const scanModal = document.getElementById('scanValidationModal');
    if (scanModal) {
        scanModal.style.display = 'none';
        scanModal.style.top = '';
    }
    desbloquearScrollFondo();
    setTimeout(() => {
        _scanPaused = false;
    }, 1000);
}

function registrarCheckin(sheetRowIndex, tipo, btnElement) {
    const row = _datosCache.find(r => r.rowIndex === sheetRowIndex);
    if (!row) return;
    const campo = (tipo === 'asistencia') ? COL.asistencia : COL.almuerzoEntregado;

    const payload = {
        action: "checkin",
        rowIndex: sheetRowIndex,
        tipo: tipo,
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
        showToast(`¡${tipo === 'asistencia' ? 'Ingreso' : 'Almuerzo'} registrado exitosamente!`, "success");
        abrirModalValidacion(sheetRowIndex, tipo);
    });
}

function cargarDatosDashboardLocalmente() {
    const stats = calcularDashboard(_datosCache);
    document.getElementById('stat-inscritos').innerText = stats.inscritos;
    document.getElementById('stat-asistentes').innerText = stats.asistentes;
    document.getElementById('stat-inscritos-total').innerText = stats.inscritos;

    document.getElementById('stat-almuerzos-entregados').innerText = stats.almuerzosEntregados;
    document.getElementById('stat-almuerzos-solicitados').innerText = stats.almuerzosSolicitados;

    if (document.getElementById('stat-pagos-completos')) {
        document.getElementById('stat-pagos-completos').innerText = stats.pagosCompletos;
    }
    if (document.getElementById('stat-pagos-pendientes')) {
        document.getElementById('stat-pagos-pendientes').innerText = stats.pagosPendientes;
    }
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
    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.remove(); }, 300);
    }, 3500);
}

// ============================================================
// ─── VALIDACIÓN MANUAL SIN QR ───────────────────────────────
// ============================================================
let _manualTipo = 'asistencia'; // 'asistencia' o 'almuerzo'
let _manualFilterPago = 'todos'; // 'todos', 'completo', 'pendiente', 'subvencionado'

function abrirModalManual(tipo) {
    _manualTipo = tipo;
    _manualFilterPago = 'todos';

    const input = document.getElementById('manualSearchInput');
    if (input) input.value = '';

    document.querySelectorAll('#modalManualCheckin .manual-filter-group .btn-filter-tag').forEach(btn => {
        if (btn.getAttribute('data-filter-pago') === 'todos') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const titleEl = document.getElementById('manual-modal-title');
    const subtitleEl = document.getElementById('manual-modal-subtitle');
    const grupoPago = document.getElementById('manual-pago-filter-group');
    const tipoIndicador = document.getElementById('manual-tipo-indicador');

    if (tipo === 'asistencia') {
        if (titleEl) titleEl.innerHTML = `<i class="ph-bold ph-identification-card" style="font-size: 24px; color: #2563eb;"></i> Validación Manual de Ingreso (Sábado 24)`;
        if (subtitleEl) subtitleEl.innerText = 'Busca a los participantes para registrar su ingreso del Sábado 24';
        if (grupoPago) grupoPago.style.display = 'none';
        if (tipoIndicador) tipoIndicador.innerHTML = `<span style="color: #2563eb; font-weight: 700;"><i class="ph-bold ph-door"></i> Modo Ingreso</span>`;
    } else {
        if (titleEl) titleEl.innerHTML = `<i class="ph-bold ph-fork-knife" style="font-size: 24px; color: #d97706;"></i> Validación Manual de Almuerzo (Sábado 24)`;
        if (subtitleEl) subtitleEl.innerText = 'Verifica estado de pago y entrega de almuerzos (Sábado 24)';
        if (grupoPago) grupoPago.style.display = 'flex';
        if (tipoIndicador) tipoIndicador.innerHTML = `<span style="color: #d97706; font-weight: 700;"><i class="ph-bold ph-fork-knife"></i> Modo Almuerzos</span>`;
    }

    const modal = document.getElementById('modalManualCheckin');
    if (modal) {
        modal.style.top = '';
        modal.style.display = 'flex';
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) modalContent.scrollTop = 0;
        bloquearScrollFondo();
    }

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
    if (modal) {
        modal.style.display = 'none';
        modal.style.top = '';
    }
    desbloquearScrollFondo();
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

    let filtrados = _datosCache
        .filter(r => String(r[COL.nombre] || '').trim() !== '')
        .map(r => ({ row: r, originalIndex: r.rowIndex }));

    // En modo almuerzo: si no hay búsqueda por texto, mostramos a los que pidieron almuerzo
    if (_manualTipo === 'almuerzo' && queryWords.length === 0) {
        filtrados = filtrados.filter(item => participanteRequiereAlmuerzo(item.row[COL.almuerzo]));
    }

    // Filtro por Estado de Pago (modo almuerzo)
    if (_manualFilterPago !== 'todos') {
        filtrados = filtrados.filter(item => {
            const estadoNormalizado = obtenerEstadoPagoNormalizado(item.row[COL.estadoPago]);
            if (_manualFilterPago === 'completo') {
                return estadoNormalizado === 'Pago completo';
            } else if (_manualFilterPago === 'pendiente') {
                return estadoNormalizado === 'Pendiente';
            } else if (_manualFilterPago === 'subvencionado') {
                return estadoNormalizado === 'Almuerzo subvencionado';
            }
            return true;
        });
    }

    // Filtro por texto
    if (queryWords.length > 0) {
        filtrados = filtrados.filter(item => {
            const rowNombre = normalizeStr(item.row[COL.nombre]);
            const rowDenom = normalizeStr(item.row[COL.denominacion]);
            const rowIglesia = normalizeStr(item.row[COL.iglesia]);
            const combined = `${rowNombre} ${rowDenom} ${rowIglesia}`;
            return queryWords.every(word => combined.includes(word));
        });
    }

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
        const denominacion = row[COL.denominacion] || '';
        const iglesia = row[COL.iglesia] || 'No registra iglesia';
        const almuerzo = row[COL.almuerzo] || '--';
        const requiereAlm = participanteRequiereAlmuerzo(almuerzo);

        // Estado Pago
        let badgePagoHtml = '';
        if (requiereAlm) {
            const estTexto = obtenerEstadoPagoNormalizado(row[COL.estadoPago]);
            if (estTexto === 'Pago completo') {
                badgePagoHtml = `<span class="badge-estado-almuerzo pago-completo"><i class="ph-bold ph-check-circle"></i> Pagado</span>`;
            } else if (estTexto === 'Almuerzo subvencionado') {
                badgePagoHtml = `<span class="badge-estado-almuerzo subvencionado"><i class="ph-bold ph-seal-check"></i> Subvencionado</span>`;
            } else {
                badgePagoHtml = `<span class="badge-estado-almuerzo pendiente"><i class="ph-bold ph-clock"></i> Pendiente</span>`;
            }
        } else {
            badgePagoHtml = `<span style="font-size: 11px; color: var(--text-muted); background: #f1f5f9; padding: 3px 8px; border-radius: 12px;">Sin almuerzo</span>`;
        }

        // Acciones
        let accionesHtml = '';

        if (_manualTipo === 'asistencia') {
            const asistio = String(row[COL.asistencia] || '').toLowerCase() === 'sí' || String(row[COL.asistencia] || '').toLowerCase() === 'si';

            if (asistio) {
                accionesHtml = `<button class="btn-checkin-action done" disabled><i class="ph-bold ph-check-circle"></i> Ingreso Registrado ✓</button>`;
            } else {
                accionesHtml = `<button class="btn-checkin-action ready primary" onclick="ejecutarCheckinManual(${originalIndex}, 'asistencia', this)"><i class="ph-bold ph-calendar-check"></i> Marcar Ingreso</button>`;
            }
        } else {
            // Modo Almuerzo
            const entrego = String(row[COL.almuerzoEntregado] || '').toLowerCase() === 'sí' || String(row[COL.almuerzoEntregado] || '').toLowerCase() === 'si';

            if (requiereAlm) {
                if (entrego) {
                    accionesHtml = `<button class="btn-checkin-action done" disabled><i class="ph-bold ph-check-circle"></i> Almuerzo Entregado ✓</button>`;
                } else {
                    accionesHtml = `<button class="btn-checkin-action ready warning" onclick="ejecutarCheckinManual(${originalIndex}, 'almuerzo', this)"><i class="ph-bold ph-fork-knife"></i> Entregar Almuerzo</button>`;
                }
            } else {
                accionesHtml = `<span class="badge-na">No solicitó almuerzo</span>`;
            }
        }

        html += `
            <div class="manual-card">
                <div class="manual-card-header">
                    <div>
                        <h4 class="manual-card-name">${nombre}</h4>
                        <span class="manual-card-church"><i class="ph-bold ph-church"></i> ${iglesia} ${denominacion ? '• ' + denominacion : ''}</span>
                    </div>
                    <div>
                        ${badgePagoHtml}
                    </div>
                </div>
                <div class="manual-card-meta">
                    <span><i class="ph-bold ph-calendar"></i> <b>Fecha:</b> Sábado 24</span>
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

function ejecutarCheckinManual(sheetRowIndex, tipo, btnElement) {
    const row = _datosCache.find(r => r.rowIndex === sheetRowIndex);
    if (!row) return;

    const campo = (tipo === 'asistencia') ? COL.asistencia : COL.almuerzoEntregado;

    if (String(row[campo] || '').toLowerCase() === 'sí' || String(row[campo] || '').toLowerCase() === 'si') {
        showToast("Ya se encuentra registrado.", "warning");
        return;
    }

    if (btnElement) {
        btnElement.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Registrando...';
        btnElement.disabled = true;
    }

    const payload = {
        action: "checkin",
        rowIndex: sheetRowIndex,
        tipo: tipo,
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

        const accionTexto = tipo === 'asistencia' ? 'Ingreso' : 'Almuerzo';
        showToast(`¡${accionTexto} registrado para ${row[COL.nombre]}!`, "success");

        filtrarListaManual();
    });
}

// ============================================================
// COMPATIBILIDAD GLOBAL PARA WORDPRESS
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
window.abrirModalManual = abrirModalManual;
window.cerrarModalManual = cerrarModalManual;
window.setManualFilterPago = setManualFilterPago;
window.filtrarListaManual = filtrarListaManual;
window.renderListaManual = renderListaManual;
window.ejecutarCheckinManual = ejecutarCheckinManual;

// --- AJUSTE AUTOMÁTICO DE ALTURA Y AISLAMIENTO DE SCROLL ---
if (window.parent && window.parent !== window) {
    document.body.classList.add('in-iframe');
}

// Prevenir que cualquier interacción de scroll sobre el backdrop oscuro afecte el fondo
function inicializarAislamientoScrollModales() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('wheel', (e) => {
            if (e.target === overlay) {
                e.preventDefault();
            }
        }, { passive: false });

        overlay.addEventListener('touchmove', (e) => {
            if (e.target === overlay) {
                e.preventDefault();
            }
        }, { passive: false });
    });
}
inicializarAislamientoScrollModales();

function sendHeightToParent() {
    if (_modalOpen) return;
    if (window.parent && window.parent !== window) {
        const microApp = document.getElementById('micro-app');
        const appContent = document.querySelector('.app-content');

        let calculatedHeight = 0;
        if (appContent) {
            calculatedHeight = Math.max(
                appContent.offsetHeight + 60,
                microApp ? microApp.scrollHeight : 0,
                document.body.scrollHeight || 0,
                document.documentElement.scrollHeight || 0
            );
        } else {
            calculatedHeight = Math.max(
                document.body.scrollHeight || 0,
                document.documentElement.scrollHeight || 0
            );
        }

        const finalHeight = Math.max(650, Math.ceil(calculatedHeight));
        window.parent.postMessage({ type: 'resize-iframe', height: finalHeight }, '*');
    }
}

window.addEventListener('load', () => {
    sendHeightToParent();
    setTimeout(sendHeightToParent, 200);
    setTimeout(sendHeightToParent, 600);
    setTimeout(sendHeightToParent, 1200);
});

document.querySelectorAll('img').forEach(img => {
    if (img.complete) {
        sendHeightToParent();
    } else {
        img.addEventListener('load', sendHeightToParent);
    }
});

window.addEventListener('resize', () => {
    if (!_modalOpen) sendHeightToParent();
});

if (window.ResizeObserver) {
    const appResizeObserver = new ResizeObserver(() => {
        if (!_modalOpen) sendHeightToParent();
    });
    const targetEl = document.querySelector('.app-content') || document.getElementById('micro-app') || document.body;
    if (targetEl) {
        appResizeObserver.observe(targetEl);
    }
}