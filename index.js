var TelegramBot = require('node-telegram-bot-api');
var CronJob = require('cron').CronJob;
var request = require('request');
var fs = require('fs-extra');

var config = require('./config');
var token = config.botToken;

var steamStatusUrl = 'https://steamgaug.es/api/v2';

var oldStatus = '';

var statusFile = './status.json';
try {
    fs.ensureFileSync(statusFile);
    oldStatus = fs.readFileSync(statusFile, {encoding: 'utf8'});
} catch(error) {
    oldStatus = '';
}

var redis = require("redis");
var client = redis.createClient();

client.select(config.redisTableNum);

client.on("error", function(err) {
    console.log("[redis] Error " + err);
});

var bot = new TelegramBot(token, {
    polling: true
});

new CronJob('*/5 * * * *', function() { // every 5 minutes
    requestSteamStatusUpdate();
}, null, true, 'America/Los_Angeles');


bot.getMe().then(function(me) {
    console.log('[Bot] ' + me.username + ' logged in successfully.');
    requestSteamStatusUpdate();
});

bot.on('message', function(msg) {
    if (typeof msg.text !== 'undefined' && msg.text) {

        if (msg.from.id == config.adminId) {
            if (msg.text.indexOf('/announce ') >= 0) {
                var annMsg = msg.text.replace('/announce ', '');
                broadcast(annMsg);
                return;
            }

            switch (msg.text.toLowerCase().trim()) {
                case '/users':
                getTotalUsersCount(msg.chat.id);
                break;
            }
        }

        if (typeof msg.from.username !== 'undefined') {
            console.log('[Chat] @' + msg.from.username + ': ' + msg.text);
        } else {
            console.log('[Chat] @' + msg.from.first_name + ': ' + msg.text);
        }

        switch (msg.text.toLowerCase().trim()) {
            case '/subscribe':
            subscribe(msg);
            break;
            case '/unsubscribe':
            unsubscribe(msg);
            break;
            case '/start':
            bot.sendMessage(msg.chat.id, 'Type /subscribe to begin.');
            break;
            case '/status':
            sendSteamStatuses(msg.chat.id);
            break;
            case '/ping':
            bot.sendMessage(msg.chat.id, 'pong');
            break;
        }
    }
});

function sendSteamStatuses(chatId) {
    console.log('User requested all statuses.');
    var messages = [];
    if (oldStatus !== '') {
        var data = JSON.parse(oldStatus);
        if (typeof data['ISteamClient'] !== 'undefined') { // make sure everything is okay
            Object.keys(data).forEach(function(element) {
                if (typeof data[element].online !== 'undefined') {
                    if (data[element].online == 2) {
                        messages.push(element + ' is *offline*.');
                    } else if (data[element].online == 1) {
                        messages.push(element + ' is online.');
                    }
                } else {
                    if (element == 'ISteamGameCoordinator') {
                        Object.keys(data['ISteamGameCoordinator']).forEach(function(element) {
                            if (data['ISteamGameCoordinator'][element].online == 2) {
                                messages.push('GameCoordinator for ' + getGameNameFromId(element) + ' is *offline*. ');
                            } else if (data['ISteamGameCoordinator'][element].online == 1) {
                                messages.push('GameCoordinator for ' + getGameNameFromId(element) + ' is online.');
                            }
                        });
                    } else if (element == 'IEconItems') {
                        Object.keys(data['IEconItems']).forEach(function(element) {
                            if (data['IEconItems'][element].online == 2) {
                                messages.push('IEconItems for ' + getGameNameFromId(element) + ' is *offline*. ');
                            } else if (data['IEconItems'][element].online == 1) {
                                messages.push('IEconItems for ' + getGameNameFromId(element) + ' is online.');
                            }
                        });
                    }
                }
            });

            if (messages.length > 0) {
                var fileInfo = fs.statSync(statusFile);
                messages.push('\n\nLast checked: ' + fileInfo.mtime);
                bot.sendMessage(chatId, messages.join("\n"), {
                    parse_mode: 'markdown'
                }).then(function(result) {
                }).catch(function(error) {
                    console.log(error);
                });
            }
        } else {
            console.log('Something wrong with json at [sendSteamStatuses]');
        }
    } else {
        // need to get new data
        console.log('TODO: Need to get new data :/');
    }
}

function requestSteamStatusUpdate() {
    request({
        url: steamStatusUrl
    }, function(error, response, body) {
        if (error) {
            console.log(error);
            return;
        }
        fs.writeFile(statusFile, body, function(err) {
            if(err) {
                return console.log(err);
            }
            console.log("[status.json] The file was saved!");
            compareResults(body);
        });
    });
}

function compareResults(data) {
    console.log('Comparing results');
    var messages = [];

    if (isValidJson(data)) {
        var data = JSON.parse(data);
        if (oldStatus === '') {
            if (typeof data['ISteamClient'] !== 'undefined') { // make sure everything is okay
                Object.keys(data).forEach(function(element) {
                    if (typeof data[element].online !== 'undefined') {
                        if (data[element].online == 2) {
                            messages.push(element + ' is offline. ');
                        }
                    } else {
                        if (element == 'ISteamGameCoordinator') {
                            Object.keys(data['ISteamGameCoordinator']).forEach(function(element) {
                                if (data['ISteamGameCoordinator'][element].online == 2) {
                                    messages.push('GameCoordinator for ' + getGameNameFromId(element) + ' is offline. ');
                                }
                            });
                        } else if (element == 'IEconItems') {
                            Object.keys(data['IEconItems']).forEach(function(element) {
                                if (data['IEconItems'][element].online == 2) {
                                    messages.push('IEconItems for ' + getGameNameFromId(element) + ' is offline. ');
                                }
                            });
                        }
                    }
                });
            } else {
                console.log('json fucked up [compareResults]');
            }
        } else if (oldStatus !== '' && JSON.stringify(data) != oldStatus) {
            var oldResults = JSON.parse(oldStatus);
            if (typeof data['ISteamClient'] !== 'undefined' && typeof oldResults['ISteamClient'] !== 'undefined') { // make sure everything is okay
                Object.keys(data).forEach(function(element) {
                    if (typeof data[element].online !== 'undefined' && typeof oldResults[element].online !== 'undefined') {
                        if (oldResults[element].online == 1 && data[element].online == 2) {
                            messages.push(element + ' is offline. ');
                        } else if (oldResults[element].online == 2 && data[element].online == 1) {
                            messages.push(element + ' is back online.');
                        }
                    } else {
                        if (element =='ISteamGameCoordinator') {
                            Object.keys(data['ISteamGameCoordinator']).forEach(function(element) {
                                if (oldResults['ISteamGameCoordinator'][element].online == 1 && data['ISteamGameCoordinator'][element].online == 2) {
                                    messages.push('GameCoordinator for ' + getGameNameFromId(element) + ' is offline. ');
                                } else if (oldResults['ISteamGameCoordinator'][element].online == 2 && data['ISteamGameCoordinator'][element].online == 1) {
                                    messages.push('GameCoordinator for ' + getGameNameFromId(element) + ' is back online.');
                                }
                            });
                        } else if (element == 'IEconItems') {
                            Object.keys(data['IEconItems']).forEach(function(element) {
                                if (oldResults['IEconItems'][element].online == 1 && data['IEconItems'][element].online == 2) {
                                    messages.push('IEconItems for ' + getGameNameFromId(element) + ' is offline. ');
                                } else if (oldResults['IEconItems'][element].online == 2 && data['IEconItems'][element].online == 1) {
                                    messages.push('IEconItems for ' + getGameNameFromId(element) + ' is back online.');
                                }
                            });
                        }
                    }
                });
            } else {
                console.log('something fucked up as well [compareResults]');
            }
        }

        oldStatus = JSON.stringify(data);

        if (messages.length > 0) { // something changed
            var offlineMsg = messages.join("\n");

            // get list of subscribers
            client.hgetall('subscriptions', function(err, result) {
                if (err) {
                    console.log('[redis]: ' + err);
                    return;
                }

                if (result !== null) { // if there are subscribers
                    if (Object.keys(result).length > 0) {
                        Object.keys(result).forEach(function(element) {
                            bot.sendMessage(element, offlineMsg).then(function(data) {

                            }).catch(function(e) {
                                console.log(e);
                                if (e.indexOf('403') >= 0) { // user deleted bot
                                    client.hdel("subscriptions", element);
                                }
                            });
                        });
                    }
                }
            });
        }
    } else {
        console.log('Unable to parse JSON.');
    }
}

function broadcast(message) {
    client.hgetall('subscriptions', function(err, result) {
        if (err) {
            console.log('[redis]: ' + err);
            return;
        }

        if (result !== null) { // if there are subscribers
            if (Object.keys(result).length > 0) {
                Object.keys(result).forEach(function(element) {
                    bot.sendMessage(element, message);
                });
            }
        }
    });
}

function getTotalUsersCount(chatId) {
    client.hgetall('subscriptions', function(err, result) {
        if (err) {
            console.log('[redis]: ' + err);
            return;
        }

        if (result !== null) { // if there are subscribers
            if (Object.keys(result).length > 0) {
                bot.sendMessage(chatId, Object.keys(result).length + ' total subscribers.');
            }
        }
    });
}

function subscribe(msg) {
    client.hget("subscriptions", msg.chat.id, function(err, result) {
        if (err) {
            console.log('[Subscribe] Error:' + err + "|" + result);
        } else {
            client.hset("subscriptions", msg.chat.id, '', function(error, result) {
                if (error) {
                    bot.sendMessage(msg.chat.id, 'Error subscribing. Contact admin: ' + error);
                    return;
                }
                bot.sendMessage(msg.chat.id, 'Subscribed to Steam status updates.');
            });
        }
    });
}

function unsubscribe(msg) {
    client.hdel("subscriptions", msg.chat.id, function(error, response) {
        if (error) {
            bot.sendMessage(msg.chat.id, 'Error unsubscribing. Contact admin: ' + error);
            return;
        }
        bot.sendMessage(msg.chat.id, 'Unsubscribed to Steam status updates.');
    });
}

function getGameNameFromId(id) {
    if (typeof config.games[id] !== 'undefined') {
        return config.games[id];
    }
    return id;
}

function isValidJson (jsonString){
    try {
        var o = JSON.parse(jsonString);

        // Handle non-exception-throwing cases:
        // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
        // but... JSON.parse(null) returns 'null', and typeof null === "object",
        // so we must check for that, too.
        //if (o && typeof o === "object" && o !== null) {
        return true;
        //}
    }
    catch (e) {
        console.log(e);
    }
    return false;
}
