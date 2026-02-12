(function () {
  'use strict';

  api.namespace('custom.nextdocs.ArhEon');

  api.webapps.WebApp.onLoad = function () { };

  custom.nextdocs.ArhEon.app.controller('ArhEonCtrl', ['$scope', '$rootScope', '$window', 'UserService', function ($scope, $rootScope, $window, UserService) {
    $scope.store = {
      username: api.IX.getUserName()
    };

    $scope.hideMenu = false;
    $scope.isSplitView = false;

    // Initializează currentView din $rootScope sau default
    $scope.currentView = $rootScope.currentView || 'rapoarte';

    // Sincronizează când $rootScope.currentView se schimbă (ex: din run)
    $rootScope.$watch('currentView', function (newVal) {
      if (newVal) {
        $scope.currentView = newVal;
        // $scope.hideMenu = newVal.startsWith('repo_');
      }
    });

    $scope.toggleSplitView = function () {
      if (!$scope.isSplitView && $scope.currentView === 'rapoarte') {
        $scope.loadView('comandaRidicareArhiva');
      }
      $scope.isSplitView = !$scope.isSplitView;
    };

    $scope.loadView = function (viewName) {
      if ($scope.isSplitView && viewName === 'rapoarte') {
        return;
      }
      $scope.currentView = viewName;
      $rootScope.currentView = viewName;
    //   $scope.hideMenu = viewName.startsWith('repo_');
    };

    $scope.getTemplateUrl = function () {
      switch ($scope.currentView) {
        case 'comandaRidicareArhiva': return 'app/controllers/comandaRidicareArhiva/comandaRidicareArhiva.html';
        case 'retragereArhivaRecurenta': return 'app/controllers/retragereArhivaRecurenta/retragereArhivaRecurenta.html';
        case 'retragereIstoricArhiva': return 'app/controllers/retragereIstoricArhiva/retragereIstoricArhiva.html';
        // case 'repo_intrari': return 'views/repo/repo_intrari_documente.html';
        // case 'repo_iesiri': return 'views/repo/repo_iesiri_documente.html';
        // case 'repo_intern': return 'views/repo/repo_uz_intern.html';
        default: return 'app/controllers/rapoarte/rapoarte.html';
      }
    };

    $scope.isActive = function (viewName) {
      return $scope.currentView === viewName;
    };

  }]);

}());
