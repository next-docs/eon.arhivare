(function () {
    'use strict';

    api.namespace('custom.nextdocs.ArhEon');
    api.namespace('custom.nextdocs.ArhEon.app');

    custom.nextdocs.ArhEon.app = angular.module(
        'custom.nextdocs.ArhEon',
        [
            'api.module.Components',
            'api.module.Components.Lists',
            'ngFileUpload',
            'ui.select',
            'ngSanitize',
            'ng',
            'api.module.RegistraturaServices',
            'api.module.ArhivareServices'
        ]);

    custom.nextdocs.ArhEon.app.url = null;

    custom.nextdocs.ArhEon.app.run(['$rootScope', '$location', '$timeout', function ($rootScope, $location, $timeout) {
        custom.nextdocs.ArhEon.app.url = window.location.href;

        var cfg = api.helpers.Configuration.get("arh");
        const prefix = cfg.links.repoLink;
        let parentUrl = "";

        $rootScope._currentUserId = api.IX.getUserId();
		$rootScope._currentUserName = api.IX.getUserName();

        try {
            parentUrl = window.parent.location.href;
        } catch (e) {
            console.warn("No access to parent URL", e);
        }

        if (parentUrl.startsWith(prefix)) {
            const rest = parentUrl.substring(prefix.length).replace(/\/$/, "");
            $rootScope.hideMenu = true;

        }
    }]);

    custom.nextdocs.ArhEon.app.config(['$compileProvider', '$sceDelegateProvider',
        function ($compileProvider, $sceDelegateProvider) {
            $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|elodms):/);
            $compileProvider.debugInfoEnabled(elo.data.server.isDebug);
            $sceDelegateProvider.resourceUrlWhitelist([
                'self',
                elo.data.server.internalIxUrl + '**'
            ]);
        }]);
}());
