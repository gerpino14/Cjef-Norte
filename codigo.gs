// ============================================================
// API para Jornada Espiritual - Google Apps Script
// ============================================================

// TODO: Cambia esto al nombre exacto de tu pestaña en Google Sheets
var SHEET_NAME = 'Respuestas de formulario 1'; 

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  
  var rows = [];
  
  // Asumimos que la fila 0 (índice 0) son los encabezados, por eso empezamos en 1
  for (var i = 1; i < data.length; i++) {
    // Si la fila está vacía, la ignoramos
    if (!data[i][1] && !data[i][2]) continue; 
    
    rows.push({
      col0: data[i][0] || "",  // Columna A (Timestamp)
      col1: data[i][1] || "",  // Columna B (Nombre)
      col2: data[i][2] || "",  // Columna C (Correo)
      col3: data[i][3] || "",  // Columna D (Teléfono)
      col4: data[i][4] || "",  // Columna E (Iglesia)
      col5: data[i][5] || "",  // Columna F (Días de asistencia)
      col6: data[i][6] || "",  // Columna G (Almuerzo)
      col7: data[i][7] || "",  // Columna H (Alojamiento)
      col8: data[i][8] || "",  // Columna I (Check-in Asistencia Sábado)
      col9: data[i][9] || "",  // Columna J (Check-in Asistencia Domingo)
      col10: data[i][10] || "", // Columna K (Check-in Almuerzo Sábado)
      col11: data[i][11] || "", // Columna L (Check-in Almuerzo Domingo)
      col12: data[i][12] || ""  // Columna M (Estado Almuerzo)
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({rows: rows}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  
  try {
    var payload = JSON.parse(e.postData.contents);
    
    // La fila real en el Sheet es el índice del frontend + 2 
    // (+1 porque los arrays empiezan en 0, y +1 porque la fila 1 son los encabezados)
    var rowNum = parseInt(payload.rowIndex) + 2; 

    // ACCIÓN: Editar los datos de un participante (desde el modal de edición manual)
    if (payload.action === 'update') {
      sheet.getRange(rowNum, 2).setValue(payload.nombre);
      sheet.getRange(rowNum, 3).setValue(payload.correo);
      sheet.getRange(rowNum, 4).setValue(payload.telefono);
      sheet.getRange(rowNum, 5).setValue(payload.iglesia);
      sheet.getRange(rowNum, 6).setValue(payload.dias);
      sheet.getRange(rowNum, 7).setValue(payload.almuerzo);
      sheet.getRange(rowNum, 8).setValue(payload.alojamiento);
      sheet.getRange(rowNum, 9).setValue(payload.asisSab || '');
      sheet.getRange(rowNum, 10).setValue(payload.asisDom || '');
      sheet.getRange(rowNum, 11).setValue(payload.almSab || '');
      sheet.getRange(rowNum, 12).setValue(payload.almDom || '');
      sheet.getRange(rowNum, 13).setValue(payload.estadoAlmuerzo || '');
      
      return ContentService.createTextOutput(JSON.stringify({success: true}))
        .setMimeType(ContentService.MimeType.JSON);
    } 
    
    // ACCIÓN: Nuevo Check-in mediante código QR
    else if (payload.action === 'checkin') {
      var colNum = 0;
      
      // Mapear los tipos de checkin a su respectiva columna (I=9, J=10, K=11, L=12)
      if (payload.tipo === 'asistencia' && payload.dia === 'sabado') colNum = 9;   // Columna I
      if (payload.tipo === 'asistencia' && payload.dia === 'domingo') colNum = 10; // Columna J
      if (payload.tipo === 'almuerzo' && payload.dia === 'sabado') colNum = 11;    // Columna K
      if (payload.tipo === 'almuerzo' && payload.dia === 'domingo') colNum = 12;   // Columna L
      
      if (colNum > 0) {
        // Escribimos un "Sí" en la columna que corresponda
        sheet.getRange(rowNum, colNum).setValue('Sí');
        return ContentService.createTextOutput(JSON.stringify({success: true}))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Día o tipo inválido'}))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Acción desconocida'}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Manejo de solicitudes CORS para que el fetch() desde el frontend no sea bloqueado
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}
