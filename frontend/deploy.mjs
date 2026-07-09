import { Keypair, Networks, rpc, TransactionBuilder, Operation, xdr, Address, Contract, StrKey } from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL);

async function fundAccount(publicKey) {
  console.log(`Funding deployer account ${publicKey}...`);
  const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
  if (!res.ok) throw new Error('Failed to fund account');
}

async function submitTx(tx, keypair) {
  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(keypair);
  
  console.log('Submitting transaction...');
  let res = await server.sendTransaction(preparedTx);
  if (res.status !== 'PENDING') {
    throw new Error('Transaction submission failed: ' + JSON.stringify(res));
  }
  
  // Wait for completion
  let status = 'PENDING';
  let txRes;
  while (status === 'PENDING' || status === 'NOT_FOUND') {
    await new Promise(resolve => setTimeout(resolve, 3000));
    txRes = await server.getTransaction(res.hash);
    status = txRes.status;
  }
  
  if (status === 'SUCCESS') {
    return txRes;
  } else {
    throw new Error('Transaction failed on network: ' + JSON.stringify(txRes));
  }
}

async function uploadWasm(keypair, wasmPath) {
  console.log(`Uploading WASM: ${wasmPath}`);
  const wasm = fs.readFileSync(wasmPath);
  
  const source = await server.getAccount(keypair.publicKey());
  
  const tx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(300)
    .build();
    
  const res = await submitTx(tx, keypair);
  console.log('Upload result:', JSON.stringify(res, null, 2));
  
  let wasmIdHex;
  if (res.returnValue) {
    const parsed = xdr.ScVal.fromXDR(res.returnValue.toXDR ? res.returnValue.toXDR() : res.returnValue, 'base64');
    wasmIdHex = parsed.bytes().toString('hex');
  } else {
    // If not found in returnValue, fallback
    console.log('No returnValue found in res', res);
  }
  
  console.log(`Uploaded WASM! Hash: ${wasmIdHex}`);
  return wasmIdHex;
}

async function createContract(keypair, wasmIdHex) {
  console.log(`Creating contract from WASM hash: ${wasmIdHex}`);
  const source = await server.getAccount(keypair.publicKey());
  
  const tx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.createCustomContract({
      address: new Address(keypair.publicKey()),
      wasmHash: Buffer.from(wasmIdHex, 'hex')
    }))
    .setTimeout(300)
    .build();
    
  const res = await submitTx(tx, keypair);
  console.log('Create result:', JSON.stringify(res, null, 2));
  
  let contractId;
  if (res.returnValue) {
    const parsed = xdr.ScVal.fromXDR(res.returnValue.toXDR ? res.returnValue.toXDR() : res.returnValue, 'base64');
    const contractIdBuffer = parsed.address().contractId();
    contractId = StrKey.encodeContract(contractIdBuffer);
  }
  
  console.log(`Created contract! ID: ${contractId}`);
  return contractId;
}

async function initializeToken(keypair, contractId) {
  console.log(`Initializing token contract...`);
  const source = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);
  
  const admin = new Address(keypair.publicKey()).toScVal();
  const name = xdr.ScVal.scvString('Reward Token');
  const symbol = xdr.ScVal.scvString('RWT');
  
  const tx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call('initialize', admin, name, symbol))
    .setTimeout(300)
    .build();
    
  await submitTx(tx, keypair);
  console.log('Token initialized successfully!');
}

async function initializeStaking(keypair, stakingContractId, tokenContractId) {
  console.log(`Initializing staking contract...`);
  const source = await server.getAccount(keypair.publicKey());
  const contract = new Contract(stakingContractId);
  
  const tokenAddr = new Address(tokenContractId).toScVal();
  
  const tx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call('initialize', tokenAddr))
    .setTimeout(300)
    .build();
    
  await submitTx(tx, keypair);
  console.log('Staking contract initialized successfully!');
}

async function main() {
  try {
    const keypair = Keypair.random();
    await fundAccount(keypair.publicKey());
    
    // Upload & Create Token Contract
    const tokenWasmHash = await uploadWasm(keypair, path.join(__dirname, '..', 'contracts', 'target', 'wasm32-unknown-unknown', 'release', 'token.wasm'));
    const tokenContractId = await createContract(keypair, tokenWasmHash);
    await initializeToken(keypair, tokenContractId);
    
    // Upload & Create Staking Contract
    const stakingWasmHash = await uploadWasm(keypair, path.join(__dirname, '..', 'contracts', 'target', 'wasm32-unknown-unknown', 'release', 'staking.wasm'));
    const stakingContractId = await createContract(keypair, stakingWasmHash);
    await initializeStaking(keypair, stakingContractId, tokenContractId);
    
    // Update .env
    const envPath = path.join(__dirname, '.env');
    let envContent = `VITE_STAKING_CONTRACT_ID=${stakingContractId}\nVITE_TOKEN_CONTRACT_ID=${tokenContractId}\n`;
    fs.writeFileSync(envPath, envContent);
    console.log('Updated frontend/.env');
    
    console.log('\\n--- DEPLOYMENT SUCCESSFUL ---');
    console.log('Token Contract ID:', tokenContractId);
    console.log('Staking Contract ID:', stakingContractId);
    console.log('Restart the frontend with `npm run dev` if needed.\\n');
    
  } catch (e) {
    console.error('Deployment failed:', e);
  }
}

main();
