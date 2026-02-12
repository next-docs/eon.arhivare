(function () {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.controller('RetragereIstoricArhiva', [
        '$scope', '$filter', 'ModalDialogService', 'FileService', '$timeout', 'AuditService', '$rootScope', "$q", 'ArhivareService',
        function ($scope, $filter, ModalDialogService, FileService, $timeout, AuditService, $rootScope, $q, ArhivareService) {
            var ctrl = this;

            //--- Config ---//
            let cfg = api.helpers.Configuration.get("arh"); // reserved for later use
            //--------------//

            // Static options
            ctrl.optMotiv = ['Solicitare client', 'Audit', 'Rapoarte'];
            ctrl.optLivrare = ['Curier', 'Email'];
            ctrl.showSelectedAccordion = false;

            ctrl.opOptions = [
                { label: 'Este egal cu', code: '=' },
                { label: 'Mai mic decat', code: '<' },
                { label: 'Mai mare decat', code: '>' },
                { label: 'Mai mic sau egal cu', code: '<=' },
                { label: 'Mai mare sau egal cu', code: '>=' },
                { label: 'Este diferit de', code: '<>' },
                { label: 'Contine', code: 'LIKE_CONTAINS' },
                { label: 'Nu contine', code: 'NOT_LIKE_CONTAINS' },
                { label: 'Este gol', code: 'IS_EMPTY' },
                { label: 'Este completat', code: 'IS_NOT_EMPTY' }
            ];

            ctrl.allowColumns = [
                { key: 'SKP',                  label: 'SKP' },
                { key: 'cod_cutie_obiect',     label: 'Cod Cutie' },
                { key: 'Tip_Produs',           label: 'Tip Produs' },
                { key: 'Tip_Contract',         label: 'Tip Contract' },
                { key: 'Localitate',           label: 'Localitate' },
                { key: 'CRC',                  label: 'CRC' },
                { key: 'sumar',                label: 'Sumar' },
                { key: 'tip_doc_cod_arh',      label: 'Tip Doc (cod ARH)' },
                { key: 'departament',          label: 'Departament' }
            ];

            // UI model
            const now = new Date();
            ctrl.model = {
                year: now.getFullYear(),
                motiv_retragere: null,
                urgent: false,
                modalitate_livrare: null,

                data_inceput_op: '>=',
                data_sfarsit_op: '<=',
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

            // ====== AND / OR FILTER GROUPS ======
            // filterGroups = [
            //   [ {column, op, value}, {column, op, value}, ... ],   // group 0: AND intre ele
            //   [ {column, op, value}, ... ],                       // group 1
            // ]
            // grupurile sunt legate intre ele cu OR
            ctrl.selectedDocs = {};
            ctrl.filterGroups = [];
            ctrl.optiuniDepartament = [];

            function generateUUID() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            };

            function createDefaultFilter() {
                const firstCol = ctrl.allowColumns[0];
                return {
                    column: firstCol ? firstCol.key : null,
                    op: ctrl.opOptions[0].code,   // "Este egal cu"
                    value: ''
                };
            };

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

            // Build "yyyy-MM-dd HH:mm" from date + hh/mm fields
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
            ctrl.searchNomenclator = function(nume_tabela, data) {
                var params = {
                    nume_tabela: nume_tabela
                };

                console.log("SEARCH NOMENCLATOR PARAMS:", params);

                ArhivareService.searchNomenclator(params).then(function(res) {
                    // res: { rows }
                    ctrl[data] = res.rows || [];
                });
            };

            // Search Arhiva
			ctrl.search = function (resetPage) {

                if (resetPage) {
                    ctrl.pagination.pageIndex = 0; // new search -> back to first page
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
                    dateOpStart: ctrl.model.data_inceput_op,
                    dateStart:   buildDateTimeStr(
                                    ctrl.model.data_inceput,
                                    ctrl.model.data_inceput_hh,
                                    ctrl.model.data_inceput_mm
                                 ),
                    dateOpEnd:   ctrl.model.data_sfarsit_op,
                    dateEnd:     buildDateTimeStr(
                                    ctrl.model.data_sfarsit,
                                    ctrl.model.data_sfarsit_hh,
                                    ctrl.model.data_sfarsit_mm
                                 ),

                    filterGroups: groupedFilters,

                    // pagination
                    pageIndex: ctrl.pagination.pageIndex,
                    pageSize:  ctrl.pagination.pageSize
                };

                console.log("SEARCH ARHIVA PARAMS:", params);

                ArhivareService.searchIstoricArhiva(params).then(function (res) {
                    // res: { rows, total, pageIndex, pageSize }
                    var rows = res.rows || [];
                    rows.forEach(function (r) {
                        if (r.data_creare) {
                            // if backend returns "2024-11-21 14:35:22"
                            r.data_creare = new Date(r.data_creare.replace(' ', 'T'));
                            // if it already comes with "T" in it, this still works fine
                        }
                    });

                    ctrl.results = rows;
                    ctrl.selectedUuid = null;

                    ctrl.pagination.total = res.total || 0;
                    ctrl.pagination.pageIndex = res.pageIndex || 0;
                    ctrl.pagination.pageSize = res.pageSize || ctrl.pagination.pageSize;

                    console.log("CAUTARE SQL ARHIVA: " + res.sqlQuery);
                });
            };


            // Results
            ctrl.results = [];
            ctrl.selectedUuid = null;

			ctrl.pagination = {
                pageIndex: 0,   // zero-based
                pageSize: 5,   // default items per page
                total: 0
            };

            ctrl.totalPages = function () {
                if (!ctrl.pagination.pageSize) return 1;
                return Math.max(1, Math.ceil(ctrl.pagination.total / ctrl.pagination.pageSize));
            };

            ctrl.canPrev = function () {
                return ctrl.pagination.pageIndex > 0;
            };

            ctrl.canNext = function () {
                return (ctrl.pagination.pageIndex + 1) < ctrl.totalPages();
            };

            ctrl.goToPage = function (pageIndex) {
                if (pageIndex < 0 || pageIndex >= ctrl.totalPages()) return;
                ctrl.pagination.pageIndex = pageIndex;
                ctrl.search(false);  // don't reset page when paging
            };

            ctrl.prevPage = function () {
                if (!ctrl.canPrev()) return;
                ctrl.pagination.pageIndex--;
                ctrl.search(false);
            };

            ctrl.nextPage = function () {
                if (!ctrl.canNext()) return;
                ctrl.pagination.pageIndex++;
                ctrl.search(false);
            };

			ctrl.changePageSize = function () {
				ctrl.pagination.pageIndex = 0;
				ctrl.search(false); // reload with new page size
			};


			// Multi-Select
            ctrl.toggleSelect = function (row) {
                if (!row || !row.uuid) return;
            
                var uuid = row.uuid;
            
                // already selected? -> unselect
                if (ctrl.selectedDocs[uuid]) {
                    delete ctrl.selectedDocs[uuid];
                } else {
                    // not selected yet? -> add (store a snapshot if you want)
                    ctrl.selectedDocs[uuid] = angular.copy(row);
                }
            
                console.log("Selected docs map:", ctrl.selectedDocs);
            };

            
            ctrl.isSelected = function (row) {
                if (!row || !row.uuid) return false;
                return !!ctrl.selectedDocs[row.uuid];
            };


            // helper: get an array of uuids when needed
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
            

			$scope.touchAll = function(form) {
				angular.forEach(form.$error, function (fields) {
					angular.forEach(fields, function (field) {
						field.$setTouched();
					});
				});
			};


            // Submit
            ctrl.addSolicitare = function () {
                // 1) Run Angular validation
                $scope.touchAll($scope.frmRetragere);
                if ($scope.frmRetragere.$invalid) {
                    return;
                }
            
                // 2) Collect selected UUIDs from the map { uuid: row }
                var selectedUuids = Object.keys(ctrl.selectedDocs || {});
                if (!selectedUuids.length) {
                    alert("Selecteaza cel putin un rand din tabel.");
                    return;
                }
            
                // 3) One group_id for the whole batch
                var groupId = generateUUID();
                console.log("GROUP ID for this batch:", groupId);
                console.log("Selected UUIDs:", selectedUuids);
            
                // 4) Build payload (common form data + batch uuids)
                var payload = {
                    registrationLetter: "R",
                    tip_operatiune: "Retragere Istoric Arhiva",
                    year: ctrl.model.year,
                    data_inceput: $filter('date')(ctrl.now, 'yyyy-MM-dd HH:mm:ss'),
            
                    motiv_retragere: ctrl.model.motiv_retragere,
                    urgent: ctrl.model.urgent ? "DA" : "NU",
                    modalitate_livrare: ctrl.model.modalitate_livrare,
                    observatii: ctrl.model.observatii,
            
                    group_id: groupId,
                    related_uuids: selectedUuids,
                    // crc: ctrl.model.crc,
                    departament: ctrl.model.departament.nume,
                    // termen_livrare: ctrl.model.termen_livrare
                };
            
                console.log("ADD SOLICITARE BATCH PAYLOAD:", payload);
            
                // 5) Call backend once (batch insert with transaction)
                ArhivareService.createRetragereArhiva(payload).then(function (res) {
                    console.log("BATCH RESPONSE:", res);
            
                    var items = (res && res.items) ? res.items : [];
                    if (!items.length) {
                        alert("Nu au fost inregistrate solicitari (raspuns gol).");
                        return;
                    }
            
                    var numbers = items.map(function (it) {
                        return it.numar_comanda || ("R" + ctrl.model.year + "-#####");
                    });
            
                    if (numbers.length === 1) {
                        alert(
                            "Solicitarea a fost inregistrata:\n" +
                            numbers[0] + "\n\n" +
                            "Group ID: " + groupId
                        );
                    } else {
                        alert(
                            "Au fost inregistrate " + numbers.length +
                            " solicitari in grupul:\n" + groupId + "\n\n" +
                            numbers.join("\n")
                        );
                    }
            
                    // 6) Clear selection after success
                    ctrl.anuleazaSolicitare();
            
                }, function (err) {
                    console.error("Eroare la inregistrarea batch-ului de solicitari:", err);
                    alert("A aparut o eroare la inregistrarea solicitarilor. Niciun rand nu a fost salvat (Inregistrarea a fost anulata).");
                });
            };
            
            

            ctrl.anuleazaSolicitare = function () {
                ctrl.model = {
                    year: now.getFullYear(),
                    motiv_retragere: null,
                    urgent: false,
                    modalitate_livrare: null,
            
                    data_inceput_op: '>=',
                    data_sfarsit_op: '<=',
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
                $timeout(function () {
                    if ($scope.frmRetragere) {
                        $scope.frmRetragere.$setPristine();
                        $scope.frmRetragere.$setUntouched();
                    }
                }, 0);
            };            

            ctrl.$onInit = function () {
                console.log("RetragereArhiva");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_departament]", "optiuniDepartament");
                ctrl.now = new Date();
                // initial group with one filter
                //ctrl.addAndGroup();
                ctrl.search(true);
            };
        }
    ]);

}());
