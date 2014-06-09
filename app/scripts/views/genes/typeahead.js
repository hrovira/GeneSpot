define([ "jquery", "underscore", "backbone" ],
    function ($, _, Backbone) {
        return Backbone.View.extend({
            initialize: function() {
                _.bindAll(this, "render", "__typed");
            },

            render: function() {
                var taglist = WebApp.Lookups.get("tags").get("items");
                if (_.isEmpty(taglist)) return this;

                var taglabels = _.pluck(taglist, "label");
                this.$el.typeahead({
                    source: function (q, p) {
                        p(_.compact(_.flatten(_.map(q.toLowerCase().split(" "), function (qi) {
                            return _.map(taglabels, function (taglabel) {
                                if (taglabel.toLowerCase().indexOf(qi) >= 0) return taglabel;
                                return null;
                            });
                        }))));
                    },

                    updater: this.__typed
                });

                return this;
            },

            __typed: function(word) {
                this.trigger("typed", word);
                return "";
            }
        });
    });