// import { randomBytes } from 'crypto';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Address, Contract, Operation, StrKey, hash, scValToNative, xdr } from '@stellar/stellar-sdk';
import { fileURLToPath } from 'url';
import { config } from './env_config.js';
import { createTxBuilder, invoke, invokeTransaction } from './tx.js';
const network = process.argv[2];
const loadedConfig = config(network);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function installContract(wasmKey, addressBook, source) {
    const contract_wasm_path = path.join(__dirname, `../../${wasmKey}/target/wasm32-unknown-unknown/release/${wasmKey}.wasm`);
    if (!existsSync(contract_wasm_path)) {
        const error = `The wasm file for contract ${wasmKey} cannot be found at ${contract_wasm_path}`;
        throw new Error(error);
    }
    const contractWasm = readFileSync(contract_wasm_path);
    const wasmHash = hash(contractWasm);
    addressBook.setWasmHash(wasmKey, wasmHash.toString('hex'));
    console.log('Installing:', wasmKey, wasmHash.toString('hex'));
    const op = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(contractWasm),
        auth: [],
    });
    addressBook.writeToFile();
    await invoke(op, source, false);
}
export async function deployContract(contractKey, wasmKey, addressBook, source) {
    const contractIdSalt = randomBytes(32);
    const networkId = hash(Buffer.from(loadedConfig.passphrase));
    const contractIdPreimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(source.publicKey()).toScAddress(),
        salt: contractIdSalt,
    }));
    const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({
        networkId: networkId,
        contractIdPreimage: contractIdPreimage,
    }));
    console.log('Deploying WASM', wasmKey, 'for', contractKey);
    const contractId = StrKey.encodeContract(hash(hashIdPreimage.toXDR()));
    addressBook.setContractId(contractKey, contractId);
    const wasmHash = Buffer.from(addressBook.getWasmHash(contractKey), 'hex'); //@param contractKey - The name of the contract
    const deployFunction = xdr.HostFunction.hostFunctionTypeCreateContract(new xdr.CreateContractArgs({
        contractIdPreimage: contractIdPreimage,
        executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
    }));
    addressBook.writeToFile();
    let result = await invoke(Operation.invokeHostFunction({
        func: deployFunction,
        auth: [],
    }), loadedConfig.admin, false);
    if (result) {
        return contractId;
    }
}
export async function invokeContract(contractKey, addressBook, method, params, source) {
    console.log("Invoking contract: ", contractKey, " with method: ", method);
    const contractAddress = addressBook.getContractId(contractKey);
    const contractInstance = new Contract(contractAddress);
    const contractOperation = contractInstance.call(method, ...params);
    return await invoke(contractOperation, source, false);
}
export async function invokeCustomContract(contractId, method, params, source) {
    console.log("Invoking contract: ", contractId, " with method: ", method);
    const contractInstance = new Contract(contractId);
    const contractOperation = contractInstance.call(method, ...params);
    return await invoke(contractOperation, source, false);
}
export async function deployStellarAsset(asset, source) {
    const xdrAsset = asset.toXDRObject();
    const networkId = hash(Buffer.from(loadedConfig.passphrase));
    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({
        networkId: networkId,
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(xdrAsset),
    }));
    const contractId = StrKey.encodeContract(hash(preimage.toXDR()));
    console.log('🚀 « deployed Stellar Asset:', contractId);
    const deployFunction = xdr.HostFunction.hostFunctionTypeCreateContract(new xdr.CreateContractArgs({
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(xdrAsset),
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
    }));
    return await invoke(Operation.invokeHostFunction({
        func: deployFunction,
        auth: [],
    }), source, false);
}
export async function bumpContractInstance(contractKey, addressBook, source) {
    const address = Address.fromString(addressBook.getContractId(contractKey));
    console.log('bumping contract instance: ', address.toString());
    const contractInstanceXDR = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
        contract: address.toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
    }));
    const bumpTransactionData = new xdr.SorobanTransactionData({
        resources: new xdr.SorobanResources({
            footprint: new xdr.LedgerFootprint({
                readOnly: [contractInstanceXDR],
                readWrite: [],
            }),
            instructions: 0,
            readBytes: 0,
            writeBytes: 0,
        }),
        resourceFee: xdr.Int64.fromString('0'),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        ext: new xdr.ExtensionPoint(0),
    });
    const txBuilder = await createTxBuilder(source);
    txBuilder.addOperation(Operation.extendFootprintTtl({ extendTo: 535670 })); // 1 year
    txBuilder.setSorobanData(bumpTransactionData);
    const result = await invokeTransaction(txBuilder.build(), source, false);
    // @ts-ignore
    console.log(result.status, '\n');
}
export async function bumpContractCode(wasmKey, addressBook, source) {
    console.log('bumping contract code: ', wasmKey);
    const wasmHash = Buffer.from(addressBook.getWasmHash(wasmKey), 'hex');
    const contractCodeXDR = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({
        hash: wasmHash,
    }));
    const bumpTransactionData = new xdr.SorobanTransactionData({
        resources: new xdr.SorobanResources({
            footprint: new xdr.LedgerFootprint({
                readOnly: [contractCodeXDR],
                readWrite: [],
            }),
            instructions: 0,
            readBytes: 0,
            writeBytes: 0,
        }),
        resourceFee: xdr.Int64.fromString('0'),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        ext: new xdr.ExtensionPoint(0),
    });
    const txBuilder = await createTxBuilder(source);
    txBuilder.addOperation(Operation.extendFootprintTtl({ extendTo: 535670 })); // 1 year
    txBuilder.setSorobanData(bumpTransactionData);
    const result = await invokeTransaction(txBuilder.build(), source, false);
    console.log("Result = ", result);
    // @ts-expect-error ignore
    console.log(result.status, '\n');
}
export async function airdropAccount(user, network) {
    try {
        await loadedConfig.rpc.requestAirdrop(user.publicKey(), loadedConfig.friendbot);
        console.log('Funded: ', user.publicKey());
    }
    catch (e) {
        console.log(user.publicKey(), ' already funded');
    }
}
export async function deploySorobanToken(wasmKey, addressBook, source) {
    const contractIdSalt = randomBytes(32);
    const networkId = hash(Buffer.from(loadedConfig.passphrase));
    const contractIdPreimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(source.publicKey()).toScAddress(),
        salt: contractIdSalt,
    }));
    const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({
        networkId: networkId,
        contractIdPreimage: contractIdPreimage,
    }));
    const contractId = StrKey.encodeContract(hash(hashIdPreimage.toXDR()));
    const wasmHash = Buffer.from(addressBook.getWasmHash(wasmKey), 'hex');
    const deployFunction = xdr.HostFunction.hostFunctionTypeCreateContract(new xdr.CreateContractArgs({
        contractIdPreimage: contractIdPreimage,
        executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
    }));
    // addressBook.writeToFile();
    const result = await invoke(Operation.invokeHostFunction({
        func: deployFunction,
        auth: [],
    }), source, false);
    if (result) {
        return contractId;
    }
}
export async function getTokenBalance(contractId, from, source) {
    const tokenContract = new Contract(contractId);
    const op = tokenContract.call("balance", new Address(from).toScVal());
    const result = await invoke(op, source, true);
    const parsedResult = scValToNative(result.result.retval).toString();
    if (!parsedResult) {
        throw new Error("The operation has no result.");
    }
    if (parsedResult == 0) {
        return parsedResult;
    }
    const resultNumber = parseInt(parsedResult.slice(0, -1));
    return resultNumber;
}
