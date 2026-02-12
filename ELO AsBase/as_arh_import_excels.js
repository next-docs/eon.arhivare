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

var RECUR_IN  = config.sftp.excel_import.recurenta.in;
var RECUR_OUT = config.sftp.excel_import.recurenta.out;
var RECUR_ERR = config.sftp.excel_import.recurenta.err;

var IST_IN  = (config.sftp.excel_import.istoric && config.sftp.excel_import.istoric.in)  || "";
var IST_OUT = (config.sftp.excel_import.istoric && config.sftp.excel_import.istoric.out) || "";
var IST_ERR = (config.sftp.excel_import.istoric && config.sftp.excel_import.istoric.err) || "";

// SQL targets
var SQL_TABLE_RECUR = "[Lucru_EON].[dbo].[arh_arhiva_recurenta]";
var SQL_TABLE_IST   = "[Lucru_EON].[dbo].[arh_istoric_arhiva_documente]";

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

    response.summary.scannedFiles = files.length;

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
      response.summary.skippedRows += (fileResult.skippedRows || 0);
    }

  } finally {
    try { sftp.disconnect(); } catch (e2) {}
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

    // 2) parse & validate headers
    var excel = readXlsxFirstSheet(localXlsx); // returns { headers:[], rows:[{...}] }
    validateHeaders(excel.headers);

    res.log.push("Header validation OK. Columns: " + excel.headers.join(" | "));

    // 3) build rows + pre-validate
    var prepared = prepareRecurentaRows(excel.rows, res);
    res.skippedRows += prepared.skipped;

    // 4) insert into DB (batch)
    var inserted = insertRecurentaRows(prepared.rows, res);
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
  // Inserts only rows that do NOT already exist (according to your duplicate-barrier logic)
  // Note: uuid is not included -> DB default / PK generation remains your choice.

  var values = [];
  for (var i = 0; i < chunk.length; i++) {
    var r = chunk[i];

    // an is int in DB; try to keep numeric
    var anVal = safeStr(r.an);
    //var anSql = (anVal === "" || anVal == null) ? "NULL" : ("" + parseInt(anVal, 10));
    var anSql = toSqlIntOrNull(r.an);


    //if (anSql === "NaN") anSql = "NULL";

    values.push("(" +
      "'" + escapeSql(r.skp) + "'," +
      "'" + escapeSql(r.cod_nlc) + "'," +
      "'" + escapeSql(r.numar_contract) + "'," +
      "'" + escapeSql(r.cod_client) + "'," +
      "'" + escapeSql(r.data_arhivare) + "'," +
      "'" + escapeSql(r.numar_ordine) + "'," +
      "'" + escapeSql(r.crc) + "'," +
      anSql +
    ")");
  }

  var sql =
    "INSERT INTO [Lucru_EON].[dbo].[arh_arhiva_recurenta] " +
    "(skp, cod_nlc, numar_contract, cod_client, data_arhivare, numar_ordine, crc, an) " +
    "SELECT v.skp, v.cod_nlc, v.numar_contract, v.cod_client, v.data_arhivare, v.numar_ordine, v.crc, v.an " +
    "FROM (VALUES " + values.join(",") + ") " +
    "v(skp, cod_nlc, numar_contract, cod_client, data_arhivare, numar_ordine, crc, an) " +
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
      try { wb.close(); } catch (e2) {}
    }
  } finally {
    try { fis.close(); } catch (e3) {}
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
    try { return (cell.toString() || "") + ""; } catch (e2) {}
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
    try { fos.close(); } catch (e) {}
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
      try { fis.close(); } catch (e2) {}
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
    try { bw.close(); } catch (e) {}
    try { fw.close(); } catch (e2) {}
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
