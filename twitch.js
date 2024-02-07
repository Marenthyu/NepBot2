let db;
let config = require('./config.json');
let log;

async function init(newconfig, newdb, logger){
    config = newconfig;
    db = newdb;
    log = logger;
}

async function updateConfig(newconfig) {
    config = newconfig;
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
                "Authorization": "Bearer " + config.twitch.last_token,
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
                "Authorization": "Bearer " + config.twitch.last_token,
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
                    "Authorization": "Bearer " + config.twitch.last_token,
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
                "Authorization": "Bearer " + config.twitch.last_token,
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
                "Authorization": "Bearer " + config.twitch.last_token,
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

const conduit = {addShard, updateOwnShard, getConduitShards, getConduitDetails}
const auth = {getAppAccessToken, verifyToken};

module.exports = {conduit: conduit, auth: auth, init, updateConfig};
