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
        // === ACCESS CHECK ===
        var cfg = api.helpers.Configuration.get("arh");
        var arhivatorGroupId = cfg.arhivatorGroupId; //12 - dev03
        var isArhivator = userHasRole(arhivatorGroupId);

        // expose info on rootScope
        $rootScope.userRole = isArhivator ? "Arhivator" : null;
        $rootScope.isSimpleUser = !isArhivator;

        if (!isArhivator) {
            // Avoid redirect loop if you're already on the denied page
            var path = window.location.pathname || "";
            if (!/resources\/accessDenied\.html$/i.test(path)) {
                // redirect to your static "Access denied" page
                window.location.href = "resources/accessDenied.html";
            }
            return; // stop running the rest of the app init
        }

        custom.nextdocs.ArhEon.app.url = window.location.href;

        
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


    function userHasRole(groupId) {
        var login = api.IX.getLoginResult();
        var roles = (login && login.user && login.user.groupList) || [];

        return roles.some(x => parseInt(x) === groupId);
    }

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
