
(function () {
    'use strict';
    api.namespace('custom.nextdocs.ArhEon');

    custom.nextdocs.ArhEon.app.directive('fileModel', ['$parse', function ($parse) {
        return {
            restrict: 'A',
            link: function (scope, element, attrs) {
                var model = $parse(attrs.fileModel);
                var modelSetter = model.assign;

                element.bind('change', function () {
                    scope.$apply(async function () {
                        var file = element[0].files[0];

                        if (file && file.size > 0) {
                            let reader = new FileReader();

                            reader.onload = function (e) {
                                let base64String = e.target.result.split(',')[1];
                                scope.base64String = base64String;
                            };
                            reader.readAsDataURL(file);
                            modelSetter(scope, file);
                            await scope.updateFileName(file);
                        } else {
                            clearFile();
                            scope.showEmptyFileError();
                        }

                    });
                });

                function clearFile() {
                    element.val(''); // Resets the input file
                    scope.fileName = "No file selected";
                    modelSetter(scope, null); // Clear the model
                }
            }
        };
    }]);


    custom.nextdocs.ArhEon.app.directive('customMaxlength', function () {
        return {
            require: 'ngModel',
            link: function (scope, element, attrs, ngModelCtrl) {

                var atributeMaxLength = scope.$eval(attrs.maxlength);

                ngModelCtrl.$validators.customMaxlength = function (modelValue, viewValue) {
                    var value = modelValue || viewValue;
                    return value.length <= Number(atributeMaxLength - 1);
                };
            }
        };
    });

}());
