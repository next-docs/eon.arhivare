// ==========================================================================
// AS Rule: Process arh_email_queue and send HTML mails
// Reads pending rows from Lucru_EON.dbo.arh_email_queue and sends emails
// using configuration from MAIL_CONFIG and mail.sendHtmlMail().
// ==========================================================================

// --------------------------------------------------------------------------
// Mail template configuration from arh.config
// --------------------------------------------------------------------------
var MAIL_CONFIG = getMailCfg();
var DEBUG = true;

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------
try {
    var rows = loadPendingMails();
    if (DEBUG) log.info("arh_email_queue: found " + rows.length + " pending mails");

    for (var i = 0; i < rows.length; i++) {
        try {
            processQueueRow(rows[i]);
        } catch (rowErr) {
            log.info("Error processing queue row index " + i + ": " + rowErr);
        }
    }
} catch (e) {
    log.info("Fatal error in arh_email_queue rule: " + e);
}

// --------------------------------------------------------------------------
// Load pending mails from DB
// --------------------------------------------------------------------------
function loadPendingMails() {
    var sql =
        "SELECT TOP 50 id, mail_template_name, mail_info, mail_to " +
        "FROM [Lucru_EON].[dbo].[arh_email_queue] " +
        "WHERE mail_status != 'SENT'";

    if (DEBUG) log.info("SQL loadPendingMails = " + sql);

    var result = db.getMultiLine(1, [sql], 1000);
    if (!result) {
        return [];
    }
    return result;
}

// --------------------------------------------------------------------------
// Process a single queue row: render template, send mail, update status
// --------------------------------------------------------------------------
function processQueueRow(row) {
    var id = "" + row["id"] + "";
    var templateName = "" + row["mail_template_name"] + "";
    var mailTo = "" + row["mail_to"] + "";
    var mailInfoJson = row["mail_info"];

    if (DEBUG) log.info("Processing queue id=" + id + ", template=" + templateName);

    // Get template config
    var config = MAIL_CONFIG[templateName];
    if (!config) {
        log.info(
            "No MAIL_CONFIG found for template '" +
            templateName +
            "'. Marking as Failed."
        );
        updateQueueStatus(id, "FAILED", null);
        return;
    }

    // Parse mail_info JSON
    var data = {};
    if (mailInfoJson && mailInfoJson !== "") {
        try {
            data = JSON.parse("" + mailInfoJson);
        } catch (jsonErr) {
            log.info(
                "Error parsing mail_info for id=" + id + ": " + jsonErr + ". Marking as Failed."
            );
            updateQueueStatus(id, "FAILED", null);
            return;
        }
    }

    // Render body from template + data
    var body = renderTemplate(config.template, data);
    var subject = config.subject;
    var from = config.from;
    var to = mailTo;

    // Send email
    try {
        if (DEBUG) log.info(
            "Sending mail, from=" + from + ", to=" + to + ", subject=" + subject
        );

        // mail.sendHtmlMail(from, to, subject, body);

        // Send via ELO Notify service
        sendNotifyMail(from, to, subject, body);

        // On success: set SENT and sent_at
        var nowStr = getNowString();
        updateQueueStatus(id, "SENT", nowStr);
        if (DEBUG) log.info("Mail sent successfully for id=" + id);
    } catch (sendErr) {
        log.info("Error sending mail for id=" + id + ": " + sendErr);
        // On error: set Failed, leave sent_at null
        updateQueueStatus(id, "FAILED", null);
    }
}

// --------------------------------------------------------------------------
// Update queue row status and sent_at
// sentAtStr should be in format: yyyy-MM-dd HH:mm:ss or null
// --------------------------------------------------------------------------
function updateQueueStatus(id, newStatus, sentAtStr) {
    var sentAtSqlPart = sentAtStr ? "'" + sentAtStr + "'" : "NULL";

    var sql =
        "UPDATE [Lucru_EON].[dbo].[arh_email_queue] " +
        "SET mail_status = '" +
        newStatus +
        "', " +
        "    sent_at = " +
        sentAtSqlPart +
        " WHERE id = '" +
        id +
        "'";

    if (DEBUG) log.info("SQL updateQueueStatus = " + sql);
    db.doUpdate(1, sql);
}

// --------------------------------------------------------------------------
// Render template with placeholders like {{key}}
// data: object from mail_info JSON
// If value is an array, it is joined with ", "
// If a placeholder has no matching key, it is left as-is
// --------------------------------------------------------------------------
function renderTemplate(template, data) {
    if (!template || !data) {
        return template;
    }

    return template.replace(/{{\s*([^}]+)\s*}}/g, function (match, key) {
        key = key + "";
        if (!data.hasOwnProperty(key)) {
            // No value for this key in JSON, leave placeholder unchanged
            return match;
        }

        var value = data[key];
        if (value instanceof Array) {
            return value.join(", ");
        }
        if (value === null || typeof value === "undefined") {
            return "";
        }
        return "" + value;
    });
}

// --------------------------------------------------------------------------
// Send HTML email via ELO Notify service
// This uses RF_sol_notify_function_SendNotification to send an EMAIL
// to an external address.
// --------------------------------------------------------------------------
function sendNotifyMail(from, to, subject, body) {

    var params = {
        template: "arh.genericMail",
        subject: subject,
        body: {
            type: "html",
            content: body
        },
        to: to,
        from: from
    };

    sol.common.IxUtils.execute("RF_sol_function_Notify", params);
}

// --------------------------------------------------------------------------
// Generate timestamp as string: yyyy-MM-dd HH:mm:ss
// --------------------------------------------------------------------------
function getNowString() {
    var now = new Date();

    function pad(n) {
        return n < 10 ? "0" + n : "" + n;
    }

    var year = now.getFullYear();
    var month = pad(now.getMonth() + 1);
    var day = pad(now.getDate());
    var hours = pad(now.getHours());
    var minutes = pad(now.getMinutes());
    var seconds = pad(now.getSeconds());

    return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
}

// --------------------------------------------------------------------------
// Get Mail Config
// --------------------------------------------------------------------------
function getMailCfg() {
    var cfgObj = sol.common.IxUtils.execute('RF_sol_common_service_GetConfigHierarchy', {
        compose: "/eon.arh/Configuration/arh.config",
        content: true,  //optional, if not set, or none `true` value, only GUIDs will be returned
        forceReload: true  // optional, if true, the cache will be refreshed
    });

    return (cfgObj.customConfigs != null && cfgObj.customConfigs.length > 0 && cfgObj.customConfigs[0] && cfgObj.customConfigs[0].content.mail) ?
        cfgObj.customConfigs[0].content.mail :
        cfgObj.defaultConfig.content.mail;
}
