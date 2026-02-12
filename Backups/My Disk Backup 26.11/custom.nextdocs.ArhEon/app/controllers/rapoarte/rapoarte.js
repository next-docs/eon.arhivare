(function() {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.controller('Rapoarte', ['$scope', '$filter', 'ModalDialogService', 'FileService', '$timeout', 'AuditService', '$rootScope', 'ArhivareService',
        function($scope, $filter, ModalDialogService, FileService, $timeout, AuditService, $rootScope, RapoarteService) {
            var ctrl = this;
            ctrl.filterGroups = [];

            // Obiectul filters care ține valorile filtrelor
            ctrl.filters = {
                nr_crt: '',
                numar_comanda: '',
                tip_operatiune: '',
                data_solicitare: '',
                departament: '',
                status: '',
                crc: '',
                termen_livrare: '',
                observatii: '',
                user: ''
            };

            ctrl.comenzi = [];

            //--- Config ---//
            let cfg = api.helpers.Configuration.get("arh");
            //--------------//

            ctrl.pagination = {
                pageIndex: 0, // zero-based
                pageSize: 5, // default items per page
                total: 0
            };

            ctrl.totalPages = function() {
                if (!ctrl.pagination.pageSize) return 1;
                return Math.max(1, Math.ceil(ctrl.pagination.total / ctrl.pagination.pageSize));
            };

            ctrl.canPrev = function() {
                return ctrl.pagination.pageIndex > 0;
            };

            ctrl.canNext = function() {
                return (ctrl.pagination.pageIndex + 1) < ctrl.totalPages();
            };

            ctrl.goToPage = function(pageIndex) {
                if (pageIndex < 0 || pageIndex >= ctrl.totalPages()) return;
                ctrl.pagination.pageIndex = pageIndex;
                ctrl.search(false); // don't reset page when paging
            };

            ctrl.prevPage = function() {
                if (!ctrl.canPrev()) return;
                ctrl.pagination.pageIndex--;
                ctrl.search(false);
            };

            ctrl.nextPage = function() {
                if (!ctrl.canNext()) return;
                ctrl.pagination.pageIndex++;
                ctrl.search(false);
            };

            ctrl.changePageSize = function() {
                ctrl.pagination.pageIndex = 0;
                ctrl.search(false); // reload with new page size
            };


            // cautare
            ctrl.search = function(resetPage) {
                if (resetPage) {
                    ctrl.pagination.pageIndex = 0; // new search -> back to first page
                }

                // parametri pentru cautare
                var params = {
                    filters: ctrl.filters,
                    pageIndex: ctrl.pagination.pageIndex,
                    pageSize: ctrl.pagination.pageSize
                };

                console.log("SEARCH RAPORT PARAMS:", params);

                // Apelăm serviciul de căutare
                RapoarteService.searchRaport(params).then(function(res) {
                    // res: { rows, total, pageIndex, pageSize }
                    ctrl.comenzi = res.rows || [];

                    ctrl.pagination.total = res.total || 0;
                    ctrl.pagination.pageIndex = res.pageIndex || 0;
                    ctrl.pagination.pageSize = res.pageSize || ctrl.pagination.pageSize;
                });
            };

            // cautare
            ctrl.clearFilters = function() {
                for (var key in ctrl.filters) {
                    if (ctrl.filters.hasOwnProperty(key)) {
                        ctrl.filters[key] = '';
                    }
                }

                //search without filters
                ctrl.search(true);
            };

            ctrl.exportRaportToXlsx = async function() {
                try {
                    // cloneaza filtrele si seteaza pageSize mare ca sa iei toate rezultatele
                    let params = angular.copy(ctrl.filters);

                    let fetchParams = {
                        filters: params,
                        pageIndex: 0,
                        pageSize: 1000000
                    };

                    // cautare date
                    let res = await RapoarteService.searchRaport(fetchParams);
                    let dataRows = res.rows || [];

                    if (!dataRows.length) {
                        alert("Nu sunt date pentru export!");
                        return;
                    }

                    // Header-ul explicit pentru raport
                    let headerExcel = [
                        "Nr. comanda",
                        "Tip operatiune",
                        "Data solicitare",
                        "Departament solicitant",
                        "Status",
                        "CRC",
                        "Termen livrare",
                        "Observatii",
                        "User"
                    ];

                    // construieste randurile pentru export
                    let wsData = [headerExcel];
                    dataRows.forEach((row, index) => {
                        wsData.push([
                            row.numar_comanda || "",
                            row.tip_operatiune || "",
                            row.data_solicitare || "",
                            row.departament || "",
                            row.status || "",
                            row.crc || "",
                            row.termen_livrare || "",
                            row.observatii || "",
                            row.user || ""
                        ]);
                    });

                    // creeaza worksheet si workbook
                    var ws = XLSX.utils.aoa_to_sheet(wsData);
                    autoFitColumns(ws, wsData);
                    var wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Raport");

                    // Scrie fisierul
                    var timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                    XLSX.writeFile(wb, "Raport_" + timestamp + ".xlsx");
                } catch (err) {
                    console.error("Eroare export XLSX:", err);
                }
            };

            function autoFitColumns(ws, data) {
                const colWidths = data[0].map((_, colIndex) => {
                    return data.reduce((maxWidth, row) => {
                        const cellValue = row[colIndex] ? row[colIndex].toString() : "";
                        return Math.max(maxWidth, cellValue.length);
                    }, 10);
                });

                ws['!cols'] = colWidths.map(width => ({
                    wch: width
                }));
            }


            // Inițializare controller
            ctrl.$onInit = function() {
                console.log("Rapoarte");

                // Executăm căutarea la inițializare
                ctrl.search();
            }

        }
    ]);
}());