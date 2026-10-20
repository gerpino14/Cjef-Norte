// ============================================================
// API para Registro de Asistencia y Almuerzo - Google Apps Script
// Evento: Sábado 24
// ============================================================

// Nombre exacto de la pestaña en tu Google Sheet (según formulario)
var SHEET_NAME = 'Form_Responses'; 

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({
      error: "No se encontró la pestaña '" + SHEET_NAME + "'. Revisa el nombre en Google Sheets."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var rows = [];
  
  // Asumimos que la fila 0 (índice 0) son los encabezados, por eso empezamos en 1
  for (var i = 1; i < data.length; i++) {
    // Si la fila no tiene nombre (Columna B), la ignoramos
    if (!data[i][1]) continue; 
    
    rows.push({
      rowIndex: i - 1,          // Índice real en el sheet (0-based, sin encabezado)
      col0: data[i][0] || "",  // Columna A (Timestamp)
      col1: data[i][1] || "",  // Columna B (Nombre completo)
      col2: data[i][2] || "",  // Columna C (Denominación)
      col3: data[i][3] || "",  // Columna D (Iglesia)
      col4: data[i][4] || "",  // Columna E (¿Almorzarás?)
      col5: data[i][5] || "",  // Columna F (¿Sabes llegar al templo?)
      col6: data[i][6] || "",  // Columna G (Información sobre cómo llegar)
      col7: data[i][7] || "",  // Columna H (Check-in Asistencia Sábado 24)
      col8: data[i][8] || "",  // Columna I (Check-in Almuerzo Sábado 24)
      col9: data[i][9] || ""   // Columna J (Estado de Pago)
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
      sheet.getRange(rowNum, 3).setValue(payload.denominacion || '');
      sheet.getRange(rowNum, 4).setValue(payload.iglesia || '');
      sheet.getRange(rowNum, 5).setValue(payload.almuerzo || '');
      sheet.getRange(rowNum, 8).setValue(payload.asistencia || '');
      sheet.getRange(rowNum, 9).setValue(payload.almuerzoEntregado || '');
      sheet.getRange(rowNum, 10).setValue(payload.estadoPago || '');
      
      return ContentService.createTextOutput(JSON.stringify({success: true}))
        .setMimeType(ContentService.MimeType.JSON);
    } 
    
    // ACCIÓN: Nuevo Check-in mediante código QR o botón manual
    else if (payload.action === 'checkin') {
      var colNum = 0;
      
      // Mapear los tipos de checkin a su respectiva columna (H=8, I=9)
      if (payload.tipo === 'asistencia') colNum = 8; // Columna H (Asistencia Sábado 24)
      if (payload.tipo === 'almuerzo')   colNum = 9; // Columna I (Almuerzo Sábado 24)
      
      if (colNum > 0) {
        // Escribimos un "Sí" en la columna que corresponda
        sheet.getRange(rowNum, colNum).setValue('Sí');
        return ContentService.createTextOutput(JSON.stringify({success: true}))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Tipo de check-in inválido'}))
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
