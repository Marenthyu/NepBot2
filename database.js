let mysql = require("mysql2/promise");

let db;
let config;
let log;

let dbConfig = {};

async function init(newconfig, newlog) {
    config = newconfig;
    log = newlog;
    await dbStartup();
}

async function dbStartup() {
    db = await mysql.createConnection(config.database);
    setInterval(async () => {
        log.debug("Pinging database...");
        await db.ping()
    }, 30000);
    let [rows, fields] = await db.execute("SELECT * FROM config");
    log.debug("Database connection established, config:");
    for (const row of rows) {
        dbConfig[row.name] = row.value;
    }
    log.debug(JSON.stringify(dbConfig, null, 2));
}

async function updateConfig(newconfig) {
    config = newconfig;
}

async function getHand(userid) {
    try {
        let id = parseInt(userid);
        if (!id) {
            log.warn("Got non-integer ID for get Hand, returning empty string!");
            log.warn(id);
            return []
        }
    } catch (e) {
        log.warn("Got non-integer ID for get Hand, returning empty string!");
        log.warn(e);
        return []
    }
    let [rows, fields] = await db.execute("SELECT cards.id AS cardid, waifus.name, waifus.id AS waifuid, cards.rarity, waifus.series, COALESCE(cards.customImage, waifus.image) AS image, waifus.base_rarity, cards.tradeableAt FROM cards JOIN waifus ON cards.waifuid = waifus.id WHERE cards.userid = ? AND cards.boosterid IS NULL ORDER BY COALESCE(cards.sortValue, 32000) ASC, (rarity < ?) DESC, waifus.id ASC, cards.id ASC",
        [userid, dbConfig["numNormalRarities"]]);
    return rows;
}

async function getCurrentCardCounts(userid, verbose) {
    let [rows, fields] = await db.execute("SELECT (SELECT COUNT(*) FROM cards WHERE userid = ? AND boosterid IS NULL AND rarity < ?) AS hand, (SELECT COUNT(*) FROM bounties WHERE userid = ? AND status = 'open') AS bounties", [userid, dbConfig.numNormalRarities, userid]);
    if (verbose) {
        return {
            hand: rows[0].hand,
            bounties: rows[0].bounties,
            total: rows[0].hand + rows[0].bounties
        }
    } else {
        return rows[0].hand + rows[0].bounties
    }
}

async function getHandLimit(userid) {
    let [rows, fields] = await db.execute("SELECT 7 + paidHandUpgrades + freeUpgrades AS lim FROM users WHERE id = ?",
        [userid]);
    return rows[0].lim;
}

module.exports = {
    init,
    updateConfig,
    getHand,
    getCurrentCards: getCurrentCardCounts,
    getCurrentCardCounts,
    getHandLimit,
    dbConfig
};
