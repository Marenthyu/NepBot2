let http = require('http');
const config = require('./config.json');
const crypto = require('crypto');
const fs = require("fs");

const db = require("./database");
const log = require('./logger');
const commandprocessor = require('./commandprocessor');

let token;

let server = http.createServer(async (req, res) => {
    const calledURL = new URL(req.url, 'https://' + (req.headers.hasOwnProperty('x-forwarded-host') ? req.headers['x-forwarded-host'] : req.headers['host']));
    switch (calledURL.pathname.substring(1)) {
        case "twitch/callback": {
            if (req.method === 'POST') {
                let body = Buffer.from('');
                let firstChunk = true;
                req.on('data', chunk => {
                    if (firstChunk) {
                        firstChunk = false;
                        body = chunk;
                    } else {
                        body = Buffer.concat([body, chunk]);
                    }
                });
                req.on('end', async () => {
                    if (req.headers.hasOwnProperty('twitch-eventsub-message-signature')) {
                        let id = req.headers['twitch-eventsub-message-id'];
                        let timestamp = req.headers['twitch-eventsub-message-timestamp'];
                        let sigParts = req.headers['twitch-eventsub-message-signature'].split('=');

                        let computedSig = crypto.createHmac('sha256', config.twitch.eventsub.secret)
                            .update(id + timestamp + body)
                            .digest('hex');
                        let sentSig = sigParts[1];

                        if (computedSig !== sentSig) {
                            log.warn("SIGNATURE MISMATCH:");
                            log.warn("Expected: " + computedSig);
                            log.warn("Got "+ sentSig);
                            res.writeHead(401, "Invalid Signature");
                            res.end();
                        } else {
                            log.debug("GOOD SIGNATURE");
                            let parsedBody = JSON.parse(body.toString());
                            log.debug(JSON.stringify(parsedBody));
                            switch (req.headers['twitch-eventsub-message-type']) {
                                case "webhook_callback_verification": {
                                    res.writeHead(200, "OK");
                                    res.end(parsedBody.challenge);
                                    log.debug("Acknowledged new subscription " + parsedBody);
                                    break;
                                }
                                case "notification": {
                                    res.writeHead(204, "No Content");
                                    res.end();
                                    log.debug("Got a notification!");
                                    switch (parsedBody.subscription.type) {
                                        case "channel.follow": {
                                            log.debug(parsedBody.event.user_name + " has followed " + parsedBody.event.broadcaster_user_name + "!");
                                            break;
                                        }
                                        case "user.authorization.grant": {
                                            log.debug("Got a grant notification:", JSON.stringify(parsedBody.event));
                                            log.info(parsedBody.event.user_name + " authorized " + parsedBody.event.client_id);
                                            break;
                                        }
                                        case "channel.chat.message": {
                                            log.debug("[CHAT] " + JSON.stringify(parsedBody.event));
                                            const response = await commandprocessor.proccessCommand(parsedBody.event);
                                            if (response) {
                                                await sendReply(parsedBody.event, response);
                                            }
                                            break;
                                        }
                                        default: {
                                            log.warn("Got unknown notification type " + parsedBody.subscription.type);
                                        }
                                    }
                                    break;
                                }
                                case "revocation": {
                                    res.writeHead(204, "No Content");
                                    res.end();
                                    log.debug("Revocation of subsctiption " + parsedBody.subscription.id + " acknowledged.");
                                    break;
                                }
                            }

                        }
                    }
                });

            } else {
                res.writeHead(405, "Method not allowed");
                res.end("What are you doing?");
            }
            break;
        }
        default: {
            log.debug("Unknown path " + req.url);
            res.writeHead(404, "Not Found");
            res.end("Not Found");
        }
    }
});

async function saveConfig() {
    try {
        await updateConfigsForModules(config);
    } catch (e) {
        log.error("Error updating configs for modules, moving on anyway...");
        log.error(e);
    }
    return fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
}

async function verifyToken(token) {
    let valid = false;
    try {
        let response = await fetch("https://id.twitch.tv/oauth2/validate", {headers: {"Authorization": "OAuth " + token}});
        let j = await response.json();
        valid = j.client_id === config.twitch.client_id;

    } catch (e) {
        log.error("Error verifying...");
        log.error(e);
        valid = false;
    }
    log.debug("Valid: " + valid);
    return valid;
}

async function getAppAccessToken() {
    try {
        let params = new URLSearchParams();
        params.set("client_id", config.twitch.client_id);
        params.set("client_secret", config.twitch.client_secret);
        params.set("grant_type", "client_credentials");
        let response = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            body: params.toString(),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
        let j = await response.json();
        log.debug({j});
        return j.access_token;
    } catch (e) {
        log.error("Error generating new token...");
        log.error(e);
    }
}

async function getConduitDetails() {
    try {
        let response = await fetch("https://api.twitch.tv/helix/eventsub/conduits", {
            headers: {
                "Authorization": "Bearer " + token,
                "Client-ID": config.twitch.client_id
            }
        });
        let j = await response.json();
        if (j.error) {
            log.error(JSON.stringify(j.error));
        }
        let myConduit = j.data.filter((value, index) => {
            return value.id === config.twitch.eventsub.conduit_id
        });
        return myConduit.length >= 1 ? myConduit[0] : [];
    } catch (e) {
        log.error("Error getting conduit details...");
        log.error(e);
        process.exit(4);
    }
}

async function getConduitShards() {
    let returnList = [];
    try {
        let response = await fetch("https://api.twitch.tv/helix/eventsub/conduits/shards?conduit_id=" + config.twitch.eventsub.conduit_id, {
            headers: {
                "Authorization": "Bearer " + token,
                "Client-ID": config.twitch.client_id
            }
        });
        let j = await response.json();
        if (j.error) {
            log.error(JSON.stringify(j));
        }
        returnList.push(...(j.data));
        while (j.pagination.cursor) {
            response = await fetch("https://api.twitch.tv/helix/eventsub/conduits/shards?conduit_id=" + config.twitch.eventsub.conduit_id + "&after=" + j.pagination.cursor, {
                headers: {
                    "Authorization": "Bearer " + token,
                    "Client-ID": config.twitch.client_id
                }
            });
            j = await response.json();
            returnList.push(...(j.data));
        }
        return returnList;
    } catch (e) {
        log.error("Error getting conduit...");
        log.error(e);
        process.exit(3);
        return [];
    }
}

async function updateOwnShard(conduit_id, shard_id) {
        try {
            let response = await fetch("https://api.twitch.tv/helix/eventsub/conduits/shards", {
                method: "PATCH",
                headers: {
                    "Authorization": "Bearer " + token,
                    "Client-ID": config.twitch.client_id,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "conduit_id": conduit_id,
                    "shards": [
                        {
                            "id": shard_id,
                            "transport": {
                                "method": "webhook",
                                "secret": config.twitch.eventsub.secret,
                                "callback": "https://" + config.twitch.eventsub.host + "/twitch/callback"
                            }
                        }
                    ]
                })
            });
            let j = await response.json();
            log.debug("Own Shard Update Response:");
            log.debug(JSON.stringify(j));
        } catch (e) {
            log.error("Error updating own shard...");
            log.error(e);
        }
}

async function addShard(new_count){
    try {
        let response = await fetch("https://api.twitch.tv/helix/eventsub/conduits", {
            method: "PATCH",
            headers: {
                "Authorization": "Bearer " + token,
                "Client-ID": config.twitch.client_id,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "id": config.twitch.eventsub.conduit_id,
                "shard_count": new_count
            })
        });
        let j = await response.json();
        log.debug("Conduit Update response:");
        log.debug(JSON.stringify(j));
        return updateOwnShard(config.twitch.eventsub.conduit_id, new_count-1);
    } catch (e) {
        log.error("Error updating conduit...");
        log.error(e);
    }
}

async function init() {
    log.info("Initializing remaining stuff...");
    log.info("Checking if last token is valid...");

    let valid = await verifyToken(config.twitch.last_token);
    if (valid) {
        log.info("Token was valid, reusing!");
        token = config.twitch.last_token;
    } else {
        log.info("Token was invalid, generating new one...");
        token = await getAppAccessToken();
        valid = await verifyToken(token);
        if (!valid) {
            log.error("Freshly generated token not valid. ABORTING STARTUP");
            process.exit(1);
        }
        config.twitch.last_token = token;
        await saveConfig();
    }

    log.info("Valid token gotten. Verifying conduit...");

    let shards = await getConduitShards();
    let conduit = await getConduitDetails();

    log.info("Got Shards for Conduit, verifying my own status...");

    let myID = conduit.shard_count;
    for (let shard of shards) {
        if (shard.transport.method === "webhook" && shard.transport.callback.startsWith("https://" + config.twitch.eventsub.host)) {
            myID = shard.id;
            switch (shard.status) {
                case "enabled": {
                    log.info("Shard active and enabled! No further action needed.");
                    break;
                }
                case "webhook_callback_verification_pending":
                case "webhook_callback_verification_failed":
                case "notification_failures_exceeded": {
                    log.warn("Erroneous Shard Status. Recreating...");
                    await updateOwnShard(config.twitch.eventsub.conduit_id, myID);
                    break;
                }
                default: {
                    log.error("Unknown own Shard Status. Aborting Startup.");
                    process.exit(2);
                }
            }
            break;
        }
    }
    if (myID === conduit.shard_count) {
        log.warn("Shard not found, adding Shard...");
        if (myID === 1 && shards.length === 0) {
            // We have a brand new Conduit, need to just fill it.
            myID = 0;
        }
        await addShard(myID+1);
    }
    log.info("Initialization complete, we should now be listening to events!");
}

async function updateConfigsForModules(newconfig) {
    return Promise.all([db.updateConfig(newconfig), commandprocessor.updateConfig(newconfig)]);
}

async function sendReply(incomingMessage, response) {
    log.info("I would reply to " + incomingMessage.broadcaster_user_id + " now with: " + response);
    log.info("But this is not implemented yet.");
}

log.info("HELLO WORLD");
log.info("Hi, I like Waifus. Let's get started.");
log.info("Connecting to database...");
db.init(config, log).then(() => {
    log.info("Database Connected, Initializing Command Processor...");
    return commandprocessor.init(config, db, log);
}).then(() => {
   log.info("Commands Processing, starting EventSub Listener...");
   return server.listen(config.twitch.eventsub.port);
}).then(init).then(() => {
    log.info("All done!");
});
