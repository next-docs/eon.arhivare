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
  scope: "eon.arh.ix.services.SearchRaport"
});

sol.define("eon.arh.ix.services.SearchRaport", {
  extend: "sol.common.ix.ServiceBase",

  initialize: function (config) {
    var me = this;
    me.$super("sol.common.ix.ServiceBase", "initialize", [config]);

    // --- pagination fields ---
    var defaultPageSize = 20;
    var maxPageSize = 100;

    me.pageIndex = 0;
    if (config.pageIndex !== undefined && config.pageIndex !== null) {
      me.pageIndex = parseInt(String(config.pageIndex), 10);
      if (isNaN(me.pageIndex) || me.pageIndex < 0) {
        me.pageIndex = 0;
      }
    }

    me.pageSize = defaultPageSize;
    if (config.pageSize !== undefined && config.pageSize !== null) {
      me.pageSize = parseInt(String(config.pageSize), 10);
      if (isNaN(me.pageSize) || me.pageSize <= 0) {
        me.pageSize = defaultPageSize;
      }
    }
    if (me.pageSize > maxPageSize) {
      me.pageSize = maxPageSize;
    }

    // filtre
    me.filters = config.filters || {};
  },

  _safe: function (s) {
    if (s == null) return "NULL";
    var v = String(s).split("'").join("''");
    return "'" + v + "'";
  },

  // buil sql filters
  buildSql: function (countOnly) {
    var me = this;
    var where = ["1=1"];  // Start cu un "WHERE" care nu filtreaza nimic

    // Construim filtrele pe baza valorilor din filters
    for (var column in me.filters) {
      if (me.filters.hasOwnProperty(column)) {
        var value = me.filters[column];
        if (value !== null && value !== undefined && String(value).trim() !== "") {
          where.push("[" + column + "] LIKE " + me._safe("%" + value + "%"));
        }
      }
    }

    logger.info("Aplicare filtre: " + sol.common.ix.RfUtils.stringify(me.filters));

    // Subquery cu UNION intre cele douăa surse de date
    // Subselect 1: from arh_ridicare_arhiva
    var s1 =
      "SELECT " +
      "numar_inregistrare AS numar_comanda, " +
      "'Ridicare' AS tip_operatiune, " +
      "data_inregistrare AS data_solicitare, " +
      "departament AS departament, " +
      "status AS status, " +
      "crc AS crc, " +
      "descriere AS observatii, " +
      "user_name AS [user], " +
      "'' AS cod_nlc, " +
      "'' AS nume_abonat, " +
      "numar_contract AS numar_contract, " +
      "cod_client AS cod_client " +
      "FROM [Lucru_EON].[dbo].[arh_ridicare_arhiva] WITH (NOLOCK)";

    // Subselect 2: from arh_retragere_arhiva
    var s2 =
      "SELECT " +
      "numar_comanda AS numar_comanda, " +
      "tip_operatiune AS tip_operatiune, " +
      "data_inceput AS data_solicitare, " +
      "departament AS departament, " +
      "status AS status, " +
      "crc AS crc, " +
      "observatii AS observatii, " +
      "user_name AS [user], " +
      "cod_nlc AS cod_nlc, " +
      "nume_abonat AS nume_abonat, " +
      "numar_contract AS numar_contract, " +
      "cod_client AS cod_client " +
      "FROM [Lucru_EON].[dbo].[arh_retragere_arhiva] WITH (NOLOCK)";
    // Combine with UNION ALL
    var sqlUnion = "(" + s1 + " UNION ALL " + s2 + ") AS t";

    if (countOnly) {
      // numarul total de rezultate (doar COUNT)
      return "SELECT COUNT(1) AS total FROM " + sqlUnion + " WHERE " + where.join(" AND ");
    }

    // Query pentru a aduna datele paginabile
    var sql =
      "SELECT numar_comanda, tip_operatiune, data_solicitare, departament, status, crc, observatii, [user], cod_nlc, nume_abonat, numar_contract, cod_client " +
      "FROM " + sqlUnion + " " +
      "WHERE " + where.join(" AND ") + " " +
      "ORDER BY data_solicitare DESC, numar_comanda DESC";

    // Pagination pentru SQL Server 2012+
    var offset = me.pageIndex * me.pageSize;
    sql += " OFFSET " + offset + " ROWS FETCH NEXT " + me.pageSize + " ROWS ONLY";

    return sql;
  },

  process: function () {
    var me = this,
      DB = new DBConnection();

    // 1) Total count
    var sqlCount = me.buildSql(true);
    logger.info("SearchRaport COUNT SQL: \n" + sqlCount);
    var rsCount = DB.query(sqlCount);
    var total = 0;
    if (rsCount && rsCount.length && rsCount[0][0] != null) {
      total = parseInt(String(rsCount[0][0]), 10);
      if (isNaN(total)) {
        total = 0;
      }
    }

    // 2) Paginated data
    var sql = me.buildSql(false);
    logger.info("SearchRaport DATA SQL: \n" + sql);

    var rs = DB.query(sql);
    var rows = [];
    rs.forEach(function (r) {
      rows.push({
        numar_comanda: r[0] ? String(r[0]) : null,
        tip_operatiune: r[1] ? String(r[1]) : null,
        data_solicitare: r[2] ? String(r[2]) : null,
        departament: r[3] ? String(r[3]) : null,
        status: r[4] ? String(r[4]) : null,
        crc: r[5] ? String(r[5]) : null,
        observatii: r[6] ? String(r[6]) : null,
        user: r[7] ? String(r[7]) : null,
        cod_nlc: r[8] ? String(r[8]) : null,
        nume_abonat: r[9] ? String(r[9]) : null,
        numar_contract: r[10] ? String(r[10]) : null,
        cod_client: r[11] ? String(r[11]) : null
      });
    });

    return {
      rows: rows,
      total: total,
      pageIndex: me.pageIndex,
      pageSize: me.pageSize
    };
  }
});

function RF_eon_arh_service_SearchRaport(ec, configAny) {
  var rfUtils = sol.common.ix.RfUtils, config, service, result;
  logger.enter("RF_eon_arh_service_SearchRaport", configAny);
  config = rfUtils.parseAndCheckParams(ec, arguments.callee.name, configAny);
  service = sol.create("eon.arh.ix.services.SearchRaport", config);
  result = rfUtils.stringify(service.process());
  logger.exit("RF_eon_arh_service_SearchRaport");
  return result;
}
