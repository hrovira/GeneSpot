define(["jquery", "underscore", "backbone", "bootstrap", "views/topbar_view",
        "views/gs/atlas", "models/atlas/map_factory", "backbone_gdrive",
        "views/workdesk/workdesk", "views/workdesk/workbook", "views/workdesk/dataset"],
    function ($, _, Backbone, Bootstrap, TopNavBar, AtlasView, MapFactory, BackboneGDrive, WorkdeskView, WorkbookView, DatasetView) {

        return Backbone.Router.extend({
            targetEl: "#main-container",
            navigationEl: "#navigation-container",
            routes: {
                "": "atlas",
                "wd": "empty_workdesk",
                "wd/:workdesk_id": "workdesk",
                "wb/new": "new_workbook",
                "wb/:workbook_id": "workbook",
                "dataset/new": "new_dataset",
                "dataset/:dataset_id": "dataset",
                "cm/:cm_id": "load_collected_map",
                "v/*uri/:view_name": "viewsByUri",
                "s/*sessionId": "loadSessionById"
            },
            views: {},

            initialize: function (options) {
                if (options) _.extend(this, options);
                _.bindAll(this, "start", "loadSessionById");
                this.$el = $(this.targetEl);
                this.$nav = $(this.navigationEl);
            },

            start: function () {
                this.$nav.append(new TopNavBar().render().el);

                Backbone.history.start();

                WebApp.Events.trigger("webapp:ready:router");
            },


            loadSessionById: function (sessionId) {
                if (!_.isEmpty(sessionId)) {
                    var selectedSession = _.find(WebApp.Sessions.All.models, function (m) {
                        return _.isEqual(m.get("id"), sessionId);
                    });
                    if (selectedSession) {
                        WebApp.Sessions.Active = selectedSession;
                        var route = selectedSession.get("route");
                        if (!_.isEmpty(route)) {
                            this.navigate(route, {trigger: true});
                        }
                    }
                }
            },

            home_view: function () {
                // TODO
            },

            fetchAnnotations: function (catalog_key) {
                if (_.isEmpty(WebApp.Annotations[catalog_key])) {
                    var annotations = new WebApp.Annotations({});
                    annotations.fetch({
                        "url": "svc/datastores/annotations/" + catalog_key,
                        "async": false,
                        "dataType": "json",
                        "success": function () {
                            WebApp.Annotations[catalog_key] = annotations.get("itemsById");
                        }
                    });
                }
                return WebApp.Annotations[catalog_key];
            },

            viewsByUri: function (uri, view_name, options) {
                // 1. Lookup model specification(s) for datamodel(s)
                var modelspecs = WebApp.Datamodel.find_modelspecs(uri);
                if (_.isUndefined(modelspecs) || !_.has(modelspecs, "single")) {
                    console.log("webapp:router:uri_not_found:" + uri);
                    return;
                }

                var modelspec = modelspecs["single"];
                var _this = this;
                var createViewFn = function (Model) {
                    // NOTE: May seem out of order, but is called after modelspec is turned to model
                    // 3. Create view
                    var model = new Model(modelspec);

                    var ViewClass = WebApp.Views[view_name];
                    var view = new ViewClass(_.extend({ "model": model }, options));
                    _this.$el.html(view.render().el);

                    // 4. Fetch data and load model
                    _.defer(function () {
                        model.fetch({
                            "url": model.get("url") + (model.get("url_prefix") || ""),
                            "data": options,
                            "traditional": true,
                            "success": function () {
                                model.trigger("load");
                            }
                        });
                    });
                };

                // 2. Create model(s) from model specifications
                if (modelspec["model"]) {
                    require([modelspec["model"]], createViewFn);
                } else {
                    createViewFn(Backbone.Model);
                }
            },

            "empty_workdesk": function () {
                var WGW = WebApp.GDrive.Workdesk;
                var carryOn = function() {
                    WebApp.Router.navigate("#wd/" + WGW.get("id"), { "trigger": true });
                };

                if (_.isEmpty(WGW.get("id"))) {
                    WGW.once("change", carryOn, this);
                    return WGW.find();
                }

                _.defer(carryOn);
            },

            "workdesk": function (workdesk_id) {
                console.debug("router.workdesk:" + workdesk_id);

                var WGW = WebApp.GDrive.Workdesk;
                if (!_.isEqual(WGW.get("id"), workdesk_id)) {
                    WGW.clear();
                    WGW.set("id", workdesk_id);
                }

                var view = new WorkdeskView({ "model": WGW });
                this.$el.html(view.render().el);

                WGW.once("change", function () {
                    this.$el.fadeIn();
                }, this);

                WGW.fetch();
            },

            "new_workbook": function () {
                console.debug("router.new_workbook");

                var model = new BackboneGDrive.FileModel({
                    "title": "Untitled Workbook",
                    "mimeType": "application/vnd.genespot.workbook"
                });

                var setParent = function() {
                    var id = WebApp.GDrive.Workdesk.get("id");
                    if (_.isEmpty(id)) return;

                    model.set({
                        "parents": [
                            { "id": WebApp.GDrive.Workdesk.get("id"), "kind": "drive#fileLink" }
                        ]
                    });
                };
                WebApp.GDrive.Workdesk.on("change:id", setParent);
                _.defer(setParent);

                var view = new WorkbookView({ "model": model });
                this.$el.html(view.render().el);
                this.$el.fadeIn();

                model.trigger("load");
            },

            "workbook": function (workbook_id) {
                console.debug("router.workbook:" + workbook_id);

                if (_.isEmpty(workbook_id)) {
                    return _.defer(this.new_workbook);
                }

                var model = new BackboneGDrive.FileModel({ "id": workbook_id });
                var view = new WorkbookView({ "model": model });
                this.$el.html(view.render().el);

                _.defer(model.payload);
                model.once("change", function() {
                    this.$el.fadeIn();
                }, this);
                model.fetch();

                WebApp.GDrive.Changes.on("change:items", function () {
                    _.each(WebApp.GDrive.Changes.get("items"), function(item) {
                        if (_.isEqual(item["fileId"], model.get("id")))  {
                            if (_.has(item, "file")) {
                                model.set(item["file"]);
                            } else {
                                _.defer(model.fetch);
                            }
                        }
                    }, this);
                }, this);
            },

            "new_dataset": function () {
                console.debug("router.new_dataset");

                var model = new BackboneGDrive.FileModel({
                    "title": "Untitled Dataset 3",
                    "mimeType": "application/vnd.genespot.dataset"
                });

                var setParent = function() {
                    var id = WebApp.GDrive.Workdesk.get("id");
                    if (_.isEmpty(id)) return;

                    model.set({
                        "parents": [
                            { "id": WebApp.GDrive.Workdesk.get("id"), "kind": "drive#fileLink" }
                        ]
                    });
                };
                WebApp.GDrive.Workdesk.on("change:id", setParent);
                WebApp.GDrive.Workdesk.find();

                var view = new DatasetView({ "model": model });
                this.$el.html(view.render().el);
                this.$el.fadeIn();

                model.trigger("load");
            },

            "dataset": function (dataset_id) {
                console.debug("router.dataset:" + dataset_id);

                if (_.isEmpty(dataset_id)) {
                    return _.defer(this.new_dataset);
                }

                var model = new BackboneGDrive.FileModel({ "id": dataset_id });
                var view = new DatasetView({ "model": model });
                this.$el.html(view.render().el);

                _.defer(model.payload);
                model.once("change", function() {
                    this.$el.fadeIn();
                }, this);
                model.fetch();

                WebApp.GDrive.Changes.on("change:items", function () {
                    _.each(WebApp.GDrive.Changes.get("items"), function(item) {
                        if (_.isEqual(item["fileId"], model.get("id")))  {
                            if (_.has(item, "file")) {
                                model.set(item["file"]);
                            } else {
                                _.defer(model.fetch);
                            }
                        }
                    }, this);
                }, this);
            },

            atlas: function () {
                var model = new MapFactory();
                var view = new AtlasView({ "model": model });

                var _this = this;
                this.$el.fadeOut({
                    "always": function() {
                        model.fetch({
                            "url": "configurations/atlas.json",
                            "success": function () {
                                _this.$el.html(view.render().el);
                                model.trigger("load");

                                _this.$el.fadeIn();
                            }
                        });
                    }
                });

                return view;
            },

            load_collected_map: function (collected_map_id) {
                console.debug("router.load_collected_map:" + collected_map_id);

                var model = new MapFactory();
                var view = new AtlasView({ "model": model });

                var _this = this;
                this.$el.fadeOut({
                    "always": function() {
                        model.fetch({
                            "url": "svc/collections/collected_maps/" + collected_map_id,
                            "success": function () {
                                _this.$el.html(view.render().el);
                                model.trigger("load");

                                _this.$el.fadeIn();
                            },
                            "error": _this.atlas
                        });
                    }
                });

                return view;
            }
        });
    });
