define([
    "jquery", "underscore", "backbone",
    "hbs!templates/gs/atlas",
    "hbs!templates/gs/maps_list_container",
    "views/gs/atlas_map",
    "views/genes/control",
    "views/clinvarlist/control",
    "views/gs/tumor_types_control",
    "views/datamodel_collector/control",
    "views/collected_maps/control",
    "views/datasheets/control"
],
    function ($, _, Backbone, AtlasTpl, MapsListContainerTpl, AtlasMapView,
              GenelistControl, ClinicalListControl, TumorTypesControl, DatamodelCollectorControl, CollectedMapsControl,
              DatasheetsControl) {

        return Backbone.View.extend({
            "datasheetsControl": new DatasheetsControl({}),
            "last-z-index": 10,
            "lastPosition": {
                "top": 0, "left": 0
            },

            events: {
                "click .refresh-loaded": "__reload_all_maps",
                "click .list-controls li a": function(e) {
                    this.$el.find(".list-container.collapse.in").collapse("hide");
                },
                "click .open-map": function (e) {
                    this.$el.find(".list-container.collapse.in").collapse("hide");

                    var map_id = $(e.target).data("id");
                    var map_template = this.model.get("map_templates").get(map_id);
                    this.__append_atlasmap(map_template);

                    var openMaps = (localStorage.getItem("open-maps") || "").split(",");
                    openMaps.push(map_id);
                    localStorage.setItem("open-maps", _.unique(openMaps));
                },
                "click div.atlas-map": function (e) {
                    this.$el.find(".list-container.collapse.in").collapse("hide");

                    var $target = $(e.target);
                    if (!$target.hasClass("atlas-map")) {
                        $target = $(e.target).parents(".atlas-map");
                    }

                    $target.css("z-index", this.__next_z_index());
                }
            },

            initialize: function () {
                _.bindAll(this, "__append_atlasmap", "__reload_all_maps");

                this.model = this.options.model;
                this.model.set("atlas_map_views", []);
                this.model.on("load", this.__init_genelist_control, this);
                this.model.on("load", this.__init_clinicallist_control, this);
                this.model.on("load", this.__init_tumortypes_control, this);
                this.model.on("load", this.__init_datamodel_collector, this);
//                this.model.on("load", this.__init_collected_maps_control, this);
                this.model.on("load", this.__init_datasheets_control, this);

                WebApp.Sessions.Producers["atlas_maps"] = this;
            },

            render: function() {
                this.$el.html(AtlasTpl());
                return this;
            },

            __init_genelist_control: function() {
                this.genelistControl = new GenelistControl({ "default_genelist": this.model.get("default_genelist") });
                this.genelistControl.on("ready", this.__init_maps, this);
                this.genelistControl.on("updated", function (ev) {
                    console.debug("atlas.__init_genelist_control:updated:" + JSON.stringify(ev));
                    if (ev["reorder"]) {
                        console.debug("atlas.__init_genelist_control:updated:reorder:ignore");
                        return;
                    }

                    this.__reload_all_maps();
                }, this);

                this.$el.find(".genelist-container").html(this.genelistControl.render().el);
            },

            __init_clinicallist_control: function() {
                this.clinicalListControl = new ClinicalListControl({});
                this.clinicalListControl.on("updated", function (ev) {
                    console.debug("atlas.__init_clinicallist_control:updated:" + JSON.stringify(ev));
                    if (ev["reorder"]) {
                        console.debug("atlas.__init_clinicallist_control:updated:reorder:ignore");
                        return;
                    }

                    this.__reload_all_maps();
                }, this);

                this.$el.find(".clinvarlist-container").html(this.clinicalListControl.render().el);
            },

            __init_collected_maps_control: function() {
                this.collectedMapsControl = new CollectedMapsControl({});
                this.collectedMapsControl.on("selected", function (ev) {
                    console.debug("atlas.__init_collected_maps_control:selected:" + JSON.stringify(ev));
                }, this);
                this.$el.find(".collected-maps-container").html(this.collectedMapsControl.render().el);
            },

            __init_datasheets_control: function() {
                this.$el.find(".datasheets-container").html(this.datasheetsControl.render().el);
            },

            __init_tumortypes_control: function() {
                this.tumorTypesControl = new TumorTypesControl({});
                this.$el.find(".tumor-types-container").html(this.tumorTypesControl.render().el);
            },

            __init_datamodel_collector: function() {
                this.datamodelCollectorControl = new DatamodelCollectorControl({});

                var reloadFn = _.debounce(this.__reload_all_maps, 1000);
                this.datamodelCollectorControl.on("updated", reloadFn, this);
                this.$el.find(".datamodel-collector-container").html(this.datamodelCollectorControl.render().el);
            },

            __init_maps: function () {
                var open_maps = this.model.get("map_templates").values();

                var remembered_open = _.compact((localStorage.getItem("open-maps") || "").split(","));

                var maps = _.map(open_maps, function(map_template) {
                    if (!_.isEmpty(remembered_open)) {
                        map_template.set("isOpen", _.contains(remembered_open, map_template.get("id")));
                    }

                    if (map_template.get("isOpen")) _.defer(this.__append_atlasmap, map_template);

                    if (!map_template.get("disabled")) {
                        var openMapFn = this.__append_atlasmap;
                        var map_label = map_template.get("label");
                        var view_labels = _.pluck(map_template.get("views") || [], "label");
                        var map_keywords = map_template.get("keywords") || [];
                        WebApp.Search.add_callback("Visualizations", map_label, _.flatten([view_labels, map_keywords]), function() {
                            _.defer(openMapFn, map_template);
                        });
                    }
                    return map_template.toJSON();
                }, this);

                var marked_open = _.where(maps, { "isOpen": true });
                localStorage.setItem("open-maps", _.unique(_.pluck(marked_open, "id")));

                this.$el.find(".maps-list-container").html(MapsListContainerTpl({ "maps": _.sortBy(_.sortBy(maps, "label"), "order") }));
            },

            __append_atlasmap: function (map_template) {
                console.debug("atlas.__append_atlasmap");

                var gene_list = this.genelistControl.get_current();
                var tumor_type_list = _.pluck(WebApp.UserPreferences.get("selected_tumor_types"), "id");
                var clinvar_list = this.clinicalListControl.get_current() || [];

                var views = _.map(map_template.get("view_templates"), function(view_template) {
                    return view_template.spin({
                        "genes": gene_list,
                        "tumor_types": tumor_type_list,
                        "clinical_variables": clinvar_list,
                        "datasheets_control": this.datasheetsControl
                    });
                }, this);

                var atlasMapView = new AtlasMapView(_.extend(map_template.toJSON(), {
                    "isOpen": true,
                    "assignedPosition": map_template.get("position") || this.__next_position(),
                    "assignedZindex": map_template.get("zindex") || this.__next_z_index(),
                    "views": views
                }));
                atlasMapView.on("refresh", this.__reload_map_views, this);
                atlasMapView.on("collect", this.__collect_map, this);

                _.each(views, function(view) {
                    this.__assemble_query(view, gene_list, tumor_type_list, clinvar_list);
                }, this);

                this.model.get("atlas_map_views").push(atlasMapView);
                this.$el.find(".atlas-canvas").append(atlasMapView.render().el);

                _.each(views, this.__fetch_model_data, this);
            },

            __reload_all_maps: function() {
                console.debug("atlas.__reload_all_maps");
                _.each(this.model.get("atlas_map_views"), this.__reload_map_views, this);
            },

            __reload_map_views: function (atlasMapView) {
                if (!atlasMapView.options["isOpen"]) return;

                console.debug("atlas.__reload_map_views:" + atlasMapView.id);

                var gene_list = this.genelistControl.get_current();
                var tumor_type_list = _.pluck(WebApp.UserPreferences.get("selected_tumor_types"), "id");
                var clinvar_list = this.clinicalListControl.get_current() || [];

                _.each(atlasMapView["views"], function(view) {
                    view.options = _.extend(view.options, {
                        "genes": gene_list,
                        "tumor_types": tumor_type_list,
                        "clinical_variables": clinvar_list
                    });
                }, this);

                _.each(atlasMapView["views"], function(view) {
                    this.__assemble_query(view, gene_list, tumor_type_list, clinvar_list);
                }, this);

                atlasMapView.render();

                _.each(atlasMapView["views"], this.__fetch_model_data, this);
            },

            __assemble_query: function(view, gene_list, tumor_type_list, clinvar_list) {
                console.debug("atlas.__assemble_query");
                if (!_.has(view.options, "all_models")) return;

                _.each(view.options["all_models"], function(model) {
                    var data = model["base_query"] || {};
                    if (!model["tumor_type"]) data["cancer"] = tumor_type_list;

                    model["do_fetch"] = true;
                    if (model["query_clinical_variables"]) {
                        if (_.isEmpty(clinvar_list)) {
                            model["do_fetch"] = false;
                            return;
                        }
                        data["id"] = _.pluck(clinvar_list, "id");
                    } else if (!model["query_all_genes"]) {
                        data["tags"] = gene_list;
                    }

                    model["query"] = data;
                });
            },

            __fetch_model_data: function(view) {
                console.debug("atlas.__fetch_model_data");
                if (!_.has(view.options, "all_models")) return;

                _.each(view.options["all_models"], function(model) {
                    _.defer(function () {
                        if (model["do_fetch"] === false) {
                            model.trigger("load");
                            return;
                        }

                        model.fetch({
                            "url": model["url"],
                            "data": model["query"],
                            "traditional": true,
                            "success": function () {
                                model.trigger("load");
                            }
                        });
                    });
                });
            },

            __next_z_index: function () {
                var nextOne = 1 + this["last-z-index"];
                this["last-z-index"] = nextOne;
                return nextOne;
            },

            __next_position: function () {
                var lastPos = {
                    "left": this.lastPosition.left + 50,
                    "top": this.lastPosition.top + 50
                };
                this.lastPosition = lastPos;
                return lastPos;
            },

            __collect_map: function(atlasMapView) {
                console.debug("atlas.__collect_map:" + atlasMapView.id);

                var collectedMap = _.omit(atlasMapView.options, "assignedPosition", "assignedZindex", "view_classes", "view_templates", "views");
                collectedMap["views"] = _.map(atlasMapView.options["views"], function(v) {
                    return _.omit(v.options, "id", "all_models", "model", "models", "model_templates", "view_class");
                });

                this.collectedMapsControl.add_to_current(collectedMap);
            },

            currentState: function () {
                var openMaps = _.map(this.$el.find(".atlas-map"), function (map) {
                    var mapid = $(map).data("mapid");
                    var top = map.style["top"].replace("px", "");
                    var left = map.style["left"].replace("px", "");
                    var zindex = map.style["z-index"];
                    return { "id": mapid, "isOpen": true, "position": { "top": top, "left": left }, "zindex": zindex };
                });

                var tumor_type_list = _.pluck(WebApp.UserPreferences.get("selected_tumor_types"), "id");
                return {
                    "genes": this.genelistControl.get_current(),
                    "tumor_types": tumor_type_list,
                    "maps": openMaps
                }
            }
        });
    });