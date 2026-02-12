(function () {
	"use strict";

	elo.namespace("api.module");
	elo.namespace("elo.module");

	// populate current route for this module
	api.module.ArhivareServices = {
		relativeUrl: "./modules/" + elo.actualModule.id + "/",
	};

	/**
	 * @class api.module.Components.Sordlist
	 * @ngModule
	 *
	 * AngularJS module holding an ng-grid list of sords with a view button.
	 */
	angular.module("api.module.ArhivareServices", []);
})();
