(function () {
    "use strict";

    angular.module("api.module.ArhivareServices")
        .service("ArhivareService", ['$q', function ($q) {

            /**
             * Search with date operators and dynamic filters
             * @param {Object} params: {
             *   dateOpStart, dateStart, dateOpEnd, dateEnd,
             *   filters: [{column, op, value}],
             *   pageIndex, pageSize
             * }
             */
            function searchIstoricArhiva(params) {
                const deferred = $q.defer();
            
                const payload = {
                    dateOpStart: params.dateOpStart || null,
                    dateStart:   params.dateStart   || null,
                    dateOpEnd:   params.dateOpEnd   || null,
                    dateEnd:     params.dateEnd     || null,
                    filterGroups: params.filterGroups || null,
            
                    filters: params.filters || {},
            
                    // pagination
                    pageIndex: typeof params.pageIndex === 'number' ? params.pageIndex : 0,
                    pageSize: typeof params.pageSize === 'number' ? params.pageSize : 20
                };
            
                console.log("FINAL SEARCH PAYLOAD: ", payload);
            
                sol.common.IxUtils.execute("RF_eon_arh_service_SearchIstoricArhiva", payload,
                    function success(data) {
                        if (!data) {
                            data = { rows: [], total: 0, pageIndex: 0, pageSize: payload.pageSize };
                        }
                        deferred.resolve(data);
                    },
                    function failure(err) {
                        console.error("ArhivareService.searchIstoricArhiva error:", err);
                        deferred.reject(err);
                    }
                );
            
                return deferred.promise;
            }
			
			
			 /**
             * Search with dynamic filters
             * @param {Object} params: {
             *   filters: [{column, op, value}],
             *   pageIndex, pageSize
             * }
             */
            function searchArhivaRecurenta(params) {
                const deferred = $q.defer();
            
                const payload = {
                    filterGroups: params.filterGroups || null,
            
                    // ✅ NEW: simple column filters
                    filters: params.filters || {},
            
                    // pagination
                    pageIndex: typeof params.pageIndex === 'number' ? params.pageIndex : 0,
                    pageSize: typeof params.pageSize === 'number' ? params.pageSize : 20
                };
            
                console.log("FINAL SEARCH PAYLOAD: ", payload);
            
                sol.common.IxUtils.execute("RF_eon_arh_service_SearchArhivaRecurenta", payload,
                    function success(data) {
                        if (!data) {
                            data = { rows: [], total: 0, pageIndex: 0, pageSize: payload.pageSize };
                        }
                        deferred.resolve(data);
                    },
                    function failure(err) {
                        console.error("ArhivareService.searchArhivaRecurenta error:", err);
                        deferred.reject(err);
                    }
                );
            
                return deferred.promise;
            }


            /**
             * Insert into arh_solicitari_documente; server will generate numar_comanda (RYYYY-####)
             * @param {Object} data see controller send
             */
            function createRetragereArhiva(data) {
                const deferred = $q.defer();

                sol.common.IxUtils.execute("RF_eon_arh_service_CreateRetragereArhiva", { data: data },
                    function success(data) { deferred.resolve(data || {}); },
                    function failure(err) { console.error("ArhIstoricService.createRetragereArhiva error:", err); deferred.reject(err); }
                );

                return deferred.promise;
            }
			
			/**
             * Insert into arh_ridicare_arhiva; server will generate numar_comanda (RYYYY-####)
             * @param {Object} data see controller send
             */
            function createRidicareArhiva(data) {
                const deferred = $q.defer();

                sol.common.IxUtils.execute("RF_eon_arh_service_CreateRidicareArhiva", { data: data },
                    function success(data) { deferred.resolve(data || {}); },
                    function failure(err) { console.error("ArhIstoricService.createRidicareArhiva error:", err); deferred.reject(err); }
                );

                return deferred.promise;
            }
			
			 /**
             * Search nomeclator
             * @param {Object} params: {
             *   nume_tabela
             * }
             */
            function searchNomenclator(params) {
                const deferred = $q.defer();

                const payload = {
                    nume_tabela: params.nume_tabela || null,
                };

                console.log("FINAL SEARCH PAYLOAD: ", payload);

                sol.common.IxUtils.execute("RF_eon_arh_service_SearchNomenclator", payload,
                    function success(data) {
                        // data is now: { rows }
                        if (!data) {
                            data = { rows: [] };
                        }
                        deferred.resolve(data);
                    },
                    function failure(err) {
                        console.error("ArhivareService.searchNomenclator error:", err);
                        deferred.reject(err);
                    }
                );

                return deferred.promise;
            }
			
			/**
             * Search raport
             * @param {Object} params: {
             *   dateOpStart, dateStart, dateOpEnd, dateEnd,
             *   filters: [{column, op, value}],
             *   pageIndex, pageSize
             * }
             */
            function searchRaport(params) {
                const deferred = $q.defer();

                const payload = {
                    filters: params.filters || {},

                    // NEW: pagination
                    pageIndex: typeof params.pageIndex === 'number' ? params.pageIndex : 0,
                    pageSize: typeof params.pageSize === 'number' ? params.pageSize : 20
                };

                console.log("FINAL SEARCH PAYLOAD: ", payload);

                sol.common.IxUtils.execute("RF_eon_arh_service_SearchRaport", payload,
                    function success(data) {
                        // data is now: { rows, total, pageIndex, pageSize }
                        if (!data) {
                            data = { rows: [], total: 0, pageIndex: 0, pageSize: payload.pageSize };
                        }
                        deferred.resolve(data);
                    },
                    function failure(err) {
                        console.error("ArhivareService.searchRaport error:", err);
                        deferred.reject(err);
                    }
                );

                return deferred.promise;
            }

            return {
                searchIstoricArhiva,
				searchArhivaRecurenta,
                createRetragereArhiva,
				createRidicareArhiva,
				searchNomenclator,
				searchRaport
            };
        }]);

})();
