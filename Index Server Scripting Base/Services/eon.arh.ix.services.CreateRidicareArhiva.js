importPackage(Packages.java.io);
importPackage(Packages.java.util);
importPackage(Packages.java.lang);
importPackage(Packages.de.elo.ix.client);
importPackage(Packages.de.elo.ix.jscript);
importPackage(Packages.de.elo.ix.scripting);

//@include lib_Class.js
//@include lib_sol.common.ix.ServiceBase.js
//@include lib_sol.common.ix.RfUtils.js

var logger = sol.create("sol.Logger", { scope: "eon.arh.ix.services.CreateRidicareArhiva" });

sol.define("eon.arh.ix.services.CreateRidicareArhiva", {
    extend: "sol.common.ix.ServiceBase",

    initialize: function (config) {
        var me = this;
        me.$super("sol.common.ix.ServiceBase", "initialize", [config]);

        // aici vine ARRAY-ul trimis din UI
        me.comenzi = config.data || [];

        me.user = config.user;
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

     getCounterFromDb: function (DB, year) {
        var like = "A" + year + "-%";

        var sql =
            "SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(numar_inregistrare, 7, 5) AS INT)), 0) " +
            "FROM Lucru_EON.dbo.arh_ridicare_arhiva WITH (UPDLOCK, HOLDLOCK) " +
            "WHERE numar_inregistrare LIKE " + this._safe(like);

        var rs = DB.query(sql);
        var raw = (rs && rs.length) ? rs[0][0] : 0;

        var mx = parseInt(raw, 10);
        if (isNaN(mx)) mx = 0;

        return mx;
    },

    buildInsert: function (comanda, numar) {
        var me = this;

        return ""
            + "INSERT INTO Lucru_EON.dbo.arh_ridicare_arhiva ("
            + "numar_inregistrare, companie, data_inregistrare, status, "
            + "tip_arhiva, numar_buc, departament, crc, punct_colectare_alte_doc, descriere, user_name, group_id, persoana, telefon, judet, localitate, adresa"
            + ") VALUES ("
            + me._safe(numar) + ", "
            + me._safe(comanda.companie) + ", "
            + me._safe(comanda.data_inregistrare) + ", "
            + me._safe(comanda.status) + ", "
            + me._safe(comanda.tip_arhiva) + ", "
            + (comanda.numar_buc ? comanda.numar_buc : "NULL") + ", "
            + me._safe(comanda.departament) + ", "
            + me._safe(comanda.crc) + ", "
            + me._safe(comanda.punct_colectare_alte_doc) + ", "
            + me._safe(comanda.descriere) + ", "
            + me._safe(me.user.name) + ", "
            + me._safe(comanda.group_id) + ", "
            + me._safe(comanda.persoana) + ", "
            + me._safe(comanda.telefon) + ", "
            + me._safe(comanda.judet) + ", "
            + me._safe(comanda.localitate) + ", "
            + me._safe(comanda.adresa)
            + ")";
    },

    process: function () {
        var me = this;

        if (!me.comenzi || !me.comenzi.length) {
            throw "Nu există comenzi de procesat";
        }

        var DB = new DBConnection();
        var year = new Date().getFullYear();

        DB.update("BEGIN TRANSACTION");

        try {
            var counter = me.getCounterFromDb(DB, year);
            var generateList = [];
            var dataInregistrare = "";

            me.comenzi.forEach(function (comanda) {
                if (!dataInregistrare) dataInregistrare = comanda.data_inregistrare;

                counter += 1;
                var nr = "A" + year + "-" + me._leftPad5(counter);

                var sqlInsert = me.buildInsert(comanda, nr);
                DB.update(sqlInsert);

                generateList.push(nr);
            });

            DB.update("COMMIT");

            return {
                succes: true,
                numere_generate: generateList,
                date: dataInregistrare
            };

        } catch (ex) {

            DB.update("ROLLBACK");
            logger.error("CreateRidicareArhiva ERROR: " + ex);

            throw ex;
        }
    }
});

function RF_eon_arh_service_CreateRidicareArhiva(ec, configAny) {
    var rfUtils = sol.common.ix.RfUtils, config, service, result;
    logger.enter("RF_eon_arh_service_CreateRidicareArhiva", configAny);

    config = rfUtils.parseAndCheckParams(ec, arguments.callee.name, configAny);
    config.user = ec.user;

    service = sol.create("eon.arh.ix.services.CreateRidicareArhiva", config);
    result = rfUtils.stringify(service.process());

    logger.exit("RF_eon_arh_service_CreateRidicareArhiva");
    return result;
}
