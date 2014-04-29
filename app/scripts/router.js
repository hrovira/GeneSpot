define(["jquery", "underscore", "backbone", "bootstrap", "views/topbar_view",
        "views/gs/atlas", "models/atlas/map_factory", "models/gdriveapi_backbone_model", "views/workbooks/workdesk", "views/workbooks/workbook"],
    function ($, _, Backbone, Bootstrap, TopNavBar, AtlasView, MapFactory, GDriveApiBackboneModel, WorkdeskView, WorkbookView) {

        return Backbone.Router.extend({
            targetEl: "#main-container",
            navigationEl: "#navigation-container",
            routes: {
                "": "atlas",
                "wd": "new_workdesk",
                "wd/:workdesk_id": "workdesk",
                "wd/:workdesk_id/new": "new_workbook",
                "wb/:workbook_id": "workbook",
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

                this.workdesk_model = new GDriveApiBackboneModel({
                    "title": "GeneSpot Workdesk",
                    "kind": "drive#file",
                    "parents": [
                        { "id": "root" }
                    ],
                    "mimeType": "application/vnd.google-apps.folder"
                });

                this.changes_model = new GDriveApiBackboneModel({ "kind": "drive#change"});
                this.changes_model.monitor();
                this.changes_model.on("change", function (file) {
                    if (_.isEqual(file["id"], this.workdesk_model.get("id"))) {
                        this.workdesk_model.set(file);
                    }
                }, this);
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

            "new_workdesk": function () {
                console.debug("router.new_workdesk");

                var renderFn = _.bind(function () {
                    this.navigate("#wd/" + this.workdesk_model.get("id"), { "trigger": true });
                }, this);

                this.workdesk_model.find_insert(
                    { "title": this.workdesk_model.get("title") },
                    { "success": renderFn }
                );
            },

            "workdesk": function (workdesk_id) {
                console.debug("router.workdesk:" + workdesk_id);

                var view = new WorkdeskView({ "model": this.workdesk_model });

                var renderFn = _.bind(function () {
                    this.$el.html(view.render().el);
                    this.$el.fadeIn();
                    this.workdesk_model.trigger("load");
                }, this);

                this.workdesk_model.set("id", workdesk_id);
                this.workdesk_model.drive_get({ "success": renderFn });
            },

            "new_workbook": function(workdesk_id) {
                console.debug("router.new_workbook:" + workdesk_id);

                var model = new GDriveApiBackboneModel({
                    "title": "Untitled Workbook",
                    "kind": "drive#file",
                    "mimeType": "application/vnd.genespot.workbook",
                    "parents": [ { "id": workdesk_id, "kind": "drive#fileLink" } ]
                });

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

                var model = new GDriveApiBackboneModel({ "id": workbook_id, "kind": "drive#file" });
                var view = new WorkbookView({ "model": model });
                this.$el.html(view.render().el);

                model.drive_get({
                    "success": _.bind(function() {
                        this.$el.fadeIn();
                    }, this),
                    "error": _.bind(function(){
                        this.$(".alert.workbook-not-found").show();
                    }, this)
                });

                this.changes_model.on("change", function (file) {
                    if (_.isEqual(file["id"], model.get("id"))) {
                        model.set(file);
                        _.defer(model.fetch_payload);
                    }
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
