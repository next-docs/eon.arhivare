// ==========================================================================
// CONFIG
// ==========================================================================
var DEBUG = true;

var config = getConfig();
var LOCAL_TMP = sol.common.FileUtils.getTempDirPath();
var TEMP_MAIL_FOLDER_PATH = "/TEMP";

// ==========================================================================
// ENTRY POINT
// ==========================================================================
try {
    processRetrievalReminder();
} catch (ex) {
    log_info("as_arh_reminder_retragere error: " + ex);
}

// ==========================================================================
// MAIN FLOW
// ==========================================================================
function processRetrievalReminder() {
    var rows = readStaleRetrievalsFromDb();
    log_info("as_arh_reminder_retragere found " + rows.length + " stale retrieval row(s)");

    if (!rows || rows.length === 0) {
        return;
    }

    rows = sortByDataInceputDesc(rows);

    var xlsPath = generateReminderXls(rows);
    if (!xlsPath) {
        log_info("as_arh_reminder_retragere XLS generation failed");
        return;
    }

    // 1) create temp folder in root
    var tempFolderId;
    try {
        tempFolderId = sol.common.RepoUtils.createPath(TEMP_MAIL_FOLDER_PATH);
    } catch (e) {
        log_info("as_arh_reminder_retragere createPath temp folder failed: " + e);
        return;
    }

    // 2) import XLS into temp folder (repo) -> get objId
    var tempObjId = importFileToElo(xlsPath, tempFolderId);
    if (!tempObjId || tempObjId == "-1") {
        log_info("as_arh_reminder_retragere temp import failed");
        return;
    }

    // 3) send mail with attachment (objId)
    var mailSent = sendMailWithAttachment("reminder_retragere_arhiva", tempObjId + "", rows.length);
    if (!mailSent) {
        log_info("as_arh_reminder_retragere mail sending failed");
        // still try to delete temp object
        safeDeleteSord(tempObjId);
        safeDeleteLocalFile(xlsPath);
        return;
    }

    // 4) delete temp object from repo + delete local tmp file
    safeDeleteSord(tempObjId);
    safeDeleteLocalFile(xlsPath);

    log_info("as_arh_reminder_retragere finished OK");
}



// ==========================================================================
// DB
// ==========================================================================
function readStaleRetrievalsFromDb() {
    var sql =
        "SELECT " +
        "  m.[numar_comanda], m.[data_inceput], m.[data_sfarsit], m.[tip_operatiune], m.[status], " +
        "  m.[crc], m.[departament], m.[termen_livrare], m.[user_name], m.[related_uuid], m.[motiv_retragere], " +
        "  m.[urgent], m.[modalitate_livrare], m.[tip_doc_cod_arh], m.[observatii], m.[group_id], m.[cod_nlc], " +
        "  m.[nume_abonat], m.[localitate], m.[telefon], m.[adresa], m.[skp], m.[cod_cutie_obiect], m.[cod_obiect], " +
        "  m.[sumar], m.[numar_linie], m.[id], hs.last_status_date " +
        "FROM [Lucru_EON].[dbo].[arh_retragere_arhiva] m " +
        "OUTER APPLY ( " +
        "   SELECT TOP 1 h.[data] AS last_status_date " +
        "   FROM [Lucru_EON].[dbo].[arh_retragere_arhiva_status_history] h " +
        "   WHERE h.[line_id] = m.[id] " +
        "     AND h.[status]  = m.[status] " +
        "     AND h.[line]    = m.[numar_linie] " +
        "   ORDER BY h.[data] DESC " +
        ") hs " +
        "WHERE m.[status] IN ('Trimis', 'In Procesare') " +
        "  AND hs.last_status_date IS NOT NULL " +
        "  AND hs.last_status_date <= DATEADD(HOUR, -48, GETDATE()) " +
        "ORDER BY m.[numar_comanda], m.[numar_linie]";

    log_info("as_arh_reminder_retragere readStaleRetrievalsFromDb SQL = " + sql);

    var result = db.getMultiLine(1, [sql], 5000);
    return result ? result : [];
}

// ==========================================================================
// XLS FILE GENERATION
// ==========================================================================
function generateReminderXls(rows) {
    var HSSFWorkbook = Packages.org.apache.poi.hssf.usermodel.HSSFWorkbook;
    var FileOutputStream = Packages.java.io.FileOutputStream;
    var SimpleDateFormat = Packages.java.text.SimpleDateFormat;
    var Date = Packages.java.util.Date;

    try {
        var wb = new HSSFWorkbook();
        var sheet = wb.createSheet("Reminder retrageri");

        // toate coloanele cerute (rand complet) + last_status_date
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
            "cod_obiect",
            "sumar",
            "numar_linie",
            "id",
            "last_status_date"
        ];

        // header row
        var headerRow = sheet.createRow(0);
        for (var c = 0; c < headers.length; c++) {
            headerRow.createCell(c).setCellValue(headers[c]);
        }

        // data rows
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var row = sheet.createRow(i + 1);

            for (var c2 = 0; c2 < headers.length; c2++) {
                var key = headers[c2];
                var val = (r[key] != null) ? ("" + r[key]) : "";
                row.createCell(c2).setCellValue(val);
            }
        }

        var sdf = new SimpleDateFormat("yyyyMMdd_HHmmss");
        var fileName = "ARH_EON_REMINDER_RETRAGERE_" + sdf.format(new Date()) + ".xls";
        var filePath = LOCAL_TMP + "/" + fileName;

        var out = new FileOutputStream(filePath);
        wb.write(out);
        out.close();
        wb.close();

        log_info("as_arh_reminder_retragere generateReminderXls file created: " + filePath);
        return filePath;

    } catch (e) {
        log_info("as_arh_reminder_retragere generateReminderXls error: " + e);
        return null;
    }
}

function safeDeleteSord(objId) {
    try {
        ixConnect.ix().deleteSord("", "" + objId, LockC.NO, null);
        log_info("as_arh_reminder_retragere deleted temp objId=" + objId);
    } catch (e) {
        log_info("as_arh_reminder_retragere could not delete temp objId=" + objId + ": " + e);
    }
}

function safeDeleteLocalFile(path) {
    try {
        var f = new java.io.File(path);
        if (f.exists()) {
            f["delete"]();
        }
    } catch (e) {
        log_info("as_arh_reminder_retragere could not delete local temp file: " + e);
    }
}

function sortByDataInceputDesc(rows) {
    function toMillis(v) {
        if (v == null) return 0;
        var s = ("" + v).trim();
        if (!s) return 0;

        // Handles both "YYYY-MM-DD HH:mm:ss.SSS" and "YYYY-MM-DD"
        s = s.replace(" ", "T");
        var d = new Date(s);
        var t = d.getTime();
        return isNaN(t) ? 0 : t;
    }

    rows.sort(function (a, b) {
        return toMillis(b.data_inceput) - toMillis(a.data_inceput);
    });

    return rows;
}

// --------------------------------------------------------------------------
// MAIL WITH ATTACHMENT
// --------------------------------------------------------------------------
function sendMailWithAttachment(configSection, objId, count) {
    var cfg = null;
    if (configSection == "reminder_retragere_arhiva") {
        cfg = config.mail.reminder_retragere_arhiva;
    }

    if (!cfg) {
        log_info("as_arh_reminder_retragere sendMailWithAttachment missing MAIL_CONFIG");
        return false;
    }

    var subject = cfg.subject;
    var body = cfg.template.replace("{{count}}", "" + count);
    var from = cfg.from;
    var to = cfg.to;

    try {
        var params = {
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
// UTIL (identice cu ale tale)
// ==========================================================================
function getConfig() {
    var cfgObj = sol.common.IxUtils.execute('RF_sol_common_service_GetConfigHierarchy', {
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
        log.info("as_arh_reminder_retragere importFileToElo Import error: " + e);
    }

    return objId;
}

function log_info(msg) {
    if (DEBUG) {
        log.info(msg);
    }
}
