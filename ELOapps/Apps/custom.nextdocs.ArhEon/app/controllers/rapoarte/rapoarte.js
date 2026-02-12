(function () {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.controller('Rapoarte', [
        '$scope', '$filter', 'ModalDialogService', 'FileService', '$timeout', 'AuditService', '$rootScope', 'ArhivareService',
        function ($scope, $filter, ModalDialogService, FileService, $timeout, AuditService, $rootScope, ArhivareService) {

            var ctrl = this;
            ctrl.comenzi = [];

            //--- Config ---//
            let cfg = api.helpers.Configuration.get("arh");
            //--------------//

            // Obiectul filters care ține valorile filtrelor
            ctrl.filters = {
                nr_crt: '',
                numar_comanda: '',
                tip_operatiune: '',
                data_solicitare: '',
                departament: '',
                status: '',
                crc: '',
                cod_nlc: '',
                nume_abonat: '',
                numar_contract: '',
                cod_client: '', 
                observatii: '',
                user: ''
              };
              


            /********************************** start - Paginare **********************************/
            $scope.currentPage = 0;
            $scope.pageSize = 10;
            $scope.numarPagini = 0;
            $scope.numarPaginiTotal = 0;
            $scope.pages = [];

            $scope.setPaginare = function (nrPagini) {
                $scope.pages = [];
                $scope.numarPagini = nrPagini;
                if ($scope.numarPagini > 0 && $scope.numarPagini < 5) {
                    for (var i = 0; i < $scope.numarPagini; i++) {
                        $scope.pages.push((i));
                    }
                } else {
                    $scope.pages = [];
                    for (var i = $scope.currentPage - 3; i <= $scope.currentPage + 3; i++) {
                        if (i > 0 && i < $scope.numarPagini - 1) {
                            $scope.pages.push((i));
                        }
                    }
                }
            };

            $scope.setCurrentPage = function (nrPage) {
                console.log(nrPage);
                if (nrPage >= 0 && nrPage <= $scope.numarPagini) {
                    $scope.currentPage = nrPage;

                    $timeout(function () {
                        var pageSelectedOld = document.querySelectorAll('div.page-set');
                        pageSelectedOld.forEach(function (div) {
                            div.classList.remove('page-set');
                        });

                        var pageSelected = document.querySelectorAll('div.page[data-value="' + nrPage + '"]');
                        pageSelected.forEach(function (div) {
                            div.classList.add('page-set');
                        });
                    }, 200);

                    ctrl.search(false);
                }
            };
            /********************************** end - Paginare **********************************/

            // Cautare (apelata si de filtre, si de paginare, si initial)
            ctrl.search = function (resetPage) {
                if (resetPage === true) {
                    $scope.currentPage = 0; // new search -> back to first page
                }

                // parametri pentru cautare
                var params = {
                    filters: ctrl.filters,
                    pageIndex: $scope.currentPage,
                    pageSize: $scope.pageSize
                };

                console.log("SEARCH RAPORT PARAMS:", params);

                // Apelam serviciul de cautare
                ArhivareService.searchRaport(params).then(function (res) {
                    // res: { rows, total, pageIndex, pageSize }
                    ctrl.comenzi = res.rows || [];

                    $scope.setPaginare(Math.ceil(res.total / $scope.pageSize));
                });
            };

            // Apelata cand se modifica oricare filtru (live search)
            ctrl.onFilterChange = function () {
                $scope.currentPage = 0;       // de fiecare data cand schimb filtrele, ma duc pe pagina 1
                ctrl.search(false);           // caut cu filtrele curente
            };

            // Golire filters
            ctrl.clearFilters = function () {
                for (var key in ctrl.filters) {
                    if (ctrl.filters.hasOwnProperty(key)) {
                        ctrl.filters[key] = '';
                    }
                }

                // search without filters
                ctrl.search(true);
            };

            //Export XLSX
            ctrl.exportRaportToXlsx = async function () {
                try {
                    // cloneaza filtrele si seteaza pageSize mare ca sa iei toate rezultatele
                    let params = angular.copy(ctrl.filters);

                    let fetchParams = {
                        filters: params,
                        pageIndex: 0,
                        pageSize: 1000000
                    };

                    // cautare date
                    let res = await ArhivareService.searchRaport(fetchParams);
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
                        "Cod NLC",
                        "Nume abonat",
                        "Numar Contract",
                        "Cod Client",
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
                            row.cod_nlc || "",
                            row.nume_abonat || "",
                            row.numar_contract || "",
                            row.cod_client || "",
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
                    const d = new Date();
                    const stamp =
                        d.getFullYear().toString() +
                        String(d.getMonth() + 1).padStart(2, "0") +
                        String(d.getDate()).padStart(2, "0") + "_" +
                        String(d.getHours()).padStart(2, "0") +
                        String(d.getMinutes()).padStart(2, "0");
                    XLSX.writeFile(wb, "Raport_" + stamp + ".xlsx");
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
            ctrl.$onInit = function () {
                console.log("Rapoarte");
                // Executăm căutarea la inițializare
                ctrl.search(false);
            };

        }
    ]);

    // Directive pentru truncarea celulelor (observatii)
    custom.nextdocs.ArhEon.app.directive('truncateCell', function () {
        return {
            restrict: 'A',
            scope: {
                text: '=',  // leaga textul direct de modelul Angular
                limit: '@?' // limita optionala
            },
            link: function (scope, element) {
                const limit = parseInt(scope.limit) || 60;
                let expanded = false;

                function render() {
                    if (!scope.text || scope.text.length <= limit) {
                        element.text(scope.text || '');
                        return;
                    }

                    if (expanded) {
                        element.html(scope.text + ' <span class="td-collapse" style="cursor:pointer;color:#007bff;">[mai puțin]</span>');
                    } else {
                        const shortText = scope.text.substring(0, limit) + '... ';
                        element.html(shortText + '<span class="td-expand" style="cursor:pointer;color:#007bff;">[mai mult]</span>');
                    }
                }

                scope.$watch('text', function () {
                    render();
                });

                element.on('click', function (e) {
                    if (e.target.classList.contains('td-expand')) {
                        e.stopPropagation();
                        expanded = true;
                        render();
                    } else if (e.target.classList.contains('td-collapse')) {
                        e.stopPropagation();
                        expanded = false;
                        render();
                    }
                });
            }
        };
    });

}());
