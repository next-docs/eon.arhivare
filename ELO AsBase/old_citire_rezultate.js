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

  for (var i = 0; i & lt; filteredFiles.length; i++) {
    var fileName = filteredFiles[i];
    log_info("as_arh_citire_rezultate found CSV file on SFTP: " + fileName);

    var filePath = REMOTE_OUT_DIR + "/" + fileName;
    var result = downloadAndProcessCsv(sftpChannel, filePath, fileList);

    if (result) {
      log_info("as_arh_citire_rezultate processed file: " + fileName);
    } else {
      log_info("as_arh_citire_rezultate failed to process file: " + fileName);
    }
  }

  for (var i = 0; i & lt; fileList.length; i++) {
    var fileName = fileList[i];
    var filePath = REMOTE_OUT_DIR + "/" + fileName;
    log_info("as_arh_citire_rezultate deleting irrelevant file from SFTP: " + fileName);
    deleteFileFromSftp(sftpChannel, filePath);
  }

  // După procesare, deconectăm canalul SFTP
  sftpChannel.disconnect();
}

// ==========================================================================
// DELETE FILE FROM SFTP SERVER
// ==========================================================================

function deleteFileFromSftp(sftpChannel, filePath) {
  try {
    sftpChannel.rm(filePath);  // Ștergem fișierul de pe serverul SFTP
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

    // procesam fișierul CSV
    var result = processCsv(sftpChannel, outputFile);
    outputStream.close();

    var now = new Date();
    var year = now.getFullYear();

    // luna cu 2 cifre (01–12)
    var month = ("0" + (now.getMonth() + 1)).slice(-2);

    var arcPath = "/Arhiva/Rezultate/" + year + "/" + month;
    var parentId;
    var objId;

    try {
      parentId = sol.common.RepoUtils.createPath(arcPath);
    } catch (e) {
      log_info("as_arh_citire_rezultate downloadAndProcessCsv failed: " + e);
      return;
    }

    objId = importFileToElo(localFilePath, parentId);

    if (!objId) {
      log_info("as_arh_citire_rezultate downloadAndProcessCsv returned no objId");
      return;
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

      if (orderType == "1 - RETRIEVAL" || orderType == "2 - PICKUP") {
        rows.push({
          orderType: orderType,
          status: status,
          poNumber: poNumber,
          orderNumber: orderNumber
        });
      }
    }

    br.close();

    for (var i = 0; i & lt; rows.length; i++) {
      var row = rows[i];

      if (row.poNumber != "") {
        if (row.orderType == "1 - RETRIEVAL") {
          if (row.status == "SHP") {
            // cautam `ordline` asociat
            var ordlineFileName = file.name.replace("ordhdr", "ordline");
            var ordlineFilePath = REMOTE_OUT_DIR + "/" + ordlineFileName;

            var ordlineStatus = getStatusFromOrdline(sftpChannel, ordlineFilePath, row.orderNumber);

            if (ordlineStatus) {
              if (ordlineStatus == "PICKED") {
                updateRetrievalStatus(row.poNumber, "Finalizat");
                insertRowForSendingMail(row.poNumber, "Finalizat");
              } else if (ordlineStatus == "PICK CONFIRMED AS NOT FOUND") {
                updateRetrievalStatus(row.poNumber, "Negasit");
                insertRowForSendingMail(row.poNumber, "Negasit");
              }
            } else {
              updateRetrievalStatus(row.poNumber, "Finalizat");
              insertRowForSendingMail(row.poNumber, "Finalizat");
              log_info("as_arh_citire_rezultate ordline status not found for PO number: " + row.poNumber);
            }
          } else if (row.status == "CLD") {
            updateRetrievalStatus(row.poNumber, "Respins");
            insertRowForSendingMail(row.poNumber, "Respins");
          } else if (row.status == "RLS" || row.status == "RLP" || row.status == "STP" || row.status == "STG" || row.status == "HDS") {
            updateRetrievalStatus(row.poNumber, "In procesare");
            insertRowForSendingMail(row.poNumber, "In procesare");
          }
        } else if (row.orderType == "2 - PICKUP") {
          if (row.status == "SHP") {
            updatePickupsStatus(row.poNumber, "Finalizat");
            insertRowForSendingMail(row.poNumber, "Finalizat");
          } else if (row.status == "CLD") {
            updatePickupsStatus(row.poNumber, "Respins");
            insertRowForSendingMail(row.poNumber, "Respins");
          } else if (row.status == "RLS" || row.status == "RLP" || row.status == "STP" || row.status == "STG" || row.status == "HDS") {
            updatePickupsStatus(row.poNumber, "In procesare");
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

    // procesam fișierul CSV
    var BufferedReader = Packages.java.io.BufferedReader;
    var FileReader = Packages.java.io.FileReader;
    var br = new BufferedReader(new FileReader(outputFile));
    var line;
    var status = "";

    while ((line = br.readLine()) != null) {
      var columns = line.split(",");
      if (columns[0] + "" == orderNumber) {
        status = (columns[2] + "").replace(/["']/g, "");

        break;
      }
    }

    br.close();
    // outputStream.close();

    // var now = new Date();
    // var year = now.getFullYear();

    // // luna cu 2 cifre (01–12)
    // var month = ("0" + (now.getMonth() + 1)).slice(-2);

    // var arcPath = "/Arhiva/Rezultate/" + year + "/" + month;
    // var parentId;
    // var objId;

    // try {
    // parentId = sol.common.RepoUtils.createPath(arcPath);
    // } catch (e) {
    // log_info("as_arh_citire_rezultate getStatusFromOrdline failed: " + e);
    // return;
    // }

    // objId = importFileToElo(localFilePath, parentId);

    // if (!objId) {
    // log_info("as_arh_citire_rezultate getStatusFromOrdline returned no objId");
    // return;
    // }

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
    var files = sftpChannel.ls(remoteDir); // Lista fișierelor din folderul OUT pe SFTP

    for (var i = 0; i & lt; files.size(); i++) {
      var file = files.get(i);
      var fileName = file.getFilename();
      fileList.push(fileName); // Adăugăm numele fișierului la listă
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
function updatePickupsStatus(numar_inregistrare, newStatus) {
  var sql =
    "UPDATE Lucru_EON.dbo.arh_ridicare_arhiva " +
    "SET status = '" + newStatus + "' " +
    "WHERE numar_inregistrare = '" + numar_inregistrare + "'";


  log_info("SQL : " + sql);
  db.doUpdate(1, sql);

}

function updateRetrievalStatus(numar_comanda, newStatus) {
  var sql =
    "UPDATE Lucru_EON.dbo.arh_retragere_arhiva " +
    "SET status = '" + newStatus + "' " +
    "WHERE numar_comanda = '" + numar_comanda + "'";

  log_info("SQL : " + sql);
  db.doUpdate(1, sql);
}

function insertRowForSendingMail(numar_comanda, newStatus) {
  var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
  var Date = Packages.java.util.Date;
  var sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
  var date = sdf.format(new Date());

  var mailInfoObj = {
    numar_inregistrare: [numar_comanda],
    status: newStatus
  };

  // JSON string
  var mailInfo = JSON.stringify(mailInfoObj);

  // escape pentru SQL (apostrof)
  mailInfo = mailInfo.replace(/'/g, "''");

  var sql = "INSERT INTO [Lucru_EON].[dbo].[arh_email_queue](mail_template_name, mail_info, mail_to, created_at, sent_at, mail_status) " +
    "VALUES ('status_retragere_doc', '" + mailInfo + "', '" + status_email_address + "', '" + date + "', NULL, 'PENDING')";

  log_info("SQL : " + sql);
  db.doUpdate(1, sql);
}

// ==========================================================================
// UTIL
// ==========================================================================
function getConfig() {
  var cfgObj = sol.common.IxUtils.execute('RF_sol_common_service_GetConfigHierarchy', {
    compose: "/eon.arh/Configuration/arh.config",
    content: true,  //optional, if not set, or none `true` value, only GUIDs will be returned
    forceReload: true  // optional, if true, the cache will be refreshed
  });

  return (cfgObj.customConfigs != null & amp;& amp; cfgObj.customConfigs.length & gt; 0 & amp;& amp; cfgObj.customConfigs[0] & amp;& amp; cfgObj.customConfigs[0].content) ?
  cfgObj.customConfigs[0].content:
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
