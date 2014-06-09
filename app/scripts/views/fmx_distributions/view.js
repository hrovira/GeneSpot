define(["jquery", "underscore", "backbone",
    "models/worksheet_cells",
    "hbs!templates/fmx_distributions/container", "hbs!templates/line_item",
    "hbs!templates/fmx_distributions/feature_defs","hbs!templates/clinvarlist/feature_defs",
    "hbs!templates/fmx_distributions/legend_item", "hbs!templates/fmx_distributions/export_datasheets",
    "carve", "colorbrewer"],
    function ($, _, Backbone, CellsModel, Tpl, LineItemTpl, FeatureDefsTpl, ClinVarFeatureDefsTpl, LegendTpl, ExportDatasheetsTpl, carve) {
        return Backbone.View.extend({
            selected_genes: {},
            selected_features: {},
            selected_tumor_type: null,
            selected_color_by: null,
            feature_definitions: {},
            feature_definitions_by_id: {},
            aggregate_features_by_id: {},
            sample_types_lookup: {},
            latest_data: [],

            events: {
                "click .dropdown-menu.tumor_types_filter a": function (e) {
                    var tumor_type = $(e.target).data("id");
                    if (tumor_type === "all_tumor_types") {
                        console.debug("fmx-dist.selected_tumor_type:all");
                        this.selected_tumor_type = null;
                    } else {
                        console.debug("fmx-dist.selected_tumor_type:" + tumor_type);
                        this.selected_tumor_type = tumor_type;
                    }

                    this.$(".dropdown-menu.tumor_types_filter").find(".active").removeClass("active");
                    $(e.target).parent("li").addClass("active");

                    this.__reset_highlight();
                    _.defer(this.__draw);
                },
                "click .dropdown-menu.sample_types_filter a": function (e) {
                    var sample_type = $(e.target).data("id");
                    if (sample_type === "all_sample_types") {
                        console.debug("fmx-dist.all_sample_types");
                        this.selected_sample_type = null;
                    } else {
                        console.debug("fmx-dist.selected_sample_type:" + sample_type);
                        this.selected_sample_type = sample_type;
                    }

                    this.$(".dropdown-menu.sample_types_filter").find(".active").removeClass("active");
                    $(e.target).parent("li").addClass("active");

                    this.__reset_highlight();
                    _.defer(this.__draw);
                },
                "click .dropdown-menu.color_by_selector a": function(e) {
                    var color_by = $(e.target).data("id");
                    console.debug("fmx-dist.selected_color_by:" + color_by);
                    this.selected_color_by = color_by;
                    if (color_by === "tumor_type") this.selected_color_by = null;

                    this.$(".dropdown-menu.color_by_selector").find(".active").removeClass("active");
                    $(e.target).parent("li").addClass("active");

                    this.__reset_highlight();
                    _.defer(this.__draw);
                },
                "click .dropdown-menu.export_data_selector a": function(e) {
                    var datasheet_id = $(e.target).data("datasheet");
                    var worksheet_id = $(e.target).data("id");
                    console.debug("fmx-dist.export_data_selector:" + datasheet_id + "," + worksheet_id + ":" + this.latest_data.length);
                    var cells = new CellsModel(this.latest_data, { "features": this.selected_features, "id_attribute": "sample" });
                    this.datasheets_control.populate_worksheet(datasheet_id, worksheet_id, cells.get("cells"));
                },
                "click .legend_items a": function (e) {
                    var LI = $(e.target).parent("li");
                    if (LI.hasClass("active")) {
                        console.debug("fmx-dist.highlight:all");
                        LI.removeClass("active");
                        this.carveVis.highlight(null).render();
                    } else {
                        var selected_item = $(e.target).data("id");
                        if (selected_item) {
                            console.debug("fmx-dist.highlight:" + selected_item);
                            this.$(".legend_items").find(".active").removeClass("active");
                            LI.addClass("active");
                            this.carveVis.highlight(selected_item).render();
                        }
                    }
                },
                "click .dropdown-menu.genes-selector-x a": function (e) {
                    console.debug("fmx-dist.genes-x:" + $(e.target).data("id"));
                    this.selected_genes.x = $(e.target).data("id");
                    this.__reset_highlight();
                    this.__render_fLabel_selectors("x");
                },
                "click .dropdown-menu.genes-selector-y a": function (e) {
                    console.debug("fmx-dist.genes-y:" + $(e.target).data("id"));
                    this.selected_genes.y = $(e.target).data("id");
                    this.__reset_highlight();
                    this.__render_fLabel_selectors("y");
                }
            },

            initialize: function () {
                console.debug("fmx-dist.initialize");

                _.bindAll(this, "__load_fdefs_genes", "__load_fdefs_clinvars");
                _.bindAll(this, "__draw", "__init_graph");

                this.model = this.options["models"];
                this.datasheets_control = this.options["datasheets_control"];

                this.__init_sample_types();
            },

            render: function() {
                console.debug("fmx-dist.render");

                _.defer(this.__init_graph);

                this.__init_selected_genes();
                _.each(this.options["tumor_types"], this.__aggregate_sample_types, this);

                this.$el.html(Tpl({
                    "id": this.id,
                    "genes": this.options["genes"],
                    "clinical_variables": this.options["clinical_variables"],
                    "tumor_types": this.options["tumor_types"],
                    "sample_types": this.sample_types,
                    "selected_genes": this.selected_genes
                }));

                this.__draw = _.after(this.options["all_models"].length, this.__draw);
                _.each(this.options["all_models"], function (model) {
                    if (model["query_clinical_variables"]) {
                        if (_.isEmpty(this.options["clinical_variables"])) {
                            _.defer(this.__draw);
                            return;
                        }

                        model.on("load", function () {
                            _.defer(this.__load_fdefs_clinvars, model.tumor_type);
                            _.defer(this.__draw);
                            model.off("load");
                        }, this);
                    } else {
                        model.on("load", function () {
                            _.defer(this.__load_fdefs_genes, model.tumor_type);
                            _.defer(this.__draw);
                            model.off("load");
                        }, this);
                    }
                }, this);

                this.datasheets_control.on("datasheets:loaded", this.__render_datasheets, this);
                return this;
            },

            __init_sample_types: function() {
                console.debug("fmx-dist.__init_sample_types");
                var model = WebApp.Lookups.get("sample_types") || new Backbone.Model();
                this.sample_types = _.map(model.get("definitions"), function(label, key) {
                    return { "label": label, "key": key };
                });
            },

            __init_selected_genes: function () {
                console.debug("fmx-dist.__init_selected_genes");
                this.selected_genes = {
                    "x": _.first(this.options["genes"]),
                    "y": _.first(this.options["genes"])
                };
                if (this.options["genes"].length > 1) this.selected_genes["y"] = this.options["genes"][1];
            },

            __init_graph: function () {
                console.debug("fmx-dist.__init_graph");
                var carvEl = this.$(".graph_element").empty();
                var carvObj = carve({
                    radius: 20,
                    margin: { top: 15, bottom: 20, left: 15, right: 50 }
                });
                this.carveVis = carvObj("#" + this.id + "_vis");
            },

            __load_fdefs_genes: function (tumor_type) {
                console.debug("fmx-dist.__load_fdefs_genes(" + tumor_type + ")");

                var items_by_gene = {};
                var fn = function(k, item) {
                    var arr = items_by_gene[k] || [];
                    arr.push(item);
                    items_by_gene[k] = arr;
                };

                _.each(this.model["gene_features"]["by_tumor_type"][tumor_type].get("items"), function(item) {
                    if (_.has(item, "tags")) {
                        _.each(item["tags"], function(tag) {
                            fn(tag, item);
                        });
                    }
                    if (_.has(item, "gene")) fn(item["gene"], item);
                });

                _.each(items_by_gene, function (item_by_gene, gene) {
                    var fd_by_gene = this.feature_definitions[gene];
                    if (_.isUndefined(fd_by_gene)) fd_by_gene = this.feature_definitions[gene] = {};

                    _.each(_.groupBy(item_by_gene, "source"), function (item_by_source, feature_source) {
                        var fd_by_fsource = fd_by_gene[feature_source];
                        if (_.isUndefined(fd_by_fsource) || _.isEmpty(fd_by_fsource)) {
                            fd_by_fsource = fd_by_gene[feature_source] = [];
                            _.each(item_by_source, function (i_by_s) {
                                fd_by_fsource.push(_.omit(i_by_s, "values"));
                            }, this);
                        }
                    }, this);
                }, this);

                this.__aggregate(tumor_type, this.model["gene_features"]["by_tumor_type"][tumor_type]);
                this.__render_fLabel_selectors("x");
                this.__render_fLabel_selectors("y");
            },

            __load_fdefs_clinvars: function (tumor_type) {
                console.debug("fmx-dist.__load_fdefs_clinvars(" + tumor_type + ")");
                _.each(this.options["clinical_variables"], function(item) {
                    this.feature_definitions_by_id[item.id] = _.extend({}, item);
                }, this);
                this.__aggregate(tumor_type, this.model["clinical_features"]["by_tumor_type"][tumor_type]);
            },

            __aggregate: function(tumor_type, model) {
                console.debug("fmx-dist.__aggregate(" + tumor_type + ")");
                _.each(model.get("items"), function(item) {
                    var a_f_by_id = this.aggregate_features_by_id[item.id];
                    if (!a_f_by_id) a_f_by_id = this.aggregate_features_by_id[item.id] = {};
                    a_f_by_id[tumor_type] = item;
                    this.feature_definitions_by_id[item.id] = _.omit(item, "values");
                }, this);
            },

            __aggregate_sample_types: function(tumor_type) {
                if (this.sample_types_lookup[tumor_type]) return;

                var model = WebApp.Lookups.get("sample_types") || new Backbone.Model();
                var sampleTypes = _.indexBy(model.get("items") || [], "tumor_type");
                if (sampleTypes && _.has(sampleTypes, tumor_type)) {
                    console.debug("fmx-dist.__aggregate_sample_types(" + tumor_type + ")");
                    if (_.has(sampleTypes[tumor_type], "values")) {
                        this.sample_types_lookup[tumor_type] = {};
                        _.each(sampleTypes[tumor_type]["values"], function(sample_type, sample_id) {
                            this.sample_types_lookup[tumor_type][sample_id] = sample_type;
                        }, this);
                    }
                }
            },

            __render_fLabel_selectors: function (axis) {
                console.debug("fmx-dist.__render_fLabel_selectors(" + axis + "):" + this.selected_genes[axis]);
                if (_.isEqual(this.selected_genes[axis], "clinical-variables")) {
                    this.__render_fLabel_selectors_clinvars(axis);
                } else {
                    this.__render_fLabel_selectors_genes(axis);
                }
            },

            __render_fLabel_selectors_genes: function(axis) {
                this.$(".selected-gene-" + axis).html(this.selected_genes[axis]);

                var fd_by_gene = this.feature_definitions[this.selected_genes[axis]];

                var $feature_selector = this.$(".feature-selector-" + axis).empty();

                var uid = Math.round(Math.random() * 10000);
                var fdefs_uid_by_source = {};
                var feature_sources = _.map(_.keys(fd_by_gene || {}), function (source) {
                    var s_uid = uid++ + "-" + axis;
                    fdefs_uid_by_source[source] = s_uid;
                    return { "uid": s_uid, "label": source.toUpperCase(), "item_class": "feature_defs" };
                });
                $feature_selector.append(FeatureDefsTpl({"axis": axis, "feature_sources": feature_sources}));

                _.each(fd_by_gene, function (features, source) {
                    var collapserUL = $feature_selector.find("#tab-pane-" + fdefs_uid_by_source[source]);
                    _.each(_.sortBy(features, "label"), function (feature) {
                        if (!_.isEmpty(feature["label"])) {
                            collapserUL.append(LineItemTpl({ "label": feature["label"], "id": feature["id"], "a_class": "feature-selector-" + axis }));
                        } else if (_.isEqual(feature["source"], "CNVR")) {
                            collapserUL.append(LineItemTpl({ "label": feature["locus"], "id": feature["id"], "a_class": "feature-selector-" + axis }));
                        }
                    });
                });

                var firstFD = $(_.first($feature_selector.find(".feature_defs a")));
                if (firstFD) {
                    this.selected_features[axis] = firstFD.data("id");
                    firstFD.parents("li").addClass("active");
                    firstFD.parents("ul").addClass("active");
                    $("#tab-" + firstFD.parents("ul").data("uid")).parents("li").addClass("active")
                }

                $feature_selector.find(".feature-selector-" + axis).click(this.__feature_selector_handler(axis));
            },

            __render_fLabel_selectors_clinvars: function(axis) {
                console.debug("fmx-dist.__render_fLabel_selectors_clinvars(" + axis + "):" + this.selected_genes[axis]);

                this.$(".selected-gene-" + axis).html("Clinical and Sample Variables");

                var uid = Math.round(Math.random() * 10000);
                this.$(".feature-selector-" + axis).html(ClinVarFeatureDefsTpl({"axis":axis, "uid": uid}));

                var $tabEl = $("#tab-pane-clinvars-" + uid);
                _.each(this.options["clinical_variables"], function(clinical_variable) {
                    $tabEl.append(LineItemTpl(_.extend({ "a_class": "feature-selector-" + axis }, clinical_variable)));
                }, this);

                $tabEl.find(".feature-selector-" + axis).click(this.__feature_selector_handler(axis));
            },

            __render_datasheets: function() {
                this.$(".export-datasheets").html(ExportDatasheetsTpl({ "datasheets": _.values(this.datasheets_control["datasheets"]) }));
            },

            __feature_selector_handler: function(axis) {
                var _this = this;
                return function(e) {
                    _this.__reset_highlight();
                    $(e.target).parents("ul").find(".active").removeClass("active");
                    $(e.target).parent().addClass("active");
                    _this.selected_features[axis] = $(e.target).data("id");
                    _.defer(_this.__draw);
                };
            },

            __draw: function () {
                console.debug("fmx-dist.__draw:selected=" + JSON.stringify(this.selected_features));
                this.$(".alert").hide();

                if (!this.selected_features["x"]) return;
                if (!this.selected_features["y"]) return;

                var X_feature = this.feature_definitions_by_id[this.selected_features["x"]];
                var Y_feature = this.feature_definitions_by_id[this.selected_features["y"]];

                var data = null;
                if (this.selected_tumor_type) {
                    data = this.__visdata([this.selected_tumor_type], X_feature.id, Y_feature.id);
                } else {
                    data = this.__visdata(this.options["tumor_types"], X_feature.id, Y_feature.id);
                }
                if (_.isEmpty(data)) {
                    this.latest_data = [];

                    console.debug("fmx-dist.__draw:no_data_found");
                    WebApp.alert(this.$(".no-data-found"), 3000);

                    // TODO: Figure out how to properly clear the graph
                    _.defer(this.__init_graph);

                    return;
                }

                console.debug("fmx-dist.__draw:data=" + data.length + ":" + JSON.stringify(_.first(data) || {}));
                console.debug("fmx-dist.__draw:data=" + JSON.stringify(_.countBy(data, "tumor_type")));

                var color_by_label = "tumor_type";
                var color_by_list = this.options["tumor_types"];
                var tumor_types_by_id = _.indexBy(WebApp.Lookups.get("tumor_types").get("items"), "id");
                var color_by_colors = _.map(this.options["tumor_types"], function(tumor_type) {
                    if (tumor_types_by_id[tumor_type]) return tumor_types_by_id[tumor_type]["color"] || "red";
                    return "red";
                }, this);

                if (_.isEqual(this.selected_color_by, "sample_type") || _.has(this.feature_definitions_by_id, this.selected_color_by)) {
                    color_by_label = this.selected_color_by;
                    color_by_list = _.unique(_.pluck(data, this.selected_color_by));
                    if (color_by_list.length > 11) {
                        color_by_colors = null;
                    } else {
                        var numberOfColors = color_by_list.length;
                        if (numberOfColors < 3) {
                            color_by_colors = _.first(colorbrewer.RdYlBu[3], numberOfColors);
                        } else {
                            color_by_colors = colorbrewer.RdYlBu[numberOfColors];
                        }
                    }
                }

                this.latest_data = data;
                this.carveVis.colorBy({
                    label: color_by_label,
                    list: color_by_list,
                    colors: color_by_colors
                }).axisLabel({ x: this.__extract_label(X_feature), y: this.__extract_label(Y_feature) })
                    .axisKey({ x: "x", y: "y" })
                    .id("sample")
                    .data(data)
                    .render();

                this.__legend();
            },

            __legend: function() {
                this.$(".legend_items").empty();
                var colorBy = this.carveVis.colorBy();
                var color_by_list = colorBy["list"];
                var color_by_colors = colorBy["colors"];

                if (_.isArray(color_by_list) && _.isArray(color_by_colors)) {
                    if (_.isEqual(color_by_list.length, color_by_colors.length)) {
                        _.each(color_by_list, function (color_by, idx) {
                            this.$(".legend_items").append(LegendTpl({
                                "id": color_by,
                                "label": color_by,
                                "color": color_by_colors[idx]
                            }));
                        }, this);
                    }
                }
            },

            __visdata: function (tumor_types, X_feature_id, Y_feature_id) {
                var data = _.map(tumor_types, function (tumor_type) {
                    var stl = this.sample_types_lookup[tumor_type] || {};

                    var X_feature_by_tumor_type = this.aggregate_features_by_id[X_feature_id] || {};
                    var X_feature = X_feature_by_tumor_type[tumor_type] || {};

                    var Y_feature_by_tumor_type = this.aggregate_features_by_id[Y_feature_id] || {};
                    var Y_feature = Y_feature_by_tumor_type[tumor_type] || {};

                    var Cby_feature_by_tumor_type = this.aggregate_features_by_id[this.selected_color_by] || {};
                    var Cby_feature = Cby_feature_by_tumor_type[tumor_type] || {};

                    if (!_.has(X_feature, "values") || !_.has(Y_feature, "values")) return null;

                    return _.map(X_feature["values"], function (X_value, X_key) {
                        if (X_value === "NA") return null;

                        var sample_type = stl[X_key];
                        if (this.selected_sample_type && !_.isEqual(sample_type, this.selected_sample_type)) return null;

                        var Y_value = Y_feature["values"][X_key];
                        if (Y_value === "NA") return null;

                        if (_.isNumber(X_value)) X_value = parseFloat(X_value);
                        if (_.isNumber(Y_value)) Y_value = parseFloat(Y_value);

                        var datapoint = {
                            "tumor_type": tumor_type,
                            "sample": X_key,
                            "x": X_value,
                            "y": Y_value,
                            "sample_type": sample_type
                        };

                        if (this.selected_color_by && _.has(Cby_feature, "values")) {
                            var Cby_value = Cby_feature["values"][X_key];
                            if (Cby_value) {
                                datapoint[this.selected_color_by] = Cby_value;
                            }
                        }

                        return datapoint;
                    }, this);
                }, this);
                return _.compact(_.flatten(data));
            },

            __extract_label: function(feature) {
                if (_.has(feature, "gene")) {
                    return feature["gene"] + " : " + feature["source"] + " : " + feature["label"];
                }
                return feature["source"] + " : " + feature["label"];
            },

            __reset_highlight: function() {
                if (this.carveVis) this.carveVis.highlight(null);
            }
        });
    });
