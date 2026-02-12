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

var logger = sol.create("sol.Logger", { scope: "eon.arh.ix.services.SearchIstoricArhiva" });

sol.define("eon.arh.ix.services.SearchIstoricArhiva", {
  extend: "sol.common.ix.ServiceBase",

  initialize: function (config) {
    var me = this;
    me.$super("sol.common.ix.ServiceBase", "initialize", [config]);

    // year filter inputs from frontend (they are strings, we take first 4 chars as year)
    me.dateOpStart = config.dateOpStart || null;
    me.dateStart   = config.dateStart   || null;  // "YYYY" (string) or null
    me.dateOpEnd   = config.dateOpEnd   || null;
    me.dateEnd     = config.dateEnd     || null;

    // AND/OR groups [[{column,op,value},...],...]
    me.filterGroups = config.filterGroups || [];
    // simple header filters
    me.filters = config.filters || {};

    // Allowed columns for dynamic filters + header filters
    // NOTE: an_creare is the replacement for year_range
    me.allowColumns = [
      "CRC", "Localitate", "cod_cutie_obiect", "cod_obiect", "skp",
      "Tip_Produs", "Tip_Contract",
      "sumar", "tip_doc_cod_arh", "identificator_custom", "departament",
      "an_creare"
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

  // Build single filter condition for dynamic AND/OR filters
  _buildFilterCondition: function (f) {
    var me = this;
    if (!f) return null;

    var colName = String(f.column || "");
    var op      = String(f.op || "");
    var val     = f.value;

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

  /**
   * Build SQL.
   * - Year filters (start/end) now operate on [an_creare] which is like '2018' or '2018-2020'
   * - A row matches if the row-range overlaps the filter range.
   */
  buildSql: function (countOnly) {
    var me = this;
    var where = ["1=1"];
    var i, j;

    // -------- YEAR FILTERS on [an_creare] (overlap logic) --------
    // filter interval: [yStart, yEnd] (open-ended allowed)
    var yStart = null;
    var yEnd = null;

    if (me.dateStart && me.dateOpStart && ["=", ">=", ">"].indexOf(me.dateOpStart) >= 0) {
      var yStartStr = String(me.dateStart);
      var tmp = parseInt(yStartStr.substring(0, 4), 10);
      if (!isNaN(tmp)) yStart = tmp;
    }

    if (me.dateEnd && me.dateOpEnd && ["=", "<=", "<"].indexOf(me.dateOpEnd) >= 0) {
      var yEndStr = String(me.dateEnd);
      var tmp2 = parseInt(yEndStr.substring(0, 4), 10);
      if (!isNaN(tmp2)) yEnd = tmp2;
    }

    if (yStart !== null || yEnd !== null) {
      // Row range parsing from an_creare:
      // '2018' => start=2018, end=2018
      // '2018-2020' => start=2018, end=2020
      var rowStartExpr = "TRY_CONVERT(INT, LEFT([an_creare], 4))";
      var rowEndExpr =
        "CASE WHEN CHARINDEX('-', [an_creare]) > 0 " +
        "THEN TRY_CONVERT(INT, RIGHT([an_creare], 4)) " +
        "ELSE TRY_CONVERT(INT, LEFT([an_creare], 4)) END";

      // only consider parsable an_creare
      where.push("[an_creare] IS NOT NULL AND LTRIM(RTRIM([an_creare])) <> ''");
      where.push(rowStartExpr + " IS NOT NULL");
      where.push(rowEndExpr + " IS NOT NULL");

      if (yStart !== null && yEnd !== null) {
        // Overlap: rowStart <= yEnd AND rowEnd >= yStart
        where.push("(" + rowStartExpr + " <= " + yEnd + " AND " + rowEndExpr + " >= " + yStart + ")");
      } else if (yStart !== null) {
        // Open ended: >= yStart => rowEnd >= yStart
        where.push("(" + rowEndExpr + " >= " + yStart + ")");
      } else if (yEnd !== null) {
        // Open ended: <= yEnd => rowStart <= yEnd
        where.push("(" + rowStartExpr + " <= " + yEnd + ")");
      }
    }
    // -----------------------------------------------------------

    // -------- DYNAMIC FILTERS (AND/OR groups) --------
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
    // -----------------------------------------------

    // -------- SIMPLE COLUMN FILTERS (header inputs) --------
    if (me.filters) {
      var f = me.filters;
      var val;

      // helper: push LIKE condition if value is non-empty
      var addLike = function (columnName, filterKey) {
        val = f[filterKey];
        if (val === null || val === undefined) return;
        val = String(val);
        if (!val || val.replace(/\s+/g, "").length === 0) return;

        where.push("[" + columnName + "] LIKE " + me._safe("%" + val + "%"));
      };

      addLike("skp",              "skp");
      addLike("cod_cutie_obiect", "cod_cutie_obiect");
      addLike("cod_obiect",       "cod_obiect");
      addLike("Tip_Produs",       "Tip_Produs");
      addLike("Tip_Contract",     "Tip_Contract");
      addLike("Localitate",       "Localitate");
      addLike("CRC",              "CRC");
      addLike("sumar",            "sumar");
      addLike("tip_doc_cod_arh",  "tip_doc_cod_arh");

      // special case: an_creare header filter
      // - if numeric year typed (e.g. 2018) -> overlap match for that single year
      // - otherwise fallback to LIKE
      val = f["an_creare"];
      if (val !== null && val !== undefined) {
        val = String(val).trim();
        if (val.length > 0) {
          var yearInt = parseInt(val, 10);
          if (!isNaN(yearInt)) {
            var rowStartExpr2 = "TRY_CONVERT(INT, LEFT([an_creare], 4))";
            var rowEndExpr2 =
              "CASE WHEN CHARINDEX('-', [an_creare]) > 0 " +
              "THEN TRY_CONVERT(INT, RIGHT([an_creare], 4)) " +
              "ELSE TRY_CONVERT(INT, LEFT([an_creare], 4)) END";
            where.push("(" + rowStartExpr2 + " <= " + yearInt + " AND " + rowEndExpr2 + " >= " + yearInt + ")");
          } else {
            where.push("[an_creare] LIKE " + me._safe("%" + val + "%"));
          }
        }
      }
    }
    // -------------------------------------------------------

    var whereClause = "WHERE " + where.join(" AND ");

    if (countOnly) {
      return "SELECT COUNT(1) AS total " +
             "FROM [Lucru_EON].[dbo].[arh_istoric_arhiva_documente] WITH (NOLOCK) " +
             whereClause;
    }

    // ORDER BY: latest rowStart year descending
    var orderExpr = "TRY_CONVERT(INT, LEFT([an_creare], 4))";

    var sql =
      "SELECT " +
      "[skp], [cod_cutie_obiect], [cod_obiect], [Tip_Produs], [Tip_Contract], " +
      "[Localitate], [CRC], [sumar], [tip_doc_cod_arh], [an_creare], [uuid] " +
      "FROM [Lucru_EON].[dbo].[arh_istoric_arhiva_documente] WITH (NOLOCK) " +
      whereClause + " " +
      "ORDER BY " + orderExpr + " DESC, [uuid]";

    // SQL Server 2012+ pagination
    var offset = me.pageIndex * me.pageSize;
    sql += " OFFSET " + offset + " ROWS FETCH NEXT " + me.pageSize + " ROWS ONLY";

    return sql;
  },

  process: function () {
    var me = this,
        DB = new DBConnection();

    // 1) total count
    var sqlCount = me.buildSql(true);
    logger.info("SearchIstoricArhiva COUNT SQL: \n" + sqlCount);
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
    logger.info("SearchIstoricArhiva DATA SQL: \n" + sql);

    var rs = DB.query(sql);
    var rows = [];
    rs.forEach(function (r) {
      rows.push({
        skp:              r[0]  ? String(r[0])  : null,
        cod_cutie_obiect: r[1]  ? String(r[1])  : null,
        cod_obiect:       r[2]  ? String(r[2])  : null,
        Tip_Produs:       r[3]  ? String(r[3])  : null,
        Tip_Contract:     r[4]  ? String(r[4])  : null,
        Localitate:       r[5]  ? String(r[5])  : null,
        CRC:              r[6]  ? String(r[6])  : null,
        sumar:            r[7]  ? String(r[7])  : null,
        tip_doc_cod_arh:  r[8]  ? String(r[8])  : null,
        an_creare:        r[9]  ? String(r[9])  : null,
        uuid:             r[10] ? String(r[10]) : null
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

function RF_eon_arh_service_SearchIstoricArhiva(ec, configAny) {
  var rfUtils = sol.common.ix.RfUtils, config, service, result;
  logger.enter("RF_eon_arh_service_SearchIstoricArhiva", configAny);
  config = rfUtils.parseAndCheckParams(ec, arguments.callee.name, configAny);
  service = sol.create("eon.arh.ix.services.SearchIstoricArhiva", config);
  result = rfUtils.stringify(service.process());
  logger.exit("RF_eon_arh_service_SearchIstoricArhiva");
  return result;
}
