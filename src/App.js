import React, { useState, useEffect } from 'react';

// YOU NEED TO INSTALL THESE:
// npm install magic-sdk ethers@5

const MAGIC_API_KEY = process.env.REACT_APP_MAGIC_KEY;
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
const CHAIN_ID = 84532;
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const RATES = {
  USD: 1, NGN: 1650, MAD: 10.2, EUR: 0.92, GBP: 0.79
};

function App() {
  const [state, setState] = useState({
    view: 'welcome', user: null, magic: null, provider: null, signer: null,
    balance: { ETH: '0', USDC: '0' }, currency: 'USD', username: '',
    recipient: '', amount: '', qrData: '', txHash: '', error: '', loading: false
  });

  const users = JSON.parse(localStorage.getItem('payzero_users') || '{}');
  const saveUsers = (u) => localStorage.setItem('payzero_users', JSON.stringify(u));

  useEffect(() => { initMagic(); }, []);

  const initMagic = async () => {
    if (!MAGIC_API_KEY) {
      setState(p => ({ ...p, error: 'Add REACT_APP_MAGIC_KEY to .env file' }));
      return;
    }
    try {
      const { Magic } = await import('magic-sdk');
      const { ethers } = await import('ethers');
      const magic = new Magic(MAGIC_API_KEY, {
        network: { rpcUrl: BASE_SEPOLIA_RPC, chainId: CHAIN_ID }
      });
      const provider = new ethers.providers.Web3Provider(magic.rpcProvider);
      setState(p => ({ ...p, magic, provider }));
      if (await magic.user.isLoggedIn()) await loadUser(magic, provider);
    } catch (err) {
      setState(p => ({ ...p, error: 'Init failed: ' + err.message }));
    }
  };

  const loadUser = async (magic, provider) => {
    try {
      const { ethers } = await import('ethers');
      const metadata = await magic.user.getMetadata();
      const signer = provider.getSigner();
      const address = await signer.getAddress();
      const existing = Object.entries(users).find(([_, d]) => 
        d.address.toLowerCase() === address.toLowerCase()
      );
      if (existing) {
        setState(p => ({ ...p, username: existing[0], user: { email: metadata.email, address }, 
          signer, view: 'home' }));
        fetchBalances(provider, address);
      } else {
        setState(p => ({ ...p, user: { email: metadata.email, address }, signer, 
          view: 'create-username' }));
      }
    } catch (err) {
      setState(p => ({ ...p, error: err.message }));
    }
  };

  const loginWithEmail = async () => {
    const email = document.getElementById('email-input')?.value.trim();
    if (!email) return setState(p => ({ ...p, error: 'Enter email' }));
    setState(p => ({ ...p, loading: true, error: '' }));
    try {
      await state.magic.auth.loginWithMagicLink({ email });
      await loadUser(state.magic, state.provider);
    } catch (err) {
      setState(p => ({ ...p, error: 'Login failed: ' + err.message, loading: false }));
    }
  };

  const createUsername = () => {
    const username = document.getElementById('username-input')?.value.trim().toLowerCase();
    if (!username) return setState(p => ({ ...p, error: 'Enter username' }));
    if (!/^[a-z0-9_]{3,20}$/.test(username)) 
      return setState(p => ({ ...p, error: '3-20 chars (letters/numbers/_)' }));
    if (users[username]) return setState(p => ({ ...p, error: 'Username taken' }));
    const newUsers = { ...users, [username]: { address: state.user.address } };
    saveUsers(newUsers);
    setState(p => ({ ...p, username, view: 'home' }));
    fetchBalances(state.provider, state.user.address);
  };

  const fetchBalances = async (provider, address) => {
    try {
      const { ethers } = await import('ethers');
      const ethBal = await provider.getBalance(address);
      const ethFmt = ethers.utils.formatEther(ethBal);
      const usdcContract = new ethers.Contract(USDC_ADDRESS, 
        ['function balanceOf(address) view returns (uint256)'], provider);
      const usdcBal = await usdcContract.balanceOf(address);
      const usdcFmt = ethers.utils.formatUnits(usdcBal, 6);
      setState(p => ({ ...p, balance: { ETH: ethFmt, USDC: usdcFmt } }));
    } catch (err) { console.error('Balance error:', err); }
  };

  const convert = (usd) => ((parseFloat(usd) || 0) * RATES[state.currency]).toFixed(2);
  const symbol = () => ({ USD: '$', NGN: '₦', MAD: 'DH', EUR: '€', GBP: '£' }[state.currency] || '$');

  const generateQR = () => {
    setState(p => ({ ...p, 
      qrData: JSON.stringify({ username: p.username, address: p.user.address, amount: p.amount || null }), 
      view: 'receive' 
    }));
  };

  const sendPayment = async () => {
    setState(p => ({ ...p, loading: true, error: '' }));
    try {
      const { ethers } = await import('ethers');
      let addr;
      if (state.recipient.startsWith('@')) {
        const u = users[state.recipient.slice(1).toLowerCase()];
        if (!u) throw new Error('Username not found');
        addr = u.address;
      } else if (state.recipient.startsWith('0x')) {
        addr = state.recipient;
      } else throw new Error('Use @username or 0x...');
      
      const contract = new ethers.Contract(USDC_ADDRESS,
        ['function transfer(address to, uint256 amount) returns (bool)'], state.signer);
      const amt = ethers.utils.parseUnits(state.amount, 6);
      const tx = await contract.transfer(addr, amt);
      setState(p => ({ ...p, txHash: tx.hash, view: 'success' }));
      await tx.wait();
      fetchBalances(state.provider, state.user.address);
    } catch (err) {
      setState(p => ({ ...p, error: err.message || 'TX failed', loading: false }));
    }
  };

  const logout = async () => {
    await state.magic.user.logout();
    setState(p => ({ ...p, user: null, username: '', view: 'welcome' }));
  };

  const copy = (t) => { navigator.clipboard.writeText(t); alert('Copied!'); };

  const QR = ({ data }) => {
    const hash = data.split('').reduce((a,b) => ((a<<5)-a)+b.charCodeAt(0)|0, 0);
    return (
      <svg width="240" height="240" viewBox="0 0 25 25" className="bg-white p-4 rounded-xl">
        {Array.from({length:25}, (_,i) => Array.from({length:25}, (_,j) => (
          <rect key={`${i}-${j}`} x={j} y={i} width="1" height="1" 
            fill={(i*25+j+hash)%3===0?'#000':'#fff'} />
        )))}
      </svg>
    );
  };

  const totalUSD = parseFloat(state.balance.USDC) + parseFloat(state.balance.ETH) * 2000;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-cyan-500 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">

        {state.view === 'welcome' && (
          <div className="p-8">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-3xl font-bold">₿</div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">PayZero</h1>
              <p className="text-gray-600">Send money instantly with email</p>
            </div>
            <div className="space-y-4">
              <input id="email-input" type="email" placeholder="Enter your email"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-600"
                onKeyPress={e => e.key==='Enter' && loginWithEmail()} />
              <button onClick={loginWithEmail} disabled={state.loading}
                className="w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50">
                {state.loading ? 'Sending magic link...' : 'Continue with Email'}
              </button>
              {state.error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">{state.error}</div>}
              <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-700">
                <strong className="text-blue-800">How it works:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1">
                  <li>Enter email</li><li>Click magic link</li><li>Choose username</li><li>Send money!</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {state.view === 'create-username' && (
          <div className="p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center text-green-600 text-2xl">✓</div>
              <h2 className="text-2xl font-bold mb-2">Choose Username</h2>
              <p className="text-gray-600 text-sm">How people send you money</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-gray-500">@</span>
                  <input id="username-input" type="text" placeholder="mama_janet"
                    className="w-full pl-8 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-600"
                    onKeyPress={e => e.key==='Enter' && createUsername()} />
                </div>
                <p className="text-xs text-gray-500 mt-1">3-20 chars (letters/numbers/_)</p>
              </div>
              {state.error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">{state.error}</div>}
              <button onClick={createUsername} className="w-full py-4 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700">
                Create Account
              </button>
            </div>
          </div>
        )}

        {state.view === 'home' && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-2xl font-bold">PayZero</h1>
                <p className="text-sm text-purple-600 font-medium">@{state.username}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => copy('@'+state.username)} className="p-2 hover:bg-gray-100 rounded-lg">📋</button>
                <button onClick={logout} className="p-2 hover:bg-gray-100 rounded-lg">🚪</button>
              </div>
            </div>
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-6 mb-6 text-white">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-sm opacity-80 mb-1">Total Balance</p>
                  <h2 className="text-4xl font-bold">{symbol()}{convert(totalUSD)}</h2>
                </div>
                <select value={state.currency} onChange={e => setState(p => ({...p, currency: e.target.value}))}
                  className="bg-white/20 text-white rounded-lg px-3 py-1 text-sm border-0">
                  <option>USD</option><option>NGN</option><option>MAD</option><option>EUR</option><option>GBP</option>
                </select>
              </div>
              <div className="flex gap-2 text-sm">
                <div className="bg-white/20 rounded-lg px-3 py-1">{state.balance.ETH.slice(0,6)} ETH</div>
                <div className="bg-white/20 rounded-lg px-3 py-1">{state.balance.USDC} USDC</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <button onClick={() => setState(p => ({...p, view: 'send', error: ''}))}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-purple-50 hover:bg-purple-100">
                <span className="text-2xl">💸</span><span className="text-sm font-medium">Send</span>
              </button>
              <button onClick={generateQR} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-50 hover:bg-blue-100">
                <span className="text-2xl">📱</span><span className="text-sm font-medium">Receive</span>
              </button>
              <button onClick={() => alert('Scan coming soon! Enter @username for now')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-cyan-50 hover:bg-cyan-100">
                <span className="text-2xl">📷</span><span className="text-sm font-medium">Scan</span>
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => fetchBalances(state.provider, state.user.address)}
                className="flex-1 py-3 bg-gray-100 rounded-xl font-medium hover:bg-gray-200">Refresh</button>
              <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noreferrer"
                className="flex-1 py-3 bg-green-100 text-green-700 rounded-xl font-medium hover:bg-green-200 text-center">
                Get Testnet Tokens
              </a>
            </div>
          </div>
        )}

        {state.view === 'send' && (
          <div className="p-6">
            <button onClick={() => setState(p => ({...p, view: 'home'}))} className="mb-6 text-purple-600 font-medium">← Back</button>
            <h2 className="text-2xl font-bold mb-6">Send Payment</h2>
            <div className="space-y-4">
              <input type="text" placeholder="@username or 0x..." value={state.recipient}
                onChange={e => setState(p => ({...p, recipient: e.target.value}))}
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-purple-600" />
              <div>
                <input type="number" step="0.01" placeholder="0.00" value={state.amount}
                  onChange={e => setState(p => ({...p, amount: e.target.value}))}
                  className="w-full px-4 py-3 border rounded-xl text-2xl font-bold focus:ring-2 focus:ring-purple-600" />
                <p className="text-xs text-gray-500 mt-1">Available: {state.balance.USDC} USDC</p>
              </div>
              {state.error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">{state.error}</div>}
              <button onClick={() => setState(p => ({...p, view: 'confirm'}))}
                disabled={!state.recipient || !state.amount}
                className="w-full py-4 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 disabled:opacity-50">
                Continue
              </button>
            </div>
          </div>
        )}

        {state.view === 'confirm' && (
          <div className="p-6">
            <button onClick={() => setState(p => ({...p, view: 'send'}))} className="mb-6 text-purple-600 font-medium">← Back</button>
            <h2 className="text-2xl font-bold mb-6">Confirm Payment</h2>
            <div className="bg-gray-50 rounded-2xl p-6 mb-6 space-y-3">
              <div className="flex justify-between"><span className="text-gray-600">To</span><span className="font-semibold">{state.recipient}</span></div>
              <div className="border-t"></div>
              <div className="flex justify-between"><span className="text-gray-600">Amount</span><span className="text-2xl font-bold">{state.amount} USDC</span></div>
              <div className="border-t"></div>
              <div className="flex justify-between"><span className="text-gray-600">Network</span><span className="text-sm">Base Sepolia</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Fee</span><span className="text-sm text-green-600">~$0.001</span></div>
            </div>
            {state.error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 mb-4">{state.error}</div>}
            <button onClick={sendPayment} disabled={state.loading}
              className="w-full py-4 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 disabled:opacity-50">
              {state.loading ? 'Sending...' : `Send ${state.amount} USDC`}
            </button>
          </div>
        )}

        {state.view === 'success' && (
          <div className="p-6 flex flex-col items-center min-h-[500px] justify-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 text-4xl">✓</div>
            <h2 className="text-2xl font-bold mb-2">Payment Sent!</h2>
            <p className="text-gray-600 mb-4">{state.amount} USDC to {state.recipient}</p>
            <div className="bg-gray-50 rounded-xl p-4 w-full mb-6">
              <p className="text-xs text-gray-500 mb-1">Transaction:</p>
              <p className="text-xs font-mono text-gray-900 break-all">{state.txHash}</p>
            </div>
            <a href={`https://sepolia.basescan.org/tx/${state.txHash}`} target="_blank" rel="noreferrer"
              className="text-purple-600 text-sm hover:underline mb-6">View on Explorer →</a>
            <button onClick={() => setState(p => ({...p, view: 'home', amount: '', recipient: ''}))}
              className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700">Done</button>
          </div>
        )}

        {state.view === 'receive' && (
          <div className="p-6">
            <button onClick={() => setState(p => ({...p, view: 'home'}))} className="mb-6 text-purple-600 font-medium">← Back</button>
            <h2 className="text-2xl font-bold mb-6 text-center">Receive Payment</h2>
            <div className="flex flex-col items-center space-y-4">
              <QR data={state.qrData} />
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600 mb-2">@{state.username}</p>
                <p className="text-sm text-gray-500">Scan to send {state.amount ? state.amount+' USDC' : 'any amount'}</p>
              </div>
              <button onClick={() => copy('@'+state.username)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-600 rounded-xl font-medium hover:bg-purple-200">
                📋 Copy Username
              </button>
              <p className="text-xs text-gray-500 text-center pt-4 border-t w-full">
                Share @{state.username} or show QR to receive payments
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;