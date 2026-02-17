importPackage(Packages.de.elo.ix.client);
importPackage(Packages.de.elo.ix.jscript);
importPackage(Packages.de.elo.ix.scripting);
importPackage(java.io);
importPackage(java.net);
importPackage(Packages.de.elo.utils);
importPackage(java.nio.file);
importPackage(java.nio);
importPackage(Packages.org.apache.commons.codec);
importPackage(Packages.org.apache.commons.codec.binary);
importPackage(java.util.zip);
importPackage(java.lang);
importPackage(org.jwall.web.audit.io.BinaryReader);
importPackage(Packages.de.elo.ix.client.imfs);

//http://ndelodev03:9070/as-EON?cmd=get&name=as_arh_import_excels&param1=1&param2=recurenta"

// ==========================================================================
// AS RULE: Import XLSX from SFTP (recurenta / istoric)
// EM_PARAM2: "recurenta" | "istoric"
// ==========================================================================

var DEBUG = true;

// ==========================================================================
// CONFIG
// ==========================================================================
var config = getConfig();

var SFTP_HOST = config.sftp.host;
var SFTP_PORT = config.sftp.port;
var SFTP_USER = config.sftp.user;
var SFTP_PASS = config.sftp.password;

var LOCAL_TMP = sol.common.FileUtils.getTempDirPath();

var RECUR_IN = config.sftp.excel_import.recurenta.in;
var RECUR_OUT = config.sftp.excel_import.recurenta.out;
var RECUR_ERR = config.sftp.excel_import.recurenta.err;

var IST_IN = (config.sftp.excel_import.istoric && config.sftp.excel_import.istoric.in) || "";
var IST_OUT = (config.sftp.excel_import.istoric && config.sftp.excel_import.istoric.out) || "";
var IST_ERR = (config.sftp.excel_import.istoric && config.sftp.excel_import.istoric.err) || "";

// SQL targets
var SQL_TABLE_RECUR = "[Lucru_EON].[dbo].[arh_arhiva_recurenta]";
var SQL_TABLE_IST = "[Lucru_EON].[dbo].[arh_istoric_arhiva_documente]";

// Expected headers (exact, but we normalize a bit)
var EXPECTED_HEADERS = [
  "SKP",
  "SEQ",
  "CRC",
  "COD/NUMAR LOC CONSUM",
  "COD CLIENT/ABONAT",
  "NR CONTRACT",
  "AN",
  "DATA PROCESARE"
];

// ==========================================================================
// ISTORIC: fixed SQL insert header (this is the "fixed header" you asked for)
// ==========================================================================
var IST_SQL_HEADER = [
  "skp",
  "Localitate",
  "Tip_Produs",
  "an_creare",
  "Tip_contract",
  "cod_cutie_obiect",
  "cod_obiect"
];

// CASNIC / NONCASNIC extractor (like python)
var TIP_CONTRACT_RE = /\b(CASNIC|NONCASNIC)\b/i;

// Candidate header names (normalized matching)
var IST_COL_CANDIDATES = {
  skp: ["SKP", "skp"],
  localitate: ["Localitate", "localitate"],
  tip_excel: ["Tip", "tip"], // optional legacy
  tip_produs: ["Tip_Produs", "tip_produs", "Tip Produs", "tip produs", "Tip_Contract", "tip_contract", "Tip Contract", "tip contract", "tip produs/contract"],
  tip_contract: ["Tip_Contract", "tip_contract", "Tip Contract", "tip contract"],

  an_creare: ["an_creare", "AN", "an"],

  cod_cutie_obiect: ["cod_cutie_obiect", "CUTIE MARE", "cutie mare"],
  cod_obiect: ["cod_obiect", "CUTIE MICA", "cutie mica"],

  crc: ["CRC", "crc"],
  sumar: ["Sumar", "sumar"],
  gama_de_la: ["gama_de_la", "GAMA_DE_LA", "gama de la"],
  gama_pana_la: ["gama_pana_la", "GAMA_PANA_LA", "gama pana la"],
  tip_doc_cod_arh: ["tip_doc_cod_arh", "TIP_DOC_COD_ARH", "tip doc cod arh"],
  tip_pastrare: ["tip_pastrare", "TIP_PASTRARE", "tip pastrare"],
  data_creare: ["data_creare", "DATA_CREARE", "data creare"],
  locatie_geografica: ["locatie_geografica", "LOCATIE_GEOGRAFICA", "locatie geografica"],
  divizie: ["divizie", "DIVIZIE"],
  departament: ["departament", "DEPARTAMENT"]
};


// ==========================================================================
// ENTRY POINT
// ==========================================================================
var response = {
  ok: true,
  startedAt: nowIso(),
  finishedAt: null,
  summary: {
    scannedFiles: 0,
    processedFiles: 0,
    okFiles: 0,
    errFiles: 0,
    insertedRows: 0,
    skippedEmptyRows: 0,
    skippedDuplicateRows: 0,
  },
  files: [],
  log: []
};

try {
  processRecurenta();
  processIstoric();
} catch (e) {
  response.ok = false;
  logLine("FATAL ERROR: " + e);
} finally {
  response.finishedAt = nowIso();
  //ruleset.setStatusMessage(JSON.stringify(response));
}

// ==========================================================================
// MAIN: RECUARENTA FLOW
// ==========================================================================
function processRecurenta() {
  var sftp = connectToSftp();
  if (!sftp) {
    response.ok = false;
    logLine("Failed to connect to SFTP.");
    return;
  }

  try {
    var files = listFilesInSftpDirectory(sftp, RECUR_IN)
      .filter(function (fn) { return isXlsx(fn); })
      .sort(function (a, b) { return a.localeCompare(b); });

    response.summary.scannedFiles += files.length;

    if (files.length === 0) {
      logLine("No .xlsx files found in: " + RECUR_IN);
      return;
    }

    for (var i = 0; i < files.length; i++) {
      var fileName = files[i];
      var fileResult = processOneRecurentaFile(sftp, fileName);

      response.files.push(fileResult);
      response.summary.processedFiles++;

      if (fileResult.ok) response.summary.okFiles++;
      else response.summary.errFiles++;

      response.summary.insertedRows += (fileResult.insertedRows || 0);
      response.summary.skippedEmptyRows += (fileResult.skippedEmptyRows || 0);
      response.summary.skippedDuplicateRows += (fileResult.skippedDuplicateRows || 0);

    }

  } finally {
    try { sftp.disconnect(); } catch (e2) { }
  }
}

// ==========================================================================
// MAIN: ISTORIC FLOW
// ==========================================================================
// ==========================================================================
// MAIN: ISTORIC FLOW
// ==========================================================================
function processIstoric() {
  // if not configured, just skip silently
  if (!IST_IN || !IST_OUT || !IST_ERR) {
    logLine("ISTORIC flow skipped (missing IST_* paths in config).");
    return;
  }

  var sftp = connectToSftp();
  if (!sftp) {
    response.ok = false;
    logLine("Failed to connect to SFTP.");
    return;
  }

  try {
    var files = listFilesInSftpDirectory(sftp, IST_IN)
      .filter(function (fn) { return isXlsx(fn); })
      .sort(function (a, b) { return a.localeCompare(b); });

    response.summary.scannedFiles += files.length;

    if (files.length === 0) {
      logLine("No .xlsx files found in: " + IST_IN);
      return;
    }

    // Note: keeping same summary counters (your response.summary is recurenta-centric,
    // but we still append per-file results + logs)
    for (var i = 0; i < files.length; i++) {
      var fileName = files[i];
      var fileResult = processOneIstoricFile(sftp, fileName);

      response.files.push(fileResult);
      response.summary.processedFiles++;

      if (fileResult.ok) response.summary.okFiles++;
      else response.summary.errFiles++;

      response.summary.insertedRows += (fileResult.insertedRows || 0);
      response.summary.skippedEmptyRows += (fileResult.skippedEmptyRows || 0);
      response.summary.skippedDuplicateRows += (fileResult.skippedDuplicateRows || 0);

    }

  } finally {
    try { sftp.disconnect(); } catch (e2) { }
  }
}



function processOneRecurentaFile(sftp, fileName) {
  fileName = "" + fileName;

  var res = {
    fileName: fileName,
    ok: false,
    startedAt: nowIso(),
    endedAt: null,
    insertedRows: 0,
    skippedRows: 0,
    errors: [],
    log: []
  };

  var importRunId = newGuid();
  res.importRunId = importRunId;
  res.importFileName = fileName;
  res.log.push("import_run_id=" + importRunId);
  res.log.push("import_file_name=" + fileName);

  var startBanner = "START PROCESS " + fileName;
  var endBanner = "END PROCESS " + fileName;

  res.log.push(startBanner);
  logLine(startBanner);

  var remoteInPath = RECUR_IN + "/" + fileName;
  var localXlsx = LOCAL_TMP + "/" + fileName;

  // log file name
  var logTxtName = fileName.replace(/\.xlsx$/i, "") + "_import_log.txt";
  var localLogPath = LOCAL_TMP + "/" + logTxtName;

  var destFolder = RECUR_OUT; // default; on error -> RECUR_ERR

  try {
    // 1) download
    sftpDownloadToLocal(sftp, remoteInPath, localXlsx);
    res.log.push("Downloaded: " + remoteInPath + " -> " + localXlsx);

    // 2) parse ALL sheets
    var sheets = readXlsxAllSheets_Recurenta(localXlsx); // [{sheetName, headers, rows}, ...]
    if (!sheets || sheets.length === 0) {
      throw "XLSX has no sheets.";
    }

    res.log.push("Sheets detected: " + sheets.length);

    // 3) validate headers + prepare rows from ALL sheets
    var allPreparedRows = [];
    var totalSkippedEmpty = 0;

    for (var s = 0; s < sheets.length; s++) {
      var sh = sheets[s];
      if (!sh) continue;

      // skip truly empty sheets (no headers + no rows)
      if ((!sh.headers || sh.headers.length === 0) && (!sh.rows || sh.rows.length === 0)) {
        continue;
      }

      // validate headers per sheet (same rule as before)
      validateHeaders(sh.headers);
      res.log.push("Header validation OK. Sheet=" + sh.sheetName + " Columns: " + sh.headers.join(" | "));

      // prepare rows for this sheet
      var prepared = prepareRecurentaRows(sh.rows, res);
      if (prepared && prepared.rows && prepared.rows.length > 0) {
        for (var k = 0; k < prepared.rows.length; k++) allPreparedRows.push(prepared.rows[k]);
      }

      totalSkippedEmpty += (res.skippedEmptyRows || 0);
    }

    // IMPORTANT: prepareRecurentaRows sets fileRes.skippedEmptyRows each time.
    // After looping, set it to the total across all sheets (so your log is correct).
    res.skippedEmptyRows = totalSkippedEmpty;

    for (var rr = 0; rr < allPreparedRows.length; rr++) {
      allPreparedRows[rr].import_run_id = importRunId;
      allPreparedRows[rr].import_file_name = fileName;
    }

    // 4) insert into DB (batch) using merged rows
    var inserted = insertRecurentaRows(allPreparedRows, res);
    res.insertedRows = inserted;


    // 5) mark OK
    res.ok = true;
    destFolder = RECUR_OUT;
    res.log.push(
      "DB insert OK. Inserted rows: " + res.insertedRows +
      ", skipped empty: " + res.skippedEmptyRows +
      ", skipped duplicates: " + res.skippedDuplicateRows
    );

  } catch (e) {
    res.ok = false;
    destFolder = RECUR_ERR;
    var msg = "" + e;
    res.errors.push(msg);
    res.log.push("ERROR: " + msg);
    logLine("ERROR processing " + fileName + ": " + msg);
  }

  // 6) write log and move file accordingly (always attempt)
  try {
    res.log.push(endBanner);

    // write local log
    writeLocalTextFile(localLogPath, res.log.join("\n"));

    // move xlsx on SFTP (rename)
    var remoteDestXlsx = destFolder + "/" + fileName;
    safeSftpMove(sftp, remoteInPath, remoteDestXlsx);

    // upload log into same destination folder (OUT or ERR)
    var remoteDestLog = destFolder + "/" + logTxtName;
    safeSftpUpload(sftp, localLogPath, remoteDestLog);

    res.log.push("Moved XLSX to: " + remoteDestXlsx);
    res.log.push("Uploaded LOG to: " + remoteDestLog);

  } catch (e2) {
    // If moving/log upload fails, still return result with extra error
    res.ok = false;
    res.errors.push("Post-processing (move/log upload) failed: " + e2);
    res.log.push("Post-processing (move/log upload) failed: " + e2);
  } finally {
    res.endedAt = nowIso();
    // also bubble some of the per-file log into global response.log (browser)
    pushGlobalLogBlock(res.log);
  }

  logLine(endBanner);
  return res;
}


function processOneIstoricFile(sftp, fileName) {
  fileName = "" + fileName;

  var res = {
    fileName: fileName,
    flow: "istoric",
    ok: false,
    startedAt: nowIso(),
    endedAt: null,
    insertedRows: 0,
    skippedRows: 0,
    errors: [],
    log: []
  };

  var importRunId = newGuid();
  res.importRunId = importRunId;
  res.importFileName = fileName;
  res.log.push("import_run_id=" + importRunId);
  res.log.push("import_file_name=" + fileName);

  var startBanner = "START ISTORIC " + fileName;
  var endBanner = "END ISTORIC " + fileName;

  res.log.push(startBanner);
  logLine(startBanner);

  var remoteInPath = IST_IN + "/" + fileName;
  var localXlsx = LOCAL_TMP + "/" + fileName;

  var logTxtName = fileName.replace(/\.xlsx$/i, "") + "_istoric_import_log.txt";
  var localLogPath = LOCAL_TMP + "/" + logTxtName;

  var destFolder = IST_OUT; // default; on error -> IST_ERR

  try {
    // 1) download
    sftpDownloadToLocal(sftp, remoteInPath, localXlsx);
    res.log.push("Downloaded: " + remoteInPath + " -> " + localXlsx);

    // 2) read ALL sheets
    var book = readXlsxAllSheets(localXlsx); // [{sheetName, headers, rows}, ...]
    if (!book || book.length === 0) {
      res.log.push("No sheets found in XLSX.");
    }

    res.log.push("IST SQL header fixed: " + IST_SQL_HEADER.join(" | "));
    res.log.push("Sheets detected: " + (book ? book.length : 0));

    // 3) build rows from all sheets
    var allRows = [];
    for (var s = 0; s < book.length; s++) {
      var sheetObj = book[s];
      if (!sheetObj || !sheetObj.rows || sheetObj.rows.length === 0) continue;

      var prep = prepareIstoricRows(sheetObj.headers, sheetObj.rows, res, sheetObj.sheetName);
      if (prep && prep.rows && prep.rows.length > 0) {
        // merge
        for (var k = 0; k < prep.rows.length; k++) allRows.push(prep.rows[k]);
      }
    }

    res.log.push("Total prepared ISTORIC rows (all sheets): " + allRows.length);

    for (var rr = 0; rr < allRows.length; rr++) {
      allRows[rr].import_run_id = importRunId;
      allRows[rr].import_file_name = fileName;
    }



    // 4) insert DB (batch)
    var inserted = insertIstoricRows(allRows, res);
    res.insertedRows = inserted;

    // 5) ok
    res.ok = true;
    destFolder = IST_OUT;
    res.log.push("DB insert OK. Inserted rows: " + res.insertedRows);

  } catch (e) {
    res.ok = false;
    destFolder = IST_ERR;
    var msg = "" + e;
    res.errors.push(msg);
    res.log.push("ERROR: " + msg);
    logLine("ERROR ISTORIC processing " + fileName + ": " + msg);
  }

  // 6) write log and move file accordingly (always attempt)
  try {
    res.log.push(endBanner);

    writeLocalTextFile(localLogPath, res.log.join("\n"));

    var remoteDestXlsx = destFolder + "/" + fileName;
    safeSftpMove(sftp, remoteInPath, remoteDestXlsx);

    var remoteDestLog = destFolder + "/" + logTxtName;
    safeSftpUpload(sftp, localLogPath, remoteDestLog);

    res.log.push("Moved XLSX to: " + remoteDestXlsx);
    res.log.push("Uploaded LOG to: " + remoteDestLog);

  } catch (e2) {
    res.ok = false;
    res.errors.push("Post-processing (move/log upload) failed: " + e2);
    res.log.push("Post-processing (move/log upload) failed: " + e2);
  } finally {
    res.endedAt = nowIso();
    pushGlobalLogBlock(res.log);
  }

  logLine(endBanner);
  return res;
}


function newGuid() {
  return Packages.java.util.UUID.randomUUID().toString();
}


// ==========================================================================
// XLSX READER (Apache POI) - ALL sheets, first row = headers
// returns: [{ sheetName, headers:[...], rows:[{...}] }, ...]
// ==========================================================================
function readXlsxAllSheets(localFilePath) {
  var FileInputStream = Packages.java.io.FileInputStream;
  var fis = new FileInputStream(localFilePath);

  try {
    var XSSFWorkbook = Packages.org.apache.poi.xssf.usermodel.XSSFWorkbook;
    var wb = new XSSFWorkbook(fis);

    try {
      var out = [];
      var sheetCount = wb.getNumberOfSheets();

      for (var si = 0; si < sheetCount; si++) {
        var sheet = wb.getSheetAt(si);
        if (!sheet) continue;

        var sheetName = "" + wb.getSheetName(si);

        var headerRow = sheet.getRow(0);
        if (!headerRow) {
          out.push({ sheetName: sheetName, headers: [], rows: [] });
          continue;
        }

        var headers = [];
        var headerMap = {}; // colIndex -> rawHeader (NOT normalized here)

        var lastCell = headerRow.getLastCellNum();
        if (lastCell < 0) lastCell = 0;

        for (var c = 0; c < lastCell; c++) {
          var cell = headerRow.getCell(c);
          var raw = safeStr(getCellAsString(cell));
          if (raw) {
            headers.push(raw);
            headerMap[c] = raw;
          }
        }

        var rows = [];
        var lastRowNum = sheet.getLastRowNum();
        for (var r = 1; r <= lastRowNum; r++) {
          var row = sheet.getRow(r);
          if (!row) {
            rows.push({});
            continue;
          }

          var obj = {};
          for (var cc = 0; cc < lastCell; cc++) {
            var h = headerMap[cc];
            if (!h) continue;
            obj[h] = getCellAsString(row.getCell(cc));
          }
          rows.push(obj);
        }

        out.push({ sheetName: sheetName, headers: headers, rows: rows });
      }

      return out;
    } finally {
      try { wb.close(); } catch (e2) { }
    }
  } finally {
    try { fis.close(); } catch (e3) { }
  }
}


// ==========================================================================
// XLSX READER (Apache POI) - ALL sheets, first row = headers
// returns: [{ sheetName, headers:[...normalized...], rows:[{...}] }, ...]
// NOTE: headers are normalized with normalizeHeader() and row keys use normalized headers
// ==========================================================================
function readXlsxAllSheets_Recurenta(localFilePath) {
  var FileInputStream = Packages.java.io.FileInputStream;
  var fis = new FileInputStream(localFilePath);

  try {
    var XSSFWorkbook = Packages.org.apache.poi.xssf.usermodel.XSSFWorkbook;
    var wb = new XSSFWorkbook(fis);

    try {
      var out = [];
      var sheetCount = wb.getNumberOfSheets();

      for (var si = 0; si < sheetCount; si++) {
        var sheet = wb.getSheetAt(si);
        if (!sheet) continue;

        var sheetName = "" + wb.getSheetName(si);

        var headerRow = sheet.getRow(0);
        if (!headerRow) {
          out.push({ sheetName: sheetName, headers: [], rows: [] });
          continue;
        }

        var headers = [];
        var headerMap = {}; // colIndex -> normalizedHeader

        var lastCell = headerRow.getLastCellNum();
        if (lastCell < 0) lastCell = 0;

        for (var c = 0; c < lastCell; c++) {
          var cell = headerRow.getCell(c);
          var h = normalizeHeader(getCellAsString(cell)); // same as recurenta
          if (h) {
            headers.push(h);
            headerMap[c] = h;
          }
        }

        var rows = [];
        var lastRowNum = sheet.getLastRowNum();
        for (var r = 1; r <= lastRowNum; r++) {
          var row = sheet.getRow(r);
          if (!row) {
            rows.push({});
            continue;
          }

          var obj = {};
          for (var cc = 0; cc < lastCell; cc++) {
            var headerName = headerMap[cc];
            if (!headerName) continue;
            obj[headerName] = getCellAsString(row.getCell(cc));
          }
          rows.push(obj);
        }

        out.push({ sheetName: sheetName, headers: headers, rows: rows });
      }

      return out;
    } finally {
      try { wb.close(); } catch (e2) { }
    }
  } finally {
    try { fis.close(); } catch (e3) { }
  }
}


function prepareIstoricRows(headers, rows, fileRes, sheetName) {
  // Build normalized header map: normName -> originalHeader
  var normMap = {};
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    var n = normalizeHeaderName(h);
    if (n && !normMap[n]) normMap[n] = h;
  }

  function findCol(candidates) {
    for (var j = 0; j < candidates.length; j++) {
      var key = normalizeHeaderName(candidates[j]);
      if (normMap[key]) return normMap[key];
    }
    return null;
  }

  var c_skp = findCol(IST_COL_CANDIDATES.skp);
  var c_localitate = findCol(IST_COL_CANDIDATES.localitate);

  var c_tip_excel = findCol(IST_COL_CANDIDATES.tip_excel);     // legacy
  var c_tip_produs = findCol(IST_COL_CANDIDATES.tip_produs);
  var c_tip_contract = findCol(IST_COL_CANDIDATES.tip_contract);

  var c_an_creare = findCol(IST_COL_CANDIDATES.an_creare);

  var c_cod_cutie_obiect = findCol(IST_COL_CANDIDATES.cod_cutie_obiect);
  var c_cod_obiect = findCol(IST_COL_CANDIDATES.cod_obiect);

  var c_crc = findCol(IST_COL_CANDIDATES.crc);
  var c_sumar = findCol(IST_COL_CANDIDATES.sumar);
  var c_gama_de_la = findCol(IST_COL_CANDIDATES.gama_de_la);
  var c_gama_pana_la = findCol(IST_COL_CANDIDATES.gama_pana_la);
  var c_tip_doc_cod_arh = findCol(IST_COL_CANDIDATES.tip_doc_cod_arh);
  var c_tip_pastrare = findCol(IST_COL_CANDIDATES.tip_pastrare);
  var c_data_creare = findCol(IST_COL_CANDIDATES.data_creare);
  var c_locatie_geo = findCol(IST_COL_CANDIDATES.locatie_geografica);
  var c_divizie = findCol(IST_COL_CANDIDATES.divizie);
  var c_departament = findCol(IST_COL_CANDIDATES.departament);


  fileRes.log.push(
    "Sheet '" + sheetName + "' header map: " +
    "skp=" + (c_skp || "NULL") + ", localitate=" + (c_localitate || "NULL") +
    ", tip=" + (c_tip_excel || "NULL") + ", tip_produs=" + (c_tip_produs || "NULL") +
    ", tip_contract=" + (c_tip_contract || "NULL") +
    ", an_creare=" + (c_an_creare || "NULL") +
    ", cod_cutie_obiect=" + (c_cod_cutie_obiect || "NULL") +
    ", cod_obiect=" + (c_cod_obiect || "NULL") +
    ", crc=" + (c_crc || "NULL") +
    ", sumar=" + (c_sumar || "NULL") +
    ", gama_de_la=" + (c_gama_de_la || "NULL") +
    ", gama_pana_la=" + (c_gama_pana_la || "NULL") +
    ", tip_doc_cod_arh=" + (c_tip_doc_cod_arh || "NULL") +
    ", tip_pastrare=" + (c_tip_pastrare || "NULL") +
    ", data_creare=" + (c_data_creare || "NULL") +
    ", locatie_geografica=" + (c_locatie_geo || "NULL") +
    ", divizie=" + (c_divizie || "NULL") +
    ", departament=" + (c_departament || "NULL")
  );


  var out = [];
  var skippedEmpty = 0;

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];

    // completely empty row -> skip
    if (isRowEmpty(row)) {
      skippedEmpty++;
      continue;
    }

    // Read values (diacritics stripped, trimmed). Missing columns become "" => later NULL
    var skp = stripDiacriticsValue(safeStr(c_skp ? row[c_skp] : ""));
    var localitate = stripDiacriticsValue(safeStr(c_localitate ? row[c_localitate] : ""));

    var tipProdus = stripDiacriticsValue(safeStr(c_tip_produs ? row[c_tip_produs] : ""));
    var tipContract = stripDiacriticsValue(safeStr(c_tip_contract ? row[c_tip_contract] : ""));
    var tipExcel = stripDiacriticsValue(safeStr(c_tip_excel ? row[c_tip_excel] : ""));

    var anCreare = stripDiacriticsValue(safeStr(c_an_creare ? row[c_an_creare] : ""));

    var cutieObj = stripDiacriticsValue(safeStr(c_cod_cutie_obiect ? row[c_cod_cutie_obiect] : ""));
    var obiect = stripDiacriticsValue(safeStr(c_cod_obiect ? row[c_cod_obiect] : ""));

    var crc = stripDiacriticsValue(safeStr(c_crc ? row[c_crc] : ""));
    var sumar = stripDiacriticsValue(safeStr(c_sumar ? row[c_sumar] : ""));
    var gamaDeLa = stripDiacriticsValue(safeStr(c_gama_de_la ? row[c_gama_de_la] : ""));
    var gamaPanaLa = stripDiacriticsValue(safeStr(c_gama_pana_la ? row[c_gama_pana_la] : ""));
    var tipDoc = stripDiacriticsValue(safeStr(c_tip_doc_cod_arh ? row[c_tip_doc_cod_arh] : ""));
    var tipPastrare = stripDiacriticsValue(safeStr(c_tip_pastrare ? row[c_tip_pastrare] : ""));
    var dataCreare = stripDiacriticsValue(safeStr(c_data_creare ? row[c_data_creare] : ""));
    var locGeo = stripDiacriticsValue(safeStr(c_locatie_geo ? row[c_locatie_geo] : ""));
    var divizie = stripDiacriticsValue(safeStr(c_divizie ? row[c_divizie] : ""));
    var departament = stripDiacriticsValue(safeStr(c_departament ? row[c_departament] : ""));


    // Tip_contract logic: if "tip" exists use it; else extract from Tip_Produs
    if (!tipContract) {
      if (tipExcel) {
        tipContract = tipExcel;
      } else {
        var extracted = extractTipContractFromTipProdus(tipProdus);
        tipContract = extracted.tipContract || "";
        tipProdus = extracted.cleanedTipProdus || tipProdus;
      }
    }


    // if row is "effectively empty" across all mapped fields -> skip
    if (!skp && !localitate && !tipProdus && !anCreare && !tipContract && !cutieObj && !obiect &&
      !crc && !sumar && !gamaDeLa && !gamaPanaLa && !tipDoc && !tipPastrare && !dataCreare && !locGeo && !divizie && !departament) {
      skippedEmpty++;
      continue;
    }


    out.push({
      skp: skp || null,
      Localitate: localitate || null,
      Tip_Produs: tipProdus || null,
      Tip_Contract: tipContract || null,
      CRC: crc || null,
      sumar: sumar || null,
      gama_de_la: gamaDeLa || null,
      gama_pana_la: gamaPanaLa || null,
      tip_doc_cod_arh: tipDoc || null,
      tip_pastrare: tipPastrare || null,
      data_creare: dataCreare || null,
      locatie_geografica: locGeo || null,
      divizie: divizie || null,
      departament: departament || null,
      an_creare: anCreare || null,
      cod_cutie_obiect: cutieObj || null,
      cod_obiect: obiect || null
    });

  }

  fileRes.log.push("Sheet '" + sheetName + "': prepared rows=" + out.length + ", skipped empty=" + skippedEmpty);
  return { rows: out, skippedEmpty: skippedEmpty };
}

function insertIstoricRows(rows, fileRes) {
  if (!rows || rows.length === 0) {
    fileRes.log.push("No ISTORIC rows to insert (0).");
    return 0;
  }

  var BATCH = 200;
  var insertedTotal = 0;

  for (var i = 0; i < rows.length; i += BATCH) {
    var chunk = rows.slice(i, i + BATCH);
    var sql = buildInsertSqlIstoric_NoDup(chunk);

    fileRes.log.push("ISTORIC insert batch " + (i / BATCH + 1) + " size=" + chunk.length);

    var affected = db.doUpdate(1, sql);
    if (affected == null) affected = 0;
    insertedTotal += affected;
  }

  var skippedDup = rows.length - insertedTotal;
  if (skippedDup < 0) skippedDup = 0;

  fileRes.log.push("ISTORIC inserted=" + insertedTotal + ", skipped duplicates=" + skippedDup);
  fileRes.skippedDuplicateRows = skippedDup;
  return insertedTotal;
}

function buildInsertSqlIstoric_NoDup(chunk) {
  var values = [];

  for (var i = 0; i < chunk.length; i++) {
    var r = chunk[i];

    // base
    var skpSql = toSqlStringOrNull(r.skp);
    var locSql = toSqlStringOrNull(r.Localitate);
    var tipProdSql = toSqlStringOrNull(r.Tip_Produs);
    var tipContrSql = toSqlStringOrNull(r.Tip_Contract || r.Tip_contract); // tolerate either key
    var anSql = toSqlStringOrNull(r.an_creare);
    var cutieMareSql = toSqlStringOrNull(r.cod_cutie_obiect);
    var cutieMicaSql = toSqlStringOrNull(r.cod_obiect);

    // extras
    var crcSql = toSqlStringOrNull(r.CRC);
    var sumarSql = toSqlStringOrNull(r.sumar);
    var gamaDeLaSql = toSqlStringOrNull(r.gama_de_la);
    var gamaPanaSql = toSqlStringOrNull(r.gama_pana_la);
    var tipDocSql = toSqlStringOrNull(r.tip_doc_cod_arh);
    var tipPastrSql = toSqlStringOrNull(r.tip_pastrare);
    var dataCreSql = toSqlStringOrNull(r.data_creare);
    var locGeoSql = toSqlStringOrNull(r.locatie_geografica);
    var divizieSql = toSqlStringOrNull(r.divizie);
    var deptSql = toSqlStringOrNull(r.departament);

    // metadata
    var runIdSql = toSqlStringOrNull(r.import_run_id);
    var fileNameSql = toSqlStringOrNull(r.import_file_name);

    values.push("(" +
      skpSql + "," +
      locSql + "," +
      tipProdSql + "," +
      tipContrSql + "," +
      crcSql + "," +
      sumarSql + "," +
      gamaDeLaSql + "," +
      gamaPanaSql + "," +
      tipDocSql + "," +
      tipPastrSql + "," +
      dataCreSql + "," +
      locGeoSql + "," +
      divizieSql + "," +
      deptSql + "," +
      anSql + "," +
      cutieMareSql + "," +
      cutieMicaSql + "," +
      runIdSql + "," +
      fileNameSql +
      ")");
  }

  var sql =
    "INSERT INTO " + SQL_TABLE_IST + " " +
    "(skp, Localitate, Tip_Produs, Tip_Contract, CRC, sumar, gama_de_la, gama_pana_la, tip_doc_cod_arh, tip_pastrare, data_creare, locatie_geografica, divizie, departament, an_creare, cod_cutie_obiect, cod_obiect, import_run_id, import_file_name) " +
    "SELECT v.skp, v.Localitate, v.Tip_Produs, v.Tip_Contract, v.CRC, v.sumar, v.gama_de_la, v.gama_pana_la, v.tip_doc_cod_arh, v.tip_pastrare, v.data_creare, v.locatie_geografica, v.divizie, v.departament, v.an_creare, v.cod_cutie_obiect, v.cod_obiect, v.import_run_id, v.import_file_name " +
    "FROM (VALUES " + values.join(",") + ") " +
    "v(skp, Localitate, Tip_Produs, Tip_Contract, CRC, sumar, gama_de_la, gama_pana_la, tip_doc_cod_arh, tip_pastrare, data_creare, locatie_geografica, divizie, departament, an_creare, cod_cutie_obiect, cod_obiect, import_run_id, import_file_name) " +
    "WHERE NOT EXISTS ( " +
    "  SELECT 1 FROM " + SQL_TABLE_IST + " t " +
    "  WHERE ISNULL(LTRIM(RTRIM(t.skp)), '') = ISNULL(LTRIM(RTRIM(v.skp)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.Localitate)), '') = ISNULL(LTRIM(RTRIM(v.Localitate)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.Tip_Produs)), '') = ISNULL(LTRIM(RTRIM(v.Tip_Produs)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.Tip_Contract)), '') = ISNULL(LTRIM(RTRIM(v.Tip_Contract)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.CRC)), '') = ISNULL(LTRIM(RTRIM(v.CRC)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.sumar)), '') = ISNULL(LTRIM(RTRIM(v.sumar)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.gama_de_la)), '') = ISNULL(LTRIM(RTRIM(v.gama_de_la)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.gama_pana_la)), '') = ISNULL(LTRIM(RTRIM(v.gama_pana_la)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.tip_doc_cod_arh)), '') = ISNULL(LTRIM(RTRIM(v.tip_doc_cod_arh)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.tip_pastrare)), '') = ISNULL(LTRIM(RTRIM(v.tip_pastrare)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.data_creare)), '') = ISNULL(LTRIM(RTRIM(v.data_creare)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.locatie_geografica)), '') = ISNULL(LTRIM(RTRIM(v.locatie_geografica)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.divizie)), '') = ISNULL(LTRIM(RTRIM(v.divizie)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.departament)), '') = ISNULL(LTRIM(RTRIM(v.departament)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.an_creare)), '') = ISNULL(LTRIM(RTRIM(v.an_creare)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.cod_cutie_obiect)), '') = ISNULL(LTRIM(RTRIM(v.cod_cutie_obiect)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.cod_obiect)), '') = ISNULL(LTRIM(RTRIM(v.cod_obiect)), '') " +
    ");";

  return sql;
}




function toSqlStringOrNull(val) {
  var s = safeStr(val);
  if (!s) return "NULL";
  return "'" + escapeSql(s) + "'";
}

// Header normalization like python: diacritics removed, lowercase, punctuation -> space, collapse spaces
function normalizeHeaderName(name) {
  var s = safeStr(name);
  if (!s) return "";

  s = stripDiacriticsValue(s);
  s = "" + s;
  s = s.toLowerCase();

  // replace non [0-9a-z ] with space
  s = s.replace(/[^0-9a-z ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Remove diacritics from values
function stripDiacriticsValue(x) {
  if (x == null) return x;

  // force JS string
  var s = "" + x;

  try {
    var Normalizer = Packages.java.text.Normalizer;
    var Form = Packages.java.text.Normalizer.Form;

    // Normalizer returns java.lang.String -> force back to JS string immediately
    s = "" + Normalizer.normalize(s, Form.NFKD);

    // now regex replace is the JS String.prototype.replace, not Java overload
    s = ("" + s).replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    // ignore, keep s
    s = "" + s;
  }

  // Romanian special cases (ensure JS string each time)
  s = ("" + s).replace(/[șş]/g, "s").replace(/[ȘŞ]/g, "S");
  s = ("" + s).replace(/[țţ]/g, "t").replace(/[ȚŢ]/g, "T");
  s = ("" + s).replace(/[ăâ]/g, "a").replace(/[ĂÂ]/g, "A");
  s = ("" + s).replace(/[î]/g, "i").replace(/[Î]/g, "I");

  s = ("" + s).replace(/\s+/g, " ").trim();
  return s;
}


function extractTipContractFromTipProdus(tipProdus) {
  var s = safeStr(tipProdus);
  if (!s) return { tipContract: null, cleanedTipProdus: tipProdus };

  var m = TIP_CONTRACT_RE.exec(s);
  if (!m) return { tipContract: null, cleanedTipProdus: tipProdus };

  var tipContract = (m[1] || "").toUpperCase();

  // remove first match only
  var cleaned = s.replace(TIP_CONTRACT_RE, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return { tipContract: tipContract, cleanedTipProdus: cleaned };
}


function toSqlIntOrNull(val) {
  var s = safeStr(val);
  if (!s) return "NULL";

  // accept only digits (optional leading minus)
  if (!/^-?\d+$/.test(s)) return "NULL";

  return "" + parseInt(s, 10);
}

// ==========================================================================
// EXCEL -> ROWS mapping for RECUARENTA
// headers:
// SKP | SEQ | CRC | COD/NUMAR LOC CONSUM | COD CLIENT/ABONAT | NR CONTRACT | AN | DATA PROCESARE
//
// SQL staging columns:
// skp             <- SKP
// numar_ordine    <- SEQ
// crc             <- CRC
// cod_nlc         <- COD/NUMAR LOC CONSUM
// cod_client      <- COD CLIENT/ABONAT
// numar_contract  <- NR CONTRACT
// an              <- AN
// data_arhivare   <- DATA PROCESARE
// uuid autogenerated in DB
// ==========================================================================
function prepareRecurentaRows(rows, fileRes) {
  var out = [];
  var skippedEmpty = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    // skip completely empty lines
    if (isRowEmpty(r)) {
      skippedEmpty++;
      continue;
    }

    var skp = safeStr(r["SKP"]);
    var seq = safeStr(r["SEQ"]);
    var crc = safeStr(r["CRC"]);
    var codNlc = safeStr(r["COD/NUMAR LOC CONSUM"]);
    var codClient = safeStr(r["COD CLIENT/ABONAT"]);
    var nrContract = safeStr(r["NR CONTRACT"]);
    var an = safeStr(r["AN"]);
    var dataProc = safeStr(r["DATA PROCESARE"]);

    // If all fields empty after trim -> skip
    if (!skp && !codNlc && !nrContract && !codClient && !dataProc && !seq && !crc && !an) {
      skippedEmpty++;
      continue;
    }

    out.push({
      skp: skp,
      numar_ordine: seq,
      crc: crc,
      cod_nlc: codNlc,
      cod_client: codClient,
      numar_contract: nrContract,
      an: an,
      data_arhivare: dataProc
    });
  }

  fileRes.skippedEmptyRows = skippedEmpty;
  fileRes.log.push("Prepared rows: " + out.length + ", skipped empty: " + skippedEmpty);

  return { rows: out };
}


// ==========================================================================
// DB INSERT (batch inserts)
// ==========================================================================
function insertRecurentaRows(rows, fileRes) {
  if (!rows || rows.length === 0) {
    fileRes.log.push("No rows to insert (0).");
    fileRes.skippedDuplicateRows = 0;
    return 0;
  }

  var BATCH = 200;
  var insertedTotal = 0;

  for (var i = 0; i < rows.length; i += BATCH) {
    var chunk = rows.slice(i, i + BATCH);

    var sql = buildInsertSqlRecurenta_NoDup(chunk);
    fileRes.log.push("Insert batch " + (i / BATCH + 1) + " size=" + chunk.length);

    var affected = db.doUpdate(1, sql);
    if (affected == null) affected = 0;

    insertedTotal += affected;
  }

  // rows that didn't insert are duplicates (because we filter them out in SQL)
  var skippedDup = rows.length - insertedTotal;
  if (skippedDup < 0) skippedDup = 0;

  fileRes.skippedDuplicateRows = skippedDup;
  fileRes.log.push("Inserted: " + insertedTotal + ", skipped duplicates: " + skippedDup);

  return insertedTotal;
}

function buildInsertSqlRecurenta_NoDup(chunk) {
  var values = [];

  for (var i = 0; i < chunk.length; i++) {
    var r = chunk[i];

    var anSql = toSqlIntOrNull(r.an);

    values.push("(" +
      "'" + escapeSql(r.skp) + "'," +
      "'" + escapeSql(r.cod_nlc) + "'," +
      "'" + escapeSql(r.numar_contract) + "'," +
      "'" + escapeSql(r.cod_client) + "'," +
      "'" + escapeSql(r.data_arhivare) + "'," +
      "'" + escapeSql(r.numar_ordine) + "'," +
      "'" + escapeSql(r.crc) + "'," +
      anSql + "," +
      "'" + escapeSql(r.import_run_id) + "'," +
      "'" + escapeSql(r.import_file_name) + "'" +
      ")");
  }

  var sql =
    "INSERT INTO [Lucru_EON].[dbo].[arh_arhiva_recurenta] " +
    "(skp, cod_nlc, numar_contract, cod_client, data_arhivare, numar_ordine, crc, an, import_run_id, import_file_name) " +
    "SELECT v.skp, v.cod_nlc, v.numar_contract, v.cod_client, v.data_arhivare, v.numar_ordine, v.crc, v.an, v.import_run_id, v.import_file_name " +
    "FROM (VALUES " + values.join(",") + ") " +
    "v(skp, cod_nlc, numar_contract, cod_client, data_arhivare, numar_ordine, crc, an, import_run_id, import_file_name) " +
    "WHERE NOT EXISTS ( " +
    "  SELECT 1 " +
    "  FROM [Lucru_EON].[dbo].[arh_arhiva_recurenta] t " +
    "  WHERE ISNULL(LTRIM(RTRIM(t.skp)), '') = ISNULL(LTRIM(RTRIM(v.skp)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.cod_nlc)), '') = ISNULL(LTRIM(RTRIM(v.cod_nlc)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.numar_contract)), '') = ISNULL(LTRIM(RTRIM(v.numar_contract)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.cod_client)), '') = ISNULL(LTRIM(RTRIM(v.cod_client)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.data_arhivare)), '') = ISNULL(LTRIM(RTRIM(v.data_arhivare)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.numar_ordine)), '') = ISNULL(LTRIM(RTRIM(v.numar_ordine)), '') " +
    "    AND ISNULL(LTRIM(RTRIM(t.crc)), '') = ISNULL(LTRIM(RTRIM(v.crc)), '') " +
    "    AND ISNULL(t.an, -1) = ISNULL(v.an, -1) " +
    ");";

  return sql;
}




// function buildInsertSqlRecurenta(chunk) {
//   // We do a single INSERT ... VALUES (...),(...),...
//   // uuid is not provided (autogenerated by SQL)
//   var cols = "(skp, cod_nlc, numar_contract, cod_client, data_arhivare, numar_ordine, crc, an)";
//   var values = [];

//   for (var i = 0; i < chunk.length; i++) {
//     var r = chunk[i];

//     values.push("(" +
//       "'" + escapeSql(r.skp) + "'," +
//       "'" + escapeSql(r.cod_nlc) + "'," +
//       "'" + escapeSql(r.numar_contract) + "'," +
//       "'" + escapeSql(r.cod_client) + "'," +
//       "'" + escapeSql(r.data_arhivare) + "'," +
//       "'" + escapeSql(r.numar_ordine) + "'," +
//       "'" + escapeSql(r.crc) + "'," +
//       "'" + escapeSql(r.an) + "'" +
//     ")");
//   }

//   var sql =
//     "INSERT INTO " + SQL_TABLE_RECUR + " " + cols + " VALUES " + values.join(",") + ";";

//   return sql;
// }

// ==========================================================================
// XLSX READER (Apache POI) - first sheet, first row = headers
// returns: { headers: ["SKP", ...], rows: [ { "SKP":"...", ... }, ... ] }
// ==========================================================================
function readXlsxFirstSheet(localFilePath) {
  var FileInputStream = Packages.java.io.FileInputStream;
  var fis = new FileInputStream(localFilePath);

  try {
    // XSSFWorkbook for .xlsx
    var XSSFWorkbook = Packages.org.apache.poi.xssf.usermodel.XSSFWorkbook;
    var wb = new XSSFWorkbook(fis);

    try {
      var sheet = wb.getSheetAt(0);
      if (!sheet) {
        throw "XLSX has no sheets.";
      }

      var headerRow = sheet.getRow(0);
      if (!headerRow) {
        throw "XLSX missing header row (row 1).";
      }

      var headers = [];
      var headerMap = {}; // colIndex -> headerNameNormalized

      var lastCell = headerRow.getLastCellNum();
      for (var c = 0; c < lastCell; c++) {
        var cell = headerRow.getCell(c);
        var h = normalizeHeader(getCellAsString(cell));
        if (h) {
          headers.push(h);
          headerMap[c] = h;
        }
      }

      var rows = [];
      var lastRowNum = sheet.getLastRowNum();

      for (var r = 1; r <= lastRowNum; r++) {
        var row = sheet.getRow(r);
        if (!row) {
          rows.push({}); // keep index aligned, but will be skipped
          continue;
        }

        var obj = {};
        for (var cc = 0; cc < lastCell; cc++) {
          var headerName = headerMap[cc];
          if (!headerName) continue;

          var val = getCellAsString(row.getCell(cc));
          // Store with the normalized header key
          obj[headerName] = val;
        }
        rows.push(obj);
      }

      return { headers: headers, rows: rows };
    } finally {
      try { wb.close(); } catch (e2) { }
    }
  } finally {
    try { fis.close(); } catch (e3) { }
  }
}

function getCellAsString(cell) {
  if (!cell) return "";

  try {
    var CellType = Packages.org.apache.poi.ss.usermodel.CellType;
    var t = cell.getCellType();

    // If formula -> use cached result if possible
    if (t === CellType.FORMULA) {
      t = cell.getCachedFormulaResultType();
    }

    if (t === CellType.STRING) {
      return (cell.getStringCellValue() || "") + "";
    }

    if (t === CellType.NUMERIC) {
      // detect date
      var DateUtil = Packages.org.apache.poi.ss.usermodel.DateUtil;
      if (DateUtil.isCellDateFormatted(cell)) {
        var d = cell.getDateCellValue();
        // format as yyyy-MM-dd (adjust if you need datetime)
        var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
        var sdf = new SimpleDateFormat("yyyy-MM-dd");
        return sdf.format(d);
      } else {
        // numeric as plain (avoid scientific)
        var v = cell.getNumericCellValue();
        // if integer-ish, show without .0
        if (Math.floor(v) === v) return "" + Math.floor(v);
        return "" + v;
      }
    }

    if (t === CellType.BOOLEAN) {
      return "" + cell.getBooleanCellValue();
    }

    // BLANK / ERROR / UNKNOWN
    return "";
  } catch (e) {
    // fallback
    try { return (cell.toString() || "") + ""; } catch (e2) { }
    return "";
  }
}

// Normalize header to match your expected names
function normalizeHeader(h) {
  var s = safeStr(h).trim();

  // collapse multiple spaces
  s = s.replace(/\s+/g, " ");

  // uppercase for stable matching, but keep slashes
  s = s.toUpperCase();

  return s;
}

function validateHeaders(actualHeaders) {
  // We require that all EXPECTED_HEADERS exist in the actual list, in any order.
  // But you said "always have this headers" -> so we enforce strict set matching.
  var expectedNormalized = EXPECTED_HEADERS.map(function (h) { return normalizeHeader(h); });

  // Build set
  var actualSet = {};
  for (var i = 0; i < actualHeaders.length; i++) {
    actualSet[normalizeHeader(actualHeaders[i])] = true;
  }

  for (var j = 0; j < expectedNormalized.length; j++) {
    if (!actualSet[expectedNormalized[j]]) {
      throw "Header missing in XLSX: '" + expectedNormalized[j] + "'. Found: " + actualHeaders.join(", ");
    }
  }
}

// ==========================================================================
// SFTP HELPERS
// ==========================================================================
function connectToSftp() {
  try {
    var jsch = new Packages.com.jcraft.jsch.JSch();
    var session = jsch.getSession(SFTP_USER, SFTP_HOST, SFTP_PORT);
    session.setPassword(SFTP_PASS);
    session.setConfig("StrictHostKeyChecking", "no");
    session.connect(30000);

    var channel = session.openChannel("sftp");
    channel.connect();

    logLine("Connected to SFTP: " + SFTP_HOST);
    return channel;
  } catch (e) {
    logLine("SFTP connection error: " + e);
    return null;
  }
}

function listFilesInSftpDirectory(sftp, remoteDir) {
  try {
    var fileList = [];
    var files = sftp.ls(remoteDir);

    for (var i = 0; i < files.size(); i++) {
      var f = files.get(i);
      var name = "" + f.getFilename();
      if (name === "." || name === "..") continue;
      fileList.push(name);
    }
    return fileList;
  } catch (e) {
    logLine("Failed to list SFTP dir: " + remoteDir + " error: " + e);
    return [];
  }
}


function sftpDownloadToLocal(sftp, remotePath, localPath) {
  var outFile = new java.io.File(localPath);
  var fos = new java.io.FileOutputStream(outFile);
  try {
    sftp.get(remotePath, fos);
  } finally {
    try { fos.close(); } catch (e) { }
  }
}

function safeSftpMove(sftp, src, dst) {
  try {
    // rename = move on SFTP
    sftp.rename(src, dst);
  } catch (e) {
    throw "Failed to move SFTP file. src=" + src + " dst=" + dst + " error=" + e;
  }
}

function safeSftpUpload(sftp, localPath, remotePath) {
  try {
    var fis = new java.io.FileInputStream(new java.io.File(localPath));
    try {
      sftp.put(fis, remotePath);
    } finally {
      try { fis.close(); } catch (e2) { }
    }
  } catch (e) {
    throw "Failed to upload log to SFTP. local=" + localPath + " remote=" + remotePath + " error=" + e;
  }
}

function isXlsx(fileName) {
  fileName = "" + (fileName || "");
  return (/\.xlsx$/i).test(fileName);
}


// ==========================================================================
// FILE / TEXT UTIL
// ==========================================================================
function writeLocalTextFile(path, content) {
  var FileWriter = Packages.java.io.FileWriter;
  var BufferedWriter = Packages.java.io.BufferedWriter;
  var fw = new FileWriter(path);
  var bw = new BufferedWriter(fw);
  try {
    bw.write(content);
  } finally {
    try { bw.close(); } catch (e) { }
    try { fw.close(); } catch (e2) { }
  }
}

// ==========================================================================
// MISC UTIL
// ==========================================================================
function escapeSql(str) {
  return (str == null) ? "" : ("" + str).replace(/'/g, "''");
}

function safeStr(v) {
  if (v == null) return "";
  return ("" + v).trim();
}

function isRowEmpty(obj) {
  if (!obj) return true;
  for (var k in obj) {
    if (obj.hasOwnProperty(k) && safeStr(obj[k]) !== "") return false;
  }
  return true;
}

function nowIso() {
  var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
  var Date = Packages.java.util.Date;
  var sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
  return sdf.format(new Date());
}

function logLine(msg) {
  response.log.push(msg);
  if (DEBUG) log.info(msg);
}

// put per-file blocks into global response.log too (browser visibility)
function pushGlobalLogBlock(lines) {
  for (var i = 0; i < lines.length; i++) {
    response.log.push(lines[i]);
  }
}

// ==========================================================================
// CONFIG LOADER (same style as your example)
// ==========================================================================
function getConfig() {
  var cfgObj = sol.common.IxUtils.execute("RF_sol_common_service_GetConfigHierarchy", {
    compose: "/eon.arh/Configuration/arh.config",
    content: true,
    forceReload: true
  });

  return (cfgObj.customConfigs != null && cfgObj.customConfigs.length > 0 && cfgObj.customConfigs[0] && cfgObj.customConfigs[0].content) ?
    cfgObj.customConfigs[0].content :
    cfgObj.defaultConfig.content;
}
