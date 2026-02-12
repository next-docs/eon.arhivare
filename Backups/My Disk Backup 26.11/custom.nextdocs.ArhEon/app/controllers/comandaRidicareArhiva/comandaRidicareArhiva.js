(function() {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.controller('ComandaRidicareArhiva', [
        '$scope', '$filter', 'ModalDialogService', 'FileService', '$timeout', 'AuditService', '$rootScope', 'ArhivareService',
        function($scope, $filter, ModalDialogService, FileService, $timeout, AuditService, $rootScope, ArhRidicareService) {
            var ctrl = this;

            ctrl.generateGuid = function() {
                return 'xxxxxxxx-xxxx-xxxx-yxxx-xxxxxxxxxxxx'
                    .replace(/[xy]/g, function(c) {
                        const r = Math.random() * 16 | 0,
                            v = c == 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
            }

            ctrl.initModel = function(initAll) {
				$timeout(function() {
					if(initAll){
						ctrl.group_id = ctrl.generateGuid();
						ctrl.numar_inregistrare = "A" + new Date().getFullYear() + "-" + "####";
						ctrl.companie = "E-ON Energie Romania";
						ctrl.data_inregistrare = getFormattedDateTime();
						ctrl.status = "Solicitata";

						ctrl.comenzi = [];
					}

					ctrl.comanda = {
						numar_inregistrare: ctrl.numar_inregistrare,
						companie: ctrl.companie,
						data_inregistrare: ctrl.data_inregistrare,
						status: ctrl.status,
						group_id: ctrl.group_id
					};
					
					ctrl.departamentSelectat = null;
					ctrl.crcSelectat = null;
					ctrl.punctColectareAlteDocSelectat = null;
					
					ctrl.submitted = false;
					ctrl.indexComandaEdit = -1;
				}, 50);
            }

            ctrl.pagination = {
                pageIndex: 0, // zero-based
                pageSize: 5, // default items per page
                total: 0
            };

            ctrl.getPagedComenzi = function() {
                if (!ctrl.comenzi) return [];

                const start = ctrl.pagination.pageIndex * ctrl.pagination.pageSize;
                const end = start + ctrl.pagination.pageSize;

                return ctrl.comenzi.slice(start, end);
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
                ctrl.getPagedComenzi();
            };

            ctrl.prevPage = function() {
                if (!ctrl.canPrev()) return;
                ctrl.pagination.pageIndex--;
                ctrl.getPagedComenzi();
            };

            ctrl.nextPage = function() {
                if (!ctrl.canNext()) return;
                ctrl.pagination.pageIndex++;
                ctrl.getPagedComenzi();
            };

            ctrl.changePageSize = function() {
                ctrl.pagination.pageIndex = 0;
                ctrl.getPagedComenzi();
            };

            //--- Config ---//
            let cfg = api.helpers.Configuration.get("arh"); // keep for later if needed
            //--------------//

            var getFormattedDateTime = function() {
                const now = new Date();

                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();

                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');

                return `${day}.${month}.${year} ${hours}:${minutes}`;
            }

            // Static options
            ctrl.optiuniStatus = [];
            ctrl.optiuniTipArhiva = [];
            ctrl.optiuniDepartament = [];
            ctrl.optiuniPunctColectareCRC = [];
            ctrl.optiuniPunctColectareAlteDocumente = [];

            // UI model
            ctrl.initModel(true);

            ctrl.adaugaComanda = function() {
                ctrl.submitted = true;

                if (!ctrl.comanda.tip_arhiva ||
                    (ctrl.comanda.tip_arhiva === 'Cutie' && (!ctrl.comanda.numar_buc || ctrl.comanda.numar_buc <= 0)) ||
                    !ctrl.comanda.departament ||
                    !ctrl.comanda.crc) {
                    return;
                }

                if (!ctrl.comenzi)
                    ctrl.comenzi = [];

                ctrl.comenzi.push(angular.copy(ctrl.comanda));

                ctrl.initModel();
            };

            ctrl.editeazaComanda = function(comanda) {
                ctrl.comanda = angular.copy(comanda);
                ctrl.indexComandaEdit = ctrl.comenzi.indexOf(comanda);
            };

            ctrl.anuleazaEditareComanda = function() {
                ctrl.initModel();
            }

            ctrl.salveazaEditareComanda = function() {
                ctrl.submitted = true;

                if (!ctrl.comanda.tip_arhiva ||
                    (ctrl.comanda.tip_arhiva === 'Cutie' && (!ctrl.comanda.numar_buc || ctrl.comanda.numar_buc <= 0)) ||
                    !ctrl.comanda.departament ||
                    !ctrl.comanda.crc) {
                    return;
                }


                ctrl.comenzi[ctrl.indexComandaEdit] = angular.copy(ctrl.comanda);

                ctrl.initModel();
            }

            ctrl.stergeComanda = function(comanda) {
                const index = ctrl.comenzi.indexOf(comanda);
                if (index !== -1) {
                    ctrl.comenzi.splice(index, 1);
                }
            }

            // Submit
            ctrl.inregistreazaComenzi = function() {
                if (!ctrl.comenzi || ctrl.comenzi.length == 0) {
                    alert('Nicio comanda adaugata.');
                    return;
                }
				
				var res = confirm("Inregistrati comanda?");

                if (res) {
					//ctrl.model.data_inregistrare = getFormattedDateTime();
					var payload = angular.copy(ctrl.comenzi);

					ArhRidicareService.createRidicareArhiva(payload).then(function(res) {
						if (res && res.numere_generate && Array.isArray(res.numere_generate)) {
							var listaNumere = "\n" + res.numere_generate.join(',\n'); // Alătură numerele într-un string
							alert('Solicitarea a fost înregistrată: ' + listaNumere);
						} else {
							alert('Nicio solicitare inregistrata.');
						}
						ctrl.initModel(true);
					});
				
                }
            };

            // Cancel
            ctrl.anuleazaComanda = function() {
                var res = confirm("Sigur doriti sa anulati?");

                if (res) {
                    ctrl.initModel(true);
                }
            }

            // SearchNomenclator
            ctrl.searchNomenclator = function(nume_tabela, data) {
                var params = {
                    nume_tabela: nume_tabela
                };

                console.log("SEARCH NOMENCLATOR PARAMS:", params);

                ArhRidicareService.searchNomenclator(params).then(function(res) {
                    // res: { rows }
                    ctrl[data] = res.rows || [];
                });
            };

            ctrl.$onInit = function() {
                console.log("RetragereArhiva");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_ridicare_arhiva_status]", "optiuniStatus");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_tip_arhiva]", "optiuniTipArhiva");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_departament]", "optiuniDepartament");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_punct_colectare_crc]", "optiuniPunctColectareCRC");
                ctrl.searchNomenclator("[Lucru_EON].[dbo].[arh_punct_colectare_alte_documente]", "optiuniPunctColectareAlteDocumente");
            };

            $scope.$watch(
                function() {
                    return ctrl.comenzi;
                },
                function(newValue, oldValue) {
                    if (newValue) {
                        ctrl.pagination.total = newValue.length;
                    }
                },
                true
            );
        }
    ]);

}());