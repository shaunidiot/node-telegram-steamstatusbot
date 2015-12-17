var TelegramBot = require('node-telegram-bot-api');
var CronJob = require('cron').CronJob;
var request = require('request');
var fs = require('fs');

var config = require('./config');
var token = config.botToken;

var steamStatusUrl = 'https://steamgaug.es/api/v2';
//var steamStatusUrl = 'http://pastebin.com/raw/Z97FbpsX'; // for testing purposes

var oldStatus = '';

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
    if (msg.text) {
        var chatId = msg.chat.id;
        console.log('[Chat] @' + msg.chat.username + ': ' + msg.text);
        switch (msg.text.toLowerCase().trim()) {
            case '/subscribe':
            subscribe(msg);
            break;
            case '/unsubscribe':
            unsubscribe(msg);
            break;
            case '/start':
            bot.sendMessage(chatId, 'Type /subscribe to begin.');
            break;
        }

    }
});

function requestSteamStatusUpdate() {
    request({
        url: steamStatusUrl
    }, function(erorr, response, body) {
        fs.writeFile('./status.json', body, function(err) {
            if(err) {
                return console.log(err);
            }
            console.log("[status.json] The file was saved!");
            compareResults(JSON.parse(body));
        });
    });
}

function compareResults(data) {
    var offline = [];
    if (oldStatus == '' || (oldStatus != '' && JSON.stringify(data) != oldStatus)) { // if oldStatus is on first run or current data is different from old status
        oldStatus = JSON.stringify(data);

        if (typeof data.ISteamClient !== 'undefined') { // make sure everything is okay
            Object.keys(data).forEach(function(element) {
                if (typeof data[element].online !== 'undefined') {
                    if (data[element].online !== 1) {
                        offline.push(element + ' is offline. ' + ((typeof data[element].error !== 'undefined') ? data[element].error : ''));
                    }
                } else {
                    if (element == 'ISteamGameCoordinator') {
                        Object.keys(data['ISteamGameCoordinator']).forEach(function(element) {
                            if (data['ISteamGameCoordinator'][element].online !== 1) {
                                offline.push('GC ' + element + ' is offline. ' + ((typeof data['ISteamGameCoordinator'][element].error !== 'undefined') ? data['ISteamGameCoordinator'][element].error : ''));
                            }
                        });
                    }
                }
            });
        }

        if (offline.length > 0) { // something is offline
            var offlineMsg = offline.join("\n");

            // get list of subscribers
            client.hgetall('subscriptions', function(err, result) {
                if (err) {
                    console.log('[redis]: ' + err);
                    return;
                }

                if (result !== null) { // if there are subscribers
                    if (Object.keys(result).length > 0) {
                        Object.keys(result).forEach(function(element) {
                            bot.sendMessage(element, offlineMsg);
                        });
                    }
                }
            });
        }
    }
}

function subscribe(msg) {
    client.hget("subscriptions", msg.chat.id, function(err, result) {
        if (err) {
            console.log('[Subscribe] Error:' + err + "|" + result);
        } else {
            client.hset("subscriptions", msg.chat.id, '', function(error, result) {
                if (error) {
                    bot.sendMessage(msg.chat.id, error + "|" + response);
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
            bot.sendMessage(msg.chat.id, 'Unable to unsubscribed to updates: ' + error);
            return;
        }
        bot.sendMessage(msg.chat.id, 'Unsubscribed to Steam status updates.');
    });
}
