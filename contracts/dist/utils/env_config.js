import dotenv from "dotenv";
import * as fs from "fs";
import path from "path";
import { Horizon, Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });
class EnvConfig {
    rpc;
    horizonRpc;
    passphrase;
    friendbot;
    admin;
    childAccounts;
    constructor(rpc, horizonRpc, passphrase, friendbot, admin, childAccounts) {
        this.rpc = rpc;
        this.horizonRpc = horizonRpc;
        this.passphrase = passphrase;
        this.friendbot = friendbot;
        this.admin = admin;
        this.childAccounts = childAccounts;
    }
    /**
     * Load the environment config from the .env file
     * @returns Environment config
     */
    static loadFromFile(network) {
        const fileContents = fs.readFileSync(path.join(__dirname, "../../configs.json"), "utf8");
        const configs = JSON.parse(fileContents);
        let rpc_url, horizon_rpc_url, friendbot_url, passphrase;
        const networkConfig = configs.networkConfig.find((config) => config.network === network);
        if (!networkConfig) {
            throw new Error(`Network configuration for '${network}' not found`);
        }
        if (network === 'mainnet') {
            passphrase = networkConfig.soroban_network_passphrase;
            rpc_url = process.env.MAINNET_RPC_URL;
            horizon_rpc_url = networkConfig.horizon_rpc_url;
            friendbot_url = undefined;
        }
        else {
            rpc_url = networkConfig.soroban_rpc_url;
            horizon_rpc_url = networkConfig.horizon_rpc_url;
            friendbot_url = networkConfig.friendbot_url;
            passphrase = networkConfig.soroban_network_passphrase;
        }
        const admin = process.env.ADMIN_SECRET_KEY;
        if (rpc_url === undefined ||
            horizon_rpc_url === undefined ||
            (network != "mainnet" && friendbot_url === undefined) ||
            passphrase === undefined ||
            admin === undefined) {
            throw new Error('Error: Configuration is missing required fields, include <network>');
        }
        const allowHttp = network === "standalone";
        return new EnvConfig(new SorobanRpc.Server(rpc_url, { allowHttp }), new Horizon.Server(horizon_rpc_url, { allowHttp }), passphrase, friendbot_url, Keypair.fromSecret(admin), null);
    }
    /**
     * Get the Keypair for a user from the env file
     * @param userKey - The name of the user in the env file
     * @returns Keypair for the user
     */
    getUser(userKey) {
        const userSecretKey = process.env[userKey];
        if (userSecretKey != undefined) {
            return Keypair.fromSecret(userSecretKey);
        }
        else {
            throw new Error(`${userKey} secret key not found in .env`);
        }
    }
    /**
     * Creates new accounts
     * @param count - Number of funded accounts to create
     */
    async initializeChildAccounts(count = 10) {
        if (this.childAccounts && this.childAccounts.length > 0) {
            console.log("Child accounts already exist.");
            return;
        }
        this.childAccounts = [];
        for (let i = 0; i < count; i++) {
            const pair = Keypair.random();
            try {
                await fetch(`${this.friendbot}?addr=${encodeURIComponent(pair.publicKey())}`);
                this.childAccounts.push(pair);
                console.log(`SUCCESS! Created and funded account ${i + 1} :)\n`);
            }
            catch (e) {
                console.error("Error setting up funded account!", e);
            }
        }
    }
    /**
     * Get the funded accounts keypair
     * @returns Accounts public key
     */
    getFundedAccounts() {
        let publicKeys = [];
        this.childAccounts?.forEach(function (keypair) {
            publicKeys.push(keypair.publicKey());
        });
        return publicKeys;
    }
    /**
     * Get the funded accounts public key and balance
     * @returns Funded account public keys and their corresponding balances
     */
    async getFundedAccountsInfo() {
        const accountsInfo = {};
        const AccountsPublicKey = this.getFundedAccounts();
        for (var i = 0; i < 10; i++) {
            // the JS SDK uses promises for most actions, such as retrieving an account
            const account = await this.horizonRpc.loadAccount(AccountsPublicKey[i]);
            const accountNo = `account${i + 1}`;
            const balances = account.balances.map((balance) => ({
                asset_type: balance.asset_type,
                balance: balance.balance
            }));
            accountsInfo[accountNo] = {
                publicKey: AccountsPublicKey[i],
                balances: balances
            };
        }
        return accountsInfo;
    }
}
export const config = (network) => {
    return EnvConfig.loadFromFile(network);
};
