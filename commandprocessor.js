let db;
let config;
let log;

let commandMapping = {
    "checkhand": checkHand
}

async function init(newconfig, newdb, logger){
    config = newconfig;
    db = newdb;
    log = logger;
}

async function updateConfig(newconfig) {
    config = newconfig;
}

async function proccessCommand(messageevent) {
    let response;
    let channel = messageevent.broadcaster_user_login;
    let text = messageevent.message.text;
    let sender = {
        "login": messageevent.chatter_user_login,
        "id": messageevent.chatter_user_id,
        "display": messageevent.chatter_user_name
    };
    log.info("[CHAT][#" + channel + "] " + sender.login + ": " + text);
    if (!text.startsWith("!")) {
        log.debug("No command, aborting early.");
        return
    }
    let textParts = text.split(" ");
    let command = textParts[0].substring(1);
    let args = textParts.slice(1);
    log.info("[COMMAND][#" + channel + "] " + sender.login + ": " + command);
    if (command in commandMapping) {
        response = await commandMapping[command](sender, args);
    } else {
        log.debug("[COMMAND] Unknown command.");
    }
    return response
}

async function checkHand(sender, args) {
    const hand = await db.getHand(sender.id);
    if (hand.length === 0) {
        return sender.display + ", you don't have any waifus! Get your first with !freebie"
    }
    const currentData = await db.getCurrentCardCounts(sender.id, true);
    const limit = await db.getHandLimit(sender.id);
    const dropLink = db.dbConfig.siteHost + "/hand?user=" + sender.login;
    const msgArgs = {"user": sender.display, "limit": limit, "curr": currentData['hand'],
        "bounties": currentData['bounties'], "link": dropLink};

    if (args.length > 0 && args[0].toLowerCase() === "verbose") {
        // Whisper and follow check currently ignored. Just send verbose output if requested.
        // TODO: Verbose Hand output
        return "VERBOSE HAND OUTPUT"
    } else {
        if (currentData.bounties > 0) {
            return msgArgs.user + ", you have " + msgArgs.curr + " waifus, " + msgArgs.bounties + " bounties and " + msgArgs.limit + " total spaces. " + msgArgs.link
        } else {
            return msgArgs.user + ", you have " + msgArgs.curr + " waifus and " + msgArgs.limit + " total spaces. " + msgArgs.link
        }
    }
}



module.exports = {init, proccessCommand, updateConfig};
