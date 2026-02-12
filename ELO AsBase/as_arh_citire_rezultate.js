// ==========================================================================
// CONFIG
// ==========================================================================
var DEBUG = true;

var config = getConfig();

var SFTP_HOST = config.sftp.host;
var SFTP_PORT = config.sftp.port;
var SFTP_USER = config.sftp.user;
var SFTP_PASS = config.sftp.password;

var LOCAL_TMP = sol.common.FileUtils.getTempDirPath();
var REMOTE_OUT_DIR = config.sftp.path_folder_out;

var status_email_address = config.mail.status_retragere_doc.to;

// ==========================================================================
// ENTRY POINT
// ==========================================================================
try {
  processCsvResultFiles();
} catch (e) {
  log_info("as_arh_citire_rezultate CSV file processing error: " + e);
}

// ==========================================================================
// MAIN FLOW: PROCESS CSV FILES FROM SFTP
// ==========================================================================
function processCsvResultFiles() {
  var sftpChannel = connectToSftp();
  if (!sftpChannel) {
    log_info("as_arh_citire_rezultate failed to connect to SFTP.");
    return;
  }

  var fileList = listFilesInSftpDirectory(sftpChannel, REMOTE_OUT_DIR);

  var filteredFiles = fileList.filter(function (file) {
    return file.indexOf("ordhdr") !== -1;
  }).sort(function (a, b) {
    return a.localeCompare(b);
  });

  if (filteredFiles.length === 0) {
    log_info("as_arh_citire_rezultate no files found with 'ordhdr' in name.");
  }

  for (var i = 0; i < filteredFiles.length; i++) {
    var fileName = filteredFiles[i];
    log_info("as_arh_citire_rezultate found CSV file on SFTP: " + fileName);

    var filePath = REMOTE_OUT_DIR + "/" + fileName;
    var result = downloadAndProcessCsv(sftpChannel, filePath);

    if (result) {
      log_info("as_arh_citire_rezultate processed file: " + fileName);
    } else {
      log_info("as_arh_citire_rezultate failed to process file: " + fileName);
    }
  }

  for (var j = 0; j < fileList.length; j++) {
    var fn = fileList[j];
    var fp = REMOTE_OUT_DIR + "/" + fn;
    log_info("as_arh_citire_rezultate deleting irrelevant file from SFTP: " + fn);
    deleteFileFromSftp(sftpChannel, fp);
  }

  sftpChannel.disconnect();
}

// ==========================================================================
// DELETE FILE FROM SFTP SERVER
// ==========================================================================
function deleteFileFromSftp(sftpChannel, filePath) {
  try {
    sftpChannel.rm(filePath);
    log_info("as_arh_citire_rezultate deleted file from SFTP: " + filePath);
  } catch (e) {
    log_info("as_arh_citire_rezultate failed to delete file from SFTP: " + filePath + " error: " + e);
  }
}

// ==========================================================================
// DOWNLOAD AND PROCESS CSV FILE
// ==========================================================================
function downloadAndProcessCsv(sftpChannel, filePath) {
  try {
    var localFilePath = LOCAL_TMP + "/" + filePath.split("/").pop();
    var outputFile = new java.io.File(localFilePath);

    var outputStream = new java.io.FileOutputStream(outputFile);
    sftpChannel.get(filePath, outputStream);

    var result = processCsv(sftpChannel, outputFile);
    outputStream.close();

    var now = new Date();
    var year = now.getFullYear();
    var month = ("0" + (now.getMonth() + 1)).slice(-2);

    var arcPath = "/Arhiva/Rezultate/" + year + "/" + month;
    var parentId;
    var objId;

    try {
      parentId = sol.common.RepoUtils.createPath(arcPath);
    } catch (e) {
      log_info("as_arh_citire_rezultate downloadAndProcessCsv failed: " + e);
      return false;
    }

    objId = importFileToElo(localFilePath, parentId);
    if (!objId) {
      log_info("as_arh_citire_rezultate downloadAndProcessCsv returned no objId");
      // not fatal to CSV result itself; keep your intention:
      // return false;
    }

    return result;
  } catch (e) {
    log_info("as_arh_citire_rezultate failed to download and process file: " + filePath + " error: " + e);
    return false;
  }
}

// ==========================================================================
// PROCESS CSV FILE
// ==========================================================================
function processCsv(sftpChannel, file) {
  try {
    var BufferedReader = Packages.java.io.BufferedReader;
    var FileReader = Packages.java.io.FileReader;

    var br = new BufferedReader(new FileReader(file));
    var line;
    var rows = [];

    while ((line = br.readLine()) != null) {
      var columns = line.split(",");
      var orderType = (columns[4] + "").replace(/["']/g, "");
      var status = (columns[3] + "").replace(/["']/g, "");
      var poNumber = (columns[16] + "").replace(/["']/g, "");
      var orderNumber = (columns[2] + "").replace(/["']/g, "");

      var codNlc = (columns[XX] + "").replace(/["']/g, "");
      var numeAbonat = (columns[YY] + "").replace(/["']/g, "");

      if (orderType == "1 - RETRIEVAL" || orderType == "2 - PICKUP") {
        rows.push({
          orderType: orderType,
          status: status,
          poNumber: poNumber,
          orderNumber: orderNumber,
          codNlc: codNlc,
          numeAbonat: numeAbonat
        });
      }
    }

    br.close();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];

      if (row.poNumber == "") {
        continue;
      }

      if (row.orderType == "1 - RETRIEVAL") {

        if (row.status == "SHP") {
          var ordlineFileName = file.name.replace("ordhdr", "ordline");
          var ordlineFilePath = REMOTE_OUT_DIR + "/" + ordlineFileName;

          var ordlineStatus = getStatusFromOrdline(sftpChannel, ordlineFilePath, row.orderNumber);

          if (ordlineStatus) {
            if (ordlineStatus == "PICKED") {
              if (updateRetrievalStatus(row.poNumber, "Finalizat")) {
                insertRowForSendingMail(row.poNumber, "Finalizat");
              }
            } else if (ordlineStatus == "PICK CONFIRMED AS NOT FOUND") {
              if (updateRetrievalStatus(row.poNumber, "Negasit")) {
                insertRowForSendingMail(row.poNumber, "Negasit");
              }
            }
          } else {
            // fallback
            if (updateRetrievalStatus(row.poNumber, "Finalizat")) {
              insertRowForSendingMail(row.poNumber, "Finalizat");
            }
            log_info("as_arh_citire_rezultate ordline status not found for PO number: " + row.poNumber);
          }

        } else if (row.status == "CLD") {
          if (updateRetrievalStatus(row.poNumber, "Respins")) {
            insertRowForSendingMail(row.poNumber, "Respins");
          }

        } else if (row.status == "RLS" || row.status == "RLP" || row.status == "STP" || row.status == "STG" || row.status == "HDS") {
          var rowInfo = {
            codNlc: row.codNlc || "",
            numeAbonat: row.numeAbonat || ""
          };

          if (updateRetrievalStatus(row.poNumber, "In procesare")) {
            insertRowForSendingMail(row.poNumber, "In procesare", rowInfo);
          }
        }

      } else if (row.orderType == "2 - PICKUP") {

        if (row.status == "SHP") {
          if (updatePickupsStatus(row.poNumber, "Finalizat")) {
            insertRowForSendingMail(row.poNumber, "Finalizat");
          }

        } else if (row.status == "CLD") {
          if (updatePickupsStatus(row.poNumber, "Respins")) {
            insertRowForSendingMail(row.poNumber, "Respins");
          }

        } else if (row.status == "RLS" || row.status == "RLP" || row.status == "STP" || row.status == "STG" || row.status == "HDS") {
          if (updatePickupsStatus(row.poNumber, "In procesare")) {
            insertRowForSendingMail(row.poNumber, "In procesare");
          }
        }
      }
    }

    return true;
  } catch (e) {
    log_info("as_arh_citire_rezultate processCsv error: " + e);
    return false;
  }
}

function getStatusFromOrdline(sftpChannel, filePath, orderNumber) {
  try {
    var localFilePath = LOCAL_TMP + "/" + filePath.split("/").pop();
    var outputFile = new java.io.File(localFilePath);

    var outputStream = new java.io.FileOutputStream(outputFile);
    sftpChannel.get(filePath, outputStream);

    var BufferedReader = Packages.java.io.BufferedReader;
    var FileReader = Packages.java.io.FileReader;
    var br = new BufferedReader(new FileReader(outputFile));
    var line;
    var status = "";

    while ((line = br.readLine()) != null) {
      var columns = line.split(",");
      if ((columns[0] + "") == orderNumber) {
        status = (columns[2] + "").replace(/["']/g, "");
        break;
      }
    }

    br.close();

    return status;
  } catch (e) {
    log_info("as_arh_citire_rezultate getStatusFromOrdline error: " + e);
    return false;
  }
}

// ==========================================================================
// SFTP CONNECTION
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

    log_info("as_arh_citire_rezultate connected to SFTP server: " + SFTP_HOST);
    return channel;
  } catch (e) {
    log_info("as_arh_citire_rezultate SFTP connection error: " + e);
    return null;
  }
}

// ==========================================================================
// LIST FILES IN SFTP DIRECTORY
// ==========================================================================
function listFilesInSftpDirectory(sftpChannel, remoteDir) {
  try {
    var fileList = [];
    var files = sftpChannel.ls(remoteDir);

    for (var i = 0; i < files.size(); i++) {
      var file = files.get(i);
      var fileName = file.getFilename();
      fileList.push(fileName);
    }

    return fileList;
  } catch (e) {
    log_info("as_arh_citire_rezultate failed to list files in SFTP directory: " + e);
    return [];
  }
}

// ==========================================================================
// DB
// ==========================================================================
function escapeSql(str) {
  return (str == null) ? "" : ("" + str).replace(/'/g, "''");
}

// OPTION 1: update only if changed, return true if updated
function updatePickupsStatus(numar_inregistrare, newStatus) {
  var n = escapeSql(numar_inregistrare);
  var s = escapeSql(newStatus);

  var sql =
    "UPDATE Lucru_EON.dbo.arh_ridicare_arhiva " +
    "SET status = '" + s + "' " +
    "WHERE numar_inregistrare = '" + n + "' " +
    "  AND (status IS NULL OR status <> '" + s + "')";

  log_info("SQL : " + sql);
  var affected = db.doUpdate(1, sql);

  return (affected && affected > 0);
}

//update only if changed, return true if updated
function updateRetrievalStatus(numar_comanda, newStatus) {
  var n = escapeSql(numar_comanda);
  var s = escapeSql(newStatus);

  var sql =
    "UPDATE Lucru_EON.dbo.arh_retragere_arhiva " +
    "SET status = '" + s + "' " +
    "WHERE numar_comanda = '" + n + "' " +
    "  AND (status IS NULL OR status <> '" + s + "')";

  log_info("SQL : " + sql);
  var affected = db.doUpdate(1, sql);

  return (affected && affected > 0);
}

//IF NOT EXISTS guard against duplicates
function insertRowForSendingMail(numar_comanda, newStatus, rowInfo) {
  var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
  var Date = Packages.java.util.Date;
  var sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
  var date = sdf.format(new Date());

  var mailInfoObj = {
    numar_inregistrare: [numar_comanda],
    status: newStatus
  };

  if (rowInfo) {
    mailInfoObj.codNlc = rowInfo.codNlc || "";
    mailInfoObj.numeAbonat = rowInfo.numeAbonat || "";
  }

  var mailInfo = JSON.stringify(mailInfoObj);
  mailInfo = escapeSql(mailInfo);

  var cmdEsc = escapeSql(numar_comanda);
  var statusEsc = escapeSql(newStatus);

  var likeCmd = '%"numar_inregistrare":["' + cmdEsc + '"]%';
  var likeStatus = '%"status":"' + statusEsc + '"%';

  var sql =
    "IF NOT EXISTS ( " +
    "  SELECT 1 FROM [Lucru_EON].[dbo].[arh_email_queue] " +
    "  WHERE mail_template_name = 'status_retragere_doc' " +
    "    AND mail_status IN ('PENDING','SENT') " + // adjust if you only want to block PENDING
    "    AND mail_info LIKE '" + likeCmd + "' " +
    "    AND mail_info LIKE '" + likeStatus + "' " +
    ") " +
    "INSERT INTO [Lucru_EON].[dbo].[arh_email_queue] " +
    "(mail_template_name, mail_info, mail_to, created_at, sent_at, mail_status) " +
    "VALUES ('status_retragere_doc', '" + mailInfo + "', '" + escapeSql(status_email_address) + "', '" + date + "', NULL, 'PENDING')";

  log_info("SQL : " + sql);
  db.doUpdate(1, sql);
}

// ==========================================================================
// UTIL
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

function importFileToElo(filePath, parentFolderId) {
  var file = new java.io.File(filePath);

  var objId = "-1";
  try {
    var ed = ixConnect.ix().createDoc(parentFolderId, 0, null, EditInfoC.mbSordDocAtt);
    ed.sord.name = file.getName();

    var docVersions = new Array(1);
    docVersions[0] = new DocVersion();
    ed.document.docs = docVersions;

    ed.document.docs[0] = new DocVersion();
    ed.document.docs[0].ext = ixConnect.getFileExt(file);
    ed.document.docs[0].pathId = ed.sord.path;
    ed.document.docs[0].encryptionSet = ed.sord.details.encryptionSet;

    ed.document = ixConnect.ix().checkinDocBegin(ed.document);
    var uploadResult = ixConnect.upload(ed.document.docs[0].url, file);
    ed.document.docs[0].uploadResult = uploadResult;

    ed.document = ixConnect.ix().checkinDocEnd(ed.sord, SordC.mbAll, ed.document, LockC.NO);

    var finalSord = ixConnect.ix().checkoutSord(ed.sord.guid, SordC.mbAll, LockC.NO);
    objId = finalSord.id;
  } catch (e) {
    log.info("as_arh_trimitere_comenzi importFileToElo Import error: " + e);
  }
  return objId;
}

function log_info(msg) {
  if (DEBUG) {
    log.info(msg);
  }
}
