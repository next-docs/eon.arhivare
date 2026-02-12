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

var logger = sol.create("sol.Logger", { scope: "eon.arh.ix.services.SearchArhivaRecurenta" });

sol.define("eon.arh.ix.services.SearchArhivaRecurenta", {
  extend: "sol.common.ix.ServiceBase",

  initialize: function (config) {
    var me = this;
    me.$super("sol.common.ix.ServiceBase", "initialize", [config]);
    me.filterGroups = config.filterGroups || [];
    me.filters = config.filters || {};

    me.allowColumns = [
      "Cod_Nlc", "Numar_Contract", "Cod_Client"
    ];

    me.allowOps = [
      "=", "<", ">", "<=", ">=",
      "<>",
      "LIKE_CONTAINS",
      "NOT_LIKE_CONTAINS",
      "IS_EMPTY",
      "IS_NOT_EMPTY"
    ];

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
  },

  _safe: function (s) {
    if (s == null) return "NULL";
    var v = String(s).split("'").join("''");
    return "'" + v + "'";
  },

  // Build single filter condition
  _buildFilterCondition: function (f) {
    var me = this;
    if (!f) return null;

    var colName = String(f.column || "");
    var op = String(f.op || "");
    var val = f.value;

    if (me.allowColumns.indexOf(colName) < 0) return null;
    if (me.allowOps.indexOf(op) < 0) return null;

    var col = "[" + colName + "]";
    switch (op) {
      case "LIKE_CONTAINS":
        return col + " LIKE " + me._safe("%" + (val || "") + "%");

      case "NOT_LIKE_CONTAINS":
        return "(" + col + " NOT LIKE " + me._safe("%" + (val || "") + "%") + " OR " + col + " IS NULL)";

      case "IS_EMPTY":
        return "(" + col + " IS NULL OR LTRIM(RTRIM(" + col + ")) = '')";

      case "IS_NOT_EMPTY":
        return "(" + col + " IS NOT NULL AND LTRIM(RTRIM(" + col + ")) <> '')";

      default:
        // =, <, >, <=, >=, <>
        return col + " " + op + " " + me._safe(val);
    }
  },

  buildSql: function (countOnly) {
    var me = this;
    var where = ["1=1"];
    var i, j;

    // date filters (if you ever start using dateStart/dateEnd) ...

    // --- DYNAMIC FILTERS ---
    if (me.filterGroups && me.filterGroups.length > 0) {
      var orGroups = [];

      for (i = 0; i < me.filterGroups.length; i++) {
        var group = me.filterGroups[i];
        if (!group || !group.length) continue;

        var andParts = [];
        for (j = 0; j < group.length; j++) {
          var cond = me._buildFilterCondition(group[j]);
          if (cond) {
            andParts.push(cond);
          }
        }

        if (andParts.length > 0) {
          orGroups.push("(" + andParts.join(" AND ") + ")");
        }
      }

      if (orGroups.length > 0) {
        where.push("(" + orGroups.join(" OR ") + ")");
      }
    }

    // ✅ SIMPLE COLUMN FILTERS
    if (me.filters) {
      var f = me.filters;
      var val;

      var addLike = function (columnName, filterKey) {
        val = f[filterKey];
        if (val === null || val === undefined) return;
        val = String(val);
        if (!val || val.replace(/\s+/g, "").length === 0) return;

        where.push("[" + columnName + "] LIKE " + me._safe("%" + val + "%"));
      };

      addLike("skp", "skp");
      addLike("cod_nlc", "cod_nlc");
      addLike("numar_contract", "numar_contract");
      addLike("cod_client", "cod_client");
      addLike("numar_ordine", "numar_ordine");
      addLike("crc", "crc");
      addLike("an", "an");

      val = f["data_arhivare"];
      if (val !== null && val !== undefined) {
        val = String(val);
        if (val && val.replace(/\s+/g, "").length > 0) {
          where.push("CONVERT(VARCHAR(19), [data_arhivare], 120) LIKE " + me._safe("%" + val + "%"));
        }
      }
    }

    var whereClause = "WHERE " + where.join(" AND ");

    if (countOnly) {
      return "SELECT COUNT(1) AS total " +
        "FROM [Lucru_EON].[dbo].[arh_arhiva_recurenta] WITH (NOLOCK) " +
        whereClause;
    }

    var sql =
      "SELECT " +
      "[skp], [numar_ordine], [crc], [cod_nlc], [numar_contract], [cod_client], [an], " +
      "[data_arhivare], [uuid] " +
      "FROM [Lucru_EON].[dbo].[arh_arhiva_recurenta] WITH (NOLOCK) " +
      whereClause + " " +
      "ORDER BY [data_arhivare] DESC";

    var offset = me.pageIndex * me.pageSize;
    sql += " OFFSET " + offset + " ROWS FETCH NEXT " + me.pageSize + " ROWS ONLY";

    return sql;
  },


  process: function () {
    var me = this,
      DB = new DBConnection();

    // 1) total count
    var sqlCount = me.buildSql(true);
    logger.info("SearchArhivaRecurenta COUNT SQL: \n" + sqlCount);
    var rsCount = DB.query(sqlCount);
    var total = 0;
    if (rsCount && rsCount.length && rsCount[0][0] != null) {
      total = parseInt(String(rsCount[0][0]), 10);
      if (isNaN(total)) {
        total = 0;
      }
    }

    // 2) paged data
    var sql = me.buildSql(false);
    logger.info("SearchArhivaRecurenta DATA SQL: \n" + sql);

    var rs = DB.query(sql);
    var rows = [];
    rs.forEach(function (r) {
      rows.push({
        skp:          r[0] ? String(r[0]) : null,
        numar_ordine: r[1] ? String(r[1]) : null,
        crc:          r[2] ? String(r[2]) : null,
        cod_nlc:      r[3] ? String(r[3]) : null,
        numar_contract:r[4] ? String(r[4]) : null,
        cod_client:   r[5] ? String(r[5]) : null,
        an:           (r[6] != null && String(r[6]).length) ? parseInt(String(r[6]), 10) : null,
        data_arhivare:r[7] ? String(r[7]) : null,
        uuid:         r[8] ? String(r[8]) : null
      });
    });

    return {
      rows: rows,
      total: total,
      pageIndex: me.pageIndex,
      pageSize: me.pageSize,
      sqlQuery: sql
    };
  }
});

function RF_eon_arh_service_SearchArhivaRecurenta(ec, configAny) {
  var rfUtils = sol.common.ix.RfUtils, config, service, result;
  logger.enter("RF_eon_arh_service_SearchArhivaRecurenta", configAny);
  config = rfUtils.parseAndCheckParams(ec, arguments.callee.name, configAny);
  service = sol.create("eon.arh.ix.services.SearchArhivaRecurenta", config);
  result = rfUtils.stringify(service.process());
  logger.exit("RF_eon_arh_service_SearchArhivaRecurenta");
  return result;
}
