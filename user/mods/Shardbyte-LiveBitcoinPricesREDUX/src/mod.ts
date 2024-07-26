// LiveBitcoinPricesREDUX (LBPR)
// Author: Shardbyte
import { DependencyContainer } from "tsyringe";
import { IPostDBLoadModAsync } from "@spt/models/external/IPostDBLoadModAsync";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";
import { request } from "https";
import * as fs from "node:fs";
import * as path from "node:path";

class LBPR implements IPostDBLoadModAsync {
    private static bitcoin: any
    private static logger: ILogger
    private static config: Config;
    private static therapistCoef: number;
    private static configPath = path.resolve(__dirname, "../config/config.json");
    private static pricePath = path.resolve(__dirname, "../config/price.json");

    public async postDBLoadAsync(container: DependencyContainer): Promise<void> {
        LBPR.logger = container.resolve<ILogger>("WinstonLogger");
        LBPR.config = JSON.parse(fs.readFileSync(LBPR.configPath, "utf-8"));
        const db = container.resolve<DatabaseServer>("DatabaseServer");

        const tables = db.getTables();
        const handbook = tables.templates.handbook;
        LBPR.therapistCoef = (100 - tables.traders["54cb57776803fa99248b456e"].base.loyaltyLevels[0].buy_price_coef) / 100;
        LBPR.bitcoin = handbook.Items.find(x => x.Id == "59faff1d86f7746c51718c9c");

        // Update price on startup
        const currentTime = Math.floor(Date.now() / 1000);
        if (!await LBPR.getPrice(currentTime > LBPR.config.nextUpdate)) {
            return;
        }

        // Get new price every hour
        setInterval(LBPR.getPrice, (60 * 60 * 1000));

        return;
    }

    static async getPrice(fetchPrices = true): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (!fetchPrices) {
                // Load last saved price
                const lastValue = JSON.parse(fs.readFileSync(LBPR.pricePath, "utf-8"))[`${LBPR.bitcoin.Id}`];
                if (lastValue === undefined) {
                    LBPR.logger.logWithColor(`No last price saved, keeping bitcoin price at: ${LBPR.bitcoin.Price}`, LogTextColor.MAGENTA);
                } else {
                    LBPR.bitcoin.Price = lastValue;
                    LBPR.logger.logWithColor(`Updated bitcoin to ${LBPR.bitcoin.Price} from price path`, LogTextColor.MAGENTA);
                }
                resolve(true);
            } else {
                const req = request(
                    "https://api.tarkov.dev/graphql",
                    {
                        method: "POST"
                    },
                    (res) => {
                        res.setEncoding("utf8");
                        let rawData = "";
                        res.on("data", (chunk) => { rawData += chunk; });
                        res.on("end", () => {
                            try {
                                const parsedData = JSON.parse(rawData);
                                const price = parsedData.data.item.sellFor.find((x) => x.vendor.name === "Therapist").priceRUB
                                const inRub = price / LBPR.therapistCoef;
                                LBPR.bitcoin.Price = inRub;

                                // Store the prices to disk for next time
                                const jsonString: string = `{"${LBPR.bitcoin.Id}": ${LBPR.bitcoin.Price}}`
                                fs.writeFileSync(LBPR.pricePath, JSON.stringify(JSON.parse(jsonString)));

                                // Update config file with the next update time
                                LBPR.config.nextUpdate = Math.floor(Date.now() / 1000) + 3600;
                                fs.writeFileSync(LBPR.configPath, JSON.stringify(LBPR.config, null, 4));
                                LBPR.logger.logWithColor("Updated bitcoin to match live price", LogTextColor.MAGENTA);
                                resolve(true);
                            } catch (e) {
                                console.error(e.message);
                                resolve(false);
                            }
                        });
                    });

                req.on("error", (e) => {
                    console.error(e.message);
                    reject(e);
                })

                req.write(JSON.stringify({
                    query: `{
                    item(id: "59faff1d86f7746c51718c9c")
                    {
                      sellFor {
                        priceRUB
                        vendor {
                          name
                        }
                      }
                    }
                  }`
                }));
                req.end();
            }
        })
    }

}

interface Config {
    nextUpdate: number,
}

export const mod = new LBPR();
