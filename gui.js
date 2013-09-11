/**
 * Node Runner Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, module, exports) {
    main.consumes = [
        "c9", "plugin", "build", "settings", "commands", "fs", "save",
        "menus", "tabs", "ui", "layout"
    ];
    main.provides = ["buildgui"];
    return main;

    function main(options, imports, register) {
        var Plugin      = imports.plugin;
        var settings    = imports.settings;
        var commands    = imports.commands;
        var menus       = imports.menus;
        var save         = imports.save;
        var build       = imports.build;
        var c9          = imports.c9;
        var fs          = imports.fs;
        var ui          = imports.ui;
        var tabs        = imports.tabs;
        var layout      = imports.layout;
        
        /***** Initialization *****/
        
        var plugin  = new Plugin("Ajax.org", main.consumes);
        // var emit    = plugin.getEmitter();
        
        var process, currentBuilder;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            // Commands
            commands.addCommand({
                name    : "build",
                group   : "Run & Debug",
                hint    : "builds the current file (focussed document)",
                bindKey : { mac: "Command-B", win: "Ctrl-B" },
                isAvailable : function(){
                    return getFocusPage() ? true : false;
                },
                exec : function(){
                    buildFocusPage();
                }
            }, plugin);
    
            commands.addCommand({
                name    : "stopbuild",
                group   : "Run & Debug",
                hint    : "stop a running build",
                bindKey : { mac: "Ctrl-Shift-C", win: "Ctrl-Shift-C" },
                isAvailable : function(){
                    return process && process.running;
                },
                exec    : function(){ 
                    process && process.stop();
                }
            }, plugin);
    
            // Settings
            settings.on("read", function(){
                settings.setDefaults("project/build", [
                    ["saveall", "true"],
                    ["builder", "auto"]
                ]);
                
                var name = settings.get("project/build/@builder");
                setCurrentBuilder(name, function(){});
            });
            
            // Menus
            var c = 10000;
            menus.addItemByPath("Run/~", new ui.divider(), c += 100, plugin);
            
            var mnuBuildSystem = new ui.menu({
                "onprop.visible": function(e){
                    if (e.value) {
                        build.listBuilders(function(err, names){
                            var nodes = mnuBuildSystem.childNodes;
                            for (var i = nodes.length - 3; i >= 2; i--) {
                                mnuBuildSystem.removeChild(nodes[i]);
                            }
                            
                            var builder = settings.get("project/build/@builder");
                            if (builder == "auto")
                                nodes[0].select();
                            
                            var c = 300;
                            names.forEach(function(name){
                                menus.addItemToMenu(mnuBuildSystem, new ui.item({
                                    type     : "radio",
                                    caption  : name.uCaseFirst(),
                                    value    : name,
                                    selected : builder == name
                                }), c++, plugin);
                            });
                        });
                    }
                },
                "onitemclick": function(e){
                    if (e.value == "new-build-system") {
                        tabs.open({
                            path   : settings.get("project/build/@path") 
                              + "/New Build System",
                            active : true,
                            value  : '{\n'
                              + '    "caption" : "",\n'
                              + '    "cmd" : ["ls"],\n'
                              + '    "selector": "source.ext"\n'
                              + '}',
                            document : {
                                meta : {
                                    newfile: true
                                },
                                ace : {
                                    customType : "json"
                                }
                            }
                        }, function(){});
                        return;
                    }
                    
                    setCurrentBuilder(e.value, function(){});
                    settings.set("project/build/@builder", e.value);
                }
            });
            
            menus.addItemByPath("Run/Build System/", mnuBuildSystem, 
                c += 100, plugin);
            menus.addItemByPath("Run/Build", new ui.item({
                command : "build"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Cancel Build", new ui.item({
                command : "stopbuild"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Show Build Result", new ui.item({
                command: "showoutput"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Save All on Build", new ui.item({
                type  : "check",
                value : "[{settings.model}::project/build/@saveall]"
            }), c += 100, plugin);
            
            c = 0;
            menus.addItemByPath("Run/Build System/Automatic", new ui.item({
                type  : "radio",
                value : "auto"
            }), c += 100, plugin);
            menus.addItemByPath("Run/Build System/~", new ui.divider(), c += 100, plugin);
            menus.addItemByPath("Run/Build System/~", new ui.divider(), c += 1000, plugin);
            menus.addItemByPath("Run/Build System/New Build System", new ui.item({
                value : "new-build-system"
            }), c += 100, plugin);
            
            // Hook into FS and build file when writeFile is triggered
            save.on("afterSave", function(e){
                var ext = fs.getExtension(e.path);
                if (!ext)
                    return;
                
                // @todo consider making this a hash map
                if (currentBuilder == "auto") {
                    if (Object.keys(build.builders).every(function(name){
                        return build.builders[name].selector != "source." + ext;
                    })) return;
                }
                else if (currentBuilder.selector != "source." + ext)
                    return;
                
                buildFocusPage(true, e.path);
            });
        };
        
        /***** Methods *****/
        
        function setCurrentBuilder(name, callback){
            currentBuilder = name;
            if (currentBuilder != "auto") {
                build.getBuilder(currentBuilder, true, function(err, builder){
                    if (err)
                        currentBuilder = "auto";
                    else
                        currentBuilder = builder;
                    callback(err, builder);
                });
            }
        }
        
        function getFocusPage(){
            var page = tabs.focussedPage;
            if (!page) return false;
            if (page.path) return page;
            if (page.editor.type != "output") return false;
            
            var splits = page.pane.aml
                .parentNode.parentNode.getElementsByTagName("pane");
            if (splits.length > 1) {
                var idx = splits[0].cloud9pane == page.pane ? 1 : 0;
                page = splits[idx].cloud9pane.getPage();
                return page;
            }
            return false;
        }
        
        function buildFocusPage(onlyBuild, path){
            if (!path) {
                var page = getFocusPage();
                if (!page) return;
                path = page.path;
            }
            
            if (!onlyBuild)
                commands.exec("showoutput");
            
            if (settings.get("project/build/@saveall"))
                save.saveAll(done);
            else
                done();
            
            function done(){
                process = build.build(currentBuilder, 
                    { path: path }, "output", function(err, pid){
                        if (err && err.code != "EBUILDERNOTFOUND")
                            return layout.showError(err);
                    });
            }
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * UI for the Build System
         */
        plugin.freezePublicAPI({
            
        });
        
        register(null, {
            "buildgui": plugin
        });
    }
});
