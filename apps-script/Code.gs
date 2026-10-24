// Paste this in your sheet: Extensions -> Apps Script
const SECRET = 'change-this-to-a-long-random-string';

function doGet(e) {
  if (!e.parameter.key || e.parameter.key !== SECRET) return out({ error: 'forbidden' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = {};
  ['Leaders', 'Jury', 'Trial', 'Settings'].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) data[name] = sheet.getDataRange().getDisplayValues();
  });
  return out(data);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
