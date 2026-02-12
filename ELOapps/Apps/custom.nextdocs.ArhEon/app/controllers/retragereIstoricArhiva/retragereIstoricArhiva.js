(function () {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.controller('RetragereIstoricArhiva', [
        '$scope', '$filter', 'ModalDialogService', 'FileService', '$timeout', 'AuditService', '$rootScope', '$q', 'ArhivareService',
        function ($scope, $filter, ModalDialogService, FileService, $timeout, AuditService, $rootScope, $q, ArhivareService) {
            var ctrl = this;

            //--- Config ---//
            let cfg = api.helpers.Configuration.get("arh"); // reserved for later use
            //--------------//

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
                { key: 'skp', label: 'SKP' },
                { key: 'cod_cutie_obiect', label: 'Cod Cutie' },
                { key: 'Tip_Produs', label: 'Tip Produs' },
                { key: 'Tip_Contract', label: 'Tip Contract' },
                { key: 'Localitate', label: 'Localitate' },
                { key: 'CRC', label: 'CRC' },
                { key: 'sumar', label: 'Sumar' },
                { key: 'tip_doc_cod_arh', label: 'Tip Doc (cod ARH)' },
                { key: 'departament', label: 'Departament' }
            ];

            // SIMPLE COLUMN FILTERS (for inputs under table headers)
            ctrl.columnFilters = {
                skp: '',
                cod_cutie_obiect: '',
                cod_obiect: '',
                Tip_Produs: '',
                Tip_Contract: '',
                Localitate: '',
                CRC: '',
                sumar: '',
                tip_doc_cod_arh: '',
                an_creare: ''
            };

            // max lengths for each editable field
            ctrl.maxLen = {
            skp: 50,
            cod_cutie_obiect: 50,
            cod_obiect: 50,
            Tip_Produs: 255,
            Tip_Contract: 255,
            Localitate: 20,
            CRC: 100,
            sumar: 45,
            tip_doc_cod_arh: 50,
            an_creare: 32
            };

            ctrl.isOverMaxRaw = function (row, field) {
                if (!row || !field) return false;
                var v = row[field];
                if (v === null || v === undefined) return false;
                var s = String(v);
                var m = ctrl.maxLen[field];
                return !!m && s.length > m;
              };
              
              // sticky edit: once true, stays true until row removed from selectedDocs
            ctrl.shouldEdit = function (row, field) {
                if (!row) return false;
                
                row._editSticky = row._editSticky || {};
                
                // if it's over max at any moment, stick it
                if (ctrl.isOverMaxRaw(row, field)) {
                    row._editSticky[field] = true;
                }
                
                // existing rule (empty on select) OR forced sticky
                return !!(row._editAlways && row._editAlways[field]) || !!row._editSticky[field];
            };
              


            // UI model
            const now = new Date();
            ctrl.model = {
                year: now.getFullYear(),
                motiv_retragere: null,
                urgent: false,
                modalitate_livrare: null,

                data_inceput_op: '>=',
                data_sfarsit_op: '<=',

                data_inceput_year: null,
                data_sfarsit_year: null,

                crc: null,
                localitate: null,
                departament: null,
                termen_livrare: null,
                observatii: null,

                status_preview: 'Solicitat'
            };

            // ====== AND / OR FILTER GROUPS ======
            ctrl.selectedDocs = {};
            ctrl.selectedDocsLength = 0;
            ctrl.filterGroups = [];
            ctrl.optiuniDepartament = [];

            ctrl.lockEditableFields = [
                "skp", "cod_cutie_obiect", "cod_obiect", "Tip_Produs", "Tip_Contract",
                "Localitate", "CRC", "sumar", "tip_doc_cod_arh", "an_creare", "cod_nlc", "nume_abonat"
            ];



            ctrl.initEditFlags = function (row) {
                row = row || {};
                row._editAlways = row._editAlways || {};
                row._editSticky = row._editSticky || {};
              
                ctrl.lockEditableFields.forEach(function (f) {
                  row._editAlways[f] = ctrl.isEmpty(row[f]);

                  if (ctrl.isOverMaxRaw(row, f)) row._editSticky[f] = true;
                });
              
                return row;
            };

            ctrl.focusFirstSelectedError = function () {
                // open drawer
                ctrl.showSelectedAccordion = true;
              
                // wait for ng-show + ng-if to render inputs
                $timeout(function () {
                  // search only inside the selected table
                  var root = document.querySelector('.small-table');
                  if (!root) return;
              
                  // Angular will add ng-invalid-maxlength, ng-invalid-required etc.
                  // we focus the first invalid input/select/textarea
                  var el = root.querySelector('input.ng-invalid, select.ng-invalid, textarea.ng-invalid');
                  if (!el) return;
              
                  // ensure it becomes visibly invalid (so red + message show)
                  // for maxlength, it is already invalid. We'll mark touched as well.
                  // Some controls might not have ngModelController accessible, so do a safe focus only.
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.focus();
                }, 0);
              };
              
            

            function trimTo(v, max) {
                if (v === null || v === undefined) return v;
                v = String(v);
                return v.length > max ? v.substring(0, max) : v;
            }

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

            function buildYearBoundary(year, isStart) {
                if (!year) return null;

                var y = parseInt(year, 10);
                if (isNaN(y) || y < 1900 || y > 2100) {
                    return null; // invalid → ignorăm filtrul
                }
                return String(y);
            }

            // SearchNomenclator
            ctrl.searchNomenclator = function (nume_tabela, data) {
                var params = {
                    nume_tabela: nume_tabela
                };

                console.log("SEARCH NOMENCLATOR PARAMS:", params);

                ArhivareService.searchNomenclator(params).then(function (res) {
                    // res: { rows }
                    ctrl[data] = res.rows || [];
                });
            };

            // ====== COLUMN FILTER CHANGE (live filtering like Rapoarte) ======
            let colFilterPromise = null;
            ctrl.onColumnFilterChange = function () {
                // reset page on new filter
                $scope.currentPage = 0;

                if (colFilterPromise) {
                    $timeout.cancel(colFilterPromise);
                }

                colFilterPromise = $timeout(function () {
                    // no validation when typing in column filters
                    ctrl.search(false, false);
                }, 300); // debounce 300ms
            };
            // ==================================================

            // Search Arhiva
            ctrl.search = function (resetPage, validation) {

                if (resetPage) {
                    $scope.currentPage = 0;
                }

                if (validation) {
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
                        // alert("Completeaza valorile pentru filtrele care necesita o valoare.");
                        return;
                    }
                }

                if (!validation) {
                    ctrl.filtersTouched = false;
                }

                // structured groups (dynamic filters)
                var groupedFilters = ctrl.filterGroups.map(function (group) {
                    return group.map(function (f) {
                        return {
                            column: f.column,
                            op: f.op,
                            value: f.value,
                            required: f.required
                        };
                    });
                });

                var params = {
                    dateOpStart: ctrl.model.data_inceput_op,
                    dateStart: buildYearBoundary(ctrl.model.data_inceput_year, true),

                    dateOpEnd: ctrl.model.data_sfarsit_op,
                    dateEnd: buildYearBoundary(ctrl.model.data_sfarsit_year, false),

                    filterGroups: groupedFilters,

                    filters: ctrl.columnFilters,

                    pageIndex: $scope.currentPage,
                    pageSize: $scope.pageSize
                };

                console.log("SEARCH ARHIVA PARAMS:", params);

                ArhivareService.searchIstoricArhiva(params).then(function (res) {
                    var rows = res.rows || [];

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
                    ctrl.selectedDocs[uuid] = ctrl.initEditFlags(angular.copy(row));
                }

                console.log("Selected docs map:", ctrl.selectedDocs);
                $timeout(function () {
                    ctrl.focusFirstSelectedError();
                }, 0);
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


            ctrl.fieldsToCheck = [
                "skp", "cod_cutie_obiect", "cod_obiect",
                "Tip_Produs", "Tip_Contract", "Localitate",
                "CRC", "sumar", "tip_doc_cod_arh", "an_creare",
                "cod_nlc", "nume_abonat"
            ];


            ctrl.rowHasAnyValue = function (row) {
                row = row || {};
                for (var i = 0; i < ctrl.fieldsToCheck.length; i++) {
                    if (!ctrl.isEmpty(row[ctrl.fieldsToCheck[i]])) return true;
                }
                return false;
            };

            // rule: selection exists AND every manual row has at least one field filled
            ctrl.canSubmit = function () {
                var docs = Object.values(ctrl.selectedDocs || {});
                if (!docs.length) return false;

                // only validate manual rows (isNew)
                for (var i = 0; i < docs.length; i++) {
                    if (docs[i] && docs[i].isNew) {
                        if (!ctrl.rowHasAnyValue(docs[i])) return false;
                    }
                }



                return true;
            };

            // Submit
            ctrl.addSolicitare = function () {
                // 1) Run Angular validation
                // ctrl.model.adresa = trimTo(ctrl.model.adresa, 105);
                // ctrl.model.localitate = trimTo(ctrl.model.localitate, 20);
                // ctrl.model.telefon = trimTo(ctrl.model.telefon, 14);
                // ctrl.model.observatii = trimTo(ctrl.model.observatii, 120);

                Object.values(ctrl.selectedDocs || {}).forEach(function (row) {
                    if (!row || !row.isNew) return;

                    // row.skp = trimTo(row.skp, 11);
                    // row.cod_nlc = trimTo(row.cod_nlc, 30);
                    // row.nume_abonat = trimTo(row.nume_abonat, 30);
                });


                $scope.touchAll($scope.frmRetragere);

                if (!ctrl.canSubmit()) {
                    alert("Selecteaza cel putin un rand. Pentru randurile adaugate manual, completeaza macar un camp.");
                    ctrl.showSelectedAccordion = true;
                    return;
                }

                ctrl.isSubmitted = true;



                if ($scope.frmRetragere.$invalid) {
                    // const existaNecompletate = Object.values(ctrl.selectedDocs).some(d =>
                    // 	(d.cod_nlc == null || String(d.cod_nlc).trim() === "") ||
                    // 	(d.nume_abonat == null || String(d.nume_abonat).trim() === "") ||
                    // 	(d.isNew && ((d.skp == null || String(d.skp).trim() === "") || (d.cod_cutie_obiect == null || String(d.cod_cutie_obiect).trim() === "") || (d.cod_obiect == null || String(d.cod_obiect).trim() === "")
                    // 		|| (d.Tip_Produs == null || String(d.Tip_Produs).trim() === "") || (d.Tip_Contract == null || String(d.Tip_Contract).trim() === "") || (d.Localitate == null || String(d.Localitate).trim() === "")
                    // 		|| (d.CRC == null || String(d.CRC).trim() === "") || (d.tip_doc_cod_arh == null || String(d.tip_doc_cod_arh).trim() === "") || (d.data_creare == null || String(d.data_creare).trim() === "")))
                    // );

                    // if (existaNecompletate) {
                    // 	ctrl.showSelectedAccordion = true;
                    // }
                    return;
                }


                var res = confirm("Inregistrati comanda?");

                if (!res) {
                    return
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

                // 5) Call backend once (batch insert with transaction)
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

                    // 6) Clear selection after success
                    ctrl.anuleazaSolicitare(true);

                }, function (err) {
                    console.error("Eroare la inregistrarea batch-ului de solicitari:", err);
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

                    data_inceput_op: '>=',
                    data_sfarsit_op: '<=',

                    data_inceput_year: null,
                    data_sfarsit_year: null,

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
                    if ($scope.frmRetragere) {
                        $scope.frmRetragere.$setPristine();
                        $scope.frmRetragere.$setUntouched();
                    }
                }, 0);
            };

            ctrl.addNew = function () {
                var guid = generateUUID();

                ctrl.selectedDocs[guid] = ctrl.initEditFlags({ isNew: true });
            }

            ctrl.$onInit = function () {
                console.log("RetragereArhiva");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_departament_recurenta_si_istoric]", "optiuniDepartament");
                ctrl.now = new Date();
                ctrl.filtersTouched = false;
                ctrl.isSubmitted = false;
                ctrl.search(true, false);
            };
        }
    ]);

}());
