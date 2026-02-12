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

var logger = sol.create("sol.Logger", {
    scope: "eon.arh.ix.services.SearchNomenclator"
});

sol.define("eon.arh.ix.services.SearchNomenclator", {
    extend: "sol.common.ix.ServiceBase",

    initialize: function(config) {
        var me = this;
        me.$super("sol.common.ix.ServiceBase", "initialize", [config]);
        me.data = config.data || {};
        me.user = config.user;
    },

    buildSearchNomenclatorSql: function() {
        var me = this;

		if(me.nume_tabela == "[Lucru_EON].[dbo].[arh_punct_colectare_crc]"){
			var sql = "SELECT Id, Nume, Judet, Localitate, Adresa FROM " + me.nume_tabela + " ORDER BY Nume";
		} else {
			var sql = "SELECT Id, Nume FROM " + me.nume_tabela + " ORDER BY Nume";
		}

        return sql;
    },

    process: function() {
        var me = this;
        var DB = new DBConnection();

        var searchNomenclatorSql = me.buildSearchNomenclatorSql();
	logger.info(searchNomenclatorSql);

        var rs = DB.query(searchNomenclatorSql);

        var rows = [];
		
		if(me.nume_tabela == "[Lucru_EON].[dbo].[arh_punct_colectare_crc]"){
			rs.forEach(function(r) {
				rows.push({
					id: r[0] ? String(r[0]) : null,
					nume: r[1] ? String(r[1]) : null,
					judet: r[2] ? String(r[1]) : null,
					localitate: r[3] ? String(r[1]) : null,
					adresa: r[4] ? String(r[1]) : null,
				});
			});
		} else {
			rs.forEach(function(r) {
				rows.push({
					id: r[0] ? String(r[0]) : null,
					nume: r[1] ? String(r[1]) : null
				});
			});
		}

        return {
            rows: rows
        };
    }
});

	function RF_eon_arh_service_SearchNomenclator(ec, configAny) {
		var rfUtils = sol.common.ix.RfUtils,
			config, service, result;
		logger.enter("RF_eon_arh_service_SearchNomenclator", configAny);
		config = rfUtils.parseAndCheckParams(ec, arguments.callee.name, configAny);
		config.user = ec.user;
		service = sol.create("eon.arh.ix.services.SearchNomenclator", config);
		result = rfUtils.stringify(service.process());
		logger.exit("RF_eon_arh_service_SearchNomenclator");
		return result;
	}