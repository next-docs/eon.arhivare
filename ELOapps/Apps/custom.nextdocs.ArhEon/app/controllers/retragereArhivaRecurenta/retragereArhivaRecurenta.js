(function () {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.controller('retragereArhivaRecurenta', [
        '$scope', '$filter', 'ModalDialogService', 'FileService', '$timeout', 'AuditService', '$rootScope', "$q", 'ArhivareService',
        function ($scope, $filter, ModalDialogService, FileService, $timeout, AuditService, $rootScope, $q, ArhivareService) {
            var ctrl = this;

            //--- Config ---//
            let cfg = api.helpers.Configuration.get("arh"); // reserved for later use
            //--------------//

            // Static options
            ctrl.optMotiv = [
                "INSTANTA",
                "ANRE",
                "AUDIT",
                "SOLICITARE CLIENT",
                "RECLAMATIE CLIENT",
                "RECUPERARE CREANTE",
                "IPJ /POLITIE",
                "ANPC",
                "ALTELE"
            ];
            ctrl.optLivrare = ['Curier', 'Email'];
            ctrl.showSelectedAccordion = false;

            ctrl.opOptions = [
                { label: 'Este egal cu', code: '=', required: true },
                { label: 'Mai mic decat', code: '<', required: true },
                { label: 'Mai mare decat', code: '>', required: true },
                { label: 'Mai mic sau egal cu', code: '<=', required: true },
                { label: 'Mai mare sau egal cu', code: '>=', required: true },
                { label: 'Este diferit de', code: '<>', required: true },
                { label: 'Contine', code: 'LIKE_CONTAINS', required: true },
                { label: 'Nu contine', code: 'NOT_LIKE_CONTAINS', required: true },
                { label: 'Este gol', code: 'IS_EMPTY', required: false },
                { label: 'Este completat', code: 'IS_NOT_EMPTY', required: false }
            ];

            ctrl.allowColumns = [
                { key: 'Selecteaza...', label: 'Selecteaza...' },
                { key: 'Cod_Nlc',       label: 'Cod NLC' },
                { key: 'Numar_Contract',label: 'Numar Contract' },
                { key: 'Cod_Client',    label: 'Cod Client' }
            ];

            // ✅ SIMPLE COLUMN FILTERS (header inputs)
            ctrl.columnFilters = {
                skp: '',
                numar_ordine: '',
                crc: '',
                cod_nlc: '',
                numar_contract: '',
                cod_client: '',
                an: '',
                data_arhivare: ''
            };
              

            // UI model
            const now = new Date();
            ctrl.model = {
                year: now.getFullYear(),
                motiv_retragere: null,
                urgent: false,
                modalitate_livrare: null,

                data_inceput: null,
                data_sfarsit: null,

                // time parts for building "yyyy-MM-dd HH:mm"
                data_inceput_hh: null,
                data_inceput_mm: null,
                data_sfarsit_hh: null,
                data_sfarsit_mm: null,

                crc: null,
                localitate: null,
                departament: null,
                termen_livrare: null,
                observatii: null,

                status_preview: 'Solicitat'
            };

            ctrl.selectedDocs = {};
            ctrl.selectedDocsLength = 0;
            ctrl.filterGroups = [];
            ctrl.optiuniDepartament = [];

            function trimTo(v, n){ return v ? String(v).slice(0, n) : v; }

            function generateUUID() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            ctrl.getOpMeta = function (code) {
                if (!code) return null;
                for (var i = 0; i < ctrl.opOptions.length; i++) {
                    if (ctrl.opOptions[i].code === code) {
                        return ctrl.opOptions[i];
                    }
                }
                return null;
            };

            ctrl.opRequiresValue = function (code) {
                var meta = ctrl.getOpMeta(code);
                return meta ? meta.required === true : false;
            };

            $scope.$watch(
                function () {
                    return ctrl.selectedDocs;
                },
                function (newVal) {
                    if (newVal) {
                        ctrl.selectedDocsLength = Object.keys(newVal).length;
                    }
                },
                true
            );

            function createDefaultFilter() {
                const firstCol = ctrl.allowColumns[0];
                return {
                    column: firstCol ? firstCol.key : null,
                    op: ctrl.opOptions[0].code,   // "Este egal cu"
                    value: ''
                };
            }

            // PLUS ALBASTRU – adauga grup nou (OR)
            ctrl.addAndGroup = function () {
                ctrl.filterGroups.push([createDefaultFilter()]);
            };

            // PLUS VERDE – adauga filtru in acelasi grup (AND)
            ctrl.addOrFilter = function (groupIndex) {
                if (!ctrl.filterGroups[groupIndex]) return;
                ctrl.filterGroups[groupIndex].push(createDefaultFilter());
            };

            // X – sterge filtru (si grupul daca devine gol)
            ctrl.removeFilter = function (groupIndex, filterIndex) {
                if (!ctrl.filterGroups[groupIndex]) return;
                ctrl.filterGroups[groupIndex].splice(filterIndex, 1);
                if (!ctrl.filterGroups[groupIndex].length) {
                    ctrl.filterGroups.splice(groupIndex, 1);
                }
            };

            // Helpers
            ctrl.getNow = function () {
                return new Date();
            };

            function pad2(n) {
                n = parseInt(n, 10);
                if (isNaN(n) || n < 0) n = 0;
                return (n < 10 ? '0' : '') + n;
            }

            function buildDateTimeStr(dateObj, hh, mm) {
                if (!dateObj) return null;
                var h = parseInt(hh, 10);
                var m = parseInt(mm, 10);
                if (isNaN(h) || h < 0 || h > 23) h = 0;
                if (isNaN(m) || m < 0 || m > 59) m = 0;

                var datePart = $filter('date')(dateObj, 'yyyy-MM-dd');
                return datePart + ' ' + pad2(h) + ':' + pad2(m);
            }

            // SearchNomenclator
            ctrl.searchNomenclator = function (nume_tabela, data) {
                var params = {
                    nume_tabela: nume_tabela
                };

                console.log("SEARCH NOMENCLATOR PARAMS:", params);

                ArhivareService.searchNomenclator(params).then(function (res) {
                    ctrl[data] = res.rows || [];
                });
            };

            // ✅ COLUMN FILTERS: live search (debounced)
            let colFilterPromise = null;
            ctrl.onColumnFilterChange = function () {
                $scope.currentPage = 0; // go back to first page on new filter

                if (colFilterPromise) {
                    $timeout.cancel(colFilterPromise);
                }

                colFilterPromise = $timeout(function () {
                    // no validation when typing
                    ctrl.search(false, false);
                }, 300);
            };

            // Search Arhiva
            ctrl.search = function (resetPage, validation) {

                if (resetPage) {
                    $scope.currentPage = 0; // new search -> back to first page
                }

                var firstFilter = ctrl.filterGroups?.[0]?.[0];
                var isFilter = firstFilter && firstFilter.column !== "Selecteaza...";

                if (validation && isFilter) {
                    ctrl.filtersTouched = true;
                    var invalidFilters = false;

                    (ctrl.filterGroups || []).forEach(function (group) {
                        (group || []).forEach(function (f) {
                            var meta = ctrl.getOpMeta(f.op);
                            if (meta && meta.required && !f.value) {
                                invalidFilters = true;
                            }
                        });
                    });

                    if (invalidFilters) {
                        return;
                    }
                }

                if (!validation) {
                    ctrl.filtersTouched = false;
                }

                // structured groups
                var groupedFilters = ctrl.filterGroups.map(function (group) {
                    return group.map(function (f) {
                        return {
                            column: f.column,
                            op: f.op,
                            value: f.value
                        };
                    });
                });

                var params = {
                    filterGroups: groupedFilters,

                    // ✅ add simple column filters
                    filters: ctrl.columnFilters,

                    // pagination
                    pageIndex: $scope.currentPage,
                    pageSize: $scope.pageSize
                };

                console.log("SEARCH ARHIVA PARAMS:", params);

                ArhivareService.searchArhivaRecurenta(params).then(function (res) {
                    var rows = res.rows || [];
                    rows.forEach(function (r) {
                        if (r.data_arhivare) {
                            r.data_arhivare = new Date(r.data_arhivare.replace(' ', 'T'));
                        }
                    });

                    ctrl.results = rows;
                    ctrl.selectedUuid = null;

                    $scope.setPaginare(Math.ceil(res.total / $scope.pageSize));

                    console.log("CAUTARE SQL ARHIVA: " + res.sqlQuery);
                });
            };

            // Results
            ctrl.results = [];
            ctrl.selectedUuid = null;

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

            $scope.setCurrentPage = (nrPage) => {
                console.log(nrPage);
                if (nrPage >= 0 && nrPage <= $scope.numarPagini) {
                    $scope.currentPage = nrPage;

                    setTimeout(() => {
                        var pageSelectedOld = document.querySelectorAll('div.page-set');
                        pageSelectedOld.forEach(function (div) {
                            div.classList.remove('page-set');
                        });

                        var pageSelected = document.querySelectorAll('div.page[data-value="' + nrPage + '"]');
                        pageSelected.forEach(function (div) {
                            div.classList.add('page-set');
                        });
                    }, 200);

                    // page change should not trigger validation
                    ctrl.search(false, false);
                }
            };
            /********************************** end - Paginare **********************************/

            // Multi-Select
            ctrl.toggleSelect = function (row) {
                if (!row || !row.uuid) return;

                var uuid = row.uuid;

                if (ctrl.selectedDocs[uuid]) {
                    delete ctrl.selectedDocs[uuid];
                } else {
                    var copy = angular.copy(row);
                    copy.nume_abonat = copy.nume_abonat || "";
                    ctrl.selectedDocs[uuid] = copy;
                    ctrl.showSelectedAccordion = true;
                }
                  

                console.log("Selected docs map:", ctrl.selectedDocs);
            };

            ctrl.isSelected = function (row) {
                if (!row || !row.uuid) return false;
                return !!ctrl.selectedDocs[row.uuid];
            };

            ctrl.getSelectedUuids = function () {
                return Object.keys(ctrl.selectedDocs);
            };

            ctrl.removeSelected = function (uuid, $event) {
                if ($event && $event.stopPropagation) {
                    $event.stopPropagation();
                }
                if (uuid && ctrl.selectedDocs[uuid]) {
                    delete ctrl.selectedDocs[uuid];
                }
                console.log("Selected docs after remove:", ctrl.selectedDocs);
            };

            $scope.touchAll = function (form) {
                angular.forEach(form.$error, function (fields) {
                    angular.forEach(fields, function (field) {
                        field.$setTouched();
                    });
                });
            };

            ctrl.isEmpty = function (v) {
                return v === null || v === undefined || String(v).trim() === "";
            };
              
            ctrl.canSubmit = function () {
                var docs = Object.values(ctrl.selectedDocs || {});
                if (!docs.length) return false;
                
                // obligatoriu: nume_abonat completat pe fiecare rand selectat
                for (var i = 0; i < docs.length; i++) {
                    if (ctrl.isEmpty(docs[i].nume_abonat)) return false;
                }
                return true;
            };
              

            // Submit
            ctrl.addSolicitare = function () {

                ctrl.model.adresa     = trimTo(ctrl.model.adresa, 105);
                ctrl.model.localitate = trimTo(ctrl.model.localitate, 20);
                ctrl.model.telefon    = trimTo(ctrl.model.telefon, 14);
                ctrl.model.observatii = trimTo(ctrl.model.observatii, 120);
                
                $scope.touchAll($scope.frmRetragereRecurenta);
                ctrl.isSubmitted = true;
                if ($scope.frmRetragereRecurenta.$invalid) {
                    return;
                }

                var res = confirm("Inregistrati comanda?");

                if (!res) {
                    return
                }

                var selectedUuids = Object.keys(ctrl.selectedDocs || {});
                if (!selectedUuids.length) {
                    alert("Selecteaza cel putin un rand din tabel.");
                    return;
                }

                var groupId = generateUUID();
                console.log("GROUP ID for this batch:", groupId);
                console.log("Selected UUIDs:", selectedUuids);

                var payload = {
                    registrationLetter: "RR",
                    tip_operatiune: "Retragere Arhiva Recurenta",
                    year: ctrl.model.year,
                    data_inceput: $filter('date')(new Date(), 'yyyy-MM-dd HH:mm:ss'),

                    motiv_retragere: ctrl.model.motiv_retragere,
                    urgent: ctrl.model.urgent ? "DA" : "NU",
                    modalitate_livrare: ctrl.model.modalitate_livrare,
                    observatii: ctrl.model.observatii,
                    localitate: ctrl.model.localitate,
                    adresa: ctrl.model.adresa,
                    telefon: ctrl.model.telefon,

                    group_id: groupId,
                    selected_docs: Object.values(ctrl.selectedDocs || {}),
                    departament: ctrl.model.departament
                        ? ctrl.model.departament.nume
                        : ""
                };

                console.log("ADD SOLICITARE BATCH PAYLOAD:", payload);

                ArhivareService.createRetragereArhiva(payload).then(function (res) {
                    console.log("BATCH RESPONSE:", res);

                    var items = (res && res.items) ? res.items : [];
                    if (!items.length) {
                        alert("Nu au fost inregistrate solicitari (raspuns gol).");
                        ModalDialogService.showModalDialog({
                            title: "Arhivare - Eroare solicitare document",
                            noHeader: false,
                            template: 
                                `
                                    <p>Nu au fost inregistrate solicitari!</p>
                                `,
                            buttons: [
                                {
                                    name: "ok",
                                    primary: true,
                                    handler: function (scope) {
                                        scope.$close(scope.data);
                                    }
                                }
                            ]
                        });
                    }

                    var numbers = items.map(function (it) {
                        return it.numar_comanda || ("R" + ctrl.model.year + "-#####");
                    });
					
					// filtrare numere comanda duplicat
					var numbers = numbers.filter(function (value, index, self) {
						return self.indexOf(value) === index;
					});

                    if (numbers.length > 0) {

                        var label = numbers.length > 1 ? "Numere de inregistrare:" : "Numar de inregistrare:";
                        var numbersHtml = numbers.join("<br>");

                        ModalDialogService.showModalDialog({
                            title: "Arhivare - Solicitare document",
                            noHeader: false,
                            template: 
                                `
                                    <p>Solicitarea a fost inregistrata!</p>
                                    <p>${label}<br>${numbersHtml}</p>
                                    <p>Data inregistrarii: ${res.date.replaceAll("'", "")}</p>
                                `,
                            buttons: [
                                {
                                    name: "ok",
                                    primary: true,
                                    handler: function (scope) {
                                        scope.$close(scope.data);
                                    }
                                }
                            ]
                        });
                    }

                    ctrl.anuleazaSolicitare(true);

                }, function (err) {
                    console.error("Eroare la inregistrarea batch-ului de solicitarilor:", err);
                    alert("A aparut o eroare la inregistrarea solicitarilor. Niciun rand nu a fost salvat (Inregistrarea a fost anulata).");
                    ctrl.anuleazaSolicitare(true);
                });
            };

            ctrl.anuleazaSolicitare = function (cleanUp) {
                if (!cleanUp) {
                    var res = confirm("Sigur doriti sa anulati?");
                    if (!res) {
                        return
                    }
                }

                ctrl.model = {
                    year: now.getFullYear(),
                    motiv_retragere: null,
                    urgent: false,
                    modalitate_livrare: null,

                    data_inceput: null,
                    data_sfarsit: null,
                    data_inceput_hh: null,
                    data_inceput_mm: null,
                    data_sfarsit_hh: null,
                    data_sfarsit_mm: null,

                    crc: null,
                    localitate: null,
                    departament: null,
                    termen_livrare: null,
                    observatii: null,

                    status_preview: 'Solicitat'
                };

                ctrl.selectedDocs = {};
                ctrl.isSubmitted = false;
                $timeout(function () {
                    if ($scope.frmRetragereRecurenta) {
                        $scope.frmRetragereRecurenta.$setPristine();
                        $scope.frmRetragereRecurenta.$setUntouched();
                    }
                }, 0);
            };

            ctrl.$onInit = function () {
                console.log("RetragereArhivaRecurenta");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_departament_recurenta_si_istoric]", "optiuniDepartament");
                ctrl.now = new Date();
                ctrl.addAndGroup();
                ctrl.filtersTouched = false;
                ctrl.isSubmitted = false;
                ctrl.search(true, false);
            };
        }
    ]);

}());
