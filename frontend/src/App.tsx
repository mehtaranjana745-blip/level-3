import { useState, useEffect } from 'react';
import { rpc, Networks, Contract, TransactionBuilder, Address, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils';
import { Activity, Coins, Clock, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import './index.css';

const STAKING_CONTRACT_ID = import.meta.env.VITE_STAKING_CONTRACT_ID || "CCQOB5ASLPRXYY43GB7UVV3ERJBAWREDVVILPAHQ3XSBFCR6G5OATBBV";
const TOKEN_CONTRACT_ID = import.meta.env.VITE_TOKEN_CONTRACT_ID || "CB7Y2C7PFKG7W34WVIAEPSAXP5PGBHCPCHVKERSCEI7Q5XZ52TQP5RZ6";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = 'https://soroban-testnet.stellar.org';

StellarWalletsKit.init({ modules: defaultModules() });

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [stakedAmount, setStakedAmount] = useState('0');
  const [pendingRewards, setPendingRewards] = useState('0');
  const [tokenBalance, setTokenBalance] = useState('0');
  const [stakeInput, setStakeInput] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [status, setStatus] = useState<{type: 'pending'|'success'|'error', msg: string, hash?: string} | null>(null);

  // Fetch real on-chain data from contracts
  const fetchContractData = async (userAddress: string) => {
    try {
      const server = new rpc.Server(RPC_URL);
      const source = await server.getAccount(userAddress);
      
      // 1. Get Stake
      const stakeTx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(
        new Contract(STAKING_CONTRACT_ID).call("get_stake", new Address(userAddress).toScVal())
      )
      .setTimeout(30)
      .build();
      
      const stakeSim = await server.simulateTransaction(stakeTx);
      if (rpc.Api.isSimulationSuccess(stakeSim) && stakeSim.result && stakeSim.result.retval) {
        const val = scValToNative(stakeSim.result.retval);
        setStakedAmount(val.toString());
      }
      
      // 2. Get Pending Rewards
      const rewardsTx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(
        new Contract(STAKING_CONTRACT_ID).call("calculate_rewards", new Address(userAddress).toScVal())
      )
      .setTimeout(30)
      .build();
      
      const rewardsSim = await server.simulateTransaction(rewardsTx);
      if (rpc.Api.isSimulationSuccess(rewardsSim) && rewardsSim.result && rewardsSim.result.retval) {
        const val = scValToNative(rewardsSim.result.retval);
        setPendingRewards(val.toString());
      }

      // 3. Get Token Balance
      const balanceTx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(
        new Contract(TOKEN_CONTRACT_ID).call("balance", new Address(userAddress).toScVal())
      )
      .setTimeout(30)
      .build();
      
      const balanceSim = await server.simulateTransaction(balanceTx);
      if (rpc.Api.isSimulationSuccess(balanceSim) && balanceSim.result && balanceSim.result.retval) {
        const val = scValToNative(balanceSim.result.retval);
        setTokenBalance(val.toString());
      }
    } catch (err) {
      console.error("Error fetching contract data:", err);
    }
  };

  // Poll for events
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const server = new rpc.Server(RPC_URL);
        const response = await server.getEvents({
          startLedger: (await server.getLatestLedger()).sequence - 1000,
          filters: [
            {
              type: "contract",
              contractIds: [STAKING_CONTRACT_ID],
              topics: [["*", "*", "*", "*"]]
            }
          ]
        });
        
        if (response.events) {
          const parsedEvents = response.events.map((e: any) => {
            let typeStr = "Unknown";
            if (e.topic && e.topic[0]) {
               try { typeStr = e.topic[0].value().toString(); } catch {}
            }
            return {
              id: e.id,
              type: typeStr,
              user: e.topic[1] ? 'User' : 'Unknown', 
              amount: e.value ? e.value.value().toString() : '0',
              time: new Date().toLocaleTimeString()
            };
          });
          setEvents(parsedEvents.reverse().slice(0, 10)); // Top 10 recent
        }
      } catch (err) {
        console.error("Error fetching events:", err);
      }
    };

    if (STAKING_CONTRACT_ID.startsWith('C')) {
      fetchEvents();
      const interval = setInterval(fetchEvents, 10000); // every 10s
      return () => clearInterval(interval);
    }
  }, []);

  const connectWallet = async () => {
    try {
      const { address: newAddress } = await StellarWalletsKit.authModal();
      setAddress(newAddress);
      setStatus({type: 'success', msg: 'Wallet connected successfully'});
      fetchContractData(newAddress);
    } catch (e: any) {
      setStatus({type: 'error', msg: e.message || 'Wallet connection failed'});
    }
  };

  useEffect(() => {
    if (address) {
      fetchContractData(address);
      const interval = setInterval(() => {
        fetchContractData(address);
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [address]);

  const stake = async () => {
    if (!address) return setStatus({type: 'error', msg: 'Wallet not connected'});
    if (!stakeInput || isNaN(Number(stakeInput)) || Number(stakeInput) <= 0) {
      return setStatus({type: 'error', msg: 'Invalid stake amount'});
    }
    
    setStatus({type: 'pending', msg: 'Building transaction...'});
    try {
      const server = new rpc.Server(RPC_URL);
      const source = await server.getAccount(address);
      const contract = new Contract(STAKING_CONTRACT_ID);
      
      const tx = new TransactionBuilder(source, {
        fee: "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(
        contract.call("stake", 
          new Address(address).toScVal(), 
          nativeToScVal(stakeInput, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();

      const preparedTransaction = await server.prepareTransaction(tx);
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(preparedTransaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address
      });
      
      const txToSubmit = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as any;
      
      setStatus({type: 'pending', msg: 'Submitting transaction...'});
      const response = await server.sendTransaction(txToSubmit);
      
      if (response.status === 'PENDING') {
        setStatus({type: 'success', msg: 'Staked successfully', hash: response.hash});
        setStakeInput('');
        setTimeout(() => fetchContractData(address), 4000);
      } else {
        throw new Error('Transaction failed on network');
      }
    } catch (e: any) {
      setStatus({type: 'error', msg: 'Transaction failed: ' + e.message});
    }
  };

  const unstake = async () => {
    if (!address) return setStatus({type: 'error', msg: 'Wallet not connected'});
    
    setStatus({type: 'pending', msg: 'Unstaking...'});
    try {
      const server = new rpc.Server(RPC_URL);
      const source = await server.getAccount(address);
      const contract = new Contract(STAKING_CONTRACT_ID);
      
      const tx = new TransactionBuilder(source, {
        fee: "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(
        contract.call("unstake", new Address(address).toScVal())
      )
      .setTimeout(30)
      .build();

      const preparedTransaction = await server.prepareTransaction(tx);
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(preparedTransaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address
      });
      const txToSubmit = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as any;
      
      const response = await server.sendTransaction(txToSubmit);
      if (response.status === 'PENDING') {
        setStatus({type: 'success', msg: 'Unstaked successfully', hash: response.hash});
        setStakedAmount('0');
        setPendingRewards('0');
        setTimeout(() => fetchContractData(address), 4000);
      } else {
        throw new Error('Transaction failed on network');
      }
    } catch (e: any) {
      setStatus({type: 'error', msg: 'Transaction failed: ' + e.message});
    }
  };

  const claim = async () => {
    if (!address) return setStatus({type: 'error', msg: 'Wallet not connected'});
    
    setStatus({type: 'pending', msg: 'Claiming rewards...'});
    try {
      const server = new rpc.Server(RPC_URL);
      const source = await server.getAccount(address);
      const contract = new Contract(STAKING_CONTRACT_ID);
      
      const tx = new TransactionBuilder(source, {
        fee: "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(
        contract.call("claim_rewards", new Address(address).toScVal())
      )
      .setTimeout(30)
      .build();

      const preparedTransaction = await server.prepareTransaction(tx);
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(preparedTransaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address
      });
      const txToSubmit = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as any;
      
      const response = await server.sendTransaction(txToSubmit);
      if (response.status === 'PENDING') {
        setStatus({type: 'success', msg: 'Rewards claimed successfully', hash: response.hash});
        setPendingRewards('0');
        setTimeout(() => fetchContractData(address), 4000);
      } else {
        throw new Error('Transaction failed on network');
      }
    } catch (e: any) {
      setStatus({type: 'error', msg: 'Transaction failed: ' + e.message});
    }
  };

  return (
    <div className="container">
      <header className="header">
        <div className="logo-container">
          <Activity size={32} color="var(--primary)" />
          <span className="logo-text">StellarStake</span>
        </div>
        
        {address ? (
          <div className="btn" style={{ border: '1px solid var(--primary)', color: 'var(--primary)' }}>
            <ShieldCheck size={18} />
            {address.slice(0, 4)}...{address.slice(-4)}
          </div>
        ) : (
          <button className="btn btn-primary" onClick={connectWallet}>
            Connect Wallet
          </button>
        )}
      </header>

      <main className="grid">
        <div className="panel">
          <h2 className="panel-header">
            <Coins size={24} color="var(--accent)" />
            Staking Dashboard
          </h2>
          
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card">
              <div className="stat-label">Total Staked</div>
              <div className="stat-value">{stakedAmount} XLM</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pending Rewards</div>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>
                {pendingRewards} RWT
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">RWT Balance</div>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>
                {tokenBalance} RWT
              </div>
            </div>
          </div>

          <div className="input-group">
            <label>Amount to Stake</label>
            <div className="input-wrapper">
              <input 
                type="number" 
                placeholder="0.00" 
                value={stakeInput}
                onChange={(e) => setStakeInput(e.target.value)}
              />
              <span className="input-suffix">XLM</span>
            </div>
          </div>

          <div className="action-buttons">
            <button className="btn btn-primary" onClick={stake} style={{ justifyContent: 'center' }}>
              Stake XLM
            </button>
            <button className="btn btn-accent" onClick={claim} style={{ justifyContent: 'center' }}>
              Claim Rewards
            </button>
          </div>

          <button 
            className="btn" 
            style={{ width: '100%', marginTop: '1rem', justifyContent: 'center', borderColor: '#f87171', color: '#f87171' }}
            onClick={unstake}
          >
            Unstake & Claim
          </button>
        </div>

        <div className="panel">
          <h2 className="panel-header">
            <Clock size={24} color="var(--primary)" />
            Live Activity
          </h2>
          
          <div className="event-list">
            {events.length > 0 ? events.map((ev, i) => (
              <div key={i} className={`event-item ${ev.type.toLowerCase()}`}>
                <div className="event-icon">
                  {ev.type === 'Staked' ? <ArrowRight size={16} color="var(--primary)" /> : <Activity size={16} />}
                </div>
                <div className="event-content">
                  <p><strong>{ev.user}</strong> {ev.type.toLowerCase()} {ev.amount} tokens</p>
                  <div className="event-time">{ev.time}</div>
                </div>
              </div>
            )) : (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>
                Waiting for network events...
              </p>
            )}
          </div>
        </div>
      </main>

      {status && (
        <div className={`status-toast ${status.type}`}>
          {status.type === 'error' && <AlertCircle size={20} color="#f87171" />}
          {status.type === 'success' && <ShieldCheck size={20} color="var(--primary)" />}
          {status.type === 'pending' && <Clock size={20} color="#fbbf24" />}
          <div>
            <div>{status.msg}</div>
            {status.hash && (
              <a 
                href={`https://stellar.expert/explorer/testnet/tx/${status.hash}`} 
                target="_blank" 
                rel="noreferrer"
                className="tx-link"
              >
                View on Explorer
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
