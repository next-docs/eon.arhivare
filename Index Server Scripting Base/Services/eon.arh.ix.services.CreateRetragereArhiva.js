importPackage(Packages.java.io);
importPackage(Packages.java.util);
importPackage(Packages.java.lang);
importPackage(Packages.org.apache.commons.io);
importPackage(Packages.de.elo.ix.client);
importPackage(Packages.java.nio.file);
importPackage(Packages.de.elo.ix.jscript);
importPackage(Packages.de.elo.ix.scripting);

//@include lib_Class.js
//@include lib_sol.common.Cache.js
//@include lib_sol.common.ObjectUtils.js
//@include lib_sol.common.JsonUtils.js
//@include lib_sol.common.StringUtils.js
//@include lib_sol.common.AclUtils.js
//@include lib_sol.common.RepoUtils.js
//@include lib_sol.common.SordUtils.js
//@include lib_sol.common.ObjectFormatter.js
//@include lib_sol.common.ix.RfUtils.js
//@include lib_sol.common.DateUtils.js
//@include lib_sol.common.Config.js
//@include lib_sol.common.ix.ServiceBase.js
//@include lib_sol.common.AsyncUtils.js

var logger = sol.create("sol.Logger", { scope: "eon.arh.ix.services.CreateRetragereArhiva" });

sol.define("eon.arh.ix.services.CreateRetragereArhiva", {
    extend: "sol.common.ix.ServiceBase",

    initialize: function (config) {
        var me = this;
        me.$super("sol.common.ix.ServiceBase", "initialize", [config]);
        me.data = config.data || {};
        me.user = config.user;
        me.registrationLetter = me.data.registrationLetter;
    },

    _safe: function (s) {
        if (s == null) return "NULL";
        var v = String(s).split("'").join("''");
        return "N'" + v + "'";
    },

    _leftPad5: function (n) {
        var s = String(n);
        while (s.length < 5) s = "0" + s;
        return s;
    },

    /**
     * Returns next counter (max+1) for a given year.
     * numar_comanda format: RYYYY-12345
     */
    getCounterFromDb: function (DB, year, letter) {
        var like = letter + year + "-%";
        var sql =
            "SELECT ISNULL(" +
            "  MAX(CAST(SUBSTRING(numar_comanda, CHARINDEX('-', numar_comanda) + 1, 5) AS INT))," +
            "  0" +
            ") " +
            "FROM Lucru_EON.dbo.arh_retragere_arhiva WITH (UPDLOCK, HOLDLOCK) " +
            "WHERE numar_comanda LIKE " + this._safe(like);

        var rs = DB.query(sql);
        var mx = (rs && rs.length && rs[0][0]) ? parseInt(String(rs[0][0]), 10) : 0;
        return mx + 1;
    },

    /**
     * Build ONLY the VALUES(...) part so we can compose a single INSERT with many rows.
     * rowData = form data + specific related_uuid
     */
    buildValuesClause: function (numarComanda, rowData) {
        var me = this,
            d  = rowData || {};

        var vals = [
            me._safe(numarComanda),                                  // numar_comanda
            d.data_inceput    ? me._safe(d.data_inceput)    : "NULL",
            d.data_sfarsit    ? me._safe(d.data_sfarsit)    : "NULL",
            d.tip_operatiune  ? me._safe(d.tip_operatiune)  : "NULL",                                                 // tip_operatiune (not used)
            me._safe("Solicitat"),                                  // status
            d.crc              ? me._safe(d.crc)              : "NULL",
            d.sumar            ? me._safe(d.sumar)            : "NULL",
            d.departament      ? me._safe(d.departament)      : "NULL",
            d.termen_livrare   ? me._safe(d.termen_livrare)   : "NULL",
            this.user          ? this._safe(this.user.name)   : "NULL",
            d.related_uuid     ? me._safe(d.related_uuid)     : "NULL",
            d.motiv_retragere  ? me._safe(d.motiv_retragere)  : "NULL",
            d.urgent           ? me._safe(d.urgent)           : me._safe("NU"),
            d.modalitate_livrare ? me._safe(d.modalitate_livrare) : "NULL",
            d.observatii       ? me._safe(d.observatii)       : "NULL",
            d.group_id         ? me._safe(d.group_id)         : "NULL",
            d.cod_nlc              ? me._safe(d.cod_nlc)              : "NULL",
            d.nume_abonat      ? me._safe(d.nume_abonat)      : "NULL",
            d.localitate       ? me._safe(d.localitate)       : "NULL",
            d.adresa           ? me._safe(d.adresa)           : "NULL",
            d.telefon          ? me._safe(d.telefon)          : "NULL",
            d.skp              ? me._safe(d.skp)              : "NULL",
            d.cod_cutie_obiect ? me._safe(d.cod_cutie_obiect) : "NULL",
            d.cod_obiect       ? me._safe(d.cod_obiect)       : "NULL",
			d.numar_linie      ? me._safe(d.numar_linie)      : "NULL",
            d.numar_contract ? me._safe(d.numar_contract) : "NULL",
            d.cod_client ? me._safe(d.cod_client) : "NULL"
        ];

        return "(" + vals.join(",") + ")";
    },

    process: function () {
        var me   = this,
            DB   = new DBConnection(),
            year = parseInt(me.data.year, 10);

        // --- collect related docs (batch) ---
        var relatedList = [];
        if (me.data.selected_docs && me.data.selected_docs.length) {
            relatedList = me.data.selected_docs;
        } else if (me.data.selected_docs) {
            // backward compatible (single uuid)
            relatedList = [me.data.selected_docs];
        }

        if (!year ) {
            throw "Missing 'year'";
        }

        // --- get starting counter from DB ---
        var nextCounter = me.getCounterFromDb(DB, year, me.registrationLetter);
        var numar = me.registrationLetter + year + "-" + me._leftPad5(nextCounter);

        var valuesClauses = [];
        var items = []; // for returning numar_comanda per uuid
		var skpEntries = 0;

        for (var i = 0; i < relatedList.length; i++) {
            // clone data for this row and set related_uuid explicitly
            var rowData = sol.common.ObjectUtils.clone(me.data);
            rowData.related_uuid = relatedList[i].uuid;
            rowData.crc = (relatedList[i].crc != null && relatedList[i].crc !== "")
                ? relatedList[i].crc
                : relatedList[i].CRC;
            rowData.cod_nlc = relatedList[i].cod_nlc;
            rowData.nume_abonat = relatedList[i].nume_abonat;
            rowData.skp = relatedList[i].skp;
            rowData.cod_cutie_obiect = relatedList[i].cod_cutie_obiect;
            rowData.cod_obiect = relatedList[i].cod_obiect;
            rowData.sumar = relatedList[i].sumar;
            rowData.numar_contract= relatedList[i].numar_contract;
            rowData.cod_client = relatedList[i].cod_client;  
			
			if(rowData.skp){
				skpEntries = skpEntries + 1;
				rowData.numar_linie = skpEntries;
			} else {
				rowData.numar_linie	= -1;
			}			

            valuesClauses.push(me.buildValuesClause(numar, rowData));

            items.push({
                related_uuid: relatedList[i].uuid,
                numar_comanda: numar
            });
        }

        // Compose single INSERT ... VALUES (...),(...),(...)
        var insertSql =
            "INSERT INTO Lucru_EON.dbo.arh_retragere_arhiva (" +
                "numar_comanda, data_inceput, data_sfarsit, tip_operatiune, status, " +
                "crc, sumar, departament, termen_livrare, user_name, related_uuid, " +
                "motiv_retragere, urgent, modalitate_livrare, observatii, group_id, cod_nlc, nume_abonat, localitate, adresa, telefon, skp, cod_cutie_obiect, cod_obiect, numar_linie, numar_contract, cod_client" +
            ") VALUES " +
            valuesClauses.join(",\n");

        // Wrap in explicit transaction + TRY/CATCH
        var sql =
            "BEGIN TRY\n" +
            "  BEGIN TRAN;\n" +
            "  " + insertSql + ";\n" +
            "  COMMIT TRAN;\n" +
            "END TRY\n" +
            "BEGIN CATCH\n" +
            "  IF @@TRANCOUNT > 0 ROLLBACK TRAN;\n" +
            "  THROW;\n" +
            "END CATCH;";

        logger.info("CreateRetragereArhiva BATCH SQL:\n" + sql);

        var aff = DB.update(sql);
        logger.info("Rows affected: " + aff);

        return {
            count: relatedList.length,
            rowsAffected: aff,
            items: items,   // [{related_uuid, numar_comanda}, ...]
            date: rowData.data_inceput ? rowData.data_inceput : "NULL",
        };
    }
});

function RF_eon_arh_service_CreateRetragereArhiva(ec, configAny) {
    var rfUtils = sol.common.ix.RfUtils, config, service, result;
    logger.enter("RF_eon_arh_service_CreateRetragereArhiva", configAny);
    config = rfUtils.parseAndCheckParams(ec, arguments.callee.name, configAny);
    config.user = ec.user;
    service = sol.create("eon.arh.ix.services.CreateRetragereArhiva", config);
    result = rfUtils.stringify(service.process());
    logger.exit("RF_eon_arh_service_CreateRetragereArhiva");
    return result;
}
