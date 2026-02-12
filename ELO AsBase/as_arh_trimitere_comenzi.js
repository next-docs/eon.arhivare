// ==========================================================================
// CONFIG
// ==========================================================================
var DEBUG = true;

var config = getConfig();

var SFTP_HOST = config.sftp.host;
var SFTP_PORT = config.sftp.port;
var SFTP_USER = config.sftp.user;
var SFTP_PASS = config.sftp.password;
var SFTP_PASS = config.sftp.password;

var LOCAL_TMP = sol.common.FileUtils.getTempDirPath();
var REMOTE_DIR = config.sftp.path_folder_in;
var REMOTE_DIR_RUSH = config.sftp.path_folder_rush;

// ==========================================================================
// ENTRY POINT
// ==========================================================================
try{
	processPickups();
} catch(ex){
    log_info("as_arh_trimitere_comenzi Pickup processing error: " + ex);
}

try{
	processRetrievals();
} catch(ex){
    log_info("as_arh_trimitere_comenzi Retrieval processing error: " + ex);
}

// ==========================================================================
// MAIN FLOW
// ==========================================================================
function processPickups() {

    var pickups = readPickupsFromDb();
    log_info("as_arh_trimitere_comenzi found " + pickups.length + " pickup(s)");

    if (pickups.length === 0) {
        return;
    }

    var filePath = generateXls(pickups);
    if (!filePath) {
        log_info("as_arh_trimitere_comenzi XLS generation failed");
        return;
    }
	
	var now = new Date();
	var year = now.getFullYear();

	// luna cu 2 cifre (01–12)
	var month = ("0" + (now.getMonth() + 1)).slice(-2);

	var arcPath = "/Arhiva/Ridicare arhiva/" + year + "/" + month;
    var parentId;
	var objId;

    try {
		parentId = sol.common.RepoUtils.createPath(arcPath);
    } catch (e) {
        log_info("as_arh_trimitere_comenzi import XLS failed: " + e);
        return;
    }

	objId = importFileToElo(filePath, parentId);

    if (!objId) {
        log_info("as_arh_trimitere_comenzi import XLS returned no objId");
        return;
    }

    var mailSent = sendMailWithAttachment("trimitere_ridicari_arhiva", objId, pickups.length);
    if (!mailSent) {
        log_info("as_arh_trimitere_comenzi mail sending failed");
        return;
    }

    updatePickupsStatus(pickups, "Trimis");
    log_info("as_arh_trimitere_comenzi Pickup processing finished");
}

function processRetrievals() {

    var retrievals = readRetrievalsFromDb();
    log_info("as_arh_trimitere_comenzi found " + retrievals.length + " retrieval(s)");
	
	var groupedRetrievals = filterAndGroupRetrievals(retrievals);
	
    log_info("as_arh_trimitere_comenzi found " + retrievals.length + " retrieval(s)");
	
	var now = new Date();
	var year = now.getFullYear();

	// luna cu 2 cifre (01–12)
	var month = ("0" + (now.getMonth() + 1)).slice(-2);

	var arcPath = "/Arhiva/Retragere arhiva/" + year + "/" + month;
	var parentId;
	var objId;

	try {
		parentId = sol.common.RepoUtils.createPath(arcPath);
	} catch (e) {
		log_info("as_arh_trimitere_comenzi import XLS failed: " + e);
		return;
	}

    for (var i = 0; i < groupedRetrievals.length; i++) {

        var r = groupedRetrievals[i];

		if(r.haveSkp){
			var filePath = generateOrdFile(r);
			if (!filePath) {
				log_info("as_arh_trimitere_comenzi ORD generation failed for " + r.numar_inregistrare);
				continue;
			}
			
			var sftpPath = REMOTE_DIR;
			// if(r.urgent == "DA"){
				// sftpPath = REMOTE_DIR_RUSH;
			// }

			var uploaded = uploadToSftp(sftpPath, filePath);
			if (!uploaded) {
				log_info("as_arh_trimitere_comenzi sftp upload failed for " + filePath);
				continue;
			}

			objId = importFileToElo(filePath, parentId);

			if (!objId) {
				log_info("as_arh_trimitere_comenzi import XLS returned no objId");
				return;
			}
		}
		
		// if(!r.skp){
		// 	var mailSent = sendMailWithAttachment("trimitere_retragere_arhiva", objId);
		// 	if (!mailSent) {
		// 		log_info("as_arh_trimitere_comenzi mail sending failed");
		// 		return;
		// 	}
		// }
        if (!r.haveSkp) {
            var xlsPath = generateRetrievalXls(r);
            if (!xlsPath) {
                log_info("as_arh_trimitere_comenzi XLS generation failed for " + r.numar_comanda);
                continue;
            }
            
        
            var xlsObjId = importFileToElo(xlsPath, parentId);
            if (!xlsObjId) {
                log_info("as_arh_trimitere_comenzi import XLS returned no objId for " + r.numar_comanda);
                continue;
            }
            
        
            var mailSent = sendMailWithAttachment("trimitere_retragere_arhiva", xlsObjId, 1);
            if (!mailSent) {
                log_info("as_arh_trimitere_comenzi mail sending failed for XLS " + r.numar_comanda);
                continue;
            }
        }

        updateRetrievalStatus(r, "Trimis", r.haveSkp);
    }

    log_info(" as_arh_trimitere_comenzi Retrieval processing finished");
}

// ==========================================================================
// DB
// ==========================================================================
function readPickupsFromDb() {
    var sql =
        "SELECT numar_inregistrare, companie, departament, crc, judet, localitate, " +
        "adresa, persoana, telefon, numar_buc, descriere " +
        "FROM Lucru_EON.dbo.arh_ridicare_arhiva " +
        "WHERE status = 'Solicitat'";

    log_info("as_arh_trimitere_comenzi readPickupsFromDb SQL = " + sql);

    var result = db.getMultiLine(1, [sql], 1000);
    return result ? result : [];
}

function readRetrievalsFromDb() {
    var sql =
        "SELECT numar_comanda, data_inceput, data_sfarsit, tip_operatiune, status, " +
        "crc, departament, termen_livrare, user_name, related_uuid, motiv_retragere, " +
        "urgent, modalitate_livrare, tip_doc_cod_arh, observatii, group_id, cod_nlc, " +
        "nume_abonat, localitate, telefon, adresa, skp, cod_cutie_obiect, cod_obiect, sumar, numar_linie " +
        "FROM Lucru_EON.dbo.arh_retragere_arhiva " +
        "WHERE status = 'Solicitat' " +
		"ORDER BY numar_comanda, numar_linie";

    log_info("as_arh_trimitere_comenzi readRetrievalsFromDb SQL = " + sql);

    var result = db.getMultiLine(1, [sql], 1000);
    return result ? result : [];
}

function filterAndGroupRetrievals(retrievals) {
    // filtram retrievals pe SKP vs non-SKP
    var skpRetrievals = retrievals.filter(function (r) {
        return r.skp; // pastreaza doar cele care au skp
    });

    var nonSkpRetrievals = retrievals.filter(function (r) {
        return !r.skp; // pastreaza doar cele care NU au skp
    });

    // grupare fiecare filtrare după numar_comanda
    var groupedSkp = groupRetrievals(skpRetrievals, true);
    var groupedNonSkp = groupRetrievals(nonSkpRetrievals, false);

    var groupedAll = groupedSkp.concat(groupedNonSkp);
	
	return groupedAll;
}

function groupRetrievals(retrievals, haveSkp) {
    var groupedRetrievals = [];
    var currentRetrieval = { numar_comanda: null, haveSkp: haveSkp, lines: [] };

    for (var i = 0; i < retrievals.length; i++) {
        var r = retrievals[i];

        if (currentRetrieval.numar_comanda === null) {
            currentRetrieval.numar_comanda = r.numar_comanda;
            currentRetrieval.lines.push(r);

        } else if (currentRetrieval.numar_comanda === r.numar_comanda) {
            currentRetrieval.lines.push(r);

        } else {
            // finalizeaza comanda curenta
            groupedRetrievals.push(currentRetrieval);

            // incepe una noua
            currentRetrieval = { numar_comanda: r.numar_comanda, haveSkp: haveSkp, lines: [r] };
        }
    }

    // ultima comanda
    if (currentRetrieval.lines.length > 0) {
        groupedRetrievals.push(currentRetrieval);
    }

    return groupedRetrievals;
}


function updatePickupsStatus(rows, newStatus) {
    for (var i = 0; i < rows.length; i++) {
        var sql =
            "UPDATE Lucru_EON.dbo.arh_ridicare_arhiva " +
            "SET status = '" + newStatus + "' " +
            "WHERE numar_inregistrare = '" + rows[i].numar_inregistrare + "'";

        db.doUpdate(1, sql);
    }

    log_info("as_arh_trimitere_comenzi updatePickupsStatus updated to status = " + newStatus);
}

function updateRetrievalStatus(row, newStatus, haveSkp) {
	var isSKPNullOrNot = (haveSkp == true)? "IS NOT NULL" : "IS NULL";
	
    var sql =
        "UPDATE Lucru_EON.dbo.arh_retragere_arhiva " +
        "SET status = '" + newStatus + "' " +
        "WHERE numar_comanda = '" + row.numar_comanda + "' AND SKP " + isSKPNullOrNot;

    db.doUpdate(1, sql);
}

// ==========================================================================
// XLS/ORD FILE GENERATION
// ==========================================================================
function generateXls(pickups) {
    var HSSFWorkbook = Packages.org.apache.poi.hssf.usermodel.HSSFWorkbook;
    var FileOutputStream = Packages.java.io.FileOutputStream;
    var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
    var Date = Packages.java.util.Date;

    try {
        var wb = new HSSFWorkbook();
        var sheet = wb.createSheet("Pickups");

        var headers = [
            "Divizie",
            "Departament",
            "CRC",
            "Judet",
            "Oras",
            "Adresa",
            "Persoana",
            "Telefon",
            "PO",
            "Cantitate cutii",
            "TipCutii",
            "Instructiuni"
        ];

        var headerRow = sheet.createRow(0);
        for (var c = 0; c < headers.length; c++) {
            headerRow.createCell(c).setCellValue(headers[c]);
        }

        for (var i = 0; i < pickups.length; i++) {
            var r = pickups[i];
            var row = sheet.createRow(i + 1);

            row.createCell(0).setCellValue("GENERAL");
            row.createCell(1).setCellValue("GENERAL");
            row.createCell(2).setCellValue(r.crc);
            row.createCell(3).setCellValue(r.judet);
            row.createCell(4).setCellValue(r.localitate);
            row.createCell(5).setCellValue(r.adresa);
            row.createCell(6).setCellValue(r.persoana);
            row.createCell(7).setCellValue(r.telefon);
            row.createCell(8).setCellValue(r.numar_inregistrare);
            row.createCell(9).setCellValue(r.numar_buc != "" ? parseInt(r.numar_buc) : r.numar_buc);
            row.createCell(10).setCellValue("IMA");
            row.createCell(11).setCellValue(r.descriere);
        }

        var sdf = new SimpleDateFormat("yyyyMMdd_HHmmss");
        var fileName = "ROE22_" + sdf.format(new Date()) + ".xls";
        var filePath = LOCAL_TMP + "/" + fileName;

        var out = new FileOutputStream(filePath);
        wb.write(out);
        out.close();
        wb.close();

        log_info("as_arh_trimitere_comenzi generateXls file created: " + filePath);
        return filePath;

    } catch (e) {
        log_info("as_arh_trimitere_comenzi generateXls error: " + e);
        return null;
    }
}

function generateOrdFile(retrieval) {
	if(retrieval.lines && retrieval.lines.length > 0){
		var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
		var Date = Packages.java.util.Date;
		var FileWriter = Packages.java.io.FileWriter;

		try {
			var sdf = new SimpleDateFormat("ddMMyy_HHmmss");
			var fileName = "ROE22_" + sdf.format(new Date()) + "_" + retrieval.numar_comanda + ".ord";
			var filePath = LOCAL_TMP + "/" + fileName;

			var fw = new FileWriter(filePath);

			// write header
			fw.write('"H"'); // RECORD TEXT
			fw.write(' "R "'); // DISTRICT ID
			fw.write(' "1"'); // EXT ORDER NBR
			fw.write(' "ROE22"'); // CUST ID
			fw.write(' "GENERAL"'); // DEPT ID
			fw.write(' "GENERAL"'); // BILL DEPT
			fw.write(' "1"'); // ORDER TYPE
			fw.write(retrieval.lines[0].urgent == "DA" ? ' "R"' : ' "N"'); // DELV PRTY
			fw.write(' ""'); // DELV DATE
			fw.write(' ""'); // ADDR NAME
			var addr1 = (retrieval.lines[0].modalitate_livrare == "Email") ? "Fax & Refile" : retrieval.lines[0].adresa.substring(0, 1 * 35);
			fw.write(' "' + addr1 + '"'); // ADDR1
			var addr2 = (retrieval.lines[0].modalitate_livrare == "Email") ? "IOD" : retrieval.lines[0].adresa.substring(35, 2 * 35);
			fw.write(' "' + addr2 + '"'); // ADDR2
			var addr3 = (retrieval.lines[0].modalitate_livrare == "Email") ? "IOD" : retrieval.lines[0].adresa.substring(70, 3 * 35);
			fw.write(' "' + addr3 + '"'); // ADDR3
			var city = (retrieval.lines[0].modalitate_livrare == "Email") ? "IOD" : retrieval.lines[0].localitate;
			fw.write(' "' + city + '"'); // CITY
			fw.write(' "R"'); // STATE
			fw.write(' ""'); // ZIP
			fw.write(' ""'); // FLOOR
			fw.write(' "' + retrieval.lines[0].user_name + '"'); // CONTACT
			fw.write(' "' + retrieval.lines[0].telefon + '"'); // PHONE NBR
			fw.write(' "' + retrieval.lines[0].user_name + '"'); // ATTN NAME
			fw.write(' ""'); // ATTN ADDR1
			fw.write(' ""'); // ATTN ADDR2
			fw.write(' ""'); // ATTN ADDR3
			fw.write(' ""'); // ATTN CITY
			fw.write(' ""'); // ATTN STATE
			fw.write(' ""'); // ATTN ZIP
			fw.write(' ""'); // ATTN FLOOR
			fw.write(' ""'); // ATTN CONTACT
			fw.write(' ""'); // ATTN PHONE NUMBER
			fw.write(' "' + retrieval.lines[0].observatii + '"'); // SPECIAL INSTR
			fw.write(' "' + retrieval.numar_comanda + '"'); // PO NBR
			fw.write(' ""'); // SHIPTO CODE
			fw.write(' "GENERAL"'); // DIVISION
			fw.write(' "GENERAL"'); // BILL TO DIVISION
			fw.write(' "R"'); // COUNTRY
			fw.write(' "R"'); // COUNTRY

			// write lines
			for(var index = 0; index < retrieval.lines.length; index++){
				var retrievalLine = retrieval.lines[index];
				
				fw.write("\n");
				fw.write('"L"'); // RECORD TEXT
				fw.write(' "NO"'); // ITEM TYPE
				fw.write(' "' + retrievalLine.skp + '"'); // SKP BOX NR
				fw.write(' ""'); // CUST BOX NR
				fw.write(' "' + retrievalLine.cod_nlc +'"'); // FILE DESC 1
				fw.write(' "' + retrievalLine.nume_abonat +'"'); // FILE DESC 2
				fw.write(' ""'); // SKP FILE ID
				fw.write(' ""'); // REQ FOR
				fw.write(' "' + retrievalLine.sumar + '"'); // LINE INST
				fw.write(retrievalLine.modalitate_livrare == "Curier" ? ' "N"' : ' "R"');; // REQUEST TYPE
				fw.write(' ""'); // PICKUP TYPE
				fw.write(' ""'); // P/U BOX TYPE
				fw.write(' ""'); // QTY BOXES
				fw.write(' ""'); // QTY FILES
				fw.write(' ""'); // CHARGE BACK
				fw.write(' ""'); // USER ID
				fw.write(' ""'); // FILE GROUP
				fw.write(' ""'); // VOLUME NUMBER
				fw.write(' ""'); // UNIQUE BARCODE
			}
			
			// write FOOTER
			fw.write("\n");
			fw.write('"F"'); // RECORD TEXT
			fw.write(' "' + (retrieval.lines.length + 2) + '"'); // RECORD COUNT
			fw.write(' "EOF"'); // END OF FILE
			
			var emailAddress = "";
			var userName = retrieval.lines[0].user_name;
			var users = ixConnect.ix().checkoutUsers([userName + ""], CheckoutUsersC.BY_IDS, LockC.NO);
			if(users.length > 0){
				emailAddress = users[0].userProps[1];
			}
			
			fw.write(' "' + emailAddress +'"'); // EMAIL ADDRESS

			fw.close();

			log_info("as_arh_trimitere_comenzi generateOrdFile ORD created: " + filePath);
			return filePath;

		} catch (e) {
			log.error("as_arh_trimitere_comenzi generateOrdFile error: " + e);
			return null;
		}
	}
}


// --------------------------------------------------------------------------
// MAIL WITH ATTACHMENT
// --------------------------------------------------------------------------
function sendMailWithAttachment(configSection, objId, count) {
	var cfg = null;
	if(configSection == "trimitere_ridicari_arhiva"){
		cfg = config.mail.trimitere_ridicari_arhiva;
	} else if( configSection == "trimitere_retragere_arhiva"){
		cfg = config.mail.trimitere_retragere_arhiva;
	}
    if (!cfg) {
        log_info("as_arh_trimitere_comenzi sendMailWithAttachment missing MAIL_CONFIG");
        return false;
    }

    var subject = cfg.subject;
    var body = cfg.template.replace("{{count}}", "" + count);
    var from = cfg.from;
    var to = cfg.to;

    try {
        var params = {
            template: "arh.genericMail",
            subject: subject,
            body: {
                type: "html",
                content: body
            },
            to: to,
            from: from,
            atts: [{
                objId: objId
            }]
        };

        sol.common.IxUtils.execute("RF_sol_function_Notify", params);

        log_info("as_arh_trimitere_comenzi sendMailWithAttachment mail sent to " + to);
        return true;

    } catch (e) {
        log_info("as_arh_trimitere_comenzi sendMailWithAttachment error: " + e);
        return false;
    }
}

// ==========================================================================
// SFTP
// ==========================================================================
function uploadToSftp(sftpPath, localFile) {
    try {
        var jsch = new Packages.com.jcraft.jsch.JSch();
        var session = jsch.getSession(SFTP_USER, SFTP_HOST, SFTP_PORT);
        session.setPassword(SFTP_PASS);
        session.setConfig("StrictHostKeyChecking", "no");
        session.connect(30000);

        var channel = session.openChannel("sftp");
        channel.connect();
        var sftp = channel;

        var remotePath = sftpPath + "/" + new java.io.File(localFile).getName();
        sftp.put(localFile, remotePath);

        log_info("as_arh_trimitere_comenzi uploadToSftp uploaded to SFTP: " + remotePath);

        sftp.disconnect();
        session.disconnect();
        return true;

    } catch (e) {
        log_info("as_arh_trimitere_comenzi uploadToSftp SFTP error: " + e);
        return false;
    }
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

    return (cfgObj.customConfigs != null && cfgObj.customConfigs.length > 0 && cfgObj.customConfigs[0] && cfgObj.customConfigs[0].content) ?
        cfgObj.customConfigs[0].content:
        cfgObj.defaultConfig.content;
}


function importFileToElo(filePath, parentFolderId){
	var file = new java.io.File(filePath);
	
    var objId = "-1";
    try{
        var ed = ixConnect.ix().createDoc(parentFolderId, 0, null, EditInfoC.mbSordDocAtt);
        ed.sord.name = file.getName();
        var docVersions = new Array(1);
        docVersions[0] = new DocVersion(); 
        ed.document.docs = docVersions;
        ed.document.docs[0] = new DocVersion();
        ed.document.docs[0].ext = ixConnect.getFileExt(file);
        ed.document.docs[0].pathId = ed.sord.path;
        ed.document.docs[0].encryptionSet = ed.sord.details.encryptionSet;
        ed.document =  ixConnect.ix().checkinDocBegin(ed.document);
        var uploadResult =  ixConnect.upload(ed.document.docs[0].url, file);
        ed.document.docs[0].uploadResult = uploadResult;
        ed.document = ixConnect.ix().checkinDocEnd(ed.sord, SordC.mbAll, ed.document, LockC.NO);
		var finalSord = ixConnect.ix().checkoutSord(ed.sord.guid, SordC.mbAll, LockC.NO);
        objId = finalSord.id;
    }catch(e){
        log.info("as_arh_trimitere_comenzi importFileToElo Import error: "+e);
    }
    return objId;
}

function log_info(msg) {
    if (DEBUG) {
        log.info(msg);
    }
}

function generateRetrievalXls(r) {
    var HSSFWorkbook = Packages.org.apache.poi.hssf.usermodel.HSSFWorkbook;
    var FileOutputStream = Packages.java.io.FileOutputStream;
    var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
    var Date = Packages.java.util.Date;
  
    try {
      var wb = new HSSFWorkbook();
      var sheet = wb.createSheet("Retragere");
  
      var headers = [
        "numar_comanda",
        "data_inceput",
        "data_sfarsit",
        "tip_operatiune",
        "status",
        "crc",
        "departament",
        "termen_livrare",
        "user_name",
        "related_uuid",
        "motiv_retragere",
        "urgent",
        "modalitate_livrare",
        "tip_doc_cod_arh",
        "observatii",
        "group_id",
        "cod_nlc",
        "nume_abonat",
        "localitate",
        "telefon",
        "adresa",
        "skp",
        "cod_cutie_obiect",
        "cod_obiect"
      ];
  
      // header row
      var headerRow = sheet.createRow(0);
      for (var c = 0; c < headers.length; c++) {
        headerRow.createCell(c).setCellValue(headers[c]);
      }
  
      // data rows
	  for(var index = 0; index < r.lines.length; index++){
		  var rl = r.lines[index];
		  var row = sheet.createRow(index + 1);
		  for (var c2 = 0; c2 < headers.length; c2++) {
			var key = headers[c2];
			var val = (rl[key] != null) ? ("" + rl[key]) : "";
			row.createCell(c2).setCellValue(val);
		  }
	  }
  
      var sdf = new SimpleDateFormat("yyyyMMdd_HHmmss");
      var safeOrder = (r.numar_comanda != null) ? ("" + r.numar_comanda).replace(/[^\w.-]/g, "_") : "NA";
      var fileName = "ARH_EON_RETRAGERE_" + sdf.format(new Date()) + "_" + safeOrder + ".xls";
      var filePath = LOCAL_TMP + "/" + fileName;
  
      var out = new FileOutputStream(filePath);
      wb.write(out);
      out.close();
      wb.close();
  
      log_info("as_arh_trimitere_comenzi generateRetrievalXls file created: " + filePath);
      return filePath;
  
    } catch (e) {
      log_info("as_arh_trimitere_comenzi generateRetrievalXls error: " + e);
      return null;
    }
}